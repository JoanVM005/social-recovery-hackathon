import { Separator } from "@/components/ui/separator"

const CATEGORIES = [
  "Top Sellers",
  "New Releases",
  "Upcoming",
  "Specials",
  "VR",
  "Controller-Friendly",
  "Great on Deck",
]

const GENRES = [
  "Free to Play",
  "Action",
  "Adventure",
  "RPG",
  "Strategy",
  "Simulation",
  "Indie",
  "Sports & Racing",
]

export function CategorySidebar() {
  return (
    <div className="w-52 shrink-0">
      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-[#67c1f5]">
        Browse
      </h4>
      <ul className="space-y-1">
        {CATEGORIES.map((c) => (
          <li
            key={c}
            className="cursor-pointer rounded px-2 py-1 text-xs text-[#b8b6b4] transition hover:bg-[#3d4450] hover:text-white"
          >
            {c}
          </li>
        ))}
      </ul>

      <Separator className="my-4 bg-[#2a475e]" />

      <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-[#67c1f5]">
        Genres
      </h4>
      <ul className="space-y-1">
        {GENRES.map((g) => (
          <li
            key={g}
            className="cursor-pointer rounded px-2 py-1 text-xs text-[#b8b6b4] transition hover:bg-[#3d4450] hover:text-white"
          >
            {g}
          </li>
        ))}
      </ul>
    </div>
  )
}
