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

/**
 * Oddin sport identifiers from operator “Sports_Routes” (column B: `od:sport:N`).
 * These are passed as the `page` query param → Bifrost `route`, same as long JWT/param strings in column C when you paste those into {@link ESPORTS_BIFROST_ROUTE_OVERRIDE_BY_ID} or `ODDIN_ESPORTS_NAV_JSON`.
 *
 * **JWT / column C:** If Bifrost requires the full opaque token for your env, set it in `ESPORTS_BIFROST_ROUTE_OVERRIDE_BY_ID` (per `id`) or in core `ODDIN_ESPORTS_NAV_JSON`; overrides win and are never replaced by URNs.
 */
export const ESPORTS_ODDIN_SPORT_URN_BY_ID: Record<string, string> = {
  lol: 'od:sport:1',
  dota2: 'od:sport:2',
  cs2: 'od:sport:3',
  fortnite: 'od:sport:4',
  pubg: 'od:sport:5',
  fifa: 'od:sport:6',
  nba2k: 'od:sport:7',
  overwatch2: 'od:sport:8',
  hearthstone: 'od:sport:9',
  kingofglory: 'od:sport:10',
  starcraft2: 'od:sport:11',
  rocketleague: 'od:sport:12',
  valorant: 'od:sport:13',
  starcraft: 'od:sport:14',
  cod: 'od:sport:15',
  r6: 'od:sport:16',
  nhl: 'od:sport:17',
  warcraft3: 'od:sport:18',
  efootball: 'od:sport:19',
  cs2duels: 'od:sport:21',
  halo: 'od:sport:27',
  wildrift: 'od:sport:28',
  arenaofvalor: 'od:sport:29',
  ageofempires: 'od:sport:30',
  mobilelegends: 'od:sport:31',
  efootballsim: 'od:sport:32',
  ebasketballsim: 'od:sport:33',
  ebasketball: 'od:sport:34',
  ecricket: 'od:sport:35',
  tabletennis: 'od:sport:36',
  pubgmobile: 'od:sport:37',
  eftarena: 'od:sport:38',
  dota2duels: 'od:sport:39',
  deadlock: 'od:sport:40',
  freefire: 'od:sport:41',
  geoguessr: 'od:sport:42',
  worldoftanks: 'od:sport:43',
  tekken: 'od:sport:44',
  /** Sheet maps both Street Fighter and Crossfire to `od:sport:46` — same Bifrost target until Oddin disambiguates. */
  streetfighter: 'od:sport:46',
  crossfire: 'od:sport:46',
  worldofwarcraft: 'od:sport:47',
  marvelrivals: 'od:sport:48',
  chess: 'od:sport:49',
  etouchdown: 'od:sport:52',
  apexlegends: 'od:sport:54',
}

/**
 * Paste full column-C route strings from Oddin Sports_Routes when `od:sport:N` is not accepted by your Bifrost build.
 * Keys are `EsportsNavItem.id` (e.g. `lol`, `dota2`).
 */
export const ESPORTS_BIFROST_ROUTE_OVERRIDE_BY_ID: Partial<Record<string, string>> = {}

function shouldReplacePageWithUrn(currentPage: string): boolean {
  const p = currentPage.trim()
  if (!p) return true
  if (p.startsWith('/')) return true
  if (p.startsWith('od:sport:')) return false
  if (isOpaqueOddinBifrostRoute(p)) return false
  return true
}

/**
 * Applies {@link ESPORTS_BIFROST_ROUTE_OVERRIDE_BY_ID}, then fills `od:sport:*` URNs when `page` is empty or a legacy `/path` slug.
 * Does not replace operator JWT / long opaque `page` values from API JSON.
 */
export function applyEsportsBifrostRoutes(item: EsportsNavRow): EsportsNavRow {
  if (item.id === 'overview') {
    return { ...item, page: '' }
  }
  const id = item.id.toLowerCase()
  const override = ESPORTS_BIFROST_ROUTE_OVERRIDE_BY_ID[id]?.trim()
  if (override) {
    return { ...item, page: override }
  }
  const urn = ESPORTS_ODDIN_SPORT_URN_BY_ID[id]
  if (!urn || !shouldReplacePageWithUrn(item.page)) {
    return item
  }
  return { ...item, page: urn }
}

export function applyEsportsBifrostRoutesToAll<T extends EsportsNavRow>(items: T[]): T[] {
  return items.map((it) => ({ ...it, ...applyEsportsBifrostRoutes(it) }) as T)
}
