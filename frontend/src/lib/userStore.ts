const KEY = "anarkey_user"

export interface StoredUser {
  id: string
  username: string
  createdAt: string
}

export function saveUser(user: StoredUser): void {
  localStorage.setItem(KEY, JSON.stringify(user))
}

export function getUser(): StoredUser | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredUser
  } catch {
    return null
  }
}

export function clearUser(): void {
  localStorage.removeItem(KEY)
}

export function generateUserId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  // fallback for older environments
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
