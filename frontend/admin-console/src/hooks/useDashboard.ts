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

/** Stable placeholder path when skipping network (dummy dashboard mode). */
const DUMMY_FETCH_PATH = '__dashboard_dummy__'

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
  arpu_7d: number
  avg_deposit_size_30d: number
  deposit_conversion_rate: number
  pending_withdrawals_value: number
  pending_withdrawals_count: number
  /** Server-side map of how each KPI is derived (ledger vs operational). */
  metrics_derivation?: Record<string, string>
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

interface BonusStats {
  promotions_non_archived: number
  active_bonus_instances: number
  grants_last_24h: number
  risk_queue_pending: number
  total_bonus_cost_30d: number
  wr_completion_rate: number
  forfeiture_rate: number
  avg_grant_amount_minor: number
  bonus_pct_of_ggr: number
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
  const dummy = isDashboardDummyMode()
  const staticData = useMemo(() => (dummy ? dummyKPIs() : null), [dummy])
  return useFetch<KPIs>(
    dummy ? DUMMY_FETCH_PATH : '/v1/admin/dashboard/kpis',
    dummy ? undefined : 30000,
    dummy ? { skip: true, staticData } : undefined,
  )
}

export function useDashboardCharts(period = '30d', customStart?: string, customEnd?: string) {
  const dummy = isDashboardDummyMode()
  const staticData = useMemo(() => (dummy ? buildDummyCharts(period) : null), [dummy, period])
  const path = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return `/v1/admin/dashboard/charts?start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}`
    }
    return `/v1/admin/dashboard/charts?period=${encodeURIComponent(period)}`
  }, [period, customStart, customEnd])
  return useFetch<Charts>(
    dummy ? DUMMY_FETCH_PATH : path,
    undefined,
    dummy ? { skip: true, staticData } : undefined,
  )
}

export function useTopGames(period = '30d', limit = 10, customStart?: string, customEnd?: string) {
  const dummy = isDashboardDummyMode()
  const staticData = useMemo(() => (dummy ? dummyTopGames() : null), [dummy])
  const path = useMemo(() => {
    if (period === 'custom' && customStart && customEnd) {
      return `/v1/admin/dashboard/top-games?start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}&limit=${limit}`
    }
    return `/v1/admin/dashboard/top-games?period=${encodeURIComponent(period)}&limit=${limit}`
  }, [period, customStart, customEnd, limit])
  return useFetch<TopGamesData>(
    dummy ? DUMMY_FETCH_PATH : path,
    undefined,
    dummy ? { skip: true, staticData } : undefined,
  )
}

export function usePlayerStats() {
  const dummy = isDashboardDummyMode()
  const staticData = useMemo(() => (dummy ? dummyPlayerStats() : null), [dummy])
  return useFetch<PlayerStats>(
    dummy ? DUMMY_FETCH_PATH : '/v1/admin/dashboard/player-stats',
    undefined,
    dummy ? { skip: true, staticData } : undefined,
  )
}

export function useBonusStats() {
  const dummy = isDashboardDummyMode()
  const staticData = useMemo(() => (dummy ? dummyBonusStats() : null), [dummy])
  return useFetch<BonusStats>(
    dummy ? DUMMY_FETCH_PATH : '/v1/admin/bonushub/dashboard/summary',
    dummy ? undefined : 30000,
    dummy ? { skip: true, staticData } : undefined,
  )
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
