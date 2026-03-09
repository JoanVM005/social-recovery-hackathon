import { useState } from "react"
import { X } from "lucide-react"
import { FRIENDS } from "@/components/store/FriendsList"
import { GuardianConfigStep } from "./GuardianConfigStep"
import { GuardianSelectStep } from "./GuardianSelectStep"

interface Props { onClose: () => void }

export function GuardianModal({ onClose }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [totalGuardians, setTotalGuardians] = useState(3)
  const [threshold, setThreshold] = useState(2)
  const [selected, setSelected] = useState<string[]>([])

  function toggleFriend(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    )
  }

  function handleConfirm() {
    // TODO: persist guardian config
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-lg border border-[#2a475e] p-6 shadow-[0_8px_60px_rgba(0,0,0,0.8)]"
        style={{ background: "linear-gradient(180deg, #1e2d3d 0%, #1b2838 100%)" }}
      >
        <button onClick={onClose} className="absolute right-3 top-3 text-[#636363] hover:text-white cursor-pointer">
          <X className="h-4 w-4" />
        </button>

        {step === 1 ? (
          <GuardianConfigStep
            totalGuardians={totalGuardians}
            threshold={threshold}
            maxGuardians={FRIENDS.length}
            onTotalChange={setTotalGuardians}
            onThresholdChange={setThreshold}
            onNext={() => { setSelected([]); setStep(2) }}
          />
        ) : (
          <GuardianSelectStep
            totalGuardians={totalGuardians}
            selected={selected}
            onToggle={toggleFriend}
            onBack={() => setStep(1)}
            onConfirm={handleConfirm}
          />
        )}
      </div>
    </div>
  )
}
