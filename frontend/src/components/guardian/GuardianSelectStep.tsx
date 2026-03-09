import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SteamButton } from "@/components/ui/steam-button"
import { ArrowLeft, Check, Loader } from "lucide-react"
import type { BackendUser } from "@/lib/useUsers"

const statusColor: Record<string, string> = {
  online: "bg-[#57cbde]",
  offline: "bg-[#636363]",
}

interface Props {
  totalGuardians: number
  selected: string[]
  users: BackendUser[]
  loading: boolean
  onToggle: (name: string) => void
  onBack: () => void
  onConfirm: () => void
}

function FriendRow({ user, isSelected, onToggle }: {
  user: BackendUser; isSelected: boolean; onToggle: () => void
}) {
  const status = user.online ? "online" : "offline"
  return (
    <li
      onClick={onToggle}
      className={`flex cursor-pointer items-center gap-3 rounded px-3 py-2 transition ${
        isSelected ? "bg-[#1a3a4a] ring-1 ring-[#67c1f5]/40" : "hover:bg-[#1a3a4a]"
      }`}
    >
      <div className="relative">
        <Avatar className="h-9 w-9">
          <AvatarFallback className="bg-[#2a475e] text-xs text-[#c7d5e0]">{user.username[0]}</AvatarFallback>
        </Avatar>
        <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#162330] ${statusColor[status]}`} />
      </div>
      <span className="flex-1 text-sm text-[#c7d5e0]">{user.username}</span>
      {user.online && (
        <span className="text-[10px] text-[#57cbde] mr-2">online</span>
      )}
      <div className={`flex h-5 w-5 items-center justify-center rounded-sm border ${
        isSelected ? "border-[#67c1f5] bg-[#67c1f5]" : "border-[#2a475e] bg-transparent"
      }`}>
        {isSelected && <Check className="h-3.5 w-3.5 text-[#1b2838]" />}
      </div>
    </li>
  )
}

export function GuardianSelectStep({ totalGuardians, selected, users, loading, onToggle, onBack, onConfirm }: Props) {
  const isFull = selected.length >= totalGuardians
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#2a475e] text-[#67c1f5] hover:bg-[#2a475e] cursor-pointer">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="text-white text-sm font-bold tracking-wide">SELECT GUARDIANS</h2>
          <p className="text-[#8f98a0] text-xs mt-0.5">
            Choose <span className="text-[#67c1f5]">{totalGuardians}</span> friends — <span className="text-[#beee11]">{selected.length}</span> selected
          </p>
        </div>
      </div>

      <ScrollArea className="h-64">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-[#8f98a0] text-xs">
            <Loader className="h-4 w-4 animate-spin" />
            Loading users…
          </div>
        ) : (
          <ul className="space-y-1 p-1">
            {users.map((u) => (
              <FriendRow
                key={u.username}
                user={u}
                isSelected={selected.includes(u.username)}
                onToggle={() => {
                  if (!selected.includes(u.username) && isFull) return
                  onToggle(u.username)
                }}
              />
            ))}
          </ul>
        )}
      </ScrollArea>

      <SteamButton onClick={onConfirm} disabled={selected.length !== totalGuardians}>
        CONFIRM GUARDIANS
      </SteamButton>
    </div>
  )
}

