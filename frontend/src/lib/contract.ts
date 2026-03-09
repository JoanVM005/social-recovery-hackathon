/**
 * ANARKeyOffchainBoard contract configuration for Sepolia.
 *
 * Contains the ABI (subset needed for the backup creation flow),
 * the deployed contract address, and demo party-ID mappings.
 */

// ═══════════════════════════════════════════════════════════════════════
//  Contract address – update after deployment
// ═══════════════════════════════════════════════════════════════════════

/**
 * Address of the deployed ANARKeyOffchainBoard contract on Sepolia.
 * Replace the zero address with the actual deployment address.
 */
export const CONTRACT_ADDRESS: `0x${string}` =
  "0x09a02A50f8c1D2aabd5775A63a2B5dc488274222"

// ═══════════════════════════════════════════════════════════════════════
//  ABI (only the functions used by the backup-creation flow)
// ═══════════════════════════════════════════════════════════════════════

export const OFFCHAIN_BOARD_ABI = [
  {
    name: "registerParty",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "pkCommitment", type: "bytes32" }],
    outputs: [{ name: "partyId", type: "uint256" }],
  },
  {
    name: "publishBackup",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "guardianIds", type: "uint256[]" },
      { name: "t", type: "uint16" },
      { name: "backupNonce", type: "uint64" },
      { name: "publicPoints", type: "uint256[]" },
    ],
    outputs: [{ name: "backupId", type: "uint256" }],
  },
  {
    name: "partyIdOfSigner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getBackup",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "backupId", type: "uint256" }],
    outputs: [
      { name: "ownerId", type: "uint256" },
      { name: "backupNonce", type: "uint64" },
      { name: "t", type: "uint16" },
      { name: "guardianCount", type: "uint16" },
      { name: "ownerPkCommitment", type: "bytes32" },
      { name: "guardianIds", type: "uint256[]" },
      { name: "publicPoints", type: "uint256[]" },
      { name: "publicPointsHash", type: "bytes32" },
      { name: "active", type: "bool" },
    ],
  },
  {
    name: "parties",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "partyId", type: "uint256" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "signer", type: "address" },
      { name: "pkCommitment", type: "bytes32" },
    ],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════
//  Demo party-ID mapping
// ═══════════════════════════════════════════════════════════════════════

/**
 * Maps friend display-names (from the FRIENDS list) to on-chain party IDs.
 *
 * These IDs must match the IDs returned by `registerParty` when each
 * guardian was registered on the contract.  For the demo, register parties
 * in order so that the owner gets ID 1 and guardians get IDs 2–7.
 */
export const DEMO_PARTY_IDS: Record<string, bigint> = {
  Alex: 2n,
  Maria: 3n,
  Sam: 4n,
  Jordan: 5n,
  Casey: 6n,
  Riley: 7n,
}
