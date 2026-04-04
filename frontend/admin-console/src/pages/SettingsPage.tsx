import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

export default function SettingsPage() {
  return (
    <>
      <PageMeta title="Settings · Admin" description="Staff admin settings and ops notes" />
      <PageBreadcrumb pageTitle="Settings" />
      <ComponentCard title="Environment & workers" desc="Core API configuration">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Integrations: set{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-brand-600 dark:bg-white/10 dark:text-brand-400">
            WEBHOOK_*
          </code>{' '}
          and{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-brand-600 dark:bg-white/10 dark:text-brand-400">
            REDIS_URL
          </code>{' '}
          on the API. Run{' '}
          <code className="rounded bg-gray-100 px-1 py-0.5 text-xs text-brand-600 dark:bg-white/10 dark:text-brand-400">
            cmd/worker
          </code>{' '}
          for async webhook settlement.
        </p>
      </ComponentCard>
    </>
  )
}
