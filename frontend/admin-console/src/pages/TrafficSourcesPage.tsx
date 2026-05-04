import { useState } from 'react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/common/PageMeta'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import { BarChart, StatCard } from '../components/dashboard'
import { CHART_COLORS } from '../components/dashboard'
import type { TrafficChannelRow } from '../lib/trafficAnalytics'
import { useTrafficAnalytics, type TrafficPeriod } from '../hooks/useTrafficAnalytics'
import { formatCompact } from '../lib/format'
import DataTimeframeBar from '../components/dashboard/DataTimeframeBar'

const PERIOD_OPTIONS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

export default function TrafficSourcesPage() {
  const [period, setPeriod] = useState<TrafficPeriod>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const { data, loading, error, refetch } = useTrafficAnalytics(period, customStart, customEnd)

  const topChannel = (data?.channels ?? []).reduce<TrafficChannelRow | null>(
    (best, c) => (!best || c.sessions > best.sessions ? c : best),
    null,
  )
  const socialSessionsTotal = (data?.social_platforms ?? []).reduce((n, s) => n + s.sessions, 0)
  const utmTaggedSessions = (data?.utm_campaigns ?? []).reduce((n, u) => n + u.sessions, 0)

  const channelLabels = (data?.channels ?? []).map((c) => c.channel)
  const channelSessions = (data?.channels ?? []).map((c) => c.sessions)

  return (
    <>
      <PageMeta
        title="Traffic sources · Admin"
        description="Channels, social platforms, referrers, and UTM campaigns"
      />
      <PageBreadcrumb
        pageTitle="Traffic sources & attribution"
        subtitle="How players discover the brand — search, social, affiliates, and tagged campaigns"
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
              iconClass="bi bi-graph-up-arrow"
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
              label={topChannel ? `Top channel · ${topChannel.channel}` : 'Top channel'}
              value={topChannel ? formatCompact(topChannel.sessions) : '—'}
              iconClass="bi bi-funnel"
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
              label="Social & creator"
              value={formatCompact(socialSessionsTotal)}
              iconClass="bi bi-share"
              variant="danger"
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
              label="UTM-tagged sessions"
              value={formatCompact(utmTaggedSessions)}
              iconClass="bi bi-tag"
              variant="info"
            />
          )}
        </div>
      </div>

      <DataTimeframeBar
        value={period}
        onChange={(next) => setPeriod(next as TrafficPeriod)}
        options={PERIOD_OPTIONS}
        startDate={customStart}
        endDate={customEnd}
        onStartDateChange={setCustomStart}
        onEndDateChange={setCustomEnd}
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
        <div className="col-lg-6 mb-3 mb-lg-0">
          <div className="card shadow-sm h-100">
            <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h3 className="card-title mb-0 fs-6">Acquisition channels</h3>
              <Link to="/analytics/demographics" className="btn btn-sm btn-outline-secondary">
                Geo overview
              </Link>
            </div>
            <div className="card-body">
              {loading ? (
                <div className="placeholder-glow rounded bg-body-secondary" style={{ height: 320 }} />
              ) : data && channelLabels.length > 0 ? (
                <BarChart
                  labels={channelLabels}
                  data={channelSessions}
                  color={CHART_COLORS.primary}
                  horizontal
                  height={340}
                  yFormatter={(v) => formatCompact(v)}
                />
              ) : (
                <p className="text-secondary small mb-0">No channel data.</p>
              )}
            </div>
          </div>
        </div>
        <div className="col-lg-6">
          <div className="card shadow-sm h-100">
            <div className="card-header">
              <h3 className="card-title mb-0 fs-6">Social & creator platforms</h3>
              <p className="text-secondary small mb-0 mt-1">Attributed social sessions</p>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Platform</th>
                      <th>Typical referrer host</th>
                      <th className="text-end">Sessions</th>
                      <th className="text-end">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.social_platforms ?? []).map((s) => (
                      <tr key={s.platform}>
                        <td className="fw-medium">{s.platform}</td>
                        <td>
                          <code className="small">{s.top_ref_host ?? '—'}</code>
                        </td>
                        <td className="text-end font-monospace small">{formatCompact(s.sessions)}</td>
                        <td className="text-end small">{s.pct_of_total.toFixed(1)}%</td>
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
          <h3 className="card-title mb-0 fs-6">Referring sites & properties</h3>
          <p className="text-secondary small mb-0 mt-1">
            Search engines, affiliates, and social referrers (sample classification)
          </p>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-striped table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Host</th>
                  <th>Category</th>
                  <th>Top landing</th>
                  <th className="text-end">Sessions</th>
                  <th className="text-end">%</th>
                </tr>
              </thead>
              <tbody>
                {(data?.referrers ?? []).map((r) => (
                  <tr key={r.host}>
                    <td>
                      <code>{r.host}</code>
                    </td>
                    <td>
                      <span className="badge text-bg-secondary text-capitalize">{r.category}</span>
                    </td>
                    <td>
                      <code className="small">{r.top_landing_path ?? '—'}</code>
                    </td>
                    <td className="text-end font-monospace">{formatCompact(r.sessions)}</td>
                    <td className="text-end">{r.pct_of_total.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="row mb-4">
        <div className="col-lg-6 mb-3 mb-lg-0">
          <div className="card shadow-sm h-100">
            <div className="card-header">
              <h3 className="card-title mb-0 fs-6">UTM campaigns</h3>
              <p className="text-secondary small mb-0 mt-1">Source / medium / campaign / content</p>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>utm_source</th>
                      <th>utm_medium</th>
                      <th>utm_campaign</th>
                      <th>utm_content</th>
                      <th>utm_term</th>
                      <th className="text-end">Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.utm_campaigns ?? []).map((u, i) => (
                      <tr key={`${u.utm_campaign}-${i}`}>
                        <td>
                          <code className="small">{u.utm_source}</code>
                        </td>
                        <td>
                          <code className="small">{u.utm_medium}</code>
                        </td>
                        <td>
                          <code className="small">{u.utm_campaign}</code>
                        </td>
                        <td>
                          <code className="small">{u.utm_content ?? '—'}</code>
                        </td>
                        <td>
                          <code className="small">{u.utm_term ?? '—'}</code>
                        </td>
                        <td className="text-end font-monospace small">{formatCompact(u.sessions)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <div className="col-lg-6">
          <div className="card shadow-sm h-100">
            <div className="card-header">
              <h3 className="card-title mb-0 fs-6">Landing pages</h3>
              <p className="text-secondary small mb-0 mt-1">Entry paths and bounce proxy</p>
            </div>
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Path</th>
                      <th className="text-end">Sessions</th>
                      <th className="text-end">Bounce %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.landing_pages ?? []).map((l) => (
                      <tr key={l.path}>
                        <td>
                          <code>{l.path}</code>
                        </td>
                        <td className="text-end font-monospace small">{formatCompact(l.sessions)}</td>
                        <td className="text-end small">{l.bounce_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
