import { useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'
import type { FinanceGeoPayload } from '../lib/financeGeo'

export type FinanceGeoPeriod = '7d' | '30d' | '90d' | '6m' | 'ytd' | 'all' | 'custom'

export function useFinanceGeo(period: FinanceGeoPeriod = '30d', customStart?: string, customEnd?: string) {
  const { apiFetch } = useAdminAuth()
  const [data, setData] = useState<FinanceGeoPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams()
      if (period === 'custom' && customStart && customEnd) {
        q.set('start', customStart)
        q.set('end', customEnd)
      } else {
        q.set('period', period)
      }
      const res = await apiFetch(`/v1/admin/analytics/finance-geo?${q}`)
      if (!res.ok) {
        setData(null)
        setError(`HTTP ${res.status}`)
        return
      }
      setData((await res.json()) as FinanceGeoPayload)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'request failed')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, period, customStart, customEnd])

  useEffect(() => {
    void load()
  }, [load])

  return { data, loading, error, refetch: load }
}
