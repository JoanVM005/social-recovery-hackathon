import { useState } from "react"
import { ShieldCheck, X } from "lucide-react"
import { SteamButton } from "@/components/ui/steam-button"
import { Input } from "@/components/ui/input"

interface Props {
  requesterUsername: string
  /** Names the owner selected their guardians by (from their FRIENDS list). */
  guardianSlots: string[]
  onDeny: () => void
  /** Called with the guardian's secret code and the slot name they claimed. */
  onSubmitCode: (code: string, slot: string) => void
}

export function GuardianRequestFlow({ requesterUsername, guardianSlots, onDeny, onSubmitCode }: Props) {
  const [step, setStep] = useState<"prompt" | "secret">("prompt")
  const [code, setCode] = useState("")
  const [slot, setSlot] = useState(guardianSlots[0] ?? "")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onDeny} />
      <div
        className="relative w-full max-w-sm rounded-lg border border-[#2a475e] p-6 shadow-[0_8px_60px_rgba(0,0,0,0.8)]"
        style={{ background: "linear-gradient(180deg, #1e2d3d 0%, #1b2838 100%)" }}
      >
        <button onClick={onDeny} className="absolute right-3 top-3 text-[#636363] hover:text-white cursor-pointer">
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <ShieldCheck className="h-5 w-5 text-[#67c1f5] shrink-0" />
          <div>
            <h2 className="text-white text-sm font-bold tracking-wide">GUARDIAN REQUEST</h2>
            <p className="text-[#8f98a0] text-xs mt-0.5">Someone wants you as their guardian</p>
          </div>
        </div>

        {step === "prompt" ? (
          <PromptStep requesterUsername={requesterUsername} onDeny={onDeny} onAccept={() => setStep("secret")} />
        ) : (
          <SecretStep
            code={code}
            onChange={setCode}
            onSubmit={() => onSubmitCode(code, slot)}
          />
        )}
      </div>
    </div>
  )
}

function PromptStep({ requesterUsername, onDeny, onAccept }: {
  requesterUsername: string; onDeny: () => void; onAccept: () => void
}) {
  return (
    <>
      <p className="text-[#c7d5e0] text-sm mb-6">
        <span className="text-white font-semibold">{requesterUsername}</span> is requesting for you to be their guardian.
      </p>
      <div className="flex gap-3">
        <button
          onClick={onDeny}
          className="flex-1 py-2 rounded-sm border border-[#2a475e] text-[#8f98a0] hover:text-white hover:border-[#c6d4df] text-xs transition-colors cursor-pointer"
        >
          DENY
        </button>
        <SteamButton onClick={onAccept} className="flex-1">ACCEPT</SteamButton>
      </div>
    </>
  )
}

function SecretStep({ code, onChange, onSubmit }: {
  code: string
  onChange: (v: string) => void
  onSubmit: () => void
}) {
  return (
    <>
      <p className="text-[#8f98a0] text-xs mb-4">
        Enter your secret key to confirm you are who you say you are.
      </p>
      <div className="flex flex-col gap-4">
        <Input
          className="steam-input font-mono tracking-widest"
          placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
          value={code}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
        <SteamButton onClick={onSubmit} disabled={!code.trim()}>CONFIRM →</SteamButton>
      </div>
    </>
  )
}
