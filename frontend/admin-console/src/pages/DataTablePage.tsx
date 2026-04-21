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

  const isWithdrawal = path.includes('fystack-wd')

  if (isWithdrawal) {
    return (
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Withdrawal Volume (24h)" value={formatCurrency(kpis.withdrawals_24h)} />
        <StatCard label="Withdrawals (24h)" value={formatCompact(kpis.withdrawals_count_24h)} />
        <StatCard label="Pending Value" value={formatCurrency(kpis.pending_withdrawals_value)} />
      </div>
    )
  }

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <StatCard label="Deposit Volume (24h)" value={formatCurrency(kpis.deposits_24h)} />
      <StatCard label="Deposits (24h)" value={formatCompact(kpis.deposits_count_24h)} />
      <StatCard label="Avg Deposit Size" value={formatCurrency(kpis.avg_deposit_size_30d)} />
    </div>
  )
}

export default function DataTablePage({ title, path, refreshIntervalMs }: Props) {
  const { apiFetch } = useAdminAuth()
  const showStats = path.includes('fystack')

  return (
    <>
      <PageMeta title={`${title} · Admin`} description={`Admin data: ${title}`} />
      <PageBreadcrumb pageTitle={title} />
      {showStats && <FystackStatCards path={path} />}
      <ComponentCard title={title} desc={`GET ${path}`}>
        <AdminDataTable apiPath={path} apiFetch={apiFetch} refreshIntervalMs={refreshIntervalMs} />
      </ComponentCard>
    </>
  )
}
