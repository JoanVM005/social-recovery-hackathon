import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, User, MessageSquare, Settings, LogOut, Wallet, ShieldCheck } from "lucide-react"

export function TopBar({ onLogout }: { onLogout?: () => void }) {
  return (
    <div className="bg-[#171a21] text-[#b8b6b4] text-sm">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-2">
        <div className="flex items-center gap-4">
          <span className="cursor-pointer hover:text-white">STORE</span>
          <span className="cursor-pointer hover:text-white">COMMUNITY</span>
          <span className="cursor-pointer hover:text-white">ABOUT</span>
          <span className="cursor-pointer hover:text-white">SUPPORT</span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded px-3 py-1.5 hover:bg-[#3d4450] focus:outline-none">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-[#4c6b22] text-xs text-white">
                  JP
                </AvatarFallback>
              </Avatar>
              <span className="text-[#b8b6b4]">JohnPlayer</span>
              <ChevronDown className="h-3 w-3 text-[#4c6b22]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 border-[#2a475e] bg-[#171a21] text-[#b8b6b4]"
          >
            <DropdownMenuItem className="gap-2 text-sm focus:bg-[#3d4450] focus:text-white">
              <User className="h-4 w-4" /> View Profile
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-sm focus:bg-[#3d4450] focus:text-white">
              <MessageSquare className="h-4 w-4" /> Friends & Chat
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-sm focus:bg-[#3d4450] focus:text-white">
              <Settings className="h-4 w-4" /> Account Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[#2a475e]" />
            <DropdownMenuItem className="gap-2 text-sm text-[#beee11] focus:bg-[#3d4450] focus:text-[#beee11]">
              <Wallet className="h-4 w-4" /> Connect My Wallet
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-sm text-[#67c1f5] focus:bg-[#3d4450] focus:text-[#67c1f5]">
              <ShieldCheck className="h-4 w-4" /> Choose My Guardians
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[#2a475e]" />
            <DropdownMenuItem onClick={onLogout} className="gap-2 text-sm focus:bg-[#3d4450] focus:text-white">
              <LogOut className="h-4 w-4" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
