import { useMemo } from 'react'
import { useAdminAuth } from '../authContext'
import { useEffect, useState, useCallback } from 'react'

type FetchState<T> = {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

function useApiFetch<T>(path: string): FetchState<T> {
  const { apiFetch } = useAdminAuth()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(path)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as T)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, path])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

export type CasinoAnalyticsResponse = {
  kpis: {
    registrations: number
    checkout_attempts: number
    settled_deposits: number
    ftd_count: number
    reg_to_ftd_conversion_rate: number
    checkout_to_ftd_rate: number
    avg_first_deposit_minor: number
    median_time_to_ftd_hours: number
    repeat_deposit_d7_rate: number
    repeat_deposit_d30_rate: number
    ggr_minor: number
    ngr_proxy_minor: number
    bonus_cost_minor: number
  }
  timeseries: Array<{
    date: string
    registrations: number
    ftd_count: number
    ftd_conversion: number
  }>
}

export type CryptoChainSummaryResponse = {
  summary: {
    gross_inflow_minor: number
    gross_outflow_minor: number
    net_flow_minor: number
  }
  items: Array<{
    chain: string
    asset: string
    deposit_count: number
    deposit_users: number
    deposit_volume_minor: number
    withdrawal_count: number
    withdrawal_users: number
    withdrawal_volume_minor: number
    net_flow_minor: number
    success_rate: number
  }>
}

export function useCasinoAnalytics(period: string, customStart?: string, customEnd?: string) {
  const query = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return `start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}`
    }
    return `period=${encodeURIComponent(period)}`
  }, [period, customStart, customEnd])

  return useApiFetch<CasinoAnalyticsResponse>(`/v1/admin/dashboard/casino-analytics?${query}`)
}

export function useCryptoChainSummary(period: string, customStart?: string, customEnd?: string) {
  const query = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return `start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}`
    }
    return `period=${encodeURIComponent(period)}`
  }, [period, customStart, customEnd])

  return useApiFetch<CryptoChainSummaryResponse>(`/v1/admin/dashboard/crypto-chain-summary?${query}`)
}

