import { useState } from "react"
import { Eye, EyeOff, Lock } from "lucide-react"
import { Input } from "@/components/ui/input"

interface Props {
  label: string
  placeholder?: string
  autoComplete?: string
}

export function PasswordField({ label, placeholder = "Password", autoComplete }: Props) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold tracking-wider text-[#8f98a0] uppercase">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#67c1f5]/70">
          <Lock className="h-4 w-4" />
        </span>
        <Input
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          className="steam-input pl-9 pr-10"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#67c1f5]/60 hover:text-[#67c1f5] transition-colors focus:outline-none"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
