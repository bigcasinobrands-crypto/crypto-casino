import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { formatApiError, readApiError } from '../../api/errors'
import { useAdminActivityLog } from '../../notifications/AdminActivityLogContext'
import { AngleDownIcon, AngleUpIcon } from '../../icons'
import {
  extractAdminListRows,
  formatAdminCell,
  inferColumns,
} from '../../lib/adminListResponse'
import { StatusBadge } from '../dashboard'
import { formatCurrency, formatRelativeTime } from '../../lib/format'

type SortDir = 'asc' | 'desc'

type Props = {
  apiPath: string
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  /** Auto-refresh interval in ms; 0 or undefined = no auto-refresh */
  refreshIntervalMs?: number
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

const STATUS_SUCCESS = new Set(['settled', 'completed', 'active', 'approved', 'success'])
const STATUS_WARNING = new Set(['pending', 'pending_approval', 'processing'])
const STATUS_ERROR = new Set(['failed', 'rejected', 'forfeited', 'cancelled', 'expired'])

function statusVariant(val: string): 'success' | 'warning' | 'error' | 'neutral' {
  const v = val.toLowerCase()
  if (STATUS_SUCCESS.has(v)) return 'success'
  if (STATUS_WARNING.has(v)) return 'warning'
  if (STATUS_ERROR.has(v)) return 'error'
  return 'neutral'
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

function exportRowsAsCSV(columns: string[], rows: Record<string, unknown>[], filename: string) {
  const escape = (v: string) => {
    if (v.includes('"') || v.includes(',') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`
    }
    return v
  }
  const header = columns.map(escape).join(',')
  const body = rows
    .map((r) => columns.map((c) => escape(formatAdminCell(r[c]))).join(','))
    .join('\n')
  const csv = `${header}\n${body}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const PAGE_SIZES = [10, 25, 50, 100] as const
const FETCH_LIMIT = 500
const SKELETON_ROWS = 8
const SKELETON_COLS = 5

function SkeletonTable() {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] overflow-hidden">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800/50">
          <tr>
            {Array.from({ length: SKELETON_COLS }, (_, i) => (
              <th key={i} className="px-4 py-3">
                <div className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
          {Array.from({ length: SKELETON_ROWS }, (_, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''}>
              {Array.from({ length: SKELETON_COLS }, (_, ci) => (
                <td key={ci} className="px-4 py-3">
                  <div
                    className="h-3 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
                    style={{ width: `${50 + ((ri + ci) % 4) * 15}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
      <svg
        className="mb-3 size-10 opacity-50"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
        />
      </svg>
      <p className="text-sm font-medium">No data found</p>
    </div>
  )
}

function CellValue({ col, value }: { col: string; value: unknown }) {
  const lower = col.toLowerCase()

  if (lower === 'status' && typeof value === 'string' && value.trim() !== '') {
    return <StatusBadge label={value} variant={statusVariant(value)} dot />
  }

  if ((lower.includes('amount') || lower.includes('minor')) && typeof value === 'number') {
    return <span className="tabular-nums">{formatCurrency(value)}</span>
  }

  if (
    (lower.includes('created_at') || lower.includes('updated_at')) &&
    typeof value === 'string' &&
    ISO_DATE_RE.test(value)
  ) {
    return (
      <span title={new Date(value).toLocaleString()}>
        {formatRelativeTime(value)}
      </span>
    )
  }

  return <>{formatAdminCell(value)}</>
}

const AdminDataTable: FC<Props> = ({ apiPath, apiFetch, refreshIntervalMs }) => {
  const { reportApiFailure, reportClientError } = useAdminActivityLog()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [search, setSearch] = useState('')

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

  useEffect(() => {
    if (!refreshIntervalMs || refreshIntervalMs <= 0) return
    if (!hasMounted.current) return
    const t = window.setInterval(() => void silentRefresh(), refreshIntervalMs)
    return () => window.clearInterval(t)
  }, [refreshIntervalMs, silentRefresh])

  const columns = useMemo(() => inferColumns(rows), [rows])

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter((row) =>
      columns.some((col) => {
        const v = row[col]
        if (v == null) return false
        return String(v).toLowerCase().includes(q)
      }),
    )
  }, [rows, columns, search])

  const sortedRows = useMemo(() => {
    if (!sortKey) return filteredRows
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filteredRows].sort((ra, rb) => dir * compareValues(ra[sortKey], rb[sortKey]))
  }, [filteredRows, sortKey, sortDir])

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

  const csvFilename = useMemo(() => {
    const slug = apiPath.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
    return `${slug}_export.csv`
  }, [apiPath])

  if (loading) {
    return <SkeletonTable />
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
    return <EmptyState />
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Showing{' '}
            <span className="font-medium text-gray-800 dark:text-white/90">
              {filteredRows.length}
            </span>{' '}
            row{filteredRows.length === 1 ? '' : 's'}
            {search.trim() && filteredRows.length !== rows.length && (
              <span className="text-gray-400 dark:text-gray-500">
                {' '}
                of {rows.length}
              </span>
            )}
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

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-gray-400 dark:text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search…"
              className="rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-gray-500 dark:focus:border-brand-400 dark:focus:ring-brand-400"
            />
          </div>

          {/* Export CSV */}
          <button
            type="button"
            onClick={() => exportRowsAsCSV(columns, sortedRows, csvFilename)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export CSV
          </button>

          {/* Page size */}
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
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 text-left text-sm dark:divide-gray-800">
          <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-800/50">
            <tr>
              {columns.map((col) => {
                const active = sortKey === col
                return (
                  <th
                    key={col}
                    className="whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    <button
                      type="button"
                      onClick={() => onSort(col)}
                      className="inline-flex items-center gap-1 rounded-md hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      {col.replace(/_/g, ' ')}
                      {active ? (
                        sortDir === 'asc' ? (
                          <AngleUpIcon className="size-3.5 shrink-0" />
                        ) : (
                          <AngleDownIcon className="size-3.5 shrink-0" />
                        )
                      ) : (
                        <span className="inline-block size-3.5" />
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState />
                </td>
              </tr>
            ) : (
              pageRows.map((row, i) => (
                <tr
                  key={i}
                  className={`
                    transition-colors
                    hover:bg-gray-100 dark:hover:bg-gray-800
                    ${i % 2 === 0 ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''}
                  `}
                >
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="max-w-[min(28rem,40vw)] truncate whitespace-nowrap px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300"
                      title={formatAdminCell(row[col])}
                    >
                      <CellValue col={col} value={row[col]} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Page {safePage} of {totalPages}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

export default AdminDataTable
