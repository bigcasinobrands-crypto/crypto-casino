/** Matches player `EsportsNavItem` shape — avoid importing `esportsNavCatalog` (that module imports this file). */
type EsportsNavRow = { id: string; label: string; page: string; logoUrl?: string }

/** JWT-style opaque Bifrost routes: must not be lowercased or prefixed when matching logos. */
export function isOpaqueOddinBifrostRoute(page: string): boolean {
  const p = page.trim()
  if (!p) return false
  if (p.startsWith('eyJ')) return true
  const parts = p.split('.')
  return parts.length >= 3 && parts.every((seg) => seg.length >= 8)
}

function decodeOddinRouteParam(raw: string): string {
  const t = raw.trim()
  if (!t) return t
  try {
    return decodeURIComponent(t)
  } catch {
    return t
  }
}

/**
 * Oddin `Sports_Routes.csv` column **Route Parameter** (URL-encoded in the sheet).
 * Decoded at runtime so `encodeURIComponent` in navigators yields the same encoding Oddin expects.
 * Source: vendor Oddin / operator CSV (Sport ID = `od:sport:N` in column B).
 */
const ESPORTS_ODDIN_ROUTE_PARAM_ENCODED: Record<string, string> = {
  fortnite:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5BPT0ifQ%3D%3D',
  pubg:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5RPT0ifQ%3D%3D',
  cs2duels:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1qRT0ifQ%3D%3D',
  efootballsim:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16ST0ifQ%3D%3D',
  ebasketballsim:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16TT0ifQ%3D%3D',
  ebasketball:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16UT0ifQ%3D%3D',
  tabletennis:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16WT0ifQ%3D%3D',
  pubgmobile:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16Yz0ifQ%3D%3D',
  dota2duels:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16az0ifQ%3D%3D',
  etouchdown:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5UST0ifQ%3D%3D',
  tekken:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5EUT0ifQ%3D%3D',
  streetfighter:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5EVT0ifQ%3D%3D',
  marvelrivals:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5EZz0ifQ%3D%3D',
  chess:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5Eaz0ifQ%3D%3D',
  eftarena:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16Zz0ifQ%3D%3D',
  deadlock:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5EQT0ifQ%3D%3D',
  geoguessr:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5EST0ifQ%3D%3D',
  cs2:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk13PT0ifQ%3D%3D',
  valorant:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1UTT0ifQ%3D%3D',
  worldoftanks:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5ETT0ifQ%3D%3D',
  lol:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1RPT0ifQ%3D%3D',
  dota2:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1nPT0ifQ%3D%3D',
  fifa:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5nPT0ifQ%3D%3D',
  nba2k:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk53PT0ifQ%3D%3D',
  overwatch2:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk9BPT0ifQ%3D%3D',
  hearthstone:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk9RPT0ifQ%3D%3D',
  kingofglory:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1UQT0ifQ%3D%3D',
  starcraft2:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1URT0ifQ%3D%3D',
  nhl:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1UYz0ifQ%3D%3D',
  rocketleague:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1UST0ifQ%3D%3D',
  starcraft:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1UUT0ifQ%3D%3D',
  cod:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1UVT0ifQ%3D%3D',
  r6:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1UWT0ifQ%3D%3D',
  warcraft3:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1UZz0ifQ%3D%3D',
  halo:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1qYz0ifQ%3D%3D',
  wildrift:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1qZz0ifQ%3D%3D',
  arenaofvalor:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1qaz0ifQ%3D%3D',
  ageofempires:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16QT0ifQ%3D%3D',
  mobilelegends:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16RT0ifQ%3D%3D',
  crossfire:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5EWT0ifQ%3D%3D',
  worldofwarcraft:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5EYz0ifQ%3D%3D',
  efootball:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk1Uaz0ifQ%3D%3D',
  ecricket:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk16VT0ifQ%3D%3D',
  apexlegends:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5UUT0ifQ%3D%3D',
  freefire:
    'eyJyb3V0ZSI6Ii90aW1lbGluZSIsInR5cGUiOiJ1cGNvbWluZyIsInNwb3J0SWQiOiJjM0J2Y25RdmIyUTZjM0J2Y25RNk5ERT0ifQ%3D%3D',
}

/** Decoded route params for Bifrost `route` / `?page=` (Oddin `Sports_Routes.csv` column C). */
export const ESPORTS_ODDIN_ROUTE_PARAM_BY_ID: Record<string, string> = Object.fromEntries(
  Object.entries(ESPORTS_ODDIN_ROUTE_PARAM_ENCODED).map(([k, v]) => [k, decodeOddinRouteParam(v)]),
)

/**
 * Fallback `od:sport:N` when a nav id has no row in `ESPORTS_ODDIN_ROUTE_PARAM_BY_ID` (e.g. `penaltyarena`).
 */
export const ESPORTS_ODDIN_SPORT_URN_BY_ID: Record<string, string> = {
  penaltyarena: 'od:sport:0',
}

/** Operator hotfix: wins over CSV. Keys: `EsportsNavItem.id`. */
export const ESPORTS_BIFROST_ROUTE_OVERRIDE_BY_ID: Partial<Record<string, string>> = {}

function shouldApplyBundledBifrostRoute(currentPage: string): boolean {
  const p = currentPage.trim()
  if (!p) return true
  if (p.startsWith('/')) return true
  if (p.startsWith('od:sport:')) return true
  if (isOpaqueOddinBifrostRoute(p)) return false
  return true
}

/**
 * Applies {@link ESPORTS_BIFROST_ROUTE_OVERRIDE_BY_ID}, then Oddin CSV route params, then {@link ESPORTS_ODDIN_SPORT_URN_BY_ID}.
 * Keeps operator-supplied opaque `page` values from `ODDIN_ESPORTS_NAV_JSON` when they are already non-slash routes.
 */
export function applyEsportsBifrostRoutes(item: EsportsNavRow): EsportsNavRow {
  const id = item.id.toLowerCase()
  const manual = ESPORTS_BIFROST_ROUTE_OVERRIDE_BY_ID[id]?.trim()
  if (manual) {
    return { ...item, page: manual }
  }
  const fromCsv = ESPORTS_ODDIN_ROUTE_PARAM_BY_ID[id]?.trim()
  if (fromCsv && shouldApplyBundledBifrostRoute(item.page)) {
    return { ...item, page: fromCsv }
  }
  const urn = ESPORTS_ODDIN_SPORT_URN_BY_ID[id]?.trim()
  if (urn && shouldApplyBundledBifrostRoute(item.page)) {
    return { ...item, page: urn }
  }
  return item
}

export function applyEsportsBifrostRoutesToAll<T extends EsportsNavRow>(items: T[]): T[] {
  return items.map((it) => ({ ...it, ...applyEsportsBifrostRoutes(it) }) as T)
}
