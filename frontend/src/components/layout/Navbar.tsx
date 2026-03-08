import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"

export function Navbar() {
  return (
    <div className="bg-[#171d25] shadow-md">
      <div className="mx-auto flex max-w-[1200px] items-center gap-6 px-4 py-2">
        <span className="text-2xl font-bold tracking-wider text-white">
          STEAM
        </span>
        <nav className="flex items-center gap-1 text-sm">
          {["STORE", "LIBRARY", "COMMUNITY", "PROFILE"].map((item) => (
            <span
              key={item}
              className="cursor-pointer rounded px-3 py-1 text-[#b8b6b4] transition hover:bg-[#3d4450] hover:text-white"
            >
              {item}
            </span>
          ))}
        </nav>
        <div className="relative ml-auto w-52">
          <Input
            placeholder="Search the store"
            className="h-8 border-none bg-[#316282] pr-8 text-xs text-white placeholder:text-[#67c1f5]/50 focus-visible:ring-0"
          />
          <Search className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#67c1f5]" />
        </div>
      </div>
    </div>
  )
}
