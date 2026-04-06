import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { formatApiError, readApiError } from '../../api/errors'
import { useAdminActivityLog } from '../../notifications/AdminActivityLogContext'
import { AngleDownIcon, AngleUpIcon } from '../../icons'
import {
  extractAdminListRows,
  formatAdminCell,
  inferColumns,
} from '../../lib/adminListResponse'

type SortDir = 'asc' | 'desc'

type Props = {
  apiPath: string
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  /** Auto-refresh interval in ms; 0 or undefined = no auto-refresh */
  refreshIntervalMs?: number
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return (a ? 1 : 0) - (b ? 1 : 0)
  }
  const sa = String(a)
  const sb = String(b)
  const numA = Number(sa)
  const numB = Number(sb)
  if (!Number.isNaN(numA) && !Number.isNaN(numB) && sa.trim() !== '' && sb.trim() !== '') {
    return numA - numB
  }
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
}

const PAGE_SIZES = [10, 25, 50, 100] as const
const FETCH_LIMIT = 500

const AdminDataTable: FC<Props> = ({ apiPath, apiFetch, refreshIntervalMs }) => {
  const { reportApiFailure, reportClientError } = useAdminActivityLog()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const q = apiPath.includes('?') ? '&' : '?'
    const res = await apiFetch(`${apiPath}${q}limit=${FETCH_LIMIT}`)
    if (!res.ok) {
      const err = await readApiError(res)
      reportApiFailure({
        res,
        parsed: err,
        method: 'GET',
        path: `${apiPath}?limit=${FETCH_LIMIT}`,
      })
      setError(formatApiError(err, `Request failed (${res.status})`))
      setRows([])
      setLoading(false)
      return
    }
    let data: unknown
    try {
      data = (await res.json()) as unknown
    } catch {
      reportClientError({ code: 'invalid_json', message: 'Invalid JSON response from admin API' })
      setError('Invalid JSON response')
      setRows([])
      setLoading(false)
      return
    }
    const list = extractAdminListRows(apiPath, data)
    if (!list) {
      reportClientError({
        code: 'unexpected_shape',
        message: 'Response has no list array (users, entries, events, …).',
      })
      setRows([])
    } else {
      setRows(list)
    }
    setLoading(false)
    setPage(1)
    setSortKey(null)
    setSortDir('asc')
  }, [apiFetch, apiPath, reportApiFailure, reportClientError])

  // Silent refresh: updates rows without resetting sort/page
  const silentRefresh = useCallback(async () => {
    const q = apiPath.includes('?') ? '&' : '?'
    try {
      const res = await apiFetch(`${apiPath}${q}limit=${FETCH_LIMIT}`)
      if (!res.ok) return
      const data = (await res.json()) as unknown
      const list = extractAdminListRows(apiPath, data)
      if (list) setRows(list)
    } catch {
      // silent — don't overwrite UI on background failure
    }
  }, [apiFetch, apiPath])

  const hasMounted = useRef(false)

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        hasMounted.current = true
        void load()
      }
    })
    return () => {
      cancelled = true
    }
  }, [load])

  // Auto-refresh polling
  useEffect(() => {
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return
    if (!hasMounted.current) return
    const t = window.setInterval(() => void silentRefresh(), refreshIntervalMs)
    return () => window.clearInterval(t)
  }, [refreshIntervalMs, silentRefresh])

  const columns = useMemo(() => inferColumns(rows), [rows])

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((ra, rb) => dir * compareValues(ra[sortKey], rb[sortKey]))
  }, [rows, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize)

  const onSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setPage(1)
  }

  if (loading) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">Loading…</p>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
        {error}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-3 font-medium text-brand-600 underline hover:text-brand-700 dark:text-brand-400"
        >
          Retry
        </button>
      </div>
    )
  }

  if (columns.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">No rows returned.</p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Showing <span className="font-medium text-gray-800 dark:text-white/90">{rows.length}</span>{' '}
            row{rows.length === 1 ? '' : 's'}
            {rows.length >= FETCH_LIMIT ? ` (capped at ${FETCH_LIMIT})` : ''}
          </p>
          <button
            type="button"
            onClick={() => void silentRefresh()}
            className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            title="Refresh data"
          >
            ↻ Refresh
          </button>
          {refreshIntervalMs ? (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              Auto-refresh every {Math.round(refreshIntervalMs / 1000)}s
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="admin-page-size" className="text-sm text-gray-600 dark:text-gray-400">
            Per page
          </label>
          <select
            id="admin-page-size"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setPage(1)
            }}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-w-full overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
          <thead className="bg-gray-50 dark:bg-gray-900/50">
            <tr>
              {columns.map((col) => {
                const active = sortKey === col
                return (
                  <th key={col} className="whitespace-nowrap px-4 py-3 font-medium text-gray-700 dark:text-gray-300">
                    <button
                      type="button"
                      onClick={() => onSort(col)}
                      className="inline-flex items-center gap-1 rounded-md hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      <span className="font-mono text-xs tracking-tight">{col}</span>
                      {active ? (
                        sortDir === 'asc' ? (
                          <AngleUpIcon className="size-4 shrink-0" />
                        ) : (
                          <AngleDownIcon className="size-4 shrink-0" />
                        )
                      ) : null}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-white/[0.02]">
            {pageRows.map((row, i) => (
              <tr
                key={i}
                className="hover:bg-gray-50 dark:hover:bg-white/[0.04]"
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className="max-w-[min(28rem,40vw)] truncate whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-800 dark:text-gray-200"
                    title={formatAdminCell(row[col])}
                  >
                    {formatAdminCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Page {safePage} of {totalPages}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

export default AdminDataTable
