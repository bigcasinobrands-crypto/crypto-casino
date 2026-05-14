import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminAuth } from '../authContext'
import {
  isDashboardDummyMode,
  buildDummyCharts,
  dummyKPIs,
  dummyTopGames,
  dummyPlayerStats,
  dummyBonusStats,
  dummyDashboardSystem,
} from '../lib/dashboardDummy'
import { useMetricsDisplaySuppress } from '../context/MetricsDisplaySuppressContext'

/** Stable placeholder path when skipping network (dummy dashboard mode). */
const DUMMY_FETCH_PATH = '__dashboard_dummy__'
/** Placeholder path when metrics display is suppressed (zeros; no network). */
const SUPPRESS_FETCH_PATH = '__dashboard_suppress__'

interface UseFetchOpts<T> {
  skip?: boolean
  staticData?: T | null
}

interface KPIs {
  ggr_24h: number
  ggr_7d: number
  ggr_30d: number
  ggr_all: number
  total_wagered_24h?: number
  total_wagered_7d?: number
  total_wagered_30d?: number
  total_wagered_all?: number
  deposits_24h: number
  deposits_7d: number
  deposits_30d: number
  deposits_count_24h: number
  deposits_count_7d: number
  deposits_count_30d: number
  withdrawals_24h: number
  withdrawals_7d: number
  withdrawals_30d: number
  withdrawals_count_24h: number
  withdrawals_count_7d: number
  withdrawals_count_30d: number
  net_cash_flow_30d: number
  active_players_24h: number
  active_players_7d: number
  active_players_30d: number
  new_registrations_24h: number
  new_registrations_7d: number
  new_registrations_30d: number
  bonus_cost_24h: number
  bonus_cost_7d: number
  bonus_cost_30d: number
  reward_expense_24h?: number
  reward_expense_7d?: number
  reward_expense_30d?: number
  ngr_24h?: number
  ngr_7d?: number
  ngr_30d: number
  arpu_24h?: number
  arpu_7d: number
  arpu_30d: number
  avg_deposit_size_30d: number
  deposit_conversion_rate: number
  pending_withdrawals_value: number
  pending_withdrawals_count: number
  /** Server-side map of how each KPI is derived (ledger vs operational). */
  metrics_derivation?: Record<string, string>
}

function emptyKPIs(): KPIs {
  return {
    ggr_24h: 0,
    ggr_7d: 0,
    ggr_30d: 0,
    ggr_all: 0,
    total_wagered_24h: 0,
    total_wagered_7d: 0,
    total_wagered_30d: 0,
    total_wagered_all: 0,
    deposits_24h: 0,
    deposits_7d: 0,
    deposits_30d: 0,
    deposits_count_24h: 0,
    deposits_count_7d: 0,
    deposits_count_30d: 0,
    withdrawals_24h: 0,
    withdrawals_7d: 0,
    withdrawals_30d: 0,
    withdrawals_count_24h: 0,
    withdrawals_count_7d: 0,
    withdrawals_count_30d: 0,
    net_cash_flow_30d: 0,
    active_players_24h: 0,
    active_players_7d: 0,
    active_players_30d: 0,
    new_registrations_24h: 0,
    new_registrations_7d: 0,
    new_registrations_30d: 0,
    bonus_cost_24h: 0,
    bonus_cost_7d: 0,
    bonus_cost_30d: 0,
    reward_expense_24h: 0,
    reward_expense_7d: 0,
    reward_expense_30d: 0,
    ngr_24h: 0,
    ngr_7d: 0,
    ngr_30d: 0,
    arpu_24h: 0,
    arpu_7d: 0,
    arpu_30d: 0,
    avg_deposit_size_30d: 0,
    deposit_conversion_rate: 0,
    pending_withdrawals_value: 0,
    pending_withdrawals_count: 0,
  }
}

interface DayPoint {
  date: string
  total_minor: number
  count: number
}

/** `registrations_by_day` uses counts only (no `total_minor`). */
interface RegistrationDayPoint {
  date: string
  count: number
}

interface GGRDayPoint {
  date: string
  bets_minor: number
  wins_minor: number
  ggr_minor: number
}

interface Charts {
  deposits_by_day: DayPoint[]
  withdrawals_by_day: DayPoint[]
  ggr_by_day: GGRDayPoint[]
  registrations_by_day: RegistrationDayPoint[]
  game_launches_by_day: DayPoint[]
  bonus_grants_by_day: DayPoint[]
}

interface TopGame {
  game_id: string
  title: string
  provider_key?: string
  launch_count?: number
  bets_minor?: number
  wins_minor?: number
  ggr_minor?: number
  rtp_pct?: number
}

interface TopGamesData {
  top_by_launches: TopGame[]
  top_by_ggr: TopGame[]
}

interface TopDepositor {
  id: string
  email: string
  /** Settled deposit total in minor units (API field). */
  total_minor: number
}

interface PlayerStats {
  total_registered: number
  total_with_deposit: number
  total_active_7d: number
  total_active_30d: number
  deposit_conversion_rate: number
  avg_ltv_minor: number
  top_depositors: TopDepositor[]
  registrations_trend: { date: string; count: number }[]
}

function emptyPlayerStats(): PlayerStats {
  return {
    total_registered: 0,
    total_with_deposit: 0,
    total_active_7d: 0,
    total_active_30d: 0,
    deposit_conversion_rate: 0,
    avg_ltv_minor: 0,
    top_depositors: [],
    registrations_trend: [],
  }
}

interface BonusStats {
  promotions_non_archived: number
  active_bonus_instances: number
  grants_last_24h: number
  risk_queue_pending: number
  total_bonus_cost_30d: number
  wr_completion_rate: number
  /** Combined rate of voluntary forfeits + TTL expirations (% of finalized instances). */
  forfeiture_rate: number
  /** TTL-expired only (subset of forfeiture_rate). */
  expiration_rate?: number
  total_forfeited?: number
  total_expired?: number
  avg_grant_amount_minor: number
  bonus_pct_of_ggr: number
}

function emptyCharts(): Charts {
  return {
    deposits_by_day: [],
    withdrawals_by_day: [],
    ggr_by_day: [],
    registrations_by_day: [],
    game_launches_by_day: [],
    bonus_grants_by_day: [],
  }
}

function emptyTopGames(): TopGamesData {
  return { top_by_launches: [], top_by_ggr: [] }
}

function emptyBonusStats(): BonusStats {
  return {
    promotions_non_archived: 0,
    active_bonus_instances: 0,
    grants_last_24h: 0,
    risk_queue_pending: 0,
    total_bonus_cost_30d: 0,
    wr_completion_rate: 0,
    forfeiture_rate: 0,
    expiration_rate: 0,
    total_forfeited: 0,
    total_expired: 0,
    avg_grant_amount_minor: 0,
    bonus_pct_of_ggr: 0,
  }
}

function useFetch<T>(path: string, pollMs?: number, opts?: UseFetchOpts<T>) {
  const { apiFetch } = useAdminAuth()
  const skip = opts?.skip === true
  const staticData = opts?.staticData

  const [data, setData] = useState<T | null>(() =>
    skip && staticData != null ? staticData : null,
  )
  const [loading, setLoading] = useState(!skip)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (skip) {
      setData(staticData ?? null)
      setError(null)
      setLoading(false)
      return
    }
    try {
      const res = await apiFetch(path)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [apiFetch, path, skip, staticData])

  useEffect(() => {
    if (skip) {
      setData(staticData ?? null)
      setLoading(false)
      setError(null)
      return
    }
    fetchData()
    if (pollMs && pollMs > 0) {
      const id = setInterval(fetchData, pollMs)
      return () => clearInterval(id)
    }
  }, [fetchData, pollMs, skip, staticData])

  return { data, loading, error, refetch: fetchData }
}

export function useDashboardKPIs() {
  const { effectiveSuppressed } = useMetricsDisplaySuppress()
  const dummy = isDashboardDummyMode()
  const skip = dummy || effectiveSuppressed
  const staticData = useMemo(() => {
    if (dummy) return dummyKPIs()
    if (effectiveSuppressed) return emptyKPIs()
    return null
  }, [dummy, effectiveSuppressed])
  const path = skip ? (dummy ? DUMMY_FETCH_PATH : SUPPRESS_FETCH_PATH) : '/v1/admin/dashboard/kpis'
  const pollMs = skip ? undefined : 30000
  return useFetch<KPIs>(path, pollMs, skip ? { skip: true, staticData } : undefined)
}

export function useDashboardCharts(period = '30d', customStart?: string, customEnd?: string) {
  const { effectiveSuppressed } = useMetricsDisplaySuppress()
  const dummy = isDashboardDummyMode()
  const skip = dummy || effectiveSuppressed
  const staticData = useMemo(() => {
    if (dummy) return buildDummyCharts(period)
    if (effectiveSuppressed) return emptyCharts()
    return null
  }, [dummy, effectiveSuppressed, period])
  const path = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return `/v1/admin/dashboard/charts?start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}`
    }
    return `/v1/admin/dashboard/charts?period=${encodeURIComponent(period)}`
  }, [period, customStart, customEnd])
  const fetchPath = skip ? (dummy ? DUMMY_FETCH_PATH : SUPPRESS_FETCH_PATH) : path
  return useFetch<Charts>(fetchPath, undefined, skip ? { skip: true, staticData } : undefined)
}

export function useTopGames(period = '30d', limit = 10, customStart?: string, customEnd?: string) {
  const { effectiveSuppressed } = useMetricsDisplaySuppress()
  const dummy = isDashboardDummyMode()
  const skip = dummy || effectiveSuppressed
  const staticData = useMemo(() => {
    if (dummy) return dummyTopGames()
    if (effectiveSuppressed) return emptyTopGames()
    return null
  }, [dummy, effectiveSuppressed])
  const path = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return `/v1/admin/dashboard/top-games?start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}&limit=${limit}`
    }
    return `/v1/admin/dashboard/top-games?period=${encodeURIComponent(period)}&limit=${limit}`
  }, [period, customStart, customEnd, limit])
  const fetchPath = skip ? (dummy ? DUMMY_FETCH_PATH : SUPPRESS_FETCH_PATH) : path
  return useFetch<TopGamesData>(fetchPath, undefined, skip ? { skip: true, staticData } : undefined)
}

export function usePlayerStats() {
  const { effectiveSuppressed } = useMetricsDisplaySuppress()
  const dummy = isDashboardDummyMode()
  const skip = dummy || effectiveSuppressed
  const staticData = useMemo(() => {
    if (dummy) return dummyPlayerStats()
    if (effectiveSuppressed) return emptyPlayerStats()
    return null
  }, [dummy, effectiveSuppressed])
  const path = skip ? (dummy ? DUMMY_FETCH_PATH : SUPPRESS_FETCH_PATH) : '/v1/admin/dashboard/player-stats'
  return useFetch<PlayerStats>(path, undefined, skip ? { skip: true, staticData } : undefined)
}

export function useBonusStats() {
  const { effectiveSuppressed } = useMetricsDisplaySuppress()
  const dummy = isDashboardDummyMode()
  const skip = dummy || effectiveSuppressed
  const staticData = useMemo(() => {
    if (dummy) return dummyBonusStats()
    if (effectiveSuppressed) return emptyBonusStats()
    return null
  }, [dummy, effectiveSuppressed])
  const path = skip ? (dummy ? DUMMY_FETCH_PATH : SUPPRESS_FETCH_PATH) : '/v1/admin/bonushub/dashboard/summary'
  const pollMs = skip ? undefined : 30000
  return useFetch<BonusStats>(path, pollMs, skip ? { skip: true, staticData } : undefined)
}

export interface DashboardSystem {
  webhook_deliveries_pending: number
  users_missing_payment_wallet: number
  withdrawals_in_flight: number
  worker_failed_jobs_unresolved: number
  /** Rows the worker will still try to deliver */
  bonus_outbox_pending_delivery?: number
  /** Rows past max attempts (see Compliance → Outbox DLQ) */
  bonus_outbox_dead_letter?: number
  redis_queue_depth?: number
  process_metrics?: Record<string, unknown>
}

export function useDashboardSystem(pollMs = 30000) {
  const dummy = isDashboardDummyMode()
  const staticData = useMemo(() => (dummy ? dummyDashboardSystem() : null), [dummy])
  return useFetch<DashboardSystem>(
    dummy ? DUMMY_FETCH_PATH : '/v1/admin/dashboard/system',
    dummy ? undefined : pollMs,
    dummy ? { skip: true, staticData } : undefined,
  )
}

export function useAuditLog(filters: Record<string, string> = {}) {
  const params = new URLSearchParams(filters).toString()
  return useFetch<{ entries: Record<string, unknown>[]; total_count: number }>(`/v1/admin/audit-log?${params}`)
}

export interface PendingWithdrawalRow {
  id: string
  user_id?: string
  email?: string
  amount_minor?: number
  currency?: string
  status?: string
  created_at?: string
}

export function usePendingWithdrawals() {
  return useFetch<{ pending: PendingWithdrawalRow[]; count: number }>('/v1/admin/withdrawals/pending-approval', 30000)
}

export type {
  KPIs,
  Charts,
  DayPoint,
  GGRDayPoint,
  TopGame,
  TopGamesData,
  TopDepositor,
  PlayerStats,
  BonusStats,
  RegistrationDayPoint,
}
