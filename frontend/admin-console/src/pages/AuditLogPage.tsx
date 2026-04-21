import { Fragment, useCallback, useEffect, useState } from 'react'
import { useAdminAuth } from '../authContext'
import { StatusBadge } from '../components/dashboard'
import { formatRelativeTime, downloadCSV } from '../lib/format'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'

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
    <tr className="animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-gray-200 dark:bg-gray-700" />
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

  const inputCls =
    'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500'
  const selectCls = `${inputCls} appearance-none pr-8`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Audit Log</h1>
        <button
          type="button"
          disabled={csvBusy}
          onClick={() => void handleCSV()}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:opacity-50"
        >
          {csvBusy ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
            </svg>
          )}
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          Staff email
          <input
            type="text"
            placeholder="Filter by email…"
            value={staffEmail}
            onChange={(e) => setStaffEmail(e.target.value)}
            className={`${inputCls} w-52`}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          Action type
          <select value={actionGroup} onChange={(e) => setActionGroup(e.target.value)} className={selectCls}>
            {ACTION_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          Target type
          <select value={targetType} onChange={(e) => setTargetType(e.target.value)} className={selectCls}>
            {TARGET_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          After
          <input type="date" value={after} onChange={(e) => setAfter(e.target.value)} className={inputCls} />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-gray-500 dark:text-gray-400">
          Before
          <input type="date" value={before} onChange={(e) => setBefore(e.target.value)} className={inputCls} />
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-400 dark:text-gray-500">
                    No entries found.
                  </td>
                </tr>
              ) : (
                entries.map((entry, idx) => (
                  <Fragment key={entry.id}>
                    <tr
                      className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03] ${idx % 2 === 1 ? 'bg-gray-50/50 dark:bg-white/[0.01]' : ''}`}
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300" title={entry.created_at}>
                        {formatRelativeTime(entry.created_at)}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        <span className="font-mono text-xs">{entry.staff_email}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={entry.action} variant={actionVariant(entry.action)} dot />
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                        {entry.target_type && (
                          <span className="mr-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            {entry.target_type}
                          </span>
                        )}
                        <span className="font-mono text-xs text-gray-500">{entry.target_id ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {expandedId === entry.id ? '▾ collapse' : '▸ expand'}
                      </td>
                    </tr>
                    {expandedId === entry.id && (
                      <tr className="bg-gray-50 dark:bg-white/[0.02]">
                        <td colSpan={5} className="px-4 py-3">
                          <ApiResultSummary data={entry.meta} embedded />
                          {showRawMeta ? (
                            <details className="mt-3">
                              <summary className="cursor-pointer text-xs font-medium text-brand-600 dark:text-brand-400">
                                Developer: raw JSON (set localStorage admin_debug_raw=1)
                              </summary>
                              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-green-400 dark:bg-black">
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

      {/* Pagination */}
      {totalCount > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>
            Showing {rangeStart}–{rangeEnd} of {totalCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:hover:bg-white/[0.04]"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= totalCount}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:hover:bg-white/[0.04]"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
