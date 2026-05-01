import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import { formatRelativeTime } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { OpsToolbar } from '../components/ops'

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
    if (!window.confirm(`Reprocess webhook delivery #${id}? Only use when finance has cleared duplicate risk.`)) {
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

  const pendingCount = rows.filter((r) => !r.processed).length

  return (
    <>
      <PageMeta title="Fystack webhooks · Admin" description="Webhook delivery inbox" />
      <PageBreadcrumb
        pageTitle="Fystack webhooks"
        subtitle="Delivery inbox — replay stuck rows individually or via Finance reconcile."
      />

      <div className="d-flex flex-wrap gap-2 mb-3">
        <Link to="/finance" className="btn btn-sm btn-outline-primary">
          Finance overview
        </Link>
        <Link to="/settings?tab=system" className="btn btn-sm btn-outline-secondary">
          Payment flags
        </Link>
      </div>

      <ComponentCard
        title="Webhook deliveries"
        desc="Unprocessed rows are replayed by Reconcile on Finance Overview, or individually here (superadmin)."
      >
        <OpsToolbar
          title="Inbox"
          subtitle={
            loading
              ? 'Loading…'
              : filter === 'pending'
                ? `${pendingCount} pending in this view`
                : `${rows.length} recent row(s)`
          }
          actions={
            <>
              <div className="btn-group btn-group-sm" role="group" aria-label="Filter deliveries">
                {(['pending', 'all'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={`btn ${filter === f ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'pending' ? 'Pending only' : 'All recent'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                disabled={loading}
                onClick={() => void load()}
              >
                Refresh
              </button>
            </>
          }
        />

        {err ? (
          <div className="alert alert-danger d-flex flex-wrap align-items-center justify-content-between gap-2">
            <span className="small mb-0">{err}</span>
            <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="card border-0 bg-body-secondary placeholder-glow">
            <div className="card-body">
              <span className="placeholder col-12 mb-2" />
              <span className="placeholder col-10 mb-2" />
              <span className="placeholder col-8" />
            </div>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-striped table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Event</th>
                  <th scope="col">Resource</th>
                  <th scope="col">Processed</th>
                  <th scope="col">Created</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-secondary small py-4">
                      No rows match this filter.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-monospace small text-nowrap">{r.id}</td>
                      <td className="small">{r.event_type}</td>
                      <td className="font-monospace small text-break" style={{ maxWidth: '14rem' }}>
                        {r.resource_id}
                      </td>
                      <td className="small">
                        <span className={`badge ${r.processed ? 'text-bg-success' : 'text-bg-warning'}`}>
                          {r.processed ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="small text-secondary text-nowrap" title={r.created_at}>
                        {formatRelativeTime(r.created_at)}
                      </td>
                      <td className="small">
                        {!r.processed && isSuper ? (
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            className="btn btn-link btn-sm p-0"
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
      </ComponentCard>
    </>
  )
}
