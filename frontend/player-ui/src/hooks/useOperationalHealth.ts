import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** English country name from optional ipdata.co lookup (server-side cache); may appear on later polls after a cold refresh. */
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

const OPS_FETCH_ATTEMPTS = 3
const OPS_FETCH_GAP_MS = 140

/** Unique URL per request so HTTP caches / edge proxies cannot serve stale maintenance JSON after refresh. */
function operationalHealthRequestUrl(): string {
  const raw = playerApiUrl('/health/operational')
  const sep = raw.includes('?') ? '&' : '?'
  return `${raw}${sep}_cb=${Date.now()}`
}

/** JSON sometimes arrives as string/number via proxies; Boolean("false") === true would wrongly gate the site. */
function asBarrierBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number' && Number.isFinite(v)) return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === 'true' || s === '1' || s === 'yes') return true
    if (s === 'false' || s === '0' || s === 'no' || s === '') return false
  }
  return false
}

function normalizeOperationalHealth(raw: unknown): OperationalHealth | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const j = raw as Record<string, unknown>
  const disableLaunch = j.disable_game_launch
  return {
    ...(j as unknown as OperationalHealth),
    maintenance_mode: asBarrierBool(j.maintenance_mode),
    maintenance_mode_env:
      j.maintenance_mode_env === undefined ? undefined : asBarrierBool(j.maintenance_mode_env),
    geo_blocked: asBarrierBool(j.geo_blocked),
    ip_blocked: asBarrierBool(j.ip_blocked),
    disable_game_launch: typeof disableLaunch === 'boolean' ? disableLaunch : asBarrierBool(disableLaunch),
  }
}

/**
 * Polls GET /health/operational for banners, catalog warnings, and geo/maintenance gates.
 * Best-effort: transient failures keep the last good payload for in-session banners.
 *
 * `ready` becomes true as soon as the first bootstrap wave finishes (JSON OK or retries exhausted),
 * so {@link SiteAccessGate} does not spin for ~20s on flaky networks. `timedOut` remains a long
 * backstop for edge cases.
 */
export function useOperationalHealth(pollMs = 2500) {
  const [data, setData] = useState<OperationalHealth | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  const [initialBootstrapDone, setInitialBootstrapDone] = useState(false)
  const fetchGen = useRef(0)

  useEffect(() => {
    const id = window.setTimeout(() => setTimedOut(true), 12_000)
    return () => window.clearTimeout(id)
  }, [])

  const load = useCallback(async () => {
    const gen = ++fetchGen.current
    try {
      for (let attempt = 0; attempt < OPS_FETCH_ATTEMPTS; attempt++) {
        try {
          const res = await fetch(operationalHealthRequestUrl(), {
            cache: 'reload',
            headers: {
              Accept: 'application/json',
              'Cache-Control': 'no-cache',
              Pragma: 'no-cache',
            },
          })
          if (res.ok) {
            const parsed = normalizeOperationalHealth(await res.json())
            if (gen !== fetchGen.current) return
            if (parsed) setData(parsed)
            return
          }
          if (import.meta.env.DEV && gen === fetchGen.current) {
            console.debug(`[operational] HTTP ${res.status} (attempt ${attempt + 1}/${OPS_FETCH_ATTEMPTS})`)
          }
        } catch (e) {
          if (import.meta.env.DEV && gen === fetchGen.current) {
            console.debug(`[operational] fetch failed attempt ${attempt + 1}/${OPS_FETCH_ATTEMPTS}`, e)
          }
        }
        if (attempt < OPS_FETCH_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, OPS_FETCH_GAP_MS))
        }
      }
    } finally {
      if (gen === fetchGen.current) setInitialBootstrapDone(true)
    }
  }, [])

  useEffect(() => {
    void load()

    const intervalId = window.setInterval(() => void load(), pollMs)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const onFocus = () => void load()
    /** Full reload / BFCache back navigation — always pull fresh operational JSON (maintenance schedule + gates). */
    const onPageShow = () => void load()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)

    return () => {
      fetchGen.current++
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [load, pollMs])

  const ready = data !== null || timedOut || initialBootstrapDone
  return { data, ready, reload: load }
}
