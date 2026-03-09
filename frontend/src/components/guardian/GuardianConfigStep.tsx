import { Minus, Plus, ShieldCheck, Users } from "lucide-react"
import { SteamButton } from "@/components/ui/steam-button"

interface Props {
  totalGuardians: number
  threshold: number
  maxGuardians: number
  onTotalChange: (n: number) => void
  onThresholdChange: (n: number) => void
  onNext: () => void
}

function Counter({ label, value, min, max, onChange, icon }: {
  label: string; value: number; min: number; max: number
  onChange: (n: number) => void; icon: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between rounded-sm border border-[#2a475e] bg-[#162330] px-4 py-3">
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm text-[#c7d5e0]">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#2a475e] bg-[#1b2838] text-[#67c1f5] hover:bg-[#2a475e] disabled:opacity-30 cursor-pointer"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-6 text-center text-lg font-bold text-white">{value}</span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#2a475e] bg-[#1b2838] text-[#67c1f5] hover:bg-[#2a475e] disabled:opacity-30 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export function GuardianConfigStep({ totalGuardians, threshold, maxGuardians, onTotalChange, onThresholdChange, onNext }: Props) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-[#67c1f5] shrink-0" />
        <div>
          <h2 className="text-white text-sm font-bold tracking-wide">GUARDIAN RECOVERY</h2>
          <p className="text-[#8f98a0] text-xs mt-0.5">Configure how many friends can help you recover your account.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Counter
          label="Total guardians"
          value={totalGuardians}
          min={1}
          max={maxGuardians}
          onChange={(n) => { onTotalChange(n); if (threshold > n) onThresholdChange(n) }}
          icon={<Users className="h-4 w-4 text-[#67c1f5]" />}
        />
        <Counter
          label="Required to recover"
          value={threshold}
          min={1}
          max={totalGuardians}
          onChange={onThresholdChange}
          icon={<ShieldCheck className="h-4 w-4 text-[#beee11]" />}
        />
      </div>

      <p className="text-center text-xs text-[#8f98a0]">
        <span className="text-[#beee11]">{threshold}</span> of{" "}
        <span className="text-[#67c1f5]">{totalGuardians}</span> guardians must approve to recover your account.
      </p>

      <SteamButton onClick={onNext}>CHOOSE GUARDIANS →</SteamButton>
    </div>
  )
}
