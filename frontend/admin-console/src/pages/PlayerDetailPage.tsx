import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAdminAuth } from '../authContext'
import { apiErrFromBody, formatApiError, readApiError } from '../api/errors'
import { useAdminActivityLog } from '../notifications/AdminActivityLogContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { AreaChart, ChartCard, StatusBadge } from '../components/dashboard'
import { formatCurrency } from '../lib/format'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'
import { DefinitionTable, definitionValueBoolean, type DefinitionRow } from '../components/ops'
import { humanFieldLabel } from '../lib/adminFormatting'
import { flagEmoji } from '../lib/countryIsoList'

type EconomicTimelineBalances = {
  cash_minor?: number
  bonus_locked_minor?: number
  playable_minor?: number
}

type EconomicTimelinePayload = {
  user_id?: string
  balances?: EconomicTimelineBalances
  ledger?: Record<string, unknown>[]
  bonus_instances?: Record<string, unknown>[]
  payment_callbacks_guess?: Record<string, unknown>[]
}

type RiskDecisionRow = {
  id?: number
  promotion_version_id?: number | null
  decision?: string
  rule_codes?: string[]
  inputs?: unknown
  created_at?: string
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=UTF-8''([^;\n]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      return star[1].trim()
    }
  }
  const q = /filename="([^"]+)"/i.exec(header)
  if (q) return q[1]
  const plain = /filename=([^;\s]+)/i.exec(header)
  if (plain) return plain[1].replace(/^"|"$/g, '')
  return null
}

function decisionClass(decision: string): string {
  const d = decision.toLowerCase()
  if (d === 'allowed') return 'font-medium text-green-600 dark:text-green-400'
  if (d === 'denied') return 'font-medium text-red-600 dark:text-red-400'
  if (d === 'manual_review') return 'font-medium text-yellow-600 dark:text-yellow-400'
  return ''
}

function isoToDatetimeLocal(iso: unknown): string {
  if (typeof iso !== 'string' || !iso.trim()) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToRFC3339(v: string): string {
  if (!v.trim()) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

function formatFactsCell(v: unknown, key?: string): ReactNode {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return definitionValueBoolean(v)
  if (typeof v === 'number') {
    if (key && (key.includes('minor') || key.includes('ggr'))) return formatCurrency(v)
    return String(v)
  }
  if (typeof v === 'object') {
    return <code className="small text-break d-inline-block">{JSON.stringify(v)}</code>
  }
  return String(v)
}

function objectToDefinitionRows(obj: unknown): DefinitionRow[] {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return []
  return Object.entries(obj as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({
      field: humanFieldLabel(k),
      value: formatFactsCell(v, k),
      mono: true,
    }))
}

type ActiveSessionFact = {
  id?: string
  last_seen_at?: string
  client_ip?: string
  country_iso2?: string
  region?: string
  city?: string
  device_type?: string
  user_agent?: string
  fingerprint_visitor_id?: string
  geo_source?: string
  has_fingerprint_request?: boolean
}

function parseActiveSessions(facts: Record<string, unknown>): ActiveSessionFact[] {
  const raw = facts.active_sessions
  if (!Array.isArray(raw)) return []
  return raw.filter((x) => x && typeof x === 'object') as ActiveSessionFact[]
}

function sessionLocationLine(s: ActiveSessionFact): string {
  const parts = [s.city, s.region, s.country_iso2].map((x) => String(x ?? '').trim()).filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

function shortUserAgent(ua: string | undefined): string {
  const u = String(ua ?? '').trim()
  if (!u) return '—'
  return u.length > 64 ? `${u.slice(0, 61)}…` : u
}

function accountFactRows(facts: Record<string, unknown>): DefinitionRow[] {
  const rows: DefinitionRow[] = []
  if (facts.user_id != null) rows.push({ field: 'Player ID', value: String(facts.user_id), mono: true })
  const boId = facts.blue_ocean_player_id
  if (boId != null && String(boId).trim() !== '') {
    rows.push({ field: 'Blue Ocean player ID', value: String(boId), mono: true })
  } else {
    rows.push({ field: 'Blue Ocean player ID', value: '— not linked yet', mono: false })
  }
  if (facts.last_activity_at != null) {
    rows.push({ field: 'Last activity', value: String(facts.last_activity_at), mono: true })
  }
  const notes = facts.internal_notes
  if (notes != null && String(notes).trim() !== '') {
    rows.push({ field: 'Internal notes', value: String(notes), mono: false })
  }
  if (facts.latest_risk_signal != null) {
    rows.push({
      field: 'Latest risk signal',
      value: formatFactsCell(facts.latest_risk_signal),
      mono: true,
    })
  }
  return rows
}

function SupportCrmLink({ userId }: { userId: string }) {
  const href = useMemo(() => {
    const tpl = String(import.meta.env.VITE_SUPPORT_CRM_URL_TEMPLATE ?? '').trim()
    if (!tpl) return ''
    return tpl.replaceAll('{user_id}', userId).replaceAll('{userId}', userId)
  }, [userId])
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600"
    >
      Open in CRM
    </a>
  )
}

export default function PlayerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const { reportApiFailure } = useAdminActivityLog()
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const [economicTimeline, setEconomicTimeline] = useState<EconomicTimelinePayload | null>(null)
  const [economicTimelineErr, setEconomicTimelineErr] = useState<string | null>(null)
  const [economicTimelineLoading, setEconomicTimelineLoading] = useState(false)

  const [riskDecisions, setRiskDecisions] = useState<RiskDecisionRow[] | null>(null)
  const [riskErr, setRiskErr] = useState<string | null>(null)
  const [riskLoading, setRiskLoading] = useState(false)

  const [complianceMsg, setComplianceMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [rgReason, setRgReason] = useState('')
  const [rgSelfExInput, setRgSelfExInput] = useState('')
  const [rgClosedInput, setRgClosedInput] = useState('')
  const [rgBusy, setRgBusy] = useState(false)
  const [erasureBusy, setErasureBusy] = useState(false)

  const [boSyncBusy, setBoSyncBusy] = useState(false)
  const [boSyncResult, setBoSyncResult] = useState<Record<string, unknown> | null>(null)
  const [boSyncErr, setBoSyncErr] = useState<string | null>(null)

  const [facts, setFacts] = useState<Record<string, unknown> | null>(null)
  const [factsErr, setFactsErr] = useState<string | null>(null)
  const [vipSupportSnap, setVipSupportSnap] = useState<unknown>(null)
  const [vipSnapLoading, setVipSnapLoading] = useState(false)

  const [referralSummary, setReferralSummary] = useState<Record<string, unknown> | null>(null)
  const [referralSummaryErr, setReferralSummaryErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setErr(null)
    const path = `/v1/admin/users/${encodeURIComponent(id)}`
    const res = await apiFetch(path)
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'GET', path })
      setErr(formatApiError(parsed, `HTTP ${res.status}`))
      setData(null)
      return
    }
    setData((await res.json()) as Record<string, unknown>)
  }, [apiFetch, id, reportApiFailure])

  const loadFacts = useCallback(async () => {
    if (!id) return
    setFactsErr(null)
    const path = `/v1/admin/users/${encodeURIComponent(id)}/facts`
    try {
      const res = await apiFetch(path)
      if (!res.ok) {
        const parsed = await readApiError(res)
        reportApiFailure({ res, parsed, method: 'GET', path })
        setFactsErr(formatApiError(parsed, `HTTP ${res.status}`))
        setFacts(null)
        return
      }
      setFacts((await res.json()) as Record<string, unknown>)
    } catch {
      setFactsErr('Network error')
    }
  }, [apiFetch, id, reportApiFailure])

  const runBlueOceanSyncTest = useCallback(async () => {
    if (!id) return
    setBoSyncBusy(true)
    setBoSyncErr(null)
    setBoSyncResult(null)
    const path = `/v1/admin/users/${encodeURIComponent(id)}/integrations/blueocean/sync-test`
    try {
      const res = await apiFetch(path, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const parsed = apiErrFromBody(body, res.status)
        reportApiFailure({ res, parsed, method: 'POST', path })
        setBoSyncErr(formatApiError(parsed, `HTTP ${res.status}`))
        return
      }
      setBoSyncResult(body as Record<string, unknown>)
      void loadFacts()
    } catch {
      setBoSyncErr('Network error')
    } finally {
      setBoSyncBusy(false)
    }
  }, [apiFetch, id, loadFacts, reportApiFailure])

  const loadVipSupportSnapshot = useCallback(async () => {
    if (!id) return
    setVipSnapLoading(true)
    try {
      const res = await apiFetch(`/v1/admin/vip/support/players/${encodeURIComponent(id)}/snapshot`)
      if (!res.ok) {
        setVipSupportSnap(null)
        return
      }
      setVipSupportSnap((await res.json()) as unknown)
    } finally {
      setVipSnapLoading(false)
    }
  }, [apiFetch, id])

  const loadReferralSummary = useCallback(async () => {
    if (!id) return
    setReferralSummaryErr(null)
    try {
      const path = `/v1/admin/referrals/players/${encodeURIComponent(id)}/summary`
      const res = await apiFetch(path)
      if (!res.ok) {
        const parsed = await readApiError(res)
        reportApiFailure({ res, parsed, method: 'GET', path })
        setReferralSummaryErr(formatApiError(parsed, `HTTP ${res.status}`))
        setReferralSummary(null)
        return
      }
      const j = (await res.json()) as { summary?: Record<string, unknown> }
      setReferralSummary(j.summary && typeof j.summary === 'object' ? j.summary : null)
    } catch {
      setReferralSummaryErr('Network error')
      setReferralSummary(null)
    }
  }, [apiFetch, id, reportApiFailure])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled && id) void loadReferralSummary()
    })
    return () => {
      cancelled = true
    }
  }, [id, loadReferralSummary])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load()
    })
    return () => {
      cancelled = true
    }
  }, [load])

  useEffect(() => {
    if (!data) return
    setRgSelfExInput(isoToDatetimeLocal(data.self_excluded_until))
    setRgClosedInput(isoToDatetimeLocal(data.account_closed_at))
  }, [data])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadFacts()
    })
    return () => {
      cancelled = true
    }
  }, [loadFacts])

  const downloadExport = async () => {
    if (!id) return
    const exportPath = `/v1/admin/users/${encodeURIComponent(id)}/export`
    const res = await apiFetch(exportPath)
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'GET', path: exportPath })
      setErr(formatApiError(parsed, 'Export failed'))
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `user-${id}-export.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const loadEconomicTimeline = useCallback(async () => {
    if (!id) return
    const path = `/v1/admin/users/${encodeURIComponent(id)}/economic-timeline`
    setEconomicTimelineErr(null)
    setEconomicTimelineLoading(true)
    try {
      const res = await apiFetch(path)
      if (!res.ok) {
        const parsed = await readApiError(res)
        reportApiFailure({ res, parsed, method: 'GET', path })
        setEconomicTimelineErr(formatApiError(parsed, `HTTP ${res.status}`))
        setEconomicTimeline(null)
        return
      }
      setEconomicTimeline((await res.json()) as EconomicTimelinePayload)
    } finally {
      setEconomicTimelineLoading(false)
    }
  }, [apiFetch, id, reportApiFailure])

  const loadRiskDecisions = useCallback(async () => {
    if (!id) return
    const path = `/v1/admin/users/${encodeURIComponent(id)}/bonus-risk`
    setRiskErr(null)
    setRiskLoading(true)
    try {
      const res = await apiFetch(path)
      if (!res.ok) {
        const parsed = await readApiError(res)
        reportApiFailure({ res, parsed, method: 'GET', path })
        setRiskErr(formatApiError(parsed, `HTTP ${res.status}`))
        setRiskDecisions(null)
        return
      }
      const j = (await res.json()) as { decisions?: RiskDecisionRow[] }
      setRiskDecisions(Array.isArray(j.decisions) ? j.decisions : [])
    } finally {
      setRiskLoading(false)
    }
  }, [apiFetch, id, reportApiFailure])

  const patchRgCompliance = async (patch: Record<string, string>) => {
    if (!id || !isSuper) return
    setRgBusy(true)
    setComplianceMsg(null)
    try {
      const body: Record<string, unknown> = { ...patch }
      const r = rgReason.trim()
      if (r) body.reason = r
      const res = await apiFetch(`/v1/admin/users/${encodeURIComponent(id)}/compliance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const parsed = await readApiError(res)
        reportApiFailure({ res, parsed, method: 'PATCH', path: `/users/${id}/compliance` })
        setComplianceMsg({ kind: 'err', text: formatApiError(parsed, 'Update failed') })
        return
      }
      setComplianceMsg({ kind: 'ok', text: 'Compliance fields updated.' })
      await load()
    } catch {
      setComplianceMsg({ kind: 'err', text: 'Network error' })
    } finally {
      setRgBusy(false)
    }
  }

  const queuePlayerErasure = async () => {
    if (!id || !isSuper) return
    if (
      !window.confirm(
        'Queue full account erasure for this player? The worker will anonymize PII, revoke sessions, and close the account.',
      )
    ) {
      return
    }
    setErasureBusy(true)
    setComplianceMsg(null)
    try {
      const res = await apiFetch('/v1/admin/compliance/player-erasure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: id }),
      })
      if (!res.ok) {
        const parsed = await readApiError(res)
        reportApiFailure({ res, parsed, method: 'POST', path: '/v1/admin/compliance/player-erasure' })
        setComplianceMsg({ kind: 'err', text: formatApiError(parsed, `HTTP ${res.status}`) })
        return
      }
      const j = (await res.json()) as { job_id?: number }
      setComplianceMsg({
        kind: 'ok',
        text: `Erasure job queued${j.job_id != null ? ` (job #${j.job_id})` : ''}.`,
      })
    } catch {
      setComplianceMsg({ kind: 'err', text: 'Network error' })
    } finally {
      setErasureBusy(false)
    }
  }

  const downloadComplianceExport = useCallback(async () => {
    if (!id) return
    const path = `/v1/admin/users/${encodeURIComponent(id)}/compliance-export`
    setComplianceMsg(null)
    const res = await apiFetch(path)
    if (!res.ok) {
      const parsed = await readApiError(res)
      reportApiFailure({ res, parsed, method: 'GET', path })
      setComplianceMsg({ kind: 'err', text: formatApiError(parsed, 'Download failed') })
      return
    }
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition')
    const fromHeader = filenameFromContentDisposition(cd)
    const filename = fromHeader ?? `compliance-${id}.json`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    setComplianceMsg({ kind: 'ok', text: `Saved as ${filename}` })
  }, [apiFetch, id, reportApiFailure])

  const tableWrapClass = 'overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700'

  const profileRows = useMemo((): DefinitionRow[] => {
    if (!data) return []
    return Object.keys(data)
      .sort()
      .map((key) => ({
        field: humanFieldLabel(key),
        value: formatFactsCell(data[key], key),
        mono: true,
      }))
  }, [data])

  return (
    <>
      <PageMeta title="Player detail · Admin" description="Support view for a single user" />
      <PageBreadcrumb pageTitle="Player detail" />
      <div className="mb-4 text-sm">
        <Link to="/support" className="text-brand-600 underline dark:text-brand-400">
          ← Player lookup
        </Link>
      </div>

      {/* Risk badge — visible once risk decisions are loaded */}
      {riskDecisions && riskDecisions.length > 0 && (() => {
        const denied = riskDecisions.filter((r) => r.decision?.toLowerCase() === 'denied')
        const review = riskDecisions.filter((r) => r.decision?.toLowerCase() === 'manual_review')
        if (denied.length === 0 && review.length === 0) return null
        return (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {denied.length > 0 && (
              <StatusBadge label={`${denied.length} denied risk decision${denied.length > 1 ? 's' : ''}`} variant="error" dot />
            )}
            {review.length > 0 && (
              <StatusBadge label={`${review.length} pending review`} variant="warning" dot />
            )}
          </div>
        )
      })()}

      <ComponentCard
        title="Facts & VIP"
        desc="Rolling activity windows, VIP snapshot, and risk summary for this player."
        className="mb-6"
      >
        {factsErr ? <p className="mb-2 text-sm text-red-600 dark:text-red-400">{factsErr}</p> : null}
        {!facts && !factsErr ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p> : null}
        {facts ? (
          <div className="d-flex flex-column gap-4">
            <div className="row g-3">
              <div className="col-lg-4">
                <p className="text-secondary text-uppercase small fw-semibold mb-2">VIP</p>
                <DefinitionTable rows={objectToDefinitionRows(facts.vip)} flush />
                <div className="mt-2 d-flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={vipSnapLoading}
                    onClick={() => void loadVipSupportSnapshot()}
                  >
                    {vipSnapLoading ? 'Loading…' : 'VIP delivery snapshot'}
                  </button>
                </div>
                {vipSupportSnap != null ? (
                  <pre className="mt-2 mb-0 small text-wrap bg-body-secondary p-2 rounded" style={{ maxHeight: 220, overflow: 'auto' }}>
                    {JSON.stringify(vipSupportSnap, null, 2)}
                  </pre>
                ) : null}
              </div>
              <div className="col-lg-8">
                <p className="text-secondary text-uppercase small fw-semibold mb-2">Recent activity windows</p>
                <DefinitionTable rows={objectToDefinitionRows(facts.windows)} flush />
              </div>
            </div>
            <div>
              <p className="text-secondary text-uppercase small fw-semibold mb-2">Risk summary</p>
              <DefinitionTable rows={objectToDefinitionRows(facts.risk_summary)} flush />
            </div>
            {parseActiveSessions(facts as Record<string, unknown>).length > 0 ? (
              <div>
                <p className="text-secondary text-uppercase small fw-semibold mb-2">
                  Active sessions (IP &amp; device mapping)
                </p>
                <p className="small text-secondary mb-2">
                  From refresh-token sessions with edge geo and optional Fingerprint enrichment. Use alongside fraud tools for
                  player ↔ location verification.
                </p>
                <div className={tableWrapClass}>
                  <table className="table table-sm table-striped align-middle mb-0 text-nowrap">
                    <thead>
                      <tr>
                        <th>Last seen</th>
                        <th>IP</th>
                        <th>Location</th>
                        <th>Device</th>
                        <th>FP visitor</th>
                        <th>UA hint</th>
                        <th>Geo src</th>
                        <th>FP req</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parseActiveSessions(facts as Record<string, unknown>).map((s, i) => {
                        const cc = String(s.country_iso2 ?? '').trim().toUpperCase()
                        const loc = sessionLocationLine(s)
                        const uaFull = s.user_agent ? String(s.user_agent) : ''
                        return (
                          <tr key={s.id ? String(s.id) : `sess-${i}`}>
                            <td className="small">{s.last_seen_at ? String(s.last_seen_at) : '—'}</td>
                            <td className="small font-monospace">{s.client_ip ? String(s.client_ip) : '—'}</td>
                            <td className="small">
                              {cc ? (
                                <span title={loc}>
                                  {flagEmoji(cc)} {loc}
                                </span>
                              ) : (
                                loc
                              )}
                            </td>
                            <td className="small text-wrap" style={{ maxWidth: 200 }}>
                              {s.device_type ? String(s.device_type) : '—'}
                            </td>
                            <td className="small font-monospace text-wrap" style={{ maxWidth: 220 }}>
                              {s.fingerprint_visitor_id ? String(s.fingerprint_visitor_id) : '—'}
                            </td>
                            <td className="small text-wrap" style={{ maxWidth: 280 }} title={uaFull || undefined}>
                              {shortUserAgent(s.user_agent)}
                            </td>
                            <td className="small">{s.geo_source ? String(s.geo_source) : '—'}</td>
                            <td className="small">{s.has_fingerprint_request ? 'yes' : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="small text-secondary mt-2 mb-0">
                  User-agent detail: expand compliance export or correlate with traffic_sessions when investigating.
                </p>
              </div>
            ) : null}
            {accountFactRows(facts as Record<string, unknown>).length > 0 ? (
              <div>
                <p className="text-secondary text-uppercase small fw-semibold mb-2">Account</p>
                <DefinitionTable rows={accountFactRows(facts as Record<string, unknown>)} flush />
                <div className="mt-2 d-flex flex-wrap gap-2 align-items-center">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={boSyncBusy}
                    onClick={() => void runBlueOceanSyncTest()}
                  >
                    {boSyncBusy ? 'Running…' : 'Blue Ocean sync & verify'}
                  </button>
                  <span className="small text-secondary mb-0">
                    Provisions the GameHub player if missing, then calls <code className="small">playerExists</code>
                    {'. '}
                    With <code className="small">BLUEOCEAN_CREATE_PLAYER_USER_PASSWORD</code> set on the API, also runs{' '}
                    <code className="small">loginPlayer</code>.
                  </span>
                </div>
                {boSyncErr ? <p className="text-danger small mt-2 mb-0">{boSyncErr}</p> : null}
                {boSyncResult ? (
                  <div className="mt-2">
                    <p className="small fw-semibold mb-1">Last Blue Ocean check</p>
                    <ApiResultSummary data={boSyncResult} embedded />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <button type="button" className="btn btn-outline-primary btn-sm mt-3" onClick={() => void loadFacts()}>
          Refresh facts
        </button>
      </ComponentCard>

      {/* Deposit / withdrawal mini chart from economic timeline */}
      {economicTimeline?.ledger && economicTimeline.ledger.length > 0 && (() => {
        const deposits: Record<string, number> = {}
        const withdrawals: Record<string, number> = {}
        for (const row of economicTimeline.ledger) {
          const t = String(row.entry_type ?? '').toLowerCase()
          const day = String(row.at ?? '').slice(0, 10)
          if (!day) continue
          const amt = Math.abs(Number(row.amount_minor) || 0)
          if (t === 'deposit') deposits[day] = (deposits[day] || 0) + amt
          else if (t === 'withdrawal') withdrawals[day] = (withdrawals[day] || 0) + amt
        }
        const allDays = [...new Set([...Object.keys(deposits), ...Object.keys(withdrawals)])].sort()
        if (allDays.length < 2) return null
        return (
          <ChartCard title="Deposit / Withdrawal History" className="mb-6">
            <AreaChart
              categories={allDays}
              series={[
                { name: 'Deposits', data: allDays.map((d) => deposits[d] || 0), color: '#22c55e' },
                { name: 'Withdrawals', data: allDays.map((d) => withdrawals[d] || 0), color: '#ef4444' },
              ]}
              height={220}
              yFormatter={(v) => formatCurrency(v)}
            />
          </ChartCard>
        )
      })()}

      {/* Bonus timeline from bonus instances */}
      {economicTimeline?.bonus_instances && economicTimeline.bonus_instances.length > 0 && (
        <ComponentCard title="Bonus Timeline" desc="Grant → WR progress → outcome" className="mb-6">
          <div className="relative space-y-0 border-l-2 border-gray-200 pl-6 dark:border-gray-700">
            {economicTimeline.bonus_instances.map((bi, i) => {
              const status = String(bi.status ?? '').toLowerCase()
              const dotColor = status === 'active' ? 'bg-green-500' : status === 'forfeited' ? 'bg-red-500' : status === 'completed' ? 'bg-blue-500' : 'bg-gray-400'
              const wrRequired = Number(bi.wr_required_minor) || 0
              const wrDone = Number(bi.wr_contributed_minor) || 0
              const pct = wrRequired > 0 ? Math.min(100, Math.round((wrDone / wrRequired) * 100)) : 0
              return (
                <div key={`${bi.id ?? i}-${i}`} className="relative pb-5">
                  <span className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full ring-2 ring-white dark:ring-gray-900 ${dotColor}`} />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge label={String(bi.status ?? '—')} variant={status === 'active' ? 'success' : status === 'forfeited' ? 'error' : status === 'completed' ? 'info' : 'neutral'} />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Promo v{String(bi.promotion_version_id ?? '?')}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {bi.at ? String(bi.at) : '—'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
                    Granted {formatCurrency(Number(bi.granted_amount_minor) || 0)}
                    {wrRequired > 0 && (
                      <span className="ml-2 text-xs text-gray-500">
                        WR {formatCurrency(wrDone)} / {formatCurrency(wrRequired)} ({pct}%)
                      </span>
                    )}
                  </p>
                  {wrRequired > 0 && (
                    <div className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-brand-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </ComponentCard>
      )}

      <ComponentCard title="Profile" desc={`Player ${id ?? ''}`}>
        {err ? <p className="text-sm text-red-600 dark:text-red-400">{err}</p> : null}
        {data ? (
          <div className="flex flex-col gap-6">
            {/* Player card */}
            <div className="flex items-center gap-5">
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-brand-200 bg-gray-100 dark:border-brand-700 dark:bg-gray-800">
                {data.avatar_url ? (
                  <img
                    src={String(data.avatar_url)}
                    alt="Avatar"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="text-xl font-bold text-gray-400 dark:text-gray-500">
                    {(String(data.username ?? data.email ?? '?'))[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {data.username ? (
                  <p className="text-lg font-bold text-gray-900 dark:text-white">
                    {String(data.username)}
                  </p>
                ) : null}
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {String(data.email ?? '')}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Joined {data.created_at ? new Date(String(data.created_at)).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
                </p>
              </div>
            </div>

            <DefinitionTable rows={profileRows} />
          </div>
        ) : !err ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : null}
        {id ? (
          <div className="mt-4 flex flex-wrap gap-3">
            <SupportCrmLink userId={id} />
            <button
              type="button"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700"
              onClick={() => void downloadExport()}
            >
              Download GDPR export stub (JSON)
            </button>
          </div>
        ) : null}
      </ComponentCard>

      <ComponentCard
        className="mt-6"
        title="Referral program"
        desc="Partner link code, tier, pending commission, and referral funnel counts."
      >
        {referralSummaryErr ? (
          <p className="mb-2 text-sm text-red-600 dark:text-red-400">{referralSummaryErr}</p>
        ) : null}
        {!referralSummary && !referralSummaryErr ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : null}
        {referralSummary ? <DefinitionTable rows={objectToDefinitionRows(referralSummary)} flush /> : null}
        {id ? (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm mt-3"
            onClick={() => void loadReferralSummary()}
          >
            Refresh referral summary
          </button>
        ) : null}
      </ComponentCard>

      <ComponentCard
        className="mt-6"
        title="Economic Timeline"
        desc="FR-OPS-02 · Ledger, bonus instances, and payment callback hints"
      >
        <div className="flex flex-col gap-4">
          <button
            type="button"
            disabled={!id || economicTimelineLoading}
            className="w-fit rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white hover:bg-brand-600 disabled:opacity-50"
            onClick={() => void loadEconomicTimeline()}
          >
            {economicTimelineLoading ? 'Loading…' : 'Load Economic Timeline'}
          </button>
          {economicTimelineErr ? (
            <p className="text-sm text-red-600 dark:text-red-400">{economicTimelineErr}</p>
          ) : null}
          {economicTimeline ? (
            <div className="flex flex-col gap-3">
              <details className="rounded-lg border border-gray-200 dark:border-gray-700" open>
                <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">
                  Balances
                </summary>
                <div className="border-t border-gray-200 p-4 dark:border-gray-700">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-600 dark:bg-gray-800/50">
                    <dl className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <dt className="text-gray-500 dark:text-gray-400">cash_minor</dt>
                        <dd className="font-mono text-gray-900 dark:text-gray-100">
                          {economicTimeline.balances?.cash_minor ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-500 dark:text-gray-400">bonus_locked_minor</dt>
                        <dd className="font-mono text-gray-900 dark:text-gray-100">
                          {economicTimeline.balances?.bonus_locked_minor ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-gray-500 dark:text-gray-400">playable_minor</dt>
                        <dd className="font-mono text-gray-900 dark:text-gray-100">
                          {economicTimeline.balances?.playable_minor ?? '—'}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </details>

              <details className="rounded-lg border border-gray-200 dark:border-gray-700" open>
                <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">
                  Ledger entries
                </summary>
                <div className="border-t border-gray-200 p-2 dark:border-gray-700">
                  <div className={tableWrapClass}>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                          <th className="px-3 py-2 font-medium">ID</th>
                          <th className="px-3 py-2 font-medium">Amount</th>
                          <th className="px-3 py-2 font-medium">Currency</th>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Pocket</th>
                          <th className="px-3 py-2 font-medium">Idempotency Key</th>
                          <th className="px-3 py-2 font-medium">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {(economicTimeline.ledger ?? []).map((row, i) => (
                          <tr key={`${row.id ?? i}-${i}`}>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                              {String(row.id ?? '—')}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                              {String(row.amount_minor ?? '—')}
                            </td>
                            <td className="px-3 py-2">{String(row.currency ?? '—')}</td>
                            <td className="px-3 py-2">{String(row.entry_type ?? '—')}</td>
                            <td className="px-3 py-2">{String(row.pocket ?? '—')}</td>
                            <td className="max-w-[12rem] break-all px-3 py-2 font-mono text-xs">
                              {String(row.idempotency_key ?? '—')}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                              {row.at ? String(row.at) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>

              <details className="rounded-lg border border-gray-200 dark:border-gray-700" open>
                <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">
                  Bonus instances
                </summary>
                <div className="border-t border-gray-200 p-2 dark:border-gray-700">
                  <div className={tableWrapClass}>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                          <th className="px-3 py-2 font-medium">ID</th>
                          <th className="px-3 py-2 font-medium">Version</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Granted</th>
                          <th className="px-3 py-2 font-medium">WR Required</th>
                          <th className="px-3 py-2 font-medium">WR Done</th>
                          <th className="px-3 py-2 font-medium">Idempotency Key</th>
                          <th className="px-3 py-2 font-medium">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {(economicTimeline.bonus_instances ?? []).map((row, i) => (
                          <tr key={`${row.id ?? i}-${i}`}>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                              {String(row.id ?? '—')}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {String(row.promotion_version_id ?? '—')}
                            </td>
                            <td className="px-3 py-2">{String(row.status ?? '—')}</td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                              {String(row.granted_amount_minor ?? '—')}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                              {String(row.wr_required_minor ?? '—')}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                              {String(row.wr_contributed_minor ?? '—')}
                            </td>
                            <td className="max-w-[12rem] break-all px-3 py-2 font-mono text-xs">
                              {String(row.idempotency_key ?? '—')}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                              {row.at ? String(row.at) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>

              <details className="rounded-lg border border-gray-200 dark:border-gray-700" open>
                <summary className="cursor-pointer select-none px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">
                  Payment callbacks
                </summary>
                <div className="border-t border-gray-200 p-2 dark:border-gray-700">
                  <div className={tableWrapClass}>
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                          <th className="px-3 py-2 font-medium">Dedupe Key</th>
                          <th className="px-3 py-2 font-medium">Event Type</th>
                          <th className="px-3 py-2 font-medium">Resource ID</th>
                          <th className="px-3 py-2 font-medium">Processed</th>
                          <th className="px-3 py-2 font-medium">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {(economicTimeline.payment_callbacks_guess ?? []).map((row, i) => (
                          <tr key={`${row.dedupe_key ?? i}-${i}`}>
                            <td className="max-w-[14rem] break-all px-3 py-2 font-mono text-xs">
                              {String(row.dedupe_key ?? '—')}
                            </td>
                            <td className="px-3 py-2">{String(row.event_type ?? '—')}</td>
                            <td className="max-w-[12rem] break-all px-3 py-2 font-mono text-xs">
                              {String(row.resource_id ?? '—')}
                            </td>
                            <td className="px-3 py-2">{String(row.processed ?? '—')}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                              {row.at ? String(row.at) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </div>
          ) : null}
        </div>
      </ComponentCard>

      <ComponentCard className="mt-6" title="Risk Decisions" desc="FR-OPS-05 · Bonus eligibility / risk decisions">
        <div className="flex flex-col gap-4">
          <button
            type="button"
            disabled={!id || riskLoading}
            className="w-fit rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white hover:bg-brand-600 disabled:opacity-50"
            onClick={() => void loadRiskDecisions()}
          >
            {riskLoading ? 'Loading…' : 'Load Risk Decisions'}
          </button>
          {riskErr ? <p className="text-sm text-red-600 dark:text-red-400">{riskErr}</p> : null}
          {riskDecisions ? (
            <div className={tableWrapClass}>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2 font-medium">ID</th>
                    <th className="px-3 py-2 font-medium">Promo Version</th>
                    <th className="px-3 py-2 font-medium">Decision</th>
                    <th className="px-3 py-2 font-medium">Rule Codes</th>
                    <th className="px-3 py-2 font-medium">What we checked</th>
                    <th className="px-3 py-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {riskDecisions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-gray-500 dark:text-gray-400">
                        No decisions recorded.
                      </td>
                    </tr>
                  ) : (
                    riskDecisions.map((row) => {
                      const dec = String(row.decision ?? '')
                      return (
                        <tr key={row.id}>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{String(row.id ?? '—')}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {row.promotion_version_id != null ? String(row.promotion_version_id) : '—'}
                          </td>
                          <td className={`px-3 py-2 ${decisionClass(dec)}`}>{dec || '—'}</td>
                          <td className="max-w-[10rem] break-words px-3 py-2 text-xs">
                            {Array.isArray(row.rule_codes) ? row.rule_codes.join(', ') : '—'}
                          </td>
                          <td className="max-w-md px-3 py-2">
                            {row.inputs !== undefined ? (
                              <div className="max-h-40 overflow-auto">
                                <ApiResultSummary data={row.inputs} embedded />
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                            {row.created_at ?? '—'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </ComponentCard>

      <ComponentCard
        className="mt-6"
        title="Responsible gambling & account status"
        desc="Superadmin only. Sets self-exclusion end and account closure timestamps (audited). Use RFC3339 via the datetime pickers; empty string clears a field."
      >
        <div className="space-y-4 text-sm">
          {!isSuper ? (
            <p className="text-amber-700 dark:text-amber-400">Superadmin role required to edit compliance fields.</p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Self-exclusion until</p>
              <p className="mb-2 text-xs text-gray-600 dark:text-gray-300">
                Current:{' '}
                <span className="font-mono">
                  {typeof data?.self_excluded_until === 'string' && data.self_excluded_until
                    ? data.self_excluded_until
                    : '—'}
                </span>
              </p>
              <input
                type="datetime-local"
                lang="en-GB"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
                value={rgSelfExInput}
                disabled={!isSuper || rgBusy}
                onChange={(e) => setRgSelfExInput(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!isSuper || rgBusy || !rgSelfExInput.trim()}
                  className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs text-white hover:bg-brand-600 disabled:opacity-50"
                  onClick={() => void patchRgCompliance({ self_excluded_until: localInputToRFC3339(rgSelfExInput) })}
                >
                  Save self-exclusion
                </button>
                <button
                  type="button"
                  disabled={!isSuper || rgBusy}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
                  onClick={() => void patchRgCompliance({ self_excluded_until: '' })}
                >
                  Clear self-exclusion
                </button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Account closed at</p>
              <p className="mb-2 text-xs text-gray-600 dark:text-gray-300">
                Current:{' '}
                <span className="font-mono">
                  {typeof data?.account_closed_at === 'string' && data.account_closed_at
                    ? data.account_closed_at
                    : '—'}
                </span>
              </p>
              <input
                type="datetime-local"
                lang="en-GB"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
                value={rgClosedInput}
                disabled={!isSuper || rgBusy}
                onChange={(e) => setRgClosedInput(e.target.value)}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!isSuper || rgBusy || !rgClosedInput.trim()}
                  className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs text-white hover:bg-brand-600 disabled:opacity-50"
                  onClick={() => void patchRgCompliance({ account_closed_at: localInputToRFC3339(rgClosedInput) })}
                >
                  Save closure time
                </button>
                <button
                  type="button"
                  disabled={!isSuper || rgBusy}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-600"
                  onClick={() => void patchRgCompliance({ account_closed_at: '' })}
                >
                  Clear closure
                </button>
              </div>
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
              Reason (optional, stored in audit log)
            </span>
            <input
              type="text"
              className="w-full max-w-xl rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
              value={rgReason}
              disabled={!isSuper || rgBusy}
              onChange={(e) => setRgReason(e.target.value)}
              placeholder="e.g. Player request CHAT-1234"
            />
          </label>
        </div>
      </ComponentCard>

      {isSuper ? (
        <ComponentCard
          className="mt-6"
          title="Data erasure (GDPR-style)"
          desc="Queues a worker job to anonymize this player: scrambled email, cleared username/avatar/preferences, invalid password hash, all sessions removed."
        >
          <button
            type="button"
            disabled={erasureBusy}
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            onClick={() => void queuePlayerErasure()}
          >
            {erasureBusy ? 'Queueing…' : 'Queue player erasure job'}
          </button>
        </ComponentCard>
      ) : null}

      <ComponentCard
        className="mt-6"
        title="Compliance Export"
        desc="FR-OPS-06 · JSON download (Content-Disposition attachment)"
      >
        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={!id}
            className="w-fit rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white hover:bg-brand-600 disabled:opacity-50"
            onClick={() => void downloadComplianceExport()}
          >
            Download Compliance Export
          </button>
          {complianceMsg ? (
            <p
              className={
                complianceMsg.kind === 'ok'
                  ? 'text-sm text-green-600 dark:text-green-400'
                  : 'text-sm text-red-600 dark:text-red-400'
              }
            >
              {complianceMsg.text}
            </p>
          ) : null}
        </div>
      </ComponentCard>
    </>
  )
}
