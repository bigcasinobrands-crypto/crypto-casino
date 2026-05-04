/** Persist last known avatar path per user so UI survives flaky /me or missing avatar_url in JSON. */

const PREFIX = 'vybebet_player_avatar:'

export function cachePlayerAvatarUrl(userId: string, avatarUrl: string | undefined | null) {
  const id = userId?.trim()
  const u = typeof avatarUrl === 'string' ? avatarUrl.trim() : ''
  if (!id || !u) return
  try {
    localStorage.setItem(PREFIX + id, u)
  } catch {
    /* quota / private mode */
  }
}

export function readCachedPlayerAvatarUrl(userId: string): string | undefined {
  const id = userId?.trim()
  if (!id) return undefined
  try {
    const v = localStorage.getItem(PREFIX + id)
    return v?.trim() || undefined
  } catch {
    return undefined
  }
}
