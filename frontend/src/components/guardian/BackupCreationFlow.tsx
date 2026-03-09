import { useState, useEffect } from "react"
import { useAccount, usePublicClient, useWriteContract } from "wagmi"
import { keccak256, encodePacked } from "viem"
import { ShieldCheck, Loader, CheckCircle, Circle, X, ExternalLink, AlertCircle } from "lucide-react"
import { SteamButton } from "@/components/ui/steam-button"
import {
  secretKeyToScalar,
  deriveGuardianSigma,
  computeBackupArgs,
  type GuardianShare,
  type BackupArgs,
} from "@/lib/protocol"
import {
  CONTRACT_ADDRESS,
  OFFCHAIN_BOARD_ABI,
  DEMO_PARTY_IDS,
} from "@/lib/contract"

// Merged lookup: backend-supplied IDs take precedence over the static demo map.
function resolvePartyId(name: string, partyIds: Record<string, bigint>): bigint {
  if (partyIds[name] != null) return partyIds[name]
  const demo = DEMO_PARTY_IDS[name]
  if (demo != null) return demo
  throw new Error(`No party ID found for "${name}". Ensure the guardian has registered on-chain.`)
}

// ═══════════════════════════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════════════════════════

type Step =
  | "collecting"   // waiting for guardian responses
  | "ready"        // all guardians responded
  | "computing"    // running protocol math
  | "registering"  // registerParty TX
  | "publishing"   // publishBackup TX
  | "confirming"   // waiting for TX confirmation
  | "done"         // backup stored successfully
  | "error"        // something went wrong

interface Props {
  /** The owner's secret key (e.g. "a1b2-c3d4-…"). */
  secretKey: string
  /** Number of guardians required to recover (UI counter value). */
  threshold: number
  /** Names of selected friends. */
  selectedGuardians: string[]
  /** username → on-chain party ID, sourced from the backend /users endpoint. */
  partyIds: Record<string, bigint>
  /** Guardian name → their submitted secret code. */
  guardianResponses: Record<string, string>
  /** Called when the user dismisses the flow. */
  onClose: () => void
}

// ═══════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════

export function BackupCreationFlow({
  secretKey,
  threshold,
  selectedGuardians,
  partyIds,
  guardianResponses,
  onClose,
}: Props) {
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [step, setStep] = useState<Step>("collecting")
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [backupArgs, setBackupArgs] = useState<BackupArgs | null>(null)

  // ── Auto-transition: collecting → ready ──────────────────────────────
  const respondedCount = selectedGuardians.filter((n) => guardianResponses[n]).length
  const allResponded = respondedCount === selectedGuardians.length

  useEffect(() => {
    if (step === "collecting" && allResponded) {
      setStep("ready")
    }
  }, [step, allResponded])

  // ── Finalize handler ─────────────────────────────────────────────────
  async function handleFinalize() {
    if (!address || !publicClient) return

    try {
      // ── Step 1: Compute guardian shares σ ─────────────────────────────
      setStep("computing")
      const backupNonce = BigInt(Date.now())
      const secretScalar = secretKeyToScalar(secretKey)

      const guardianShares: GuardianShare[] = selectedGuardians.map((name) => {
        const id = resolvePartyId(name, partyIds)
        const sigma = deriveGuardianSigma(
          secretKey,
          guardianResponses[name],
          id,
          backupNonce,
        )
        return { id, sigma }
      })

      // ── Steps 2 + 3: Build polynomial & compute public values φ ─────
      const args = computeBackupArgs(
        secretScalar,
        guardianShares,
        threshold,
        backupNonce,
      )
      setBackupArgs(args)

      console.log("[Backup] Computed backup args:", {
        guardianIds: args.guardianIds.map(String),
        t: args.t,
        backupNonce: args.backupNonce.toString(),
        publicPoints: args.publicPoints.map(String),
      })

      // ── Check / register party on-chain ──────────────────────────────
      const partyId = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: OFFCHAIN_BOARD_ABI,
        functionName: "partyIdOfSigner",
        args: [address],
      })

      if (partyId === 0n) {
        setStep("registering")
        const pkCommitment = keccak256(
          encodePacked(["string"], [secretKey]),
        )
        const regHash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: OFFCHAIN_BOARD_ABI,
          functionName: "registerParty",
          args: [pkCommitment],
        })
        await publicClient.waitForTransactionReceipt({ hash: regHash })
      }

      // ── Step 4: Publish backup on Sepolia ────────────────────────────
      // Pre-flight: verify all guardian IDs are registered on-chain.
      // If a guardian wallet hasn't called registerParty yet the contract
      // would revert with InvalidGuardianSet — surface a clear error here.
      for (const gid of args.guardianIds) {
        const allIds = { ...Object.fromEntries(Object.entries(DEMO_PARTY_IDS)), ...Object.fromEntries(Object.entries(partyIds)) }
        const name = Object.entries(allIds).find(([, id]) => id === gid)?.[0] ?? `ID ${gid}`
        const result = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: OFFCHAIN_BOARD_ABI,
          functionName: "parties",
          args: [gid],
        })
        const registered: boolean = result[0]
        if (!registered) {
          throw new Error(
            `Guardian "${name}" (party ID ${gid}) is not registered on-chain. ` +
            `Run the guardian wallet setup and call registerParty before creating a backup.`
          )
        }
      }

      setStep("publishing")
      const pubHash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: OFFCHAIN_BOARD_ABI,
        functionName: "publishBackup",
        args: [
          args.guardianIds,
          args.t,
          args.backupNonce,
          args.publicPoints,
        ],
      })
      setTxHash(pubHash)

      // ── Wait for confirmation ────────────────────────────────────────
      setStep("confirming")
      await publicClient.waitForTransactionReceipt({ hash: pubHash })

      // ── Step 5: Done ─────────────────────────────────────────────────
      setStep("done")
    } catch (err: unknown) {
      console.error("[Backup] Error:", err)
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep("error")
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  //  Render
  // ═════════════════════════════════════════════════════════════════════

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-lg border border-[#2a475e] p-6 shadow-[0_8px_60px_rgba(0,0,0,0.8)]"
        style={{ background: "linear-gradient(180deg, #1e2d3d 0%, #1b2838 100%)" }}
      >
        {/* Close button (only while collecting or after done/error) */}
        {(step === "collecting" || step === "ready" || step === "done" || step === "error") && (
          <button
            onClick={onClose}
            className="absolute right-3 top-3 text-[#636363] hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-5">
          <ShieldCheck className="h-5 w-5 text-[#67c1f5] shrink-0" />
          <div>
            <h2 className="text-white text-sm font-bold tracking-wide">
              {step === "done" ? "BACKUP STORED" : "BACKUP CREATION"}
            </h2>
            <p className="text-[#8f98a0] text-xs mt-0.5">
              {step === "done"
                ? "Recovery backup stored on Sepolia"
                : step === "error"
                  ? "An error occurred"
                  : step === "collecting"
                    ? "Waiting for guardian responses…"
                    : step === "ready"
                      ? "All guardians responded — ready to finalize"
                      : "Processing backup…"}
            </p>
          </div>
        </div>

        {/* ── Guardian response list ──────────────────────────────────── */}
        {(step === "collecting" || step === "ready") && (
          <>
            <div className="mb-2 flex justify-between text-xs text-[#8f98a0]">
              <span>Guardian responses</span>
              <span>
                <span className="text-[#beee11]">{respondedCount}</span>/{selectedGuardians.length}
              </span>
            </div>
            <ul className="mb-5 space-y-1.5">
              {selectedGuardians.map((name) => {
                const responded = !!guardianResponses[name]
                return (
                  <li
                    key={name}
                    className="flex items-center gap-3 rounded-sm border border-[#2a475e] bg-[#162330] px-4 py-2.5"
                  >
                    {responded ? (
                      <CheckCircle className="h-4 w-4 text-[#beee11] shrink-0" />
                    ) : (
                      <Loader className="h-4 w-4 text-[#67c1f5] animate-spin shrink-0" />
                    )}
                    <span className="flex-1 text-sm text-[#c7d5e0]">{name}</span>
                    <span className="text-[10px] text-[#636363]">
                      {responded ? "responded" : "waiting…"}
                    </span>
                  </li>
                )
              })}
            </ul>
            <SteamButton onClick={handleFinalize} disabled={!allResponded}>
              FINALIZE BACKUP →
            </SteamButton>
          </>
        )}

        {/* ── Processing steps ────────────────────────────────────────── */}
        {["computing", "registering", "publishing", "confirming"].includes(step) && (
          <ul className="mb-5 space-y-2.5">
            <StepRow
              label="Computing guardian shares σ"
              state={stepState("computing", step)}
            />
            <StepRow
              label="Building recovery polynomial"
              state={stepState("computing", step)}
            />
            <StepRow
              label="Computing public values φ"
              state={stepState("computing", step)}
            />
            <StepRow
              label="Registering party on-chain"
              state={stepState("registering", step)}
            />
            <StepRow
              label="Publishing backup to Sepolia"
              state={stepState("publishing", step)}
            />
            <StepRow
              label="Waiting for confirmation"
              state={stepState("confirming", step)}
            />
          </ul>
        )}

        {["computing", "registering", "publishing", "confirming"].includes(step) && (
          <p className="text-center text-xs text-[#8f98a0]">
            {step === "publishing" || step === "registering"
              ? "Please confirm the transaction in MetaMask"
              : step === "confirming"
                ? "Waiting for on-chain confirmation…"
                : "Computing…"}
          </p>
        )}

        {/* ── Success ─────────────────────────────────────────────────── */}
        {step === "done" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-sm border border-[#2a475e] bg-[#162330] px-4 py-4 text-center">
              <CheckCircle className="mx-auto h-8 w-8 text-[#beee11] mb-2" />
              <p className="text-sm text-[#c7d5e0] mb-1">
                Your recovery backup has been stored on Sepolia.
              </p>
              {backupArgs && (
                <p className="text-[10px] text-[#636363]">
                  threshold t={backupArgs.t} · {backupArgs.publicPoints.length} public point(s)
                </p>
              )}
            </div>
            {txHash && (
              <a
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-xs text-[#67c1f5] hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View on Etherscan
              </a>
            )}
            <SteamButton onClick={onClose}>DONE</SteamButton>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {step === "error" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-sm border border-red-900/40 bg-red-950/30 px-4 py-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300 break-all">{errorMsg}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setStep("ready"); setErrorMsg(null) }}
                className="flex-1 py-2 rounded-sm border border-[#2a475e] text-[#8f98a0] hover:text-white hover:border-[#c6d4df] text-xs transition-colors cursor-pointer"
              >
                RETRY
              </button>
              <SteamButton onClick={onClose} className="flex-1">
                CLOSE
              </SteamButton>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
//  Internal helpers
// ═══════════════════════════════════════════════════════════════════════

const STEP_ORDER: Step[] = [
  "collecting",
  "ready",
  "computing",
  "registering",
  "publishing",
  "confirming",
  "done",
]

function stepState(
  target: Step,
  current: Step,
): "done" | "active" | "pending" {
  const ti = STEP_ORDER.indexOf(target)
  const ci = STEP_ORDER.indexOf(current)
  if (ci > ti) return "done"
  if (ci === ti) return "active"
  return "pending"
}

function StepRow({ label, state }: { label: string; state: "done" | "active" | "pending" }) {
  return (
    <li className="flex items-center gap-3">
      {state === "done" && <CheckCircle className="h-4 w-4 text-[#beee11] shrink-0" />}
      {state === "active" && <Loader className="h-4 w-4 text-[#67c1f5] animate-spin shrink-0" />}
      {state === "pending" && <Circle className="h-4 w-4 text-[#2a475e] shrink-0" />}
      <span
        className={`text-sm ${
          state === "done"
            ? "text-[#8f98a0]"
            : state === "active"
              ? "text-white"
              : "text-[#3d4450]"
        }`}
      >
        {label}
      </span>
    </li>
  )
}
