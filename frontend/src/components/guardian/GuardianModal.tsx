import { useState } from "react"
import { X } from "lucide-react"
import { GuardianConfigStep } from "./GuardianConfigStep"
import { GuardianSelectStep } from "./GuardianSelectStep"
import { useUsers } from "@/lib/useUsers"

interface GuardianConfig {
  threshold: number
  totalGuardians: number
  selectedGuardians: string[]
  /** username → on-chain party ID (bigint) for each selected guardian */
  partyIds: Record<string, bigint>
}

interface Props {
  onClose: () => void
  onGuardiansConfirmed?: (config: GuardianConfig) => void
  currentUsername?: string
}

export function GuardianModal({ onClose, onGuardiansConfirmed, currentUsername }: Props) {
  const [step, setStep] = useState<1 | 2>(1)
  const [totalGuardians, setTotalGuardians] = useState(3)
  const [threshold, setThreshold] = useState(2)
  const [selected, setSelected] = useState<string[]>([])

  const { users, loading } = useUsers()
  // Exclude the current user — you can't be your own guardian.
  const eligibleUsers = users.filter((u) => u.username !== currentUsername)

  function toggleFriend(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    )
  }

  function handleConfirm() {
    const partyIds: Record<string, bigint> = {}
    for (const u of eligibleUsers) {
      if (selected.includes(u.username) && u.party_id != null) {
        partyIds[u.username] = BigInt(u.party_id)
      }
    }
    onGuardiansConfirmed?.({ threshold, totalGuardians, selectedGuardians: selected, partyIds })
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
            maxGuardians={eligibleUsers.length}
            onTotalChange={setTotalGuardians}
            onThresholdChange={setThreshold}
            onNext={() => { setSelected([]); setStep(2) }}
          />
        ) : (
          <GuardianSelectStep
            totalGuardians={totalGuardians}
            selected={selected}
            users={eligibleUsers}
            loading={loading}
            onToggle={toggleFriend}
            onBack={() => setStep(1)}
            onConfirm={handleConfirm}
          />
        )}
      </div>
    </div>
  )
}
