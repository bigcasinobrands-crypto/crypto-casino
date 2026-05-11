import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'
import { SelectField, adminInputCls } from '../components/admin-ui'
import { ADMIN_CURRENCY_OPTIONS } from '../lib/adminCurrencies'
import { COUNTRY_OPTIONS, flagEmoji } from '../lib/countryIsoList'

const TABS = ['instances', 'simulate', 'failed_jobs', 'manual_grant'] as const
type BonusHubTab = (typeof TABS)[number]

const OPERATIONS_TABS: { id: BonusHubTab; label: string }[] = [
  { id: 'instances', label: 'Instances' },
  { id: 'simulate', label: 'Simulate payment' },
  { id: 'failed_jobs', label: 'Failed jobs' },
  { id: 'manual_grant', label: 'Manual grant' },
]

type BonusInstance = {
  id: string
  user_id: string
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

function newAdminGrantIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`
}

export default function BonusHubOperationsPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const showRawApiDebug =
    isSuper && typeof localStorage !== 'undefined' && localStorage.getItem('admin_debug_raw') === '1'
  const [searchParams, setSearchParams] = useSearchParams()

  const tabFromUrl = useMemo((): BonusHubTab => {
    const raw = (searchParams.get('tab') || 'instances').toLowerCase()
    if (raw === 'automation') return 'simulate'
    return (TABS as readonly string[]).includes(raw) ? (raw as BonusHubTab) : 'instances'
  }, [searchParams])
  const [tab, setTabState] = useState<BonusHubTab>(tabFromUrl)

  useEffect(() => setTabState(tabFromUrl), [tabFromUrl])

  const setTab = useCallback(
    (next: BonusHubTab) => {
      setTabState(next)
      setSearchParams((prev) => {
        const p = new URLSearchParams(prev)
        p.set('tab', next)
        return p
      })
    },
    [setSearchParams],
  )

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
  const [mgPvid, setMgPvid] = useState('')
  const [mgAmount, setMgAmount] = useState('')
  const [mgCurrency, setMgCurrency] = useState('USDT')
  const [mgCreditTarget, setMgCreditTarget] = useState<'bonus_locked' | 'cash' | 'bonus_active'>('cash')
  const [mgBonusInstanceId, setMgBonusInstanceId] = useState('')
  const [mgBusy, setMgBusy] = useState(false)
  const [mgResult, setMgResult] = useState<unknown>(null)
  const [mgErr, setMgErr] = useState<string | null>(null)

  useEffect(() => {
    if (mgCreditTarget !== 'cash') return
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch('/v1/admin/integrations/blueocean/status')
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { settlement_currency?: string }
        const s = (j.settlement_currency || 'EUR').trim().toUpperCase() || 'EUR'
        if (!cancelled) setMgCurrency(s)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mgCreditTarget, apiFetch])

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

  const manualGrant = async () => {
    setMgErr(null)
    setMgResult(null)
    const pvid = Number.parseInt(mgPvid, 10)
    const amt = Number.parseInt(mgAmount, 10)
    const isCash = mgCreditTarget === 'cash'
    const isActiveTopUp = mgCreditTarget === 'bonus_active'
    if (!mgUserId.trim() || Number.isNaN(amt) || amt <= 0) {
      setMgErr('user_id and positive grant_amount_minor are required')
      return
    }
    if (isActiveTopUp) {
      if (!mgBonusInstanceId.trim()) {
        setMgErr('bonus_instance_id (UUID) is required for active bonus top-up')
        return
      }
    } else if (!isCash && (Number.isNaN(pvid) || pvid <= 0)) {
      setMgErr('promotion_version_id is required for new bonus grants')
      return
    }
    setMgBusy(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/instances/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: mgUserId.trim(),
          promotion_version_id: isCash || isActiveTopUp ? 0 : pvid,
          grant_amount_minor: amt,
          currency: mgCurrency.trim() || 'USDT',
          credit_target: isCash ? 'cash' : isActiveTopUp ? 'bonus_active' : 'bonus_locked',
          ...(isActiveTopUp && mgBonusInstanceId.trim() ? { bonus_instance_id: mgBonusInstanceId.trim() } : {}),
          idempotency_key: newAdminGrantIdempotencyKey(),
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

  useEffect(() => {
    if (tab === 'instances') void loadInstances()
  }, [tab, loadInstances])
  useEffect(() => {
    if (tab === 'failed_jobs') void loadFailedJobs()
  }, [tab, loadFailedJobs])

  const legacyTab = searchParams.get('tab')?.toLowerCase() ?? ''
  if (legacyTab === 'promotions' || legacyTab === 'dashboard' || legacyTab === 'active_offers') {
    return <Navigate to="/bonushub" replace />
  }
  if (legacyTab === 'risk') return <Navigate to="/bonushub/risk" replace />

  return (
    <>
      <PageMeta title="Bonus Engine · Operations" description="Operational tools for bonus processing and troubleshooting." />
      <PageBreadcrumb pageTitle="Bonus Engine · Operations" />

      <div className="card border shadow-sm mb-4">
        <div className="card-body py-3">
          <p className="text-secondary text-uppercase fw-semibold mb-2" style={{ fontSize: '0.65rem', letterSpacing: '0.07em' }}>
            Operations
          </p>
          <p className="text-secondary small mb-3 lh-sm">
            This page is tools-only. Promotions overview and KPI tracking now live on <strong>Bonus Hub</strong>.
          </p>
          <div className="btn-group btn-group-sm flex-wrap" role="group" aria-label="Operations tools">
            {OPERATIONS_TABS.map(({ id, label }) => (
              <button key={id} type="button" className={`btn ${tab === id ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'instances' ? (
        <ComponentCard title="Bonus instances" desc="Filter by user UUID optional. Forfeit sends reason admin_manual.">
          {instancesErr ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{instancesErr}</p> : null}
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <label className={labelCls} htmlFor="inst-user">
                User ID (optional)
              </label>
              <input
                id="inst-user"
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
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">ID</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">User</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Promo version</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Granted</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">WR req.</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">WR done</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Created</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Forfeit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                  {instances.map((i) => (
                    <tr key={i.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{i.id.slice(0, 8)}…</td>
                      <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs" title={i.user_id}>
                        {i.user_id}
                      </td>
                      <td className="px-3 py-2">{i.promotion_version_id}</td>
                      <td className="px-3 py-2">{i.status}</td>
                      <td className="px-3 py-2">
                        {i.granted_amount_minor} {i.currency}
                      </td>
                      <td className="px-3 py-2">{i.wr_required_minor}</td>
                      <td className="px-3 py-2">{i.wr_contributed_minor}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {i.created_at}
                      </td>
                      <td className="px-3 py-2">
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
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ComponentCard>
      ) : null}

      {tab === 'simulate' ? (
        <ComponentCard
          title="Simulate payment settled"
          desc="Superadmin. Models the deposit.credit → bonus_payment_settled path (not Blue Ocean game wallet). Use dry_run first; set country to test geo targeting. Uncheck dry_run to actually grant (respects risk + idempotency)."
        >
          {!isSuper ? (
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">Superadmin only.</p>
          ) : null}
          {simErr ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{simErr}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="sim-user">
                Player ID
              </label>
              <input
                id="sim-user"
                className={inputCls}
                value={simUserId}
                onChange={(e) => setSimUserId(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="sim-amt">
                Deposit amount (minor units)
              </label>
              <input
                id="sim-amt"
                type="number"
                className={inputCls}
                value={simAmount}
                onChange={(e) => setSimAmount(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <SelectField
                id="sim-ccy"
                label="Currency"
                value={simCurrency}
                onChange={setSimCurrency}
                options={manualCurrencyOptions}
                disabled={!isSuper}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="sim-ch">
                channel
              </label>
              <select
                id="sim-ch"
                className={inputCls}
                value={simChannel}
                onChange={(e) => setSimChannel(e.target.value)}
              >
                <option value="on_chain_deposit">on_chain_deposit</option>
                <option value="hosted_checkout">hosted_checkout</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <SelectField
                id="sim-cc"
                label="Simulated country (optional)"
                hint="Used to test segment geo allow/deny rules."
                value={simCountry}
                onChange={(v) => setSimCountry(v)}
                options={simCountrySelectOptions}
                disabled={!isSuper}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="sim-pr">
                Provider payment reference
              </label>
              <input
                id="sim-pr"
                className={inputCls}
                value={simProviderRes}
                onChange={(e) => setSimProviderRes(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="sim-di">
                Which deposit (1st, 2nd, …)
              </label>
              <input
                id="sim-di"
                type="number"
                className={inputCls}
                value={simDepositIndex}
                onChange={(e) => setSimDepositIndex(e.target.value)}
              />
            </div>
            <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-center">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={simFirstDeposit}
                  onChange={(e) => setSimFirstDeposit(e.target.checked)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                Count as first deposit
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={simDryRun}
                  onChange={(e) => setSimDryRun(e.target.checked)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                Preview only (do not grant)
              </label>
            </div>
          </div>
          <button
            type="button"
            className={`mt-4 ${primaryBtn}`}
            onClick={() => void runSimulate()}
            disabled={simBusy || !isSuper}
          >
            {simBusy ? 'Submitting…' : 'Submit'}
          </button>
          {simResult != null ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Result</p>
              <ApiResultSummary data={simResult} />
              {showRawApiDebug ? (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-brand-600 dark:text-brand-400">
                    Developer: raw response (localStorage admin_debug_raw=1)
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-800 dark:bg-white/10 dark:text-gray-200">
                    {JSON.stringify(simResult, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </ComponentCard>
      ) : null}

      {tab === 'failed_jobs' ? (
        <ComponentCard title="Worker failed jobs" desc="Retry re-enqueues unresolved jobs (superadmin).">
          {!isSuper ? (
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">Retry requires superadmin.</p>
          ) : null}
          {jobsErr ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{jobsErr}</p> : null}
          {jobsLoading && failedJobs.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">ID</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Job type</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Error</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Attempts</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Created</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Resolved</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Retry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                  {failedJobs.map((j) => (
                    <tr key={j.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{j.id}</td>
                      <td className="px-3 py-2 font-mono text-xs">{j.job_type}</td>
                      <td className="max-w-xs truncate px-3 py-2 text-xs text-red-700 dark:text-red-300" title={j.error_text}>
                        {j.error_text}
                      </td>
                      <td className="px-3 py-2">{j.attempts}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {j.created_at}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {j.resolved_at ?? '—'}
                      </td>
                      <td className="px-3 py-2">
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
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button
            type="button"
            className={`mt-4 ${primaryBtn}`}
            onClick={() => void loadFailedJobs()}
            disabled={jobsLoading}
          >
            Refresh
          </button>
        </ComponentCard>
      ) : null}

      {tab === 'manual_grant' ? (
        <ComponentCard
          title="Manual grant"
          desc="Superadmin. Defaults to real (cash) balance. New bonus creates a promo instance; active bonus tops up an existing instance."
        >
          {!isSuper ? (
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">Superadmin only.</p>
          ) : null}
          {mgErr ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{mgErr}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-2">
              <span className={labelCls}>Credit target</span>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="mg-credit"
                    checked={mgCreditTarget === 'cash'}
                    onChange={() => setMgCreditTarget('cash')}
                  />
                  Real balance (withdrawable / seamless)
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="mg-credit"
                    checked={mgCreditTarget === 'bonus_locked'}
                    onChange={() => setMgCreditTarget('bonus_locked')}
                  />
                  New bonus (promotion + bonus_locked)
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input type="radio" name="mg-credit" checked={mgCreditTarget === 'bonus_active'} onChange={() => setMgCreditTarget('bonus_active')} />
                  Active bonus (top-up instance)
                </label>
              </div>
              {mgCreditTarget === 'cash' ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Use currency aligned with Blue Ocean seamless (<code>BLUEOCEAN_CURRENCY</code>). Promotion ID not required.
                </p>
              ) : null}
              {mgCreditTarget === 'bonus_active' ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Enter the bonus instance UUID (e.g. from Instances). Credits <strong>bonus_locked</strong> and extends WR from that instance&apos;s rules.
                </p>
              ) : null}
            </div>
            <div>
              <label className={labelCls} htmlFor="mg-user">
                Player ID
              </label>
              <input
                id="mg-user"
                className={inputCls}
                value={mgUserId}
                onChange={(e) => setMgUserId(e.target.value)}
              />
            </div>
            <div className={mgCreditTarget === 'cash' || mgCreditTarget === 'bonus_active' ? 'opacity-50 pointer-events-none select-none' : ''}>
              <label className={labelCls} htmlFor="mg-pvid">
                Promotion version ID {mgCreditTarget === 'cash' || mgCreditTarget === 'bonus_active' ? '(new bonus only)' : ''}
              </label>
              <input
                id="mg-pvid"
                type="number"
                className={inputCls}
                value={mgPvid}
                onChange={(e) => setMgPvid(e.target.value)}
              />
            </div>
            {mgCreditTarget === 'bonus_active' ? (
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="mg-bonus-inst">
                  Active bonus instance ID
                </label>
                <input
                  id="mg-bonus-inst"
                  className={inputCls}
                  value={mgBonusInstanceId}
                  onChange={(e) => setMgBonusInstanceId(e.target.value)}
                  placeholder="UUID"
                />
              </div>
            ) : null}
            <div>
              <label className={labelCls} htmlFor="mg-amt">
                {mgCreditTarget === 'cash'
                  ? 'Amount (minor · cash)'
                  : mgCreditTarget === 'bonus_active'
                    ? 'Top-up (minor · bonus_locked)'
                    : 'Bonus amount (minor units)'}
              </label>
              <input
                id="mg-amt"
                type="number"
                className={inputCls}
                value={mgAmount}
                onChange={(e) => setMgAmount(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <SelectField
                id="mg-ccy"
                label="Currency"
                value={mgCurrency}
                onChange={setMgCurrency}
                options={manualCurrencyOptions}
                disabled={!isSuper}
              />
            </div>
          </div>
          <button
            type="button"
            className={`mt-4 ${primaryBtn}`}
            onClick={() => void manualGrant()}
            disabled={mgBusy || !isSuper}
          >
            {mgBusy ? 'Granting…' : 'Grant'}
          </button>
          {mgResult != null ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Result</p>
              <ApiResultSummary data={mgResult} />
              {showRawApiDebug ? (
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-brand-600 dark:text-brand-400">
                    Developer: raw response (localStorage admin_debug_raw=1)
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-100 p-3 text-xs text-gray-800 dark:bg-white/10 dark:text-gray-200">
                    {JSON.stringify(mgResult, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </ComponentCard>
      ) : null}
    </>
  )
}
