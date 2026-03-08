import { Badge } from "@/components/ui/badge"

interface GameCardProps {
  title: string
  price: string
  discount?: number
  tags: string[]
}

export function GameCard({ title, price, discount, tags }: GameCardProps) {
  const discountedPrice = discount
    ? `$${(parseFloat(price.replace("$", "")) * (1 - discount / 100)).toFixed(2)}`
    : null

  return (
    <div className="group cursor-pointer overflow-hidden rounded bg-[#0a141d] transition hover:bg-[#1a3a4a]">
      {/* Image placeholder */}
      <div className="aspect-[16/7] w-full bg-gradient-to-br from-[#2a475e] to-[#1b2838] transition group-hover:brightness-110" />

      {/* Info */}
      <div className="p-4">
        <h4 className="truncate text-base font-medium text-[#c7d5e0]">{title}</h4>
        <div className="mt-1 flex flex-wrap gap-1">
          {tags.slice(0, 3).map((t) => (
            <Badge
              key={t}
              variant="secondary"
              className="bg-[#3d4450]/40 px-2 py-0.5 text-xs text-[#8f98a0] hover:bg-[#3d4450]/60"
            >
              {t}
            </Badge>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          {discount && (
            <span className="rounded bg-[#4c6b22] px-2 py-0.5 text-sm font-bold text-[#beee11]">
              -{discount}%
            </span>
          )}
          {discountedPrice ? (
            <>
              <span className="text-sm text-[#8f98a0] line-through">{price}</span>
              <span className="text-base font-bold text-[#beee11]">{discountedPrice}</span>
            </>
          ) : (
            <span className="text-base text-[#c7d5e0]">{price}</span>
          )}
        </div>
      </div>
    </div>
  )
}
