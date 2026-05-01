import { useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'
import { isDashboardDummyMode } from '../lib/dashboardDummy'
import type { TrafficAnalyticsPayload } from '../lib/trafficAnalytics'
import { dummyTrafficAnalyticsPayload } from '../lib/trafficAnalyticsDummy'

export type TrafficPeriod = '7d' | '30d' | '90d' | '6m' | 'ytd' | 'all' | 'custom'

export function useTrafficAnalytics(period: TrafficPeriod = '30d', customStart?: string, customEnd?: string) {
  const { apiFetch } = useAdminAuth()
  const [data, setData] = useState<TrafficAnalyticsPayload | null>(null)
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
      let res = await apiFetch(`/v1/admin/analytics/traffic?${q}`)
      let live404 = false
      // Stale core binary or missing proxy: demo payload still renders the map/widgets.
      if (res.status === 404) {
        live404 = true
        res = await apiFetch(`/v1/admin/analytics/traffic?${q}&source=demo`)
      }
      if (!res.ok) {
        if (isDashboardDummyMode()) {
          setData(dummyTrafficAnalyticsPayload(period))
          setError(null)
          return
        }
        setData(null)
        if (res.status === 404) {
          setError(
            'HTTP 404 — /v1/admin/analytics/traffic was not found. Use `npm run dev` (proxy) or `vite preview` with API running, set DEV_API_PROXY / preview proxy to your core URL, or set VITE_ADMIN_API_ORIGIN to the API origin. Restart the core service after pulling analytics routes.',
          )
          return
        }
        setError(`HTTP ${res.status}`)
        return
      }
      const json = (await res.json()) as TrafficAnalyticsPayload
      if (live404) {
        const extra = 'Live traffic API returned 404; showing demo geo until the route is reachable.'
        json.notes = json.notes ? `${extra} ${json.notes}` : extra
      }
      setData(json)
    } catch (e) {
      if (isDashboardDummyMode()) {
        setData(dummyTrafficAnalyticsPayload(period))
        setError(null)
        return
      }
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
