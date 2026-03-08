import { FeaturedBanner } from "@/components/store/FeaturedBanner"
import { GameGrid } from "@/components/store/GameGrid"
import { CategorySidebar } from "@/components/store/CategorySidebar"
import { FriendsList } from "@/components/store/FriendsList"

export function StorePage() {
  return (
    <div className="mx-auto max-w-[1600px] px-6 py-8">
      <FeaturedBanner />

      <div className="mt-8 flex gap-8">
        <CategorySidebar />
        <div className="flex-1">
          <GameGrid />
        </div>
        <FriendsList />
      </div>
    </div>
  )
}
