import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAdminAuth } from '../authContext'
import { formatRelativeTime } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { OpsToolbar } from '../components/ops'

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
      <PageBreadcrumb
        pageTitle="BlueOcean events"
        subtitle="Webhook verification, disputes, and provider event audit trail"
      />

      <div className="d-flex flex-wrap gap-2 mb-3">
        <Link to="/games" className="btn btn-sm btn-outline-primary">
          Games catalog
        </Link>
        <Link to="/provider-ops" className="btn btn-sm btn-outline-secondary">
          Provider ops
        </Link>
      </div>

      <ComponentCard
        title="Provider events"
        desc="Newest-first rows for debugging and dispute workflows."
      >
        <OpsToolbar
          title="Event log"
          subtitle={loading ? 'Loading…' : `${rows.length} row(s) loaded`}
          actions={
            <button type="button" className="btn btn-sm btn-outline-primary" disabled={loading} onClick={() => void load()}>
              Refresh
            </button>
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
          <p className="text-secondary small mb-0">Loading…</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-striped table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Provider event</th>
                  <th scope="col">Status</th>
                  <th scope="col">Verified</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-secondary small py-4">
                      No events.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-monospace small text-nowrap">{r.id}</td>
                      <td className="font-monospace small" style={{ maxWidth: '14rem' }}>
                        <span className="text-break d-inline-block">{r.provider_event_id}</span>
                      </td>
                      <td className="small">{r.status}</td>
                      <td className="small">
                        <span className={`badge ${r.verified ? 'text-bg-success' : 'text-bg-secondary'}`}>
                          {r.verified ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="small text-secondary text-nowrap" title={r.created_at}>
                        {formatRelativeTime(r.created_at)}
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
