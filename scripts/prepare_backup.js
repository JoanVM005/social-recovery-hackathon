require("dotenv").config();
const { ethers } = require("ethers");

const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const abi = ethers.AbiCoder.defaultAbiCoder();
const SIGMA_DOMAIN_TAG = ethers.keccak256(ethers.toUtf8Bytes("ANARKEY_SIGMA_V1"));

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

function lagrangeEvaluate(xs, ys, xEval) {
  let result = 0n;
  for (let i = 0; i < xs.length; i++) {
    let num = 1n;
    let den = 1n;
    for (let j = 0; j < xs.length; j++) {
      if (i === j) continue;
      num = mul(num, sub(xEval, xs[j]));
      den = mul(den, sub(xs[i], xs[j]));
    }
    const li = mul(num, inv(den));
    result = add(result, mul(ys[i], li));
  }
  return result;
}

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
  let x = BigInt(h);
  x = x % FIELD;
  return x === 0n ? 1n : x;
}

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  const chainId = BigInt(process.env.CHAIN_ID);
  const ownerId = BigInt(process.env.OWNER_ID);
  const backupNonce = BigInt(process.env.BACKUP_NONCE);
  const secretScalar = BigInt(process.env.SECRET_SCALAR);
  const t = Number(process.env.THRESHOLD);

  const guardianIds = process.env.GUARDIAN_IDS.split(",").map((x) => BigInt(x.trim()));
  const guardianPrivateKeys = process.env.GUARDIAN_PRIVATE_KEYS.split(",").map((x) => x.trim());

  if (guardianIds.length !== guardianPrivateKeys.length) {
    throw new Error("GUARDIAN_IDS and GUARDIAN_PRIVATE_KEYS length mismatch");
  }
  if (t + 1 > guardianIds.length) {
    throw new Error("Invalid threshold");
  }

  const xs = [0n];
  const ys = [secretScalar];

  const signatures = [];
  const sigmas = [];
  const digests = [];

  for (let i = 0; i < guardianIds.length; i++) {
    const guardianId = guardianIds[i];
    const pk = guardianPrivateKeys[i];
    const wallet = new ethers.Wallet(pk);

    const digest = sigmaDigest(contractAddress, chainId, ownerId, guardianId, backupNonce);
    const sigObj = wallet.signingKey.sign(digest);
    const signature = ethers.Signature.from(sigObj).serialized;
    const sigma = hashToField(signature);

    digests.push(digest);
    signatures.push(signature);
    sigmas.push(sigma.toString());

    xs.push(mod(guardianId));
    ys.push(sigma);
  }

  const publicCount = guardianIds.length - t;
  const publicPoints = [];
  for (let k = 1; k <= publicCount; k++) {
    const xNeg = mod(-BigInt(k)); // -1, -2, ...
    publicPoints.push(lagrangeEvaluate(xs, ys, xNeg).toString());
  }

  const output = {
    publishBackupArgs: {
      guardianIds: guardianIds.map(String),
      t,
      backupNonce: backupNonce.toString(),
      publicPoints
    },
    backupMeta: {
      contractAddress,
      chainId: chainId.toString(),
      ownerId: ownerId.toString(),
      secretScalar: secretScalar.toString()
    },
    guardians: guardianIds.map((gid, idx) => ({
      guardianId: gid.toString(),
      address: new ethers.Wallet(guardianPrivateKeys[idx]).address,
      digest: digests[idx],
      signature: signatures[idx],
      sigma: sigmas[idx]
    }))
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});