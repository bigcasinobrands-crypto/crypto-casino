/**
 * Normalize Oddin Bifrost `route` / `?page=` values so Vybe Bet nav ↔ iframe stay aligned.
 * Oddin may emit ROUTE_CHANGE with URL-encoded payloads; bundled CSV routes are stored decoded.
 */

export function normalizePageParam(raw: string): string {
  let x = raw.trim()
  for (let i = 0; i < 5; i++) {
    try {
      const y = decodeURIComponent(x)
      if (y === x) break
      x = y
    } catch {
      break
    }
  }
  return x.trim()
}

/** Value to store in `?page=` (decoded form; URLSearchParams encodes when serializing the URL bar). */
export function canonicalOddinBifrostPageQueryValue(route: string): string {
  return normalizePageParam(route)
}

function b64DecodeToString(b64: string): string {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/')
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return atob(s + pad)
}

/**
 * Oddin `Sports_Routes.csv` tokens are a single base64 JSON blob (no JWT dot separators).
 * JWT-shaped operator routes are left opaque (string equality / URI normalize only).
 */
function oddinOuterSportIdKey(outer: string): string | undefined {
  if (!outer.startsWith('eyJ')) return undefined
  if (outer.split('.').length >= 3) return undefined
  try {
    const raw = b64DecodeToString(outer)
    const j = JSON.parse(raw) as Record<string, unknown>
    const sid = j.sportId
    return typeof sid === 'string' && sid.trim() ? sid.trim() : undefined
  } catch {
    return undefined
  }
}

/** True when the iframe route and nav `item.page` refer to the same sport (encoding-safe). */
export function bifrostRoutesLooselyEqual(a: string, b: string): boolean {
  const na = normalizePageParam(a)
  const nb = normalizePageParam(b)
  if (na === nb) return true
  const ka = oddinOuterSportIdKey(na)
  const kb = oddinOuterSportIdKey(nb)
  return Boolean(ka && kb && ka === kb)
}
