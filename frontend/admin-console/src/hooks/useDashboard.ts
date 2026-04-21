import { useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'

interface KPIs {
  ggr_24h: number
  ggr_7d: number
  ggr_30d: number
  ggr_all: number
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
  ngr_30d: number
  arpu_7d: number
  avg_deposit_size_30d: number
  deposit_conversion_rate: number
  pending_withdrawals_value: number
  pending_withdrawals_count: number
}

interface DayPoint {
  date: string
  total_minor: number
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
  registrations_by_day: DayPoint[]
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
  total: number
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

function useFetch<T>(path: string, pollMs?: number) {
  const { apiFetch } = useAdminAuth()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await apiFetch(path)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, path])

  useEffect(() => {
    fetchData()
    if (pollMs && pollMs > 0) {
      const id = setInterval(fetchData, pollMs)
      return () => clearInterval(id)
    }
  }, [fetchData, pollMs])

  return { data, loading, error, refetch: fetchData }
}

export function useDashboardKPIs() {
  return useFetch<KPIs>('/v1/admin/dashboard/kpis', 30000)
}

export function useDashboardCharts(period = '30d') {
  return useFetch<Charts>(`/v1/admin/dashboard/charts?period=${period}`)
}

export function useTopGames(period = '30d', limit = 10) {
  return useFetch<TopGamesData>(`/v1/admin/dashboard/top-games?period=${period}&limit=${limit}`)
}

export function usePlayerStats() {
  return useFetch<PlayerStats>('/v1/admin/dashboard/player-stats')
}

export function useBonusStats() {
  return useFetch<BonusStats>('/v1/admin/bonushub/dashboard/summary', 30000)
}

export interface DashboardSystem {
  webhook_deliveries_pending: number
  users_missing_fystack_wallet: number
  withdrawals_in_flight: number
  worker_failed_jobs_unresolved: number
  redis_queue_depth?: number
  process_metrics?: Record<string, unknown>
}

export function useDashboardSystem(pollMs = 30000) {
  return useFetch<DashboardSystem>('/v1/admin/dashboard/system', pollMs)
}

export function useAuditLog(filters: Record<string, string> = {}) {
  const params = new URLSearchParams(filters).toString()
  return useFetch<{ entries: any[]; total_count: number }>(`/v1/admin/audit-log?${params}`)
}

export function usePendingWithdrawals() {
  return useFetch<{ pending: any[]; count: number }>('/v1/admin/withdrawals/pending-approval', 30000)
}

export type { KPIs, Charts, DayPoint, GGRDayPoint, TopGame, TopGamesData, TopDepositor, PlayerStats, BonusStats }
