import { useEffect, useState } from 'react'
import { playerApiUrl } from './playerApiUrl'

/** Symbols we request for deposit + rail UI (Logo.dev /crypto/{symbol}). */
export const CRYPTO_LOGO_SYMBOLS = 'usdt,usdc,bnb,eth,trx,btc' as const

/**
 * Built-in logos from public CDNs so icons render even without Logo.dev configured.
 * Keyed by lowercase symbol matching CRYPTO_LOGO_SYMBOLS.
 */
const BUILTIN_LOGOS: Record<string, string> = {
  usdt: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  usdc: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  eth: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  bnb: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  trx: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  btc: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
}

type LogoUrlsResponse = {
  urls?: Record<string, string>
  configured?: boolean
}

let memoryCache: Record<string, string> | undefined
let inflight: Promise<Record<string, string>> | null = null

/**
 * Fetches Logo.dev CDN URLs from the API (publishable key never ships in the JS bundle).
 * Falls back to built-in CoinGecko URLs when Logo.dev is not configured.
 * Result is cached in memory for the SPA session.
 */
export async function getCryptoLogoUrlMap(): Promise<Record<string, string>> {
  if (memoryCache !== undefined) {
    return memoryCache
  }
  if (inflight) {
    const urls = await inflight
    memoryCache = urls
    return urls
  }
  inflight = (async () => {
    try {
      const u = playerApiUrl(`/v1/market/crypto-logo-urls?symbols=${encodeURIComponent(CRYPTO_LOGO_SYMBOLS)}`)
      const res = await fetch(u)
      if (!res.ok) {
        return { ...BUILTIN_LOGOS }
      }
      const j = (await res.json()) as LogoUrlsResponse
      const api = j.urls && typeof j.urls === 'object' ? j.urls : {}
      const hasApiUrls = Object.keys(api).length > 0
      return hasApiUrls ? { ...BUILTIN_LOGOS, ...api } : { ...BUILTIN_LOGOS }
    } catch {
      return { ...BUILTIN_LOGOS }
    } finally {
      inflight = null
    }
  })()
  const urls = await inflight
  memoryCache = urls
  return urls
}

export function useCryptoLogoUrlMap(): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>(BUILTIN_LOGOS)
  useEffect(() => {
    void getCryptoLogoUrlMap().then(setUrls)
  }, [])
  return urls
}
