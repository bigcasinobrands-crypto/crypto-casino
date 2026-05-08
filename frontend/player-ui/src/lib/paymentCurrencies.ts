import i18n from '../i18n'
import { parseDepositNetworkParam } from '../components/DepositFlowShared'

/** Rows from GET /v1/wallet/payment-currencies (PassimPay operational mirror). */
export type PassimpayCurrency = {
  payment_id: number
  symbol: string
  network: string
  decimals: number
  deposit_enabled: boolean
  withdraw_enabled: boolean
  requires_tag: boolean
  label?: string
  min_deposit_minor?: number
  min_withdraw_minor?: number
}

export type PaymentCurrenciesResponse = {
  provider: string
  currencies: PassimpayCurrency[]
}

/** Minor amounts shown with a leading $ (USD account lines & USD-pegged stables). */
export function isUsdDollarPrefixedSymbol(sym: string): boolean {
  const u = sym.toUpperCase()
  return u === 'USDT' || u === 'USDC' || u === 'USD' || u === 'DAI' || u === 'BUSD' || u === 'PYUSD'
}

/** USD / fiat-stable style amounts — always 2 decimal places in the UI. */
function isFiatStableStyleSymbol(sym: string): boolean {
  const u = sym.toUpperCase()
  return (
    u === 'USDT' ||
    u === 'USDC' ||
    u === 'USD' ||
    u === 'DAI' ||
    u === 'BUSD' ||
    u === 'EUR' ||
    u === 'GBP' ||
    u === 'PYUSD'
  )
}

/** Human-readable crypto quantity: up to 4 fractional digits, trailing zeros trimmed. */
export function formatCryptoQuantityUpToFourDecimals(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const s = n.toFixed(4)
  const trimmed = s.replace(/\.?0+$/, '')
  return trimmed === '' ? '0' : trimmed
}

/**
 * Format PassimPay minor-unit hints (mins, etc.).
 * - USD-pegged stables: 2 decimals with $.
 * - Other crypto: uses `tokenDecimals` when provided (else assumes 2, i.e. ÷100) and up to 4 display decimals.
 */
export function formatMinorHint(
  sym: string,
  minor: number | undefined,
  tokenDecimals?: number,
): string | null {
  if (minor == null || !Number.isFinite(minor)) return null
  const exp =
    tokenDecimals != null && Number.isFinite(tokenDecimals) && tokenDecimals >= 0 && tokenDecimals <= 36
      ? Math.min(36, Math.floor(tokenDecimals))
      : 2
  const divisor = 10 ** exp
  const v = minor / divisor

  if (isFiatStableStyleSymbol(sym)) {
    if (isUsdDollarPrefixedSymbol(sym)) return `$${v.toFixed(2)}`
    return `${v.toFixed(2)} ${sym}`
  }
  return `${formatCryptoQuantityUpToFourDecimals(v)} ${sym}`
}

/**
 * Whether a withdraw-enabled rail should appear in the payout picker for the player's
 * USD-cent balance. When `balanceMinor` is null the profile is still loading — treat
 * every rail as eligible so the UI can settle once balance arrives.
 */
export function passimpayWithdrawRailMeetsBalance(c: PassimpayCurrency, balanceMinor: number | null): boolean {
  if (!c.withdraw_enabled) return false
  if (balanceMinor === null) return true
  if (balanceMinor < 1) return false
  const minW = c.min_withdraw_minor
  if (minW != null && Number.isFinite(minW) && balanceMinor < minW) return false
  return true
}

export function currencyOptionLabel(c: PassimpayCurrency): string {
  if (c.label?.trim()) return c.label.trim()
  const net = c.network?.trim()
  return net ? `${c.symbol} · ${net}` : c.symbol
}

/** Short token name for rows under a chain section (heading already shows the network). */
export function currencyTokenLabelForGroupRow(c: PassimpayCurrency): string {
  const custom = c.label?.trim()
  if (custom) {
    const m = custom.match(/^(.+?)\s*[-–·]\s*.+$/)
    if (m) return m[1]!.trim()
    return custom
  }
  return c.symbol.trim()
}

type ChainSectionMeta = { groupId: string; sortKey: number; heading: string }

const NUM_CHAIN: Record<string, Pick<ChainSectionMeta, 'groupId' | 'sortKey'> & { titleKey: string }> = {
  '1': { groupId: 'ethereum', sortKey: 10, titleKey: 'ERC20' },
  '5': { groupId: 'ethereum', sortKey: 10, titleKey: 'ERC20' },
  '10': { groupId: 'optimism', sortKey: 80, titleKey: 'OPTIMISM' },
  '56': { groupId: 'bsc', sortKey: 20, titleKey: 'BEP20' },
  '97': { groupId: 'bsc', sortKey: 20, titleKey: 'BEP20' },
  '137': { groupId: 'polygon', sortKey: 60, titleKey: 'POLYGON' },
  '42161': { groupId: 'arbitrum', sortKey: 70, titleKey: 'ARBITRUM' },
  '8453': { groupId: 'base', sortKey: 85, titleKey: 'BASE' },
  '43114': { groupId: 'avalanche', sortKey: 90, titleKey: 'AVALANCHE' },
}

function tNet(key: string): string {
  return i18n.t(`wallet.net.${key}`)
}

/**
 * Canonical chain bucket for wallet UI (group headings, sort order).
 * Merges aliases (ETH/ERC20 → Ethereum section).
 */
export function passimpayWalletChainSectionMeta(netRaw: string): ChainSectionMeta {
  const u = netRaw.trim()
  const x = u.toUpperCase()
  if (!u) return { groupId: 'other', sortKey: 9999, heading: 'Other' }

  if (/^\d+$/.test(u)) {
    const known = NUM_CHAIN[u]
    if (known) {
      return { groupId: known.groupId, sortKey: known.sortKey, heading: tNet(known.titleKey) }
    }
    return { groupId: `chain-${u}`, sortKey: 650, heading: `Chain ${u}` }
  }

  if (x === 'SOL' || x === 'SOLANA' || x.includes('SOLANA')) {
    return { groupId: 'solana', sortKey: 40, heading: tNet('SOL') }
  }
  if (x === 'TON' || x.includes('TON')) {
    return { groupId: 'ton', sortKey: 50, heading: tNet('TON') }
  }
  if (x === 'DASH' || (x.includes('DASH') && !x.includes('DASHBOARD'))) {
    return { groupId: 'dash', sortKey: 95, heading: tNet('DASH') }
  }
  if (x === 'POLYGON' || x === 'MATIC' || x.includes('POLYGON')) {
    return { groupId: 'polygon', sortKey: 60, heading: tNet('POLYGON') }
  }
  if (x.includes('ARBITRUM')) {
    return { groupId: 'arbitrum', sortKey: 70, heading: tNet('ARBITRUM') }
  }
  if (x.includes('OPTIMISM')) {
    return { groupId: 'optimism', sortKey: 80, heading: tNet('OPTIMISM') }
  }
  if (x.includes('BASE')) {
    return { groupId: 'base', sortKey: 85, heading: tNet('BASE') }
  }
  if (x === 'AVAX' || x.includes('AVALANCHE') || x === 'AVAXC' || x.includes('C-CHAIN')) {
    return { groupId: 'avalanche', sortKey: 90, heading: tNet('AVALANCHE') }
  }

  if (x === 'BEP20' || x === 'BSC' || x === 'BNB' || x.includes('BEP')) {
    return { groupId: 'bsc', sortKey: 20, heading: tNet('BEP20') }
  }
  if (x === 'TRC20' || x === 'TRON' || x === 'TRX') {
    return { groupId: 'tron', sortKey: 30, heading: tNet('TRC20') }
  }
  if (x === 'ERC20' || x === 'ETH' || x === 'ETHEREUM' || x.includes('ERC')) {
    return { groupId: 'ethereum', sortKey: 10, heading: tNet('ERC20') }
  }

  const legacy = parseDepositNetworkParam(u)
  return {
    groupId: legacy === 'BEP20' ? 'bsc' : legacy === 'TRC20' ? 'tron' : 'ethereum',
    sortKey: legacy === 'BEP20' ? 20 : legacy === 'TRC20' ? 30 : 10,
    heading: tNet(legacy),
  }
}

export type PassimpayCurrencyNetworkGroup = {
  groupId: string
  heading: string
  sortKey: number
  currencies: PassimpayCurrency[]
}

export function groupPassimpayCurrenciesByNetwork(list: PassimpayCurrency[]): PassimpayCurrencyNetworkGroup[] {
  const bucket = new Map<string, PassimpayCurrencyNetworkGroup>()
  for (const c of list) {
    const meta = passimpayWalletChainSectionMeta(c.network)
    let g = bucket.get(meta.groupId)
    if (!g) {
      g = { groupId: meta.groupId, heading: meta.heading, sortKey: meta.sortKey, currencies: [] }
      bucket.set(meta.groupId, g)
    }
    g.currencies.push(c)
  }
  return Array.from(bucket.values())
    .sort((a, b) =>
      a.sortKey !== b.sortKey ? a.sortKey - b.sortKey : a.heading.localeCompare(b.heading, undefined, { sensitivity: 'base' }),
    )
    .map((g) => ({
      ...g,
      currencies: [...g.currencies].sort((a, b) =>
        currencyTokenLabelForGroupRow(a).localeCompare(currencyTokenLabelForGroupRow(b), undefined, { sensitivity: 'base' }),
      ),
    }))
}

/** Human-readable chain label for warnings (handles numeric chain ids). */
export function passimpayNetworkLabel(netRaw: string): string {
  return passimpayWalletChainSectionMeta(netRaw).heading
}
