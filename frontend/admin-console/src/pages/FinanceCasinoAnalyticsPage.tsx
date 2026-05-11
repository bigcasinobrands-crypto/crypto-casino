import { useMemo, useState } from 'react'
import PageMeta from '../components/common/PageMeta'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import { AreaChart, CHART_COLORS, ChartCard, StatCard } from '../components/dashboard'
import { useCasinoAnalytics } from '../hooks/useCasinoAnalytics'
import { formatCurrency } from '../lib/format'
import DataTimeframeBar from '../components/dashboard/DataTimeframeBar'

const PERIOD_OPTIONS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
] as const

export default function FinanceCasinoAnalyticsPage() {
  const [period, setPeriod] = useState<string>('30d')
  const [start, setStart] = useState<string>('')
  const [end, setEnd] = useState<string>('')
  const { data, loading, error } = useCasinoAnalytics(period, start, end)

  const dates = useMemo(() => data?.timeseries.map((d) => d.date) ?? [], [data])
  const ftdSeries = useMemo(() => data?.timeseries.map((d) => d.ftd_count) ?? [], [data])
  const convSeries = useMemo(() => data?.timeseries.map((d) => d.ftd_conversion) ?? [], [data])

  return (
    <>
      <PageMeta title="Casino analytics · Admin" description="FTD, conversion and earning behavior metrics" />
      <PageBreadcrumb
        pageTitle="Casino analytics"
        subtitle="Acquisition, FTD conversion, repeat deposits, and monetization quality"
      />

      <DataTimeframeBar
        value={period}
        onChange={setPeriod}
        options={[...PERIOD_OPTIONS]}
        startDate={start}
        endDate={end}
        onStartDateChange={setStart}
        onEndDateChange={setEnd}
      />

      {error ? <div className="alert alert-danger">{error}</div> : null}

      <div className="row mb-4">
        <div className="col-xl-3 col-md-6 mb-3 mb-xl-0">
          <StatCard label="FTD count" value={String(data?.kpis.ftd_count ?? 0)} iconClass="bi bi-person-plus" variant="info" />
        </div>
        <div className="col-xl-3 col-md-6 mb-3 mb-xl-0">
          <StatCard
            label="Registration → FTD"
            value={`${(data?.kpis.reg_to_ftd_conversion_rate ?? 0).toFixed(2)}%`}
            iconClass="bi bi-funnel"
            variant="success"
          />
        </div>
        <div className="col-xl-3 col-md-6 mb-3 mb-xl-0">
          <StatCard
            label="Repeat deposit D30"
            value={`${(data?.kpis.repeat_deposit_d30_rate ?? 0).toFixed(2)}%`}
            iconClass="bi bi-arrow-repeat"
            variant="warning"
          />
        </div>
        <div className="col-xl-3 col-md-6">
          <StatCard
            label="NGR"
            value={formatCurrency(data?.kpis?.ngr_total ?? data?.kpis?.ngr_proxy_minor ?? 0)}
            iconClass="bi bi-cash-stack"
            variant="primary"
          />
        </div>
      </div>

      <div className="row">
        <div className="col-lg-6 mb-4">
          <ChartCard title="FTD per day" periods={[]} activePeriod="" onPeriodChange={() => {}}>
            {loading ? (
              <div className="placeholder-glow rounded bg-body-secondary w-100" style={{ height: 280 }} />
            ) : (
              <AreaChart
                series={[{ name: 'FTD', data: ftdSeries, color: CHART_COLORS.primary }]}
                categories={dates}
              />
            )}
          </ChartCard>
        </div>
        <div className="col-lg-6 mb-4">
          <ChartCard title="FTD conversion rate (daily)" periods={[]} activePeriod="" onPeriodChange={() => {}}>
            {loading ? (
              <div className="placeholder-glow rounded bg-body-secondary w-100" style={{ height: 280 }} />
            ) : (
              <AreaChart
                series={[{ name: 'FTD conversion %', data: convSeries, color: CHART_COLORS.success }]}
                categories={dates}
                yFormatter={(v) => `${v.toFixed(2)}%`}
              />
            )}
          </ChartCard>
        </div>
      </div>
    </>
  )
}

