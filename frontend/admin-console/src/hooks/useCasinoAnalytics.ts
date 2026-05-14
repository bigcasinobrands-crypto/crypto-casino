import { useMemo } from 'react'
import { useAdminAuth } from '../authContext'
import { useEffect, useState, useCallback } from 'react'
import { useMetricsDisplaySuppress } from '../context/MetricsDisplaySuppressContext'

type FetchState<T> = {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

type FetchOpts<T> = {
  skip?: boolean
  staticData?: T | null
}

function useApiFetch<T>(path: string, opts?: FetchOpts<T>): FetchState<T> {
  const { apiFetch } = useAdminAuth()
  const skip = opts?.skip === true
  const staticData = opts?.staticData ?? null
  const [data, setData] = useState<T | null>(() => (skip && staticData != null ? staticData : null))
  const [loading, setLoading] = useState(!skip)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (skip) {
      setData(staticData ?? null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setData(null)
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
  }, [apiFetch, path, skip, staticData])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

export type DashboardNGRBreakdown = {
  ggr: number
  total_wagered_minor?: number
  gross_stake_debit_turnover_minor?: number
  bonus_cost: number
  cashback_paid: number
  rakeback_paid: number
  vip_rewards_paid: number
  affiliate_commission: number
  jackpot_costs: number
  payment_provider_fees: number
  manual_adjustments: number
  ngr_total: number
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
    /** Distinct users with game.debit or sportsbook.debit in the same window as ggr_minor / ngr_total. */
    active_wagering_users?: number
    /** ngr_total / active_wagering_users (minor units; same formula as headline NGR). */
    ngr_per_wagering_user?: number
    /** Ledger-backed NGR for the selected window (GGR minus settled cost buckets). */
    ngr_total?: number
    analytics_schema_version?: number
    /** Same as ggr_minor; explicit alias for finance dashboards. */
    ggr_total?: number
    settled_wager_total?: number
    /** "ngr" (default) or "ggr" when CASINO_ANALYTICS_ARPU_USE_GGR is set on the API. */
    arpu_metric?: string
    ngr_previous_period?: number
    ngr_breakdown?: DashboardNGRBreakdown
    bonus_cost_minor: number
    /** Cash rewards (rakeback + cashback + VIP/hunt/challenge cash) from ledger; aligns with NGR cost splits. */
    reward_expense_minor?: number
    /** Same basis as GGR stake side: debits/bets net of rollbacks (not raw debit turnover). */
    total_wagered_minor?: number
    /** Raw SUM(ABS) on stake debit lines only; diagnostic. */
    gross_stake_debit_turnover_minor?: number
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

function emptyNGRBreakdown(): DashboardNGRBreakdown {
  return {
    ggr: 0,
    total_wagered_minor: 0,
    gross_stake_debit_turnover_minor: 0,
    bonus_cost: 0,
    cashback_paid: 0,
    rakeback_paid: 0,
    vip_rewards_paid: 0,
    affiliate_commission: 0,
    jackpot_costs: 0,
    payment_provider_fees: 0,
    manual_adjustments: 0,
    ngr_total: 0,
  }
}

function emptyCasinoAnalytics(): CasinoAnalyticsResponse {
  return {
    kpis: {
      registrations: 0,
      checkout_attempts: 0,
      settled_deposits: 0,
      ftd_count: 0,
      reg_to_ftd_conversion_rate: 0,
      checkout_to_ftd_rate: 0,
      avg_first_deposit_minor: 0,
      median_time_to_ftd_hours: 0,
      repeat_deposit_d7_rate: 0,
      repeat_deposit_d30_rate: 0,
      ggr_minor: 0,
      ggr_total: 0,
      ngr_total: 0,
      active_wagering_users: 0,
      ngr_per_wagering_user: 0,
      arpu_metric: 'ngr',
      bonus_cost_minor: 0,
      reward_expense_minor: 0,
      total_wagered_minor: 0,
      settled_wager_total: 0,
      gross_stake_debit_turnover_minor: 0,
      ngr_breakdown: emptyNGRBreakdown(),
    },
    timeseries: [],
  }
}

function emptyCryptoSummary(): CryptoChainSummaryResponse {
  return {
    summary: { gross_inflow_minor: 0, gross_outflow_minor: 0, net_flow_minor: 0 },
    items: [],
  }
}

export function useCasinoAnalytics(period: string, customStart?: string, customEnd?: string) {
  const { effectiveSuppressed } = useMetricsDisplaySuppress()
  const query = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return `start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}`
    }
    return `period=${encodeURIComponent(period)}`
  }, [period, customStart, customEnd])
  const path = `/v1/admin/dashboard/casino-analytics?${query}`
  const staticData = useMemo(() => (effectiveSuppressed ? emptyCasinoAnalytics() : null), [effectiveSuppressed])
  return useApiFetch<CasinoAnalyticsResponse>(path, {
    skip: effectiveSuppressed,
    staticData,
  })
}

export function useCryptoChainSummary(period: string, customStart?: string, customEnd?: string) {
  const { effectiveSuppressed } = useMetricsDisplaySuppress()
  const query = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return `start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}`
    }
    return `period=${encodeURIComponent(period)}`
  }, [period, customStart, customEnd])
  const path = `/v1/admin/dashboard/crypto-chain-summary?${query}`
  const staticData = useMemo(() => (effectiveSuppressed ? emptyCryptoSummary() : null), [effectiveSuppressed])
  return useApiFetch<CryptoChainSummaryResponse>(path, {
    skip: effectiveSuppressed,
    staticData,
  })
}

