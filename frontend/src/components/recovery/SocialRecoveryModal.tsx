import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useAccount, usePublicClient, useWalletClient, useWriteContract } from "wagmi"
import { decodeEventLog, isHex } from "viem"
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, KeyRound } from "lucide-react"

import { GuardianModal } from "@/components/guardian/GuardianModal"
import { SteamButton } from "@/components/ui/steam-button"
import { Input } from "@/components/ui/input"
import {
  api,
  MOCK_MODE,
  mockChainOpenRecovery,
  mockChainPublishBackup,
  mockChainRegisterParty,
  mockWaitForTransactionReceipt,
  type BackupPreparePendingResponse,
  type BackupPrepareReadyResponse,
} from "@/lib/api"
import { CONTRACT_ADDRESS, OFFCHAIN_BOARD_ABI } from "@/lib/contract"
import { secretKeyToScalar } from "@/lib/protocol"

type RecoveryMode = "assign" | "recover"

interface GuardianConfig {
  threshold: number
  totalGuardians: number
  selectedGuardians: string[]
  partyIds: Record<string, bigint>
}

interface SocialRecoveryModalProps {
  mode: RecoveryMode | null
  onClose: () => void
  currentUsername: string
  walletAddress?: `0x${string}`
  secretKey: string | null
  latestBackupId?: string | null
  onBackupPublished?: (backupId: string, backupDraftId: string) => void
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function toBigIntArray(values: string[]): bigint[] {
  return values.map((x) => BigInt(x))
}

function decodeBackupIdFromReceipt(receipt: { logs: Array<{ data: `0x${string}`; topics: readonly `0x${string}`[] }> }): string | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: OFFCHAIN_BOARD_ABI,
        data: log.data,
        topics: log.topics as unknown as [`0x${string}`, ...`0x${string}`[]],
      })
      if (decoded.eventName === "BackupPublished") {
        return (decoded.args.backupId as bigint).toString()
      }
    } catch {
      // ignore non-matching logs
    }
  }
  return null
}

function decodeSessionIdFromReceipt(receipt: { logs: Array<{ data: `0x${string}`; topics: readonly `0x${string}`[] }> }): string | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: OFFCHAIN_BOARD_ABI,
        data: log.data,
        topics: log.topics as unknown as [`0x${string}`, ...`0x${string}`[]],
      })
      if (decoded.eventName === "RecoveryOpened") {
        return (decoded.args.sessionId as bigint).toString()
      }
    } catch {
      // ignore non-matching logs
    }
  }
  return null
}

function ErrorText({ value }: { value: string | null }) {
  if (!value) return null
  return (
    <div className="mt-3 flex items-start gap-2 rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="break-all">{value}</span>
    </div>
  )
}

function SessionCard({ session }: { session: Record<string, unknown> }) {
  return (
    <div className="rounded border border-[#2a475e] bg-[#111a28] p-3">
      <pre className="overflow-auto text-[11px] text-[#8f98a0]">{pretty(session)}</pre>
    </div>
  )
}

export function SocialRecoveryModal({
  mode,
  onClose,
  currentUsername,
  walletAddress,
  secretKey,
  latestBackupId,
  onBackupPublished,
}: SocialRecoveryModalProps) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { writeContractAsync } = useWriteContract()

  const [activeMode, setActiveMode] = useState<RecoveryMode>("assign")

  const [showGuardianModal, setShowGuardianModal] = useState(false)
  const [guardianConfig, setGuardianConfig] = useState<GuardianConfig | null>(null)
  const [secretScalarInput, setSecretScalarInput] = useState("")
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinErr, setJoinErr] = useState<string | null>(null)
  const [joinInfo, setJoinInfo] = useState<string | null>(null)
  const [backupDraftId, setBackupDraftId] = useState("")
  const [pendingBackup, setPendingBackup] = useState<BackupPreparePendingResponse | null>(null)
  const [preparedBackup, setPreparedBackup] = useState<BackupPrepareReadyResponse | null>(null)
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignErr, setAssignErr] = useState<string | null>(null)
  const [publishTxHash, setPublishTxHash] = useState<string | null>(null)
  const [publishedBackupId, setPublishedBackupId] = useState<string | null>(null)

  const [backupIdInput, setBackupIdInput] = useState("")
  const [openBusy, setOpenBusy] = useState(false)
  const [recoverErr, setRecoverErr] = useState<string | null>(null)
  const [openTxHash, setOpenTxHash] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState("")
  const [guardianActionBusy, setGuardianActionBusy] = useState("")
  const [reconstructBusy, setReconstructBusy] = useState(false)
  const [reconstructResult, setReconstructResult] = useState<Record<string, unknown> | null>(null)
  const activeAddress = (address ?? walletAddress) as `0x${string}` | undefined

  const communityQuery = useQuery({
    queryKey: ["community-members"],
    queryFn: () => api.getCommunityMembers(),
    enabled: Boolean(mode),
    refetchInterval: 5000,
  })

  const selfCommunityMember = useMemo(() => {
    if (!activeAddress) return null
    return (communityQuery.data?.members ?? []).find(
      (member) => member.address.toLowerCase() === activeAddress.toLowerCase(),
    ) ?? null
  }, [communityQuery.data?.members, activeAddress])

  const guardianTasksQuery = useQuery({
    queryKey: ["guardian-tasks-modal", activeAddress ?? ""],
    queryFn: () => api.getGuardianTasks({ guardianAddress: activeAddress }),
    enabled: Boolean(mode && activeAddress),
    refetchInterval: 5000,
  })

  const sessionQuery = useQuery({
    queryKey: ["recovery-session-modal", sessionId],
    queryFn: () => api.getRecovery(sessionId),
    enabled: Boolean(mode && sessionId),
    refetchInterval: sessionId ? 5000 : false,
  })

  useEffect(() => {
    if (mode) setActiveMode(mode)
  }, [mode])

  useEffect(() => {
    if (!mode || !activeAddress) return
    const heartbeatAddress = activeAddress

    let cancelled = false
    async function beat() {
      try {
        await api.communityHeartbeat(heartbeatAddress)
      } catch {
        if (!cancelled) {
          // Ignore heartbeat errors for users not joined yet.
        }
      }
    }

    void beat()
    const timer = window.setInterval(() => {
      void beat()
    }, 15000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [mode, activeAddress])

  useEffect(() => {
    if (!secretKey || secretScalarInput) return
    try {
      setSecretScalarInput(secretKeyToScalar(secretKey).toString())
    } catch {
      // keep empty for manual entry
    }
  }, [secretKey, secretScalarInput])

  useEffect(() => {
    if (latestBackupId && !backupIdInput) {
      setBackupIdInput(latestBackupId)
    }
  }, [latestBackupId, backupIdInput])

  if (!mode) return null

  async function handleJoinCommunity() {
    if (!activeAddress) {
      setJoinErr("Connect a wallet first")
      return
    }
    if (!MOCK_MODE && !publicClient) {
      setJoinErr("Public client is not available")
      return
    }

    setJoinBusy(true)
    setJoinErr(null)
    setJoinInfo(null)

    try {
      const prep = await api.partyRegisterPrepare(activeAddress)
      if (!prep.alreadyRegistered) {
        if (MOCK_MODE) {
          const tx = await mockChainRegisterParty({
            address: activeAddress,
            pkCommitment: prep.pkCommitment,
          })
          await mockWaitForTransactionReceipt(tx.txHash)
        } else {
          const txHash = await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: OFFCHAIN_BOARD_ABI,
            functionName: "registerParty",
            args: [prep.pkCommitment],
          })
          await publicClient!.waitForTransactionReceipt({ hash: txHash })
        }
      }

      await api.communityJoin({
        username: currentUsername,
        address: activeAddress,
      })

      setJoinInfo("Joined community and wallet is ready for social recovery.")
      await communityQuery.refetch()
    } catch (error) {
      setJoinErr(error instanceof Error ? error.message : String(error))
    } finally {
      setJoinBusy(false)
    }
  }

  async function handlePrepareBackup(finalizeDraft: boolean) {
    if (!activeAddress) {
      setAssignErr("Connect a wallet first")
      return
    }
    if (!guardianConfig) {
      setAssignErr("Choose guardians first")
      return
    }
    if (!secretScalarInput.trim() || !/^\d+$/.test(secretScalarInput.trim())) {
      setAssignErr("Secret scalar must be a positive integer")
      return
    }

    const guardianIds = guardianConfig.selectedGuardians
      .map((name) => guardianConfig.partyIds[name])
      .filter((partyId): partyId is bigint => typeof partyId === "bigint")
      .map((partyId) => partyId.toString())

    if (guardianIds.length !== guardianConfig.selectedGuardians.length) {
      setAssignErr("Some selected friends are not registered in community with partyId")
      return
    }

    setAssignBusy(true)
    setAssignErr(null)
    try {
      const response = await api.backupPrepare({
        ownerAddress: activeAddress,
        guardianIds,
        threshold: guardianConfig.threshold,
        secretScalar: secretScalarInput.trim(),
        mode: "real",
        backupDraftId: finalizeDraft ? backupDraftId.trim() || undefined : undefined,
      })

      if (response.status === "ready") {
        setPreparedBackup(response)
        setPendingBackup(null)
        setBackupDraftId(response.backupDraftId)
      } else {
        setPendingBackup(response)
        setPreparedBackup(null)
        setBackupDraftId(response.backupDraftId)
      }
    } catch (error) {
      setAssignErr(error instanceof Error ? error.message : String(error))
    } finally {
      setAssignBusy(false)
    }
  }

  async function handlePublishBackup() {
    if (!preparedBackup) return
    if (!MOCK_MODE && !publicClient) return

    setAssignBusy(true)
    setAssignErr(null)
    try {
      if (MOCK_MODE) {
        const tx = await mockChainPublishBackup(preparedBackup)
        setPublishTxHash(tx.txHash)
        await mockWaitForTransactionReceipt(tx.txHash)
        setPublishedBackupId(tx.backupId)
        setBackupIdInput(tx.backupId)
        onBackupPublished?.(tx.backupId, preparedBackup.backupDraftId)
      } else {
        const txHash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: OFFCHAIN_BOARD_ABI,
          functionName: "publishBackup",
          args: [
            toBigIntArray(preparedBackup.guardianIds),
            preparedBackup.t,
            BigInt(preparedBackup.backupNonce),
            toBigIntArray(preparedBackup.publicPoints),
          ],
        })
        setPublishTxHash(txHash)
        const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash })
        const backupId = decodeBackupIdFromReceipt(receipt)
        if (backupId) {
          setPublishedBackupId(backupId)
          setBackupIdInput(backupId)
          onBackupPublished?.(backupId, preparedBackup.backupDraftId)
        }
      }
    } catch (error) {
      setAssignErr(error instanceof Error ? error.message : String(error))
    } finally {
      setAssignBusy(false)
    }
  }

  async function handleOpenRecovery() {
    if (!backupIdInput.trim()) {
      setRecoverErr("Provide backupId first")
      return
    }
    if (!MOCK_MODE && !publicClient) {
      setRecoverErr("Public client is not available")
      return
    }

    setRecoverErr(null)
    setOpenBusy(true)
    setReconstructResult(null)
    try {
      if (MOCK_MODE) {
        const tx = await mockChainOpenRecovery(backupIdInput.trim())
        setOpenTxHash(tx.txHash)
        await mockWaitForTransactionReceipt(tx.txHash)
        setSessionId(tx.sessionId)
      } else {
        const txHash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: OFFCHAIN_BOARD_ABI,
          functionName: "openRecovery",
          args: [BigInt(backupIdInput.trim())],
        })
        setOpenTxHash(txHash)
        const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash })
        const openedSessionId = decodeSessionIdFromReceipt(receipt)
        if (openedSessionId) {
          setSessionId(openedSessionId)
        }
      }
    } catch (error) {
      setRecoverErr(error instanceof Error ? error.message : String(error))
    } finally {
      setOpenBusy(false)
    }
  }

  async function handleGuardianTask(task: Record<string, unknown>) {
    if (!MOCK_MODE && (!walletClient || !activeAddress || !publicClient)) {
      setRecoverErr("Connect wallet and open MetaMask to approve guardian tasks")
      return
    }

    const purpose = String(task.purpose ?? "")
    const guardianId = String(task.guardianId ?? "")
    if (!guardianId || (purpose !== "backup_setup" && purpose !== "recovery_session")) return

    const busyKey = `${purpose}:${guardianId}:${String(task.sessionId ?? task.backupDraftId ?? "")}`
    setGuardianActionBusy(busyKey)
    setRecoverErr(null)

    try {
      if (MOCK_MODE) {
        await api.guardianSign({
          purpose: purpose as "backup_setup" | "recovery_session",
          mode: "demo",
          guardianId,
          sessionId: typeof task.sessionId === "string" ? task.sessionId : undefined,
          backupDraftId: typeof task.backupDraftId === "string" ? task.backupDraftId : undefined,
          submitOnchain: purpose === "recovery_session",
        })
      } else {
        const prepare = await api.guardianSign({
          purpose: purpose as "backup_setup" | "recovery_session",
          mode: "real",
          guardianId,
          sessionId: typeof task.sessionId === "string" ? task.sessionId : undefined,
          backupDraftId: typeof task.backupDraftId === "string" ? task.backupDraftId : undefined,
          submitOnchain: false,
        })

        const digestRaw = String(prepare.digest ?? "")
        if (!isHex(digestRaw)) {
          throw new Error("Backend returned an invalid digest")
        }

        const signature = (await walletClient!.request({
          method: "eth_sign",
          params: [activeAddress!, digestRaw],
        })) as `0x${string}`

        await api.guardianSign({
          purpose: purpose as "backup_setup" | "recovery_session",
          mode: "real",
          guardianId,
          sessionId: typeof task.sessionId === "string" ? task.sessionId : undefined,
          backupDraftId: typeof task.backupDraftId === "string" ? task.backupDraftId : undefined,
          signature,
          submitOnchain: false,
        })

        if (purpose === "recovery_session") {
          const sessionValue = String(task.sessionId ?? "")
          if (!sessionValue) throw new Error("Missing sessionId for recovery contribution")
          const txHash = await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: OFFCHAIN_BOARD_ABI,
            functionName: "submitDeterministicSignature",
            args: [BigInt(sessionValue), signature],
          })
          await publicClient!.waitForTransactionReceipt({ hash: txHash })
        }
      }

      await guardianTasksQuery.refetch()
      if (sessionId) await sessionQuery.refetch()
      await communityQuery.refetch()
    } catch (error) {
      setRecoverErr(error instanceof Error ? error.message : String(error))
    } finally {
      setGuardianActionBusy("")
    }
  }

  async function handleReconstruct() {
    const bid = backupIdInput.trim()
    const sid = sessionId.trim()
    if (!bid || !sid) {
      setRecoverErr("backupId and sessionId are required")
      return
    }

    setRecoverErr(null)
    setReconstructBusy(true)
    try {
      const session = await api.getRecovery(sid)
      const submittedGuardianIds = session.guardianIds.filter((guardianId) => session.submittedByGuardian[guardianId])
      const guardianIdsToUse = submittedGuardianIds.length > 0 ? submittedGuardianIds : session.guardianIds

      const response = await api.recoveryReconstruct(bid, sid, guardianIdsToUse)
      setReconstructResult(response as unknown as Record<string, unknown>)
    } catch (error) {
      setRecoverErr(error instanceof Error ? error.message : String(error))
      setReconstructResult(null)
    } finally {
      setReconstructBusy(false)
    }
  }

  const guardianInbox = (guardianTasksQuery.data?.tasks ?? []).filter(
    (task) => task && typeof task === "object" && (task.purpose === "backup_setup" || task.purpose === "recovery_session"),
  )

  const recoveryOnlyTasks = guardianInbox.filter((task) => task.purpose === "recovery_session")

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
      <div className="w-full max-w-5xl rounded border border-[#2a475e] bg-[#0f1b2b] shadow-[0_8px_60px_rgba(0,0,0,0.8)]">
        <div className="flex items-center justify-between border-b border-[#2a475e] px-5 py-4">
          <div>
            <h2 className="text-sm font-bold tracking-wide text-white">Social Recovery</h2>
            <p className="text-xs text-[#8f98a0]">
              {MOCK_MODE ? "Mock mode activo - endpoints y botones simulados en frontend" : "Sepolia + wallets reales - todo el flujo desde la web"}
            </p>
          </div>
          <button onClick={onClose} className="rounded border border-[#2a475e] px-3 py-1 text-xs text-[#8f98a0] hover:text-white">
            CLOSE
          </button>
        </div>

        <div className="border-b border-[#2a475e] px-5 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveMode("assign")}
              className={`flex items-center gap-2 rounded border px-3 py-1.5 text-xs ${
                activeMode === "assign"
                  ? "border-[#67c1f5] bg-[#1a3a4a] text-white"
                  : "border-[#2a475e] bg-[#111a28] text-[#8f98a0]"
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Assign Guardians
            </button>
            <button
              onClick={() => setActiveMode("recover")}
              className={`flex items-center gap-2 rounded border px-3 py-1.5 text-xs ${
                activeMode === "recover"
                  ? "border-[#67c1f5] bg-[#1a3a4a] text-white"
                  : "border-[#2a475e] bg-[#111a28] text-[#8f98a0]"
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" /> Recover Secret Key
            </button>
          </div>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-2">
          {activeMode === "assign" ? (
            <>
              <section className="rounded border border-[#2a475e] bg-[#132234] p-4">
                <h3 className="text-sm font-bold text-white">1) Join Community</h3>
                <p className="mt-1 text-xs text-[#8f98a0]">
                  To select guardians by friends, each wallet must be registered on-chain and joined to the recovery community.
                </p>

                <div className="mt-3 rounded border border-[#2a475e] bg-[#111a28] p-3 text-xs text-[#c7d5e0]">
                  <div>Wallet: <span className="font-mono">{activeAddress ?? "Not connected"}</span></div>
                  <div className="mt-1">
                    Community status:{" "}
                    <span className={selfCommunityMember ? "text-[#beee11]" : "text-yellow-300"}>
                      {selfCommunityMember ? `Joined as ${selfCommunityMember.username} (partyId ${selfCommunityMember.partyId})` : "Not joined yet"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex gap-3">
                  <SteamButton onClick={() => void handleJoinCommunity()} disabled={joinBusy || !activeAddress} className="max-w-52">
                    {joinBusy ? "JOINING..." : "JOIN COMMUNITY"}
                  </SteamButton>
                  <SteamButton onClick={() => void communityQuery.refetch()} className="max-w-44">
                    REFRESH
                  </SteamButton>
                </div>

                {joinInfo ? <p className="mt-2 text-xs text-[#67c1f5]">{joinInfo}</p> : null}
                <ErrorText value={joinErr} />
              </section>

              <section className="rounded border border-[#2a475e] bg-[#132234] p-4">
                <h3 className="text-sm font-bold text-white">2) Select Guardians</h3>
                <p className="mt-1 text-xs text-[#8f98a0]">Keep the same friend-selection workflow from Steam-like UI.</p>

                {guardianConfig ? (
                  <div className="mt-3 rounded border border-[#2a475e] bg-[#111a28] p-3 text-xs text-[#c7d5e0]">
                    <div>Threshold: <span className="text-[#beee11]">{guardianConfig.threshold}</span> of {guardianConfig.totalGuardians}</div>
                    <div className="mt-2">Guardians: {guardianConfig.selectedGuardians.join(", ")}</div>
                    <div className="mt-2 text-[#8f98a0]">
                      Guardian party IDs: {guardianConfig.selectedGuardians.map((name) => guardianConfig.partyIds[name]?.toString() ?? "?").join(", ")}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[#8f98a0]">No guardians selected yet.</p>
                )}

                <div className="mt-3">
                  <SteamButton onClick={() => setShowGuardianModal(true)} className="max-w-60">
                    CHOOSE FRIEND GUARDIANS
                  </SteamButton>
                </div>

                <label className="mt-3 block text-xs text-[#8f98a0]">
                  Secret scalar (autofilled from generated secret key)
                  <Input className="steam-input mt-1" value={secretScalarInput} onChange={(e) => setSecretScalarInput(e.target.value)} />
                </label>

                <div className="mt-3 flex flex-wrap gap-3">
                  <SteamButton onClick={() => void handlePrepareBackup(false)} disabled={assignBusy || !guardianConfig || !activeAddress} className="max-w-56">
                    {assignBusy ? "PREPARING..." : "START BACKUP DRAFT"}
                  </SteamButton>
                  <SteamButton onClick={() => void handlePrepareBackup(true)} disabled={assignBusy || !backupDraftId} className="max-w-64">
                    FINALIZE DRAFT (CHECK SIGNATURES)
                  </SteamButton>
                </div>

                {backupDraftId ? <p className="mt-2 text-xs text-[#67c1f5]">backupDraftId: {backupDraftId}</p> : null}
                {pendingBackup ? (
                  <pre className="mt-3 overflow-auto rounded border border-yellow-700/30 bg-yellow-950/20 p-3 text-[11px] text-yellow-100">
                    {pretty(pendingBackup)}
                  </pre>
                ) : null}
                {preparedBackup ? (
                  <pre className="mt-3 overflow-auto rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-[11px] text-[#c7d5e0]">
                    {pretty(preparedBackup)}
                  </pre>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <SteamButton onClick={() => void handlePublishBackup()} disabled={!preparedBackup || assignBusy} className="max-w-64">
                    {assignBusy ? "PUBLISHING..." : "PUBLISH BACKUP ON SEPOLIA"}
                  </SteamButton>
                  {publishTxHash ? <span className="text-xs text-[#67c1f5]">tx: {publishTxHash}</span> : null}
                  {publishedBackupId ? <span className="text-xs text-[#beee11]">backupId: {publishedBackupId}</span> : null}
                </div>
                <ErrorText value={assignErr} />
              </section>
            </>
          ) : (
            <>
              <section className="rounded border border-[#2a475e] bg-[#132234] p-4">
                <h3 className="text-sm font-bold text-white">Owner Recovery</h3>
                <p className="mt-1 text-xs text-[#8f98a0]">Open the session on-chain, wait guardian sigmas, then reconstruct off-chain.</p>

                <label className="mt-3 block text-xs text-[#8f98a0]">
                  backupId
                  <Input className="steam-input mt-1" value={backupIdInput} onChange={(e) => setBackupIdInput(e.target.value)} />
                </label>

                <div className="mt-3 flex gap-3">
                  <SteamButton onClick={() => void handleOpenRecovery()} disabled={openBusy || !backupIdInput.trim()} className="max-w-56">
                    {openBusy ? "OPENING..." : "OPEN RECOVERY SESSION"}
                  </SteamButton>
                  <SteamButton onClick={() => void sessionQuery.refetch()} disabled={!sessionId} className="max-w-40">
                    REFRESH
                  </SteamButton>
                </div>

                {openTxHash ? <p className="mt-2 text-xs text-[#67c1f5]">tx: {openTxHash}</p> : null}
                {sessionId ? <p className="mt-1 text-xs text-[#beee11]">sessionId: {sessionId}</p> : null}

                {sessionQuery.isFetching ? <Loader2 className="mt-3 h-4 w-4 animate-spin text-[#67c1f5]" /> : null}
                {sessionQuery.data ? (
                  <div className="mt-3">
                    <SessionCard session={sessionQuery.data as unknown as Record<string, unknown>} />
                  </div>
                ) : null}

                <div className="mt-3">
                    <SteamButton
                      onClick={() => void handleReconstruct()}
                      disabled={!sessionId || reconstructBusy}
                      className="max-w-56"
                    >
                      {reconstructBusy ? "RECONSTRUCTING..." : "RECONSTRUCT SECRET"}
                    </SteamButton>
                </div>

                {reconstructResult ? (
                  <div className="mt-3 rounded border border-[#2a475e] bg-[#111a28] p-3 text-xs text-[#c7d5e0]">
                    <div className="mb-2 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[#beee11]" />
                      <span>
                        match = <strong className="text-[#beee11]">{String(reconstructResult.match)}</strong>
                      </span>
                    </div>
                    <pre className="overflow-auto text-[11px] text-[#8f98a0]">{pretty(reconstructResult)}</pre>
                  </div>
                ) : null}
                <ErrorText value={recoverErr} />
              </section>

              <section className="rounded border border-[#2a475e] bg-[#132234] p-4">
                <h3 className="text-sm font-bold text-white">Guardian Inbox</h3>
                <p className="mt-1 text-xs text-[#8f98a0]">
                  Approve pending guardian tasks directly from this web app (backup setup and live recovery sessions).
                </p>

                {recoveryOnlyTasks.length > 0 ? (
                  <p className="mt-2 rounded border border-yellow-700/30 bg-yellow-950/20 px-3 py-2 text-xs text-yellow-100">
                    Alert: a community member is requesting recovery support right now.
                  </p>
                ) : null}

                {guardianInbox.length ? (
                  <div className="mt-3 space-y-2">
                    {guardianInbox.map((task, idx) => {
                      const purpose = String(task.purpose ?? "unknown")
                      const guardianId = String(task.guardianId ?? "")
                      const key = `${purpose}:${guardianId}:${String(task.sessionId ?? task.backupDraftId ?? idx)}`
                      const busy = guardianActionBusy === key

                      return (
                        <div key={key} className="rounded border border-[#2a475e] bg-[#111a28] p-3">
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-[#c7d5e0]">
                            <span className="rounded border border-[#2a475e] px-2 py-0.5 uppercase">{purpose}</span>
                            <span className="font-mono text-[#8f98a0]">guardianId={guardianId}</span>
                          </div>
                          <pre className="overflow-auto rounded border border-[#2a475e] bg-[#0f1b2b] p-2 text-[11px] text-[#8f98a0]">
                            {pretty(task)}
                          </pre>
                          <div className="mt-2">
                            <SteamButton onClick={() => void handleGuardianTask(task)} disabled={busy} className="max-w-56">
                              {busy ? "PROCESSING..." : "APPROVE & SIGN"}
                            </SteamButton>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-[#8f98a0]">No pending guardian tasks for this wallet.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {showGuardianModal ? (
        <GuardianModal
          onClose={() => setShowGuardianModal(false)}
          currentUsername={currentUsername}
          onGuardiansConfirmed={(config) => {
            setGuardianConfig(config)
            setPendingBackup(null)
            setPreparedBackup(null)
            setBackupDraftId("")
            setPublishedBackupId(null)
            setPublishTxHash(null)
          }}
        />
      ) : null}
    </div>
  )
}
