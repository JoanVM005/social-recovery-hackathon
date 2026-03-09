import { useAccount, useConnect, useDisconnect } from "wagmi"
import { injected } from "wagmi/connectors"
import { Wallet, CheckCircle, AlertCircle, Loader } from "lucide-react"
import { SteamButton } from "@/components/ui/steam-button"
import steamLogo from "@/assets/logo_steam.svg"

export function ConnectWalletPage({ onConnected }: { onConnected: (address: `0x${string}`) => void }) {
  const { address, isConnected } = useAccount()
  const { connect, isPending, isError } = useConnect()
  const { disconnect } = useDisconnect()

  function connectMetaMask() {
    connect({ connector: injected() })
  }

  function switchWallet() {
    disconnect()
    // Re-open wallet selection flow after disconnecting current account.
    setTimeout(() => connectMetaMask(), 50)
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "radial-gradient(ellipse at 50% 0%, #2a475e 0%, #1b2838 40%, #0e1720 100%)" }}
    >
      <img src={steamLogo} alt="Steam" className="h-14 mb-8 opacity-90" />

      <div className="w-full max-w-[420px] rounded-sm shadow-[0_0_40px_rgba(0,0,0,0.6)] overflow-hidden border border-[#2a475e]/40">
        <div className="bg-[#1e2738] border-b-2 border-[#67c1f5] py-3.5 text-center text-xs font-bold tracking-[0.12em] text-white">
          CONNECT YOUR WALLET
        </div>

        <div className="bg-[#1e2738] px-8 py-8 flex flex-col gap-6">
          <p className="text-[#8f98a0] text-xs leading-relaxed">
            AnarKey uses your MetaMask wallet for social recovery. Connect your wallet to finish setting up your account.
          </p>

          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#2a475e] bg-[#162330]">
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg"
                alt="MetaMask"
                className="h-11 w-11"
              />
            </div>

            {!isConnected && !isPending && !isError && (
              <p className="text-[#8f98a0] text-xs">MetaMask not connected</p>
            )}
            {isPending && (
              <div className="flex items-center gap-2 text-[#67c1f5] text-xs">
                <Loader className="h-3.5 w-3.5 animate-spin" /> Waiting for MetaMask…
              </div>
            )}
            {isConnected && address && (
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5 text-[#beee11] text-xs">
                  <CheckCircle className="h-3.5 w-3.5" /> Wallet connected
                </div>
                <span className="text-[#8f98a0] text-[10px] font-mono">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
              </div>
            )}
            {isError && (
              <div className="flex items-center gap-1.5 text-red-400 text-xs">
                <AlertCircle className="h-3.5 w-3.5" />
                {typeof (window as any).ethereum === "undefined"
                  ? "MetaMask not found. Please install it first."
                  : "Connection rejected. Please try again."}
              </div>
            )}
          </div>

          {!isConnected ? (
            <SteamButton onClick={connectMetaMask} disabled={isPending}>
              <div className="flex items-center justify-center gap-2">
                <Wallet className="h-4 w-4" />
                {isPending ? "CONNECTING..." : "CONNECT METAMASK"}
              </div>
            </SteamButton>
          ) : (
            <div className="flex flex-col gap-2">
              <SteamButton onClick={() => onConnected(address as `0x${string}`)}>
                USE THIS WALLET
              </SteamButton>
              <button
                type="button"
                onClick={switchWallet}
                className="rounded border border-[#2a475e] px-3 py-2 text-xs text-[#8f98a0] hover:text-white"
              >
                CONNECT DIFFERENT WALLET
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="mt-8 text-[#8f98a0] text-[11px] tracking-wide">© 2025 AnarKey · All rights reserved.</p>
    </div>
  )
}
