import { useEffect, useState } from 'react'
import { playerApiUrl } from '../lib/playerApiUrl'

export type OperationalHealth = {
  maintenance_mode: boolean
  /** True when MAINTENANCE_MODE env is set on the API process (informational for operators). */
  maintenance_mode_env?: boolean
  /** RFC3339 UTC scheduled maintenance end from admin (optional). */
  maintenance_until?: string | null
  /** True when resolved country matches a blocked jurisdiction (edge/CDN headers). */
  geo_blocked?: boolean
  /** True when security.ip_whitelist / ip_blacklist denies this client IP (server-enforced). */
  ip_blocked?: boolean
  /** Echo of resolved ISO 3166-1 alpha-2 when present. */
  geo_country?: string
  /** English country name from optional ipdata.co lookup (server-side); falls back to localized ISO label in UI. */
  geo_country_name?: string
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

const OPS_FETCH_ATTEMPTS = 4
const OPS_FETCH_GAP_MS = 320

/**
 * Polls GET /health/operational for banners, catalog warnings, and geo/maintenance gates.
 * Best-effort: transient failures keep the last good payload for in-session banners.
 *
 * `ready` is true only after we have loaded JSON at least once, or after a short timeout
 * (API unreachable): lets {@link SiteAccessGate} avoid treating “fetch failed” as “site open”.
 */
export function useOperationalHealth(pollMs = 8000) {
  const [data, setData] = useState<OperationalHealth | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const id = window.setTimeout(() => setTimedOut(true), 20_000)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      for (let attempt = 0; attempt < OPS_FETCH_ATTEMPTS; attempt++) {
        try {
          const res = await fetch(playerApiUrl('/health/operational'), {
            cache: 'no-store',
            headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
          })
          if (res.ok) {
            const j = (await res.json()) as OperationalHealth
            if (!cancelled) setData(j)
            return
          }
          if (import.meta.env.DEV && !cancelled) {
            console.debug(`[operational] HTTP ${res.status} (attempt ${attempt + 1}/${OPS_FETCH_ATTEMPTS})`)
          }
        } catch (e) {
          if (import.meta.env.DEV && !cancelled) {
            console.debug(`[operational] fetch failed attempt ${attempt + 1}/${OPS_FETCH_ATTEMPTS}`, e)
          }
        }
        if (attempt < OPS_FETCH_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, OPS_FETCH_GAP_MS))
        }
      }
    }
    void load()

    const intervalId = window.setInterval(load, pollMs)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [pollMs])

  const ready = data !== null || timedOut
  return { data, ready }
}
