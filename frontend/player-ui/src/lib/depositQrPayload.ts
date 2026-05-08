import { passimpayWalletChainSectionMeta } from './paymentCurrencies'

/** Deposit targets must be on-chain identifiers, not arbitrary web URLs. */
export function isLikelyWebHttpUrl(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  return /^https?:\/\//i.test(t)
}

/**
 * String to encode in the deposit QR (EIP-681 / BIP21 / ripple where applicable).
 * Returns `null` when `address` is empty or looks like an HTTP(S) URL (provider misconfiguration).
 */
export function buildDepositQrPayload(address: string, symbol: string, network: string, memo: string): string | null {
  const addr = address.trim()
  if (!addr || isLikelyWebHttpUrl(addr)) return null

  const sym = symbol.trim().toUpperCase()
  const memoTrim = memo.trim()
  const meta = passimpayWalletChainSectionMeta(network)
  const gid = meta.groupId

  if (sym === 'BTC') {
    return `bitcoin:${addr}`
  }

  if (sym === 'XRP' || network.toUpperCase().includes('XRP')) {
    if (memoTrim) {
      return `ripple:${addr}?dt=${encodeURIComponent(memoTrim)}`
    }
    return `ripple:${addr}`
  }

  const evmGroups = new Set(['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche'])
  if (evmGroups.has(gid) || gid.startsWith('chain-')) {
    if (/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return `ethereum:${addr}`
    }
    return addr
  }

  if (gid === 'tron') {
    return addr
  }

  if (gid === 'solana') {
    return `solana:${addr}`
  }

  if (gid === 'ton') {
    return addr
  }

  return addr
}
