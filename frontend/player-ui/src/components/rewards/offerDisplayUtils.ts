import { playerApiUrl } from '../../lib/playerApiUrl'

/**
 * Resolve `player_hero_image_url` for <img src>.
 * - Staff uploads return `/v1/uploads/...`; that passes through.
 * - Common mistakes: `uploads/...` (missing `/v1`) or a full `http://127.0.0.1:.../v1/...` copied from
 *   admin — on the HTTPS player app the latter is blocked as mixed content; we rewrite to a same-origin
 *   path so the normal `/v1` reverse proxy (or VITE_PLAYER_API_ORIGIN) applies.
 */
export function bonusHeroImageSrc(url?: string): string | undefined {
  const raw = url?.trim()
  if (!raw) return undefined

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw)
      const pathWithQuery = `${u.pathname}${u.search || ''}`

      if (u.protocol === 'https:') {
        return raw
      }

      const isHttpsApp = typeof globalThis !== 'undefined' && globalThis.location?.protocol === 'https:'
      if (u.protocol === 'http:' && isHttpsApp && pathWithQuery.length > 1) {
        const isLocal = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
        if (pathWithQuery.startsWith('/v1/') || (isLocal && pathWithQuery.startsWith('/'))) {
          return playerApiUrl(pathWithQuery)
        }
        if (pathWithQuery.startsWith('/uploads/')) {
          return playerApiUrl(`/v1${pathWithQuery}`)
        }
        if (!isLocal) {
          return `https://${u.host}${pathWithQuery}`
        }
      }
      return raw
    } catch {
      return raw
    }
  }

  // Protocol-relative: keep as-is; browser uses current page's scheme.
  if (raw.startsWith('//')) {
    return raw
  }

  let p = raw
  if (p.startsWith('v1/')) p = `/${p}`
  else if (p.startsWith('uploads/')) p = `/v1/${p}`
  else if (p.startsWith('/uploads/') && !p.startsWith('/v1/')) p = `/v1${p}`

  if (!p.startsWith('/')) p = `/${p}`

  return playerApiUrl(p)
}

/** Single line for card subtitle — avoids "Available until Active". */
export function formatOfferSubtitle(validTo?: string, scheduleSummary?: string) {
  if (validTo) {
    const d = new Date(validTo)
    if (!Number.isNaN(d.getTime())) {
      return `Until ${d.toLocaleString(undefined, {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`
    }
  }
  const s = scheduleSummary?.trim()
  if (!s) return 'Eligible now'
  if (s.toLowerCase() === 'active') return 'Ongoing'
  return s
}
