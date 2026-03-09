from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("anarkey-backend")

def resolve_root_dir() -> Path:
    here = Path(__file__).resolve().parent
    candidates = [here.parent, here, Path.cwd()]
    for base in candidates:
        if (base / "scripts" / "contract_ops.js").exists() or (base / ".env.demo").exists():
            return base
    return here


ROOT_DIR = resolve_root_dir()
SCRIPTS_DIR = ROOT_DIR / "scripts"
WALLETS_DEMO_PATH = ROOT_DIR / "wallets.demo.json"
CONTRACT_OPS_SCRIPT = SCRIPTS_DIR / "contract_ops.js"

FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617
DEFAULT_CONTRACT_ADDRESS = "0x09a02A50f8c1D2aabd5775A63a2B5dc488274222"


# ============================================================================
# Environment + Utilities
# ============================================================================


def load_env_file(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    values: Dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def load_env_values() -> Dict[str, str]:
    here = Path(__file__).resolve().parent
    candidates = [
        ROOT_DIR / ".env.demo",
        ROOT_DIR / ".env",
        Path.cwd() / ".env.demo",
        Path.cwd() / ".env",
        here / ".env.demo",
        here / ".env",
    ]
    merged: Dict[str, str] = {}
    for path in candidates:
        merged.update(load_env_file(path))
    return merged


ENV_FILE_VALUES = load_env_values()


def env_value(key: str, default: Optional[str] = None) -> Optional[str]:
    return os.getenv(key) or ENV_FILE_VALUES.get(key) or default


class ServiceError(Exception):
    pass


class ScriptBridge:
    def __init__(self, root_dir: Path) -> None:
        self.root_dir = root_dir

    def run_json_script(self, script_path: Path, extra_env: Dict[str, str], timeout_sec: int = 30) -> Any:
        if not script_path.exists():
            raise ServiceError(f"Missing script: {script_path}")

        cmd_env = os.environ.copy()
        for key, value in ENV_FILE_VALUES.items():
            cmd_env.setdefault(key, value)
        cmd_env.update({k: str(v) for k, v in extra_env.items() if v is not None})

        proc = subprocess.run(
            ["node", str(script_path)],
            cwd=str(self.root_dir),
            env=cmd_env,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )

        stdout = (proc.stdout or "").strip()
        stderr = (proc.stderr or "").strip()

        if proc.returncode != 0:
            logger.error("Script failed (%s): %s", script_path.name, stderr or stdout)
            raise ServiceError(stderr or stdout or f"Script {script_path.name} failed")

        if not stdout:
            return None

        try:
            return json.loads(stdout)
        except json.JSONDecodeError as exc:
            logger.error("Invalid JSON output from %s: %s", script_path.name, stdout)
            raise ServiceError(f"Invalid JSON output from {script_path.name}") from exc

    def run_contract_action(self, action: str, extra_env: Dict[str, str], timeout_sec: int = 30) -> Any:
        env = dict(extra_env)
        env["ACTION"] = action
        return self.run_json_script(CONTRACT_OPS_SCRIPT, env, timeout_sec=timeout_sec)


script_bridge = ScriptBridge(ROOT_DIR)


# ============================================================================
# Demo Store (in-memory with TTL)
# ============================================================================


class DemoStore:
    def __init__(self, ttl_seconds: int = 60 * 60 * 4) -> None:
        self.ttl_seconds = ttl_seconds
        self.backup_drafts: Dict[str, Dict[str, Any]] = {}
        self.backup_fingerprint_to_draft: Dict[str, str] = {}
        self.backup_id_to_draft: Dict[str, str] = {}
        self.setup_signatures: Dict[str, Dict[str, str]] = {}
        self.setup_tasks: Dict[str, List[Dict[str, Any]]] = {}
        self.original_secret_by_backup: Dict[str, str] = {}
        self.community_members_by_address: Dict[str, Dict[str, Any]] = {}

    def _now(self) -> float:
        return time.time()

    def _is_expired(self, created_at: float) -> bool:
        return (self._now() - created_at) > self.ttl_seconds

    def purge(self) -> None:
        expired_drafts: List[str] = []
        for draft_id, payload in self.backup_drafts.items():
            if self._is_expired(payload.get("createdAt", 0.0)):
                expired_drafts.append(draft_id)

        for draft_id in expired_drafts:
            self.backup_drafts.pop(draft_id, None)
            self.setup_signatures.pop(draft_id, None)

        for guardian_id, tasks in list(self.setup_tasks.items()):
            active_tasks = [task for task in tasks if not self._is_expired(task.get("createdAt", 0.0))]
            if active_tasks:
                self.setup_tasks[guardian_id] = active_tasks
            else:
                self.setup_tasks.pop(guardian_id, None)

    def create_draft(self, payload: Dict[str, Any]) -> str:
        self.purge()
        draft_id = uuid.uuid4().hex
        data = dict(payload)
        data["draftId"] = draft_id
        data["createdAt"] = self._now()
        self.backup_drafts[draft_id] = data
        self.setup_signatures[draft_id] = dict(payload.get("signatures", {}))
        return draft_id

    def get_draft(self, draft_id: str) -> Optional[Dict[str, Any]]:
        self.purge()
        return self.backup_drafts.get(draft_id)

    def set_signature(self, draft_id: str, guardian_id: str, signature: str) -> None:
        self.setup_signatures.setdefault(draft_id, {})[guardian_id] = signature

    def get_signatures(self, draft_id: str) -> Dict[str, str]:
        self.purge()
        return dict(self.setup_signatures.get(draft_id, {}))

    def add_setup_task(self, guardian_id: str, task: Dict[str, Any]) -> None:
        self.setup_tasks.setdefault(str(guardian_id), []).append(
            {
                **task,
                "createdAt": self._now(),
                "status": task.get("status", "pending"),
            }
        )

    def complete_setup_task(self, draft_id: str, guardian_id: str) -> None:
        for task in self.setup_tasks.get(str(guardian_id), []):
            if task.get("purpose") == "backup_setup" and task.get("backupDraftId") == draft_id:
                task["status"] = "completed"
                task["completedAt"] = self._now()

    def get_setup_tasks(self, guardian_id: str) -> List[Dict[str, Any]]:
        self.purge()
        return list(self.setup_tasks.get(str(guardian_id), []))

    def bind_backup(self, fingerprint: str, backup_id: str, draft_id: str) -> None:
        self.backup_fingerprint_to_draft[fingerprint] = draft_id
        self.backup_id_to_draft[str(backup_id)] = draft_id

    def lookup_draft_by_fingerprint(self, fingerprint: str) -> Optional[Dict[str, Any]]:
        draft_id = self.backup_fingerprint_to_draft.get(fingerprint)
        if not draft_id:
            return None
        return self.get_draft(draft_id)

    def get_draft_by_backup_id(self, backup_id: str) -> Optional[Dict[str, Any]]:
        draft_id = self.backup_id_to_draft.get(str(backup_id))
        if not draft_id:
            return None
        return self.get_draft(draft_id)

    def remember_original_secret(self, backup_id: str, secret_scalar: str) -> None:
        self.original_secret_by_backup[str(backup_id)] = str(secret_scalar)

    def get_original_secret(self, backup_id: str) -> Optional[str]:
        return self.original_secret_by_backup.get(str(backup_id))

    def upsert_community_member(self, username: str, address: str, party_id: int) -> Dict[str, Any]:
        now = self._now()
        key = address.lower()
        previous = self.community_members_by_address.get(key)

        member = {
            "username": username.strip(),
            "address": address,
            "partyId": int(party_id),
            "createdAt": previous.get("createdAt", now) if previous else now,
            "lastSeenAt": now,
        }
        self.community_members_by_address[key] = member
        return dict(member)

    def heartbeat_community_member(self, address: str) -> Optional[Dict[str, Any]]:
        member = self.community_members_by_address.get(address.lower())
        if not member:
            return None
        member["lastSeenAt"] = self._now()
        return dict(member)

    def list_community_members(self, online_ttl_seconds: int = 45) -> List[Dict[str, Any]]:
        now = self._now()
        rows: List[Dict[str, Any]] = []
        for member in self.community_members_by_address.values():
            last_seen = float(member.get("lastSeenAt", 0.0))
            rows.append(
                {
                    "username": str(member.get("username", "")),
                    "address": str(member.get("address", "")),
                    "partyId": int(member.get("partyId", 0)),
                    "online": (now - last_seen) <= online_ttl_seconds,
                    "lastSeenAt": last_seen,
                }
            )
        rows.sort(key=lambda x: x["username"].lower())
        return rows


store = DemoStore()


# ============================================================================
# Contract + Crypto Services
# ============================================================================


class ContractService:
    def __init__(self, bridge: ScriptBridge) -> None:
        self.bridge = bridge

    def _base_env(self) -> Dict[str, str]:
        rpc_url = env_value("RPC_URL", "") or ""
        contract_address = env_value("CONTRACT_ADDRESS", DEFAULT_CONTRACT_ADDRESS) or DEFAULT_CONTRACT_ADDRESS
        chain_id = env_value("CHAIN_ID", "") or ""
        if not contract_address:
            raise ServiceError("Missing CONTRACT_ADDRESS")
        if not rpc_url:
            raise ServiceError("Missing RPC_URL")
        return {
            "RPC_URL": rpc_url,
            "CONTRACT_ADDRESS": contract_address,
            "CHAIN_ID": chain_id,
        }

    def party_id_of_signer(self, address: str) -> int:
        result = self.bridge.run_contract_action(
            "party_id_of_signer",
            {**self._base_env(), "ADDRESS": address},
        )
        return int(result["partyId"])

    def party_by_id(self, party_id: int) -> Dict[str, Any]:
        return self.bridge.run_contract_action(
            "party_by_id",
            {**self._base_env(), "PARTY_ID": str(party_id)},
        )

    def get_backup(self, backup_id: int) -> Dict[str, Any]:
        return self.bridge.run_contract_action(
            "get_backup",
            {**self._base_env(), "BACKUP_ID": str(backup_id)},
        )

    def get_session(self, session_id: int) -> Dict[str, Any]:
        return self.bridge.run_contract_action(
            "get_session",
            {**self._base_env(), "SESSION_ID": str(session_id)},
        )

    def get_session_guardian_data(self, session_id: int, guardian_ids: List[int]) -> Dict[str, Any]:
        return self.bridge.run_contract_action(
            "get_session_guardian_data",
            {
                **self._base_env(),
                "SESSION_ID": str(session_id),
                "GUARDIAN_IDS": ",".join(str(x) for x in guardian_ids),
            },
        )

    def sigma_message_digest(self, owner_id: int, guardian_id: int, backup_nonce: int) -> str:
        result = self.bridge.run_contract_action(
            "sigma_message_digest",
            {
                **self._base_env(),
                "OWNER_ID": str(owner_id),
                "GUARDIAN_ID": str(guardian_id),
                "BACKUP_NONCE": str(backup_nonce),
            },
        )
        return str(result["digest"])

    def derive_sigma_from_signature(self, signature: str) -> str:
        result = self.bridge.run_contract_action(
            "derive_sigma_from_signature",
            {**self._base_env(), "SIGNATURE": signature},
        )
        return str(result["sigma"])

    def submit_deterministic_signature(self, session_id: int, signature: str, private_key: str) -> Dict[str, Any]:
        return self.bridge.run_contract_action(
            "submit_deterministic_signature",
            {
                **self._base_env(),
                "SESSION_ID": str(session_id),
                "SIGNATURE": signature,
                "PRIVATE_KEY": private_key,
            },
            timeout_sec=60,
        )

    def pk_commitment_address_v1(self, address: str) -> Dict[str, Any]:
        result = self.bridge.run_contract_action(
            "pk_commitment_address_v1",
            {**self._base_env(), "ADDRESS": address},
        )
        return {
            "pkCommitment": result["pkCommitment"],
            "chainId": str(result["chainId"]),
            "strategy": "address_v1",
        }

    def next_ids(self) -> Dict[str, int]:
        result = self.bridge.run_contract_action("next_ids", self._base_env())
        return {
            "nextPartyId": int(result["nextPartyId"]),
            "nextBackupId": int(result["nextBackupId"]),
            "nextSessionId": int(result["nextSessionId"]),
        }


contract_service = ContractService(script_bridge)


class DemoWalletService:
    def __init__(self, contract: ContractService) -> None:
        self.contract = contract
        self.wallets = self._load_wallets_json()

    def _load_wallets_json(self) -> Dict[str, Any]:
        if not WALLETS_DEMO_PATH.exists():
            return {}
        try:
            return json.loads(WALLETS_DEMO_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _pk_to_address(self) -> Dict[str, str]:
        pairs: Dict[str, str] = {}
        for i in (1, 2, 3):
            pk = env_value(f"GUARDIAN{i}_PRIVATE_KEY")
            addr = env_value(f"GUARDIAN{i}_ADDRESS")
            if pk and addr:
                pairs[pk.lower()] = addr
        owner_pk = env_value("OWNER_PRIVATE_KEY")
        owner_addr = env_value("OWNER_ADDRESS")
        if owner_pk and owner_addr:
            pairs[owner_pk.lower()] = owner_addr
        return pairs

    def get_guardian_private_key_by_id(self, guardian_id: int) -> Optional[str]:
        gids_raw = env_value("GUARDIAN_IDS", "") or ""
        gkeys_raw = env_value("GUARDIAN_PRIVATE_KEYS", "") or ""
        if gids_raw and gkeys_raw:
            gids = [x.strip() for x in gids_raw.split(",") if x.strip()]
            gkeys = [x.strip() for x in gkeys_raw.split(",") if x.strip()]
            if len(gids) == len(gkeys):
                for gid, gk in zip(gids, gkeys):
                    if int(gid) == int(guardian_id):
                        return gk

        # fallback: map guardian1..3 addresses -> party ids
        for i in (1, 2, 3):
            address = env_value(f"GUARDIAN{i}_ADDRESS")
            private_key = env_value(f"GUARDIAN{i}_PRIVATE_KEY")
            if not address or not private_key:
                continue
            try:
                pid = self.contract.party_id_of_signer(address)
                if pid == int(guardian_id):
                    return private_key
            except Exception:
                continue

        return None

    def get_owner_private_key(self) -> Optional[str]:
        return env_value("OWNER_PRIVATE_KEY")

    def list_burners(self) -> List[Dict[str, Any]]:
        burners: List[Dict[str, Any]] = []
        owner_addr = env_value("OWNER_ADDRESS")
        owner_pk = env_value("OWNER_PRIVATE_KEY")
        if owner_addr and owner_pk:
            burners.append({"label": "owner", "address": owner_addr, "privateKey": owner_pk})

        for i in (1, 2, 3):
            addr = env_value(f"GUARDIAN{i}_ADDRESS")
            pk = env_value(f"GUARDIAN{i}_PRIVATE_KEY")
            if addr and pk:
                burners.append({"label": f"guardian{i}", "address": addr, "privateKey": pk})

        if not burners and isinstance(self.wallets, dict):
            for key, wallet in self.wallets.items():
                if isinstance(wallet, dict) and wallet.get("address") and wallet.get("privateKey"):
                    burners.append(
                        {
                            "label": key,
                            "address": wallet["address"],
                            "privateKey": wallet["privateKey"],
                        }
                    )

        return burners


demo_wallet_service = DemoWalletService(contract_service)


# ============================================================================
# Request / Response Models
# ============================================================================


class SetupSignatureItem(BaseModel):
    guardianId: str
    signature: str


class PartyRegisterPrepareRequest(BaseModel):
    address: str


class CommunityJoinRequest(BaseModel):
    username: str
    address: str


class CommunityHeartbeatRequest(BaseModel):
    address: str


class BackupPrepareRequest(BaseModel):
    ownerAddress: str
    guardianIds: List[str]
    threshold: int
    backupNonce: Optional[str] = None
    secretScalar: str
    mode: str = Field(pattern="^(demo|real)$")
    setupSignatures: Optional[List[SetupSignatureItem]] = None
    backupDraftId: Optional[str] = None


class RecoveryOpenPrepareRequest(BaseModel):
    backupId: str


class GuardianSignRequest(BaseModel):
    purpose: str = Field(pattern="^(backup_setup|recovery_session)$")
    mode: str = Field(pattern="^(demo|real)$")
    sessionId: Optional[str] = None
    backupDraftId: Optional[str] = None
    guardianId: str
    signature: Optional[str] = None
    submitOnchain: bool = True


class RecoveryReconstructRequest(BaseModel):
    backupId: str
    sessionId: str
    guardianIds: List[str]


# ============================================================================
# Domain Services
# ============================================================================


def _to_int(value: Any, field_name: str) -> int:
    try:
        x = int(str(value), 10)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}: {value}") from exc
    if x < 0:
        raise HTTPException(status_code=400, detail=f"{field_name} must be >= 0")
    return x


def _backup_fingerprint(owner_id: str, backup_nonce: str, t: str, guardian_ids: List[str], public_points: List[str]) -> str:
    return "|".join(
        [
            str(owner_id),
            str(backup_nonce),
            str(t),
            ",".join(guardian_ids),
            ",".join(public_points),
        ]
    )


class CommunityService:
    def __init__(self, contract: ContractService, demo_store: DemoStore) -> None:
        self.contract = contract
        self.demo_store = demo_store

    def join(self, username: str, address: str) -> Dict[str, Any]:
        clean_username = username.strip()
        clean_address = address.strip()
        if not clean_username:
            raise HTTPException(status_code=400, detail="username cannot be empty")
        if not clean_address:
            raise HTTPException(status_code=400, detail="address cannot be empty")

        party_id = self.contract.party_id_of_signer(clean_address)
        if party_id == 0:
            raise HTTPException(
                status_code=400,
                detail="Wallet is not registered on-chain. Call registerParty first.",
            )

        row = self.contract.party_by_id(party_id)
        if not bool(row.get("registered")):
            raise HTTPException(status_code=400, detail="partyId exists but is not registered")

        member = self.demo_store.upsert_community_member(clean_username, clean_address, party_id)
        return {
            "member": {
                "username": member["username"],
                "address": member["address"],
                "partyId": str(member["partyId"]),
                "online": True,
            },
            "community": self.list_members(),
        }

    def heartbeat(self, address: str) -> Dict[str, Any]:
        clean_address = address.strip()
        if not clean_address:
            raise HTTPException(status_code=400, detail="address cannot be empty")
        row = self.demo_store.heartbeat_community_member(clean_address)
        if not row:
            raise HTTPException(status_code=404, detail="community member not found for address")
        return {
            "address": row["address"],
            "partyId": str(row["partyId"]),
            "online": True,
        }

    def list_members(self) -> List[Dict[str, Any]]:
        return [
            {
                "username": row["username"],
                "address": row["address"],
                "partyId": str(row["partyId"]),
                "online": bool(row["online"]),
            }
            for row in self.demo_store.list_community_members()
        ]


community_service = CommunityService(contract_service, store)


class BackupService:
    def __init__(self, contract: ContractService, bridge: ScriptBridge, wallets: DemoWalletService, demo_store: DemoStore) -> None:
        self.contract = contract
        self.bridge = bridge
        self.wallets = wallets
        self.demo_store = demo_store

    def _finalize_prepare(self, draft: Dict[str, Any], signatures_by_guardian: Dict[str, str]) -> Dict[str, Any]:
        ordered_guardian_ids = [int(x) for x in draft["guardianIds"]]

        signatures = []
        for gid in ordered_guardian_ids:
            sig = signatures_by_guardian.get(str(gid))
            if not sig:
                raise HTTPException(status_code=400, detail=f"Missing signature for guardian {gid}")
            signatures.append(sig)

        env = {
            "CONTRACT_ADDRESS": env_value("CONTRACT_ADDRESS", DEFAULT_CONTRACT_ADDRESS) or DEFAULT_CONTRACT_ADDRESS,
            "CHAIN_ID": env_value("CHAIN_ID", "") or "",
            "OWNER_ID": str(draft["ownerId"]),
            "BACKUP_NONCE": str(draft["backupNonce"]),
            "SECRET_SCALAR": str(draft["secretScalar"]),
            "THRESHOLD": str(draft["t"]),
            "GUARDIAN_IDS": ",".join(str(g) for g in ordered_guardian_ids),
            "GUARDIAN_SIGNATURES": ",".join(signatures),
        }

        data = self.bridge.run_json_script(SCRIPTS_DIR / "prepare_backup.js", env)

        publish_args = data["publishBackupArgs"]
        guardian_rows = data.get("guardians", [])

        output = {
            "status": "ready",
            "backupDraftId": draft["draftId"],
            "ownerId": str(draft["ownerId"]),
            "guardianIds": [str(x) for x in publish_args["guardianIds"]],
            "thresholdRequired": int(draft["thresholdRequired"]),
            "t": int(publish_args["t"]),
            "backupNonce": str(publish_args["backupNonce"]),
            "publicPoints": [str(x) for x in publish_args["publicPoints"]],
            "signatures": [str(x.get("signature", "")) for x in guardian_rows],
            "sigmas": [str(x.get("sigma", "")) for x in guardian_rows],
            "digests": [
                {
                    "guardianId": str(x.get("guardianId", "")),
                    "digest": str(x.get("digest", "")),
                }
                for x in guardian_rows
            ],
            "metadata": {
                "mode": draft["mode"],
                "offchainComputation": True,
                "onchainPublishRequired": True,
            },
        }

        fingerprint = _backup_fingerprint(
            output["ownerId"],
            output["backupNonce"],
            str(output["t"]),
            output["guardianIds"],
            output["publicPoints"],
        )
        self.demo_store.bind_backup(fingerprint, f"draft:{draft['draftId']}", draft["draftId"])
        return output

    def prepare_backup(self, req: BackupPrepareRequest) -> Dict[str, Any]:
        owner_address = req.ownerAddress.strip()
        guardian_ids = sorted({_to_int(x, "guardianIds") for x in req.guardianIds})
        if not guardian_ids:
            raise HTTPException(status_code=400, detail="guardianIds cannot be empty")

        threshold_required = _to_int(req.threshold, "threshold")
        if threshold_required < 1 or threshold_required > len(guardian_ids):
            raise HTTPException(
                status_code=400,
                detail=f"threshold must be in [1, {len(guardian_ids)}]",
            )

        if req.backupDraftId:
            draft = self.demo_store.get_draft(req.backupDraftId)
            if not draft:
                raise HTTPException(status_code=404, detail="backupDraftId not found or expired")

            signatures_map = self.demo_store.get_signatures(req.backupDraftId)
            if req.setupSignatures:
                for item in req.setupSignatures:
                    signatures_map[str(_to_int(item.guardianId, "guardianId"))] = item.signature
                    self.demo_store.set_signature(req.backupDraftId, str(_to_int(item.guardianId, "guardianId")), item.signature)

            missing = [str(gid) for gid in draft["guardianIds"] if str(gid) not in signatures_map]
            if missing:
                return {
                    "status": "awaiting_guardian_signatures",
                    "backupDraftId": req.backupDraftId,
                    "missingGuardianIds": missing,
                    "digests": [
                        {
                            "guardianId": str(gid),
                            "digest": draft["digests"][str(gid)],
                            "submitted": str(gid) in signatures_map,
                        }
                        for gid in draft["guardianIds"]
                    ],
                }

            return self._finalize_prepare(draft, signatures_map)

        owner_id = self.contract.party_id_of_signer(owner_address)
        if owner_id == 0:
            raise HTTPException(status_code=400, detail="Owner wallet is not registered on-chain")

        backup_nonce = _to_int(req.backupNonce or int(time.time() * 1000), "backupNonce")
        if backup_nonce == 0:
            raise HTTPException(status_code=400, detail="backupNonce must be non-zero")
        backup_nonce = backup_nonce % (2**64)
        if backup_nonce == 0:
            backup_nonce = 1

        secret_scalar = _to_int(req.secretScalar, "secretScalar") % FIELD_MODULUS
        t = threshold_required - 1

        digests: Dict[str, str] = {}
        for gid in guardian_ids:
            digests[str(gid)] = self.contract.sigma_message_digest(owner_id, gid, backup_nonce)

        draft_payload = {
            "ownerAddress": owner_address,
            "ownerId": owner_id,
            "guardianIds": guardian_ids,
            "thresholdRequired": threshold_required,
            "t": t,
            "backupNonce": backup_nonce,
            "secretScalar": str(secret_scalar),
            "mode": req.mode,
            "digests": digests,
        }

        draft_id = self.demo_store.create_draft(draft_payload)
        draft = self.demo_store.get_draft(draft_id)
        assert draft is not None

        signatures_map: Dict[str, str] = {}

        if req.setupSignatures:
            for item in req.setupSignatures:
                gid = str(_to_int(item.guardianId, "guardianId"))
                signatures_map[gid] = item.signature
                self.demo_store.set_signature(draft_id, gid, item.signature)

        if req.mode == "demo":
            for gid in guardian_ids:
                if str(gid) in signatures_map:
                    continue
                private_key = self.wallets.get_guardian_private_key_by_id(gid)
                if not private_key:
                    raise HTTPException(status_code=400, detail=f"No burner private key found for guardian {gid}")
                sign_result = self.bridge.run_json_script(
                    SCRIPTS_DIR / "guardian_sign.js",
                    {
                        "CONTRACT_ADDRESS": env_value("CONTRACT_ADDRESS", DEFAULT_CONTRACT_ADDRESS) or DEFAULT_CONTRACT_ADDRESS,
                        "CHAIN_ID": env_value("CHAIN_ID", "") or "",
                        "OWNER_ID": str(owner_id),
                        "BACKUP_NONCE": str(backup_nonce),
                        "GUARDIAN_ID": str(gid),
                        "GUARDIAN_PRIVATE_KEY": private_key,
                    },
                )
                signatures_map[str(gid)] = str(sign_result["signature"])
                self.demo_store.set_signature(draft_id, str(gid), str(sign_result["signature"]))
                self.demo_store.complete_setup_task(draft_id, str(gid))

            return self._finalize_prepare(draft, signatures_map)

        missing = [str(gid) for gid in guardian_ids if str(gid) not in signatures_map]
        for gid in missing:
            self.demo_store.add_setup_task(
                gid,
                {
                    "purpose": "backup_setup",
                    "backupDraftId": draft_id,
                    "ownerAddress": owner_address,
                    "ownerId": str(owner_id),
                    "guardianId": gid,
                    "digest": digests[gid],
                    "backupNonce": str(backup_nonce),
                },
            )

        if missing:
            return {
                "status": "awaiting_guardian_signatures",
                "backupDraftId": draft_id,
                "ownerId": str(owner_id),
                "guardianIds": [str(x) for x in guardian_ids],
                "thresholdRequired": threshold_required,
                "t": t,
                "backupNonce": str(backup_nonce),
                "digests": [
                    {
                        "guardianId": str(gid),
                        "digest": digests[str(gid)],
                        "submitted": str(gid) in signatures_map,
                    }
                    for gid in guardian_ids
                ],
            }

        return self._finalize_prepare(draft, signatures_map)


backup_service = BackupService(contract_service, script_bridge, demo_wallet_service, store)


class GuardianService:
    def __init__(self, contract: ContractService, bridge: ScriptBridge, wallets: DemoWalletService, demo_store: DemoStore) -> None:
        self.contract = contract
        self.bridge = bridge
        self.wallets = wallets
        self.demo_store = demo_store

    def sign(self, req: GuardianSignRequest) -> Dict[str, Any]:
        guardian_id = _to_int(req.guardianId, "guardianId")

        if req.purpose == "backup_setup":
            if not req.backupDraftId:
                raise HTTPException(status_code=400, detail="backupDraftId is required for backup_setup")

            draft = self.demo_store.get_draft(req.backupDraftId)
            if not draft:
                raise HTTPException(status_code=404, detail="backupDraftId not found or expired")

            if guardian_id not in [int(x) for x in draft["guardianIds"]]:
                raise HTTPException(status_code=400, detail="guardianId is not part of the draft")

            digest = draft["digests"].get(str(guardian_id))
            if not digest:
                raise HTTPException(status_code=500, detail="Missing draft digest")

            signature = req.signature
            sigma: Optional[str] = None

            if req.mode == "demo":
                private_key = self.wallets.get_guardian_private_key_by_id(guardian_id)
                if not private_key:
                    raise HTTPException(status_code=400, detail=f"No burner key for guardian {guardian_id}")
                sign_result = self.bridge.run_json_script(
                    SCRIPTS_DIR / "guardian_sign.js",
                    {
                        "CONTRACT_ADDRESS": env_value("CONTRACT_ADDRESS", DEFAULT_CONTRACT_ADDRESS) or DEFAULT_CONTRACT_ADDRESS,
                        "CHAIN_ID": env_value("CHAIN_ID", "") or "",
                        "OWNER_ID": str(draft["ownerId"]),
                        "BACKUP_NONCE": str(draft["backupNonce"]),
                        "GUARDIAN_ID": str(guardian_id),
                        "GUARDIAN_PRIVATE_KEY": private_key,
                    },
                )
                signature = str(sign_result["signature"])
                sigma = str(sign_result["sigma"])
            else:
                if not signature:
                    return {
                        "digest": digest,
                        "submitted": False,
                        "requiresSignature": True,
                    }
                sigma = self.contract.derive_sigma_from_signature(signature)

            self.demo_store.set_signature(req.backupDraftId, str(guardian_id), signature)
            self.demo_store.complete_setup_task(req.backupDraftId, str(guardian_id))

            current = self.demo_store.get_signatures(req.backupDraftId)
            total = len(draft["guardianIds"])
            return {
                "purpose": "backup_setup",
                "backupDraftId": req.backupDraftId,
                "guardianId": str(guardian_id),
                "digest": digest,
                "signature": signature,
                "sigma": sigma,
                "submitted": True,
                "collected": len(current),
                "required": total,
            }

        if not req.sessionId:
            raise HTTPException(status_code=400, detail="sessionId is required for recovery_session")

        session_id = _to_int(req.sessionId, "sessionId")
        session = self.contract.get_session(session_id)
        if not session.get("exists"):
            raise HTTPException(status_code=404, detail="Session not found")

        backup = self.contract.get_backup(int(session["backupId"]))
        guardian_ids = [int(x) for x in backup["guardianIds"]]
        if guardian_id not in guardian_ids:
            raise HTTPException(status_code=400, detail="guardianId is not allowed in this backup")

        digest = self.contract.sigma_message_digest(
            int(backup["ownerId"]),
            guardian_id,
            int(backup["backupNonce"]),
        )

        if req.mode == "real":
            if not req.signature:
                return {
                    "purpose": "recovery_session",
                    "sessionId": str(session_id),
                    "guardianId": str(guardian_id),
                    "digest": digest,
                    "submitted": False,
                    "requiresSignature": True,
                }
            sigma = self.contract.derive_sigma_from_signature(req.signature)
            return {
                "purpose": "recovery_session",
                "sessionId": str(session_id),
                "guardianId": str(guardian_id),
                "digest": digest,
                "signature": req.signature,
                "sigma": sigma,
                "submitted": False,
            }

        private_key = self.wallets.get_guardian_private_key_by_id(guardian_id)
        if not private_key:
            raise HTTPException(status_code=400, detail=f"No burner key for guardian {guardian_id}")

        sign_result = self.bridge.run_json_script(
            SCRIPTS_DIR / "guardian_sign.js",
            {
                "CONTRACT_ADDRESS": env_value("CONTRACT_ADDRESS", DEFAULT_CONTRACT_ADDRESS) or DEFAULT_CONTRACT_ADDRESS,
                "CHAIN_ID": env_value("CHAIN_ID", "") or "",
                "OWNER_ID": str(backup["ownerId"]),
                "BACKUP_NONCE": str(backup["backupNonce"]),
                "GUARDIAN_ID": str(guardian_id),
                "GUARDIAN_PRIVATE_KEY": private_key,
            },
        )
        signature = str(sign_result["signature"])
        sigma = str(sign_result["sigma"])

        tx_hash: Optional[str] = None
        submitted = False
        if req.submitOnchain:
            tx_result = self.contract.submit_deterministic_signature(session_id, signature, private_key)
            tx_hash = tx_result.get("txHash")
            submitted = bool(tx_result.get("submitted", False))

        return {
            "purpose": "recovery_session",
            "sessionId": str(session_id),
            "guardianId": str(guardian_id),
            "digest": digest,
            "signature": signature,
            "sigma": sigma,
            "txHash": tx_hash,
            "submitted": submitted,
        }


guardian_service = GuardianService(contract_service, script_bridge, demo_wallet_service, store)


class RecoveryService:
    def __init__(self, contract: ContractService, bridge: ScriptBridge, demo_store: DemoStore) -> None:
        self.contract = contract
        self.bridge = bridge
        self.demo_store = demo_store

    def get_backup_view(self, backup_id: int) -> Dict[str, Any]:
        backup = self.contract.get_backup(backup_id)
        guardian_ids = [str(x) for x in backup["guardianIds"]]
        public_points = [str(x) for x in backup["publicPoints"]]

        fingerprint = _backup_fingerprint(
            str(backup["ownerId"]),
            str(backup["backupNonce"]),
            str(backup["t"]),
            guardian_ids,
            public_points,
        )
        draft = self.demo_store.lookup_draft_by_fingerprint(fingerprint)
        if draft:
            self.demo_store.bind_backup(fingerprint, str(backup_id), draft["draftId"])

        original_secret = self.demo_store.get_original_secret(str(backup_id))
        if not original_secret and draft:
            original_secret = str(draft.get("secretScalar"))

        return {
            "backupId": str(backup_id),
            **backup,
            "guardianIds": guardian_ids,
            "publicPoints": public_points,
            "metadata": {
                "hasDraft": draft is not None,
                "backupDraftId": draft.get("draftId") if draft else None,
                "mode": draft.get("mode") if draft else None,
                "originalSecretKnown": original_secret is not None,
            },
        }

    def open_prepare(self, backup_id: int) -> Dict[str, Any]:
        backup = self.get_backup_view(backup_id)
        expected_shares = int(backup["t"]) + 1
        return {
            "backupSnapshot": backup,
            "expectedShares": expected_shares,
            "guardianIds": backup["guardianIds"],
        }

    def get_recovery_view(self, session_id: int) -> Dict[str, Any]:
        session = self.contract.get_session(session_id)
        if not session.get("exists"):
            raise HTTPException(status_code=404, detail="Session not found")

        backup = self.contract.get_backup(int(session["backupId"]))
        guardian_ids = [int(x) for x in backup["guardianIds"]]
        data = self.contract.get_session_guardian_data(session_id, guardian_ids)

        submitted_map: Dict[str, bool] = {}
        sigma_map: Dict[str, str] = {}
        submitted_list = data.get("submitted", [])
        sigma_list = data.get("sigmas", [])
        for idx, gid in enumerate(guardian_ids):
            submitted = bool(submitted_list[idx]) if idx < len(submitted_list) else False
            sigma = str(sigma_list[idx]) if idx < len(sigma_list) else "0"
            submitted_map[str(gid)] = submitted
            sigma_map[str(gid)] = sigma

        return {
            "sessionId": str(session_id),
            "backupId": str(session["backupId"]),
            "ownerId": str(session["ownerId"]),
            "sharesNeeded": int(session["sharesNeeded"]),
            "sharesReceived": int(session["sharesReceived"]),
            "ready": bool(session["ready"]),
            "closed": bool(session["closed"]),
            "guardianIds": [str(x) for x in guardian_ids],
            "submittedByGuardian": submitted_map,
            "sigmasByGuardian": sigma_map,
        }

    def reconstruct(self, backup_id: int, session_id: int, guardian_ids: List[int]) -> Dict[str, Any]:
        result = self.bridge.run_json_script(
            SCRIPTS_DIR / "recover_secret.js",
            {
                "RPC_URL": env_value("RPC_URL", "") or "",
                "CONTRACT_ADDRESS": env_value("CONTRACT_ADDRESS", DEFAULT_CONTRACT_ADDRESS) or DEFAULT_CONTRACT_ADDRESS,
                "BACKUP_ID": str(backup_id),
                "SESSION_ID": str(session_id),
                "RECOVERY_GUARDIAN_IDS": ",".join(str(x) for x in guardian_ids),
            },
        )

        recovered = str(result.get("recoveredSecretScalar"))
        original = self.demo_store.get_original_secret(str(backup_id))
        if not original:
            draft = self.demo_store.get_draft_by_backup_id(str(backup_id))
            if draft and draft.get("secretScalar"):
                original = str(draft["secretScalar"])

        if original:
            self.demo_store.remember_original_secret(str(backup_id), original)

        return {
            "backupId": str(backup_id),
            "sessionId": str(session_id),
            "guardianIds": [str(x) for x in guardian_ids],
            "originalSecret": original,
            "recoveredSecret": recovered,
            "match": bool(original is not None and str(original) == str(recovered)),
            "interpolationMeta": {
                "field": str(FIELD_MODULUS),
                "usedGuardianCount": len(guardian_ids),
                "source": "recover_secret.js",
            },
        }

    def dashboard_state(self) -> Dict[str, Any]:
        ids = self.contract.next_ids()

        backups: List[Dict[str, Any]] = []
        sessions: List[Dict[str, Any]] = []

        for backup_id in range(1, ids["nextBackupId"]):
            try:
                b = self.contract.get_backup(backup_id)
                backups.append(
                    {
                        "backupId": str(backup_id),
                        "ownerId": str(b["ownerId"]),
                        "t": int(b["t"]),
                        "guardianCount": int(b["guardianCount"]),
                        "active": bool(b["active"]),
                    }
                )
            except Exception:
                continue

        for session_id in range(1, ids["nextSessionId"]):
            try:
                s = self.contract.get_session(session_id)
                if not s.get("exists"):
                    continue
                sessions.append(
                    {
                        "sessionId": str(session_id),
                        "backupId": str(s["backupId"]),
                        "sharesNeeded": int(s["sharesNeeded"]),
                        "sharesReceived": int(s["sharesReceived"]),
                        "ready": bool(s["ready"]),
                        "closed": bool(s["closed"]),
                    }
                )
            except Exception:
                continue

        ready_sessions = [x for x in sessions if x["ready"]]

        return {
            "counts": {
                "backups": len(backups),
                "sessions": len(sessions),
                "readySessions": len(ready_sessions),
            },
            "backups": backups,
            "sessions": sessions,
        }

    def owner_sessions(self, owner_address: str) -> Dict[str, Any]:
        owner_id = self.contract.party_id_of_signer(owner_address)
        if owner_id == 0:
            return {"ownerId": None, "sessions": []}

        ids = self.contract.next_ids()
        sessions: List[Dict[str, Any]] = []
        for session_id in range(1, ids["nextSessionId"]):
            try:
                session = self.contract.get_session(session_id)
                if not session.get("exists"):
                    continue
                if int(session["ownerId"]) != owner_id:
                    continue

                sessions.append(
                    {
                        "sessionId": str(session_id),
                        "backupId": str(session["backupId"]),
                        "ownerId": str(session["ownerId"]),
                        "sharesNeeded": int(session["sharesNeeded"]),
                        "sharesReceived": int(session["sharesReceived"]),
                        "ready": bool(session["ready"]),
                        "closed": bool(session["closed"]),
                    }
                )
            except Exception:
                continue

        sessions.sort(key=lambda x: int(x["sessionId"]), reverse=True)
        return {"ownerId": str(owner_id), "sessions": sessions}

    def guardian_tasks(self, guardian_id: int) -> List[Dict[str, Any]]:
        tasks = [task for task in self.demo_store.get_setup_tasks(str(guardian_id))]

        ids = self.contract.next_ids()
        for session_id in range(1, ids["nextSessionId"]):
            try:
                session = self.contract.get_session(session_id)
                if not session.get("exists") or session.get("closed"):
                    continue

                backup = self.contract.get_backup(int(session["backupId"]))
                backup_guardian_ids = [int(x) for x in backup["guardianIds"]]
                if guardian_id not in backup_guardian_ids:
                    continue

                data = self.contract.get_session_guardian_data(session_id, [guardian_id])
                submitted = bool(data.get("submitted", [False])[0])
                if submitted:
                    continue

                digest = self.contract.sigma_message_digest(
                    int(backup["ownerId"]),
                    guardian_id,
                    int(backup["backupNonce"]),
                )

                tasks.append(
                    {
                        "purpose": "recovery_session",
                        "status": "pending",
                        "sessionId": str(session_id),
                        "backupId": str(session["backupId"]),
                        "guardianId": str(guardian_id),
                        "digest": digest,
                        "sharesNeeded": int(session["sharesNeeded"]),
                        "sharesReceived": int(session["sharesReceived"]),
                    }
                )
            except Exception:
                continue

        return tasks


recovery_service = RecoveryService(contract_service, script_bridge, store)


# ============================================================================
# FastAPI app
# ============================================================================


app = FastAPI(title="ANARKey Demo Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "service": "anarkey-demo-backend"}


@app.get("/users")
def users() -> Dict[str, Any]:
    community_rows = community_service.list_members()
    if community_rows:
        return {
            "users": [
                {
                    "username": row["username"],
                    "party_id": int(row["partyId"]),
                    "role": "member",
                    "online": bool(row["online"]),
                    "address": row["address"],
                }
                for row in community_rows
            ]
        }

    # Backward-compatible fallback for local demo burners.
    out: List[Dict[str, Any]] = []
    for burner in demo_wallet_service.list_burners():
        party_id: Optional[int] = None
        try:
            party_id = contract_service.party_id_of_signer(str(burner["address"]))
        except Exception:
            party_id = None

        role = "guardian" if "guardian" in burner["label"] else "owner"
        out.append(
            {
                "username": burner["label"],
                "party_id": party_id,
                "role": role,
                "online": False,
                "address": burner["address"],
            }
        )

    return {"users": out}


@app.post("/api/community/join")
def community_join(req: CommunityJoinRequest) -> Dict[str, Any]:
    try:
        return community_service.join(req.username, req.address)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/community/heartbeat")
def community_heartbeat(req: CommunityHeartbeatRequest) -> Dict[str, Any]:
    try:
        return community_service.heartbeat(req.address)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/community/members")
def community_members() -> Dict[str, Any]:
    try:
        return {"members": community_service.list_members()}
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/party/register/prepare")
def party_register_prepare(req: PartyRegisterPrepareRequest) -> Dict[str, Any]:
    try:
        prep = contract_service.pk_commitment_address_v1(req.address)
        party_id = contract_service.party_id_of_signer(req.address)
        return {
            "address": req.address,
            "pkCommitment": prep["pkCommitment"],
            "strategy": "address_v1",
            "alreadyRegistered": party_id != 0,
            "partyId": str(party_id),
            "chainId": prep["chainId"],
        }
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/backup/prepare")
def backup_prepare(req: BackupPrepareRequest) -> Dict[str, Any]:
    try:
        return backup_service.prepare_backup(req)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/recovery/open/prepare")
def recovery_open_prepare(req: RecoveryOpenPrepareRequest) -> Dict[str, Any]:
    backup_id = _to_int(req.backupId, "backupId")
    try:
        return recovery_service.open_prepare(backup_id)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/guardian/sign")
def guardian_sign(req: GuardianSignRequest) -> Dict[str, Any]:
    try:
        return guardian_service.sign(req)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/recovery/reconstruct")
def recovery_reconstruct(req: RecoveryReconstructRequest) -> Dict[str, Any]:
    backup_id = _to_int(req.backupId, "backupId")
    session_id = _to_int(req.sessionId, "sessionId")
    guardian_ids = [_to_int(x, "guardianIds") for x in req.guardianIds]

    try:
        return recovery_service.reconstruct(backup_id, session_id, guardian_ids)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/backups/{backup_id}")
def get_backup(backup_id: str) -> Dict[str, Any]:
    bid = _to_int(backup_id, "backupId")
    try:
        return recovery_service.get_backup_view(bid)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/recovery/{session_id}")
def get_recovery(session_id: str) -> Dict[str, Any]:
    sid = _to_int(session_id, "sessionId")
    try:
        return recovery_service.get_recovery_view(sid)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/guardian/tasks")
def get_guardian_tasks(
    guardianId: Optional[str] = Query(default=None),
    guardianAddress: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    gid: Optional[int] = None

    if guardianId:
        gid = _to_int(guardianId, "guardianId")
    elif guardianAddress:
        try:
            gid = contract_service.party_id_of_signer(guardianAddress)
        except Exception:
            gid = None

    if not gid:
        return {"guardianId": None, "tasks": []}

    try:
        tasks = recovery_service.guardian_tasks(gid)
        return {"guardianId": str(gid), "tasks": tasks}
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/dashboard/state")
def dashboard_state() -> Dict[str, Any]:
    try:
        return recovery_service.dashboard_state()
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/owner/sessions")
def owner_sessions(ownerAddress: Optional[str] = Query(default=None)) -> Dict[str, Any]:
    if not ownerAddress:
        return {"ownerId": None, "sessions": []}
    try:
        return recovery_service.owner_sessions(ownerAddress)
    except ServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/demo/admin/config")
def demo_admin_config() -> Dict[str, Any]:
    burners = demo_wallet_service.list_burners()
    out_burners: List[Dict[str, Any]] = []

    for burner in burners:
        party_id: Optional[int] = None
        try:
            party_id = contract_service.party_id_of_signer(str(burner["address"]))
        except Exception:
            party_id = None

        out_burners.append(
            {
                "label": burner["label"],
                "address": burner["address"],
                "partyId": str(party_id) if party_id is not None else None,
            }
        )

    return {
        "network": {
            "rpcUrlConfigured": bool(env_value("RPC_URL", "")),
            "contractAddress": env_value("CONTRACT_ADDRESS", DEFAULT_CONTRACT_ADDRESS),
            "chainId": env_value("CHAIN_ID", ""),
        },
        "burners": out_burners,
        "expected": {
            "ownerId": env_value("OWNER_ID", ""),
            "guardianIds": env_value("GUARDIAN_IDS", ""),
            "thresholdT": env_value("THRESHOLD", ""),
            "secretDemo": env_value("SECRET_SCALAR", ""),
        },
    }
