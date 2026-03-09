export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000"
export const MOCK_MODE = (import.meta.env.VITE_MOCK_MODE ?? "true").toLowerCase() !== "false"

const MOCK_CHAIN_ID = "11155111"
const MOCK_CONTRACT_ADDRESS =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined) ??
  "0x09a02A50f8c1D2aabd5775A63a2B5dc488274222"
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

function normalizeAddress(address: string): `0x${string}` {
  return address.trim().toLowerCase() as `0x${string}`
}

function mustBePositiveInt(value: string, field: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive integer`)
  }
  return parsed
}

function sortUniqueGuardianIds(values: string[]): string[] {
  const set = new Set<string>()
  for (const value of values) {
    const cleaned = String(value).trim()
    if (!/^\d+$/.test(cleaned)) {
      throw new Error(`Invalid guardianId: ${value}`)
    }
    set.add(cleaned)
  }
  return Array.from(set).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
}

function randomHex(bytes: number): `0x${string}` {
  const out = new Uint8Array(bytes)
  crypto.getRandomValues(out)
  const hex = Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("")
  return `0x${hex}`
}

function hashLike(input: string): `0x${string}` {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  let out = ""
  let seed = hash >>> 0
  while (out.length < 64) {
    seed = Math.imul(seed ^ 0x9e3779b9, 1664525) + 1013904223
    out += (seed >>> 0).toString(16).padStart(8, "0")
  }

  return `0x${out.slice(0, 64)}`
}

function digestFor(ownerId: string, guardianId: string, backupNonce: string): `0x${string}` {
  return hashLike(`${ownerId}:${guardianId}:${backupNonce}`)
}

function signatureFor(digest: string, guardianId: string): `0x${string}` {
  const head = hashLike(`${digest}:${guardianId}`).slice(2)
  const tail = hashLike(`sig:${guardianId}:${digest}`).slice(2)
  const body = `${head}${tail}`.slice(0, 130)
  return `0x${body.padEnd(130, "0")}`
}

function sigmaFromSignature(signature: string): string {
  const compact = signature.slice(2, 66) || "1"
  const parsed = BigInt(`0x${compact}`) % FIELD_MODULUS
  return (parsed === 0n ? 1n : parsed).toString()
}

async function waitMock(delayMs = 90): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, delayMs))
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const json = (await response.json()) as { detail?: string }
      if (json.detail) detail = json.detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }

  return (await response.json()) as T
}

export interface PartyRegisterPrepareResponse {
  address: string
  pkCommitment: `0x${string}`
  strategy: "address_v1"
  alreadyRegistered: boolean
  partyId: string
  chainId: string
}

export interface CommunityMember {
  username: string
  address: string
  partyId: string
  online: boolean
}

export interface CommunityJoinResponse {
  member: CommunityMember
  community: CommunityMember[]
}

export interface CommunityHeartbeatResponse {
  address: string
  partyId: string
  online: boolean
}

export interface CommunityMembersResponse {
  members: CommunityMember[]
}

export interface SetupSignatureItem {
  guardianId: string
  signature: `0x${string}`
}

export interface BackupPrepareRequest {
  ownerAddress: `0x${string}`
  guardianIds: string[]
  threshold: number
  backupNonce?: string
  secretScalar: string
  mode: "demo" | "real"
  setupSignatures?: SetupSignatureItem[]
  backupDraftId?: string
}

export interface BackupPrepareReadyResponse {
  status: "ready"
  backupDraftId: string
  ownerId: string
  guardianIds: string[]
  thresholdRequired: number
  t: number
  backupNonce: string
  publicPoints: string[]
  signatures: string[]
  sigmas: string[]
  digests: Array<{ guardianId: string; digest: string }>
  metadata: {
    mode: string
    offchainComputation: boolean
    onchainPublishRequired: boolean
  }
}

export interface BackupPreparePendingResponse {
  status: "awaiting_guardian_signatures"
  backupDraftId: string
  ownerId?: string
  guardianIds?: string[]
  thresholdRequired?: number
  t?: number
  backupNonce?: string
  missingGuardianIds?: string[]
  digests: Array<{ guardianId: string; digest: string; submitted: boolean }>
}

export type BackupPrepareResponse = BackupPrepareReadyResponse | BackupPreparePendingResponse

export interface RecoveryOpenPrepareResponse {
  backupSnapshot: {
    backupId: string
    ownerId: string
    backupNonce: string
    t: string
    guardianCount: string
    guardianIds: string[]
    publicPoints: string[]
    active: boolean
  }
  expectedShares: number
  guardianIds: string[]
}

export interface GuardianSignRequest {
  purpose: "backup_setup" | "recovery_session"
  mode: "demo" | "real"
  sessionId?: string
  backupDraftId?: string
  guardianId: string
  signature?: `0x${string}`
  submitOnchain?: boolean
}

export interface RecoveryViewResponse {
  sessionId: string
  backupId: string
  ownerId: string
  sharesNeeded: number
  sharesReceived: number
  ready: boolean
  closed: boolean
  guardianIds: string[]
  submittedByGuardian: Record<string, boolean>
  sigmasByGuardian: Record<string, string>
}

export interface BackupViewResponse {
  backupId: string
  ownerId: string
  backupNonce: string
  t: string
  guardianCount: string
  ownerPkCommitment: string
  guardianIds: string[]
  publicPoints: string[]
  publicPointsHash: string
  active: boolean
  metadata: {
    hasDraft: boolean
    backupDraftId: string | null
    mode: string | null
    originalSecretKnown: boolean
  }
}

export interface RecoveryReconstructResponse {
  backupId: string
  sessionId: string
  guardianIds: string[]
  originalSecret: string | null
  recoveredSecret: string
  match: boolean
  interpolationMeta: {
    field: string
    usedGuardianCount: number
    source: string
  }
}

export interface GuardianTasksResponse {
  guardianId: string | null
  tasks: Array<Record<string, unknown>>
}

export interface DashboardStateResponse {
  counts: {
    backups: number
    sessions: number
    readySessions: number
  }
  backups: Array<Record<string, unknown>>
  sessions: Array<Record<string, unknown>>
}

export interface OwnerSessionsResponse {
  ownerId: string | null
  sessions: Array<{
    sessionId: string
    backupId: string
    ownerId: string
    sharesNeeded: number
    sharesReceived: number
    ready: boolean
    closed: boolean
  }>
}

export interface DemoAdminConfigResponse {
  network: {
    rpcUrlConfigured: boolean
    contractAddress: string
    chainId: string
  }
  burners: Array<{
    label: string
    address: string
    partyId: string | null
  }>
  expected: {
    ownerId: string
    guardianIds: string
    thresholdT: string
    secretDemo: string
  }
}

interface MockParty {
  partyId: string
  address: `0x${string}`
  pkCommitment: `0x${string}`
}

interface MockCommunityRow {
  username: string
  address: `0x${string}`
  partyId: string
  lastSeenAt: number
}

interface MockBackupDraft {
  backupDraftId: string
  ownerAddress: `0x${string}`
  ownerId: string
  guardianIds: string[]
  thresholdRequired: number
  t: number
  backupNonce: string
  secretScalar: string
  mode: "demo" | "real"
  digests: Record<string, `0x${string}`>
  signaturesByGuardian: Record<string, `0x${string}`>
  createdAt: number
}

interface MockBackupRecord {
  backupId: string
  ownerId: string
  ownerAddress: `0x${string}`
  backupNonce: string
  t: string
  guardianCount: string
  ownerPkCommitment: string
  guardianIds: string[]
  publicPoints: string[]
  publicPointsHash: string
  active: boolean
  backupDraftId: string | null
  mode: string | null
  originalSecret: string | null
}

interface MockSessionRecord {
  sessionId: string
  backupId: string
  ownerId: string
  sharesNeeded: number
  sharesReceived: number
  ready: boolean
  closed: boolean
  guardianIds: string[]
  submittedByGuardian: Record<string, boolean>
  sigmasByGuardian: Record<string, string>
}

interface MockTxRecord {
  txHash: `0x${string}`
  type: "registerParty" | "publishBackup" | "openRecovery" | "submitDeterministicSignature"
  createdAt: number
}

interface MockState {
  partiesByAddress: Map<string, MockParty>
  communityByAddress: Map<string, MockCommunityRow>
  draftsById: Map<string, MockBackupDraft>
  backupsById: Map<string, MockBackupRecord>
  backupIdByDraftId: Map<string, string>
  sessionsById: Map<string, MockSessionRecord>
  txByHash: Map<string, MockTxRecord>
  activeWalletAddress: `0x${string}` | null
  nextPartyId: number
  nextBackupId: number
  nextSessionId: number
}

const PRESET_MEMBERS: Array<{ username: string; address: `0x${string}`; partyId: string }> = [
  { username: "Alex", address: "0x2a7a7d0f5d96d7d4e7a03a45b5453e4fd5435c11", partyId: "2" },
  { username: "Maria", address: "0x3b839d0f5d96d7d4e7a03a45b5453e4fd5435c22", partyId: "3" },
  { username: "Sam", address: "0x4c949d0f5d96d7d4e7a03a45b5453e4fd5435c33", partyId: "4" },
  { username: "Jordan", address: "0x5da59d0f5d96d7d4e7a03a45b5453e4fd5435c44", partyId: "5" },
  { username: "Casey", address: "0x6eb69d0f5d96d7d4e7a03a45b5453e4fd5435c55", partyId: "6" },
  { username: "Riley", address: "0x7fc79d0f5d96d7d4e7a03a45b5453e4fd5435c66", partyId: "7" },
]

function createMockState(): MockState {
  const partiesByAddress = new Map<string, MockParty>()
  const communityByAddress = new Map<string, MockCommunityRow>()

  for (const member of PRESET_MEMBERS) {
    partiesByAddress.set(member.address.toLowerCase(), {
      partyId: member.partyId,
      address: member.address,
      pkCommitment: hashLike(`pk:${member.address}`),
    })
    communityByAddress.set(member.address.toLowerCase(), {
      username: member.username,
      address: member.address,
      partyId: member.partyId,
      lastSeenAt: Date.now(),
    })
  }

  return {
    partiesByAddress,
    communityByAddress,
    draftsById: new Map(),
    backupsById: new Map(),
    backupIdByDraftId: new Map(),
    sessionsById: new Map(),
    txByHash: new Map(),
    activeWalletAddress: null,
    nextPartyId: 8,
    nextBackupId: 1,
    nextSessionId: 1,
  }
}

const mockState = createMockState()

function partyByAddress(address: string): MockParty | undefined {
  return mockState.partiesByAddress.get(normalizeAddress(address))
}

function partyIdByAddress(address: string): string | null {
  return partyByAddress(address)?.partyId ?? null
}

function registerParty(address: string, pkCommitment?: `0x${string}`): MockParty {
  const normalized = normalizeAddress(address)
  const existing = mockState.partiesByAddress.get(normalized)
  if (existing) {
    return existing
  }

  const next: MockParty = {
    partyId: String(mockState.nextPartyId),
    address: normalized,
    pkCommitment: pkCommitment ?? hashLike(`pk:${normalized}`),
  }
  mockState.partiesByAddress.set(normalized, next)
  mockState.nextPartyId += 1
  return next
}

function upsertCommunity(username: string, address: string, partyId: string): CommunityMember {
  const normalized = normalizeAddress(address)
  const row: MockCommunityRow = {
    username: username.trim() || "Player",
    address: normalized,
    partyId,
    lastSeenAt: Date.now(),
  }
  mockState.communityByAddress.set(normalized, row)
  return {
    username: row.username,
    address: row.address,
    partyId: row.partyId,
    online: true,
  }
}

function listCommunityMembers(): CommunityMember[] {
  const now = Date.now()
  const rows = Array.from(mockState.communityByAddress.values()).map((row) => ({
    username: row.username,
    address: row.address,
    partyId: row.partyId,
    online: now - row.lastSeenAt <= 45000,
  }))
  rows.sort((a, b) => a.username.localeCompare(b.username))
  return rows
}

function makePendingFromDraft(draft: MockBackupDraft): BackupPreparePendingResponse {
  const missingGuardianIds = draft.guardianIds.filter((guardianId) => !draft.signaturesByGuardian[guardianId])
  return {
    status: "awaiting_guardian_signatures",
    backupDraftId: draft.backupDraftId,
    ownerId: draft.ownerId,
    guardianIds: draft.guardianIds,
    thresholdRequired: draft.thresholdRequired,
    t: draft.t,
    backupNonce: draft.backupNonce,
    missingGuardianIds,
    digests: draft.guardianIds.map((guardianId) => ({
      guardianId,
      digest: draft.digests[guardianId],
      submitted: Boolean(draft.signaturesByGuardian[guardianId]),
    })),
  }
}

function makeReadyFromDraft(draft: MockBackupDraft): BackupPrepareReadyResponse {
  const secret = BigInt(draft.secretScalar)
  const nonce = BigInt(draft.backupNonce)
  const neededPublicPoints = Math.max(1, draft.guardianIds.length - draft.t)

  const publicPoints = Array.from({ length: neededPublicPoints }, (_, idx) => {
    const guardianOffset = BigInt(draft.guardianIds[idx % draft.guardianIds.length] ?? "1")
    return ((secret + nonce + BigInt(idx + 1) * 97n + guardianOffset) % FIELD_MODULUS).toString()
  })

  return {
    status: "ready",
    backupDraftId: draft.backupDraftId,
    ownerId: draft.ownerId,
    guardianIds: draft.guardianIds,
    thresholdRequired: draft.thresholdRequired,
    t: draft.t,
    backupNonce: draft.backupNonce,
    publicPoints,
    signatures: draft.guardianIds.map((guardianId) => draft.signaturesByGuardian[guardianId]),
    sigmas: draft.guardianIds.map((guardianId) => sigmaFromSignature(draft.signaturesByGuardian[guardianId])),
    digests: draft.guardianIds.map((guardianId) => ({ guardianId, digest: draft.digests[guardianId] })),
    metadata: {
      mode: draft.mode,
      offchainComputation: true,
      onchainPublishRequired: true,
    },
  }
}

function applyGuardianSubmission(session: MockSessionRecord, guardianId: string, signature: string): void {
  if (!session.guardianIds.includes(guardianId)) {
    throw new Error(`guardianId ${guardianId} is not part of this recovery session`)
  }
  session.submittedByGuardian[guardianId] = true
  session.sigmasByGuardian[guardianId] = sigmaFromSignature(signature)
  session.sharesReceived = session.guardianIds.filter((id) => session.submittedByGuardian[id]).length
  session.ready = session.sharesReceived >= session.sharesNeeded
}

function backupView(record: MockBackupRecord): BackupViewResponse {
  return {
    backupId: record.backupId,
    ownerId: record.ownerId,
    backupNonce: record.backupNonce,
    t: record.t,
    guardianCount: record.guardianCount,
    ownerPkCommitment: record.ownerPkCommitment,
    guardianIds: [...record.guardianIds],
    publicPoints: [...record.publicPoints],
    publicPointsHash: record.publicPointsHash,
    active: record.active,
    metadata: {
      hasDraft: Boolean(record.backupDraftId),
      backupDraftId: record.backupDraftId,
      mode: record.mode,
      originalSecretKnown: Boolean(record.originalSecret),
    },
  }
}

function recoveryView(record: MockSessionRecord): RecoveryViewResponse {
  return {
    sessionId: record.sessionId,
    backupId: record.backupId,
    ownerId: record.ownerId,
    sharesNeeded: record.sharesNeeded,
    sharesReceived: record.sharesReceived,
    ready: record.ready,
    closed: record.closed,
    guardianIds: [...record.guardianIds],
    submittedByGuardian: { ...record.submittedByGuardian },
    sigmasByGuardian: { ...record.sigmasByGuardian },
  }
}

function pushMockTx(type: MockTxRecord["type"]): `0x${string}` {
  const txHash = randomHex(32)
  mockState.txByHash.set(txHash, {
    txHash,
    type,
    createdAt: Date.now(),
  })
  return txHash
}

function mockGuardianTasks(guardianId: string): Array<Record<string, unknown>> {
  const tasks: Array<Record<string, unknown>> = []

  for (const draft of mockState.draftsById.values()) {
    if (!draft.guardianIds.includes(guardianId)) continue
    if (draft.signaturesByGuardian[guardianId]) continue

    tasks.push({
      purpose: "backup_setup",
      status: "pending",
      backupDraftId: draft.backupDraftId,
      ownerAddress: draft.ownerAddress,
      ownerId: draft.ownerId,
      guardianId,
      digest: draft.digests[guardianId],
      backupNonce: draft.backupNonce,
    })
  }

  for (const session of mockState.sessionsById.values()) {
    if (session.closed) continue
    if (!session.guardianIds.includes(guardianId)) continue
    if (session.submittedByGuardian[guardianId]) continue

    const backup = mockState.backupsById.get(session.backupId)
    if (!backup) continue

    tasks.push({
      purpose: "recovery_session",
      status: "pending",
      sessionId: session.sessionId,
      backupId: session.backupId,
      guardianId,
      digest: digestFor(backup.ownerId, guardianId, backup.backupNonce),
      sharesNeeded: session.sharesNeeded,
      sharesReceived: session.sharesReceived,
    })
  }

  return tasks
}

export function getMockWalletAddress(): `0x${string}` | null {
  return mockState.activeWalletAddress
}

export function connectMockWallet(forceNew = false): `0x${string}` {
  if (!forceNew && mockState.activeWalletAddress) {
    return mockState.activeWalletAddress
  }
  const nextAddress = (`0x${randomHex(20).slice(2)}` as `0x${string}`)
  mockState.activeWalletAddress = nextAddress
  return nextAddress
}

export function disconnectMockWallet(): void {
  mockState.activeWalletAddress = null
}

export async function mockChainRegisterParty(params: {
  address: string
  pkCommitment: `0x${string}`
}): Promise<{ txHash: `0x${string}`; partyId: string }> {
  if (!MOCK_MODE) {
    throw new Error("mockChainRegisterParty can only be used when VITE_MOCK_MODE is enabled")
  }
  await waitMock()
  const party = registerParty(params.address, params.pkCommitment)
  const txHash = pushMockTx("registerParty")
  return { txHash, partyId: party.partyId }
}

export async function mockChainPublishBackup(
  preparedBackup: BackupPrepareReadyResponse,
): Promise<{ txHash: `0x${string}`; backupId: string }> {
  if (!MOCK_MODE) {
    throw new Error("mockChainPublishBackup can only be used when VITE_MOCK_MODE is enabled")
  }
  await waitMock()

  const existing = mockState.backupIdByDraftId.get(preparedBackup.backupDraftId)
  if (existing) {
    const txHash = pushMockTx("publishBackup")
    return { txHash, backupId: existing }
  }

  const draft = mockState.draftsById.get(preparedBackup.backupDraftId)
  const ownerAddress = draft?.ownerAddress ?? mockState.activeWalletAddress ?? PRESET_MEMBERS[0].address

  const backupId = String(mockState.nextBackupId)
  mockState.nextBackupId += 1

  const record: MockBackupRecord = {
    backupId,
    ownerId: preparedBackup.ownerId,
    ownerAddress,
    backupNonce: preparedBackup.backupNonce,
    t: String(preparedBackup.t),
    guardianCount: String(preparedBackup.guardianIds.length),
    ownerPkCommitment: hashLike(`ownerpk:${preparedBackup.ownerId}:${ownerAddress}`),
    guardianIds: [...preparedBackup.guardianIds],
    publicPoints: [...preparedBackup.publicPoints],
    publicPointsHash: hashLike(`public:${preparedBackup.publicPoints.join(",")}`),
    active: true,
    backupDraftId: preparedBackup.backupDraftId,
    mode: draft?.mode ?? "real",
    originalSecret: draft?.secretScalar ?? null,
  }

  mockState.backupsById.set(backupId, record)
  mockState.backupIdByDraftId.set(preparedBackup.backupDraftId, backupId)

  const txHash = pushMockTx("publishBackup")
  return { txHash, backupId }
}

export async function mockChainOpenRecovery(backupId: string): Promise<{ txHash: `0x${string}`; sessionId: string }> {
  if (!MOCK_MODE) {
    throw new Error("mockChainOpenRecovery can only be used when VITE_MOCK_MODE is enabled")
  }
  await waitMock()

  const backup = mockState.backupsById.get(String(backupId))
  if (!backup) throw new Error(`Backup ${backupId} not found`)

  const sessionId = String(mockState.nextSessionId)
  mockState.nextSessionId += 1

  const sharesNeeded = Number.parseInt(backup.t, 10) + 1
  const submittedByGuardian: Record<string, boolean> = {}
  const sigmasByGuardian: Record<string, string> = {}
  for (const guardianId of backup.guardianIds) {
    submittedByGuardian[guardianId] = false
    sigmasByGuardian[guardianId] = "0"
  }

  mockState.sessionsById.set(sessionId, {
    sessionId,
    backupId: backup.backupId,
    ownerId: backup.ownerId,
    sharesNeeded,
    sharesReceived: 0,
    ready: false,
    closed: false,
    guardianIds: [...backup.guardianIds],
    submittedByGuardian,
    sigmasByGuardian,
  })

  const txHash = pushMockTx("openRecovery")
  return { txHash, sessionId }
}

export async function mockChainSubmitDeterministicSignature(params: {
  sessionId: string
  guardianId: string
  signature: `0x${string}`
}): Promise<{ txHash: `0x${string}` }> {
  if (!MOCK_MODE) {
    throw new Error("mockChainSubmitDeterministicSignature can only be used when VITE_MOCK_MODE is enabled")
  }
  await waitMock()

  const session = mockState.sessionsById.get(String(params.sessionId))
  if (!session) throw new Error(`Session ${params.sessionId} not found`)

  applyGuardianSubmission(session, String(params.guardianId), params.signature)

  const txHash = pushMockTx("submitDeterministicSignature")
  return { txHash }
}

export async function mockWaitForTransactionReceipt(hash: `0x${string}`): Promise<{ status: "success"; hash: `0x${string}` }> {
  if (!MOCK_MODE) {
    throw new Error("mockWaitForTransactionReceipt can only be used when VITE_MOCK_MODE is enabled")
  }
  await waitMock(120)
  if (!mockState.txByHash.has(hash)) {
    throw new Error(`Unknown mock tx hash: ${hash}`)
  }
  return { status: "success", hash }
}

const mockApi = {
  async communityJoin(payload: { username: string; address: string }): Promise<CommunityJoinResponse> {
    await waitMock()
    const partyId = partyIdByAddress(payload.address)
    if (!partyId) {
      throw new Error("Wallet is not registered on-chain. Call registerParty first.")
    }

    const member = upsertCommunity(payload.username, payload.address, partyId)
    return {
      member,
      community: listCommunityMembers(),
    }
  },

  async communityHeartbeat(address: string): Promise<CommunityHeartbeatResponse> {
    await waitMock()
    const normalized = normalizeAddress(address)
    const row = mockState.communityByAddress.get(normalized)
    if (!row) {
      throw new Error("community member not found for address")
    }

    row.lastSeenAt = Date.now()
    return {
      address: row.address,
      partyId: row.partyId,
      online: true,
    }
  },

  async getCommunityMembers(): Promise<CommunityMembersResponse> {
    await waitMock()
    return { members: listCommunityMembers() }
  },

  async partyRegisterPrepare(address: string): Promise<PartyRegisterPrepareResponse> {
    await waitMock()
    const normalized = normalizeAddress(address)
    const party = partyByAddress(normalized)
    return {
      address: normalized,
      pkCommitment: party?.pkCommitment ?? hashLike(`pk:${normalized}`),
      strategy: "address_v1",
      alreadyRegistered: Boolean(party),
      partyId: party?.partyId ?? "0",
      chainId: MOCK_CHAIN_ID,
    }
  },

  async backupPrepare(payload: BackupPrepareRequest): Promise<BackupPrepareResponse> {
    await waitMock()

    const ownerAddress = normalizeAddress(payload.ownerAddress)
    const ownerParty = partyByAddress(ownerAddress)
    if (!ownerParty) {
      throw new Error("Owner wallet is not registered on-chain")
    }

    const guardianIds = sortUniqueGuardianIds(payload.guardianIds)
    if (guardianIds.length === 0) {
      throw new Error("guardianIds cannot be empty")
    }

    const thresholdRequired = mustBePositiveInt(String(payload.threshold), "threshold")
    if (thresholdRequired > guardianIds.length) {
      throw new Error(`threshold must be in [1, ${guardianIds.length}]`)
    }

    let draft: MockBackupDraft
    if (payload.backupDraftId) {
      const existing = mockState.draftsById.get(payload.backupDraftId)
      if (!existing) {
        throw new Error("backupDraftId not found or expired")
      }
      draft = existing
    } else {
      const backupNonce = payload.backupNonce?.trim() || String(Date.now())
      const t = thresholdRequired - 1

      const digests: Record<string, `0x${string}`> = {}
      for (const guardianId of guardianIds) {
        digests[guardianId] = digestFor(ownerParty.partyId, guardianId, backupNonce)
      }

      draft = {
        backupDraftId: crypto.randomUUID().replace(/-/g, ""),
        ownerAddress,
        ownerId: ownerParty.partyId,
        guardianIds,
        thresholdRequired,
        t,
        backupNonce,
        secretScalar: payload.secretScalar.trim(),
        mode: payload.mode,
        digests,
        signaturesByGuardian: {},
        createdAt: Date.now(),
      }
      mockState.draftsById.set(draft.backupDraftId, draft)
    }

    if (payload.setupSignatures?.length) {
      for (const item of payload.setupSignatures) {
        if (draft.guardianIds.includes(item.guardianId)) {
          draft.signaturesByGuardian[item.guardianId] = item.signature
        }
      }
    }

    if (payload.mode === "demo") {
      for (const guardianId of draft.guardianIds) {
        if (!draft.signaturesByGuardian[guardianId]) {
          draft.signaturesByGuardian[guardianId] = signatureFor(draft.digests[guardianId], guardianId)
        }
      }
    }

    const missing = draft.guardianIds.filter((guardianId) => !draft.signaturesByGuardian[guardianId])
    if (missing.length > 0) {
      return makePendingFromDraft(draft)
    }

    return makeReadyFromDraft(draft)
  },

  async recoveryOpenPrepare(backupId: string): Promise<RecoveryOpenPrepareResponse> {
    await waitMock()
    const backup = mockState.backupsById.get(String(backupId))
    if (!backup) throw new Error(`Backup ${backupId} not found`)

    const snapshot = backupView(backup)
    return {
      backupSnapshot: {
        backupId: snapshot.backupId,
        ownerId: snapshot.ownerId,
        backupNonce: snapshot.backupNonce,
        t: snapshot.t,
        guardianCount: snapshot.guardianCount,
        guardianIds: snapshot.guardianIds,
        publicPoints: snapshot.publicPoints,
        active: snapshot.active,
      },
      expectedShares: Number.parseInt(snapshot.t, 10) + 1,
      guardianIds: snapshot.guardianIds,
    }
  },

  async guardianSign(payload: GuardianSignRequest): Promise<Record<string, unknown>> {
    await waitMock()

    const guardianId = String(payload.guardianId)
    if (!/^\d+$/.test(guardianId)) {
      throw new Error("guardianId must be numeric")
    }

    if (payload.purpose === "backup_setup") {
      if (!payload.backupDraftId) {
        throw new Error("backupDraftId is required for backup_setup")
      }

      const draft = mockState.draftsById.get(payload.backupDraftId)
      if (!draft) throw new Error("backupDraftId not found or expired")
      if (!draft.guardianIds.includes(guardianId)) {
        throw new Error("guardianId is not part of the draft")
      }

      const digest = draft.digests[guardianId]
      if (payload.mode === "real" && !payload.signature) {
        return {
          digest,
          submitted: false,
          requiresSignature: true,
        }
      }

      const signature = payload.signature ?? signatureFor(digest, guardianId)
      draft.signaturesByGuardian[guardianId] = signature

      const collected = draft.guardianIds.filter((id) => Boolean(draft.signaturesByGuardian[id])).length
      return {
        purpose: "backup_setup",
        backupDraftId: draft.backupDraftId,
        guardianId,
        digest,
        signature,
        sigma: sigmaFromSignature(signature),
        submitted: true,
        collected,
        required: draft.guardianIds.length,
      }
    }

    if (!payload.sessionId) {
      throw new Error("sessionId is required for recovery_session")
    }

    const session = mockState.sessionsById.get(String(payload.sessionId))
    if (!session) throw new Error("Session not found")

    const backup = mockState.backupsById.get(session.backupId)
    if (!backup) throw new Error("Backup not found")
    if (!session.guardianIds.includes(guardianId)) {
      throw new Error("guardianId is not allowed in this backup")
    }

    const digest = digestFor(backup.ownerId, guardianId, backup.backupNonce)
    if (payload.mode === "real" && !payload.signature) {
      return {
        purpose: "recovery_session",
        sessionId: session.sessionId,
        guardianId,
        digest,
        submitted: false,
        requiresSignature: true,
      }
    }

    const signature = payload.signature ?? signatureFor(digest, guardianId)
    let txHash: `0x${string}` | null = null
    let submitted = false
    if (payload.submitOnchain !== false) {
      applyGuardianSubmission(session, guardianId, signature)
      txHash = pushMockTx("submitDeterministicSignature")
      submitted = true
    }

    return {
      purpose: "recovery_session",
      sessionId: session.sessionId,
      guardianId,
      digest,
      signature,
      sigma: sigmaFromSignature(signature),
      txHash,
      submitted,
    }
  },

  async recoveryReconstruct(backupId: string, sessionId: string, guardianIds: string[]): Promise<RecoveryReconstructResponse> {
    await waitMock()

    const backup = mockState.backupsById.get(String(backupId))
    if (!backup) throw new Error(`Backup ${backupId} not found`)

    const session = mockState.sessionsById.get(String(sessionId))
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const cleanedGuardianIds = sortUniqueGuardianIds(guardianIds)
    const originalSecret = backup.originalSecret
    const recoveredSecret =
      originalSecret ??
      ((BigInt(`0x${hashLike(`${backupId}:${sessionId}:${cleanedGuardianIds.join(",")}`).slice(2)}`) % FIELD_MODULUS) || 1n).toString()

    return {
      backupId: String(backupId),
      sessionId: String(sessionId),
      guardianIds: cleanedGuardianIds,
      originalSecret,
      recoveredSecret,
      match: Boolean(originalSecret && originalSecret === recoveredSecret),
      interpolationMeta: {
        field: FIELD_MODULUS.toString(),
        usedGuardianCount: cleanedGuardianIds.length,
        source: "frontend-mock-runtime",
      },
    }
  },

  async getBackup(backupId: string): Promise<BackupViewResponse> {
    await waitMock()
    const backup = mockState.backupsById.get(String(backupId))
    if (!backup) throw new Error(`Backup ${backupId} not found`)
    return backupView(backup)
  },

  async getRecovery(sessionId: string): Promise<RecoveryViewResponse> {
    await waitMock()
    const session = mockState.sessionsById.get(String(sessionId))
    if (!session) throw new Error(`Session ${sessionId} not found`)
    return recoveryView(session)
  },

  async getGuardianTasks(params: { guardianId?: string; guardianAddress?: string }): Promise<GuardianTasksResponse> {
    await waitMock()
    let guardianId: string | null = null

    if (params.guardianId && /^\d+$/.test(params.guardianId)) {
      guardianId = params.guardianId
    } else if (params.guardianAddress) {
      guardianId = partyIdByAddress(params.guardianAddress)
    }

    if (!guardianId) {
      return { guardianId: null, tasks: [] }
    }

    return {
      guardianId,
      tasks: mockGuardianTasks(guardianId),
    }
  },

  async getDashboardState(): Promise<DashboardStateResponse> {
    await waitMock()

    const backups = Array.from(mockState.backupsById.values()).map((backup) => ({
      backupId: backup.backupId,
      ownerId: backup.ownerId,
      t: Number.parseInt(backup.t, 10),
      guardianCount: Number.parseInt(backup.guardianCount, 10),
      active: backup.active,
    }))

    const sessions = Array.from(mockState.sessionsById.values()).map((session) => ({
      sessionId: session.sessionId,
      backupId: session.backupId,
      sharesNeeded: session.sharesNeeded,
      sharesReceived: session.sharesReceived,
      ready: session.ready,
      closed: session.closed,
    }))

    return {
      counts: {
        backups: backups.length,
        sessions: sessions.length,
        readySessions: sessions.filter((session) => session.ready).length,
      },
      backups,
      sessions,
    }
  },

  async getOwnerSessions(ownerAddress: string): Promise<OwnerSessionsResponse> {
    await waitMock()
    const ownerId = partyIdByAddress(ownerAddress)
    if (!ownerId) {
      return { ownerId: null, sessions: [] }
    }

    const sessions = Array.from(mockState.sessionsById.values())
      .filter((session) => session.ownerId === ownerId)
      .sort((a, b) => Number.parseInt(b.sessionId, 10) - Number.parseInt(a.sessionId, 10))
      .map((session) => ({
        sessionId: session.sessionId,
        backupId: session.backupId,
        ownerId: session.ownerId,
        sharesNeeded: session.sharesNeeded,
        sharesReceived: session.sharesReceived,
        ready: session.ready,
        closed: session.closed,
      }))

    return {
      ownerId,
      sessions,
    }
  },

  async getDemoAdminConfig(): Promise<DemoAdminConfigResponse> {
    await waitMock()

    const burners = PRESET_MEMBERS.map((member, index) => ({
      label: index === 0 ? "guardian1" : index === 1 ? "guardian2" : index === 2 ? "guardian3" : member.username.toLowerCase(),
      address: member.address,
      partyId: member.partyId,
    }))

    const ownerId = mockState.activeWalletAddress ? partyIdByAddress(mockState.activeWalletAddress) ?? "" : ""

    return {
      network: {
        rpcUrlConfigured: true,
        contractAddress: MOCK_CONTRACT_ADDRESS,
        chainId: MOCK_CHAIN_ID,
      },
      burners,
      expected: {
        ownerId,
        guardianIds: PRESET_MEMBERS.slice(0, 3)
          .map((member) => member.partyId)
          .join(","),
        thresholdT: "1",
        secretDemo: "1234",
      },
    }
  },
}

const realApi = {
  communityJoin(payload: { username: string; address: string }) {
    return http<CommunityJoinResponse>("/api/community/join", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  communityHeartbeat(address: string) {
    return http<CommunityHeartbeatResponse>("/api/community/heartbeat", {
      method: "POST",
      body: JSON.stringify({ address }),
    })
  },

  getCommunityMembers() {
    return http<CommunityMembersResponse>("/api/community/members")
  },

  partyRegisterPrepare(address: string) {
    return http<PartyRegisterPrepareResponse>("/api/party/register/prepare", {
      method: "POST",
      body: JSON.stringify({ address }),
    })
  },

  backupPrepare(payload: BackupPrepareRequest) {
    return http<BackupPrepareResponse>("/api/backup/prepare", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  recoveryOpenPrepare(backupId: string) {
    return http<RecoveryOpenPrepareResponse>("/api/recovery/open/prepare", {
      method: "POST",
      body: JSON.stringify({ backupId }),
    })
  },

  guardianSign(payload: GuardianSignRequest) {
    return http<Record<string, unknown>>("/api/guardian/sign", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  },

  recoveryReconstruct(backupId: string, sessionId: string, guardianIds: string[]) {
    return http<RecoveryReconstructResponse>("/api/recovery/reconstruct", {
      method: "POST",
      body: JSON.stringify({ backupId, sessionId, guardianIds }),
    })
  },

  getBackup(backupId: string) {
    return http<BackupViewResponse>(`/api/backups/${backupId}`)
  },

  getRecovery(sessionId: string) {
    return http<RecoveryViewResponse>(`/api/recovery/${sessionId}`)
  },

  getGuardianTasks(params: { guardianId?: string; guardianAddress?: string }) {
    const search = new URLSearchParams()
    if (params.guardianId) search.set("guardianId", params.guardianId)
    if (params.guardianAddress) search.set("guardianAddress", params.guardianAddress)
    const suffix = search.toString()
    return http<GuardianTasksResponse>(`/api/guardian/tasks${suffix ? `?${suffix}` : ""}`)
  },

  getDashboardState() {
    return http<DashboardStateResponse>("/api/dashboard/state")
  },

  getOwnerSessions(ownerAddress: string) {
    const search = new URLSearchParams()
    search.set("ownerAddress", ownerAddress)
    return http<OwnerSessionsResponse>(`/api/owner/sessions?${search.toString()}`)
  },

  getDemoAdminConfig() {
    return http<DemoAdminConfigResponse>("/api/demo/admin/config")
  },
}

export const api = MOCK_MODE ? mockApi : realApi
