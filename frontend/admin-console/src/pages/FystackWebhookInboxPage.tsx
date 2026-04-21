import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { formatRelativeTime } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type DeliveryRow = {
  id: number
  dedupe_key: string
  event_type: string
  resource_id: string
  processed: boolean
  created_at: string
}

export default function FystackWebhookInboxPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const [filter, setFilter] = useState<'all' | 'pending'>('pending')
  const [rows, setRows] = useState<DeliveryRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const q = filter === 'pending' ? '?processed=false&limit=200' : '?limit=200'
      const res = await apiFetch(`/v1/admin/ops/fystack-webhook-deliveries${q}`)
      if (!res.ok) {
        setErr(`HTTP ${res.status}`)
        setRows([])
        return
      }
      const j = (await res.json()) as { deliveries?: DeliveryRow[] }
      setRows(Array.isArray(j.deliveries) ? j.deliveries : [])
    } catch {
      setErr('Network error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch, filter])

  useEffect(() => {
    void load()
  }, [load])

  const reprocess = async (id: number) => {
    if (!isSuper) {
      toast.error('Superadmin required')
      return
    }
    setBusyId(id)
    try {
      const res = await apiFetch(`/v1/admin/ops/fystack-webhook-deliveries/${id}/reprocess`, { method: 'POST' })
      if (!res.ok) {
        toast.error(`Reprocess failed (${res.status})`)
        return
      }
      toast.success('Reprocess queued')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <PageMeta title="Fystack webhooks · Admin" description="Webhook delivery inbox" />
      <PageBreadcrumb pageTitle="Fystack webhooks" />
      <ComponentCard
        title="Webhook deliveries"
        desc="Unprocessed rows are replayed by Reconcile on Finance Overview, or individually here (superadmin)."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {(['pending', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                filter === f
                  ? 'bg-brand-500 text-white'
                  : 'bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200'
              }`}
              onClick={() => setFilter(f)}
            >
              {f === 'pending' ? 'Pending only' : 'All recent'}
            </button>
          ))}
        </div>
        {err ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{err}</p> : null}
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">ID</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Event</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Resource</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Processed</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Created</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                      No rows.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.id}</td>
                      <td className="px-3 py-2">{r.event_type}</td>
                      <td className="max-w-[12rem] break-all px-3 py-2 font-mono text-xs">{r.resource_id}</td>
                      <td className="px-3 py-2">{r.processed ? 'yes' : 'no'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600 dark:text-gray-400" title={r.created_at}>
                        {formatRelativeTime(r.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        {!r.processed && isSuper ? (
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            className="text-xs text-brand-600 underline disabled:opacity-50 dark:text-brand-400"
                            onClick={() => void reprocess(r.id)}
                          >
                            {busyId === r.id ? '…' : 'Reprocess'}
                          </button>
                        ) : (
                          '—'
                        )}
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
          className="mt-4 rounded-lg border border-gray-300 px-4 py-2 text-sm dark:border-gray-600"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </ComponentCard>
    </>
  )
}
