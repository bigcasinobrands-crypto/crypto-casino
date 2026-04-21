import { useCallback, useEffect, useState } from 'react'
import { readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import AdminDataTable from '../components/admin/AdminDataTable'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'

type Tab = 'status' | 'events'

export default function BlueOceanOpsPage() {
  const { apiFetch } = useAdminAuth()
  const { reportApiFailure, reportNetworkFailure } = useAdminActivityLog()
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [flags, setFlags] = useState<Record<string, unknown> | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('status')

  const load = useCallback(async () => {
    const pathS = '/v1/admin/integrations/blueocean/status'
    const pathF = '/v1/admin/system/operational-flags'
    const [s, f] = await Promise.all([apiFetch(pathS), apiFetch(pathF)])
    if (s.ok) setStatus((await s.json()) as Record<string, unknown>)
    else {
      const parsed = await readApiError(s)
      reportApiFailure({ res: s, parsed, method: 'GET', path: pathS })
    }
    if (f.ok) setFlags((await f.json()) as Record<string, unknown>)
    else {
      const parsed = await readApiError(f)
      reportApiFailure({ res: f, parsed, method: 'GET', path: pathF })
    }
  }, [apiFetch, reportApiFailure])

  useEffect(() => {
    void load()
  }, [load])

  const sync = async () => {
    setBusy(true)
    setSyncMsg(null)
    const syncPath = '/v1/admin/integrations/blueocean/sync-catalog'
    try {
      const res = await apiFetch(syncPath, {
        method: 'POST',
      })
      if (!res.ok) {
        const parsed = await readApiError(res)
        reportApiFailure({ res, parsed, method: 'POST', path: syncPath })
        setSyncMsg(`Sync failed (HTTP ${res.status}).`)
        return
      }
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      setSyncMsg(`Catalog sync OK — upserted ${String(j.upserted ?? '?')} game(s).`)
    } catch {
      reportNetworkFailure({
        message: 'Network error during sync.',
        method: 'POST',
        path: syncPath,
      })
      setSyncMsg('Network error during sync.')
    } finally {
      setBusy(false)
      void load()
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'status', label: 'Status' },
    { id: 'events', label: 'Events' },
  ]

  return (
    <>
      <PageMeta title="Provider Operations · Admin" description="Integration status, catalog sync, and event log" />
      <PageBreadcrumb pageTitle="Provider Operations" />

      <div className="mb-6 flex gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1 dark:border-gray-700 dark:bg-gray-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'status' && (
        <div className="space-y-6">
          <ComponentCard title="Catalog sync" desc="POST /v1/admin/integrations/blueocean/sync-catalog">
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
              Pulls the remote game list and upserts into the local catalog. Requires API credentials on
              the core service.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void sync()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? 'Syncing…' : 'Sync catalog now'}
            </button>
            {syncMsg ? (
              <p className="mt-3 text-sm text-gray-700 dark:text-gray-300">{syncMsg}</p>
            ) : null}
          </ComponentCard>

          <ComponentCard title="Integration status" desc="Connection and last catalog sync from the game provider.">
            {status ? <ApiResultSummary data={status} embedded /> : <p className="text-sm text-gray-500">Loading…</p>}
          </ComponentCard>

          <ComponentCard title="Operational flags" desc="System-wide switches (maintenance, game launch, provider mode).">
            {flags ? <ApiResultSummary data={flags} embedded /> : <p className="text-sm text-gray-500">Loading…</p>}
          </ComponentCard>
        </div>
      )}

      {activeTab === 'events' && (
        <ComponentCard title="BlueOcean Events" desc="GET /v1/admin/events/blueocean">
          <AdminDataTable
            apiPath="/v1/admin/events/blueocean"
            apiFetch={apiFetch}
            refreshIntervalMs={15000}
          />
        </ComponentCard>
      )}
    </>
  )
}
