import { useCallback, useEffect, useState } from 'react'
import { readApiError, formatApiError } from '../../api/errors'
import { useAdminAuth } from '../../authContext'
import { ApiResultSummary } from '../admin/ApiResultSummary'
import { SelectField, adminInputCls } from '../admin-ui'
import { ADMIN_CURRENCY_OPTIONS } from '../../lib/adminCurrencies'
import { COUNTRY_OPTIONS, flagEmoji } from '../../lib/countryIsoList'

type BonusInstance = {
  id: string
  user_id: string
  user_email?: string
  user_username?: string
  promotion_version_id: number
  status: string
  granted_amount_minor: number
  currency: string
  wr_required_minor: number
  wr_contributed_minor: number
  created_at: string
}

type FailedJob = {
  id: number
  job_type: string
  error_text: string
  attempts: number
  created_at: string
  resolved_at?: string
}

type PromotionOption = {
  id: number
  name: string
  latest_version_id?: number
  status?: string
  has_published_version?: boolean
  grants_paused?: boolean
  player_hub_force_visible?: boolean
  latest_published_valid_from?: string
}

type SearchPlayer = {
  id: string
  email?: string
  username?: string
  avatar_url?: string
}

type PendingGrantConfirm = {
  userId: string
  promotionVersionId: number
  grantAmountMinor: number
  currency: string
  allowWithdrawable: boolean
  creditTarget: 'bonus_locked' | 'cash'
  existing: BonusInstance[]
}

type ManualGrantLogEntry = {
  id: number
  staff_email?: string
  created_at: string
  meta?: {
    user_id?: string
    promotion_version_id?: number
    grant_amount_minor?: number
    currency?: string
    funding_source?: string
    credit_pocket?: string
    allow_withdrawable?: boolean
    withdrawable?: boolean
  }
}

function promotionOperationalState(p: PromotionOption): 'live' | 'scheduled' | 'paused' | 'archived' | 'draft' {
  const raw = (p.status ?? '').trim().toLowerCase()
  if (raw === 'archived') return 'archived'
  if (!p.has_published_version) return 'draft'
  if (p.grants_paused === true) return 'paused'
  if (p.player_hub_force_visible) return 'live'
  const vf = p.latest_published_valid_from ? new Date(p.latest_published_valid_from) : null
  if (vf && !Number.isNaN(vf.getTime()) && vf.getTime() > Date.now()) return 'scheduled'
  return 'live'
}

type OpsTab = 'instances' | 'simulate' | 'failed_jobs' | 'manual_grant' | 'manual_grants_log'

const TABS: { id: OpsTab; label: string }[] = [
  { id: 'instances', label: 'Instances' },
  { id: 'simulate', label: 'Simulate payment' },
  { id: 'failed_jobs', label: 'Failed jobs' },
  { id: 'manual_grant', label: 'Manual grant' },
  { id: 'manual_grants_log', label: 'Manual grants log' },
]

const primaryBtn = 'btn btn-primary btn-sm'
const inputCls = adminInputCls
const labelCls = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400'
const simCountrySelectOptions = [
  { value: '', label: '— Any country —' },
  ...COUNTRY_OPTIONS.map((c) => ({ value: c.code, label: `${flagEmoji(c.code)} ${c.name} (${c.code})` })),
]
const manualCurrencyOptions = ADMIN_CURRENCY_OPTIONS

function errFromParsedBody(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error
    if (err?.code) return { code: err.code, message: err.message ?? '', status }
  }
  return null
}

export default function BonusOperationsTools() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const showRawApiDebug =
    isSuper && typeof localStorage !== 'undefined' && localStorage.getItem('admin_debug_raw') === '1'

  const [tab, setTab] = useState<OpsTab>('instances')

  const [instances, setInstances] = useState<BonusInstance[]>([])
  const [instancesLoading, setInstancesLoading] = useState(false)
  const [instancesErr, setInstancesErr] = useState<string | null>(null)
  const [userFilter, setUserFilter] = useState('')
  const [forfeitBusyId, setForfeitBusyId] = useState<string | null>(null)

  const [simUserId, setSimUserId] = useState('')
  const [simAmount, setSimAmount] = useState('')
  const [simCurrency, setSimCurrency] = useState('USDT')
  const [simChannel, setSimChannel] = useState('on_chain_deposit')
  const [simProviderRes, setSimProviderRes] = useState('')
  const [simDepositIndex, setSimDepositIndex] = useState('0')
  const [simFirstDeposit, setSimFirstDeposit] = useState(false)
  const [simCountry, setSimCountry] = useState('')
  const [simDryRun, setSimDryRun] = useState(true)
  const [simBusy, setSimBusy] = useState(false)
  const [simResult, setSimResult] = useState<unknown>(null)
  const [simErr, setSimErr] = useState<string | null>(null)

  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobsErr, setJobsErr] = useState<string | null>(null)
  const [retryBusyId, setRetryBusyId] = useState<number | null>(null)

  const [mgUserId, setMgUserId] = useState('')
  const [mgPlayerQuery, setMgPlayerQuery] = useState('')
  const [mgPlayerOptions, setMgPlayerOptions] = useState<SearchPlayer[]>([])
  const [mgSearchingPlayers, setMgSearchingPlayers] = useState(false)
  const [mgPromotionOptions, setMgPromotionOptions] = useState<PromotionOption[]>([])
  const [mgPromotionQuery, setMgPromotionQuery] = useState('')
  const [mgPromotionOpen, setMgPromotionOpen] = useState(false)
  const [mgPvid, setMgPvid] = useState('')
  const [mgAmount, setMgAmount] = useState('')
  const [mgCurrency, setMgCurrency] = useState('USDT')
  const [mgAllowWithdrawable, setMgAllowWithdrawable] = useState(false)
  /** Cash / seamless wallet (Blue Ocean real play, no promo bet rules). Default matches legacy bonus_locked grants. */
  const [mgCreditTarget, setMgCreditTarget] = useState<'bonus_locked' | 'cash'>('bonus_locked')
  const [mgBusy, setMgBusy] = useState(false)
  const [mgResult, setMgResult] = useState<unknown>(null)
  const [mgErr, setMgErr] = useState<string | null>(null)
  const [pendingGrantConfirm, setPendingGrantConfirm] = useState<PendingGrantConfirm | null>(null)
  const [mgLog, setMgLog] = useState<ManualGrantLogEntry[]>([])
  const [mgLogLoading, setMgLogLoading] = useState(false)
  const [mgLogErr, setMgLogErr] = useState<string | null>(null)
  const [mgLogQuery, setMgLogQuery] = useState('')

  const loadInstances = useCallback(async () => {
    setInstancesErr(null)
    setInstancesLoading(true)
    try {
      const q = new URLSearchParams({ limit: '50' })
      if (userFilter.trim()) q.set('user_id', userFilter.trim())
      const res = await apiFetch(`/v1/admin/bonushub/instances?${q.toString()}`)
      if (!res.ok) {
        const e = await readApiError(res)
        setInstancesErr(formatApiError(e, `Load failed (${res.status})`))
        setInstances([])
        return
      }
      const j = (await res.json()) as { instances?: BonusInstance[] }
      setInstances(j.instances ?? [])
    } catch {
      setInstancesErr('Network error loading instances')
      setInstances([])
    } finally {
      setInstancesLoading(false)
    }
  }, [apiFetch, userFilter])

  const forfeitInstance = async (id: string) => {
    setForfeitBusyId(id)
    setInstancesErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/instances/${id}/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'admin_manual' }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setInstancesErr(formatApiError(e, `Forfeit failed (${res.status})`))
        return
      }
      await loadInstances()
    } catch {
      setInstancesErr('Network error forfeiting instance')
    } finally {
      setForfeitBusyId(null)
    }
  }

  const loadFailedJobs = useCallback(async () => {
    setJobsErr(null)
    setJobsLoading(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/worker-failed-jobs?limit=50')
      if (!res.ok) {
        const e = await readApiError(res)
        setJobsErr(formatApiError(e, `Load failed (${res.status})`))
        setFailedJobs([])
        return
      }
      const j = (await res.json()) as { failed_jobs?: FailedJob[] }
      setFailedJobs(j.failed_jobs ?? [])
    } catch {
      setJobsErr('Network error loading failed jobs')
      setFailedJobs([])
    } finally {
      setJobsLoading(false)
    }
  }, [apiFetch])

  const retryJob = async (id: number) => {
    setRetryBusyId(id)
    setJobsErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/worker-failed-jobs/${id}/retry`, { method: 'POST' })
      if (!res.ok) {
        const e = await readApiError(res)
        setJobsErr(formatApiError(e, `Retry failed (${res.status})`))
        return
      }
      await loadFailedJobs()
    } catch {
      setJobsErr('Network error retrying job')
    } finally {
      setRetryBusyId(null)
    }
  }

  const runSimulate = async () => {
    setSimErr(null)
    setSimResult(null)
    const amount = Number.parseInt(simAmount, 10)
    const depIdx = Number.parseInt(simDepositIndex, 10) || 0
    if (!simUserId.trim() || !simProviderRes.trim() || Number.isNaN(amount) || amount <= 0) {
      setSimErr('user_id, provider_resource_id, and positive amount_minor are required')
      return
    }
    setSimBusy(true)
    try {
      const cc = simCountry.trim().toUpperCase()
      const res = await apiFetch('/v1/admin/bonushub/simulate-payment-settled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: simUserId.trim(),
          amount_minor: amount,
          currency: simCurrency.trim() || 'USDT',
          channel: simChannel,
          provider_resource_id: simProviderRes.trim(),
          ...(cc ? { country: cc } : {}),
          deposit_index: depIdx,
          first_deposit: simFirstDeposit,
          dry_run: simDryRun,
        }),
      })
      let j: unknown = null
      try {
        j = await res.json()
      } catch {
        j = null
      }
      if (!res.ok) {
        const e = errFromParsedBody(res.status, j)
        setSimErr(formatApiError(e, `Request failed (${res.status})`))
        setSimResult(j)
        return
      }
      setSimResult(j)
    } catch {
      setSimErr('Network error')
    } finally {
      setSimBusy(false)
    }
  }

  const performManualGrant = async (payload: {
    userId: string
    promotionVersionId: number
    grantAmountMinor: number
    currency: string
    allowWithdrawable: boolean
    creditTarget: 'bonus_locked' | 'cash'
  }) => {
    setMgErr(null)
    setMgResult(null)
    setMgBusy(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/instances/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: payload.userId,
          promotion_version_id: payload.promotionVersionId,
          grant_amount_minor: payload.grantAmountMinor,
          currency: payload.currency,
          allow_withdrawable: payload.allowWithdrawable,
          credit_target: payload.creditTarget,
        }),
      })
      let j: unknown = null
      try {
        j = await res.json()
      } catch {
        j = null
      }
      if (!res.ok) {
        const e = errFromParsedBody(res.status, j)
        setMgErr(formatApiError(e, `Grant failed (${res.status})`))
        setMgResult(j)
        return
      }
      setMgResult(j)
    } catch {
      setMgErr('Network error')
    } finally {
      setMgBusy(false)
    }
  }

  const manualGrant = async () => {
    const pvid = Number.parseInt(mgPvid, 10)
    const amt = Number.parseInt(mgAmount, 10)
    const uid = mgUserId.trim()
    const ccy = mgCurrency.trim() || 'USDT'
    const isCash = mgCreditTarget === 'cash'
    if (!uid || Number.isNaN(amt) || amt <= 0) {
      setMgErr('user_id and positive grant_amount_minor are required')
      return
    }
    if (!isCash && (Number.isNaN(pvid) || pvid <= 0)) {
      setMgErr('promotion_version_id is required for bonus wallet grants')
      return
    }

    // Safety pre-check: warn before issuing a likely duplicate grant (bonus path only).
    if (!isCash) {
      try {
        const q = new URLSearchParams({ user_id: uid, limit: '200' })
        const res = await apiFetch(`/v1/admin/bonushub/instances?${q.toString()}`)
        if (res.ok) {
          const j = (await res.json()) as { instances?: BonusInstance[] }
          const existing = (j.instances ?? []).filter((x) => x.promotion_version_id === pvid)
          if (existing.length > 0) {
            setPendingGrantConfirm({
              userId: uid,
              promotionVersionId: pvid,
              grantAmountMinor: amt,
              currency: ccy,
              allowWithdrawable: mgAllowWithdrawable,
              creditTarget: 'bonus_locked',
              existing,
            })
            return
          }
        }
      } catch {
        // Fail open to avoid blocking urgent manual remediation due to lookup error.
      }
    }

    await performManualGrant({
      userId: uid,
      promotionVersionId: isCash ? 0 : pvid,
      grantAmountMinor: amt,
      currency: ccy,
      allowWithdrawable: mgAllowWithdrawable,
      creditTarget: isCash ? 'cash' : 'bonus_locked',
    })
  }

  const loadManualGrantPromotionOptions = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/admin/bonushub/promotions?limit=200')
      if (!res.ok) {
        setMgPromotionOptions([])
        return
      }
      const j = (await res.json()) as { promotions?: PromotionOption[] }
      const rows = Array.isArray(j.promotions) ? j.promotions : []
      const liveOrArchived = rows.filter((p) => {
        const hasVersion = typeof p.latest_version_id === 'number' && p.latest_version_id > 0
        if (!hasVersion) return false
        const state = promotionOperationalState(p)
        return state === 'live' || state === 'scheduled' || state === 'archived'
      })
      liveOrArchived.sort((a, b) => a.name.localeCompare(b.name))
      setMgPromotionOptions(liveOrArchived)
    } catch {
      setMgPromotionOptions([])
    }
  }, [apiFetch])

  const loadManualGrantLog = useCallback(async () => {
    setMgLogErr(null)
    setMgLogLoading(true)
    try {
      const res = await apiFetch('/v1/admin/audit-log?action=bonushub.manual_grant&limit=200')
      if (!res.ok) {
        const e = await readApiError(res)
        setMgLogErr(formatApiError(e, `Load failed (${res.status})`))
        setMgLog([])
        return
      }
      const j = (await res.json()) as { entries?: ManualGrantLogEntry[] }
      setMgLog(Array.isArray(j.entries) ? j.entries : [])
    } catch {
      setMgLogErr('Network error loading manual grant log')
      setMgLog([])
    } finally {
      setMgLogLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (tab === 'instances') void loadInstances()
  }, [tab, loadInstances])

  useEffect(() => {
    if (tab === 'failed_jobs') void loadFailedJobs()
  }, [tab, loadFailedJobs])

  useEffect(() => {
    if (tab !== 'manual_grant') return
    void loadManualGrantPromotionOptions()
  }, [tab, loadManualGrantPromotionOptions])

  useEffect(() => {
    if (tab !== 'manual_grants_log') return
    void loadManualGrantLog()
  }, [tab, loadManualGrantLog])

  useEffect(() => {
    if (tab !== 'manual_grant') return
    const q = mgPlayerQuery.trim()
    if (!q || q.length < 2) {
      setMgPlayerOptions([])
      return
    }
    let cancelled = false
    const t = window.setTimeout(async () => {
      setMgSearchingPlayers(true)
      try {
        const res = await apiFetch(`/v1/admin/search?q=${encodeURIComponent(q)}`)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { players?: SearchPlayer[] }
        if (cancelled) return
        setMgPlayerOptions(Array.isArray(j.players) ? j.players : [])
      } catch {
        if (!cancelled) setMgPlayerOptions([])
      } finally {
        if (!cancelled) setMgSearchingPlayers(false)
      }
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [tab, mgPlayerQuery, apiFetch])

  const filteredMgPromotionOptions = mgPromotionOptions.filter((p) => {
    const q = mgPromotionQuery.trim().toLowerCase()
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      String(p.latest_version_id ?? '').includes(q) ||
      (p.status ?? '').toLowerCase().includes(q)
    )
  })

  const filteredManualGrantLog = mgLog.filter((row) => {
    const q = mgLogQuery.trim().toLowerCase()
    if (!q) return true
    const meta = row.meta ?? {}
    return (
      String(row.id).includes(q) ||
      (row.staff_email ?? '').toLowerCase().includes(q) ||
      (meta.user_id ?? '').toLowerCase().includes(q) ||
      String(meta.promotion_version_id ?? '').includes(q) ||
      String(meta.grant_amount_minor ?? '').includes(q) ||
      (meta.currency ?? '').toLowerCase().includes(q) ||
      (meta.funding_source ?? '').toLowerCase().includes(q) ||
      (meta.credit_pocket ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <>
      <div className="mb-3 d-flex flex-wrap align-items-center gap-2">
        <div className="btn-group btn-group-sm flex-wrap" role="group" aria-label="Operations tools">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`btn ${tab === id ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'instances' ? (
        <>
          {instancesErr ? <p className="mb-3 text-sm text-danger">{instancesErr}</p> : null}
          <div className="mb-4 d-flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className={labelCls} htmlFor="inst-user-inline">
                User ID (optional)
              </label>
              <input
                id="inst-user-inline"
                className={inputCls}
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                placeholder="uuid"
              />
            </div>
            <button type="button" className={primaryBtn} onClick={() => void loadInstances()} disabled={instancesLoading}>
              {instancesLoading ? 'Loading…' : 'Apply filter'}
            </button>
          </div>
          {instancesLoading && instances.length === 0 ? (
            <p className="small text-secondary mb-0">Loading…</p>
          ) : (
            <div className="table-responsive rounded border">
              <table className="table table-sm mb-0">
                <thead className="table-light">
                  <tr>
                    <th>ID</th>
                    <th>Customer</th>
                    <th>Promo version</th>
                    <th>Status</th>
                    <th>Granted</th>
                    <th>WR req.</th>
                    <th>WR done</th>
                    <th>Created</th>
                    <th>Forfeit</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((i) => (
                    <tr key={i.id}>
                      <td className="font-monospace small">{i.id.slice(0, 8)}…</td>
                      <td className="small">
                        <div className="fw-semibold text-break">{i.user_email?.trim() || i.user_username?.trim() || 'Customer'}</div>
                        <div className="text-secondary font-monospace" style={{ fontSize: '0.72rem' }}>
                          {i.user_id}
                        </div>
                      </td>
                      <td>{i.promotion_version_id}</td>
                      <td>{i.status}</td>
                      <td>
                        {i.granted_amount_minor} {i.currency}
                      </td>
                      <td>{i.wr_required_minor}</td>
                      <td>{i.wr_contributed_minor}</td>
                      <td className="small text-secondary">{i.created_at}</td>
                      <td>
                        {i.status === 'active' ? (
                          <button
                            type="button"
                            className={primaryBtn}
                            disabled={forfeitBusyId === i.id}
                            onClick={() => void forfeitInstance(i.id)}
                          >
                            {forfeitBusyId === i.id ? '…' : 'Forfeit'}
                          </button>
                        ) : (
                          <span className="small text-secondary">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {tab === 'simulate' ? (
        <>
          {!isSuper ? <p className="mb-3 small text-warning">Superadmin only.</p> : null}
          {simErr ? <p className="mb-3 text-sm text-danger">{simErr}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Player ID</label>
              <input className={inputCls} value={simUserId} onChange={(e) => setSimUserId(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Deposit amount (minor units)</label>
              <input type="number" className={inputCls} value={simAmount} onChange={(e) => setSimAmount(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <SelectField
                id="sim-inline-currency"
                label="Currency"
                value={simCurrency}
                onChange={setSimCurrency}
                options={manualCurrencyOptions}
                disabled={!isSuper}
              />
            </div>
            <div>
              <label className={labelCls}>channel</label>
              <select className={inputCls} value={simChannel} onChange={(e) => setSimChannel(e.target.value)}>
                <option value="on_chain_deposit">on_chain_deposit</option>
                <option value="hosted_checkout">hosted_checkout</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <SelectField
                id="sim-inline-country"
                label="Simulated country (optional)"
                value={simCountry}
                onChange={setSimCountry}
                options={simCountrySelectOptions}
                disabled={!isSuper}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Provider payment reference</label>
              <input className={inputCls} value={simProviderRes} onChange={(e) => setSimProviderRes(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Which deposit (1st, 2nd, ...)</label>
              <input
                type="number"
                className={inputCls}
                value={simDepositIndex}
                onChange={(e) => setSimDepositIndex(e.target.value)}
              />
            </div>
            <div className="d-flex flex-wrap align-items-center gap-3">
              <label className="d-flex align-items-center gap-2 small">
                <input type="checkbox" checked={simFirstDeposit} onChange={(e) => setSimFirstDeposit(e.target.checked)} />
                Count as first deposit
              </label>
              <label className="d-flex align-items-center gap-2 small">
                <input type="checkbox" checked={simDryRun} onChange={(e) => setSimDryRun(e.target.checked)} />
                Preview only
              </label>
            </div>
          </div>
          <button type="button" className={`mt-3 ${primaryBtn}`} onClick={() => void runSimulate()} disabled={simBusy || !isSuper}>
            {simBusy ? 'Submitting…' : 'Submit'}
          </button>
          {simResult != null ? (
            <div className="mt-3">
              <ApiResultSummary data={simResult} />
              {showRawApiDebug ? <pre className="small mt-2">{JSON.stringify(simResult, null, 2)}</pre> : null}
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'failed_jobs' ? (
        <>
          {jobsErr ? <p className="mb-3 text-sm text-danger">{jobsErr}</p> : null}
          {jobsLoading && failedJobs.length === 0 ? (
            <p className="small text-secondary mb-0">Loading…</p>
          ) : (
            <div className="table-responsive rounded border">
              <table className="table table-sm mb-0">
                <thead className="table-light">
                  <tr>
                    <th>ID</th>
                    <th>Job type</th>
                    <th>Error</th>
                    <th>Attempts</th>
                    <th>Created</th>
                    <th>Resolved</th>
                    <th>Retry</th>
                  </tr>
                </thead>
                <tbody>
                  {failedJobs.map((j) => (
                    <tr key={j.id}>
                      <td className="font-monospace small">{j.id}</td>
                      <td className="font-monospace small">{j.job_type}</td>
                      <td className="small text-danger">{j.error_text}</td>
                      <td>{j.attempts}</td>
                      <td className="small text-secondary">{j.created_at}</td>
                      <td className="small text-secondary">{j.resolved_at ?? '—'}</td>
                      <td>
                        {!j.resolved_at ? (
                          <button
                            type="button"
                            className={primaryBtn}
                            disabled={!isSuper || retryBusyId === j.id}
                            onClick={() => void retryJob(j.id)}
                          >
                            {retryBusyId === j.id ? '…' : 'Retry'}
                          </button>
                        ) : (
                          <span className="small text-secondary">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button type="button" className={`mt-3 ${primaryBtn}`} onClick={() => void loadFailedJobs()} disabled={jobsLoading}>
            Refresh
          </button>
        </>
      ) : null}

      {tab === 'manual_grant' ? (
        <>
          {!isSuper ? <p className="mb-3 small text-warning">Superadmin only.</p> : null}
          {mgErr ? <p className="mb-3 text-sm text-danger">{mgErr}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Credit target</label>
              <div className="d-flex flex-wrap gap-3">
                <div className="form-check">
                  <input
                    id="mg-ct-bonus"
                    className="form-check-input"
                    type="radio"
                    checked={mgCreditTarget === 'bonus_locked'}
                    onChange={() => setMgCreditTarget('bonus_locked')}
                  />
                  <label className="form-check-label small" htmlFor="mg-ct-bonus">
                    Bonus wallet (promotion + WR; max bet / excluded games apply)
                  </label>
                </div>
                <div className="form-check">
                  <input
                    id="mg-ct-cash"
                    className="form-check-input"
                    type="radio"
                    checked={mgCreditTarget === 'cash'}
                    onChange={() => setMgCreditTarget('cash')}
                  />
                  <label className="form-check-label small" htmlFor="mg-ct-cash">
                    Cash / seamless wallet (Blue Ocean real play — no promo bet guards)
                  </label>
                </div>
              </div>
              {mgCreditTarget === 'cash' ? (
                <p className="small text-secondary mt-2 mb-0">
                  Match <strong>currency</strong> to your seamless wallet (<code>BLUEOCEAN_CURRENCY</code> / multicurrency),
                  or the balance may not appear in-game.
                </p>
              ) : null}
            </div>
            <div>
              <label className={labelCls}>Player (UUID / email / username)</label>
              <input
                className={inputCls}
                value={mgPlayerQuery}
                onChange={(e) => {
                  const v = e.target.value
                  setMgPlayerQuery(v)
                  if (v.length >= 32) setMgUserId(v)
                }}
                placeholder="Search by UUID, email, or username"
              />
              {mgSearchingPlayers ? <p className="small text-secondary mt-1 mb-0">Searching players…</p> : null}
              {mgPlayerOptions.length > 0 ? (
                <div className="list-group mt-2" style={{ maxHeight: 190, overflowY: 'auto' }}>
                  {mgPlayerOptions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="list-group-item list-group-item-action py-2"
                      onClick={() => {
                        setMgUserId(p.id)
                        setMgPlayerQuery(p.email?.trim() || p.username?.trim() || p.id)
                        setMgPlayerOptions([])
                      }}
                    >
                      <div className="d-flex align-items-center gap-2">
                        {p.avatar_url ? (
                          <img
                            src={p.avatar_url}
                            alt="avatar"
                            width={22}
                            height={22}
                            className="rounded-circle border border-secondary-subtle flex-shrink-0"
                          />
                        ) : (
                          <span
                            className="rounded-circle bg-secondary-subtle border border-secondary-subtle d-inline-flex align-items-center justify-content-center flex-shrink-0"
                            style={{ width: 22, height: 22, fontSize: 11 }}
                          >
                            <i className="bi bi-person-fill" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="fw-semibold text-break">{p.email || p.username || 'Player'}</div>
                          <div className="small text-secondary font-monospace text-break">{p.id}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="small text-secondary mt-1 mb-0">Selected player UUID: {mgUserId || '—'}</p>
            </div>
            <div className={mgCreditTarget === 'cash' ? 'opacity-50 user-select-none' : ''} style={mgCreditTarget === 'cash' ? { pointerEvents: 'none' } : undefined}>
              <label className={labelCls}>Bonus to re-grant {mgCreditTarget === 'cash' ? <span className="text-secondary">(bonus path only)</span> : null}</label>
              <input
                className={`${inputCls} mb-2`}
                value={mgPromotionQuery}
                onFocus={() => setMgPromotionOpen(true)}
                onChange={(e) => {
                  setMgPromotionQuery(e.target.value)
                  setMgPromotionOpen(true)
                }}
                placeholder="Search live/archived bonus by name/version/status"
              />
              {mgPromotionOpen ? (
                <div className="list-group" style={{ maxHeight: 210, overflowY: 'auto' }}>
                  {filteredMgPromotionOptions.length === 0 ? (
                    <div className="list-group-item small text-secondary">No bonuses match this search.</div>
                  ) : (
                    filteredMgPromotionOptions.map((p) => {
                      const state = promotionOperationalState(p).toUpperCase()
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className="list-group-item list-group-item-action py-2"
                          onClick={() => {
                            setMgPvid(String(p.latest_version_id))
                            setMgPromotionQuery(`${p.name} (v${p.latest_version_id})`)
                            setMgPromotionOpen(false)
                          }}
                        >
                          <div className="fw-semibold text-break">{p.name}</div>
                          <div className="small text-secondary">
                            v{p.latest_version_id} · {state}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              ) : null}
              <p className="small text-secondary mt-1 mb-0">Selected promotion version: {mgPvid || '—'}</p>
            </div>
            <div>
              <label className={labelCls}>
                {mgCreditTarget === 'cash' ? 'Amount (minor units · cash / seamless)' : 'Bonus amount (minor units · play-only)'}
              </label>
              <input type="number" className={inputCls} value={mgAmount} onChange={(e) => setMgAmount(e.target.value)} />
              <p className="small text-secondary mt-1 mb-0">
                {mgCreditTarget === 'cash' ? (
                  <>
                    Credited to <strong>cash</strong>. Blue Ocean debits this first (real-money seamless path), same idea as
                    operator-funded test balance.
                  </>
                ) : (
                  <>
                    Funded from the <strong>casino bonus wallet</strong> and credited to <strong>bonus_locked</strong> only
                    (play-only, non-withdrawable as direct cash).
                  </>
                )}
              </p>
              <p className="small text-secondary mt-1 mb-0">
                {mgCreditTarget === 'cash'
                  ? 'Withdraw / compliance follows normal cash wallet rules in your environment.'
                  : 'Release/withdraw eligibility is controlled by the promotion&apos;s wagering rules and terms.'}
              </p>
              <div className="form-check mt-2">
                <input
                  id="mg-allow-withdrawable"
                  className="form-check-input"
                  type="checkbox"
                  checked={mgAllowWithdrawable}
                  onChange={(e) => setMgAllowWithdrawable(e.target.checked)}
                />
                <label className="form-check-label small" htmlFor="mg-allow-withdrawable">
                  Explicitly allow withdraw behavior for this manual credit (override default non-withdrawable)
                </label>
              </div>
            </div>
            <div className="sm:col-span-2">
              <SelectField
                id="mg-inline-currency"
                label="Currency"
                value={mgCurrency}
                onChange={setMgCurrency}
                options={manualCurrencyOptions}
                disabled={!isSuper}
              />
            </div>
          </div>
          <button type="button" className={`mt-3 ${primaryBtn}`} onClick={() => void manualGrant()} disabled={mgBusy || !isSuper}>
            {mgBusy ? 'Granting…' : 'Grant'}
          </button>
          {mgResult != null ? (
            <div className="mt-3">
              <ApiResultSummary data={mgResult} />
              {showRawApiDebug ? <pre className="small mt-2">{JSON.stringify(mgResult, null, 2)}</pre> : null}
            </div>
          ) : null}
        </>
      ) : null}

      {tab === 'manual_grants_log' ? (
        <>
          {mgLogErr ? <p className="mb-3 text-sm text-danger">{mgLogErr}</p> : null}
          <div className="mb-3 d-flex flex-wrap align-items-end gap-2">
            <div className="min-w-[280px] flex-1">
              <label className={labelCls}>Search grants (customer, promo version, amount, staff)</label>
              <input
                className={inputCls}
                value={mgLogQuery}
                onChange={(e) => setMgLogQuery(e.target.value)}
                placeholder="Search user UUID, promotion version, amount, currency, staff email"
              />
            </div>
            <button type="button" className={primaryBtn} onClick={() => void loadManualGrantLog()} disabled={mgLogLoading}>
              {mgLogLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {mgLogLoading && mgLog.length === 0 ? (
            <p className="small text-secondary mb-0">Loading…</p>
          ) : (
            <div className="table-responsive rounded border">
              <table className="table table-sm mb-0">
                <thead className="table-light">
                  <tr>
                    <th>When</th>
                    <th>Customer UUID</th>
                    <th>Promo v</th>
                    <th>Amount</th>
                    <th>Withdrawable</th>
                    <th>Funding</th>
                    <th>Granted by</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredManualGrantLog.map((row) => {
                    const meta = row.meta ?? {}
                    const withdrawable = meta.allow_withdrawable ?? meta.withdrawable ?? false
                    return (
                      <tr key={row.id}>
                        <td className="small text-secondary">{new Date(row.created_at).toLocaleString('en-GB')}</td>
                        <td className="font-monospace small">{meta.user_id ?? '—'}</td>
                        <td>{meta.promotion_version_id ?? '—'}</td>
                        <td>
                          {meta.grant_amount_minor ?? 0} {meta.currency ?? 'USDT'}
                        </td>
                        <td>
                          <span className={`badge ${withdrawable ? 'text-bg-warning' : 'text-bg-success'}`}>
                            {withdrawable ? 'Explicitly allowed' : 'No (default)'}
                          </span>
                        </td>
                        <td className="small">
                          <div className="fw-semibold">{meta.funding_source ?? 'brand_bonus_wallet'}</div>
                          <div className="text-secondary">{meta.credit_pocket ?? 'bonus_locked'}</div>
                        </td>
                        <td className="small">{row.staff_email?.trim() || 'Staff'}</td>
                      </tr>
                    )
                  })}
                  {filteredManualGrantLog.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="small text-secondary text-center py-3">
                        No manual grants found for this filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {pendingGrantConfirm ? (
        <div
          className="modal fade show d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          aria-modal="true"
          role="dialog"
        >
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Customer already has this grant version</h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setPendingGrantConfirm(null)}
                />
              </div>
              <div className="modal-body small">
                <p className="mb-2">
                  This player already has <strong>{pendingGrantConfirm.existing.length}</strong> existing instance(s) for
                  promotion version <strong>{pendingGrantConfirm.promotionVersionId}</strong>.
                </p>
                <p className="mb-2 text-warning">
                  Granting again may create a duplicate compensation. Continue only if this is intentional.
                </p>
                <p className="mb-2 text-secondary">
                  This grant is funded from the <strong>casino bonus wallet</strong> and applied as
                  <strong> play-only bonus balance</strong>.{' '}
                  {pendingGrantConfirm.allowWithdrawable ? (
                    <>Withdraw behavior is explicitly enabled for this grant.</>
                  ) : (
                    <>Default non-withdrawable policy is enforced unless explicitly enabled.</>
                  )}{' '}
                  Wagering rules still apply.
                </p>
                <div className="small text-secondary">
                  Existing statuses: {pendingGrantConfirm.existing.map((x) => x.status).join(', ')}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPendingGrantConfirm(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-warning btn-sm"
                  disabled={mgBusy}
                  onClick={() => {
                    void performManualGrant({
                      userId: pendingGrantConfirm.userId,
                      promotionVersionId: pendingGrantConfirm.promotionVersionId,
                      grantAmountMinor: pendingGrantConfirm.grantAmountMinor,
                      currency: pendingGrantConfirm.currency,
                      allowWithdrawable: pendingGrantConfirm.allowWithdrawable,
                      creditTarget: pendingGrantConfirm.creditTarget,
                    })
                    setPendingGrantConfirm(null)
                  }}
                >
                  Confirm and grant anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
