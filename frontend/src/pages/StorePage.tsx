import { FeaturedBanner } from "@/components/store/FeaturedBanner"
import { GameGrid } from "@/components/store/GameGrid"
import { CategorySidebar } from "@/components/store/CategorySidebar"
import { FriendsList } from "@/components/store/FriendsList"

export function StorePage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <FeaturedBanner />

      <div className="mt-6 flex gap-6">
        <CategorySidebar />
        <div className="flex-1">
          <GameGrid />
        </div>
        <FriendsList />
      </div>
    </div>
  )
}
