/** True when `VITE_PLAYER_API_ORIGIN` is set at build time so `/v1/...` hits the Go API, not the static host. */
export function playerApiOriginConfigured(): boolean {
  const raw = import.meta.env.VITE_PLAYER_API_ORIGIN as string | undefined
  return Boolean(raw?.trim())
}

/**
 * Optional absolute API origin for production (player UI and API on different hosts).
 * Dev: leave unset — Vite proxies `/v1` and `/health` to the core API.
 */
export function playerApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const base = (import.meta.env.VITE_PLAYER_API_ORIGIN as string | undefined)?.trim().replace(/\/$/, '') ?? ''
  const p = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${p}` : p
}
