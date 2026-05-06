/** True when `VITE_PLAYER_API_ORIGIN` is set at build time so `/v1/...` hits the Go API, not the static host. */
export function playerApiOriginConfigured(): boolean {
  if ((import.meta.env.VITE_PLAYER_API_ORIGIN as string | undefined)?.trim()) return true
  if (typeof document !== 'undefined') {
    return Boolean(document.querySelector('meta[name="player-api-origin"]')?.getAttribute('content')?.trim())
  }
  return false
}

/**
 * Optional absolute API origin for production (player UI and API on different hosts).
 * Dev: leave unset — Vite proxies `/v1` and `/health` to the core API.
 */
export function playerApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  let base = (import.meta.env.VITE_PLAYER_API_ORIGIN as string | undefined)?.trim().replace(/\/$/, '') ?? ''
  if (!base && typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="player-api-origin"]')?.getAttribute('content')?.trim()
    if (meta) base = meta.replace(/\/$/, '')
  }
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}

/**
 * When the browser resolves API calls to an absolute URL, returns that origin (scheme + host).
 * Used in connection-error copy so operators can confirm they are not hitting the static host by mistake.
 */
export function playerApiConfiguredOrigin(): string | undefined {
  try {
    const u = playerApiUrl('/v1/health')
    if (u.startsWith('/')) return undefined
    return new URL(u).origin
  } catch {
    return undefined
  }
}
