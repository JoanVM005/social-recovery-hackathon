import { Badge } from "@/components/ui/badge"

export function FeaturedBanner() {
  return (
    <div className="relative overflow-hidden rounded bg-gradient-to-br from-[#1a2940] to-[#0a1a2e]">
      <div className="flex">
        {/* Main image area */}
        <div className="flex-1 p-6">
          <div className="aspect-[16/7] w-full rounded bg-gradient-to-br from-[#2a475e] to-[#1b2838] flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-3xl font-bold text-white">
                Cyber Odyssey 2088
              </h2>
              <p className="mt-2 text-sm text-[#8f98a0]">
                Now Available on Steam
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <Badge className="bg-[#4c6b22] text-white hover:bg-[#4c6b22]">
                  Open World
                </Badge>
                <Badge className="bg-[#4c6b22] text-white hover:bg-[#4c6b22]">
                  RPG
                </Badge>
                <Badge className="bg-[#4c6b22] text-white hover:bg-[#4c6b22]">
                  Sci-Fi
                </Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Right info panel */}
        <div className="flex w-72 flex-col gap-2 p-6">
          <h3 className="text-lg font-semibold text-white">Cyber Odyssey 2088</h3>
          <p className="text-xs leading-relaxed text-[#8f98a0]">
            Explore a sprawling neon-lit open world. Customize your character,
            forge alliances, and shape the future of a cyberpunk metropolis.
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {["Open World", "RPG", "Action", "Sci-Fi", "Multiplayer"].map((t) => (
              <span key={t} className="rounded bg-[#3d4450]/60 px-2 py-0.5 text-[10px] text-[#8f98a0]">
                {t}
              </span>
            ))}
          </div>
          <div className="mt-auto flex items-end gap-3">
            <span className="rounded bg-[#4c6b22] px-2 py-1 text-sm font-bold text-[#beee11]">
              -40%
            </span>
            <div>
              <span className="text-xs text-[#8f98a0] line-through">$59.99</span>
              <span className="ml-2 text-sm font-bold text-[#beee11]">$35.99</span>
            </div>
          </div>
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="flex gap-1 px-6 pb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 flex-1 rounded bg-[#2a475e]/50 transition hover:brightness-125"
          />
        ))}
      </div>
    </div>
  )
}
