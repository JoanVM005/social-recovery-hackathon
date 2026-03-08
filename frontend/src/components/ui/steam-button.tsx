export function SteamButton({
  children,
  type = "button",
  className = "",
  onClick,
  disabled = false,
}: {
  children: React.ReactNode
  type?: "button" | "submit"
  className?: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-sm py-2.5 text-xs font-bold tracking-[0.1em] text-white focus:outline-none focus:ring-2 focus:ring-[#67c1f5]/40 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${className}`}
      style={{
        background: "linear-gradient(to bottom, #588a1b 5%, #3a6216 95%)",
        boxShadow: "0 1px 0 rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
        textShadow: "0 1px 2px rgba(0,0,0,0.4)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "linear-gradient(to bottom, #6aab20 5%, #4a7a1e 95%)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "linear-gradient(to bottom, #588a1b 5%, #3a6216 95%)"
      }}
    >
      {children}
    </button>
  )
}
