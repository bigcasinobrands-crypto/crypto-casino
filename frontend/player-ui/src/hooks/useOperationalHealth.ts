import { useEffect, useState } from 'react'

export type OperationalHealth = {
  maintenance_mode: boolean
  disable_game_launch: boolean
  blueocean_configured: boolean
  /** Non-hidden games in `games`. */
  visible_games_count?: number
  /** Non-hidden rows with provider blueocean. */
  blueocean_visible_games_count?: number
  /** False when `last_sync_error` is set in integration state (message not exposed here). */
  catalog_sync_ok?: boolean
  /** Rows reported upserted on the last completed sync batch (may be one page). */
  last_catalog_upserted?: number
  /** RFC3339 time of last Blue Ocean catalog sync attempt, if any. */
  last_catalog_sync_at?: string | null
}

export function useOperationalHealth(pollMs = 60_000) {
  const [data, setData] = useState<OperationalHealth | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/health/operational')
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`)
          return
        }
        const j = (await res.json()) as OperationalHealth
        if (!cancelled) {
          setData(j)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'fetch failed')
      }
    }
    void load()
    const id = window.setInterval(load, pollMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [pollMs])

  return { data, error }
}
