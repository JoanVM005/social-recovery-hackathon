import { useState, useCallback, useRef, useEffect } from "react"
import { useAccount, usePublicClient } from "wagmi"
import { TopBar } from "@/components/layout/TopBar"
import { Navbar } from "@/components/layout/Navbar"
import { SubNav } from "@/components/layout/SubNav"
import { StorePage } from "@/pages/StorePage"
import { LoginPage } from "@/pages/LoginPage"
import { ConnectWalletPage } from "@/pages/ConnectWalletPage"
import { SecretKeyDrawer } from "@/components/ui/SecretKeyDrawer"
import { GuardianModal } from "@/components/guardian/GuardianModal"
import { GuardianRequestFlow } from "@/components/guardian/GuardianRequestFlow"
import { BackupCreationFlow } from "@/components/guardian/BackupCreationFlow"
import { saveUser, generateUserId, getUser } from "@/lib/userStore"
import { useWebSocket } from "@/lib/useWebSocket"
import { CONTRACT_ADDRESS, OFFCHAIN_BOARD_ABI } from "@/lib/contract"

type Page = "login" | "connect-wallet" | "store"

function generateSecretKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .match(/.{4}/g)!.join("-")
}

function App() {
  const [page, setPage] = useState<Page>("login")
  const [pendingUsername, setPendingUsername] = useState("")
  const [secretKey, setSecretKey] = useState<string | null>(null)
  const [showSecretDrawer, setShowSecretDrawer] = useState(false)
  const [showGuardians, setShowGuardians] = useState(false)
  const [guardianRequest, setGuardianRequest] = useState<{
    userId: string
    username: string
    selectedNames: string[]  // names the owner selected their guardians by
  } | null>(null)

  // Backup creation state
  const [pendingBackup, setPendingBackup] = useState<{
    ownerId: string          // captured at start time — immune to localStorage overwrites
    threshold: number
    selectedGuardians: string[]
    partyIds: Record<string, bigint>
  } | null>(null)
  const [guardianResponses, setGuardianResponses] = useState<Record<string, string>>({})

  // Stable ref so the WS callback (memoised with []) can always read the latest ownerId
  const pendingBackupRef = useRef(pendingBackup)
  useEffect(() => { pendingBackupRef.current = pendingBackup }, [pendingBackup])

  const handleWsMessage = useCallback((data: unknown) => {
    const msg = data as {
      type: string
      value?: string
      username?: string
      selected_names?: string[]
      requester_id?: string
      guardian_slot?: string  // the FRIENDS display-name the guardian claimed
      guardian_secret?: string
      party_id?: number | null
      known?: boolean
    }

    if (msg.type === "identified") {
      console.log(`[WS] identified as "${msg.username}" (party_id=${msg.party_id}, known=${msg.known})`)
      return
    }

    if (msg.type === "guardian_request") {
      // Use a locally read user id (still reads localStorage but only compared to msg.value
      // which is the owner's id sent at the time they clicked confirm — safe even if
      // localStorage was since overwritten on a shared-browser setup).
      const myId = getUser()?.id
      if (msg.value && msg.value !== myId) {
        setGuardianRequest({
          userId: msg.value,
          username: msg.username ?? "Unknown",
          selectedNames: msg.selected_names ?? [],
        })
      }
    }

    // Collect guardian responses for the backup flow.
    // Use pendingBackupRef.current.ownerId so we always compare against the ID
    // captured at flow-start, even if localStorage was overwritten by a guardian
    // logging in in the same browser window.
    if (msg.type === "guardian_response") {
      const ownerId = pendingBackupRef.current?.ownerId
      if (ownerId && msg.requester_id === ownerId && msg.guardian_slot && msg.guardian_secret) {
        setGuardianResponses((prev) => ({ ...prev, [msg.guardian_slot!]: msg.guardian_secret! }))
      }
    }
  }, [])

  const { address } = useAccount()
  const publicClient = usePublicClient()

  const wsUsername = page === "store" ? (getUser()?.username ?? undefined) : undefined
  const { send } = useWebSocket(page === "store", handleWsMessage, wsUsername)

  // When entering the store, query our on-chain party ID and report it to the
  // backend so other users can look us up as a potential guardian.
  useEffect(() => {
    if (page !== "store" || !address || !publicClient) return
    let cancelled = false
    publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: OFFCHAIN_BOARD_ABI,
      functionName: "partyIdOfSigner",
      args: [address],
    }).then((id) => {
      if (!cancelled && id !== 0n) {
        send({ type: "set_party_id", party_id: Number(id) })
      }
    }).catch(() => { /* user not yet registered on-chain — that's fine */ })
    return () => { cancelled = true }
  }, [page, address, publicClient, send])

  function handleConnected() {
    const key = generateSecretKey()
    setSecretKey(key)
    setShowSecretDrawer(true)
    saveUser({ id: generateUserId(), username: pendingUsername, createdAt: new Date().toISOString() })
    setPage("store")
  }

  if (page === "login") {
    return <LoginPage onLogin={() => setPage("store")} onSignUp={(username) => { setPendingUsername(username); setPage("connect-wallet") }} />
  }

  if (page === "connect-wallet") {
    return <ConnectWalletPage onConnected={handleConnected} />
  }

  return (
    <div className="min-h-screen bg-[#1b2838] text-white">
      <div className="sticky top-0 z-50">
        <TopBar onLogout={() => setPage("login")} onChooseGuardians={() => setShowGuardians(true)} />
        <Navbar />
      </div>
      <SubNav />
      <StorePage />
      {showSecretDrawer && secretKey && (
        <SecretKeyDrawer secretKey={secretKey} onDismiss={() => setShowSecretDrawer(false)} />
      )}
      {guardianRequest && (
        <GuardianRequestFlow
          requesterUsername={guardianRequest.username}
          guardianSlots={guardianRequest.selectedNames}
          currentUsername={getUser()?.username}
          onDeny={() => setGuardianRequest(null)}
          onSubmitCode={(code, slot) => {
            // Send the guardian's secret back to the requester via WebSocket.
            // guardian_slot is the FRIENDS display-name the owner selected them by,
            // not the guardian's own username — this is how the owner matches the response.
            send({
              type: "guardian_response",
              requester_id: guardianRequest.userId,
              guardian_slot: slot,
              guardian_secret: code,
            })
            setGuardianRequest(null)
          }}
        />
      )}
      {showGuardians && (
        <GuardianModal
          onClose={() => setShowGuardians(false)}
          currentUsername={getUser()?.username}
          onGuardiansConfirmed={(config) => {
            const user = getUser()
            if (!user) return
            // Capture the owner's ID RIGHT NOW before any guardian might overwrite
            // localStorage (same-browser scenario).
            setPendingBackup({
              ownerId: user.id,
              threshold: config.threshold,
              selectedGuardians: config.selectedGuardians,
              partyIds: config.partyIds,
            })
            setGuardianResponses({})
            // Include selected_names so guardians know which slot to claim.
            send({
              type: "guardian_selected",
              user_id: user.id,
              username: user.username,
              selected_names: config.selectedGuardians,
            })
          }}
        />
      )}
      {pendingBackup && secretKey && (
        <BackupCreationFlow
          secretKey={secretKey}
          threshold={pendingBackup.threshold}
          selectedGuardians={pendingBackup.selectedGuardians}
          partyIds={pendingBackup.partyIds}
          guardianResponses={guardianResponses}
          onClose={() => { setPendingBackup(null); setGuardianResponses({}) }}
        />
      )}
    </div>
  )
}

export default App
