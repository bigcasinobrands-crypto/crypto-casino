/**
 * Optional absolute API origin when the admin SPA is served without a `/v1` proxy
 * (e.g. `vite preview`, static CDN, different host than core).
 *
 * If the origin already ends with `/v1` and `path` starts with `/v1/`, the duplicate
 * segment is collapsed so requests hit `/v1/...` on the API instead of `/v1/v1/...` (404).
 */
/** True when `VITE_ADMIN_API_ORIGIN` is set (build-time) so `/v1/...` calls go to the core API, not the static host. */
export function adminApiOriginConfigured(): boolean {
  const raw = import.meta.env.VITE_ADMIN_API_ORIGIN as string | undefined
  return Boolean(raw?.trim())
}

export function adminApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const base = (import.meta.env.VITE_ADMIN_API_ORIGIN as string | undefined)?.trim().replace(/\/$/, '') ?? ''
  const p = path.startsWith('/') ? path : `/${path}`
  if (!base) return p
  const baseEndsV1 = /\/v1$/i.test(base)
  if (baseEndsV1 && (p === '/v1' || p.startsWith('/v1/'))) {
    return `${base}${p.slice(3)}`
  }
  return `${base}${p}`
}
