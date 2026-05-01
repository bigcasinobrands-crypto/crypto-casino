export type DepositAsset = {
  key: string
  symbol: string
  network: string
  label: string
}

/** Default rails — matches core `defaultCheckoutAssetTokens` when API is empty or unreachable. */
export const FALLBACK_PAYOUT_ASSETS: DepositAsset[] = [
  { key: 'USDC_1', symbol: 'USDC', network: '1', label: 'USDC · Ethereum' },
  { key: 'ETH_1', symbol: 'ETH', network: '1', label: 'ETH · Ethereum' },
  { key: 'ETH_8453', symbol: 'ETH', network: '8453', label: 'ETH · Base' },
]

export function parsePayoutOptionsPayload(body: unknown): DepositAsset[] {
  if (!body || typeof body !== 'object' || !('assets' in body)) return []
  const raw = (body as { assets: unknown }).assets
  if (raw == null) return []
  if (!Array.isArray(raw)) return []
  const out: DepositAsset[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const key = typeof o.key === 'string' ? o.key.trim() : ''
    if (!key) continue
    const symbol = typeof o.symbol === 'string' ? o.symbol.trim() : ''
    const network = typeof o.network === 'string' ? o.network.trim() : ''
    const labelRaw = typeof o.label === 'string' ? o.label.trim() : ''
    const label = labelRaw || key
    out.push({
      key,
      symbol: symbol || key.split('_')[0] || key,
      network,
      label,
    })
  }
  return out
}
