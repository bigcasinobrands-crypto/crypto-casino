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
    <div className="card shadow-sm">
      <div className="card-body p-0">
        <div className="table-responsive">
          <table className="table table-sm mb-0">
            <thead className="table-light">
              <tr>
                {Array.from({ length: SKELETON_COLS }, (_, i) => (
                  <th key={i} className="py-3">
                    <div className="placeholder placeholder-wave w-50" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SKELETON_ROWS }, (_, ri) => (
                <tr key={ri}>
                  {Array.from({ length: SKELETON_COLS }, (_, ci) => (
                    <td key={ci} className="py-3">
                      <div
                        className="placeholder placeholder-wave"
                        style={{ width: `${50 + ((ri + ci) % 4) * 12}%` }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center text-body-secondary py-5 px-3">
      <i className="bi bi-inbox d-block mb-2 opacity-50 fs-2" aria-hidden />
      <p className="small mb-0 fw-medium">No data found</p>
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
      <div className="alert alert-danger d-flex flex-wrap align-items-center justify-content-between gap-2 mb-0">
        <span className="small mb-0">{error}</span>
        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }

  if (columns.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="d-flex flex-column gap-3">
      <div className="d-flex flex-column flex-lg-row flex-wrap align-items-stretch align-items-lg-center justify-content-between gap-2 gap-lg-3">
        <div className="d-flex flex-column flex-sm-row flex-wrap align-items-start align-items-sm-center gap-2 small text-body-secondary">
          <p className="mb-0">
            Showing <span className="fw-semibold text-body">{filteredRows.length}</span> row
            {filteredRows.length === 1 ? '' : 's'}
            {search.trim() && filteredRows.length !== rows.length ? (
              <span>
                {' '}
                of {rows.length}
              </span>
            ) : null}
            {rows.length >= FETCH_LIMIT ? ` (capped at ${FETCH_LIMIT})` : ''}
          </p>
          <button
            type="button"
            onClick={() => void silentRefresh()}
            className="btn btn-sm btn-outline-secondary"
            title="Refresh data"
          >
            <i className="bi bi-arrow-clockwise me-1" aria-hidden />
            Refresh
          </button>
          {refreshIntervalMs ? (
            <span className="text-muted" style={{ fontSize: '0.7rem' }}>
              Auto every {Math.round(refreshIntervalMs / 1000)}s
            </span>
          ) : null}
        </div>

        <div className="d-flex flex-column flex-sm-row flex-wrap align-items-stretch align-items-sm-center gap-2">
          <div className="input-group input-group-sm" style={{ maxWidth: '16rem' }}>
            <span className="input-group-text bg-body-secondary border-end-0">
              <i className="bi bi-search" aria-hidden />
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search rows…"
              className="form-control"
              aria-label="Filter rows"
            />
          </div>

          <button
            type="button"
            onClick={() => exportRowsAsCSV(columns, sortedRows, csvFilename)}
            className="btn btn-sm btn-outline-secondary"
          >
            <i className="bi bi-download me-1" aria-hidden />
            Export CSV
          </button>

          <div className="d-flex align-items-center gap-1">
            <label htmlFor="admin-page-size" className="small text-body-secondary mb-0 text-nowrap">
              Per page
            </label>
            <select
              id="admin-page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="form-select form-select-sm"
              style={{ width: '4.5rem' }}
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

      <div className="card shadow-sm">
        <div className="table-responsive">
          <table className="table table-hover table-striped table-sm align-middle mb-0 text-nowrap">
            <thead className="table-light sticky-top">
              <tr>
                {columns.map((col) => {
                  const active = sortKey === col
                  return (
                    <th key={col} scope="col" className="small text-uppercase text-body-secondary">
                      <button
                        type="button"
                        onClick={() => onSort(col)}
                        className="btn btn-link btn-sm text-decoration-none text-body p-0 text-start text-uppercase fw-semibold"
                      >
                        {col.replace(/_/g, ' ')}
                        {active ? (
                          sortDir === 'asc' ? (
                            <AngleUpIcon className="ms-1 size-3.5 align-text-bottom" />
                          ) : (
                            <AngleDownIcon className="ms-1 size-3.5 align-text-bottom" />
                          )
                        ) : null}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="p-0 border-0">
                    <EmptyState />
                  </td>
                </tr>
              ) : (
                pageRows.map((row, i) => (
                  <tr key={i}>
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="small text-body text-truncate"
                        style={{ maxWidth: 'min(28rem, 50vw)' }}
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
      </div>

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <p className="small text-body-secondary mb-0">
          Page {safePage} of {totalPages}
        </p>
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="btn btn-outline-secondary"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="btn btn-outline-secondary"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

export default AdminDataTable
