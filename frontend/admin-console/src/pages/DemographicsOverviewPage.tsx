import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import PageMeta from '../components/common/PageMeta'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import WorldSessionsMap from '../components/analytics/WorldSessionsMap'
import { StatCard } from '../components/dashboard'
import { useBootstrapTooltip } from '../hooks/useBootstrapTooltip'
import { useTrafficAnalytics, type TrafficPeriod } from '../hooks/useTrafficAnalytics'
import { buildAnalyticsTimeframeSearch, parseTrafficPeriodParam } from '../lib/analyticsTimeframeQuery'
import { formatCompact } from '../lib/format'
import DataTimeframeBar from '../components/dashboard/DataTimeframeBar'

const WORLD_MAP_TOOLTIP =
  'Choropleth uses ISO country codes from your traffic_sessions data. Darker fill = more sessions in the selected period. Registrations in the side table are new sign-ups attributed to each country when available.'
const PERIOD_OPTIONS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}m ${s}s`
}

export default function DemographicsOverviewPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [period, setPeriod] = useState<TrafficPeriod>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const { data, loading, error, refetch } = useTrafficAnalytics(period, customStart, customEnd)
  const worldMapTitleRef = useBootstrapTooltip<HTMLHeadingElement>(WORLD_MAP_TOOLTIP)

  useEffect(() => {
    setPeriod(parseTrafficPeriodParam(searchParams.get('period')))
    setCustomStart(searchParams.get('start') ?? '')
    setCustomEnd(searchParams.get('end') ?? '')
  }, [searchParams])

  const pushTimeframeToUrl = useCallback(
    (p: TrafficPeriod, start: string, end: string) => {
      const qs = buildAnalyticsTimeframeSearch(p, start, end)
      setSearchParams(new URLSearchParams(qs), { replace: true })
    },
    [setSearchParams],
  )

  return (
    <>
      <PageMeta
        title="Demographics & geo · Admin"
        description="Visitor geography, devices, and country mix"
      />
      <PageBreadcrumb
        pageTitle="Demographics & geography"
        subtitle="Where players arrive from, device mix, and top countries"
        trail={[{ label: 'Analytics', to: '/analytics' }]}
      />

      <div className="row mb-3">
        <div className="col-md-6 col-xl-3 mb-3 mb-xl-0">
          {loading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label="Sessions (period)"
              value={formatCompact(data?.sessions_total ?? 0)}
              iconClass="bi bi-eye"
              variant="primary"
            />
          )}
        </div>
        <div className="col-md-6 col-xl-3 mb-3 mb-xl-0">
          {loading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label="Unique visitors"
              value={formatCompact(data?.unique_visitors ?? 0)}
              iconClass="bi bi-people"
              variant="success"
            />
          )}
        </div>
        <div className="col-md-6 col-xl-3 mb-3 mb-xl-0">
          {loading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label="New visitors"
              value={`${(data?.new_visitors_pct ?? 0).toFixed(1)}%`}
              iconClass="bi bi-person-plus"
              variant="info"
            />
          )}
        </div>
        <div className="col-md-6 col-xl-3">
          {loading ? (
            <div className="small-box text-bg-secondary placeholder-glow">
              <div className="inner">
                <h3 className="placeholder col-8" />
                <p className="placeholder col-10" />
              </div>
            </div>
          ) : (
            <StatCard
              label="Avg session"
              value={formatDuration(data?.avg_session_seconds ?? 0)}
              iconClass="bi bi-stopwatch"
              variant="warning"
            />
          )}
        </div>
      </div>

      <DataTimeframeBar
        value={period}
        onChange={(next) => {
          const p = next as TrafficPeriod
          setPeriod(p)
          if (p === 'custom') {
            pushTimeframeToUrl('custom', customStart, customEnd)
          } else {
            pushTimeframeToUrl(p, '', '')
          }
        }}
        options={PERIOD_OPTIONS}
        startDate={customStart}
        endDate={customEnd}
        onStartDateChange={(v) => {
          setCustomStart(v)
          if (period === 'custom') pushTimeframeToUrl('custom', v, customEnd)
        }}
        onEndDateChange={(v) => {
          setCustomEnd(v)
          if (period === 'custom') pushTimeframeToUrl('custom', customStart, v)
        }}
        trailing={
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={loading}
            onClick={() => void refetch()}
            title="Reload analytics from the API"
          >
            <i className={`bi bi-arrow-clockwise me-1 ${loading ? 'opacity-50' : ''}`} aria-hidden />
            Refresh
          </button>
        }
      />

      {error ? (
        <div className="alert alert-warning d-flex align-items-center justify-content-between flex-wrap gap-2">
          <span>Could not load analytics: {error}</span>
          <button type="button" className="btn btn-sm btn-outline-dark" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="row mb-4">
        <div className="col-xl-8 mb-3 mb-xl-0">
          <div className="card shadow-sm h-100">
            <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
              <h3 ref={worldMapTitleRef} className="card-title mb-0 fs-6 cursor-help" tabIndex={0}>
                World map · sessions by country
              </h3>
              <Link
                to={
                  searchParams.toString()
                    ? {
                        pathname: '/analytics/traffic-sources',
                        search: `?${searchParams.toString()}`,
                      }
                    : '/analytics/traffic-sources'
                }
                className="btn btn-sm btn-outline-primary"
              >
                Traffic sources
              </Link>
            </div>
            <div className="card-body pt-3">
              {loading ? (
                <div className="placeholder-glow rounded bg-body-secondary" style={{ height: 320 }} />
              ) : data ? (
                <WorldSessionsMap countries={data.countries} height={340} />
              ) : null}
            </div>
          </div>
        </div>
        <div className="col-xl-4">
          <div className="card shadow-sm h-100">
            <div className="card-header">
              <h3 className="card-title mb-0 fs-6">Top countries</h3>
              <p className="text-secondary small mb-0 mt-1">Sessions and new registrations</p>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive" style={{ maxHeight: 420 }}>
                <table className="table table-sm table-striped table-hover align-middle mb-0">
                  <thead className="table-light sticky-top">
                    <tr>
                      <th>Country</th>
                      <th className="text-end">Sessions</th>
                      <th className="text-end">%</th>
                      <th className="text-end">Regs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.countries ?? []).map((c) => (
                      <tr key={c.iso2}>
                        <td>
                          <span className="fw-medium">{c.name}</span>
                          <span className="text-secondary small ms-1">({c.iso2})</span>
                        </td>
                        <td className="text-end font-monospace small">{formatCompact(c.sessions)}</td>
                        <td className="text-end small">{c.pct_of_total.toFixed(1)}%</td>
                        <td className="text-end font-monospace small">{formatCompact(c.registrations)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card shadow-sm mb-4">
        <div className="card-header">
          <h3 className="card-title mb-0 fs-6">Device & form factor</h3>
        </div>
        <div className="card-body">
          {loading || !data ? (
            <p className="text-secondary small mb-0">Loading…</p>
          ) : (
            <>
              <div className="mb-3">
                <div className="d-flex justify-content-between small mb-1">
                  <span>Mobile</span>
                  <span className="fw-medium">{data.technology.mobile_pct.toFixed(1)}%</span>
                </div>
                <div className="progress" style={{ height: 8 }}>
                  <div
                    className="progress-bar bg-primary"
                    style={{ width: `${data.technology.mobile_pct}%` }}
                  />
                </div>
              </div>
              <div className="mb-3">
                <div className="d-flex justify-content-between small mb-1">
                  <span>Desktop</span>
                  <span className="fw-medium">{data.technology.desktop_pct.toFixed(1)}%</span>
                </div>
                <div className="progress" style={{ height: 8 }}>
                  <div
                    className="progress-bar bg-success"
                    style={{ width: `${data.technology.desktop_pct}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="d-flex justify-content-between small mb-1">
                  <span>Tablet</span>
                  <span className="fw-medium">{data.technology.tablet_pct.toFixed(1)}%</span>
                </div>
                <div className="progress" style={{ height: 8 }}>
                  <div
                    className="progress-bar bg-info"
                    style={{ width: `${data.technology.tablet_pct}%` }}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
