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
    <div className="bg-[#1b2838] text-sm text-[#b8b6b4]">
      <div className="mx-auto flex max-w-[1600px] items-center gap-6 px-6 py-2">
        {links.map((l) => (
          <span key={l} className="cursor-pointer hover:text-white">
            {l}
          </span>
        ))}
      </div>
    </div>
  )
}
