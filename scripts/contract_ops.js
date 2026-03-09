require("dotenv").config();
const { ethers } = require("ethers");

const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const ABI = [
  "function partyIdOfSigner(address) view returns (uint256)",
  "function parties(uint256) view returns (bool registered, address signer, bytes32 pkCommitment)",
  "function getBackup(uint256 backupId) view returns (uint256 ownerId, uint64 backupNonce, uint16 t, uint16 guardianCount, bytes32 ownerPkCommitment, uint256[] guardianIds, uint256[] publicPoints, bytes32 publicPointsHash, bool active)",
  "function sessions(uint256) view returns (bool exists, uint256 sessionId, uint256 backupId, uint256 ownerId, uint16 sharesNeeded, uint16 sharesReceived, bool ready, bool closed)",
  "function getSessionGuardianData(uint256 sessionId, uint256[] guardianIds) view returns (bool[] submitted, uint256[] sigmas)",
  "function sigmaMessageDigest(uint256 ownerId, uint256 guardianId, uint64 backupNonce) view returns (bytes32)",
  "function deriveSigmaFromSignature(bytes signature) pure returns (uint256)",
  "function submitDeterministicSignature(uint256 sessionId, bytes signature)",
  "function registerParty(bytes32 pkCommitment) returns (uint256)",
  "function nextPartyId() view returns (uint256)",
  "function nextBackupId() view returns (uint256)",
  "function nextSessionId() view returns (uint256)",
];

function requireEnv(name) {
  const val = process.env[name];
  if (val === undefined || val.trim() === "") {
    throw new Error(`Missing env var: ${name}`);
  }
  return val.trim();
}

function optionalEnv(name) {
  const val = process.env[name];
  if (val === undefined || val.trim() === "") return null;
  return val.trim();
}

function toStringArray(xs) {
  return xs.map((x) => x.toString());
}

function baseProviderAndContract() {
  const rpcUrl = requireEnv("RPC_URL");
  const contractAddress = requireEnv("CONTRACT_ADDRESS");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, ABI, provider);
  return { provider, contract, contractAddress };
}

function hashToField(signatureHex) {
  const h = ethers.keccak256(signatureHex);
  let x = BigInt(h) % FIELD;
  return x === 0n ? 1n : x;
}

async function main() {
  const action = requireEnv("ACTION");

  if (action === "pk_commitment_address_v1") {
    const address = requireEnv("ADDRESS");
    const chainIdEnv = optionalEnv("CHAIN_ID");

    let chainId;
    if (chainIdEnv) {
      chainId = BigInt(chainIdEnv);
    } else {
      const { provider } = baseProviderAndContract();
      const network = await provider.getNetwork();
      chainId = BigInt(network.chainId.toString());
    }

    const pkCommitment = ethers.keccak256(
      ethers.solidityPacked(
        ["string", "uint256", "address"],
        ["ANARKEY_PK_COMMIT_V1", chainId, address]
      )
    );

    console.log(
      JSON.stringify(
        {
          pkCommitment,
          chainId: chainId.toString(),
        },
        null,
        2
      )
    );
    return;
  }

  if (action === "derive_sigma_from_signature") {
    const signature = requireEnv("SIGNATURE");
    const sigma = hashToField(signature);
    console.log(JSON.stringify({ sigma: sigma.toString() }, null, 2));
    return;
  }

  const { contract, provider, contractAddress } = baseProviderAndContract();

  if (action === "party_id_of_signer") {
    const address = requireEnv("ADDRESS");
    const partyId = await contract.partyIdOfSigner(address);
    console.log(JSON.stringify({ partyId: partyId.toString() }, null, 2));
    return;
  }

  if (action === "party_by_id") {
    const partyId = BigInt(requireEnv("PARTY_ID"));
    const row = await contract.parties(partyId);
    console.log(
      JSON.stringify(
        {
          partyId: partyId.toString(),
          registered: !!row.registered,
          signer: row.signer,
          pkCommitment: row.pkCommitment,
        },
        null,
        2
      )
    );
    return;
  }

  if (action === "get_backup") {
    const backupId = BigInt(requireEnv("BACKUP_ID"));
    const row = await contract.getBackup(backupId);

    console.log(
      JSON.stringify(
        {
          backupId: backupId.toString(),
          ownerId: row.ownerId.toString(),
          backupNonce: row.backupNonce.toString(),
          t: row.t.toString(),
          guardianCount: row.guardianCount.toString(),
          ownerPkCommitment: row.ownerPkCommitment,
          guardianIds: toStringArray(row.guardianIds),
          publicPoints: toStringArray(row.publicPoints),
          publicPointsHash: row.publicPointsHash,
          active: !!row.active,
        },
        null,
        2
      )
    );
    return;
  }

  if (action === "get_session") {
    const sessionId = BigInt(requireEnv("SESSION_ID"));
    const row = await contract.sessions(sessionId);

    console.log(
      JSON.stringify(
        {
          exists: !!row.exists,
          sessionId: row.sessionId.toString(),
          backupId: row.backupId.toString(),
          ownerId: row.ownerId.toString(),
          sharesNeeded: row.sharesNeeded.toString(),
          sharesReceived: row.sharesReceived.toString(),
          ready: !!row.ready,
          closed: !!row.closed,
        },
        null,
        2
      )
    );
    return;
  }

  if (action === "get_session_guardian_data") {
    const sessionId = BigInt(requireEnv("SESSION_ID"));
    const guardianIds = requireEnv("GUARDIAN_IDS")
      .split(",")
      .map((x) => BigInt(x.trim()));

    const row = await contract.getSessionGuardianData(sessionId, guardianIds);
    console.log(
      JSON.stringify(
        {
          submitted: row.submitted,
          sigmas: toStringArray(row.sigmas),
        },
        null,
        2
      )
    );
    return;
  }

  if (action === "sigma_message_digest") {
    const ownerId = BigInt(requireEnv("OWNER_ID"));
    const guardianId = BigInt(requireEnv("GUARDIAN_ID"));
    const backupNonce = BigInt(requireEnv("BACKUP_NONCE"));

    const digest = await contract.sigmaMessageDigest(ownerId, guardianId, backupNonce);
    console.log(JSON.stringify({ digest }, null, 2));
    return;
  }

  if (action === "submit_deterministic_signature") {
    const privateKey = requireEnv("PRIVATE_KEY");
    const sessionId = BigInt(requireEnv("SESSION_ID"));
    const signature = requireEnv("SIGNATURE");

    const wallet = new ethers.Wallet(privateKey, provider);
    const write = contract.connect(wallet);
    const tx = await write.submitDeterministicSignature(sessionId, signature);
    const receipt = await tx.wait();

    console.log(
      JSON.stringify(
        {
          submitted: receipt.status === 1,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber ? receipt.blockNumber.toString() : null,
          contractAddress,
        },
        null,
        2
      )
    );
    return;
  }

  if (action === "register_party") {
    const privateKey = requireEnv("PRIVATE_KEY");
    const pkCommitment = requireEnv("PK_COMMITMENT");

    const wallet = new ethers.Wallet(privateKey, provider);
    const write = contract.connect(wallet);
    const tx = await write.registerParty(pkCommitment);
    const receipt = await tx.wait();

    const partyId = await contract.partyIdOfSigner(wallet.address);

    console.log(
      JSON.stringify(
        {
          submitted: receipt.status === 1,
          txHash: tx.hash,
          address: wallet.address,
          partyId: partyId.toString(),
        },
        null,
        2
      )
    );
    return;
  }

  if (action === "next_ids") {
    const nextPartyId = await contract.nextPartyId();
    const nextBackupId = await contract.nextBackupId();
    const nextSessionId = await contract.nextSessionId();
    console.log(
      JSON.stringify(
        {
          nextPartyId: nextPartyId.toString(),
          nextBackupId: nextBackupId.toString(),
          nextSessionId: nextSessionId.toString(),
        },
        null,
        2
      )
    );
    return;
  }

  throw new Error(`Unknown ACTION: ${action}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
