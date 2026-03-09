import { useEffect, useState } from "react"
import { API_BASE_URL, api } from "@/lib/api"

export interface BackendUser {
  username: string
  party_id: number | null
  role: string
  online: boolean
  address?: string
}

export function useUsers() {
  const [users, setUsers] = useState<BackendUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchUsers() {
      try {
        const community = await api.getCommunityMembers()
        const mapped: BackendUser[] = community.members.map((member) => ({
          username: member.username,
          party_id: Number.parseInt(member.partyId, 10),
          role: "member",
          online: member.online,
          address: member.address,
        }))
        if (!cancelled) {
          setUsers(mapped)
          setError(null)
        }
      } catch (err) {
        try {
          const res = await fetch(`${API_BASE_URL}/users`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = (await res.json()) as { users: BackendUser[] }
          if (!cancelled) {
            setUsers(json.users)
            setError(null)
          }
        } catch (fallbackErr) {
          if (!cancelled) setError(fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchUsers()

    // Refresh every 5 s so online state and party IDs stay fresh.
    const interval = setInterval(fetchUsers, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return { users, loading, error }
}
