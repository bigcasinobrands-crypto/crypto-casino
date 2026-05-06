/**
 * Esports shortcuts for the sidebar / mobile drawer.
 * `page` is passed as `?page=` and forwarded to Oddin Bifrost `route`.
 *
 * Prefer **Oddin-supplied `logoUrl`** (HTTPS) on each row in `ODDIN_ESPORTS_NAV_JSON` / `GET /v1/sportsbook/oddin/esports-nav`.
 * The bundled list below only fills gaps: titles use **game marks** where a stable CDN icon exists — not publisher wordmarks
 * that repeat across unrelated rows. `mergeEsportsNavLogosFromFallback` merges these when the API omits `logoUrl`.
 */
export type EsportsNavItem = {
  id: string
  label: string
  /**
   * Bifrost route segment. Empty = sportsbook default (no `page` query).
   */
  page: string
  /** Image URL: HTTPS or same-origin path (e.g. `/esports/...`). */
  logoUrl?: string
}

const si = (slug: string, color: string) => `https://cdn.simpleicons.org/${slug}/${color}`

/**
 * Default list aligned with Oddin “Bifrost → Sports order”. Client order may differ.
 * Rows without `logoUrl` use the swords fallback (failed remote icons do the same via `onError`).
 */
export const ESPORTS_NAV_FALLBACK: EsportsNavItem[] = [
  { id: 'overview', label: 'Overview', page: '' },
  { id: 'lol', label: 'League of Legends', page: '/lol', logoUrl: si('leagueoflegends', 'C89B3C') },
  { id: 'dota2', label: 'Dota 2', page: '/dota2', logoUrl: si('dota2', 'D04C24') },
  { id: 'cs2', label: 'Counter-Strike 2', page: '/cs2', logoUrl: si('counterstrike', 'A27835') },
  { id: 'fortnite', label: 'Fortnite', page: '/fortnite', logoUrl: si('fortnite', '9146FF') },
  { id: 'pubg', label: "PlayerUnknown's Battlegrounds", page: '/pubg', logoUrl: si('pubg', 'ED8A00') },
  { id: 'fifa', label: 'FIFA', page: '/fifa', logoUrl: si('fifa', '326295') },
  { id: 'nba2k', label: 'NBA2K', page: '/nba2k', logoUrl: '/esports/nba2k.png' },
  { id: 'overwatch2', label: 'Overwatch', page: '/overwatch2', logoUrl: '/esports/overwatch.png' },
  { id: 'hearthstone', label: 'Hearthstone', page: '/hearthstone', logoUrl: '/esports/hearthstone.png' },
  { id: 'kingofglory', label: 'King of Glory', page: '/kingofglory', logoUrl: '/esports/kingofglory.png' },
  { id: 'starcraft2', label: 'StarCraft 2', page: '/starcraft2', logoUrl: '/esports/starcraft2.png' },
  { id: 'rocketleague', label: 'Rocket League', page: '/rocketleague' },
  { id: 'valorant', label: 'Valorant', page: '/valorant', logoUrl: si('valorant', 'FF4655') },
  { id: 'starcraft', label: 'StarCraft 1', page: '/starcraft', logoUrl: '/esports/starcraft.png' },
  { id: 'cod', label: 'Call of Duty', page: '/cod', logoUrl: '/esports/call-of-duty.png' },
  { id: 'r6', label: 'Rainbow Six', page: '/rainbow6', logoUrl: '/esports/rainbow-six.png' },
  { id: 'nhl', label: 'NHL', page: '/nhl', logoUrl: si('nhl', 'FFFFFF') },
  { id: 'warcraft3', label: 'Warcraft 3', page: '/warcraft3', logoUrl: '/esports/warcraft3.png' },
  { id: 'efootball', label: 'eFootball', page: '/efootball', logoUrl: si('konami', 'E40521') },
  { id: 'cs2duels', label: 'Counter-Strike 2 Duels', page: '/cs2duels', logoUrl: si('counterstrike', 'A27835') },
  { id: 'halo', label: 'HALO', page: '/halo', logoUrl: '/esports/halo.png' },
  { id: 'wildrift', label: 'Wild Rift', page: '/wildrift', logoUrl: si('leagueoflegends', '004D92') },
  { id: 'arenaofvalor', label: 'Arena of Valor', page: '/arenaofvalor', logoUrl: '/esports/arenaofvalor.png' },
  { id: 'ageofempires', label: 'Age of Empires', page: '/ageofempires', logoUrl: '/esports/ageofempires.png' },
  { id: 'mobilelegends', label: 'Mobile Legends', page: '/mobilelegends', logoUrl: '/esports/mobilelegends.png' },
  { id: 'efootballsim', label: 'eFootball Sim', page: '/efootballsim', logoUrl: si('konami', 'E40521') },
  { id: 'ebasketballsim', label: 'eBasketball Sim', page: '/ebasketballsim', logoUrl: si('nba', '253597') },
  { id: 'ebasketball', label: 'eBasketball', page: '/ebasketball', logoUrl: si('nba', '253597') },
  { id: 'ecricket', label: 'eCricket', page: '/ecricket', logoUrl: '/esports/ecricket.png' },
  { id: 'tabletennis', label: 'Table Tennis', page: '/tabletennis', logoUrl: '/esports/tabletennis.png' },
  { id: 'pubgmobile', label: "PlayerUnknown's Battlegrounds Mobile", page: '/pubgmobile', logoUrl: si('pubg', 'ED8A00') },
  { id: 'eftarena', label: 'Escape from Tarkov: Arena', page: '/eftarena' },
  { id: 'dota2duels', label: 'Dota 2 Duels', page: '/dota2duels', logoUrl: si('dota2', 'D04C24') },
  { id: 'deadlock', label: 'Deadlock', page: '/deadlock', logoUrl: si('valve', 'F74843') },
  { id: 'freefire', label: 'Free Fire', page: '/freefire', logoUrl: '/esports/freefire.png' },
  { id: 'geoguessr', label: 'Geo Guessr', page: '/geoguessr', logoUrl: '/esports/geoguessr.png' },
  { id: 'worldoftanks', label: 'World of Tanks', page: '/worldoftanks' },
  { id: 'tekken', label: 'Tekken', page: '/tekken', logoUrl: '/esports/tekken.png' },
  { id: 'streetfighter', label: 'Street Fighter', page: '/streetfighter', logoUrl: '/esports/streetfighter.png' },
  { id: 'crossfire', label: 'Crossfire', page: '/crossfire' },
  { id: 'worldofwarcraft', label: 'World of Warcraft', page: '/worldofwarcraft' },
  { id: 'marvelrivals', label: 'Marvel Rivals', page: '/marvelrivals' },
  { id: 'chess', label: 'Chess', page: '/chess', logoUrl: si('chessdotcom', '81B64C') },
  { id: 'etouchdown', label: 'eTouchdown', page: '/etouchdown', logoUrl: '/esports/etouchdown.png' },
  { id: 'penaltyarena', label: 'Penalty Arena', page: '/penaltyarena' },
  {
    id: 'apexlegends',
    label: 'Apex Legends',
    page: '/apexlegends',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/3/3e/Apex_Legends_logo.svg',
  },
]

/** Normalize Bifrost `page` for lookup (leading slash + lowercase). */
export function normalizeEsportsNavPageKey(page: string): string {
  const p = page.trim()
  if (!p) return ''
  const withSlash = p.startsWith('/') ? p : `/${p}`
  return withSlash.toLowerCase()
}

type LogoLookups = { byPage: Map<string, string>; byId: Map<string, string> }

function buildEsportsNavLogoLookups(rows: EsportsNavItem[]): LogoLookups {
  const byPage = new Map<string, string>()
  const byId = new Map<string, string>()
  for (const row of rows) {
    if (!row.logoUrl?.trim()) continue
    const logo = row.logoUrl.trim()
    const pk = normalizeEsportsNavPageKey(row.page)
    if (pk) byPage.set(pk, logo)
    byId.set(row.id.toLowerCase(), logo)
  }
  return { byPage, byId }
}

const ESPORTS_NAV_LOGO_LOOKUPS = buildEsportsNavLogoLookups(ESPORTS_NAV_FALLBACK)

/**
 * When `GET /v1/sportsbook/oddin/esports-nav` returns rows without `logoUrl`, fill from the bundled fallback
 * by matching `page` first, then `id`. Operator/API `logoUrl` (e.g. Oddin CDN HTTPS) is never overwritten.
 */
export function mergeEsportsNavLogosFromFallback(items: EsportsNavItem[]): EsportsNavItem[] {
  return items.map((it) => {
    if (it.logoUrl?.trim()) return it
    const pk = normalizeEsportsNavPageKey(it.page)
    const fromPage = pk ? ESPORTS_NAV_LOGO_LOOKUPS.byPage.get(pk) : undefined
    if (fromPage) return { ...it, logoUrl: fromPage }
    const fromId = ESPORTS_NAV_LOGO_LOOKUPS.byId.get(it.id.toLowerCase())
    if (fromId) return { ...it, logoUrl: fromId }
    return it
  })
}
