/** Pigmo-hosted assets on Cloudflare Images (same account as game art / provider logos). */

export const PIGMO_CF_IMAGES_BASE = 'https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA'

/** `path` is the variant id segment, e.g. `assets/Metamask.svg`. */
export function pigmoCfPublicUrl(path: string): string {
  const p = path.replace(/^\/+/, '')
  return `${PIGMO_CF_IMAGES_BASE}/${p}/public`
}

/** Login / wallet brand row on pigmo lobby (observed in network). */
export const PIGMO_BRAND_ICONS = {
  metamask: pigmoCfPublicUrl('assets/Metamask.svg'),
  google: pigmoCfPublicUrl('assets/Google.svg'),
  solana: pigmoCfPublicUrl('assets/Solana.svg'),
} as const

export type PigmoFuturesSymbol = 'btc' | 'eth' | 'sol' | 'doge' | 'bonk' | 'wif' | 'shib' | 'pepe'

/** Futures strip icons (pigmo `futures-icons/*.svg` transforms). */
export function pigmoFuturesIconUrl(symbol: PigmoFuturesSymbol, px = 28): string {
  return `${PIGMO_CF_IMAGES_BASE}/futures-icons/${symbol}.svg/width=${px},height=${px},quality=95,fit=cover`
}
