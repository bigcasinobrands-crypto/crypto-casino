import { useCallback, useEffect, useState } from 'react'
import { readApiError } from '../api/errors'
import type { PaymentCurrenciesResponse } from '../lib/paymentCurrencies'
import { usePlayerAuth } from '../playerAuth'

export function usePassimpayCurrencies(enabled = true) {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [data, setData] = useState<PaymentCurrenciesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    if (!isAuthenticated) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/v1/wallet/payment-currencies')
      if (!res.ok) {
        const parsed = await readApiError(res)
        let msg =
          parsed?.message?.trim() ||
          (res.status ? `Could not load currencies (HTTP ${res.status}).` : 'Could not load PassimPay currencies.')
        if (res.status === 404) {
          msg =
            'This API build does not expose payment currencies yet. Deploy the latest core API or use dev proxy to localhost.'
        } else if (res.status === 401) {
          msg = 'Sign in again to load deposit currencies.'
        } else if (res.status === 429) {
          msg = 'Too many requests — wait a moment and try again.'
        }
        setError(msg)
        setData(null)
        return
      }
      const j = (await res.json()) as PaymentCurrenciesResponse
      setData({
        provider: typeof j.provider === 'string' ? j.provider : 'unknown',
        currencies: Array.isArray(j.currencies) ? j.currencies : [],
      })
    } catch (e) {
      const directOrigin = Boolean((import.meta.env.VITE_PLAYER_API_ORIGIN as string | undefined)?.trim())
      let msg = 'Could not reach the API for currencies.'
      if (import.meta.env.DEV && directOrigin) {
        msg +=
          ' Remove VITE_PLAYER_API_ORIGIN and use DEV_API_PROXY=https://your-api in .env.development so Vite proxies /v1 (fixes CORS from localhost).'
      } else if (import.meta.env.DEV) {
        msg += ' Check DEV_API_PROXY or run core locally on the port Vite proxies to.'
      } else {
        msg += ' Set VITE_PLAYER_API_ORIGIN on the player host and PLAYER_CORS_ORIGINS on the API.'
      }
      setError(msg)
      setData(null)
      if (import.meta.env.DEV) console.warn('[payment-currencies]', e)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, enabled, isAuthenticated])

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    provider: data?.provider ?? 'none',
    currencies: data?.currencies ?? [],
    loading,
    error,
    reload,
  }
}
