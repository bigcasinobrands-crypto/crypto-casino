import { parsePlayerApiErrorCodeFromBody } from './playerApiErrorCode'

export const PLAYER_SITE_BARRIER_EVENT = 'player-site-barrier'

export type PlayerSiteBarrierCode = 'site_maintenance' | 'geo_blocked' | 'ip_blocked'

/** Notify listeners when a player API JSON error indicates site-wide access rules (middleware). */
export function emitPlayerBarrierFromBody(bodyText: string): void {
  const code = parsePlayerApiErrorCodeFromBody(bodyText)
  emitPlayerBarrierCodeOptional(code)
}

/** When JSON was parsed and `error.code` is known (e.g. middleware body without `games`). */
export function emitPlayerBarrierIfKnown(code: string | undefined): void {
  emitPlayerBarrierCodeOptional(code)
}

function emitPlayerBarrierCodeOptional(code: string | undefined): void {
  if (code === 'site_maintenance' || code === 'geo_blocked' || code === 'ip_blocked') {
    window.dispatchEvent(new CustomEvent<PlayerSiteBarrierCode>(PLAYER_SITE_BARRIER_EVENT, { detail: code }))
  }
}

export function subscribePlayerSiteBarrier(handler: (code: PlayerSiteBarrierCode) => void): () => void {
  const fn = (e: Event) => {
    const d = (e as CustomEvent<PlayerSiteBarrierCode>).detail
    if (d === 'site_maintenance' || d === 'geo_blocked' || d === 'ip_blocked') handler(d)
  }
  window.addEventListener(PLAYER_SITE_BARRIER_EVENT, fn as EventListener)
  return () => window.removeEventListener(PLAYER_SITE_BARRIER_EVENT, fn as EventListener)
}
