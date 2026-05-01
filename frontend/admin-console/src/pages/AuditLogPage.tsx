import { Fragment, useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { StatusBadge } from '../components/dashboard'
import { formatRelativeTime, downloadCSV } from '../lib/format'

interface AuditEntry {
  id: number
  staff_user_id: string
  staff_email: string
  action: string
  target_type: string
  target_id: string | null
  meta: Record<string, unknown>
  created_at: string
}

interface AuditResponse {
  entries: AuditEntry[]
  total_count: number
}

const PAGE_SIZE = 25

const ACTION_GROUPS = [
  { label: 'All actions', value: '' },
  { label: 'Bonus Hub', value: 'bonushub.*' },
  { label: 'Payments', value: 'payment.*' },
  { label: 'Chat', value: 'chat.*' },
  { label: 'System', value: 'system.*' },
]

const TARGET_TYPES = [
  { label: 'All targets', value: '' },
  { label: 'Player', value: 'player' },
  { label: 'Withdrawal', value: 'withdrawal' },
  { label: 'Bonus', value: 'bonus' },
  { label: 'Promotion', value: 'promotion' },
  { label: 'Chat', value: 'chat' },
  { label: 'System', value: 'system' },
]

function actionVariant(action: string): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  if (action.includes('reject') || action.includes('forfeit') || action.includes('delete')) return 'error'
  if (action.includes('approve') || action.includes('grant') || action.includes('publish')) return 'success'
  if (action.includes('patch') || action.includes('update')) return 'warning'
  return 'info'
}

function SkeletonRow() {
  return (
    <tr className="placeholder-glow">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="py-3">
          <span className="placeholder col-10 d-block" />
        </td>
      ))}
    </tr>
  )
}

export default function AuditLogPage() {
  const { apiFetch, role } = useAdminAuth()
  const showRawMeta = role === 'superadmin' && typeof localStorage !== 'undefined' && localStorage.getItem('admin_debug_raw') === '1'

  const [staffEmail, setStaffEmail] = useState('')
  const [actionGroup, setActionGroup] = useState('')
  const [targetType, setTargetType] = useState('')
  const [after, setAfter] = useState('')
  const [before, setBefore] = useState('')

  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [csvBusy, setCsvBusy] = useState(false)

  const buildParams = useCallback(() => {
    const p = new URLSearchParams()
    if (staffEmail.trim()) p.set('staff_email', staffEmail.trim())
    if (actionGroup) p.set('action_prefix', actionGroup)
    if (targetType) p.set('target_type', targetType)
    if (after) p.set('after', after)
    if (before) p.set('before', before)
    p.set('limit', String(PAGE_SIZE))
    p.set('offset', String(offset))
    return p.toString()
  }, [staffEmail, actionGroup, targetType, after, before, offset])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/v1/admin/audit-log?${buildParams()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as AuditResponse)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [apiFetch, buildParams])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useEffect(() => {
    setOffset(0)
  }, [staffEmail, actionGroup, targetType, after, before])

  const handleCSV = async () => {
    setCsvBusy(true)
    try {
      await downloadCSV(`/v1/admin/audit-log?${buildParams()}`, apiFetch, 'audit-log.csv')
    } catch {
      /* ignore — browser download handles errors visually */
    } finally {
      setCsvBusy(false)
    }
  }

  const entries = data?.entries ?? []
  const totalCount = data?.total_count ?? 0
  const rangeStart = totalCount === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + PAGE_SIZE, totalCount)

  return (
    <>
      <PageMeta
        title="Audit log · Admin"
        description="Immutable staff action history with filters and CSV export."
      />
      <PageBreadcrumb
        pageTitle="Audit log"
        subtitle="Staff actions across Bonus Hub, payments, chat, and system changes."
      />

      <div className="d-flex justify-content-end mb-3">
        <button
          type="button"
          disabled={csvBusy}
          onClick={() => void handleCSV()}
          className="btn btn-primary btn-sm d-inline-flex align-items-center gap-2"
        >
          {csvBusy ? (
            <span className="spinner-border spinner-border-sm" role="status" aria-hidden />
          ) : (
            <i className="bi bi-download" aria-hidden />
          )}
          Export CSV
        </button>
      </div>

      <div className="card mb-3">
        <div className="card-body py-3">
          <div className="row g-2 align-items-end">
            <div className="col-6 col-md-4 col-lg">
              <label className="form-label small mb-0">Staff email</label>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Filter by email…"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
              />
            </div>
            <div className="col-6 col-md-4 col-lg">
              <label className="form-label small mb-0">Action type</label>
              <select
                value={actionGroup}
                onChange={(e) => setActionGroup(e.target.value)}
                className="form-select form-select-sm"
              >
                {ACTION_GROUPS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-4 col-lg">
              <label className="form-label small mb-0">Target type</label>
              <select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="form-select form-select-sm"
              >
                {TARGET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-4 col-lg">
              <label className="form-label small mb-0">After</label>
              <input type="date" value={after} onChange={(e) => setAfter(e.target.value)} className="form-control form-control-sm" />
            </div>
            <div className="col-6 col-md-4 col-lg">
              <label className="form-label small mb-0">Before</label>
              <input type="date" value={before} onChange={(e) => setBefore(e.target.value)} className="form-control form-control-sm" />
            </div>
          </div>
        </div>
      </div>

      {error ? <div className="alert alert-danger small py-2">{error}</div> : null}

      <div className="card">
        <div className="table-responsive">
          <table className="table table-sm table-striped table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th className="small">Time</th>
                <th className="small">Staff</th>
                <th className="small">Action</th>
                <th className="small">Target</th>
                <th className="small">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-secondary py-5 small">
                    No entries found.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <Fragment key={entry.id}>
                    <tr
                      className="cursor-pointer"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      <td className="text-nowrap small" title={entry.created_at}>
                        {formatRelativeTime(entry.created_at)}
                      </td>
                      <td className="small">
                        <span className="font-monospace">{entry.staff_email}</span>
                      </td>
                      <td>
                        <StatusBadge label={entry.action} variant={actionVariant(entry.action)} dot />
                      </td>
                      <td className="small">
                        {entry.target_type ? (
                          <span className="badge text-bg-secondary me-1">{entry.target_type}</span>
                        ) : null}
                        <span className="font-monospace text-secondary">{entry.target_id ?? '—'}</span>
                      </td>
                      <td className="text-secondary small">{expandedId === entry.id ? '▾ collapse' : '▸ expand'}</td>
                    </tr>
                    {expandedId === entry.id && (
                      <tr className="table-light">
                        <td colSpan={5} className="small">
                          <ApiResultSummary data={entry.meta} embedded />
                          {showRawMeta ? (
                            <details className="mt-3">
                              <summary className="text-primary" role="button">
                                Developer: raw JSON (set localStorage admin_debug_raw=1)
                              </summary>
                              <pre className="mt-2 mb-0 max-h-48 overflow-auto p-3 rounded bg-dark text-success small font-monospace">
                                {JSON.stringify(entry.meta, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalCount > 0 ? (
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3 small text-secondary">
          <span>
            Showing {rangeStart}–{rangeEnd} of {totalCount}
          </span>
          <div className="d-flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="btn btn-outline-secondary btn-sm"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= totalCount}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="btn btn-outline-secondary btn-sm"
            >
              Next →
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
