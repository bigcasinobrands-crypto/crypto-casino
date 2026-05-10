const FAV = 'player_favourite_game_ids'
const REC = 'player_recent_game_ids'
const REC_MAX = 16

/** Dispatched when `getFavouriteIds()` output may have changed (see `useFavouritesRevision`). */
export const PLAYER_FAVOURITES_CHANGED_EVENT = 'vybe-player-favourites-changed'

function emitFavouritesChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PLAYER_FAVOURITES_CHANGED_EVENT))
}

export function getFavouriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAV)
    if (!raw) return []
    const j = JSON.parse(raw) as unknown
    if (!Array.isArray(j)) return []
    return j.filter((x): x is string => typeof x === 'string' && x.length > 0)
  } catch {
    return []
  }
}

export function setFavouriteIds(ids: string[]) {
  localStorage.setItem(FAV, JSON.stringify(ids))
  emitFavouritesChanged()
}

export function toggleFavourite(id: string): boolean {
  const cur = getFavouriteIds()
  const i = cur.indexOf(id)
  if (i >= 0) {
    cur.splice(i, 1)
    setFavouriteIds(cur)
    return false
  }
  setFavouriteIds([id, ...cur])
  return true
}

export function isFavourite(id: string) {
  return getFavouriteIds().includes(id)
}

/** Merge server favourites with this device’s local list and optionally push union to the API. */
export async function mergeServerFavouritesOnLogin(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
): Promise<void> {
  const res = await apiFetch('/v1/me/favourite-games')
  if (!res.ok) return
  let j: { game_ids?: unknown }
  try {
    j = (await res.json()) as { game_ids?: unknown }
  } catch {
    return
  }
  const server = Array.isArray(j.game_ids)
    ? j.game_ids.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  const local = getFavouriteIds()
  const serverSet = new Set(server)
  const ordered: string[] = [...server]
  for (const id of local) {
    if (!serverSet.has(id)) ordered.push(id)
  }
  const needsPush = local.some((id) => !serverSet.has(id))
  if (needsPush) {
    const put = await apiFetch('/v1/me/favourite-games', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_ids: ordered }),
    })
    if (!put.ok) return
  }
  const prev = getFavouriteIds()
  if (prev.join('\0') !== ordered.join('\0')) {
    setFavouriteIds(ordered)
  }
}

export async function syncFavouriteToServer(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  gameId: string,
  favourited: boolean,
): Promise<boolean> {
  if (favourited) {
    const res = await apiFetch('/v1/me/favourite-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: gameId }),
    })
    return res.ok
  }
  const res = await apiFetch(`/v1/me/favourite-games/${encodeURIComponent(gameId)}`, {
    method: 'DELETE',
  })
  return res.ok
}

/**
 * Toggle favourite in localStorage, then POST/DELETE on the API when logged in.
 * Reverts local state if the API call fails; call `onSyncFailed` for a toast.
 */
export function toggleFavouriteWithServerSync(
  id: string,
  opts: {
    isAuthenticated: boolean
    apiFetch: (path: string, init?: RequestInit) => Promise<Response>
    onSyncFailed?: () => void
  },
): boolean {
  const nowFav = toggleFavourite(id)
  if (!opts.isAuthenticated) return nowFav
  void syncFavouriteToServer(opts.apiFetch, id, nowFav).then((ok) => {
    if (!ok) {
      toggleFavourite(id)
      opts.onSyncFailed?.()
    }
  })
  return nowFav
}

export function pushRecent(id: string) {
  if (!id) return
  let cur = getRecentIds().filter((x) => x !== id)
  cur = [id, ...cur].slice(0, REC_MAX)
  localStorage.setItem(REC, JSON.stringify(cur))
}

export function getRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(REC)
    if (!raw) return []
    const j = JSON.parse(raw) as unknown
    if (!Array.isArray(j)) return []
    return j.filter((x): x is string => typeof x === 'string' && x.length > 0)
  } catch {
    return []
  }
}
