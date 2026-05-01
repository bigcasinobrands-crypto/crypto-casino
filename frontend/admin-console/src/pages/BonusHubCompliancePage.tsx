import { Fragment, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { formatApiError, readApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { useDashboardSystem } from '../hooks/useDashboard'
import { useOperationalFlags } from '../hooks/useOperationalFlags'
import { formatRelativeTime } from '../lib/format'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'

type BonusAuditEntry = {
  id: number
  event_type: string
  actor_type: string
  actor_id: string
  user_id: string
  bonus_instance_id: string
  promotion_version_id: number
  amount_delta_minor: number
  currency: string
  metadata: Record<string, unknown>
  created_at: string
}

type OutboxEntry = {
  id: number
  event_type: string
  attempts: number
  last_error: string
  created_at: string
  processed_at: string | null
  dlq_at: string | null
  payload: Record<string, unknown> | string
}

type ViolationEntry = {
  id: number
  user_id: string
  user_email: string
  bonus_instance_id: string
  game_id: string
  stake_minor: number
  max_bet_minor: number
  violation_type: string
  source_ref: string
  created_at: string
}

const PAGE = 40

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function parseAuditPayload(json: unknown): { entries: BonusAuditEntry[]; total: number } {
  const o = asRecord(json)
  if (!o) return { entries: [], total: 0 }
  const raw = o.entries
  const total =
    typeof o.total_count === 'number'
      ? o.total_count
      : Number(o.total_count) || 0
  if (!Array.isArray(raw)) return { entries: [], total }
  const entries: BonusAuditEntry[] = raw.map((row, idx) => {
    const r = asRecord(row) ?? {}
    const meta = r.metadata
    return {
      id: typeof r.id === 'number' ? r.id : Number(r.id) || idx,
      event_type: String(r.event_type ?? ''),
      actor_type: String(r.actor_type ?? ''),
      actor_id: String(r.actor_id ?? ''),
      user_id: String(r.user_id ?? ''),
      bonus_instance_id: String(r.bonus_instance_id ?? ''),
      promotion_version_id:
        typeof r.promotion_version_id === 'number'
          ? r.promotion_version_id
          : Number(r.promotion_version_id) || 0,
      amount_delta_minor:
        typeof r.amount_delta_minor === 'number'
          ? r.amount_delta_minor
          : Number(r.amount_delta_minor) || 0,
      currency: String(r.currency ?? ''),
      metadata: asRecord(meta) ?? {},
      created_at: String(r.created_at ?? ''),
    }
  })
  return { entries, total }
}

function parseOutboxPayload(json: unknown): { entries: OutboxEntry[]; total: number } {
  const o = asRecord(json)
  if (!o) return { entries: [], total: 0 }
  const raw = o.entries
  const total =
    typeof o.total_count === 'number'
      ? o.total_count
      : Number(o.total_count) || 0
  if (!Array.isArray(raw)) return { entries: [], total }
  const entries: OutboxEntry[] = raw.map((row, idx) => {
    const r = asRecord(row) ?? {}
    const payload = r.payload
    return {
      id: typeof r.id === 'number' ? r.id : Number(r.id) || idx,
      event_type: String(r.event_type ?? ''),
      attempts: typeof r.attempts === 'number' ? r.attempts : Number(r.attempts) || 0,
      last_error: String(r.last_error ?? ''),
      created_at: String(r.created_at ?? ''),
      processed_at: r.processed_at == null ? null : String(r.processed_at),
      dlq_at: r.dlq_at == null ? null : String(r.dlq_at),
      payload:
        typeof payload === 'string'
          ? payload
          : asRecord(payload) ?? {},
    }
  })
  return { entries, total }
}

function parseViolationsPayload(json: unknown): { entries: ViolationEntry[]; total: number } {
  const o = asRecord(json)
  if (!o) return { entries: [], total: 0 }
  const raw = o.entries
  const total =
    typeof o.total_count === 'number'
      ? o.total_count
      : Number(o.total_count) || 0
  if (!Array.isArray(raw)) return { entries: [], total }
  const entries: ViolationEntry[] = raw.map((row, idx) => {
    const r = asRecord(row) ?? {}
    return {
      id: typeof r.id === 'number' ? r.id : Number(r.id) || idx,
      user_id: String(r.user_id ?? ''),
      user_email: String(r.user_email ?? ''),
      bonus_instance_id: String(r.bonus_instance_id ?? ''),
      game_id: String(r.game_id ?? ''),
      stake_minor:
        typeof r.stake_minor === 'number' ? r.stake_minor : Number(r.stake_minor) || 0,
      max_bet_minor:
        typeof r.max_bet_minor === 'number'
          ? r.max_bet_minor
          : r.max_bet_minor == null
            ? 0
            : Number(r.max_bet_minor) || 0,
      violation_type: String(r.violation_type ?? ''),
      source_ref: String(r.source_ref ?? ''),
      created_at: String(r.created_at ?? ''),
    }
  })
  return { entries, total }
}

type ComplianceTab = 'audit' | 'outbox' | 'violations'
type OutboxFilter = 'pending' | 'dlq' | 'done' | 'all'

function parseComplianceTab(raw: string | null): ComplianceTab {
  const t = raw?.toLowerCase()?.trim()
  if (t === 'outbox' || t === 'violations') return t
  return 'audit'
}

function parseOutboxFilter(raw: string | null): OutboxFilter {
  const s = raw?.toLowerCase()?.trim()
  if (s === 'dlq' || s === 'done' || s === 'all' || s === 'pending') return s
  return 'pending'
}

export default function BonusHubCompliancePage() {
  const { apiFetch, role } = useAdminAuth()
  const canRedriveOutbox = role === 'superadmin'
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseComplianceTab(searchParams.get('tab'))
  const outState = parseOutboxFilter(searchParams.get('outbox'))

  const selectTab = useCallback(
    (next: ComplianceTab) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev)
          if (next === 'audit') {
            n.delete('tab')
            n.delete('outbox')
          } else {
            n.set('tab', next)
            if (next !== 'outbox') {
              n.delete('outbox')
            }
          }
          return n
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const selectOutboxFilter = useCallback(
    (next: OutboxFilter) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev)
          n.set('tab', 'outbox')
          if (next === 'pending') {
            n.delete('outbox')
          } else {
            n.set('outbox', next)
          }
          return n
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const { flags: opFlags, err: opFlagsErr } = useOperationalFlags(apiFetch)
  const { data: systemHealth } = useDashboardSystem(30000)
  const [auditRows, setAuditRows] = useState<BonusAuditEntry[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [outRows, setOutRows] = useState<OutboxEntry[]>([])
  const [outTotal, setOutTotal] = useState(0)
  const [violRows, setViolRows] = useState<ViolationEntry[]>([])
  const [violTotal, setViolTotal] = useState(0)
  const [userId, setUserId] = useState('')
  const [eventType, setEventType] = useState('')
  const [violUserId, setViolUserId] = useState('')
  const [violType, setViolType] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [redriveBusyId, setRedriveBusyId] = useState<number | null>(null)

  const loadAudit = useCallback(async () => {
    const p = new URLSearchParams()
    p.set('limit', String(PAGE))
    p.set('offset', '0')
    if (userId.trim()) p.set('user_id', userId.trim())
    if (eventType.trim()) p.set('event_type', eventType.trim())
    const res = await apiFetch(`/v1/admin/bonushub/bonus-audit-log?${p}`)
    if (!res.ok) throw new Error(`audit ${res.status}`)
    const parsed = parseAuditPayload(await res.json())
    setAuditRows(parsed.entries)
    setAuditTotal(parsed.total)
  }, [apiFetch, userId, eventType])

  const loadOutbox = useCallback(async () => {
    const p = new URLSearchParams()
    p.set('limit', String(PAGE))
    p.set('offset', '0')
    p.set('state', outState)
    const res = await apiFetch(`/v1/admin/bonushub/bonus-outbox?${p}`)
    if (!res.ok) throw new Error(`outbox ${res.status}`)
    const parsed = parseOutboxPayload(await res.json())
    setOutRows(parsed.entries)
    setOutTotal(parsed.total)
  }, [apiFetch, outState])

  const loadViolations = useCallback(async () => {
    const p = new URLSearchParams()
    p.set('limit', String(PAGE))
    p.set('offset', '0')
    if (violUserId.trim()) p.set('user_id', violUserId.trim())
    if (violType.trim()) p.set('violation_type', violType.trim())
    const res = await apiFetch(`/v1/admin/bonushub/wager-violations?${p}`)
    if (!res.ok) throw new Error(`violations ${res.status}`)
    const parsed = parseViolationsPayload(await res.json())
    setViolRows(parsed.entries)
    setViolTotal(parsed.total)
  }, [apiFetch, violUserId, violType])

  const redriveOutboxRow = useCallback(
    async (id: number) => {
      setRedriveBusyId(id)
      try {
        const res = await apiFetch(`/v1/admin/bonushub/bonus-outbox/${id}/redrive`, { method: 'POST' })
        if (!res.ok) {
          const parsed = await readApiError(res)
          toast.error(formatApiError(parsed, `Redrive failed (${res.status})`))
          return
        }
        toast.success(`Outbox #${id} queued for delivery again`)
        await loadOutbox()
      } catch {
        toast.error('Network error')
      } finally {
        setRedriveBusyId(null)
      }
    },
    [apiFetch, loadOutbox],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        if (tab === 'audit') await loadAudit()
        else if (tab === 'outbox') await loadOutbox()
        else await loadViolations()
      } catch (e: unknown) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'load failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tab, loadAudit, loadOutbox, loadViolations])

  return (
    <>
      <PageMeta
        title="Compliance trail · Admin"
        description="Bonus audit trail, delivery outbox, and wager rule violations."
      />
      <PageBreadcrumb
        pageTitle="Compliance trail"
        subtitle="Bonus audit trail, outbox (DLQ after 25 attempts), and wager rule rejects (max bet / excluded game)."
      />

      <div className="space-y-4">
      <div className="alert alert-warning small mb-0">
        <p className="fw-medium mb-1">Max-bet violation policy (worker)</p>
        {opFlagsErr ? (
          <p className="mt-1 text-xs opacity-90">Could not load operational flags ({opFlagsErr}).</p>
        ) : opFlags == null ? (
          <p className="mt-1 text-xs opacity-90">Loading…</p>
        ) : (
          <>
            <p className="mt-1 text-xs leading-relaxed opacity-95">
              {(() => {
                const n = opFlags.bonus_max_bet_violations_auto_forfeit ?? 0
                if (n <= 0) {
                  return (
                    <>
                      <strong>Auto-forfeit off</strong> on this API host (<code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10">BONUS_MAX_BET_VIOLATIONS_AUTO_FORFEIT=0</code>
                      ). Violations are still logged; forfeits are manual or other flows.
                    </>
                  )
                }
                return (
                  <>
                    <strong>Auto-forfeit on:</strong> the worker may forfeit active bonuses when{' '}
                    <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px] dark:bg-white/10">max_bet_violations_count</code> reaches{' '}
                    <strong>{n}</strong> (env on <em>this</em> API process). Run the worker with the same env in production so behavior matches.
                  </>
                )
              })()}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed opacity-80">
              Repo reference: <code className="font-mono">docs/bonus-max-bet-violations-policy.md</code> — game contribution <code className="font-mono">per_game</code> weights are documented there.
            </p>
          </>
        )}
      </div>

      {systemHealth ? (
        <div className="card card-body py-2 small text-secondary">
          <span className="fw-medium text-body me-2">Bonus outbox (DB)</span>
          <span>
            <strong className="tabular-nums text-gray-900 dark:text-gray-100">
              {systemHealth.bonus_outbox_pending_delivery ?? '—'}
            </strong>{' '}
            pending
          </span>
          <span className="text-gray-300 dark:text-gray-600">·</span>
          <span>
            <strong className="tabular-nums text-gray-900 dark:text-gray-100">
              {systemHealth.bonus_outbox_dead_letter ?? '—'}
            </strong>{' '}
            DLQ
          </span>
          <span className="text-secondary">— matches dashboard pipeline card (~30s refresh).</span>
        </div>
      ) : null}

      <div className="btn-group flex-wrap mb-2" role="group" aria-label="Compliance views">
        <button
          type="button"
          className={`btn btn-sm ${tab === 'audit' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => selectTab('audit')}
        >
          Bonus audit log
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'outbox' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => selectTab('outbox')}
        >
          Outbox
        </button>
        <button
          type="button"
          className={`btn btn-sm ${tab === 'violations' ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={() => selectTab('violations')}
        >
          Wager violations
        </button>
      </div>

      {err ? (
        <div className="alert alert-danger small py-2">
          <p className="mb-0">{err}</p>
          {(err.includes('500') || err.includes('502')) ? (
            <p className="mb-0 mt-2 small opacity-90">
              Often this means the API database is missing bonus compliance tables (e.g.{' '}
              <code className="px-1 rounded bg-body-secondary font-monospace">bonus_audit_log</code>) or migrations
              have not been applied. Check core API logs and run the latest SQL migrations.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === 'audit' && (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 220 }}
            placeholder="user_id (uuid)"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 180 }}
            placeholder="event_type"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
          />
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void loadAudit()}>
            Apply
          </button>
          <span className="small text-secondary">{auditTotal} rows</span>
        </div>
      )}

      {tab === 'outbox' && (
        <div className="space-y-2">
          <div className="d-flex flex-wrap align-items-center gap-2">
            <span className="small text-secondary">State:</span>
            <div className="btn-group btn-group-sm flex-wrap" role="group">
              {(['pending', 'dlq', 'done', 'all'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`btn ${outState === s ? 'btn-primary' : 'btn-outline-secondary'}`}
                  onClick={() => selectOutboxFilter(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="small text-secondary">{outTotal} rows</span>
          </div>
          {canRedriveOutbox ? (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              DLQ: use <strong>Redrive</strong> on a row to clear the cap and reset attempts so the worker delivers again (staff action is logged).
            </p>
          ) : null}
        </div>
      )}

      {tab === 'violations' && (
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 220 }}
            placeholder="user_id"
            value={violUserId}
            onChange={(e) => setViolUserId(e.target.value)}
          />
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 260 }}
            placeholder="violation_type (max_bet | excluded_game)"
            value={violType}
            onChange={(e) => setViolType(e.target.value)}
          />
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void loadViolations()}>
            Apply
          </button>
          <span className="small text-secondary">{violTotal} rows</span>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : tab === 'audit' ? (
        <div className="table-responsive rounded border shadow-sm">
          <table className="table table-sm table-hover align-middle mb-0 text-nowrap">
            <thead className="table-secondary">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Δ minor</th>
                <th className="px-3 py-2">Meta</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="text-gray-700 dark:text-gray-200">
                    <td className="whitespace-nowrap px-3 py-2">{formatRelativeTime(r.created_at)}</td>
                    <td className="px-3 py-2 font-mono">{r.event_type}</td>
                    <td className="px-3 py-2">
                      {r.actor_type}
                      {r.actor_id ? <span className="ml-1 font-mono text-[10px] text-gray-500">{r.actor_id}</span> : null}
                    </td>
                    <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[10px]">{r.user_id}</td>
                    <td className="px-3 py-2">
                      {r.amount_delta_minor} {r.currency}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-decoration-none"
                        onClick={() => setExpanded((x) => (x === r.id ? null : r.id))}
                      >
                        {expanded === r.id ? 'Hide details' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={6} className="bg-body-secondary px-3 py-3 border-top">
                        <p className="small text-body-secondary mb-2">Event metadata</p>
                        <ApiResultSummary data={r.metadata} embedded />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'outbox' ? (
        <div className="table-responsive rounded border shadow-sm">
          <table className="table table-sm table-hover align-middle mb-0 text-nowrap">
            <thead className="table-secondary">
              <tr>
                <th className="px-3 py-2">id</th>
                <th className="px-3 py-2">event</th>
                <th className="px-3 py-2">attempts</th>
                <th className="px-3 py-2">created</th>
                <th className="px-3 py-2">processed</th>
                <th className="px-3 py-2">dlq</th>
                <th className="px-3 py-2">error</th>
                {canRedriveOutbox ? <th className="px-3 py-2">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {outRows.map((r) => (
                <tr key={r.id} className="text-gray-700 dark:text-gray-200">
                  <td className="px-3 py-2 font-mono">{r.id}</td>
                  <td className="px-3 py-2 font-mono">{r.event_type}</td>
                  <td className="px-3 py-2">{r.attempts}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatRelativeTime(r.created_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.processed_at ? formatRelativeTime(r.processed_at) : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.dlq_at ? formatRelativeTime(r.dlq_at) : '—'}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-red-600 dark:text-red-400" title={r.last_error}>
                    {r.last_error || '—'}
                  </td>
                  {canRedriveOutbox ? (
                    <td className="whitespace-nowrap px-3 py-2">
                      {r.dlq_at && !r.processed_at ? (
                        <button
                          type="button"
                          disabled={redriveBusyId === r.id}
                          className="btn btn-primary btn-sm py-0 px-2"
                          onClick={() => void redriveOutboxRow(r.id)}
                        >
                          {redriveBusyId === r.id ? '…' : 'Redrive'}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-responsive rounded border shadow-sm">
          <table className="table table-sm table-hover align-middle mb-0 text-nowrap">
            <thead className="table-secondary">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Game</th>
                <th className="px-3 py-2">Stake</th>
                <th className="px-3 py-2">Max bet</th>
                <th className="px-3 py-2">Instance</th>
                <th className="px-3 py-2">Ref</th>
              </tr>
            </thead>
            <tbody>
              {violRows.map((r) => (
                <tr key={r.id} className="text-gray-700 dark:text-gray-200">
                  <td className="whitespace-nowrap px-3 py-2">{formatRelativeTime(r.created_at)}</td>
                  <td className="px-3 py-2 font-mono">{r.violation_type}</td>
                  <td className="max-w-[100px] truncate px-3 py-2 text-[10px]" title={r.user_id}>
                    {r.user_email || r.user_id}
                  </td>
                  <td className="max-w-[80px] truncate px-3 py-2 font-mono text-[10px]">{r.game_id || '—'}</td>
                  <td className="px-3 py-2">{r.stake_minor}</td>
                  <td className="px-3 py-2">{r.max_bet_minor || '—'}</td>
                  <td className="max-w-[90px] truncate px-3 py-2 font-mono text-[10px]">{r.bonus_instance_id}</td>
                  <td className="max-w-[100px] truncate px-3 py-2 text-[10px]" title={r.source_ref}>
                    {r.source_ref || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </>
  )
}
