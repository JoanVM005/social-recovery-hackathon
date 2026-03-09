require("dotenv").config();
const { ethers } = require("ethers");

const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const CONTRACT_ABI = [
  "function getBackup(uint256 backupId) view returns (uint256 ownerId, uint64 backupNonce, uint16 t, uint16 guardianCount, bytes32 ownerPkCommitment, uint256[] guardianIds, uint256[] publicPoints, bytes32 publicPointsHash, bool active)",
  "function getSessionGuardianData(uint256 sessionId, uint256[] guardianIds) view returns (bool[] submitted, uint256[] sigmas)"
];

function mod(a) {
  let x = a % FIELD;
  if (x < 0n) x += FIELD;
  return x;
}

function add(a, b) {
  return mod(a + b);
}

function sub(a, b) {
  return mod(a - b);
}

function mul(a, b) {
  return mod(a * b);
}

function pow(base, exp) {
  let result = 1n;
  let b = mod(base);
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = mul(result, b);
    b = mul(b, b);
    e >>= 1n;
  }
  return result;
}

function inv(a) {
  return pow(a, FIELD - 2n);
}

function lagrangeAtZero(xs, ys) {
  let result = 0n;
  for (let i = 0; i < xs.length; i++) {
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < xs.length; j++) {
      if (i === j) continue;
      num = mul(num, mod(-xs[j]));
      den = mul(den, sub(xs[i], xs[j]));
    }
    const lambda = mul(num, inv(den));
    result = add(result, mul(ys[i], lambda));
  }
  return result;
}

function requireEnv(name) {
  const val = process.env[name];
  if (val === undefined || val.trim() === "") {
    throw new Error(`Missing required env variable: ${name}\n  → Edit your .env file and set a value for ${name}`);
  }
  return val.trim();
}

async function main() {
  const backupId = requireEnv("BACKUP_ID");
  const sessionId = requireEnv("SESSION_ID");
  const recoveryGuardianIds = requireEnv("RECOVERY_GUARDIAN_IDS")
    .split(",")
    .map((x) => BigInt(x.trim()));

  let publicPoints, sigmas;

  const rpcUrl = process.env.RPC_URL;
  const offlinePublicPoints = process.env.PUBLIC_POINTS;
  const offlineSigmas = process.env.SIGMAS;

  const useOffline = !rpcUrl && (offlinePublicPoints || offlineSigmas);
  const useOnchain = !!rpcUrl;

  if (!useOffline && !useOnchain) {
    throw new Error(
      "No data source configured. Either:\n" +
      "  → Set RPC_URL for onchain mode, or\n" +
      "  → Set PUBLIC_POINTS and SIGMAS for offline mode"
    );
  }

  if (useOnchain) {
    // ── Modo onchain: consulta el contrato desplegado ──────────────────────
    console.error("[recover] Using onchain mode via RPC_URL");
    const contractAddress = requireEnv("CONTRACT_ADDRESS");
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, provider);

    const backup = await contract.getBackup(BigInt(backupId));
    publicPoints = backup.publicPoints.map((x) => BigInt(x.toString()));

    const sessionData = await contract.getSessionGuardianData(
      BigInt(sessionId),
      recoveryGuardianIds
    );
    const submitted = sessionData[0];
    sigmas = sessionData[1].map((x) => BigInt(x.toString()));

    for (let i = 0; i < submitted.length; i++) {
      if (!submitted[i]) {
        throw new Error(`Guardian ${recoveryGuardianIds[i].toString()} has not submitted sigma`);
      }
    }
  } else {
    // ── Modo offline: datos provistos directamente en .env ─────────────────
    console.error("[recover] Using offline mode (PUBLIC_POINTS + SIGMAS from .env)");
    publicPoints = requireEnv("PUBLIC_POINTS")
      .split(",")
      .map((x) => BigInt(x.trim()));
    sigmas = requireEnv("SIGMAS")
      .split(",")
      .map((x) => BigInt(x.trim()));

    if (sigmas.length !== recoveryGuardianIds.length) {
      throw new Error(
        `SIGMAS has ${sigmas.length} entries but RECOVERY_GUARDIAN_IDS has ${recoveryGuardianIds.length}. They must match.`
      );
    }
  }

  const xs = [];
  const ys = [];

  for (let i = 0; i < publicPoints.length; i++) {
    xs.push(mod(-BigInt(i + 1))); // -1, -2, ...
    ys.push(publicPoints[i]);
  }

  for (let i = 0; i < recoveryGuardianIds.length; i++) {
    xs.push(mod(recoveryGuardianIds[i]));
    ys.push(mod(sigmas[i]));
  }

  const recovered = lagrangeAtZero(xs, ys);

  console.log(
    JSON.stringify(
      {
        backupId: backupId.toString(),
        sessionId: sessionId.toString(),
        guardianIds: recoveryGuardianIds.map(String),
        recoveredSecretScalar: recovered.toString()
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});