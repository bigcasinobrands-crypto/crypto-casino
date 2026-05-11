import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type WalletDisplayFiat,
  WALLET_DISPLAY_FIAT_OPTIONS,
  convertLedgerMinorToDisplayMajor,
  fetchFrankfurterRates,
  formatDisplayFiatMajor,
  frankfurterQuoteBase,
  peekFrankfurterRatesFromCache,
  readStoredDisplayFiat,
  writeStoredDisplayFiat,
} from '../lib/walletDisplayFiat'

type FxState = 'loading' | 'ok' | 'error'

/**
 * Maps ledger amounts (API `currency` minor units) to a player-chosen fiat display using ECB-based rates.
 */
export function useWalletDisplayFiat(settlementCurrency: string | null | undefined) {
  const settlement = (settlementCurrency || 'EUR').trim().toUpperCase() || 'EUR'
  const quoteBase = useMemo(() => frankfurterQuoteBase(settlement), [settlement])

  const [displayFiat, setDisplayFiatState] = useState<WalletDisplayFiat>(() =>
    typeof window !== 'undefined' ? readStoredDisplayFiat() : 'EUR',
  )

  const setDisplayFiat = useCallback((c: WalletDisplayFiat) => {
    setDisplayFiatState(c)
    writeStoredDisplayFiat(c)
  }, [])

  const [rates, setRates] = useState<Record<string, number> | null>(null)
  const [fxState, setFxState] = useState<FxState>('loading')

  useEffect(() => {
    let cancelled = false
    const cached = peekFrankfurterRatesFromCache(quoteBase, WALLET_DISPLAY_FIAT_OPTIONS)
    if (cached) {
      setRates(cached)
      setFxState('ok')
    } else {
      setFxState('loading')
      setRates(null)
    }
    void (async () => {
      try {
        const r = await fetchFrankfurterRates(quoteBase, [...WALLET_DISPLAY_FIAT_OPTIONS])
        if (cancelled) return
        setRates(r)
        setFxState('ok')
      } catch {
        if (cancelled) return
        setRates(cached)
        setFxState(cached ? 'ok' : 'error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quoteBase])

  /**
   * Always format with the player's chosen `displayFiat` so $ / £ / € matches the selector.
   * Conversion blends Frankfurter (ECB) rates with static fallbacks so tabs never show the same
   * figure with only the symbol changed when FX is slow or blocked.
   */
  const formatMinor = useCallback(
    (minor: number | null | undefined, languageTag: string): string => {
      const major = convertLedgerMinorToDisplayMajor({
        minor,
        settlementCurrency: settlement,
        displayFiat,
        rateToDisplay: rates,
      })
      return formatDisplayFiatMajor(major, displayFiat, languageTag)
    },
    [displayFiat, rates, settlement],
  )

  return {
    displayFiat,
    setDisplayFiat,
    displayOptions: WALLET_DISPLAY_FIAT_OPTIONS,
    formatMinor,
    fxState,
    quoteBase,
  }
}
