export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000"

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

export const api = {
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
