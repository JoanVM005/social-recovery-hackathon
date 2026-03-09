# ANARKey Offchain Board Demo

Steam-like social-recovery demo aligned with ANARKey off-chain model and `ANARKeyOffchainBoard` contract.

## What is implemented

- On-chain bulletin board flow with `registerParty`, `publishBackup`, `openRecovery`, `submitDeterministicSignature`.
- Off-chain backup preparation (`sigma`, `phi`) using `scripts/prepare_backup.js` orchestrated by backend.
- Off-chain reconstruction using `scripts/recover_secret.js` orchestrated by backend.
- Community-aware social recovery:
  - users join a shared community after on-chain registration;
  - guardian selection keeps the "select friends" UX;
  - guardian inbox handles `backup_setup` and `recovery_session` tasks in web.
- Profile dropdown flows (without touching the initial store screen):
  - `Assign Guardians`
  - `Recover Secret Key`
- In-app alerts:
  - guardians get alert when a recovery contribution is needed;
  - owner gets alert when a recovery session reaches the required shares.

## Repo structure

- `contracts/ANARKeyOffchainBoard.sol`: canonical contract for this demo.
- `anarkey.sol`: legacy reference (not used by runtime flow).
- `backend/main.py`: API + services + in-memory demo store.
- `scripts/*.js`: off-chain cryptographic and contract utility scripts.
- `frontend/src/components/recovery/SocialRecoveryModal.tsx`: profile-driven E2E recovery UI.

## Prerequisites

- Node.js + npm
- Python 3.8+
- Sepolia RPC URL
- Deployed `ANARKeyOffchainBoard` contract address

## Environment

Edit `.env.demo` (or real env vars) and set at least:

- `RPC_URL`
- `CONTRACT_ADDRESS`
- `CHAIN_ID` (Sepolia: `11155111`)

Optional demo burners are already scaffolded in `.env.demo` / `wallets.demo.json`.

## Run locally

### 1) Install deps

```bash
npm install
npm --prefix frontend install
pip3 install -r backend/requirements.txt
```

### 2) Start backend

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3) Start frontend

```bash
npm --prefix frontend run dev
```

Open `http://localhost:5173`.

## Owner flow (profile dropdown)

1. Connect MetaMask and enter the Store screen.
2. Open profile dropdown -> `Assign Guardians`.
3. Join community (auto-enforces on-chain `registerParty` first if missing).
4. Select guardian friends + threshold and create backup draft.
5. Wait for guardian setup signatures, then publish backup on Sepolia.
6. Open profile dropdown -> `Recover Secret Key`.
7. Open recovery session on-chain.
8. Wait for guardian contributions and reconstruct secret off-chain in web.

## Guardian flow (profile dropdown)

1. Join community with a registered wallet.
2. Open profile dropdown -> `Recover Secret Key`.
3. In `Guardian Inbox`, approve pending tasks:
   - `backup_setup`: sign digest in MetaMask (off-chain setup contribution).
   - `recovery_session`: sign digest and submit `submitDeterministicSignature` on-chain.

## Recovery flow

1. Read backup + recovery session state from chain.
2. Fetch guardian submission/sigma data.
3. Reconstruct off-chain with Lagrange in backend.
4. Compare `originalSecret` vs `recoveredSecret`.

## API highlights

- `POST /api/community/join`
- `POST /api/community/heartbeat`
- `GET /api/community/members`
- `POST /api/party/register/prepare`
- `POST /api/backup/prepare`
- `POST /api/recovery/open/prepare`
- `POST /api/guardian/sign`
- `POST /api/recovery/reconstruct`
- `GET /api/backups/:id`
- `GET /api/recovery/:sessionId`
- `GET /api/guardian/tasks`
- `GET /api/owner/sessions`
- `GET /api/dashboard/state`
- `GET /api/demo/admin/config`

## Notes

- This version is Sepolia-only by design.
- No manual sigma input is required from users.
- Secret reconstruction stays off-chain; blockchain is coordination/public board only.
