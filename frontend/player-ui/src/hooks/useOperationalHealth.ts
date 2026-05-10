import { useEffect, useState } from 'react'
import { playerApiUrl } from '../lib/playerApiUrl'

export type OperationalHealth = {
  maintenance_mode: boolean
  /** RFC3339 UTC scheduled maintenance end from admin (optional). */
  maintenance_until?: string | null
  /** True when X-Geo-Country matches a blocked jurisdiction (edge must send the header). */
  geo_blocked?: boolean
  /** Echo of X-Geo-Country when present (ISO 3166-1 alpha-2). */
  geo_country?: string
  /** From `payment_ops_flags` — player wallet / rails (mirrored from admin kill switches). */
  deposits_enabled?: boolean
  withdrawals_enabled?: boolean
  bonuses_enabled?: boolean
  automated_grants_enabled?: boolean
  /** Real-money casino/sports launch (not demo / free play). */
  real_play_enabled?: boolean
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

/**
 * Polls GET /health/operational for banners, catalog warnings, and geo/maintenance gates.
 * Best-effort: transient failures do not clear last good data for in-session banners.
 * {@link ready} becomes true after the first fetch attempt completes so gates do not spin forever.
 */
export function useOperationalHealth(pollMs = 60_000) {
  const [data, setData] = useState<OperationalHealth | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(playerApiUrl('/health/operational'))
        if (!res.ok) {
          if (import.meta.env.DEV && !cancelled) {
            console.debug(`[operational] HTTP ${res.status} — keeping last payload if any`)
          }
          return
        }
        const j = (await res.json()) as OperationalHealth
        if (!cancelled) {
          setData(j)
        }
      } catch (e) {
        if (import.meta.env.DEV && !cancelled) {
          console.debug('[operational] fetch failed — keeping last payload if any', e)
        }
      } finally {
        if (!cancelled) {
          setReady(true)
        }
      }
    }
    void load()
    const id = window.setInterval(load, pollMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [pollMs])

  return { data, ready }
}
