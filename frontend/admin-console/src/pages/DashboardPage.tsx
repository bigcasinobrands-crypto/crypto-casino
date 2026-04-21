import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  StatCard,
  ChartCard,
  AreaChart,
  BarChart,
  DonutChart,
  StatusBadge,
  MetricRow,
} from '../components/dashboard'
import {
  useDashboardKPIs,
  useDashboardCharts,
  useTopGames,
  usePlayerStats,
  useBonusStats,
  useDashboardSystem,
} from '../hooks/useDashboard'
import {
  formatCurrency,
  formatMinorToMajor,
  formatCompact,
  formatPct,
} from '../lib/format'

/* ------------------------------------------------------------------ */
/*  Inline SVG icons                                                   */
/* ------------------------------------------------------------------ */

const IconGGR = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconDeposit = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <path d="M12 19V5m0 0-5 5m5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconWithdraw = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <path d="M12 5v14m0 0 5-5m-5 5-5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconUsers = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconUserPlus = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-6 w-6">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9" cy="7" r="4" />
    <path d="M20 8v6m3-3h-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/* ------------------------------------------------------------------ */
/*  Skeleton placeholder                                               */
/* ------------------------------------------------------------------ */

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700/60 ${className}`} />
}

function StatSkeleton() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <Skeleton className="mb-2 h-3 w-20" />
      <Skeleton className="h-7 w-28" />
    </div>
  )
}

function ChartSkeleton({ height = 'h-72' }: { height?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <Skeleton className="mb-4 h-5 w-36" />
      <Skeleton className={`w-full ${height}`} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const CHART_PERIODS = ['7d', '30d', '90d']

function yMoney(val: number) {
  return formatMinorToMajor(val)
}

/* ------------------------------------------------------------------ */
/*  DashboardPage                                                      */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const [chartPeriod, setChartPeriod] = useState('30d')
  const { data: kpis, loading: kpisLoading } = useDashboardKPIs()
  const { data: charts, loading: chartsLoading } = useDashboardCharts(chartPeriod)
  const { data: topGames } = useTopGames(chartPeriod)
  const { data: playerStats } = usePlayerStats()
  const { data: bonusStats } = useBonusStats()
  const { data: systemHealth } = useDashboardSystem()

  const ggrDates = charts?.ggr_by_day.map((d) => d.date) ?? []
  const ggrValues = charts?.ggr_by_day.map((d) => d.ggr_minor) ?? []
  const depositDates = charts?.deposits_by_day.map((d) => d.date) ?? []
  const depositValues = charts?.deposits_by_day.map((d) => d.total_minor) ?? []
  const withdrawValues = charts?.withdrawals_by_day.map((d) => d.total_minor) ?? []

  const topGameLabels = topGames?.top_by_launches.map((g) => g.title) ?? []
  const topGameCounts = topGames?.top_by_launches.map((g) => g.launch_count ?? 0) ?? []

  const funnelLabels = ['Registered', 'Deposited', 'Active 7d']
  const funnelSeries = playerStats
    ? [playerStats.total_registered, playerStats.total_with_deposit, playerStats.total_active_7d]
    : []

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>

      {/* ── Row 1: Primary KPIs ────────────────────────────────── */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <StatSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="GGR (30d)"
            value={formatCurrency(kpis?.ggr_30d ?? 0)}
            icon={IconGGR}
          />
          <StatCard
            label="Total Deposits (30d)"
            value={formatCurrency(kpis?.deposits_30d ?? 0)}
            icon={IconDeposit}
          />
          <StatCard
            label="Total Withdrawals (30d)"
            value={formatCurrency(kpis?.withdrawals_30d ?? 0)}
            icon={IconWithdraw}
          />
          <StatCard
            label="Active Players (7d)"
            value={formatCompact(kpis?.active_players_7d ?? 0)}
            icon={IconUsers}
          />
          <StatCard
            label="New Registrations (30d)"
            value={formatCompact(kpis?.new_registrations_30d ?? 0)}
            icon={IconUserPlus}
          />
        </div>
      )}

      {/* ── Row 2: Primary charts ──────────────────────────────── */}
      {chartsLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="GGR Trend"
            periods={CHART_PERIODS}
            onPeriodChange={setChartPeriod}
          >
            <AreaChart
              series={[{ name: 'GGR', data: ggrValues, color: '#7C3AED' }]}
              categories={ggrDates}
              yFormatter={yMoney}
            />
          </ChartCard>

          <ChartCard
            title="Deposits vs Withdrawals"
            periods={CHART_PERIODS}
            onPeriodChange={setChartPeriod}
          >
            <AreaChart
              series={[
                { name: 'Deposits', data: depositValues, color: '#22C55E' },
                { name: 'Withdrawals', data: withdrawValues, color: '#EF4444' },
              ]}
              categories={depositDates}
              yFormatter={yMoney}
            />
          </ChartCard>
        </div>
      )}

      {/* ── Row 3: Intelligence ────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {topGames ? (
          <ChartCard title="Top 10 Games by Launches">
            <BarChart
              labels={topGameLabels}
              data={topGameCounts}
              color="#6366F1"
              horizontal
              height={340}
            />
          </ChartCard>
        ) : (
          <ChartSkeleton height="h-80" />
        )}

        {playerStats ? (
          <ChartCard title="Player Funnel">
            <DonutChart
              labels={funnelLabels}
              series={funnelSeries}
              colors={['#6366F1', '#22C55E', '#F59E0B']}
              centerLabel="Players"
            />
          </ChartCard>
        ) : (
          <ChartSkeleton height="h-72" />
        )}
      </div>

      {/* ── Row 4: Secondary KPIs ──────────────────────────────── */}
      {kpisLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="ARPU (7d)" value={formatCurrency(kpis?.arpu_7d ?? 0)} />
          <StatCard label="Avg Deposit Size" value={formatCurrency(kpis?.avg_deposit_size_30d ?? 0)} />
          <StatCard label="Deposit Conversion" value={formatPct(kpis?.deposit_conversion_rate ?? 0)} />
          <StatCard label="Pending Withdrawals" value={formatCurrency(kpis?.pending_withdrawals_value ?? 0)} />
        </div>
      )}

      {/* ── Row 5: Pipeline & worker health ─────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Pipeline & workers">
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <MetricRow
              label="Fystack webhooks pending"
              value={String(systemHealth?.webhook_deliveries_pending ?? '—')}
              subValue={
                <Link to="/finance/fystack-webhooks" className="text-brand-600 hover:underline dark:text-brand-400">
                  Open inbox
                </Link>
              }
              trailing={
                <StatusBadge
                  label={(systemHealth?.webhook_deliveries_pending ?? 0) > 0 ? 'Backlog' : 'Clear'}
                  variant={(systemHealth?.webhook_deliveries_pending ?? 0) > 0 ? 'warning' : 'success'}
                  dot
                />
              }
            />
            <MetricRow
              label="Worker jobs unresolved"
              value={String(systemHealth?.worker_failed_jobs_unresolved ?? '—')}
              subValue={
                <Link to="/bonushub/operations?tab=failed_jobs" className="text-brand-600 hover:underline dark:text-brand-400">
                  Failed jobs
                </Link>
              }
              trailing={
                <StatusBadge
                  label={(systemHealth?.worker_failed_jobs_unresolved ?? 0) > 0 ? 'Action' : 'Clear'}
                  variant={(systemHealth?.worker_failed_jobs_unresolved ?? 0) > 0 ? 'error' : 'success'}
                  dot
                />
              }
            />
            <MetricRow
              label="Users missing Fystack wallet"
              value={String(systemHealth?.users_missing_fystack_wallet ?? '—')}
              subValue="Provisioning gap"
            />
            <MetricRow
              label="Redis job queue depth"
              value={
                systemHealth?.redis_queue_depth != null ? String(systemHealth.redis_queue_depth) : '—'
              }
              subValue="casino:jobs"
            />
          </div>
        </ChartCard>

        <ChartCard title="Finance & bonus queue">
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            <MetricRow
              label="Withdrawals in flight"
              value={String(systemHealth?.withdrawals_in_flight ?? '—')}
              subValue={
                <Link to="/withdrawals" className="text-brand-600 hover:underline dark:text-brand-400">
                  Withdrawals table
                </Link>
              }
            />
            <MetricRow
              label="Pending Withdrawals"
              value={String(kpis?.pending_withdrawals_count ?? 0)}
              subValue={kpis ? formatCurrency(kpis.pending_withdrawals_value) : '—'}
              trailing={
                <StatusBadge
                  label={(kpis?.pending_withdrawals_count ?? 0) > 0 ? 'Needs review' : 'Clear'}
                  variant={(kpis?.pending_withdrawals_count ?? 0) > 0 ? 'warning' : 'success'}
                  dot
                />
              }
            />
            <MetricRow
              label="Risk Queue"
              value={String(bonusStats?.risk_queue_pending ?? 0)}
              subValue="Flagged bonus instances"
              trailing={
                <StatusBadge
                  label={(bonusStats?.risk_queue_pending ?? 0) > 0 ? 'Pending' : 'Clear'}
                  variant={(bonusStats?.risk_queue_pending ?? 0) > 0 ? 'warning' : 'success'}
                  dot
                />
              }
            />
            <MetricRow
              label="Bonus Cost / GGR"
              value={bonusStats ? formatPct(bonusStats.bonus_pct_of_ggr) : '—'}
              subValue="30-day ratio"
              trailing={
                <StatusBadge
                  label={(bonusStats?.bonus_pct_of_ggr ?? 0) > 15 ? 'High' : 'Normal'}
                  variant={(bonusStats?.bonus_pct_of_ggr ?? 0) > 15 ? 'error' : 'info'}
                  dot
                />
              }
            />
          </div>
        </ChartCard>
      </div>
    </div>
  )
}
