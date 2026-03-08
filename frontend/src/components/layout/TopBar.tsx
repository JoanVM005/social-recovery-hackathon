import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function TopBar() {
  return (
    <div className="bg-[#171a21] text-[#b8b6b4] text-xs">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-4 py-1">
        <div className="flex items-center gap-4">
          <span className="cursor-pointer hover:text-white">STORE</span>
          <span className="cursor-pointer hover:text-white">COMMUNITY</span>
          <span className="cursor-pointer hover:text-white">ABOUT</span>
          <span className="cursor-pointer hover:text-white">SUPPORT</span>
        </div>
        <div className="flex items-center gap-3">
          <Avatar className="h-6 w-6">
            <AvatarFallback className="bg-[#4c6b22] text-[10px] text-white">
              JP
            </AvatarFallback>
          </Avatar>
          <span className="cursor-pointer text-[#b8b6b4] hover:text-white">
            JohnPlayer
          </span>
          <span className="text-[#4c6b22]">▼</span>
        </div>
      </div>
    </div>
  )
}
