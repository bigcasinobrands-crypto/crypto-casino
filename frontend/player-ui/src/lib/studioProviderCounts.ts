import type { StudioMarqueeLogo } from './studioMarqueeLogos'
import { STUDIO_MARQUEE_LOGOS } from './studioMarqueeLogos'

type CatalogGame = {
  provider?: string
  provider_system?: string
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Same resolution idea as lobby aggregates: prefer `provider_system`, else non-aggregator `provider`. */
export function catalogStudioKey(g: CatalogGame): string {
  const studio = (g.provider_system ?? '').trim()
  const fallback = (g.provider ?? '').trim()
  const raw =
    studio || (fallback && fallback.toLowerCase() !== 'blueocean' ? fallback : '')
  return normalizeKey(raw)
}

function matchesCatalogKeyToLogo(catKey: string, logo: StudioMarqueeLogo): boolean {
  const t = normalizeKey(logo.providerQuery)
  if (!catKey || !t) return false
  if (catKey === t) return true
  switch (logo.id) {
    case 'pragmatic-play':
      return catKey.includes('pragmatic') || catKey === 'pp'
    case 'nolimit-city':
      return catKey.includes('nolimit')
    case 'hacksaw':
      return catKey.includes('hacksaw')
    case 'avatar-ux':
      return catKey.includes('avatar')
    default:
      return false
  }
}

/**
 * Count catalog rows per featured studio card (first matching logo wins per game).
 */
export function countGamesPerStudio(games: CatalogGame[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const id of STUDIO_MARQUEE_LOGOS.map((l) => l.id)) {
    out[id] = 0
  }
  for (const g of games) {
    const k = catalogStudioKey(g)
    if (!k) continue
    for (const logo of STUDIO_MARQUEE_LOGOS) {
      if (matchesCatalogKeyToLogo(k, logo)) {
        out[logo.id] = (out[logo.id] ?? 0) + 1
        break
      }
    }
  }
  return out
}
