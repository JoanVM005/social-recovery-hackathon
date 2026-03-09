require("dotenv").config();
const { ethers } = require("ethers");

const abi = ethers.AbiCoder.defaultAbiCoder();
const SIGMA_DOMAIN_TAG = ethers.keccak256(ethers.toUtf8Bytes("ANARKEY_SIGMA_V1"));
const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function sigmaDigest(contractAddress, chainId, ownerId, guardianId, backupNonce) {
  return ethers.keccak256(
    abi.encode(
      ["bytes32", "address", "uint256", "uint256", "uint256", "uint64"],
      [SIGMA_DOMAIN_TAG, contractAddress, chainId, ownerId, guardianId, backupNonce]
    )
  );
}

function hashToField(hexBytes) {
  const h = ethers.keccak256(hexBytes);
  let x = BigInt(h) % FIELD;
  return x === 0n ? 1n : x;
}

function requireEnv(name) {
  const val = process.env[name];
  if (val === undefined || val.trim() === "") {
    throw new Error(`Missing required env variable: ${name}`);
  }
  return val.trim();
}

async function main() {
  const contractAddress = requireEnv("CONTRACT_ADDRESS");
  const chainId = BigInt(requireEnv("CHAIN_ID"));
  const ownerId = BigInt(requireEnv("OWNER_ID"));
  const backupNonce = BigInt(requireEnv("BACKUP_NONCE"));

  // Soporta tanto GUARDIAN_ID/GUARDIAN_PRIVATE_KEY (singular)
  // como GUARDIAN_IDS/GUARDIAN_PRIVATE_KEYS (listas separadas por coma)
  let guardianIds, guardianPrivateKeys;

  if (process.env.GUARDIAN_IDS && process.env.GUARDIAN_PRIVATE_KEYS) {
    guardianIds = process.env.GUARDIAN_IDS.split(",").map((x) => BigInt(x.trim()));
    guardianPrivateKeys = process.env.GUARDIAN_PRIVATE_KEYS.split(",").map((x) => x.trim());
  } else if (process.env.GUARDIAN_ID && process.env.GUARDIAN_PRIVATE_KEY) {
    guardianIds = [BigInt(process.env.GUARDIAN_ID.trim())];
    guardianPrivateKeys = [process.env.GUARDIAN_PRIVATE_KEY.trim()];
  } else {
    throw new Error(
      "Missing guardian config. Set either GUARDIAN_IDS + GUARDIAN_PRIVATE_KEYS (comma-separated lists) or GUARDIAN_ID + GUARDIAN_PRIVATE_KEY in your .env"
    );
  }

  if (guardianIds.length !== guardianPrivateKeys.length) {
    throw new Error("GUARDIAN_IDS and GUARDIAN_PRIVATE_KEYS must have the same number of entries");
  }

  const results = [];

  for (let i = 0; i < guardianIds.length; i++) {
    const guardianId = guardianIds[i];
    const guardianPrivateKey = guardianPrivateKeys[i];

    const wallet = new ethers.Wallet(guardianPrivateKey);
    const digest = sigmaDigest(contractAddress, chainId, ownerId, guardianId, backupNonce);
    const sigObj = wallet.signingKey.sign(digest);
    const signature = ethers.Signature.from(sigObj).serialized;
    const sigma = hashToField(signature);

    results.push({
      guardianAddress: wallet.address,
      guardianId: guardianId.toString(),
      digest,
      signature,
      sigma: sigma.toString()
    });
  }

  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});