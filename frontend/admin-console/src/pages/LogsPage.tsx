import { useCallback, useEffect, useState, type FC } from 'react'

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
    <div>
      <PageMeta
        title="Logs · Admin"
        description="Client-reported errors and diagnostics (retained 90 days on server)"
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Logs</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Events from this admin session and browser, stored up to 90 days.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </button>
          <button
            type="button"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            onClick={() => void refreshUnread()}
          >
            Sync badge
          </button>
          <button
            type="button"
            className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={exportJson}
            disabled={entries.length === 0}
          >
            Export JSON
          </button>
        </div>
      </div>

      {err && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {err}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500">No log entries in the retention window.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50">
              <tr>
                <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Time</th>
                <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Severity</th>
                <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Code</th>
                <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">HTTP</th>
                <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Source</th>
                <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Message</th>
                <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Request</th>
                <th className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
              {entries.map((e) => (
                <tr key={e.id} className="bg-white dark:bg-gray-900">
                  <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-400">
                    {e.created_at}
                  </td>
                  <td className="px-3 py-2">{e.severity}</td>
                  <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs">{e.code}</td>
                  <td className="px-3 py-2">{e.http_status}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 font-mono text-xs" title={e.source}>
                    {e.source}
                  </td>
                  <td className="max-w-[280px] truncate px-3 py-2" title={e.message}>
                    {e.message}
                  </td>
                  <td className="max-w-[120px] truncate px-3 py-2 font-mono text-xs" title={e.request_id}>
                    {e.request_id || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-brand-600 text-xs underline dark:text-brand-400"
                      onClick={() => copyRow(e)}
                    >
                      Copy
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && entries.length >= limit && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="text-sm text-brand-600 underline dark:text-brand-400"
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
            disabled={offset === 0}
          >
            Previous
          </button>
          <button
            type="button"
            className="text-sm text-brand-600 underline dark:text-brand-400"
            onClick={() => setOffset((o) => o + limit)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

export default LogsPage
