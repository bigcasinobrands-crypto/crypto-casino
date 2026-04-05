import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

export default function BlueOceanOpsPage() {
  const { apiFetch } = useAdminAuth()
  const { reportApiFailure, reportNetworkFailure } = useAdminActivityLog()
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [flags, setFlags] = useState<Record<string, unknown> | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  return (
    <>
      <PageMeta title="Blue Ocean · Admin" description="Integration status and catalog sync" />
      <PageBreadcrumb pageTitle="Blue Ocean" />
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

        <ComponentCard title="Integration status" desc="GET /v1/admin/integrations/blueocean/status">
          <pre className="max-h-64 overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900/60">
            {status ? JSON.stringify(status, null, 2) : 'Loading…'}
          </pre>
        </ComponentCard>

        <ComponentCard title="Operational flags" desc="GET /v1/admin/system/operational-flags">
          <pre className="max-h-48 overflow-auto rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900/60">
            {flags ? JSON.stringify(flags, null, 2) : 'Loading…'}
          </pre>
        </ComponentCard>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          <Link className="text-brand-600 underline dark:text-brand-400" to="/blueocean">
            View BlueOcean webhook events
          </Link>
        </p>
      </div>
    </>
  )
}
