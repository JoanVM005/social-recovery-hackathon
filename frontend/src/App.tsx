import { useState } from "react"
import { TopBar } from "@/components/layout/TopBar"
import { Navbar } from "@/components/layout/Navbar"
import { SubNav } from "@/components/layout/SubNav"
import { StorePage } from "@/pages/StorePage"
import { LoginPage } from "@/pages/LoginPage"
import { ConnectWalletPage } from "@/pages/ConnectWalletPage"
import { SecretKeyDrawer } from "@/components/ui/SecretKeyDrawer"
import { GuardianModal } from "@/components/guardian/GuardianModal"
import { saveUser, generateUserId } from "@/lib/userStore"

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
  const [secretKey, setSecretKey] = useState<string | null>(null)
  const [showGuardians, setShowGuardians] = useState(false)

  function handleConnected() {
    setSecretKey(generateSecretKey())
    saveUser({ id: generateUserId(), createdAt: new Date().toISOString() })
    setPage("store")
  }

  if (page === "login") {
    return <LoginPage onLogin={() => setPage("store")} onSignUp={() => setPage("connect-wallet")} />
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
      {secretKey && (
        <SecretKeyDrawer secretKey={secretKey} onDismiss={() => setSecretKey(null)} />
      )}
      {showGuardians && <GuardianModal onClose={() => setShowGuardians(false)} />}
    </div>
  )
}

export default App
