/** Bundled player logo paths under `public/` (respect Vite `base`). */
export function playerPublicUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

/** Default horizontal wordmark — PNG preserves authored artwork; SVG kept as lightweight fallback. */
export const DEFAULT_PLAYER_LOGO_PNG = playerPublicUrl('/vybebet-logo.png')
export const DEFAULT_PLAYER_LOGO_SVG = playerPublicUrl('/vybebet-logo.svg')
