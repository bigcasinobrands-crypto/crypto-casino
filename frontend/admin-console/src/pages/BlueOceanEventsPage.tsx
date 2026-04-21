import { useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'
import { formatRelativeTime } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type EventRow = {
  id: number
  provider_event_id: string
  status: string
  verified: boolean
  created_at: string
}

export default function BlueOceanEventsPage() {
  const { apiFetch } = useAdminAuth()
  const [rows, setRows] = useState<EventRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/events/blueocean?limit=200')
      if (!res.ok) {
        setErr(`HTTP ${res.status}`)
        setRows([])
        return
      }
      const j = (await res.json()) as { events?: EventRow[] }
      setRows(Array.isArray(j.events) ? j.events : [])
    } catch {
      setErr('Network error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <PageMeta title="BlueOcean events · Admin" description="Recent provider webhook / event rows" />
      <PageBreadcrumb pageTitle="BlueOcean events" />
      <ComponentCard
        title="Provider events"
        desc="GET /v1/admin/events/blueocean — newest first. Use for webhook verification and dispute debugging."
      >
        {err ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</p> : null}
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">ID</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Provider event</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Verified</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      No events.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.id}</td>
                      <td className="max-w-[14rem] break-all px-3 py-2 font-mono text-xs">{r.provider_event_id}</td>
                      <td className="px-3 py-2">{r.status}</td>
                      <td className="px-3 py-2">{r.verified ? 'yes' : 'no'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600 dark:text-gray-400" title={r.created_at}>
                        {formatRelativeTime(r.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        <button
          type="button"
          className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm text-white hover:bg-brand-600"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </ComponentCard>
    </>
  )
}
