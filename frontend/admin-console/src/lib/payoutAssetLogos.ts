/**
 * Static CDN logos for payout-asset picker (token + chain). No API keys.
 * Merged with Logo.dev URLs from GET /v1/market/crypto-logo-urls when available.
 */

const TOKEN_LOGOS: Record<string, string> = {
  usdt: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  usdc: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  eth: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  bnb: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  trx: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  btc: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  sol: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  matic: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  pol: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  avax: 'https://assets.coingecko.com/coins/images/12559/small/coin-round-red.png',
}

/** By numeric chain_id (string) or network suffix from SYMBOL_NETWORK asset keys. */
const CHAIN_LOGOS: Record<string, string> = {
  '1': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  '5': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  '11155111': 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  '56': 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  '97': 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  '137': 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  '8453': 'https://assets.coingecko.com/coins/images/27726/small/Base_Icon.png',
  '42161': 'https://assets.coingecko.com/asset_platforms/images/33/small/ARB.png',
  '10': 'https://assets.coingecko.com/asset_platforms/images/41/small/optimism.png',
  '43114': 'https://assets.coingecko.com/coins/images/12559/small/coin-round-red.png',
  // text network suffixes from SYMBOL_NETWORK-style payout asset keys (e.g. USDC_ERC20)
  ERC20: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  BEP20: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  TRC20: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
}

export function builtinTokenLogoUrl(symbol: string): string {
  return TOKEN_LOGOS[symbol.trim().toLowerCase()] ?? ''
}

export function builtinChainLogoUrl(network: string): string {
  const n = network.trim()
  if (!n) return ''
  if (/^\d+$/.test(n)) return CHAIN_LOGOS[n] ?? ''
  return CHAIN_LOGOS[n.toUpperCase()] ?? ''
}
