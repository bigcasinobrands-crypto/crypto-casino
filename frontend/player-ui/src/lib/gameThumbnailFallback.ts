/**
 * When the catalog has no thumbnail_url (common for demo seeds / partial sync),
 * show portrait tiles using the same Cloudflare Images paths observed on pigmo.com
 * lobby loads (see network requests to imagedelivery.net/.../public).
 *
 * Does not override non-empty API thumbnails — only fills gaps.
 */

const CF_BASE = 'https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA'

/** Variant paths from pigmo.com game grid loads (mixed providers / originals). */
export const PIGMO_STYLE_FALLBACK_THUMBNAILS: readonly string[] = [
  `${CF_BASE}/pragmaticexternal:GatesofOlympus1000.webp/public`,
  `${CF_BASE}/pragmaticexternal:SweetRushBonanza.webp/public`,
  `${CF_BASE}/pragmaticexternal:SweetBonanza1000.webp/public`,
  `${CF_BASE}/pragmaticexternal:SugarRush1000.webp/public`,
  `${CF_BASE}/pragmaticexternal:SugarRushSuperScatter.webp/public`,
  `${CF_BASE}/pragmaticexternal:FloatingDragonWildHorses.webp/public`,
  `${CF_BASE}/pragmaticexternal:DragonTigerFortunes.webp/public`,
  `${CF_BASE}/thumbs/playtech:BlackjackLobby.webp/public`,
  `${CF_BASE}/thumbs/playtech:RouletteLobby.webp/public`,
  `${CF_BASE}/thumbs/playtech:PokerLobby.webp/public`,
  `${CF_BASE}/thumbs/playtech:LiveHiLo.webp/public`,
  `${CF_BASE}/thumbs/playtech:LiveDragonTiger.webp/public`,
  `${CF_BASE}/thumbs/playtech:FootballCardShowdownLive.webp/public`,
  `${CF_BASE}/thumbs/hacksaw:WantedDeadoraWild.webp/public`,
  `${CF_BASE}/thumbs/hacksaw:SmokingDragon.webp/public`,
  `${CF_BASE}/thumbs/hacksaw:DealWithDeath.webp/public`,
  `${CF_BASE}/thumbss/nolimit:Mental2.webp/public`,
  `${CF_BASE}/thumbss/nolimit:DuckHuntersHappyHour.webp/public`,
  `${CF_BASE}/originals/mines.webp/public`,
  `${CF_BASE}/originals/plinko.webp/public`,
  `${CF_BASE}/originals/dice.webp/public`,
  `${CF_BASE}/originals/limbo.webp/public`,
  `${CF_BASE}/originals/balloon.webp/public`,
  `${CF_BASE}/originals/chicken.webp/public`,
  `${CF_BASE}/originals/keno.webp/public`,
]

function hashToIndex(key: string, modulo: number): number {
  let h = 0
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(31, h) + key.charCodeAt(i)
  }
  return Math.abs(h) % modulo
}

function withThumbRev(base: string, thumbRev?: number): string {
  if (thumbRev == null || thumbRev <= 0) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}v=${thumbRev}`
}

/** Resolved URL for `<img src>` — prefers API thumbnail when present. `thumbRev` busts browser cache after catalog sync. */
export function resolveGameThumbnailUrl(
  thumbnailUrl: string | undefined | null,
  fallbackKey: string,
  thumbRev?: number,
): string {
  const u = thumbnailUrl?.trim()
  let base: string
  if (u && u.toLowerCase() !== 'null' && u.toLowerCase() !== 'undefined') {
    base = u
  } else {
    const i = hashToIndex(fallbackKey, PIGMO_STYLE_FALLBACK_THUMBNAILS.length)
    base = PIGMO_STYLE_FALLBACK_THUMBNAILS[i] ?? PIGMO_STYLE_FALLBACK_THUMBNAILS[0]
  }
  return withThumbRev(base, thumbRev)
}
