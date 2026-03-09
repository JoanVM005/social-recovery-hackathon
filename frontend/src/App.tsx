import { useEffect, useRef, useState } from "react"
import { useAccount } from "wagmi"
import { TopBar } from "@/components/layout/TopBar"
import { Navbar } from "@/components/layout/Navbar"
import { SubNav } from "@/components/layout/SubNav"
import { StorePage } from "@/pages/StorePage"
import { LoginPage } from "@/pages/LoginPage"
import { ConnectWalletPage } from "@/pages/ConnectWalletPage"
import { SecretKeyDrawer } from "@/components/ui/SecretKeyDrawer"
import { SocialRecoveryModal } from "@/components/recovery/SocialRecoveryModal"
import { api } from "@/lib/api"
import { generateUserId, getUser, saveUser, updateUser, type StoredUser } from "@/lib/userStore"

type Page = "login" | "connect-wallet" | "store"
type RecoveryMode = "assign" | "recover"

function generateSecretKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .match(/.{4}/g)!
    .join("-")
}

function App() {
  const { address } = useAccount()
  const [page, setPage] = useState<Page>("login")
  const [pendingUsername, setPendingUsername] = useState("")
  const [storedUser, setStoredUser] = useState<StoredUser | null>(() => getUser())
  const [secretKey, setSecretKey] = useState<string | null>(() => getUser()?.secretKey ?? null)
  const [showSecretDrawer, setShowSecretDrawer] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode | null>(null)
  const [latestBackupId, setLatestBackupId] = useState<string | null>(() => getUser()?.latestBackupId ?? null)

  const guardianAlertedSessions = useRef<Set<string>>(new Set())
  const ownerReadyAlertedSessions = useRef<Set<string>>(new Set())

  function handleConnected() {
    const key = generateSecretKey()
    const username = pendingUsername.trim() || storedUser?.username || "Player"
    const nowIso = new Date().toISOString()
    const user: StoredUser = {
      id: storedUser?.id ?? generateUserId(),
      username,
      createdAt: storedUser?.createdAt ?? nowIso,
      walletAddress: address,
      secretKey: key,
      latestBackupId: storedUser?.latestBackupId,
      latestBackupDraftId: storedUser?.latestBackupDraftId,
    }

    saveUser(user)
    setStoredUser(user)
    setSecretKey(key)
    setShowSecretDrawer(true)
    setPage("store")
  }

  useEffect(() => {
    if (address) {
      const next = updateUser({ walletAddress: address })
      if (next) {
        setStoredUser(next)
        if (next.latestBackupId) setLatestBackupId(next.latestBackupId)
      }
    }
  }, [address])

  useEffect(() => {
    if (page !== "store" || !address) return
    const activeAddress = address

    let cancelled = false

    async function pollAlerts() {
      try {
        const guardian = await api.getGuardianTasks({ guardianAddress: activeAddress })
        if (!cancelled) {
          for (const task of guardian.tasks) {
            if (task.purpose !== "recovery_session") continue
            const sessionId = String(task.sessionId ?? "")
            if (!sessionId || guardianAlertedSessions.current.has(sessionId)) continue
            guardianAlertedSessions.current.add(sessionId)
            window.alert(
              "Alerta: un miembro de tu comunidad necesita recuperar su llave. Abre tu perfil > Recover Secret Key para aprobar tu contribucion como guardian.",
            )
          }
        }
      } catch {
        // ignore background alert polling errors
      }

      try {
        const owner = await api.getOwnerSessions(activeAddress)
        if (!cancelled) {
          for (const session of owner.sessions) {
            if (!session.ready || session.closed) continue
            if (ownerReadyAlertedSessions.current.has(session.sessionId)) continue
            ownerReadyAlertedSessions.current.add(session.sessionId)
            window.alert(
              `Alerta: ya se recibieron los sigmas necesarios en la sesion ${session.sessionId}. Puedes reconstruir tu secret key en Recover Secret Key.`,
            )
          }
        }
      } catch {
        // ignore background alert polling errors
      }
    }

    void pollAlerts()
    const timer = window.setInterval(() => {
      void pollAlerts()
    }, 7000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [page, address])

  if (page === "login") {
    return (
      <LoginPage
        onLogin={() => {
          const existing = getUser()
          if (existing) {
            setStoredUser(existing)
            setSecretKey(existing.secretKey ?? null)
            setLatestBackupId(existing.latestBackupId ?? null)
          }
          setPage("store")
        }}
        onSignUp={(username) => {
          setPendingUsername(username)
          setPage("connect-wallet")
        }}
      />
    )
  }

  if (page === "connect-wallet") {
    return <ConnectWalletPage onConnected={handleConnected} />
  }

  return (
    <div className="min-h-screen bg-[#1b2838] text-white">
      <div className="sticky top-0 z-50">
        <TopBar
          username={storedUser?.username || pendingUsername || "Player"}
          onOpenAssignGuardians={() => setRecoveryMode("assign")}
          onOpenRecoverSecret={() => setRecoveryMode("recover")}
          onLogout={() => {
            setRecoveryMode(null)
            setPage("login")
          }}
        />
        <Navbar />
      </div>
      <SubNav />
      <StorePage />
      {recoveryMode ? (
        <SocialRecoveryModal
          mode={recoveryMode}
          onClose={() => setRecoveryMode(null)}
          currentUsername={storedUser?.username || pendingUsername || "Player"}
          secretKey={secretKey ?? storedUser?.secretKey ?? null}
          latestBackupId={latestBackupId}
          onBackupPublished={(backupId, backupDraftId) => {
            setLatestBackupId(backupId)
            const next = updateUser({
              latestBackupId: backupId,
              latestBackupDraftId: backupDraftId,
            })
            if (next) setStoredUser(next)
          }}
        />
      ) : null}
      {showSecretDrawer && secretKey ? (
        <SecretKeyDrawer secretKey={secretKey} onDismiss={() => setShowSecretDrawer(false)} />
      ) : null}
    </div>
  )
}

export default App
