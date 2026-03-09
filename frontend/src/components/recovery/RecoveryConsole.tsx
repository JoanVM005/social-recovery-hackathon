import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useAccount, usePublicClient, useWalletClient, useWriteContract } from "wagmi"
import { decodeEventLog, isHex } from "viem"
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react"

import { SteamButton } from "@/components/ui/steam-button"
import { Input } from "@/components/ui/input"
import {
  api,
  type BackupPreparePendingResponse,
  type BackupPrepareReadyResponse,
  type BackupViewResponse,
} from "@/lib/api"
import { CONTRACT_ADDRESS, OFFCHAIN_BOARD_ABI } from "@/lib/contract"

function splitCsv(input: string): string[] {
  return input
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

function parseGuardianIds(input: string): string[] {
  return splitCsv(input).filter((x) => /^\d+$/.test(x))
}

function toBigIntArray(values: string[]): bigint[] {
  return values.map((x) => BigInt(x))
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
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

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-[#2a475e] bg-[#132234] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-bold tracking-wide text-white">{title}</h3>
        {subtitle ? <p className="text-xs text-[#8f98a0]">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" }) {
  const cls =
    tone === "good"
      ? "border-[#4c6b22] text-[#beee11]"
      : tone === "warn"
        ? "border-yellow-600/40 text-yellow-300"
        : "border-[#2a475e] text-[#8f98a0]"
  return <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>{children}</span>
}

function ErrorText({ value }: { value: string | null }) {
  if (!value) return null
  return (
    <div className="mt-2 flex items-start gap-2 rounded border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="break-all">{value}</span>
    </div>
  )
}

export function RecoveryConsole() {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { writeContractAsync } = useWriteContract()

  const [partyId, setPartyId] = useState<string>("0")
  const [partyLoading, setPartyLoading] = useState(false)
  const [partyPrep, setPartyPrep] = useState<{ pkCommitment: `0x${string}`; chainId: string } | null>(null)
  const [partyErr, setPartyErr] = useState<string | null>(null)
  const [registerTx, setRegisterTx] = useState<string | null>(null)

  const [secretScalar, setSecretScalar] = useState("1234")
  const [guardianIdsInput, setGuardianIdsInput] = useState("2,3,4")
  const [thresholdInput, setThresholdInput] = useState("2")
  const [backupNonceInput, setBackupNonceInput] = useState("")
  const [backupMode, setBackupMode] = useState<"demo" | "real">("demo")
  const [backupDraftId, setBackupDraftId] = useState<string>("")
  const [preparedBackup, setPreparedBackup] = useState<BackupPrepareReadyResponse | null>(null)
  const [pendingBackup, setPendingBackup] = useState<BackupPreparePendingResponse | null>(null)
  const [backupErr, setBackupErr] = useState<string | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [publishTx, setPublishTx] = useState<string | null>(null)
  const [publishedBackupId, setPublishedBackupId] = useState<string | null>(null)

  const [lookupBackupId, setLookupBackupId] = useState("")
  const [backupView, setBackupView] = useState<BackupViewResponse | null>(null)
  const [backupViewErr, setBackupViewErr] = useState<string | null>(null)

  const [openRecoveryBackupId, setOpenRecoveryBackupId] = useState("")
  const [openRecoveryPrepare, setOpenRecoveryPrepare] = useState<Record<string, unknown> | null>(null)
  const [openRecoveryErr, setOpenRecoveryErr] = useState<string | null>(null)
  const [openRecoveryTx, setOpenRecoveryTx] = useState<string | null>(null)
  const [openedSessionId, setOpenedSessionId] = useState<string>("")

  const [sessionIdInput, setSessionIdInput] = useState("")
  const [sessionErr, setSessionErr] = useState<string | null>(null)

  const [guardianIdInput, setGuardianIdInput] = useState("")
  const [guardianMode, setGuardianMode] = useState<"demo" | "real">("demo")
  const [guardianErr, setGuardianErr] = useState<string | null>(null)
  const [guardianBusyKey, setGuardianBusyKey] = useState<string>("")

  const [reconstructBackupId, setReconstructBackupId] = useState("")
  const [reconstructSessionId, setReconstructSessionId] = useState("")
  const [reconstructGuardianIds, setReconstructGuardianIds] = useState("")
  const [reconstructResult, setReconstructResult] = useState<Record<string, unknown> | null>(null)
  const [reconstructErr, setReconstructErr] = useState<string | null>(null)
  const [reconstructLoading, setReconstructLoading] = useState(false)

  const activeSessionId = sessionIdInput.trim() || openedSessionId

  const dashboardQuery = useQuery({
    queryKey: ["dashboard-state"],
    queryFn: () => api.getDashboardState(),
    refetchInterval: 8000,
  })

  const demoAdminQuery = useQuery({
    queryKey: ["demo-admin-config"],
    queryFn: () => api.getDemoAdminConfig(),
    refetchInterval: 15000,
  })

  const guardianTasksQuery = useQuery({
    queryKey: ["guardian-tasks", guardianIdInput.trim(), address ?? ""],
    queryFn: () =>
      api.getGuardianTasks({
        guardianId: guardianIdInput.trim() || undefined,
        guardianAddress: guardianIdInput.trim() ? undefined : address,
      }),
    enabled: Boolean(guardianIdInput.trim() || address),
    refetchInterval: 5000,
  })

  const sessionQuery = useQuery({
    queryKey: ["recovery-session", activeSessionId],
    queryFn: () => api.getRecovery(activeSessionId),
    enabled: Boolean(activeSessionId),
    refetchInterval: activeSessionId ? 5000 : false,
  })

  useEffect(() => {
    let cancelled = false

    async function refreshPartyId() {
      if (!publicClient || !address) {
        setPartyId("0")
        return
      }
      try {
        const id = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: OFFCHAIN_BOARD_ABI,
          functionName: "partyIdOfSigner",
          args: [address],
        })
        if (!cancelled) setPartyId((id as bigint).toString())
      } catch {
        if (!cancelled) setPartyId("0")
      }
    }

    refreshPartyId()

    return () => {
      cancelled = true
    }
  }, [address, publicClient])

  useEffect(() => {
    const suggested = demoAdminQuery.data?.expected?.secretDemo
    if (suggested && /^\d+$/.test(suggested)) {
      setSecretScalar((prev) => (prev === "1234" ? suggested : prev))
    }
  }, [demoAdminQuery.data?.expected?.secretDemo])

  const parsedGuardianIds = useMemo(() => parseGuardianIds(guardianIdsInput), [guardianIdsInput])

  async function handlePrepareParty() {
    if (!address) return
    setPartyErr(null)
    setPartyLoading(true)
    try {
      const res = await api.partyRegisterPrepare(address)
      setPartyPrep({ pkCommitment: res.pkCommitment, chainId: res.chainId })
      setPartyId(res.partyId)
    } catch (error) {
      setPartyErr(error instanceof Error ? error.message : String(error))
    } finally {
      setPartyLoading(false)
    }
  }

  async function handleRegisterPartyOnchain() {
    if (!publicClient || !address || !partyPrep) return
    setPartyErr(null)
    setPartyLoading(true)
    try {
      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: OFFCHAIN_BOARD_ABI,
        functionName: "registerParty",
        args: [partyPrep.pkCommitment],
      })
      setRegisterTx(txHash)
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      const id = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: OFFCHAIN_BOARD_ABI,
        functionName: "partyIdOfSigner",
        args: [address],
      })
      setPartyId((id as bigint).toString())
    } catch (error) {
      setPartyErr(error instanceof Error ? error.message : String(error))
    } finally {
      setPartyLoading(false)
    }
  }

  async function handlePrepareBackup(finalizeDraft = false) {
    if (!address) {
      setBackupErr("Connect a wallet first")
      return
    }

    setBackupErr(null)
    setBackupLoading(true)
    try {
      const payload = {
        ownerAddress: address,
        guardianIds: parsedGuardianIds,
        threshold: Number.parseInt(thresholdInput, 10),
        backupNonce: backupNonceInput.trim() || undefined,
        secretScalar,
        mode: backupMode,
        backupDraftId: finalizeDraft ? backupDraftId.trim() || undefined : undefined,
      } as const

      const response = await api.backupPrepare(payload)
      if (response.status === "ready") {
        setPreparedBackup(response)
        setPendingBackup(null)
        setBackupDraftId(response.backupDraftId)
      } else {
        setPreparedBackup(null)
        setPendingBackup(response)
        setBackupDraftId(response.backupDraftId)
      }
    } catch (error) {
      setBackupErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupLoading(false)
    }
  }

  async function handlePublishBackup() {
    if (!publicClient || !preparedBackup) return
    setBackupErr(null)
    setBackupLoading(true)
    try {
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
      setPublishTx(txHash)
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      const bid = decodeBackupIdFromReceipt(receipt)
      if (bid) {
        setPublishedBackupId(bid)
        setLookupBackupId(bid)
        const snapshot = await api.getBackup(bid)
        setBackupView(snapshot)
      }
    } catch (error) {
      setBackupErr(error instanceof Error ? error.message : String(error))
    } finally {
      setBackupLoading(false)
    }
  }

  async function handleLookupBackup() {
    if (!lookupBackupId.trim()) return
    setBackupViewErr(null)
    try {
      const response = await api.getBackup(lookupBackupId.trim())
      setBackupView(response)
      if (!reconstructBackupId.trim()) setReconstructBackupId(response.backupId)
    } catch (error) {
      setBackupViewErr(error instanceof Error ? error.message : String(error))
      setBackupView(null)
    }
  }

  async function handlePrepareOpenRecovery() {
    if (!openRecoveryBackupId.trim()) return
    setOpenRecoveryErr(null)
    try {
      const response = await api.recoveryOpenPrepare(openRecoveryBackupId.trim())
      setOpenRecoveryPrepare(response as unknown as Record<string, unknown>)
    } catch (error) {
      setOpenRecoveryErr(error instanceof Error ? error.message : String(error))
      setOpenRecoveryPrepare(null)
    }
  }

  async function handleOpenRecoveryOnchain() {
    if (!publicClient || !openRecoveryBackupId.trim()) return
    setOpenRecoveryErr(null)
    try {
      const txHash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: OFFCHAIN_BOARD_ABI,
        functionName: "openRecovery",
        args: [BigInt(openRecoveryBackupId.trim())],
      })
      setOpenRecoveryTx(txHash)
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      const sid = decodeSessionIdFromReceipt(receipt)
      if (sid) {
        setOpenedSessionId(sid)
        setSessionIdInput(sid)
        setReconstructSessionId(sid)
      }
    } catch (error) {
      setOpenRecoveryErr(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleLoadSession() {
    if (!activeSessionId) return
    setSessionErr(null)
    try {
      await sessionQuery.refetch()
    } catch (error) {
      setSessionErr(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleGuardianTask(task: Record<string, unknown>) {
    const purpose = String(task.purpose ?? "") as "backup_setup" | "recovery_session"
    const guardianId = String(task.guardianId ?? guardianIdInput.trim())
    const busyKey = `${purpose}:${guardianId}:${String(task.sessionId ?? task.backupDraftId ?? "")}`

    setGuardianErr(null)
    setGuardianBusyKey(busyKey)

    try {
      if (guardianMode === "demo") {
        await api.guardianSign({
          purpose,
          mode: "demo",
          guardianId,
          sessionId: typeof task.sessionId === "string" ? task.sessionId : undefined,
          backupDraftId: typeof task.backupDraftId === "string" ? task.backupDraftId : undefined,
          submitOnchain: true,
        })
      } else {
        if (!walletClient || !address) {
          throw new Error("Wallet is required for real guardian mode")
        }

        const prepare = await api.guardianSign({
          purpose,
          mode: "real",
          guardianId,
          sessionId: typeof task.sessionId === "string" ? task.sessionId : undefined,
          backupDraftId: typeof task.backupDraftId === "string" ? task.backupDraftId : undefined,
          submitOnchain: false,
        })

        const digestRaw = String(prepare.digest ?? "")
        if (!isHex(digestRaw)) {
          throw new Error("Invalid digest returned by backend")
        }

        const signature = (await walletClient.request({
          method: "eth_sign",
          params: [address, digestRaw],
        })) as `0x${string}`

        await api.guardianSign({
          purpose,
          mode: "real",
          guardianId,
          sessionId: typeof task.sessionId === "string" ? task.sessionId : undefined,
          backupDraftId: typeof task.backupDraftId === "string" ? task.backupDraftId : undefined,
          signature,
          submitOnchain: false,
        })

        if (purpose === "recovery_session") {
          const sessionId = String(task.sessionId ?? "")
          if (!sessionId) throw new Error("Missing sessionId for recovery contribution")
          if (!publicClient) throw new Error("Public client not available")

          const txHash = await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: OFFCHAIN_BOARD_ABI,
            functionName: "submitDeterministicSignature",
            args: [BigInt(sessionId), signature],
          })
          await publicClient.waitForTransactionReceipt({ hash: txHash })
        }
      }

      await guardianTasksQuery.refetch()
      if (activeSessionId) await sessionQuery.refetch()
    } catch (error) {
      setGuardianErr(error instanceof Error ? error.message : String(error))
    } finally {
      setGuardianBusyKey("")
    }
  }

  async function handleReconstruct() {
    const bid = reconstructBackupId.trim()
    const sid = reconstructSessionId.trim()
    if (!bid || !sid) {
      setReconstructErr("backupId and sessionId are required")
      return
    }

    setReconstructErr(null)
    setReconstructLoading(true)
    try {
      const idsFromInput = parseGuardianIds(reconstructGuardianIds)
      const ids = idsFromInput.length > 0 ? idsFromInput : sessionQuery.data?.guardianIds ?? []
      if (ids.length === 0) throw new Error("Provide guardianIds or load a session first")
      const response = await api.recoveryReconstruct(bid, sid, ids)
      setReconstructResult(response as unknown as Record<string, unknown>)
    } catch (error) {
      setReconstructErr(error instanceof Error ? error.message : String(error))
      setReconstructResult(null)
    } finally {
      setReconstructLoading(false)
    }
  }

  return (
    <div className="rounded border border-[#2a475e] bg-[#0f1b2b] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-wide text-white">Recovery Console</h2>
          <p className="text-xs text-[#8f98a0]">ANARKey E2E demo · Off-chain crypto + On-chain bulletin board</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tag tone="good">SEPOLIA</Tag>
          <Tag>OFF-CHAIN: Backup Math</Tag>
          <Tag>ON-CHAIN: Board + Sessions</Tag>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded border border-[#2a475e] bg-[#132234] p-3 text-xs text-[#c7d5e0]">
          <div className="text-[#8f98a0]">Connected address</div>
          <div className="mt-1 font-mono">{address ?? "Not connected"}</div>
        </div>
        <div className="rounded border border-[#2a475e] bg-[#132234] p-3 text-xs text-[#c7d5e0]">
          <div className="text-[#8f98a0]">Current partyId</div>
          <div className="mt-1 font-mono">{partyId}</div>
        </div>
        <div className="rounded border border-[#2a475e] bg-[#132234] p-3 text-xs text-[#c7d5e0]">
          <div className="text-[#8f98a0]">Contract</div>
          <div className="mt-1 font-mono">{CONTRACT_ADDRESS}</div>
        </div>
      </div>

      <div className="grid gap-4">
        <Section title="Dashboard" subtitle="Backups, sessions and readiness with polling">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-sm text-[#c7d5e0]">
              Backups: <span className="font-bold text-white">{dashboardQuery.data?.counts.backups ?? 0}</span>
            </div>
            <div className="rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-sm text-[#c7d5e0]">
              Sessions: <span className="font-bold text-white">{dashboardQuery.data?.counts.sessions ?? 0}</span>
            </div>
            <div className="rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-sm text-[#c7d5e0]">
              Ready: <span className="font-bold text-[#beee11]">{dashboardQuery.data?.counts.readySessions ?? 0}</span>
            </div>
          </div>
          <div className="mt-3 flex gap-3">
            <SteamButton onClick={() => void dashboardQuery.refetch()} className="max-w-52">
              REFRESH DASHBOARD
            </SteamButton>
            {dashboardQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-[#67c1f5]" /> : null}
          </div>
        </Section>

        <Section title="Register Party" subtitle="Backend prepares pkCommitment (address_v1), wallet sends tx">
          <div className="grid gap-3 md:grid-cols-2">
            <SteamButton onClick={() => void handlePrepareParty()} disabled={!address || partyLoading}>
              {partyLoading ? "PREPARING…" : "PREPARE REGISTER PAYLOAD"}
            </SteamButton>
            <SteamButton
              onClick={() => void handleRegisterPartyOnchain()}
              disabled={!address || !partyPrep || partyLoading || partyId !== "0"}
            >
              {partyLoading ? "SENDING…" : "REGISTER PARTY ON-CHAIN"}
            </SteamButton>
          </div>
          {partyPrep ? (
            <pre className="mt-3 overflow-auto rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-[11px] text-[#c7d5e0]">
              {pretty(partyPrep)}
            </pre>
          ) : null}
          {registerTx ? <p className="mt-2 text-xs text-[#67c1f5]">tx: {registerTx}</p> : null}
          <ErrorText value={partyErr} />
        </Section>

        <Section title="Create Backup" subtitle="Off-chain signatures/sigmas/phi in backend, then publishBackup on-chain">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-[#8f98a0]">
              Secret scalar
              <Input className="steam-input mt-1" value={secretScalar} onChange={(e) => setSecretScalar(e.target.value)} />
            </label>
            <label className="text-xs text-[#8f98a0]">
              Guardian IDs (csv)
              <Input className="steam-input mt-1" value={guardianIdsInput} onChange={(e) => setGuardianIdsInput(e.target.value)} />
            </label>
            <label className="text-xs text-[#8f98a0]">
              Threshold required (shares)
              <Input className="steam-input mt-1" value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)} />
            </label>
            <label className="text-xs text-[#8f98a0]">
              Backup nonce (optional)
              <Input className="steam-input mt-1" value={backupNonceInput} onChange={(e) => setBackupNonceInput(e.target.value)} />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="text-xs text-[#8f98a0]">
              Mode
              <select
                value={backupMode}
                onChange={(e) => setBackupMode(e.target.value as "demo" | "real")}
                className="ml-2 rounded border border-[#2a475e] bg-[#0f1b2b] px-2 py-1 text-xs text-white"
              >
                <option value="demo">demo (burners)</option>
                <option value="real">real (guardian signatures)</option>
              </select>
            </label>
            <SteamButton onClick={() => void handlePrepareBackup(false)} disabled={backupLoading || !address} className="max-w-52">
              {backupLoading ? "PREPARING…" : "PREPARE BACKUP"}
            </SteamButton>
            <SteamButton
              onClick={() => void handlePrepareBackup(true)}
              disabled={backupLoading || !backupDraftId.trim()}
              className="max-w-60"
            >
              FINALIZE DRAFT (REAL MODE)
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

          <div className="mt-3 flex gap-3">
            <SteamButton onClick={() => void handlePublishBackup()} disabled={!preparedBackup || backupLoading} className="max-w-60">
              {backupLoading ? "PUBLISHING…" : "PUBLISH BACKUP ON-CHAIN"}
            </SteamButton>
            {publishTx ? <p className="self-center text-xs text-[#67c1f5]">tx: {publishTx}</p> : null}
            {publishedBackupId ? <p className="self-center text-xs text-[#beee11]">backupId: {publishedBackupId}</p> : null}
          </div>
          <ErrorText value={backupErr} />
        </Section>

        <Section title="Backups List" subtitle="Read backup snapshot + metadata from backend">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="steam-input max-w-xs"
              placeholder="backupId"
              value={lookupBackupId}
              onChange={(e) => setLookupBackupId(e.target.value)}
            />
            <SteamButton onClick={() => void handleLookupBackup()} className="max-w-48">
              LOAD BACKUP
            </SteamButton>
          </div>
          {backupView ? (
            <pre className="mt-3 overflow-auto rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-[11px] text-[#c7d5e0]">
              {pretty(backupView)}
            </pre>
          ) : null}
          <ErrorText value={backupViewErr} />
        </Section>

        <Section title="Open Recovery" subtitle="Prepare in backend, open session on-chain, parse sessionId from event">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="steam-input max-w-xs"
              placeholder="backupId"
              value={openRecoveryBackupId}
              onChange={(e) => setOpenRecoveryBackupId(e.target.value)}
            />
            <SteamButton onClick={() => void handlePrepareOpenRecovery()} className="max-w-52">
              PREPARE OPEN
            </SteamButton>
            <SteamButton onClick={() => void handleOpenRecoveryOnchain()} className="max-w-52">
              OPEN ON-CHAIN
            </SteamButton>
          </div>
          {openRecoveryPrepare ? (
            <pre className="mt-3 overflow-auto rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-[11px] text-[#c7d5e0]">
              {pretty(openRecoveryPrepare)}
            </pre>
          ) : null}
          {openRecoveryTx ? <p className="mt-2 text-xs text-[#67c1f5]">tx: {openRecoveryTx}</p> : null}
          {openedSessionId ? <p className="mt-1 text-xs text-[#beee11]">sessionId: {openedSessionId}</p> : null}
          <ErrorText value={openRecoveryErr} />
        </Section>

        <Section title="Guardian Tasks" subtitle="backup_setup / recovery_session with demo or real mode">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="steam-input max-w-xs"
              placeholder="guardianId (optional if connected)"
              value={guardianIdInput}
              onChange={(e) => setGuardianIdInput(e.target.value)}
            />
            <label className="text-xs text-[#8f98a0]">
              Mode
              <select
                value={guardianMode}
                onChange={(e) => setGuardianMode(e.target.value as "demo" | "real")}
                className="ml-2 rounded border border-[#2a475e] bg-[#0f1b2b] px-2 py-1 text-xs text-white"
              >
                <option value="demo">demo (burner submits tx)</option>
                <option value="real">real (metamask signs)</option>
              </select>
            </label>
            <SteamButton onClick={() => void guardianTasksQuery.refetch()} className="max-w-40">
              REFRESH TASKS
            </SteamButton>
          </div>

          {guardianTasksQuery.data?.tasks?.length ? (
            <div className="mt-3 space-y-2">
              {guardianTasksQuery.data.tasks.map((task, index) => {
                const purpose = String(task.purpose ?? "unknown")
                const guardianId = String(task.guardianId ?? "")
                const key = `${purpose}:${guardianId}:${String(task.sessionId ?? task.backupDraftId ?? index)}`
                const busy = guardianBusyKey === key

                return (
                  <div key={key} className="rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-xs text-[#c7d5e0]">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Tag>{purpose}</Tag>
                      <Tag tone={String(task.status) === "completed" ? "good" : "warn"}>{String(task.status ?? "pending")}</Tag>
                      <span className="font-mono text-[#8f98a0]">guardianId={guardianId}</span>
                    </div>
                    <pre className="overflow-auto rounded border border-[#2a475e] bg-[#111a28] p-2 text-[11px] text-[#8f98a0]">
                      {pretty(task)}
                    </pre>
                    <div className="mt-2">
                      <SteamButton onClick={() => void handleGuardianTask(task)} disabled={busy} className="max-w-60">
                        {busy ? "PROCESSING…" : "SIGN / SUBMIT TASK"}
                      </SteamButton>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="mt-3 text-xs text-[#8f98a0]">No pending tasks.</p>
          )}
          <ErrorText value={guardianErr} />
        </Section>

        <Section title="Recovery Session View" subtitle="Polling getSessionGuardianData + ready/not-ready">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="steam-input max-w-xs"
              placeholder="sessionId"
              value={sessionIdInput}
              onChange={(e) => setSessionIdInput(e.target.value)}
            />
            <SteamButton onClick={() => void handleLoadSession()} className="max-w-44">
              LOAD SESSION
            </SteamButton>
            {sessionQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin text-[#67c1f5]" /> : null}
          </div>
          {sessionQuery.data ? (
            <pre className="mt-3 overflow-auto rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-[11px] text-[#c7d5e0]">
              {pretty(sessionQuery.data)}
            </pre>
          ) : null}
          <ErrorText value={sessionErr ?? (sessionQuery.error instanceof Error ? sessionQuery.error.message : null)} />
        </Section>

        <Section title="Reconstruct Secret" subtitle="Run recover_secret.js off-chain and verify match">
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              className="steam-input"
              placeholder="backupId"
              value={reconstructBackupId}
              onChange={(e) => setReconstructBackupId(e.target.value)}
            />
            <Input
              className="steam-input"
              placeholder="sessionId"
              value={reconstructSessionId}
              onChange={(e) => setReconstructSessionId(e.target.value)}
            />
            <Input
              className="steam-input"
              placeholder="guardianIds csv (optional)"
              value={reconstructGuardianIds}
              onChange={(e) => setReconstructGuardianIds(e.target.value)}
            />
          </div>
          <div className="mt-3 flex gap-3">
            <SteamButton onClick={() => void handleReconstruct()} disabled={reconstructLoading} className="max-w-52">
              {reconstructLoading ? "RECONSTRUCTING…" : "RECONSTRUCT OFF-CHAIN"}
            </SteamButton>
          </div>
          {reconstructResult ? (
            <div className="mt-3 rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-xs text-[#c7d5e0]">
              <div className="mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#beee11]" />
                <span>
                  match = <strong className="text-[#beee11]">{String(reconstructResult.match)}</strong>
                </span>
              </div>
              <pre className="overflow-auto rounded border border-[#2a475e] bg-[#111a28] p-2 text-[11px] text-[#8f98a0]">
                {pretty(reconstructResult)}
              </pre>
            </div>
          ) : null}
          <ErrorText value={reconstructErr} />
        </Section>

        <Section title="Demo Admin" subtitle="Burners, expected IDs and network config">
          {demoAdminQuery.data ? (
            <pre className="overflow-auto rounded border border-[#2a475e] bg-[#0f1b2b] p-3 text-[11px] text-[#c7d5e0]">
              {pretty(demoAdminQuery.data)}
            </pre>
          ) : null}
          {demoAdminQuery.isFetching ? <p className="mt-2 text-xs text-[#8f98a0]">Loading demo config…</p> : null}
        </Section>
      </div>
    </div>
  )
}
