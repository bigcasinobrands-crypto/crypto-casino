import { useEffect, useState } from 'react'
import { playerApiUrl } from './playerApiUrl'
import { pigmoFuturesIconUrl } from './pigmoIconAssets'

/** Default symbols requested on every fetch (Logo.dev + fallbacks). */
const DEFAULT_QUERY_SYMBOLS = ['btc', 'bnb', 'eth', 'trx', 'usdc', 'usdt'] as const

/**
 * Legacy comma list of the default symbol set (sorted, matches `buildSymbolQuery` for defaults-only).
 */
export const CRYPTO_LOGO_SYMBOLS = [...DEFAULT_QUERY_SYMBOLS].sort().join(',')

/** Matches server-side Logo.dev path validation (services/core/internal/market/logodev.go). */
const LOGO_SYMBOL_RE = /^[a-z0-9-]{1,24}$/

/**
 * Slugs that are too generic to use alone (would steal "PayPal USD" → `usd`, "Official Trump" → noise).
 * Still allowed when present as a curated key in `COINGECKO_LOGOS`.
 */
const WEAK_SLUGS: Set<string> = new Set([
  'usd',
  'eur',
  'gbp',
  'official',
  'token',
  'coin',
  'network',
  'chain',
  'wallet',
  'solana',
  'ethereum',
  'bitcoin',
  'erc20',
  'bep20',
  'trc20',
  'polygon',
  'arbitrum',
])

/**
 * Map unusual provider tickers to a slug CoinGecko / Logo.dev understands.
 * Keys must be lowercase. Include squeezed / phrase keys for PassimPay labels.
 */
const LOGO_SYMBOL_ALIASES: Record<string, string> = {
  wbtc: 'btc',
  weth: 'eth',
  arbitrum: 'arb',
  optimism: 'op',
  cardano: 'ada',
  cosmos: 'atom',
  dogwifhat: 'wif',
  hashflow: 'hft',
  kusama: 'ksm',
  /** Compounds (normalized phrase / squeezed) */
  'paypal usd': 'pyusd',
  paypalusd: 'pyusd',
  paypal: 'pyusd',
  'official trump': 'trump',
  officialtrump: 'trump',
  'trust wallet': 'twt',
  trustwallet: 'twt',
  trust: 'twt',
  notcoin: 'not',
  /** Meme / provider quirks */
  alchemy: 'ach',
  catcoin: 'mew',
  cat: 'mew',
  /** Native / full-name network strings from PassimPay */
  bitcoin: 'btc',
  litecoin: 'ltc',
  ripple: 'xrp',
  dogecoin: 'doge',
  toncoin: 'ton',
  skr: 'seeker',
}

/**
 * Built-in logos (CoinGecko CDN). Prefer `coin-images.coingecko.com` where available — fewer hotlink edge cases.
 */
const COINGECKO_LOGOS: Record<string, string> = {
  ach: 'https://coin-images.coingecko.com/coins/images/12390/small/Alchemy_Pay.png',
  ada: 'https://coin-images.coingecko.com/coins/images/975/small/cardano.png',
  aave: 'https://coin-images.coingecko.com/coins/images/12645/small/AAVE.png',
  algo: 'https://coin-images.coingecko.com/coins/images/4380/small/download.png',
  ape: 'https://coin-images.coingecko.com/coins/images/24383/small/apecoin.jpg',
  arb: 'https://coin-images.coingecko.com/coins/images/16547/small/arb.jpg',
  atom: 'https://coin-images.coingecko.com/coins/images/1481/small/cosmos_hub.png',
  audio: 'https://coin-images.coingecko.com/coins/images/18035/small/audiomack.png',
  avax: 'https://coin-images.coingecko.com/coins/images/12559/small/coin-round-red.png',
  /** Base L2 — PassimPay uses `BASE` / chain id 8453 */
  base: 'https://coin-images.coingecko.com/asset_platforms/images/131/small/base.jpeg?1759905869',
  bch: 'https://coin-images.coingecko.com/coins/images/780/small/bitcoin-cash-circle.png',
  bnb: 'https://coin-images.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  bonk: 'https://coin-images.coingecko.com/coins/images/28600/small/bonk.jpg',
  btc: 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png',
  cro: 'https://coin-images.coingecko.com/coins/images/7310/small/cro_token_logo.png',
  crv: 'https://coin-images.coingecko.com/coins/images/12124/small/Curve.png',
  dai: 'https://coin-images.coingecko.com/coins/images/9956/small/Badge_Dai.png',
  dash: 'https://coin-images.coingecko.com/coins/images/19/small/dash-logo.png',
  dydx: 'https://coin-images.coingecko.com/coins/images/32594/small/dydx.png?1750851258',
  dogs: 'https://coin-images.coingecko.com/coins/images/39699/small/dogs_logo_200x200.png',
  doge: 'https://coin-images.coingecko.com/coins/images/5/small/dogecoin.png',
  dot: 'https://coin-images.coingecko.com/coins/images/12171/small/polkadot.png',
  egld: 'https://coin-images.coingecko.com/coins/images/12335/small/egld-token-logo.png',
  eos: 'https://coin-images.coingecko.com/coins/images/738/small/CG_EOS_Icon.png?1731705232',
  etc: 'https://coin-images.coingecko.com/coins/images/453/small/ethereum-classic-logo.png',
  eth: 'https://coin-images.coingecko.com/coins/images/279/small/ethereum.png',
  fil: 'https://coin-images.coingecko.com/coins/images/12817/small/filecoin.png',
  fet: 'https://coin-images.coingecko.com/coins/images/5681/small/Fetch.jpg',
  floki: 'https://coin-images.coingecko.com/coins/images/16746/small/FLOKI.png',
  flow: 'https://coin-images.coingecko.com/coins/images/13446/small/Flow_logo_original.png',
  ftm: 'https://coin-images.coingecko.com/coins/images/4001/small/Fantom_round.png',
  grt: 'https://coin-images.coingecko.com/coins/images/13397/small/Graph_Token.png',
  hbar: 'https://coin-images.coingecko.com/coins/images/3688/small/hbar.png',
  hft: 'https://coin-images.coingecko.com/coins/images/26136/small/hashflow.png',
  icp: 'https://coin-images.coingecko.com/coins/images/14495/small/Internet_Computer_logo.png',
  imx: 'https://coin-images.coingecko.com/coins/images/17233/small/imx.png',
  inj: 'https://coin-images.coingecko.com/coins/images/12882/small/Secondary_Symbol.png',
  ksm: 'https://coin-images.coingecko.com/coins/images/9568/small/kusama.png',
  ldo: 'https://coin-images.coingecko.com/coins/images/13573/small/Lido_DAO.png',
  link: 'https://coin-images.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  ltc: 'https://coin-images.coingecko.com/coins/images/2/small/litecoin.png',
  matic: 'https://coin-images.coingecko.com/coins/images/4713/small/matic-token-icon.png',
  mew: 'https://coin-images.coingecko.com/coins/images/36440/small/MEW.png?1711442286',
  mkr: 'https://coin-images.coingecko.com/coins/images/1518/small/Maker.png',
  near: 'https://coin-images.coingecko.com/coins/images/10365/small/near.jpg',
  not: 'https://coin-images.coingecko.com/coins/images/33453/small/rFmThDiD_400x400.jpg?1701876350',
  op: 'https://coin-images.coingecko.com/coins/images/25244/small/Optimism.png',
  pepe: 'https://coin-images.coingecko.com/coins/images/29850/small/pepe-token.jpeg',
  pol: 'https://coin-images.coingecko.com/coins/images/4713/small/polygon.png',
  pyusd: 'https://coin-images.coingecko.com/coins/images/31212/small/PYUSD_Token_Logo_2x.png?1765987788',
  rune: 'https://coin-images.coingecko.com/coins/images/6595/small/RUNE.png',
  seeker: 'https://coin-images.coingecko.com/coins/images/70974/small/seeker-logo.jpg?1764922774',
  shib: 'https://coin-images.coingecko.com/coins/images/11939/small/shiba.png',
  snx: 'https://coin-images.coingecko.com/coins/images/3406/small/SNX.png',
  sol: 'https://coin-images.coingecko.com/coins/images/4128/small/solana.png',
  stx: 'https://coin-images.coingecko.com/coins/images/2069/small/Stacks_logo_full.png',
  sui: 'https://coin-images.coingecko.com/coins/images/26375/small/sui_asset.png',
  trx: 'https://coin-images.coingecko.com/coins/images/1094/small/tron-logo.png',
  ton: 'https://coin-images.coingecko.com/coins/images/17980/small/ton_symbol.png',
  trump: 'https://coin-images.coingecko.com/coins/images/53746/small/trump.png?1737171561',
  twt: 'https://coin-images.coingecko.com/coins/images/11085/small/Trust.png?1696511026',
  uni: 'https://coin-images.coingecko.com/coins/images/12504/small/uni.jpg',
  usdc: 'https://coin-images.coingecko.com/coins/images/6319/small/usdc.png',
  usdt: 'https://coin-images.coingecko.com/coins/images/325/small/Tether.png',
  vet: 'https://coin-images.coingecko.com/coins/images/1167/small/VET.png',
  wif: 'https://coin-images.coingecko.com/coins/images/33566/small/dogwifhat.jpg',
  xlm: 'https://coin-images.coingecko.com/coins/images/100/small/Stellar_symbol_black_vector.png',
  xmr: 'https://coin-images.coingecko.com/coins/images/69/small/monero_logo.png',
  xrp: 'https://coin-images.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  xtz: 'https://coin-images.coingecko.com/coins/images/976/small/Tezos-logo.png',
  zec: 'https://coin-images.coingecko.com/coins/images/486/small/circle-zcash-color.png',
}

/** Pigmo futures strip SVGs (`futures-icons/*`) — opt-in via `VITE_PIGMO_FUTURES_CRYPTO_ICONS`. */
function resolvedBuiltinLogos(): Record<string, string> {
  const v = import.meta.env.VITE_PIGMO_FUTURES_CRYPTO_ICONS
  if (v !== 'true' && v !== '1') return { ...COINGECKO_LOGOS }
  const px = 64
  return {
    ...COINGECKO_LOGOS,
    btc: pigmoFuturesIconUrl('btc', px),
    eth: pigmoFuturesIconUrl('eth', px),
    sol: pigmoFuturesIconUrl('sol', px),
    doge: pigmoFuturesIconUrl('doge', px),
  }
}

const BUILTIN_LOGOS: Record<string, string> = resolvedBuiltinLogos()

type LogoUrlsResponse = {
  urls?: Record<string, string>
  configured?: boolean
}

function slugFromSegment(segment: string): string | null {
  const raw = segment.trim().toLowerCase()
  if (!raw) return null
  const mapped = LOGO_SYMBOL_ALIASES[raw] ?? raw
  return LOGO_SYMBOL_RE.test(mapped) ? mapped : null
}

function isStrongSlug(slug: string): boolean {
  if (COINGECKO_LOGOS[slug]) return true
  if (!WEAK_SLUGS.has(slug)) return true
  return false
}

/**
 * Map PassimPay `network` string to a chain logo slug when the token itself is unknown.
 */
export function passimpayNetworkToLogoSlug(netRaw: string): string | null {
  const u = netRaw.trim().toUpperCase()
  if (!u) return null

  /** PassimPay native / human network names (must run before ERC20 fallback). */
  if (u === 'BITCOIN' || (u.includes('BITCOIN') && !u.includes('CASH'))) return 'btc'
  if (u.includes('BITCOIN CASH')) return 'bch'
  if (u === 'LITECOIN' || u.includes('LITECOIN')) return 'ltc'
  if (u === 'RIPPLE' || u.includes('RIPPLE')) return 'xrp'
  if (u === 'DOGECOIN' || u.includes('DOGECOIN')) return 'doge'
  if (u === 'DASH' || (u.includes('DASH') && !u.includes('DASHBOARD'))) return 'dash'
  if (u === 'TONCOIN' || u.endsWith('TONCOIN')) return 'ton'
  if (u === 'NEAR' || u.includes('NEAR PROTOCOL')) return 'near'

  if (u === '8453' || u === 'BASE' || (u.includes('BASE') && !u.includes('COINBASE'))) return 'base'

  if (u === 'SOL' || u === 'SOLANA' || u.includes('SOLANA')) return 'sol'
  if (u === 'TON' || u.includes('TON')) return 'ton'
  if (u === 'TRC20' || u === 'TRON' || u === 'TRX') return 'trx'
  if (u === 'BEP20' || u === 'BSC' || u === 'BNB' || u.includes('BNB') || u.includes('BEP')) return 'bnb'
  if (u === 'POLYGON' || u === 'MATIC' || u.includes('POLYGON')) return 'pol'
  if (u.includes('ARBITRUM')) return 'arb'
  if (u.includes('OPTIMISM')) return 'op'
  if (u === 'AVALANCHE' || u === 'AVAX' || u.includes('AVAX') || u.includes('C-CHAIN')) return 'avax'
  if (u === 'ERC20' || u === 'ETH' || u === 'ETHEREUM' || u.includes('ERC')) return 'eth'
  if (u === '1' || u === '5') return 'eth'
  if (u === '56' || u === '97') return 'bnb'
  if (u === '137') return 'pol'
  if (u === '42161') return 'arb'
  if (u === '10') return 'op'
  if (u === '43114') return 'avax'
  return null
}

export function normalizeCryptoLogoSymbol(raw: string): string | null {
  const base = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!base) return null

  /** Exact phrase */
  if (LOGO_SYMBOL_ALIASES[base]) {
    const s = slugFromSegment(LOGO_SYMBOL_ALIASES[base])
    if (s) return s
  }

  const squeezed = base.replace(/[\s/_-]+/g, '')
  if (LOGO_SYMBOL_ALIASES[squeezed]) {
    const s = slugFromSegment(LOGO_SYMBOL_ALIASES[squeezed])
    if (s) return s
  }
  {
    const s = slugFromSegment(squeezed)
    if (s && isStrongSlug(s)) return s
  }

  const parts = base.split(/[\s/_-]+/).filter(Boolean)

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!
    if (LOGO_SYMBOL_ALIASES[p]) {
      const s = slugFromSegment(LOGO_SYMBOL_ALIASES[p])
      if (s && isStrongSlug(s)) return s
    }
    const s = slugFromSegment(p)
    if (s && isStrongSlug(s)) return s
  }

  for (const p of parts) {
    if (LOGO_SYMBOL_ALIASES[p]) {
      const s = slugFromSegment(LOGO_SYMBOL_ALIASES[p])
      if (s && isStrongSlug(s)) return s
    }
    const s = slugFromSegment(p)
    if (s && isStrongSlug(s)) return s
  }

  return null
}

/** Resolve a URL from a map fetched via `getCryptoLogoUrlMap` / `useCryptoLogoUrlMap`.
 * Falls back to curated CoinGecko URLs when the map has no entry (fixes missing PassimPay ticker art).
 */
function pickLogoUrl(urls: Record<string, string>, slug: string): string | undefined {
  const fromHook = urls[slug]?.trim()
  if (fromHook) return fromHook
  const builtin = COINGECKO_LOGOS[slug]?.trim()
  if (builtin) return builtin
  return undefined
}

export function resolveCryptoLogoUrl(
  urls: Record<string, string>,
  rawSymbol: string,
  networkRaw?: string,
): string | undefined {
  const n = normalizeCryptoLogoSymbol(rawSymbol)
  if (n) {
    const got = pickLogoUrl(urls, n)
    if (got) return got
  }
  const chain = networkRaw ? passimpayNetworkToLogoSlug(networkRaw) : null
  if (chain) {
    const got = pickLogoUrl(urls, chain)
    if (got) return got
  }
  const rawLower = rawSymbol.trim().toLowerCase()
  if (LOGO_SYMBOL_RE.test(rawLower)) {
    const got = pickLogoUrl(urls, rawLower)
    if (got) return got
  }
  return undefined
}

function buildSymbolQuery(extraRawSymbols?: readonly string[]): string {
  const set = new Set<string>(DEFAULT_QUERY_SYMBOLS as unknown as string[])
  for (const raw of extraRawSymbols ?? []) {
    const n = normalizeCryptoLogoSymbol(raw)
    if (n) set.add(n)
    const ch = passimpayNetworkToLogoSlug(raw)
    if (ch) set.add(ch)
  }
  return Array.from(set).sort().join(',')
}

const cache = new Map<string, Record<string, string>>()
const inflight = new Map<string, Promise<Record<string, string>>>()

/**
 * Fetches Logo.dev CDN URLs from the API (publishable key never ships in the JS bundle).
 * Merges `extraRawSymbols` (e.g. PassimPay tickers) into the request so AAVE, ADA, etc. resolve.
 * Falls back to built-in CoinGecko URLs when Logo.dev is not configured or a symbol is missing.
 */
export async function getCryptoLogoUrlMap(extraRawSymbols?: readonly string[]): Promise<Record<string, string>> {
  const query = buildSymbolQuery(extraRawSymbols)
  const hit = cache.get(query)
  if (hit) return hit

  let p = inflight.get(query)
  if (p) {
    const urls = await p
    return urls
  }

  p = (async () => {
    try {
      const u = playerApiUrl(`/v1/market/crypto-logo-urls?symbols=${encodeURIComponent(query)}`)
      const res = await fetch(u)
      if (!res.ok) {
        return { ...BUILTIN_LOGOS }
      }
      const j = (await res.json()) as LogoUrlsResponse
      const api = j.urls && typeof j.urls === 'object' ? j.urls : {}
      const hasApiUrls = Object.keys(api).length > 0
      if (!hasApiUrls) {
        return { ...BUILTIN_LOGOS }
      }
      /** Curated `BUILTIN_LOGOS` wins so Logo.dev cannot clobber known-good CDN URLs. */
      const merged: Record<string, string> = { ...BUILTIN_LOGOS }
      for (const [k, v] of Object.entries(api)) {
        const key = k.trim().toLowerCase()
        if (!key || typeof v !== 'string' || !v.trim()) continue
        if (merged[key]) continue
        merged[key] = v.trim()
      }
      return merged
    } catch {
      return { ...BUILTIN_LOGOS }
    } finally {
      inflight.delete(query)
    }
  })()

  inflight.set(query, p)
  const urls = await p
  cache.set(query, urls)
  return urls
}

/** Stable key for hook deps when callers pass fresh array literals (e.g. `[symbol]`). */
function stableExtraKey(extraSymbols: readonly string[] | undefined): string {
  if (!extraSymbols?.length) return ''
  const parts: string[] = []
  for (const raw of extraSymbols) {
    const n = normalizeCryptoLogoSymbol(raw)
    if (n) parts.push(n)
  }
  return [...new Set(parts)].sort().join(',')
}

export function useCryptoLogoUrlMap(extraSymbols?: readonly string[]): Record<string, string> {
  const key = stableExtraKey(extraSymbols)
  const [urls, setUrls] = useState<Record<string, string>>(BUILTIN_LOGOS)
  useEffect(() => {
    const extras = key ? key.split(',') : undefined
    void getCryptoLogoUrlMap(extras).then(setUrls)
  }, [key])
  return urls
}
