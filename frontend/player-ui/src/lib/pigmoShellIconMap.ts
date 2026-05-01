/**
 * Optional shell icon swaps: map logical slot → absolute image URL (pigmo CDN or your static host).
 *
 * Set `VITE_PIGMO_SHELL_ICONS` to minified JSON in `.env`, for example:
 * {"search":"https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA/ui/search.webp/public","bell":"..."}
 *
 * Capture URLs from DevTools → Network while loading pigmo.com (filter: imagedelivery | .svg | .webp).
 * Slots used by player-ui: search, menu, message, bell, user, wallet (and any you add below).
 *
 * Optional shorthand: set `VITE_PIGMO_SHELL_ICON_BASE` to a folder URL (no trailing slash) where each slot
 * exists as `{slot}.webp/public` on Cloudflare Images — e.g. after uploading Pigmo exports to one directory.
 * Explicit `VITE_PIGMO_SHELL_ICONS` entries always win.
 */

export type PigmoShellIconSlot =
  | 'search'
  | 'menu'
  | 'message'
  | 'bell'
  | 'user'
  | 'wallet'

let cached: Record<string, string> | null = null

function loadMap(): Record<string, string> {
  if (cached) return cached
  const raw = import.meta.env.VITE_PIGMO_SHELL_ICONS
  if (!raw || typeof raw !== 'string' || !raw.trim()) {
    cached = {}
    return cached
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      cached = {}
      return cached
    }
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) out[k.trim()] = v.trim()
    }
    cached = out
    return cached
  } catch {
    cached = {}
    return cached
  }
}

function baseDerivedUrl(slot: string): string | undefined {
  const base = import.meta.env.VITE_PIGMO_SHELL_ICON_BASE
  if (!base || typeof base !== 'string') return undefined
  const b = base.trim().replace(/\/$/, '')
  if (!b || !/^https?:\/\//i.test(b)) return undefined
  const s = String(slot).trim()
  if (!s) return undefined
  return `${b}/${encodeURIComponent(s)}.webp/public`
}

export function getPigmoShellIconUrl(slot: PigmoShellIconSlot | string): string | undefined {
  const fromJson = loadMap()[slot]
  if (fromJson) return fromJson
  return baseDerivedUrl(slot)
}
