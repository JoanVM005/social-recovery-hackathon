import { useState } from "react"
import { Mail, User } from "lucide-react"
import { Input } from "@/components/ui/input"
import { SteamButton } from "@/components/ui/steam-button"
import { PasswordField } from "@/components/login/PasswordField"
import steamLogo from "@/assets/logo_steam.svg"

type Tab = "signin" | "signup"

function TextField({ icon, label, ...inputProps }: { icon: React.ReactNode; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11px] font-semibold tracking-wider text-[#8f98a0] uppercase">{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#67c1f5]/70">{icon}</span>
        <Input {...inputProps} required className="steam-input pl-9" />
      </div>
    </div>
  )
}

export function LoginPage({ onLogin, onSignUp }: { onLogin: () => void; onSignUp: () => void }) {
  const [tab, setTab] = useState<Tab>("signin")

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "radial-gradient(ellipse at 50% 0%, #2a475e 0%, #1b2838 40%, #0e1720 100%)" }}
    >
      <img src={steamLogo} alt="Steam" className="h-14 mb-8 opacity-90" />

      <div className="w-full max-w-[420px] rounded-sm shadow-[0_0_40px_rgba(0,0,0,0.6)] overflow-hidden border border-[#2a475e]/40">
        <div className="flex">
          {(["signin", "signup"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3.5 text-xs font-bold tracking-[0.12em] transition-colors cursor-pointer ${
                tab === t ? "bg-[#1e2738] text-white border-b-2 border-[#67c1f5]" : "bg-[#141d27] text-[#8f98a0] hover:text-[#c6d4df]"
              }`}
            >
              {t === "signin" ? "SIGN IN" : "CREATE ACCOUNT"}
            </button>
          ))}
        </div>

        <div className="bg-[#1e2738] px-8 py-8">
          {tab === "signin" ? <SignInForm onLogin={onLogin} /> : <SignUpForm onSignUp={onSignUp} />}
        </div>
      </div>

      <p className="mt-8 text-[#8f98a0] text-[11px] tracking-wide">© 2025 AnarKey · All rights reserved.</p>
    </div>
  )
}

function SignInForm({ onLogin }: { onLogin: () => void }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onLogin() }} className="flex flex-col gap-4">
      <p className="text-[#8f98a0] text-xs leading-relaxed mb-1">Sign in with your AnarKey account credentials below.</p>

      <TextField icon={<User className="h-4 w-4" />} label="Account name or email" type="text" autoComplete="username" placeholder="Account name or email" />
      <PasswordField label="Password" autoComplete="current-password" placeholder="Password" />

      <div className="flex items-center justify-between text-xs text-[#67c1f5]">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" className="accent-[#67c1f5]" />
          <span className="text-[#8f98a0]">Remember me</span>
        </label>
        <button type="button" className="hover:underline focus:outline-none">Forgot password?</button>
      </div>

      <SteamButton type="submit" className="mt-2">SIGN IN</SteamButton>
    </form>
  )
}

function SignUpForm({ onSignUp }: { onSignUp: () => void }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSignUp() }} className="flex flex-col gap-4">
      <p className="text-[#8f98a0] text-xs leading-relaxed mb-1">Create your free AnarKey account. It only takes a minute.</p>

      <TextField icon={<User className="h-4 w-4" />} label="Account name" type="text" autoComplete="username" placeholder="Account name" />
      <TextField icon={<Mail className="h-4 w-4" />} label="Email address" type="email" autoComplete="email" placeholder="Email address" />
      <PasswordField label="Password" autoComplete="new-password" placeholder="Password" />
      <PasswordField label="Confirm password" autoComplete="new-password" placeholder="Confirm password" />

      <label className="items-start gap-2 cursor-pointer select-none text-xs text-[#8f98a0] leading-relaxed mt-1">
        <input type="checkbox" required className="mt-0.5 mr-2 accent-[#67c1f5]" />
        I am 13 years of age or older and agree to the{" "}
        <button type="button" className="text-[#67c1f5] hover:underline ml-0.5 focus:outline-none cursor-pointer">Terms of Service</button>.
      </label>

      <SteamButton type="submit" className="mt-2">CREATE MY ACCOUNT</SteamButton>
    </form>
  )
}
