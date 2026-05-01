/**
 * Optional Pigmo-style shell icons for the staff console (matches player-ui slots).
 *
 * - `VITE_PIGMO_SHELL_ICONS` — JSON object slot → https URL (preferred).
 * - `VITE_PIGMO_SHELL_ICON_BASE` — Cloudflare Images folder; tries `{base}/{slot}.webp/public`.
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
