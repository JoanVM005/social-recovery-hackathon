import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

const FRIENDS = [
  { name: "Alex", status: "online", game: "Cyber Odyssey 2088" },
  { name: "Maria", status: "online", game: "Neon Drift" },
  { name: "Sam", status: "online", game: null },
  { name: "Jordan", status: "away", game: null },
  { name: "Casey", status: "offline", game: null },
  { name: "Riley", status: "offline", game: null },
]

const statusColor: Record<string, string> = {
  online: "bg-[#57cbde]",
  away: "bg-[#e8b94d]",
  offline: "bg-[#636363]",
}

export function FriendsList() {
  return (
    <div className="w-72 shrink-0 rounded bg-[#0e1c2a] p-4">
      <h4 className="mb-3 text-sm font-medium uppercase tracking-wider text-[#67c1f5]">
        Friends
      </h4>
      <ScrollArea className="h-96 mb-35">
        <ul className="space-y-1">
          {FRIENDS.map((f) => (
            <li
              key={f.name}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition hover:bg-[#1a3a4a]"
            >
              <div className="relative">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-[#2a475e] text-xs text-[#c7d5e0]">
                    {f.name[0]}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0e1c2a] ${statusColor[f.status]}`}
                />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm text-[#c7d5e0]">{f.name}</p>
                {f.game ? (
                  <p className="truncate text-xs text-[#57cbde]">{f.game}</p>
                ) : (
                  <p className="text-xs capitalize text-[#636363]">{f.status}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <Separator className="mb-3 bg-[#2a475e]" />
      <p className="text-center text-[10px] text-[#636363]">
        2 online · 1 in-game
      </p>
    </div>
  )
}
