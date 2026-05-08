/**
 * Single source of truth for casino sidebar / mobile drawer routes and CMS fallbacks.
 * Breakpoints: bottom nav + drawer (<768), tablet header menu + drawer (768–1279), desktop sidebar (≥1280).
 */

export type CasinoNavCategory = {
  id: string
  label: string
  enabled: boolean
  coming_soon?: boolean
}

/** Target path or hash link; empty string = disabled / placeholder */
export const CASINO_NAV_ROUTE_MAP: Record<string, string> = {
  hot_now: '/casino/games',
  new_releases: '/casino/new',
  slots: '/casino/slots',
  bonus_buys: '/casino/bonus-buys',
  live: '/casino/live',
  challenges: '/casino/challenges',
  favourites: '/casino/favourites',
  recently_played: '/casino/recent',
  providers: '/casino/studios',
  sports: '/esports',
  rewards: '/bonuses',
  affiliate: '',
  vip: '/vip',
  farming: '',
  raffle: '/casino/games#raffle',
}

export const CASINO_NAV_FALLBACK_CATEGORIES: CasinoNavCategory[] = [
  { id: 'hot_now', label: 'Hot now', enabled: true },
  { id: 'new_releases', label: 'New releases', enabled: true },
  { id: 'slots', label: 'Slots', enabled: true },
  { id: 'bonus_buys', label: 'Bonus buys', enabled: true },
  { id: 'live', label: 'Live', enabled: true },
  { id: 'challenges', label: 'Challenges', enabled: true },
  { id: 'favourites', label: 'Favourites', enabled: true },
  { id: 'recently_played', label: 'Recently Played', enabled: true },
  { id: 'providers', label: 'Studios', enabled: true },
]

export const CASINO_NAV_FALLBACK_EXTRAS: CasinoNavCategory[] = [{ id: 'sports', label: 'E-Sports', enabled: true }]

export const CASINO_NAV_FALLBACK_PROMO: CasinoNavCategory[] = [
  { id: 'rewards', label: 'My Bonuses', enabled: true },
  { id: 'affiliate', label: 'Refer and Earn', enabled: true },
  { id: 'vip', label: 'VIP', enabled: true },
  { id: 'farming', label: 'Farming', enabled: true, coming_soon: true },
  { id: 'raffle', label: '$25K Raffle', enabled: true },
]

/** Catalog sections anyone can open (matches mobile drawer). */
const PUBLIC_CASINO_SUB_IDS = new Set([
  'hot_now',
  'new_releases',
  'slots',
  'bonus_buys',
  'live',
  'providers',
])

export function casinoNavRoute(id: string): string {
  return CASINO_NAV_ROUTE_MAP[id] ?? ''
}

export function casinoNavSubLinkUsesAuth(id: string): boolean {
  return !PUBLIC_CASINO_SUB_IDS.has(id)
}

export function isCasinoNavHotNow(id: string): boolean {
  return id === 'hot_now'
}

export function isCasinoNavProviders(id: string): boolean {
  return id === 'providers'
}
