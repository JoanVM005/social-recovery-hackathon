import { useState } from "react"
import { Copy, Check, ShieldAlert } from "lucide-react"
import { SteamButton } from "./steam-button"

interface Props {
  secretKey: string
  onDismiss: () => void
}

export function SecretKeyDrawer({ secretKey, onDismiss }: Props) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(secretKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDismiss} />

      {/* Drawer */}
      <div
        className="relative rounded-t-3xl border-t border-x border-[#2a475e] shadow-[0_-8px_60px_rgba(0,0,0,0.8)] animate-slide-up"
        style={{ background: "linear-gradient(180deg, #1e2d3d 0%, #1b2838 100%)" }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-[#2a475e]" />
        </div>

        <div className="px-6 pb-10 pt-4 flex flex-col gap-6 max-w-lg mx-auto w-full">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-[#67c1f5] shrink-0" />
            <div>
              <h2 className="text-white text-sm font-bold tracking-wide">YOUR SECRET KEY</h2>
              <p className="text-[#8f98a0] text-[15px] mt-0.5">Write this down and keep it safe. You will not see it again.</p>
            </div>
          </div>

          {/* Key display */}
          <div className="rounded-sm border border-[#2a475e] bg-[#162330] px-5 py-4">
            <p className="font-mono text-[#67c1f5] text-sm tracking-[0.15em] leading-8 break-all text-center select-all">
              {secretKey}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-4 py-2 rounded-sm border border-[#2a475e] bg-[#162330] text-[#8f98a0] hover:text-white hover:border-[#67c1f5] text-xs transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[#beee11]" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy"}
            </button>
            <SteamButton onClick={onDismiss} className="flex-1">
              I'VE WRITTEN IT DOWN →
            </SteamButton>
          </div>
        </div>
      </div>
    </div>
  )
}
