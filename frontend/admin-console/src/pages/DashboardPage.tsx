import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminAuth } from '../authContext'
import {
  StatCard,
  ChartCard,
  AreaChart,
  BarChart,
  DonutChart,
  StatusBadge,
  MetricRow,
  ChartEmpty,
} from '../components/dashboard'
import { CHART_COLORS } from '../components/dashboard'
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
import { alignDailyCounts, alignTwoDailyTotals } from '../lib/dashboardSeries'
import { isDashboardDummyMode } from '../lib/dashboardDummy'
import WorldSessionsMap from '../components/analytics/WorldSessionsMap'
import { useBootstrapTooltip } from '../hooks/useBootstrapTooltip'
import { useTrafficAnalytics, type TrafficPeriod } from '../hooks/useTrafficAnalytics'
import { useCasinoAnalytics } from '../hooks/useCasinoAnalytics'
import DataTimeframeBar from '../components/dashboard/DataTimeframeBar'

const VISITOR_GEOGRAPHY_TOOLTIP =
  'Sessions by country for the period shown under the title. Figures come from player lobby traffic (one browser session per row in the database). Open Demographics for the full map, top countries table, device mix, and 7 / 30 / 90-day ranges.'

const CHART_PERIODS = ['30d', '7d', '90d']
const DASHBOARD_PERIOD_OPTIONS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

type ChallengesSummaryJSON = {
  active_challenges: number
  draft_challenges: number
  entries_last_30d: number
  challenge_wagered_minor: number
  prizes_paid_minor_30d: number
  flagged_pending: number
}

function yMoney(val: number) {
  return formatMinorToMajor(val)
}

function selectedPeriodLabel(period: string) {
  if (period === '7d') return '7d'
  if (period === '90d') return '90d'
  if (period === '6m') return '6m'
  if (period === 'ytd') return 'ytd'
  if (period === 'all') return 'all'
  if (period === 'custom') return 'custom'
  return '30d'
}

function StatSkeleton() {
  return (
    <div className="small-box text-bg-secondary placeholder-glow">
      <div className="inner">
        <h3>
          <span className="placeholder col-7 d-block" />
        </h3>
        <p>
          <span className="placeholder col-9 d-block" />
        </p>
      </div>
    </div>
  )
}

function ChartSkeleton({ h = 280 }: { h?: number }) {
  return (
    <div className="card shadow-sm mb-4">
      <div className="card-header placeholder-glow">
        <span className="placeholder col-4" />
      </div>
      <div className="card-body placeholder-glow">
        <div className="placeholder w-100" style={{ height: h }} />
      </div>
    </div>
  )
}

type AttentionRow = {
  key: string
  title: string
  detail: string
  href: string
}

export default function DashboardPage() {
  const { role, apiFetch } = useAdminAuth()
  const [chartPeriod, setChartPeriod] = useState('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const periodLabel = selectedPeriodLabel(chartPeriod)
  const {
    data: casinoAnalytics,
    loading: casinoAnalyticsLoading,
    error: casinoAnalyticsError,
    refetch: refetchCasinoAnalytics,
  } = useCasinoAnalytics(chartPeriod, customStart, customEnd)
  const { data: kpis, loading: kpisLoading, error: kpisError, refetch: refetchKpis } = useDashboardKPIs()
  const { data: charts, loading: chartsLoading, error: chartsError, refetch: refetchCharts } =
    useDashboardCharts(chartPeriod, customStart, customEnd)
  const { data: topGames, loading: topGamesLoading, error: topGamesError, refetch: refetchTopGames } =
    useTopGames(chartPeriod, 10, customStart, customEnd)
  const { data: playerStats, loading: playerStatsLoading, error: playerStatsError, refetch: refetchPlayerStats } =
    usePlayerStats()
  const { data: bonusStats, error: bonusStatsError, refetch: refetchBonusStats } = useBonusStats()
  const { data: systemHealth, error: systemError, refetch: refetchSystem } = useDashboardSystem()
  const {
    data: traffic,
    loading: trafficLoading,
    error: trafficError,
    refetch: refetchTraffic,
  } = useTrafficAnalytics(chartPeriod as TrafficPeriod, customStart, customEnd)

  const visitorGeographyTitleRef = useBootstrapTooltip<HTMLHeadingElement>(VISITOR_GEOGRAPHY_TOOLTIP)

  const ggrDates = charts?.ggr_by_day.map((d) => d.date) ?? []
  const ggrValues = charts?.ggr_by_day.map((d) => d.ggr_minor) ?? []

  const depWd =
    charts != null
      ? alignTwoDailyTotals(
          charts.deposits_by_day.map((d) => ({ date: d.date, total_minor: d.total_minor })),
          charts.withdrawals_by_day.map((d) => ({ date: d.date, total_minor: d.total_minor })),
        )
      : null

  const regSeries =
    charts != null
      ? alignDailyCounts(
          charts.registrations_by_day.map((d) => ({ date: d.date, count: d.count ?? 0 })),
        )
      : null

  const topGameLabels = topGames?.top_by_launches.map((g) => g.title) ?? []
  const topGameCounts = topGames?.top_by_launches.map((g) => g.launch_count ?? 0) ?? []

  const funnelLabels = ['Registered', 'Deposited', 'Active 7d']
  const funnelSeries = playerStats
    ? [playerStats.total_registered, playerStats.total_with_deposit, playerStats.total_active_7d]
    : []

  const loadErrors = [
    kpisError && `KPIs: ${kpisError}`,
    chartsError && `Charts: ${chartsError}`,
    topGamesError && `Top games: ${topGamesError}`,
    playerStatsError && `Player stats: ${playerStatsError}`,
    bonusStatsError && `Bonus summary: ${bonusStatsError}`,
    systemError && `System health: ${systemError}`,
    trafficError && `Traffic / geo: ${trafficError}`,
    casinoAnalyticsError && `Casino analytics: ${casinoAnalyticsError}`,
  ].filter(Boolean) as string[]

  const dummyDashboard = isDashboardDummyMode()
  const selectedGGR = ggrValues.reduce((sum, value) => sum + value, 0)
  /** Headline GGR/NGR use the same ledger-backed window as `/casino-analytics` (fallback to chart slice if analytics unavailable). */
  const headlineGGR =
    casinoAnalytics != null && !casinoAnalyticsError ? (casinoAnalytics.kpis?.ggr_minor ?? selectedGGR) : selectedGGR
  const selectedDeposits = charts?.deposits_by_day.reduce((sum, row) => sum + (row.total_minor ?? 0), 0) ?? 0
  const selectedDepositCount = charts?.deposits_by_day.reduce((sum, row) => sum + (row.count ?? 0), 0) ?? 0
  const selectedWithdrawals = charts?.withdrawals_by_day.reduce((sum, row) => sum + (row.total_minor ?? 0), 0) ?? 0
  const selectedRegistrations = regSeries?.values.reduce((sum, value) => sum + value, 0) ?? 0
  /** Same window + NGR formula as headline NGR (`/casino-analytics`); falls back to fixed-interval KPIs while loading. */
  const windowKpisReady =
    casinoAnalytics != null && !casinoAnalyticsError && !casinoAnalyticsLoading
  const selectedActivePlayers =
    windowKpisReady && typeof casinoAnalytics.kpis.active_wagering_users === 'number'
      ? casinoAnalytics.kpis.active_wagering_users
      : chartPeriod === '7d'
        ? (kpis?.active_players_7d ?? 0)
        : (kpis?.active_players_30d ?? 0)
  const selectedArpu =
    windowKpisReady && typeof casinoAnalytics.kpis.ngr_per_wagering_user === 'number'
      ? casinoAnalytics.kpis.ngr_per_wagering_user
      : chartPeriod === '7d'
        ? (kpis?.arpu_7d ?? 0)
        : (kpis?.arpu_30d ?? 0)
  const selectedTotalWagered = useMemo(() => {
    if (!kpis) return 0
    if (chartPeriod === '7d') return kpis.total_wagered_7d ?? 0
    if (chartPeriod === 'all') return kpis.total_wagered_all ?? 0
    return kpis.total_wagered_30d ?? 0
  }, [chartPeriod, kpis])
  const selectedAvgDeposit = selectedDepositCount > 0 ? selectedDeposits / selectedDepositCount : 0

  const [challengesSummary, setChallengesSummary] = useState<ChallengesSummaryJSON | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch('/v1/admin/challenges/summary')
        const j = (await res.json()) as ChallengesSummaryJSON
        if (!cancelled && res.ok && j && typeof j === 'object') setChallengesSummary(j)
      } catch {
        /* optional widget */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch])

  const needsAttention = useMemo((): AttentionRow[] => {
    if (dummyDashboard) return []
    const rows: AttentionRow[] = []
    const wHook = systemHealth?.webhook_deliveries_pending ?? 0
    if (wHook > 0) {
      rows.push({
        key: 'payment-callback-backlog',
        title: 'Payment callbacks backlog',
        detail: `${wHook} deposit callback row(s) awaiting processing.`,
        href: '/finance',
      })
    }
    const failedJobs = systemHealth?.worker_failed_jobs_unresolved ?? 0
    if (failedJobs > 0) {
      rows.push({
        key: 'failed-jobs',
        title: 'Bonus worker failed jobs',
        detail: `${failedJobs} unresolved job(s) need retry or investigation.`,
        href: '/bonushub/operations?tab=failed_jobs',
      })
    }
    const dlq = systemHealth?.bonus_outbox_dead_letter ?? 0
    if (dlq > 0) {
      rows.push({
        key: 'outbox-dlq',
        title: 'Bonus outbox DLQ',
        detail: `${dlq} dead-letter row(s) in the compliance outbox.`,
        href: '/bonushub/bonus-audit?tab=outbox&outbox=dlq',
      })
    }
    const riskQ = bonusStats?.risk_queue_pending ?? 0
    if (riskQ > 0) {
      rows.push({
        key: 'risk-q',
        title: 'Bonus risk queue',
        detail: `${riskQ} decision(s) awaiting staff review.`,
        href: '/bonushub/risk',
      })
    }
    const chFlag = challengesSummary?.flagged_pending ?? 0
    if (chFlag > 0) {
      rows.push({
        key: 'challenges-flagged',
        title: 'Challenge entries flagged',
        detail: `${chFlag} active player / players in challenge review queue (risk, max bet, etc.).`,
        href: '/engagement/challenges/flagged',
      })
    }
    const pendWd = kpis?.pending_withdrawals_count ?? 0
    if (pendWd > 0) {
      rows.push({
        key: 'pend-wd',
        title: 'Withdrawals in approval queue',
        detail: `${pendWd} request(s) — ${formatCurrency(kpis?.pending_withdrawals_value ?? 0)} total value.`,
        href: '/withdrawal-approvals',
      })
    }
    return rows
  }, [bonusStats, challengesSummary, dummyDashboard, kpis, role, systemHealth])

  return (
    <div className="dashboard-adminlte">
      <div className="row g-3 mb-3 dashboard-kpi-grid">
        <div className="col-sm-6">
          <h1 className="m-0 fs-2">Dashboard</h1>
          <p className="text-secondary small mb-0 mt-1">Revenue, liquidity, players, and pipeline health</p>
        </div>
        <div className="col-sm-6">
          <ol className="breadcrumb float-sm-end mt-2 mb-0">
            <li className="breadcrumb-item">
              <Link to="/">Home</Link>
            </li>
            <li className="breadcrumb-item active" aria-current="page">
              Dashboard
            </li>
          </ol>
        </div>
      </div>

      {dummyDashboard ? (
        <div className="alert alert-info small py-2 mb-3" role="status">
          <strong>Demo mode:</strong> Values below are built-in sample data for this admin build, not your database. Set{' '}
          <code className="user-select-all">VITE_ADMIN_DUMMY_DASHBOARD=false</code> and redeploy to load live KPIs from
          the API.
        </div>
      ) : null}

      {role === 'superadmin' && !dummyDashboard ? (
        <details className="card border mb-3 shadow-sm">
          <summary className="card-header py-2 px-3 user-select-none" style={{ cursor: 'pointer' }}>
            How to populate dashboard metrics (dev / demo)
          </summary>
          <div className="card-body small py-3">
            <p className="mb-2">
              Tiles and charts read from <strong>Postgres</strong> (ledger, users, payments). Clearing browser storage only
              affects this browser, not these figures.
            </p>
            <ul className="mb-0">
              <li className="mb-2">
                <strong>UI-only:</strong> set <code className="user-select-all">VITE_ADMIN_DUMMY_DASHBOARD=true</code> on
                this admin project — the dashboard uses deterministic demo payloads without extra DB writes.
              </li>
              <li>
                <strong>Real ledger activity:</strong> ensure at least one player exists, set{' '}
                <code className="user-select-all">ALLOW_DASHBOARD_DEMO_SEED=1</code> in the environment (refused when{' '}
                <code>APP_ENV=production</code>), then from the repo root run{' '}
                <code className="user-select-all">npm run seed:dashboard-kpis</code> (or{' '}
                <code className="user-select-all">go run ./cmd/dashboardseed</code> under{' '}
                <code>services/core</code>). Safe to re-run; rows use fixed idempotency keys.
              </li>
            </ul>
          </div>
        </details>
      ) : null}

      <DataTimeframeBar
        value={chartPeriod}
        onChange={setChartPeriod}
        options={DASHBOARD_PERIOD_OPTIONS}
        startDate={customStart}
        endDate={customEnd}
        onStartDateChange={setCustomStart}
        onEndDateChange={setCustomEnd}
      />

      {role !== 'superadmin' ? (
        <div className="alert alert-light border small py-2 mb-3 mb-sm-3">
          Signed in as <strong>{role}</strong>. Payment flags, staff tools, and some queues may require{' '}
          <strong>superadmin</strong>; widgets below still show read-only health signals where available.
        </div>
      ) : null}

      {loadErrors.length > 0 ? (
        <div className="alert alert-warning" role="alert">
          <strong>Some widgets failed to load</strong>
          <ul className="mb-2 mt-2 small">
            {loadErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-sm btn-warning"
            onClick={() => {
              void refetchKpis()
              void refetchCharts()
              void refetchTopGames()
              void refetchPlayerStats()
              void refetchSystem()
              void refetchBonusStats()
              void refetchTraffic()
              void refetchCasinoAnalytics()
            }}
          >
            Retry
          </button>
        </div>
      ) : null}

      {needsAttention.length > 0 ? (
        <div className="card border-warning shadow-sm mb-3">
          <div className="card-header bg-warning-subtle py-2 d-flex flex-wrap align-items-center justify-content-between gap-2">
            <div>
              <strong>Needs attention</strong>
              <span className="text-secondary small ms-2">From live system + bonus summaries</span>
            </div>
            <span className="badge text-bg-warning">{needsAttention.length}</span>
          </div>
          <ul className="list-group list-group-flush">
            {needsAttention.map((r) => (
              <li
                key={r.key}
                className="list-group-item d-flex flex-wrap justify-content-between align-items-center gap-2"
              >
                <div className="min-w-0">
                  <div className="fw-semibold">{r.title}</div>
                  <div className="small text-secondary mb-0">{r.detail}</div>
                </div>
                <Link to={r.href} className="btn btn-sm btn-outline-primary shrink-0">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Secondary KPI strip — revenue quality & pipeline (top of dashboard) */}
      <div className="row g-3 mb-3 dashboard-kpi-grid">
        {kpisLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="col-lg col-md-6 col-12">
              <StatSkeleton />
            </div>
          ))
        ) : (
          <>
            <div className="col-lg col-md-6 col-12">
              <StatCard
                label={`Total wagered (${periodLabel === '7d' ? '7d' : periodLabel === 'all' ? 'all' : '30d roll-up'})`}
                value={formatCurrency(selectedTotalWagered)}
                iconClass="bi-dice-5"
                variant="secondary"
              />
            </div>
            <div className="col-lg col-md-6 col-12">
              <StatCard
                label={`ARPU / wagering user (${periodLabel})`}
                value={formatCurrency(selectedArpu)}
                iconClass="bi-currency-dollar"
                variant="secondary"
              />
            </div>
            <div className="col-lg col-md-6 col-12">
              <StatCard
                label={`Avg deposit (${periodLabel})`}
                value={formatCurrency(selectedAvgDeposit)}
                iconClass="bi-bank"
                variant="info"
              />
            </div>
            <div className="col-lg col-md-6 col-12">
              <StatCard
                label={`Deposit conversion (${periodLabel})`}
                value={formatPct(casinoAnalytics?.kpis?.reg_to_ftd_conversion_rate ?? 0)}
                iconClass="bi-percent"
                variant="primary"
              />
            </div>
            <div className="col-lg col-md-6 col-12">
              <StatCard
                label="Pending withdrawals (value)"
                value={formatCurrency(kpis?.pending_withdrawals_value ?? 0)}
                iconClass="bi-hourglass-split"
                variant="warning"
              />
            </div>
          </>
        )}
      </div>

      {/* Primary KPIs — AdminLTE small boxes */}
      <div className="row mb-3">
        {kpisLoading ? (
          Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="col-xl-2 col-lg-4 col-md-6 col-12">
              <StatSkeleton />
            </div>
          ))
        ) : (
          <>
            <div className="col-xl-2 col-lg-4 col-md-6 col-12">
              <StatCard
                label={`GGR (${periodLabel})`}
                value={formatCurrency(headlineGGR)}
                iconClass="bi-graph-up-arrow"
                variant="primary"
              />
            </div>
            <div className="col-xl-2 col-lg-4 col-md-6 col-12">
              <StatCard
                label={`NGR (${periodLabel})`}
                value={
                  casinoAnalyticsLoading
                    ? '...'
                    : casinoAnalyticsError
                      ? '—'
                      : formatCurrency(casinoAnalytics?.kpis?.ngr_total ?? 0)
                }
                iconClass="bi-piggy-bank"
                variant="primary"
              />
            </div>
            <div className="col-xl-2 col-lg-4 col-md-6 col-12">
              <StatCard
                label={`Deposits (${periodLabel})`}
                value={formatCurrency(selectedDeposits)}
                iconClass="bi-arrow-down-circle"
                variant="success"
              />
            </div>
            <div className="col-xl-2 col-lg-4 col-md-6 col-12">
              <StatCard
                label={`Withdrawals (${periodLabel})`}
                value={formatCurrency(selectedWithdrawals)}
                iconClass="bi-arrow-up-circle"
                variant="danger"
              />
            </div>
            <div className="col-xl-2 col-lg-4 col-md-6 col-12">
              <StatCard
                label={`Active players (${periodLabel === '7d' ? '7d' : '30d'})`}
                value={formatCompact(selectedActivePlayers)}
                iconClass="bi-people"
                variant="warning"
              />
            </div>
            <div className="col-xl-2 col-lg-4 col-md-6 col-12">
              <StatCard
                label={`New registrations (${periodLabel})`}
                value={formatCompact(selectedRegistrations)}
                iconClass="bi-person-plus"
                variant="info"
              />
            </div>
            <div className="col-xl-2 col-lg-4 col-md-6 col-12">
              <StatCard
                label={`FTD (${periodLabel})`}
                value={
                  casinoAnalyticsLoading
                    ? '...'
                    : formatCompact(casinoAnalytics?.kpis?.ftd_count ?? 0)
                }
                iconClass="bi-cash-coin"
                variant="secondary"
              />
            </div>
          </>
        )}
      </div>

      {/* Challenge program — wager attribution is a slice of settled stakes also present on the main ledger */}
      <div className="row g-3 mb-3">
        <div className="col-12 d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h3 className="h6 text-secondary mb-0">Casino challenges</h3>
          <Link to="/engagement/challenges" className="btn btn-sm btn-outline-primary">
            Open challenges hub
          </Link>
        </div>
        <div className="col-xl-4 col-md-6 col-12">
          <StatCard
            label="Active + drafts"
            value={
              challengesSummary
                ? `${formatCompact(challengesSummary.active_challenges)} / ${formatCompact(challengesSummary.draft_challenges)}`
                : '…'
            }
            iconClass="bi-trophy"
            variant="primary"
          />
        </div>
        <div className="col-xl-4 col-md-6 col-12">
          <StatCard
            label="Challenge-attributed wager (30d)"
            value={
              challengesSummary ? formatCurrency(challengesSummary.challenge_wagered_minor) : '…'
            }
            iconClass="bi-dice-5"
            variant="info"
          />
        </div>
        <div className="col-xl-4 col-md-6 col-12">
          <StatCard
            label="Challenge prizes paid (30d)"
            value={challengesSummary ? formatCurrency(challengesSummary.prizes_paid_minor_30d) : '…'}
            iconClass="bi-gift"
            variant="success"
          />
        </div>
      </div>

      {/* Visitor geography — world map + top countries */}
      <div className="row mb-4">
        <div className="col-12 col-xl-8 mb-3 mb-xl-0">
          <div className="card shadow-sm h-100">
            <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div className="min-w-0">
                <h3
                  ref={visitorGeographyTitleRef}
                  className="card-title mb-0 fs-6 d-block cursor-help"
                  tabIndex={0}
                >
                  Visitor geography
                </h3>
                <p className="text-secondary small mb-0 mt-1 d-block">
                  Sessions by country (last {traffic?.period ?? periodLabel})
                </p>
              </div>
              <Link to="/analytics/demographics" className="btn btn-sm btn-outline-primary">
                Open demographics hub
              </Link>
            </div>
            <div className="card-body pt-3">
              {trafficLoading ? (
                <div className="placeholder-glow rounded bg-body-secondary" style={{ minHeight: 280 }} />
              ) : trafficError && !traffic ? (
                <p className="text-secondary small mb-0">
                  Map unavailable ({trafficError}). Open{' '}
                  <Link to="/analytics/demographics">Demographics</Link> to retry.
                </p>
              ) : traffic ? (
                <WorldSessionsMap countries={traffic.countries} height={280} />
              ) : null}
            </div>
          </div>
        </div>
        <div className="col-12 col-xl-4">
          <div className="card shadow-sm h-100">
            <div className="card-header">
              <h3 className="card-title mb-0 fs-6">Top countries</h3>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive" style={{ maxHeight: 300 }}>
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="table-light sticky-top">
                    <tr>
                      <th>Country</th>
                      <th className="text-end">Sessions</th>
                      <th className="text-end">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(traffic?.countries ?? []).slice(0, 8).map((c) => (
                      <tr key={c.iso2}>
                        <td className="small">
                          <span className="fw-medium">{c.iso2}</span>{' '}
                          <span className="text-secondary">{c.name}</span>
                        </td>
                        <td className="text-end font-monospace small">{formatCompact(c.sessions)}</td>
                        <td className="text-end small">{c.pct_of_total.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-2 border-top bg-body-secondary">
                <Link to="/analytics/traffic-sources" className="small link-primary">
                  Traffic sources &amp; attribution →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="row">
        <div className="col-lg-6">
          {chartsLoading ? (
            <ChartSkeleton />
          ) : (
            <ChartCard
              title="Gross gaming revenue (daily)"
              periods={CHART_PERIODS}
              activePeriod={chartPeriod}
              onPeriodChange={setChartPeriod}
            >
              <AreaChart
                series={[{ name: 'GGR', data: ggrValues, color: CHART_COLORS.primary }]}
                categories={ggrDates}
                yFormatter={yMoney}
              />
            </ChartCard>
          )}
        </div>
        <div className="col-lg-6">
          {chartsLoading ? (
            <ChartSkeleton />
          ) : (
            <ChartCard
              title="Cash in vs cash out"
              periods={CHART_PERIODS}
              activePeriod={chartPeriod}
              onPeriodChange={setChartPeriod}
            >
              <AreaChart
                series={[
                  { name: 'Deposits', data: depWd?.valuesA ?? [], color: CHART_COLORS.success },
                  { name: 'Withdrawals', data: depWd?.valuesB ?? [], color: CHART_COLORS.danger },
                ]}
                categories={depWd?.categories ?? []}
                yFormatter={yMoney}
              />
            </ChartCard>
          )}
        </div>
      </div>

      <div className="row">
        <div className="col-12">
          {chartsLoading ? (
            <ChartSkeleton h={260} />
          ) : charts ? (
            <ChartCard
              title="Bonus grants (daily volume)"
              periods={CHART_PERIODS}
              activePeriod={chartPeriod}
              onPeriodChange={setChartPeriod}
            >
              <AreaChart
                series={[
                  {
                    name: 'Granted (minor units)',
                    data: charts.bonus_grants_by_day.map((d) => d.total_minor),
                    color: CHART_COLORS.purple,
                  },
                ]}
                categories={charts.bonus_grants_by_day.map((d) => d.date)}
                height={280}
                yFormatter={yMoney}
              />
            </ChartCard>
          ) : null}
        </div>
      </div>

      <div className="row">
        <div className="col-lg-6">
          {topGamesLoading ? (
            <ChartSkeleton h={320} />
          ) : topGamesError && !topGames ? (
            <ChartCard title="Top games by launches">
              <ChartEmpty message={`Could not load top games: ${topGamesError}`} height={320} />
            </ChartCard>
          ) : (
            <ChartCard title="Top games by launches (period)">
              <BarChart
                labels={topGameLabels}
                data={topGameCounts}
                color={CHART_COLORS.primary}
                horizontal
                height={340}
                yFormatter={(v) => formatCompact(v)}
              />
            </ChartCard>
          )}
        </div>
        <div className="col-lg-6">
          {chartsLoading ? (
            <ChartSkeleton h={320} />
          ) : chartsError && !charts ? (
            <ChartCard title="Daily registrations">
              <ChartEmpty message={`Could not load charts: ${chartsError}`} height={320} />
            </ChartCard>
          ) : (
            <ChartCard
              title="New registrations (daily)"
              periods={CHART_PERIODS}
              activePeriod={chartPeriod}
              onPeriodChange={setChartPeriod}
            >
              <AreaChart
                series={[
                  { name: 'Signups', data: regSeries?.values ?? [], color: CHART_COLORS.teal },
                ]}
                categories={regSeries?.categories ?? []}
                height={320}
                yFormatter={(v) => formatCompact(v)}
              />
            </ChartCard>
          )}
        </div>
      </div>

      <div className="row">
        <div className="col-lg-6">
          {playerStatsLoading ? (
            <ChartSkeleton h={300} />
          ) : playerStatsError && !playerStats ? (
            <ChartCard title="Player funnel">
              <ChartEmpty message={`Could not load player stats: ${playerStatsError}`} height={280} />
            </ChartCard>
          ) : playerStats ? (
            <ChartCard title="Registration → deposit → activity">
              <DonutChart
                labels={funnelLabels}
                series={funnelSeries}
                colors={[CHART_COLORS.primary, CHART_COLORS.success, CHART_COLORS.warning]}
                centerLabel="Players"
              />
            </ChartCard>
          ) : (
            <ChartCard title="Player funnel">
              <ChartEmpty message="Player snapshot unavailable." height={280} />
            </ChartCard>
          )}
        </div>
        <div className="col-lg-6">
          {playerStatsLoading ? (
            <ChartSkeleton h={300} />
          ) : playerStatsError && !playerStats ? (
            <ChartCard title="Top depositors">
              <ChartEmpty message={`Could not load player stats: ${playerStatsError}`} height={280} />
            </ChartCard>
          ) : playerStats ? (
            <ChartCard title="Top depositors (lifetime value)">
              <BarChart
                labels={(playerStats.top_depositors ?? []).slice(0, 10).map((d) => {
                  const em = d.email?.trim()
                  if (em && em.includes('@')) return em.split('@')[0] ?? em
                  return d.id.slice(0, 8)
                })}
                data={(playerStats.top_depositors ?? []).slice(0, 10).map((d) => d.total_minor)}
                color={CHART_COLORS.success}
                horizontal
                height={320}
                yFormatter={yMoney}
              />
            </ChartCard>
          ) : (
            <ChartCard title="Top depositors">
              <ChartEmpty message="Player snapshot unavailable." height={280} />
            </ChartCard>
          )}
        </div>
      </div>

      <div className="row">
        <div className="col-lg-6">
          <ChartCard title="Integrations & workers">
            <div className="small text-secondary mb-2">
              Queue depths and job health. Follow links to clear backlogs.
            </div>
            <MetricRow
              label="Payment callbacks pending"
              value={String(systemHealth?.webhook_deliveries_pending ?? '—')}
              subValue={
                <Link to="/finance" className="link-primary">
                  Finance overview
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
              label="Worker failures (unresolved)"
              value={String(systemHealth?.worker_failed_jobs_unresolved ?? '—')}
              subValue={
                <Link to="/bonushub/operations?tab=failed_jobs" className="link-primary">
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
              label="Redis job queue depth"
              value={systemHealth?.redis_queue_depth != null ? String(systemHealth.redis_queue_depth) : '—'}
              subValue="casino:jobs"
            />
            <MetricRow
              label="Bonus outbox pending"
              value={String(systemHealth?.bonus_outbox_pending_delivery ?? '—')}
              subValue={
                <Link to="/bonushub/bonus-audit?tab=outbox" className="link-primary">
                  Compliance → Outbox
                </Link>
              }
              trailing={
                <StatusBadge
                  label={(systemHealth?.bonus_outbox_pending_delivery ?? 0) > 0 ? 'Backlog' : 'Clear'}
                  variant={(systemHealth?.bonus_outbox_pending_delivery ?? 0) > 0 ? 'warning' : 'success'}
                  dot
                />
              }
            />
            <MetricRow
              label="Bonus outbox DLQ"
              value={String(systemHealth?.bonus_outbox_dead_letter ?? '—')}
              subValue={
                <Link to="/bonushub/bonus-audit?tab=outbox&outbox=dlq" className="link-primary">
                  DLQ filter
                </Link>
              }
              trailing={
                <StatusBadge
                  label={(systemHealth?.bonus_outbox_dead_letter ?? 0) > 0 ? 'Review' : 'Clear'}
                  variant={(systemHealth?.bonus_outbox_dead_letter ?? 0) > 0 ? 'error' : 'success'}
                  dot
                />
              }
            />
          </ChartCard>
        </div>
        <div className="col-lg-6">
          <ChartCard title="Finance & bonus risk">
            <MetricRow
              label={`NGR (${periodLabel})`}
              value={
                casinoAnalyticsLoading
                  ? '...'
                  : casinoAnalyticsError
                    ? '—'
                    : formatCurrency(casinoAnalytics?.kpis?.ngr_total ?? 0)
              }
              subValue={
                casinoAnalytics?.kpis?.ngr_previous_period != null
                  ? `Prior period: ${formatCurrency(casinoAnalytics.kpis.ngr_previous_period)}`
                  : 'Ledger-backed (bonuses, rewards, fees, payouts)'
              }
            />
            <MetricRow
              label="Withdrawals in flight"
              value={String(systemHealth?.withdrawals_in_flight ?? '—')}
              subValue={
                <Link to="/withdrawals" className="link-primary">
                  Withdrawals table
                </Link>
              }
            />
            <MetricRow
              label="Pending withdrawal count"
              value={String(kpis?.pending_withdrawals_count ?? 0)}
              subValue={kpis ? formatCurrency(kpis.pending_withdrawals_value) : '—'}
              trailing={
                <StatusBadge
                  label={(kpis?.pending_withdrawals_count ?? 0) > 0 ? 'Review' : 'Clear'}
                  variant={(kpis?.pending_withdrawals_count ?? 0) > 0 ? 'warning' : 'success'}
                  dot
                />
              }
            />
            <MetricRow
              label="Bonus risk queue"
              value={String(bonusStats?.risk_queue_pending ?? 0)}
              subValue="Flagged instances"
              trailing={
                <StatusBadge
                  label={(bonusStats?.risk_queue_pending ?? 0) > 0 ? 'Pending' : 'Clear'}
                  variant={(bonusStats?.risk_queue_pending ?? 0) > 0 ? 'warning' : 'success'}
                  dot
                />
              }
            />
            <MetricRow
              label="Bonus cost / GGR (30d)"
              value={bonusStats ? formatPct(bonusStats.bonus_pct_of_ggr) : '—'}
              subValue="Cost efficiency"
              trailing={
                <StatusBadge
                  label={(bonusStats?.bonus_pct_of_ggr ?? 0) > 15 ? 'High' : 'OK'}
                  variant={(bonusStats?.bonus_pct_of_ggr ?? 0) > 15 ? 'error' : 'info'}
                  dot
                />
              }
            />
          </ChartCard>
        </div>
      </div>

      <ChartCard title="Process counters (this API process)">
        <p className="small text-secondary">
          In-memory totals since this API instance started. Worker-only metrics accrue on{' '}
          <code>cmd/worker</code> unless API and worker share a process.
        </p>
        {systemHealth?.process_metrics && Object.keys(systemHealth.process_metrics).length > 0 ? (
          <div className="table-responsive" style={{ maxHeight: 260 }}>
            <table className="table table-sm table-striped table-bordered align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col" className="text-end">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(systemHealth.process_metrics)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        <code className="small">{k}</code>
                      </td>
                      <td className="text-end font-monospace">{String(v)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-secondary small mb-0">No metrics loaded.</p>
        )}
      </ChartCard>
    </div>
  )
}
