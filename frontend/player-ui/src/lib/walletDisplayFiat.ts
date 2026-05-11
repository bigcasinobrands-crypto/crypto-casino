/** Player-chosen fiat display for wallet header (ledger stays in API `currency`). */
export const WALLET_DISPLAY_FIAT_OPTIONS = ['EUR', 'USD', 'GBP'] as const
export type WalletDisplayFiat = (typeof WALLET_DISPLAY_FIAT_OPTIONS)[number]

export const WALLET_DISPLAY_FIAT_STORAGE_KEY = 'player_wallet_display_fiat_v1'

export function readStoredDisplayFiat(): WalletDisplayFiat {
  try {
    const raw = localStorage.getItem(WALLET_DISPLAY_FIAT_STORAGE_KEY)?.trim().toUpperCase()
    if (raw === 'EUR' || raw === 'USD' || raw === 'GBP') return raw
  } catch {
    /* ignore */
  }
  return 'EUR'
}

export function writeStoredDisplayFiat(ccy: WalletDisplayFiat): void {
  try {
    localStorage.setItem(WALLET_DISPLAY_FIAT_STORAGE_KEY, ccy)
  } catch {
    /* ignore */
  }
}

/**
 * Frankfurter only lists ISO fiat. Stablecoin-settled ledgers are pegged to USD for display FX.
 */
export function frankfurterQuoteBase(settlementCurrency: string): 'EUR' | 'USD' | 'GBP' {
  const u = settlementCurrency.trim().toUpperCase()
  if (u === 'USDT' || u === 'USDC' || u === 'USD') return 'USD'
  if (u === 'GBP') return 'GBP'
  if (u === 'EUR') return 'EUR'
  return 'EUR'
}

type RateCacheEntry = { rates: Record<string, number>; fetchedAt: number }

const rateCache = new Map<string, RateCacheEntry>()
const RATE_TTL_MS = 3_600_000

/**
 * Returns cached FX row if still fresh — lets the wallet header reuse rates immediately after reload.
 */
export function peekFrankfurterRatesFromCache(
  quoteBase: 'EUR' | 'USD' | 'GBP',
  targets: readonly WalletDisplayFiat[],
): Record<string, number> | null {
  const uniq = [...new Set(targets)]
  const cacheKey = `${quoteBase}::${uniq.sort().join(',')}`
  const hit = rateCache.get(cacheKey)
  const now = Date.now()
  if (hit && now - hit.fetchedAt < RATE_TTL_MS) {
    return hit.rates
  }
  return null
}

/**
 * Fetches cross-rates from Frankfurter (ECB). Returns multipliers: major units of `quoteBase` → target fiat.
 * Keys include each requested `to` code.
 */
export async function fetchFrankfurterRates(
  quoteBase: 'EUR' | 'USD' | 'GBP',
  targets: WalletDisplayFiat[],
): Promise<Record<string, number>> {
  const uniq = [...new Set(targets)]
  const cacheKey = `${quoteBase}::${uniq.sort().join(',')}`
  const now = Date.now()
  const hit = rateCache.get(cacheKey)
  if (hit && now - hit.fetchedAt < RATE_TTL_MS) {
    return hit.rates
  }

  /** Frankfurter rejects `to` that includes the same code as `from`. */
  const others = uniq.filter((t) => t !== quoteBase)
  const withIdentityBase = (): Record<string, number> => ({ [quoteBase]: 1 })

  if (others.length === 0) {
    const only = withIdentityBase()
    rateCache.set(cacheKey, { rates: only, fetchedAt: now })
    return only
  }

  const toParam = others.join(',')
  const origins = ['https://api.frankfurter.app', 'https://api.frankfurter.dev']
  let lastErr: unknown
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin}/latest?from=${quoteBase}&to=${toParam}`)
      if (!res.ok) throw new Error(`fx ${res.status}`)
      const body = (await res.json()) as { rates?: Record<string, number> }
      const rates = body.rates ?? {}
      const withIdentity: Record<string, number> = { ...rates, ...withIdentityBase() }
      rateCache.set(cacheKey, { rates: withIdentity, fetchedAt: now })
      return withIdentity
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('fx fetch failed')
}

/** Convert ledger minor units (1/100 of settlement major) to major units in `displayFiat`. */
export function convertLedgerMinorToDisplayMajor(params: {
  minor: number | null | undefined
  settlementCurrency: string
  displayFiat: WalletDisplayFiat
  rateToDisplay: Record<string, number> | null
}): number {
  const minor = params.minor == null || !Number.isFinite(params.minor) ? 0 : params.minor
  const majorSettlement = minor / 100
  const quoteBase = frankfurterQuoteBase(params.settlementCurrency)
  if (params.displayFiat === quoteBase) {
    return majorSettlement
  }
  if (!params.rateToDisplay) return majorSettlement
  const mult = params.rateToDisplay[params.displayFiat]
  if (mult == null || !Number.isFinite(mult)) return majorSettlement
  return majorSettlement * mult
}

export function formatDisplayFiatMajor(major: number, displayFiat: WalletDisplayFiat, languageTag: string): string {
  try {
    return new Intl.NumberFormat(languageTag, {
      style: 'currency',
      currency: displayFiat,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major)
  } catch {
    const sym = displayFiat === 'EUR' ? '€' : displayFiat === 'GBP' ? '£' : '$'
    return `${sym}${major.toFixed(2)}`
  }
}
