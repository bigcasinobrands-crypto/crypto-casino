import { playerApiUrl } from './playerApiUrl'

/** Warm GET /v1/market/crypto-tickers once after idle so the home crypto strip populates faster. */
export function prefetchCryptoTickersOnce(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __ccPrefetchTickers?: boolean }
  if (w.__ccPrefetchTickers) return
  w.__ccPrefetchTickers = true

  const path = '/v1/market/crypto-tickers'
  const run = () => {
    void fetch(playerApiUrl(path), { credentials: 'omit' }).catch(() => undefined)
  }

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 2500 })
    return
  }
  window.setTimeout(run, 0)
}
