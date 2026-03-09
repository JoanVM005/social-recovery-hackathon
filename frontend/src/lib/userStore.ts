const USERS_KEY = "anarkey_users"
const ACTIVE_USER_ID_KEY = "anarkey_active_user_id"

export interface StoredUser {
  id: string
  username: string
  createdAt: string
  walletAddress?: string
  secretKey?: string
  latestBackupId?: string
  latestBackupDraftId?: string
}

function readUsers(): StoredUser[] {
  const raw = localStorage.getItem(USERS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as StoredUser[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeUsers(users: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users))
}

function setActiveUserId(userId: string | null): void {
  if (userId) {
    sessionStorage.setItem(ACTIVE_USER_ID_KEY, userId)
  } else {
    sessionStorage.removeItem(ACTIVE_USER_ID_KEY)
  }
}

function getActiveUserId(): string | null {
  return sessionStorage.getItem(ACTIVE_USER_ID_KEY)
}

export function saveUser(user: StoredUser): void {
  const users = readUsers()
  const index = users.findIndex((item) => item.id === user.id)
  if (index >= 0) {
    users[index] = user
  } else {
    users.push(user)
  }
  writeUsers(users)
  setActiveUserId(user.id)
}

export function getUser(): StoredUser | null {
  const users = readUsers()
  if (users.length === 0) return null

  const activeId = getActiveUserId()
  if (activeId) {
    const found = users.find((item) => item.id === activeId) ?? null
    if (found) return found
  }

  const latest = users[users.length - 1] ?? null
  if (latest) setActiveUserId(latest.id)
  return latest
}

export function clearUser(): void {
  setActiveUserId(null)
}

export function updateUser(partial: Partial<StoredUser>): StoredUser | null {
  const current = getUser()
  if (!current) return null
  const next = { ...current, ...partial }
  saveUser(next)
  return next
}

export function listUsers(): StoredUser[] {
  return readUsers()
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
