import AdminDataTable from '../components/admin/AdminDataTable'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { useAdminAuth } from '../authContext'
import { StatCard } from '../components/dashboard'
import { useDashboardKPIs } from '../hooks/useDashboard'
import { formatCurrency, formatCompact } from '../lib/format'

type Props = { title: string; path: string; refreshIntervalMs?: number }

function FystackStatCards({ path }: { path: string }) {
  const { data: kpis } = useDashboardKPIs()
  if (!kpis) return null

  const isWithdrawal = path.includes('withdrawals') && path.includes('fystack')

  if (isWithdrawal) {
    return (
      <div className="row mb-3">
        <div className="col-md-4 mb-3 mb-md-0">
          <StatCard
            label="Withdrawal volume (24h)"
            value={formatCurrency(kpis.withdrawals_24h)}
            iconClass="bi bi-arrow-up-circle"
            variant="danger"
          />
        </div>
        <div className="col-md-4 mb-3 mb-md-0">
          <StatCard
            label="Withdrawal count (24h)"
            value={formatCompact(kpis.withdrawals_count_24h)}
            iconClass="bi bi-list-ol"
            variant="secondary"
          />
        </div>
        <div className="col-md-4">
          <StatCard
            label="Pending withdrawal value"
            value={formatCurrency(kpis.pending_withdrawals_value)}
            iconClass="bi bi-hourglass-split"
            variant="warning"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="row mb-3">
      <div className="col-md-4 mb-3 mb-md-0">
        <StatCard
          label="Deposit volume (24h)"
          value={formatCurrency(kpis.deposits_24h)}
          iconClass="bi bi-arrow-down-circle"
          variant="success"
        />
      </div>
      <div className="col-md-4 mb-3 mb-md-0">
        <StatCard
          label="Deposit count (24h)"
          value={formatCompact(kpis.deposits_count_24h)}
          iconClass="bi bi-list-ol"
          variant="secondary"
        />
      </div>
      <div className="col-md-4">
        <StatCard
          label="Avg deposit size (30d)"
          value={formatCurrency(kpis.avg_deposit_size_30d)}
          iconClass="bi bi-bank"
          variant="info"
        />
      </div>
    </div>
  )
}

export default function DataTablePage({ title, path, refreshIntervalMs }: Props) {
  const { apiFetch } = useAdminAuth()
  const showStats = path.includes('fystack') || path.includes('integrations/fystack')
  const subtitle =
    path.includes('game-launches') || path.includes('game-disputes')
      ? 'Live rows from the admin API — search, sort, and export from the toolbar.'
      : path.includes('fystack') || path.includes('ledger')
        ? 'Live payment and ledger rows — refreshes on an interval when configured.'
        : undefined

  return (
    <>
      <PageMeta title={`${title} · Admin`} description={`Admin data: ${title}`} />
      <PageBreadcrumb pageTitle={title} subtitle={subtitle} />
      {showStats && <FystackStatCards path={path} />}
      <ComponentCard title={title} desc="Live data from the admin API. Search, sort, and export from the toolbar.">
        <AdminDataTable apiPath={path} apiFetch={apiFetch} refreshIntervalMs={refreshIntervalMs} />
      </ComponentCard>
    </>
  )
}
