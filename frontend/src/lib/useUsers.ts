import { useEffect, useState } from "react"

const API_URL = "http://localhost:8000"

export interface BackendUser {
  username: string
  party_id: number | null
  role: string
  online: boolean
}

export function useUsers() {
  const [users, setUsers] = useState<BackendUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetch_users() {
      try {
        const res = await fetch(`${API_URL}/users`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as { users: BackendUser[] }
        if (!cancelled) setUsers(json.users)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch_users()

    // Refresh every 5 s so the online badge stays reasonably fresh.
    const interval = setInterval(fetch_users, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return { users, loading, error }
}
