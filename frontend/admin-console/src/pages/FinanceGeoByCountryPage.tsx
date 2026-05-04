import { useMemo, useState } from 'react'
import PageMeta from '../components/common/PageMeta'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import { StatCard } from '../components/dashboard'
import DataTimeframeBar from '../components/dashboard/DataTimeframeBar'
import { useFinanceGeo } from '../hooks/useFinanceGeo'
import { formatCurrency } from '../lib/format'
import { flagEmoji } from '../lib/countryIsoList'

const PERIOD_OPTIONS = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: '6m', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
] as const

export default function FinanceGeoByCountryPage() {
  const [period, setPeriod] = useState<string>('30d')
  const [start, setStart] = useState<string>('')
  const [end, setEnd] = useState<string>('')
  const { data, loading, error } = useFinanceGeo(
    period as '7d' | '30d' | '90d' | '6m' | 'ytd' | 'all' | 'custom',
    start,
    end,
  )

  const rows = useMemo(() => data?.rows ?? [], [data])

  const totals = useMemo(() => {
    let dep = 0
    let wdr = 0
    for (const r of rows) {
      dep += r.deposits_minor
      wdr += r.withdrawals_minor
    }
    return { dep, wdr }
  }, [rows])

  return (
    <>
      <PageMeta title="Finance by country · Admin" description="Deposits and withdrawals by resolved country" />
      <PageBreadcrumb
        pageTitle="Finance by country"
        subtitle="Ledger volumes attributed via Fingerprint geo on ledger lines, optional keys, or lobby traffic_sessions fallback"
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

      {data?.notes ? (
        <div className="alert alert-secondary small mb-3 mb-md-4" role="note">
          {data.notes}
        </div>
      ) : null}

      {data?.coverage ? (
        <div className="row mb-4">
          <div className="col-xl-3 col-md-6 mb-3 mb-xl-0">
            <StatCard
              label="Country resolved"
              value={`${data.coverage.country_resolved_pct.toFixed(1)}%`}
              iconClass="bi bi-globe"
              variant="info"
            />
          </div>
          <div className="col-xl-3 col-md-6 mb-3 mb-xl-0">
            <StatCard
              label="FP on ledger lines"
              value={String(data.coverage.fingerprint_ledger_lines)}
              iconClass="bi bi-fingerprint"
              variant="primary"
            />
          </div>
          <div className="col-xl-3 col-md-6 mb-3 mb-xl-0">
            <StatCard
              label="Traffic fallback lines"
              value={String(data.coverage.traffic_session_lines)}
              iconClass="bi bi-router"
              variant="secondary"
            />
          </div>
          <div className="col-xl-3 col-md-6">
            <StatCard
              label="Unknown country lines"
              value={String(data.coverage.unknown_country_lines)}
              iconClass="bi bi-question-circle"
              variant="warning"
            />
          </div>
        </div>
      ) : null}

      <div className="row mb-4">
        <div className="col-md-6 mb-3 mb-md-0">
          <StatCard
            label="Σ Deposits (raw minor, mixed currencies)"
            value={formatCurrency(totals.dep)}
            iconClass="bi bi-arrow-down-circle"
            variant="success"
          />
        </div>
        <div className="col-md-6">
          <StatCard
            label="Σ Withdrawals (raw minor, mixed currencies)"
            value={formatCurrency(totals.wdr)}
            iconClass="bi bi-arrow-up-circle"
            variant="danger"
          />
        </div>
      </div>
      <p className="small text-secondary mb-4">
        Net flow is meaningful per currency in the table below; headline totals are not FX-normalized.
      </p>

      <div className="card shadow-sm">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <h3 className="card-title mb-0 fs-6">By country × currency</h3>
          <span className="text-secondary small">
            Period: <strong>{data?.period ?? '—'}</strong>
          </span>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-sm table-striped table-hover mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>Country</th>
                  <th>CCY</th>
                  <th className="text-end">Deposits</th>
                  <th className="text-end">Withdrawals</th>
                  <th className="text-end">Net</th>
                  <th className="text-end">#Dep</th>
                  <th className="text-end">#Wdr</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center text-secondary py-4">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-secondary py-4">
                      No deposit or withdrawal ledger lines in this window.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.iso2}-${row.currency}`}>
                      <td>
                        <span className="me-1">{row.iso2 === 'ZZ' ? '🌐' : flagEmoji(row.iso2)}</span>
                        <span className="fw-medium">{row.name}</span>
                        <span className="text-secondary small ms-1">({row.iso2})</span>
                      </td>
                      <td className="font-monospace small">{row.currency}</td>
                      <td className="text-end">{formatCurrency(row.deposits_minor)}</td>
                      <td className="text-end">{formatCurrency(row.withdrawals_minor)}</td>
                      <td className="text-end">{formatCurrency(row.net_minor)}</td>
                      <td className="text-end small text-secondary">{row.deposit_lines}</td>
                      <td className="text-end small text-secondary">{row.withdrawal_lines}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
