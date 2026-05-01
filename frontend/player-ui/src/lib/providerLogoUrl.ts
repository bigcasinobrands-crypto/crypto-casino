/**
 * Studio / brand logos on the lobby strip — Cloudflare Images (same host as Pigmo game art).
 *
 * Paths follow observed pigmo loads: `{base}/{slug}.webp/public` works for many brands.
 * Aggregators sometimes emit short codes (`bs`, `ga`, …): try known expansions before falling back to text.
 *
 * Override map (optional `.env`): `VITE_PROVIDER_LOGO_SLUGS_JSON={"ae":"avatarux"}`
 */

const CF = 'https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA'

function normalizeKey(code: string): string {
  return code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Single slug after normalization (preferred Pigmo CF image id minus extension). */
const SLUG_ALIASES: Record<string, string> = {
  pragmatic: 'pragmatic',
  pragmaticplay: 'pragmatic',
  pragmaticexternal: 'pragmatic',
  pp: 'pragmatic',
  softswiss: 'softswiss',
  bgaming: 'bgaming',
  hacksaw: 'hacksaw',
  hacksawgaming: 'hacksaw',
  playtech: 'playtech',
  avatarux: 'avatarux',
  avataruxgaming: 'avatarux',
  mascot: 'mascot',
  mascotgaming: 'mascot',
  slotmill: 'slotmill',
  thunderkick: 'thunderkick',
  fantasma: 'fantasma',
  fantasmagames: 'fantasma',
  nolimit: 'nolimit',
  nolimitcity: 'nolimit',
  habanero: 'habanero',
  evolution: 'evolution',
  ezugi: 'ezugi',
  netent: 'netent',
  redtiger: 'redtiger',
  bigtimegaming: 'bigtimegaming',
  btg: 'bigtimegaming',
  playngo: 'playngo',
  playngoslots: 'playngo',
  relax: 'relax',
  relaxgaming: 'relaxgaming',
  quickspin: 'quickspin',
  qgaming: 'quickspin',
  pushgaming: 'pushgaming',
  pgsoft: 'pgsoft',
  platipus: 'platipus',
  pragmaticlive: 'pragmatic',
  pragmaticplaylive: 'pragmatic',
  spribe: 'spribe',
  wazdan: 'wazdan',
  blueprint: 'blueprint',
  yggdrasil: 'yggdrasil',
  playson: 'playson',
  spinomenal: 'spinomenal',
  pragmaticexternalbingo: 'pragmatic',
  evoplay: 'evoplay',
  gamomat: 'gamomat',
  booming: 'booming',
  boominggames: 'booming',
  endorphina: 'endorphina',
  elk: 'elk',
  elkstudios: 'elk',
  microgaming: 'microgaming',
  gamesglobal: 'microgaming',
  netgame: 'netgame',
  betsoft: 'betsoft',
  bsg: 'betsoft',
  gameart: 'gameart',
}

/**
 * When the aggregator sends an opaque code (e.g. `qr`), try Pigmo slug ids until one resolves.
 */
const SLUG_GROUPS: Record<string, readonly string[]> = {
  qr: ['quickspin', 'relax', 'relaxgaming', 'relaxgaminglimited'],
  /** Common Blue Ocean / staging abbreviations → Pigmo-style basename guesses */
  bs: ['betsoft', 'bsg'],
  ga: ['gameart'],
  pp: ['pragmatic', 'pragmaticplay'],
  /** Short opaque codes: try likely studio folders */
  '5m': ['5men', 'fivemen', '5mengaming'],
  '1h': ['1x2', '1x2gaming', 'onetouch', 'one_touch'],
}

let cachedEnvOverrides: Record<string, string> | null = null
function slugOverrides(): Record<string, string> {
  if (cachedEnvOverrides) return cachedEnvOverrides
  cachedEnvOverrides = {}
  try {
    const raw = import.meta.env.VITE_PROVIDER_LOGO_SLUGS_JSON as string | undefined
    if (raw?.trim()) {
      const o = JSON.parse(raw) as Record<string, unknown>
      for (const [k, v] of Object.entries(o)) {
        const key = normalizeKey(k)
        const slug = typeof v === 'string' ? normalizeKey(v) : ''
        if (key && slug) cachedEnvOverrides[key] = slug
      }
    }
  } catch {
    cachedEnvOverrides = {}
  }
  return cachedEnvOverrides
}

/** Build Pigmo CDN URL attempts for an image basename (usually provider slug). */
function cfVariantsForBasename(base: string): string[] {
  const b = base.trim()
  if (!b) return []
  const v1 = `${CF}/${b}.webp/public`
  const v2 = `${CF}/${b}/public`
  const v3 = `${CF}/${b}.webp/quality=95,fit=contain`
  const out: string[] = []
  const seen = new Set<string>()
  for (const u of [v1, v2, v3]) {
    if (!seen.has(u)) {
      seen.add(u)
      out.push(u)
    }
  }
  return out
}

function primarySlugsForCode(codeRaw: string): string[] {
  const key = normalizeKey(codeRaw)
  if (!key) return []

  const overrides = slugOverrides()[key]
  if (overrides) return [overrides]

  const group = SLUG_GROUPS[key]
  if (group?.length) return [...group]

  const single = SLUG_ALIASES[key]
  if (single) return [single]

  /** Last resort: use normalized key itself (helps when catalog already emits `pragmatic`). */
  return [key]
}

/**
 * Ordered list of image URLs to try for this provider/system code (`<img onError>` can advance).
 */
export function resolveProviderLogoCandidates(providerCodeRaw: string): readonly string[] {
  const primary = primarySlugsForCode(providerCodeRaw)
  const urls: string[] = []
  const seen = new Set<string>()
  for (const slug of primary) {
    for (const u of cfVariantsForBasename(slug)) {
      if (!seen.has(u)) {
        seen.add(u)
        urls.push(u)
      }
    }
  }
  return urls.length > 0 ? urls : cfVariantsForBasename(normalizeKey(providerCodeRaw))
}

/** Legacy single URL (first candidate). */
export function resolveProviderLogoUrl(providerCodeRaw: string): string {
  const c = resolveProviderLogoCandidates(providerCodeRaw)
  return c[0] ?? `${CF}/unknown.webp/public`
}
