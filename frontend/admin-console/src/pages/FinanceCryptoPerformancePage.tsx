import { useMemo, useState } from 'react'
import PageMeta from '../components/common/PageMeta'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import { StatCard } from '../components/dashboard'
import { useCryptoChainSummary } from '../hooks/useCasinoAnalytics'
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

export default function FinanceCryptoPerformancePage() {
  const [period, setPeriod] = useState<string>('30d')
  const [start, setStart] = useState<string>('')
  const [end, setEnd] = useState<string>('')
  const { data, loading, error } = useCryptoChainSummary(period, start, end)

  const rows = useMemo(() => data?.items ?? [], [data])

  return (
    <>
      <PageMeta title="Crypto performance · Admin" description="Chain and asset level finance performance" />
      <PageBreadcrumb
        pageTitle="Crypto & chain performance"
        subtitle="USDT settlement totals with chain and asset level operational detail"
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
        <div className="col-xl-4 col-md-6 mb-3 mb-xl-0">
          <StatCard
            label="Gross inflow"
            value={formatCurrency(data?.summary.gross_inflow_minor ?? 0)}
            iconClass="bi bi-arrow-down-circle"
            variant="success"
          />
        </div>
        <div className="col-xl-4 col-md-6 mb-3 mb-xl-0">
          <StatCard
            label="Gross outflow"
            value={formatCurrency(data?.summary.gross_outflow_minor ?? 0)}
            iconClass="bi bi-arrow-up-circle"
            variant="danger"
          />
        </div>
        <div className="col-xl-4 col-md-6">
          <StatCard
            label="Net flow"
            value={formatCurrency(data?.summary.net_flow_minor ?? 0)}
            iconClass="bi bi-graph-up-arrow"
            variant="info"
          />
        </div>
      </div>

      <div className="card shadow-sm">
        <div className="card-header">
          <h3 className="card-title mb-0 fs-6">By chain / asset</h3>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-sm table-striped table-hover mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>Chain</th>
                  <th>Asset</th>
                  <th className="text-end">Deposit volume</th>
                  <th className="text-end">Withdrawal volume</th>
                  <th className="text-end">Net flow</th>
                  <th className="text-end">Deposits</th>
                  <th className="text-end">Withdrawals</th>
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
                      No rows for selected timeframe.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={`${row.chain}-${row.asset}`}>
                      <td>{row.chain}</td>
                      <td>{row.asset}</td>
                      <td className="text-end">{formatCurrency(row.deposit_volume_minor)}</td>
                      <td className="text-end">{formatCurrency(row.withdrawal_volume_minor)}</td>
                      <td className="text-end">{formatCurrency(row.net_flow_minor)}</td>
                      <td className="text-end">{row.deposit_count}</td>
                      <td className="text-end">{row.withdrawal_count}</td>
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

