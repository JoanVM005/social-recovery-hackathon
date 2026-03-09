/**
 * ANARKeyOffchainBoard contract configuration.
 *
 * NOTE: contract address can be injected via VITE_CONTRACT_ADDRESS.
 */

const FALLBACK_CONTRACT_ADDRESS: `0x${string}` =
  "0x09a02A50f8c1D2aabd5775A63a2B5dc488274222"

export const CONTRACT_ADDRESS: `0x${string}` =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined) ?? FALLBACK_CONTRACT_ADDRESS

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
    name: "openRecovery",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "backupId", type: "uint256" }],
    outputs: [{ name: "sessionId", type: "uint256" }],
  },
  {
    name: "submitDeterministicSignature",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
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
    name: "getSessionGuardianData",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "guardianIds", type: "uint256[]" },
    ],
    outputs: [
      { name: "submitted", type: "bool[]" },
      { name: "sigmas", type: "uint256[]" },
    ],
  },
  {
    name: "sessions",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "exists", type: "bool" },
      { name: "sessionId", type: "uint256" },
      { name: "backupId", type: "uint256" },
      { name: "ownerId", type: "uint256" },
      { name: "sharesNeeded", type: "uint16" },
      { name: "sharesReceived", type: "uint16" },
      { name: "ready", type: "bool" },
      { name: "closed", type: "bool" },
    ],
  },
  {
    name: "sigmaMessageDigest",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "ownerId", type: "uint256" },
      { name: "guardianId", type: "uint256" },
      { name: "backupNonce", type: "uint64" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
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
  {
    name: "nextPartyId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "nextBackupId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "nextSessionId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "PartyRegistered",
    type: "event",
    anonymous: false,
    inputs: [
      { indexed: true, name: "partyId", type: "uint256" },
      { indexed: true, name: "signer", type: "address" },
      { indexed: false, name: "pkCommitment", type: "bytes32" },
    ],
  },
  {
    name: "BackupPublished",
    type: "event",
    anonymous: false,
    inputs: [
      { indexed: true, name: "backupId", type: "uint256" },
      { indexed: true, name: "ownerId", type: "uint256" },
      { indexed: false, name: "t", type: "uint16" },
      { indexed: false, name: "guardianCount", type: "uint16" },
      { indexed: false, name: "backupNonce", type: "uint64" },
      { indexed: false, name: "publicPointsHash", type: "bytes32" },
    ],
  },
  {
    name: "RecoveryOpened",
    type: "event",
    anonymous: false,
    inputs: [
      { indexed: true, name: "sessionId", type: "uint256" },
      { indexed: true, name: "backupId", type: "uint256" },
      { indexed: true, name: "ownerId", type: "uint256" },
      { indexed: false, name: "sharesNeeded", type: "uint16" },
    ],
  },
  {
    name: "SigmaSubmitted",
    type: "event",
    anonymous: false,
    inputs: [
      { indexed: true, name: "sessionId", type: "uint256" },
      { indexed: true, name: "guardianId", type: "uint256" },
      { indexed: false, name: "sigma", type: "uint256" },
    ],
  },
  {
    name: "RecoveryReady",
    type: "event",
    anonymous: false,
    inputs: [
      { indexed: true, name: "sessionId", type: "uint256" },
      { indexed: true, name: "backupId", type: "uint256" },
      { indexed: true, name: "ownerId", type: "uint256" },
    ],
  },
  {
    name: "RecoveryClosed",
    type: "event",
    anonymous: false,
    inputs: [{ indexed: true, name: "sessionId", type: "uint256" }],
  },
] as const

// Backward-compatible demo map used by older screens/components.
export const DEMO_PARTY_IDS: Record<string, bigint> = {
  Alex: 2n,
  Maria: 3n,
  Sam: 4n,
  Jordan: 5n,
  Casey: 6n,
  Riley: 7n,
}
