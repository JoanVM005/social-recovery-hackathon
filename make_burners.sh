#!/usr/bin/env bash
set -euo pipefail

OUT_JSON="${1:-wallets.demo.json}"
OUT_ENV="${2:-.env.demo}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js no está instalado"
  exit 1
fi

TMP_SCRIPT="$(mktemp ./anarkey_make_wallets.XXXXXX.js)"
cat > "$TMP_SCRIPT" <<'NODE'
const fs = require("fs");
const { Wallet, keccak256 } = require("ethers");

function mk(name) {
  const w = Wallet.createRandom();
  const pkCommitment = keccak256(w.signingKey.publicKey);
  return {
    name,
    address: w.address,
    privateKey: w.privateKey,
    mnemonic: w.mnemonic.phrase,
    publicKey: w.signingKey.publicKey,
    pkCommitment
  };
}

const wallets = {
  owner: mk("owner"),
  guardian1: mk("guardian1"),
  guardian2: mk("guardian2"),
  guardian3: mk("guardian3")
};

fs.writeFileSync(process.argv[2], JSON.stringify(wallets, null, 2));

const env = [
  `OWNER_ADDRESS=${wallets.owner.address}`,
  `OWNER_PRIVATE_KEY=${wallets.owner.privateKey}`,
  `OWNER_PK_COMMITMENT=${wallets.owner.pkCommitment}`,
  `GUARDIAN1_ADDRESS=${wallets.guardian1.address}`,
  `GUARDIAN1_PRIVATE_KEY=${wallets.guardian1.privateKey}`,
  `GUARDIAN1_PK_COMMITMENT=${wallets.guardian1.pkCommitment}`,
  `GUARDIAN2_ADDRESS=${wallets.guardian2.address}`,
  `GUARDIAN2_PRIVATE_KEY=${wallets.guardian2.privateKey}`,
  `GUARDIAN2_PK_COMMITMENT=${wallets.guardian2.pkCommitment}`,
  `GUARDIAN3_ADDRESS=${wallets.guardian3.address}`,
  `GUARDIAN3_PRIVATE_KEY=${wallets.guardian3.privateKey}`,
  `GUARDIAN3_PK_COMMITMENT=${wallets.guardian3.pkCommitment}`,
  ``,
  `# Completa estos valores para la demo`,
  `RPC_URL=`,
  `CONTRACT_ADDRESS=`,
  `CHAIN_ID=11155111`,
  `OWNER_ID=`,
  `GUARDIAN_IDS=`,
  `GUARDIAN_PRIVATE_KEYS=`,
  `THRESHOLD=1`,
  `BACKUP_NONCE=12345`,
  `SECRET_SCALAR=1234`,
  `BACKUP_ID=`,
  `SESSION_ID=`,
  `RECOVERY_GUARDIAN_IDS=`,
  ``,
  `# Modo offline (rellena con la salida de npm run prepare:backup)`,
  `# PUBLIC_POINTS es el array publicPoints del campo publishBackupArgs`,
  `# SIGMAS es el array de sigma de cada guardian (en el mismo orden que RECOVERY_GUARDIAN_IDS)`,
  `PUBLIC_POINTS=`,
  `SIGMAS=`
].join("\n");

fs.writeFileSync(process.argv[3], env);
console.log(`Generated ${process.argv[2]} and ${process.argv[3]}`);
NODE

node "$TMP_SCRIPT" "$OUT_JSON" "$OUT_ENV"
rm -f "$TMP_SCRIPT"

echo
echo "Archivos creados:"
echo "  - $OUT_JSON"
echo "  - $OUT_ENV"
echo
echo "IMPORTANTE:"
echo "  1. Importa estas wallets en MetaMask SOLO para Sepolia."
echo "  2. Dales ETH de faucet."
echo "  3. No uses estas claves fuera de la demo."