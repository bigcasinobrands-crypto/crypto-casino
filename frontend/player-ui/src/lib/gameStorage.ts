const FAV = 'player_favourite_game_ids'
const REC = 'player_recent_game_ids'
const REC_MAX = 16

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
