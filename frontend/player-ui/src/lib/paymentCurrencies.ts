import { depositNetworkTitle, parseDepositNetworkParam } from '../components/DepositFlowShared'

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

export function formatMinorHint(sym: string, minor: number | undefined): string | null {
  if (minor == null || !Number.isFinite(minor)) return null
  const u = sym.toUpperCase()
  if (u === 'USDT' || u === 'USDC' || u === 'USD') {
    return `$${(minor / 100).toFixed(2)}`
  }
  return `${(minor / 100).toFixed(2)} ${sym}`
}

export function currencyOptionLabel(c: PassimpayCurrency): string {
  if (c.label?.trim()) return c.label.trim()
  const net = c.network?.trim()
  return net ? `${c.symbol} · ${net}` : c.symbol
}

/** Human-readable chain label for warnings (handles numeric chain ids). */
export function passimpayNetworkLabel(netRaw: string): string {
  const u = netRaw.trim()
  if (!u) return '—'
  if (/^\d+$/.test(u)) return `Chain ${u}`
  return depositNetworkTitle(parseDepositNetworkParam(u))
}
