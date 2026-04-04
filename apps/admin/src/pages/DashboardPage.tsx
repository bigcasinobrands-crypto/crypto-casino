import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

export default function DashboardPage() {
  return (
    <>
      <PageMeta title="Dashboard · Admin" description="Crypto Casino staff dashboard" />
      <PageBreadcrumb pageTitle="Dashboard" />
      <ComponentCard
        title="Overview"
        desc="TailAdmin layout, sidebar, and header are wired to your Go admin API."
      >
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Use the sidebar for <strong className="text-gray-800 dark:text-white/90">Players</strong>,{' '}
          <strong className="text-gray-800 dark:text-white/90">Ledger</strong>, and{' '}
          <strong className="text-gray-800 dark:text-white/90">Integrations</strong>. Data views call{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-brand-600 dark:bg-white/10 dark:text-brand-400">
            /v1/admin/*
          </code>{' '}
          with your session token.
        </p>
      </ComponentCard>
    </>
  )
}
