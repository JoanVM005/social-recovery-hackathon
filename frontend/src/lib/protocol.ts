/**
 * ANARKey BUSS Protocol – Frontend Implementation
 *
 * Implements the cryptographic setup phase of the social recovery protocol:
 *   1. Derive guardian shares σ  (hash-to-field)
 *   2. Construct the secret polynomial via Lagrange interpolation
 *   3. Compute public recovery values φ (polynomial evaluations at negative points)
 *   4. Prepare the data structure expected by the ANARKeyOffchainBoard contract
 *
 * All arithmetic is over the BN254 scalar field.
 */

import { keccak256, encodePacked } from "viem"

// ═══════════════════════════════════════════════════════════════════════
//  BN254 scalar field prime (matches the contract's FIELD_MODULUS)
// ═══════════════════════════════════════════════════════════════════════

export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

// ═══════════════════════════════════════════════════════════════════════
//  Finite-field arithmetic
// ═══════════════════════════════════════════════════════════════════════

/** Reduce a (possibly negative) bigint into [0, FIELD). */
export function mod(a: bigint): bigint {
  let x = a % FIELD
  if (x < 0n) x += FIELD
  return x
}

export function fieldAdd(a: bigint, b: bigint): bigint {
  return mod(a + b)
}

export function fieldSub(a: bigint, b: bigint): bigint {
  return mod(a - b)
}

export function fieldMul(a: bigint, b: bigint): bigint {
  return mod(a * b)
}

/** Modular exponentiation by repeated squaring. */
export function fieldPow(base: bigint, exp: bigint): bigint {
  let result = 1n
  let b = mod(base)
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = fieldMul(result, b)
    b = fieldMul(b, b)
    e >>= 1n
  }
  return result
}

/** Modular inverse via Fermat's little theorem: a^{-1} = a^{p-2} mod p. */
export function fieldInv(a: bigint): bigint {
  return fieldPow(a, FIELD - 2n)
}

// ═══════════════════════════════════════════════════════════════════════
//  Hash-to-field
// ═══════════════════════════════════════════════════════════════════════

/**
 * Hash arbitrary hex-encoded data to a BN254 field element.
 * Matches the contract's _hashBytesToField: keccak256(data) mod FIELD, mapping 0 ➜ 1.
 */
export function hashToField(data: `0x${string}`): bigint {
  const h = keccak256(data)
  let x = BigInt(h) % FIELD
  return x === 0n ? 1n : x
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 1 – Derive guardian shares σ_i
// ═══════════════════════════════════════════════════════════════════════

/**
 * Derive a deterministic guardian share σ_i.
 *
 * In the full ANARKey protocol σ comes from an ECDSA signature over a
 * domain-tagged digest.  For this demo we derive it as:
 *
 *   σ = H( keccak256( ownerSecret ‖ guardianSecret ‖ guardianId ‖ backupNonce ) )
 *
 * producing a unique, deterministic field element per guardian.
 */
export function deriveGuardianSigma(
  ownerSecret: string,
  guardianSecret: string,
  guardianId: bigint,
  backupNonce: bigint,
): bigint {
  const packed = encodePacked(
    ["string", "string", "uint256", "uint64"],
    [ownerSecret, guardianSecret, guardianId, backupNonce],
  )
  return hashToField(packed)
}

// ═══════════════════════════════════════════════════════════════════════
//  Step 2 – Lagrange interpolation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Evaluate the unique polynomial defined by points (xs[i], ys[i])
 * at an arbitrary point `xEval`, using Lagrange interpolation over the field.
 */
export function lagrangeEvaluate(
  xs: bigint[],
  ys: bigint[],
  xEval: bigint,
): bigint {
  let result = 0n
  for (let i = 0; i < xs.length; i++) {
    let num = 1n
    let den = 1n
    for (let j = 0; j < xs.length; j++) {
      if (i === j) continue
      num = fieldMul(num, fieldSub(xEval, xs[j]))
      den = fieldMul(den, fieldSub(xs[i], xs[j]))
    }
    const li = fieldMul(num, fieldInv(den))
    result = fieldAdd(result, fieldMul(ys[i], li))
  }
  return result
}

// ═══════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════

/** Convert the UI secret key "xxxx-xxxx-…" (hex with dashes) to a field scalar. */
export function secretKeyToScalar(secretKey: string): bigint {
  const hex = secretKey.replace(/-/g, "")
  return mod(BigInt("0x" + hex))
}

// ═══════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════

export interface GuardianShare {
  /** On-chain party ID (positive integer used as x-coordinate). */
  id: bigint
  /** Derived sigma value σ. */
  sigma: bigint
}

export interface BackupArgs {
  /** Sorted guardian party IDs. */
  guardianIds: bigint[]
  /** Threshold parameter for the contract (recovery needs t + 1 guardians). */
  t: number
  /** Owner-chosen nonce for this backup session. */
  backupNonce: bigint
  /** Public recovery values φ = [f(−1), f(−2), …, f(−(n − t))]. */
  publicPoints: bigint[]
}

// ═══════════════════════════════════════════════════════════════════════
//  Steps 2 + 3 – Build polynomial & compute public recovery values φ
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compute everything needed for `publishBackup`.
 *
 * The polynomial is uniquely defined by:
 *   f(0)            = secretScalar  (the user's secret)
 *   f(guardianId_i) = σ_i           (each guardian's share)
 *
 * Public values are evaluations at negative integers:
 *   φ = [ f(−1), f(−2), …, f(−(n − t)) ]
 *
 * where n = guardianCount and t = threshold parameter.
 *
 * At recovery, (n − t) public points + any (t + 1) guardian sigmas
 * = n + 1 points ➜ full reconstruction of f ➜ f(0) = secret.
 *
 * @param secretScalar  The owner's secret as a field element.
 * @param guardianShares  Array of { id, sigma } per guardian.
 * @param requiredToRecover  Number of guardians required (the UI counter value).
 * @param backupNonce  A nonzero nonce chosen by the owner.
 */
export function computeBackupArgs(
  secretScalar: bigint,
  guardianShares: GuardianShare[],
  requiredToRecover: number,
  backupNonce: bigint,
): BackupArgs {
  // Contract convention: t = requiredToRecover − 1 (recovery needs t + 1 guardians).
  const t = requiredToRecover - 1

  // Sort guardians by ID (contract requires sorted, unique guardian IDs).
  const sorted = [...guardianShares].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )

  // ── Build interpolation points ───────────────────────────────────────
  //   (0, secret), (gid_1, σ_1), (gid_2, σ_2), …
  const xs: bigint[] = [0n]
  const ys: bigint[] = [mod(secretScalar)]

  for (const g of sorted) {
    xs.push(mod(g.id))
    ys.push(g.sigma)
  }

  // ── Step 3: Evaluate polynomial at negative points ───────────────────
  //   φ_k = f(−k)  for k = 1 … (guardianCount − t)
  const publicPointCount = sorted.length - t
  const publicPoints: bigint[] = []
  for (let k = 1; k <= publicPointCount; k++) {
    const xNeg = mod(-BigInt(k))
    publicPoints.push(lagrangeEvaluate(xs, ys, xNeg))
  }

  return {
    guardianIds: sorted.map((g) => g.id),
    t,
    backupNonce,
    publicPoints,
  }
}
