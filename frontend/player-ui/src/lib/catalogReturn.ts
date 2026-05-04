/** `id` on `<main>` — scroll container for catalog pages (see App.tsx). */
export const PLAYER_MAIN_SCROLL_ID = 'player-main-scroll'

/**
 * `/casino/:section` routes rendered by {@link LobbyPage} — scroll restore / reset is handled there only.
 * Must stay aligned with `SECTION_SET` in `LobbyPage.tsx`.
 */
export const LOBBY_CATALOG_SECTION_SET = new Set<string>([
  'games',
  'featured',
  'challenges',
  'slots',
  'live',
  'new',
  'favourites',
  'recent',
  'bonus-buys',
])

export function isLobbyCatalogPathname(pathname: string): boolean {
  const m = pathname.match(/^\/casino\/([^/]+)$/)
  if (!m) return false
  return LOBBY_CATALOG_SECTION_SET.has(m[1]!)
}

const STORAGE_KEY = 'vybebet:catalogReturn'

export type CatalogReturnPayload = {
  pathname: string
  search: string
  hash: string
  scrollTop: number
}

function isGameLobbyPathname(pathname: string) {
  return pathname.startsWith('/casino/game-lobby/')
}

function sanitizeReturnPath(pathname: string, search: string, hash: string): string | null {
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return null
  if (isGameLobbyPathname(pathname)) return null
  return pathname + (search ?? '') + (hash ?? '')
}

function writeCurrentCatalogReturnToSession(): void {
  if (typeof window === 'undefined') return
  const { pathname, search, hash } = window.location
  if (isGameLobbyPathname(pathname)) return
  const main = document.getElementById(PLAYER_MAIN_SCROLL_ID)
  const scrollTop = main?.scrollTop ?? 0
  const payload: CatalogReturnPayload = { pathname, search, hash, scrollTop }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* ignore quota */
  }
}

/**
 * Call immediately before opening a game lobby from a catalog/list page.
 * Skips when already on a game lobby (e.g. switching games) so the original list context is kept.
 */
export function saveCatalogReturnBeforeGameOpen(): void {
  writeCurrentCatalogReturnToSession()
}

/**
 * Updates stored path + scroll while the player browses the catalog (sections, filters, scrolling).
 * Keeps “Back to games” aligned with the **latest** lobby view, not only the first game opened this session.
 */
export function persistCatalogReturnSnapshot(): void {
  writeCurrentCatalogReturnToSession()
}

export function clearCatalogReturn(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Split `pathname + search + hash` for React Router object navigation (reliable vs a single string). */
export function splitCatalogReturnPath(fullPath: string): { pathname: string; search: string; hash: string } {
  if (typeof window === 'undefined') {
    return { pathname: '/casino/games', search: '', hash: '' }
  }
  try {
    const u = new URL(fullPath.trim() || '/casino/games', window.location.origin)
    return { pathname: u.pathname || '/casino/games', search: u.search, hash: u.hash }
  } catch {
    return { pathname: '/casino/games', search: '', hash: '' }
  }
}

/** Path + scroll for `navigate(..., { state: { __restoreMainScroll } })`, or null → use default lobby. */
export function getCatalogReturnForNavigation(): { path: string; scrollTop: number } | null {
  if (typeof window === 'undefined') return null
  let raw: string | null
  try {
    raw = sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as CatalogReturnPayload
    const path = sanitizeReturnPath(j.pathname ?? '', j.search ?? '', j.hash ?? '')
    if (!path) return null
    const scrollTop = typeof j.scrollTop === 'number' && Number.isFinite(j.scrollTop) ? Math.max(0, j.scrollTop) : 0
    return { path, scrollTop }
  } catch {
    return null
  }
}

/** React Router location.state key applied when returning from a game. */
export const RESTORE_MAIN_SCROLL_STATE_KEY = '__restoreMainScroll' as const

export type RestoreScrollLocationState = {
  [RESTORE_MAIN_SCROLL_STATE_KEY]?: number
}
