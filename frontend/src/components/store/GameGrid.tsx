import { GameCard } from "./GameCard"

const GAMES = [
  { title: "Cyber Odyssey 2088", price: "$59.99", discount: 40, tags: ["Open World", "RPG", "Sci-Fi"] },
  { title: "Starfield Reborn", price: "$49.99", tags: ["Space", "Exploration", "Survival"] },
  { title: "Neon Drift", price: "$29.99", discount: 25, tags: ["Racing", "Arcade", "Multiplayer"] },
  { title: "Frostpunk III", price: "$39.99", tags: ["Strategy", "City Builder", "Survival"] },
  { title: "Shadow Protocol", price: "$44.99", discount: 50, tags: ["Stealth", "Action", "FPS"] },
  { title: "Elysium Online", price: "$0.00", tags: ["Free to Play", "MMORPG", "Fantasy"] },
  { title: "Titan Forge", price: "$34.99", discount: 15, tags: ["Crafting", "Sandbox", "Co-op"] },
  { title: "Abyssal Depths", price: "$24.99", tags: ["Horror", "Survival", "Underwater"] },
]

export function GameGrid() {
  return (
    <div>
      <h3 className="mb-4 text-lg font-medium uppercase tracking-wide text-[#67c1f5]">
        Special Offers
      </h3>
      <div className="grid grid-cols-4 gap-4">
        {GAMES.map((game) => (
          <GameCard key={game.title} {...game} />
        ))}
      </div>
    </div>
  )
}
