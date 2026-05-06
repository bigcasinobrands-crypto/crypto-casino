import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'
import {
  AreaChart,
  CHART_COLORS,
  ChartCard,
  ChartEmpty,
  MetricRow,
  StatCard,
  StatusBadge,
} from '../components/dashboard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { useDashboardCharts, useDashboardKPIs } from '../hooks/useDashboard'
import { alignTwoDailyTotals } from '../lib/dashboardSeries'
import { formatCompact, formatCurrency } from '../lib/format'
import DataTimeframeBar from '../components/dashboard/DataTimeframeBar'
import { useCasinoAnalytics } from '../hooks/useCasinoAnalytics'

type Summary = Record<string, unknown>

type PaymentFlags = {
  deposits_enabled: boolean
  withdrawals_enabled: boolean
  real_play_enabled: boolean
  bonuses_enabled?: boolean
  automated_grants_enabled?: boolean
}

type DepositAssetsPayload = {
  configured?: Record<string, boolean>
}

const CHART_PERIODS = ['7d', '30d', '90d'] as const
const FINANCE_PERIOD_OPTIONS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

const FLAG_LABELS: Record<string, string> = {
  deposits_enabled: 'Player deposits',
  withdrawals_enabled: 'Player withdrawals',
  real_play_enabled: 'Real-money play',
  bonuses_enabled: 'Bonus promotions',
  automated_grants_enabled: 'Automated bonus grants',
}

function ChartSkeleton({ h = 300 }: { h?: number }) {
  return <div className="placeholder-glow rounded bg-body-secondary w-100" style={{ height: h }} />
}

function periodLabel(period: string) {
  if (period === '7d') return '7d'
  if (period === '90d') return '90d'
  return '30d'
}

export default function PaymentOpsPage() {
  const { apiFetch, role } = useAdminAuth()
  const [chartPeriod, setChartPeriod] = useState<string>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [flags, setFlags] = useState<PaymentFlags | null>(null)
  const [depositAssets, setDepositAssets] = useState<DepositAssetsPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [flagBusyKey, setFlagBusyKey] = useState<string | null>(null)

  const { data: kpis, loading: kpisLoading } = useDashboardKPIs()
  const { data: charts, loading: chartsLoading, error: chartsError } = useDashboardCharts(
    chartPeriod,
    customStart,
    customEnd,
  )
  const { data: casinoAnalytics, loading: casinoAnalyticsLoading } = useCasinoAnalytics(
    chartPeriod,
    customStart,
    customEnd,
  )
  const selectedPeriod = periodLabel(chartPeriod)

  const depWd = useMemo(() => {
    if (!charts) return null
    return alignTwoDailyTotals(
      charts.deposits_by_day.map((d) => ({ date: d.date, total_minor: d.total_minor })),
      charts.withdrawals_by_day.map((d) => ({ date: d.date, total_minor: d.total_minor })),
    )
  }, [charts])

  const ggrDates = charts?.ggr_by_day.map((d) => d.date) ?? []
  const ggrValues = charts?.ggr_by_day.map((d) => d.ggr_minor) ?? []

  const dailyTxnRows = useMemo(() => {
    if (!charts) return []
    const depMap = new Map(charts.deposits_by_day.map((d) => [d.date, d.count]))
    const wdMap = new Map(charts.withdrawals_by_day.map((d) => [d.date, d.count]))
    const dates = new Set<string>()
    charts.deposits_by_day.forEach((d) => dates.add(d.date))
    charts.withdrawals_by_day.forEach((d) => dates.add(d.date))
    return [...dates].sort().map((date) => ({
      date,
      dep: depMap.get(date) ?? 0,
      wd: wdMap.get(date) ?? 0,
    }))
  }, [charts])
  const selectedDeposits = charts?.deposits_by_day.reduce((n, row) => n + (row.total_minor ?? 0), 0) ?? 0
  const selectedWithdrawals =
    charts?.withdrawals_by_day.reduce((n, row) => n + (row.total_minor ?? 0), 0) ?? 0
  const selectedGGR = ggrValues.reduce((n, row) => n + row, 0)
  const selectedRegistrations = charts?.registrations_by_day.reduce((n, row) => n + (row.count ?? 0), 0) ?? 0
  const selectedFTD = casinoAnalytics?.kpis.ftd_count ?? 0
  const selectedDepositConv = casinoAnalytics?.kpis.reg_to_ftd_conversion_rate ?? 0
  const selectedAvgDeposit = casinoAnalytics?.kpis.avg_first_deposit_minor ?? 0
  const selectedActivePlayers = chartPeriod === '7d' ? (kpis?.active_players_7d ?? 0) : (kpis?.active_players_30d ?? 0)
  const selectedArpu = selectedActivePlayers > 0 ? selectedGGR / selectedActivePlayers : 0

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [sRes, fRes, dRes] = await Promise.all([
        apiFetch('/v1/admin/ops/summary'),
        apiFetch('/v1/admin/ops/payment-flags'),
        apiFetch('/v1/admin/ops/deposit-assets'),
      ])
      if (sRes.ok) {
        setSummary((await sRes.json()) as Summary)
      } else {
        setSummary(null)
      }
      if (fRes.ok) {
        setFlags((await fRes.json()) as PaymentFlags)
      } else {
        setFlags(null)
      }
      if (dRes.ok) {
        setDepositAssets((await dRes.json()) as DepositAssetsPayload)
      } else {
        setDepositAssets(null)
      }
    } catch {
      setErr('Failed to load ops data')
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = window.setInterval(() => void load(), 10_000)
    return () => window.clearInterval(t)
  }, [load])

  const isSuper = role === 'superadmin'

  const togglePaymentFlag = async (key: string, current: boolean) => {
    if (!isSuper) {
      toast.error('Superadmin required to change payment flags')
      return
    }
    setFlagBusyKey(key)
    try {
      const res = await apiFetch('/v1/admin/ops/payment-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: !current }),
      })
      if (!res.ok) {
        toast.error('Could not update payment flag')
        return
      }
      toast.success(`Updated ${FLAG_LABELS[key] ?? key}`)
      await load()
    } catch {
      toast.error('Network error updating flag')
    } finally {
      setFlagBusyKey(null)
    }
  }

  const processMetrics = summary?.process_metrics as Record<string, unknown> | undefined
  const summaryForTable = useMemo(() => {
    if (!summary) return null
    return Object.fromEntries(
      Object.entries(summary).filter(([key]) => key !== 'process_metrics'),
    ) as Record<string, unknown>
  }, [summary])

  const yMoney = (v: number) => formatCurrency(v)

  return (
    <>
      <PageMeta title="Finance · Admin" description="Deposits, withdrawals, liquidity, and payment controls" />
      <PageBreadcrumb
        pageTitle="Finance overview"
        subtitle="Cash movement, pipeline health, PassimPay / ledger configuration, and payment switches"
      />

      <DataTimeframeBar
        value={chartPeriod}
        onChange={setChartPeriod}
        options={FINANCE_PERIOD_OPTIONS}
        startDate={customStart}
        endDate={customEnd}
        onStartDateChange={setCustomStart}
        onEndDateChange={setCustomEnd}
      />

      {/* Finance + acquisition summary (mirrors dashboard money cards) */}
      <div className="row mb-3">
        <div className="col-xl-2 col-md-4 col-6 mb-3">
          {chartsLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label={`GGR (${selectedPeriod})`}
              value={formatCurrency(selectedGGR)}
              iconClass="bi bi-graph-up-arrow"
              variant="primary"
            />
          )}
        </div>
        <div className="col-xl-2 col-md-4 col-6 mb-3">
          {casinoAnalyticsLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label={`FTD (${selectedPeriod})`}
              value={formatCompact(selectedFTD)}
              iconClass="bi bi-cash-coin"
              variant="secondary"
            />
          )}
        </div>
        <div className="col-xl-2 col-md-4 col-6 mb-3">
          {casinoAnalyticsLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label={`Reg → FTD (${selectedPeriod})`}
              value={`${selectedDepositConv.toFixed(2)}%`}
              iconClass="bi bi-percent"
              variant="info"
            />
          )}
        </div>
        <div className="col-xl-2 col-md-4 col-6 mb-3">
          {casinoAnalyticsLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label={`Avg first deposit (${selectedPeriod})`}
              value={formatCurrency(selectedAvgDeposit)}
              iconClass="bi bi-bank"
              variant="success"
            />
          )}
        </div>
        <div className="col-xl-2 col-md-4 col-6 mb-3">
          {chartsLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label={`ARPU (${selectedPeriod === '7d' ? '7d' : '30d'})`}
              value={formatCurrency(selectedArpu)}
              iconClass="bi bi-currency-dollar"
              variant="warning"
            />
          )}
        </div>
        <div className="col-xl-2 col-md-4 col-6 mb-3">
          {chartsLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label={`New registrations (${selectedPeriod})`}
              value={formatCompact(selectedRegistrations)}
              iconClass="bi bi-person-plus"
              variant="danger"
            />
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="row mb-3">
        <div className="col-xl-3 col-md-6 mb-3 mb-xl-0">
          {kpisLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label={`Deposit volume (${selectedPeriod})`}
              value={formatCurrency(selectedDeposits)}
              iconClass="bi bi-arrow-down-circle"
              variant="success"
            />
          )}
        </div>
        <div className="col-xl-3 col-md-6 mb-3 mb-xl-0">
          {kpisLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label={`Withdrawal volume (${selectedPeriod})`}
              value={formatCurrency(selectedWithdrawals)}
              iconClass="bi bi-arrow-up-circle"
              variant="danger"
            />
          )}
        </div>
        <div className="col-xl-3 col-md-6 mb-3 mb-xl-0">
          {kpisLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label="Pending withdrawals"
              value={`${formatCurrency(kpis?.pending_withdrawals_value ?? 0)} · ${formatCompact(kpis?.pending_withdrawals_count ?? 0)}`}
              iconClass="bi bi-hourglass-split"
              variant="warning"
            />
          )}
        </div>
        <div className="col-xl-3 col-md-6">
          {kpisLoading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label={`Net cash flow (${selectedPeriod})`}
              value={formatCurrency(selectedDeposits - selectedWithdrawals)}
              iconClass="bi bi-graph-up-arrow"
              variant="info"
            />
          )}
        </div>
      </div>

      {kpis && kpis.pending_withdrawals_count > 0 ? (
        <div className="alert alert-warning d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
          <span>
            <strong>{formatCompact(kpis.pending_withdrawals_count)}</strong> withdrawal
            {kpis.pending_withdrawals_count === 1 ? '' : 's'} awaiting approval ({formatCurrency(kpis.pending_withdrawals_value)}).
          </span>
          <Link to="/withdrawal-approvals" className="btn btn-sm btn-warning">
            Open approval queue
          </Link>
        </div>
      ) : null}

      {/* Quick links */}
      <div className="card shadow-sm mb-4">
        <div className="card-header">
          <h3 className="card-title mb-0 fs-6">Data &amp; tools</h3>
          <p className="text-secondary small mb-0 mt-1">Jump to live tables and integrations</p>
        </div>
        <div className="card-body d-flex flex-wrap gap-2">
          <Link to="/deposits" className="btn btn-outline-primary btn-sm">
            Deposits
          </Link>
          <Link to="/withdrawals" className="btn btn-outline-primary btn-sm">
            Withdrawals
          </Link>
          <Link to="/ledger" className="btn btn-outline-primary btn-sm">
            Ledger
          </Link>
          <Link to="/withdrawal-approvals" className="btn btn-outline-secondary btn-sm">
            Withdrawal approvals
          </Link>
        </div>
      </div>

      {/* Charts */}
      <div className="row">
        <div className="col-lg-6 mb-4">
          {chartsLoading ? (
            <div className="card shadow-sm mb-4">
              <div className="card-header">
                <span className="placeholder col-6" />
              </div>
              <div className="card-body">
                <ChartSkeleton />
              </div>
            </div>
          ) : chartsError && !charts ? (
            <ChartCard
              title="Cash in vs cash out (daily)"
              periods={[...CHART_PERIODS]}
              activePeriod={chartPeriod}
              onPeriodChange={setChartPeriod}
            >
              <ChartEmpty message={`Could not load charts: ${chartsError}`} height={280} />
            </ChartCard>
          ) : (
            <ChartCard
              title="Cash in vs cash out (daily)"
              periods={[...CHART_PERIODS]}
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
        <div className="col-lg-6 mb-4">
          {chartsLoading ? (
            <div className="card shadow-sm mb-4">
              <div className="card-header">
                <span className="placeholder col-6" />
              </div>
              <div className="card-body">
                <ChartSkeleton />
              </div>
            </div>
          ) : chartsError && !charts ? (
            <ChartCard
              title="Gross gaming revenue (daily)"
              periods={[...CHART_PERIODS]}
              activePeriod={chartPeriod}
              onPeriodChange={setChartPeriod}
            >
              <ChartEmpty message={`Could not load charts: ${chartsError}`} height={280} />
            </ChartCard>
          ) : (
            <ChartCard
              title="Gross gaming revenue (daily)"
              periods={[...CHART_PERIODS]}
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
      </div>

      <div className="row mb-4">
        <div className="col-lg-6 mb-4 mb-lg-0">
          <div className="card shadow-sm h-100">
            <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div>
                <h3 className="card-title mb-0 fs-6">Daily deposit transactions</h3>
                <p className="text-secondary small mb-0 mt-1">Count per day (same period as charts)</p>
              </div>
            </div>
            <div className="card-body p-0">
              {chartsLoading || !charts ? (
                <div className="p-3">
                  <div className="placeholder-glow rounded bg-body-secondary w-100" style={{ height: 200 }} />
                </div>
              ) : (
                <div className="table-responsive" style={{ maxHeight: 280 }}>
                  <table className="table table-sm table-striped table-hover align-middle mb-0">
                    <thead className="table-light sticky-top">
                      <tr>
                        <th>Date</th>
                        <th className="text-end">Deposits</th>
                        <th className="text-end">Withdrawals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyTxnRows.map((row) => (
                        <tr key={row.date}>
                          <td className="font-monospace small">{row.date}</td>
                          <td className="text-end small">{formatCompact(row.dep)}</td>
                          <td className="text-end small">{formatCompact(row.wd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="col-lg-6">
          <div className="card shadow-sm h-100">
            <div className="card-header">
              <h3 className="card-title mb-0 fs-6">Pipeline summary</h3>
              <p className="text-secondary small mb-0 mt-1">Operational counters (refreshed every 10s)</p>
            </div>
            <div className="card-body py-0">
              {err ? <p className="text-danger small py-3 mb-0">{err}</p> : null}
              {!summaryForTable || Object.keys(summaryForTable).length === 0 ? (
                <p className="text-secondary small py-3 mb-0">No summary loaded.</p>
              ) : (
                <>
                  <MetricRow
                    label="Payment callbacks pending"
                    value={String(summaryForTable.webhook_deliveries_pending ?? '—')}
                    subValue={
                      <Link to="/finance" className="link-primary small">
                        Finance overview
                      </Link>
                    }
                    trailing={
                      <StatusBadge
                        label={Number(summaryForTable.webhook_deliveries_pending) > 0 ? 'Backlog' : 'Clear'}
                        variant={Number(summaryForTable.webhook_deliveries_pending) > 0 ? 'warning' : 'success'}
                        dot
                      />
                    }
                  />
                  <MetricRow
                    label="Withdrawals in flight"
                    value={String(summaryForTable.withdrawals_in_flight ?? '—')}
                    subValue={
                      <Link to="/withdrawals" className="link-primary small">
                        Withdrawals table
                      </Link>
                    }
                  />
                  <MetricRow
                    label="Ledger entries (total rows)"
                    value={String(summaryForTable.ledger_entries_total ?? '—')}
                    subValue={
                      <Link to="/ledger" className="link-primary small">
                        Ledger
                      </Link>
                    }
                  />
                  <MetricRow
                    label="Worker failures (unresolved)"
                    value={String(summaryForTable.worker_failed_jobs_unresolved ?? '—')}
                    subValue={
                      <Link to="/bonushub/operations?tab=failed_jobs" className="link-primary small">
                        Failed jobs
                      </Link>
                    }
                    trailing={
                      <StatusBadge
                        label={Number(summaryForTable.worker_failed_jobs_unresolved) > 0 ? 'Action' : 'Clear'}
                        variant={Number(summaryForTable.worker_failed_jobs_unresolved) > 0 ? 'error' : 'success'}
                        dot
                      />
                    }
                  />
                  <MetricRow
                    label="Bonus outbox pending"
                    value={String(summaryForTable.bonus_outbox_pending_delivery ?? '—')}
                    subValue={
                      <Link to="/bonushub/bonus-audit?tab=outbox" className="link-primary small">
                        Compliance → Outbox
                      </Link>
                    }
                  />
                  <MetricRow
                    label="Bonus outbox DLQ"
                    value={String(summaryForTable.bonus_outbox_dead_letter ?? '—')}
                    subValue={
                      <Link to="/bonushub/bonus-audit?tab=outbox&outbox=dlq" className="link-primary small">
                        DLQ filter
                      </Link>
                    }
                  />
                  <MetricRow
                    label="Redis job queue depth"
                    value={
                      summaryForTable.redis_queue_depth != null
                        ? String(summaryForTable.redis_queue_depth)
                        : '—'
                    }
                    subValue="casino:jobs"
                  />
                </>
              )}
              <div className="d-flex flex-wrap align-items-center gap-2 py-3 border-top">
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => void load()}>
                  Refresh now
                </button>
                <span className="text-secondary small">Auto-refresh every 10s</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {processMetrics && Object.keys(processMetrics).length > 0 ? (
        <div className="card shadow-sm mb-4">
          <div className="card-header">
            <h3 className="card-title mb-0 fs-6">Process metrics</h3>
            <p className="text-secondary small mb-0 mt-1">In-process counters (SLI stubs)</p>
          </div>
          <div className="card-body">
            <ApiResultSummary data={processMetrics} embedded />
          </div>
        </div>
      ) : null}

      <div className="card shadow-sm mb-4">
        <div className="card-header">
          <h3 className="card-title mb-0 fs-6">On-chain deposit asset keys</h3>
          <p className="text-secondary small mb-0 mt-1">
            PassimPay currency rows (payment_currencies) — canonical keys for cashier / challenges (read-only)
          </p>
        </div>
        <div className="card-body p-0">
          {depositAssets?.configured && Object.keys(depositAssets.configured).length > 0 ? (
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">Asset key</th>
                    <th scope="col" className="text-end">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(depositAssets.configured)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([key, ok]) => (
                      <tr key={key}>
                        <td>
                          <code className="small">{key}</code>
                        </td>
                        <td className="text-end">
                          <span className={`badge ${ok ? 'text-bg-success' : 'text-bg-secondary'}`}>
                            {ok ? 'Configured' : 'Not set'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-secondary small mb-0 p-3">Could not load deposit-asset snapshot.</p>
          )}
        </div>
      </div>

      <div className="card shadow-sm mb-4">
        <div className="card-header">
          <h3 className="card-title mb-0 fs-6">Payment flags</h3>
          <p className="text-secondary small mb-0 mt-1">Runtime switches — changes are audited (superadmin only)</p>
        </div>
        <div className="card-body">
          {flags ? (
            <ul className="list-group list-group-flush border rounded overflow-hidden">
              {(
                [
                  ['deposits_enabled', flags.deposits_enabled],
                  ['withdrawals_enabled', flags.withdrawals_enabled],
                  ['real_play_enabled', flags.real_play_enabled],
                  ['bonuses_enabled', flags.bonuses_enabled ?? true],
                  ['automated_grants_enabled', flags.automated_grants_enabled ?? true],
                ] as const
              ).map(([key, val]) => (
                <li
                  key={key}
                  className="list-group-item d-flex align-items-center justify-content-between gap-3 flex-wrap"
                >
                  <div className="d-flex align-items-center gap-2 min-w-0">
                    <span className="fw-medium text-break">{FLAG_LABELS[key] ?? key}</span>
                    <StatusBadge label={val ? 'On' : 'Off'} variant={val ? 'success' : 'error'} dot />
                  </div>
                  <div className="form-check form-switch mb-0">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      role="switch"
                      id={`flag-${key}`}
                      checked={!!val}
                      disabled={flagBusyKey === key || !isSuper}
                      onChange={() => void togglePaymentFlag(key, !!val)}
                      aria-label={`Toggle ${FLAG_LABELS[key] ?? key}`}
                    />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-secondary small mb-0">Flags unavailable.</p>
          )}
          {!isSuper ? (
            <p className="text-warning small mb-0 mt-3">Superadmin role required to edit payment flags.</p>
          ) : null}
        </div>
      </div>

    </>
  )
}
