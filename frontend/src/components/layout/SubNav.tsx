export function SubNav() {
  const links = [
    "Your Store",
    "New & Noteworthy",
    "Categories",
    "Points Shop",
    "News",
    "Labs",
  ]
  return (
    <div className="bg-[#1b2838] text-xs text-[#b8b6b4]">
      <div className="mx-auto flex max-w-[1200px] items-center gap-4 px-4 py-1.5">
        {links.map((l) => (
          <span key={l} className="cursor-pointer hover:text-white">
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}
