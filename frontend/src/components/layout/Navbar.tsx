import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import steamLogo from "@/assets/logo_steam.svg"

export function Navbar() {
  return (
    <div className="bg-[#171d25] shadow-md">
      <div className="mx-auto flex max-w-[1600px] items-center gap-8 px-6 py-3">
        <img src={steamLogo} alt="Steam" className="h-10" />
        <nav className="flex items-center gap-2 text-base">
          {["STORE", "LIBRARY", "COMMUNITY", "PROFILE"].map((item) => (
            <span
              key={item}
              className="cursor-pointer rounded px-4 py-1.5 text-[#b8b6b4] transition hover:bg-[#3d4450] hover:text-white"
            >
              {item}
            </span>
          ))}
        </nav>
        <div className="relative ml-auto w-64">
          <Input
            placeholder="Search the store"
            className="h-10 border-none bg-[#316282] pr-10 text-sm text-white placeholder:text-[#67c1f5]/50 focus-visible:ring-0"
          />
          <Search className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#67c1f5]" />
        </div>
      </div>
    </div>
  )
}
