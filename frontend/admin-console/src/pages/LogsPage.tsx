import { useCallback, useEffect, useState, type FC } from 'react'

import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { useAdminAuth } from '../authContext'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'

type LogEntry = {
  id: string
  created_at: string
  severity: string
  code: string
  http_status: number
  message: string
  source: string
  request_id: string
  detail: string
  user_agent: string
  client_build: string
}

const LogsPage: FC = () => {
  const { apiFetch } = useAdminAuth()
  const { markLogsVisited, refreshUnread } = useAdminActivityLog()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const limit = 100

  useEffect(() => {
    markLogsVisited()
  }, [markLogsVisited])

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    const res = await apiFetch(`/v1/admin/client-logs?limit=${limit}&offset=${offset}`)
    if (!res.ok) {
      setErr(`Failed to load logs (HTTP ${res.status})`)
      setEntries([])
      setLoading(false)
      return
    }
    const j = (await res.json()) as { entries?: LogEntry[] }
    setEntries(Array.isArray(j.entries) ? j.entries : [])
    setLoading(false)
  }, [apiFetch, offset])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `admin-client-logs-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const copyRow = (e: LogEntry) => {
    void navigator.clipboard.writeText(JSON.stringify(e, null, 2))
  }

  return (
    <>
      <PageMeta
        title="Diagnostics · Admin"
        description="Client-reported errors and diagnostics (retained 90 days on server)"
      />
      <PageBreadcrumb
        pageTitle="Diagnostics"
        subtitle="Events from this admin session and browser, stored up to 90 days."
      />

      <div className="d-flex flex-wrap gap-2 justify-content-end mb-3">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </button>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void refreshUnread()}>
          Sync badge
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={exportJson}
          disabled={entries.length === 0}
        >
          Export JSON
        </button>
      </div>

      {err ? <div className="alert alert-danger small py-2">{err}</div> : null}

      <ComponentCard title="Client log stream" desc="Paginated client-reported diagnostics from the API.">
        {loading ? (
          <p className="text-secondary small mb-0">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-secondary small mb-0">No log entries in the retention window.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm table-striped table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th className="small">Time</th>
                  <th className="small">Severity</th>
                  <th className="small">Code</th>
                  <th className="small">HTTP</th>
                  <th className="small">Source</th>
                  <th className="small">Message</th>
                  <th className="small">Request</th>
                  <th className="small" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="text-secondary text-nowrap small">{e.created_at}</td>
                    <td className="small">{e.severity}</td>
                    <td className="font-monospace small text-truncate" style={{ maxWidth: 140 }} title={e.code}>
                      {e.code}
                    </td>
                    <td className="small">{e.http_status}</td>
                    <td className="font-monospace small text-truncate" style={{ maxWidth: 200 }} title={e.source}>
                      {e.source}
                    </td>
                    <td className="small text-truncate" style={{ maxWidth: 280 }} title={e.message}>
                      {e.message}
                    </td>
                    <td className="font-monospace small text-truncate" style={{ maxWidth: 120 }} title={e.request_id}>
                      {e.request_id || '—'}
                    </td>
                    <td>
                      <button type="button" className="btn btn-link btn-sm py-0 px-0" onClick={() => copyRow(e)}>
                        Copy
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && entries.length >= limit ? (
          <div className="d-flex gap-2 mt-3">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              disabled={offset === 0}
            >
              Previous
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setOffset((o) => o + limit)}>
              Next
            </button>
          </div>
        ) : null}
      </ComponentCard>
    </>
  )
}

export default LogsPage
