import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { StatCard } from '../components/dashboard'
import { useBonusStats } from '../hooks/useDashboard'
import { formatCurrency, formatPct, formatCompact } from '../lib/format'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import RulesEditor from '../components/bonus/RulesEditor'
import { defaultRulesForType } from '../components/bonus/bonusRuleTemplates'
import { ApiResultSummary } from '../components/admin/ApiResultSummary'
import { SelectField } from '../components/admin-ui'
import { ADMIN_CURRENCY_OPTIONS } from '../lib/adminCurrencies'
import { COUNTRY_OPTIONS, flagEmoji } from '../lib/countryIsoList'

/** Documented tab query values for deep links (e.g. /bonushub/operations?tab=risk). */
const TABS = [
  'dashboard',
  'promotions',
  'active_offers',
  'instances',
  'risk',
  'simulate',
  'failed_jobs',
  'manual_grant',
] as const
type BonusHubTab = (typeof TABS)[number]

const PRIMARY_TABS: { id: BonusHubTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'promotions', label: 'Promotions' },
  { id: 'active_offers', label: 'Active offers' },
  { id: 'instances', label: 'Instances' },
  { id: 'risk', label: 'Risk queue' },
]

const ADVANCED_TABS: { id: BonusHubTab; label: string }[] = [
  { id: 'simulate', label: 'Simulate payment' },
  { id: 'failed_jobs', label: 'Failed jobs' },
  { id: 'manual_grant', label: 'Manual grant' },
]

type DashboardSummary = {
  promotions_non_archived?: number
  active_bonus_instances?: number
  grants_last_24h?: number
}

type PromotionRow = {
  id: number
  name: string
  slug: string
  status: string
  created_at: string
  latest_version: number
  grants_paused?: boolean
}

type PromoVersion = {
  id: number
  version: number
  published: boolean
  created_at: string
  valid_from?: string
  valid_to?: string
  rules?: unknown
  terms_text?: string
  bonus_type?: string
}

type PromotionDetail = {
  id: number
  name: string
  slug: string
  status: string
  created_at: string
  grants_paused?: boolean
  versions: PromoVersion[]
}

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

type RiskReviewRow = {
  id: number
  user_id: string
  promotion_version_id?: number
  decision: string
  rule_codes: string[]
  inputs: unknown
  created_at: string
}

type ActiveOfferRow = {
  promotion_version_id: number
  promotion_id: number
  promotion_name: string
  published_at: string
  grants_paused: boolean
  priority: number
  active_instances: number
  grants_last_24h: number
  valid_from?: string | null
  valid_to?: string | null
}

type VersionPerformance = {
  promotion_version_id: number
  period: string
  total_grants: number
  grants_last_24h: number
  grant_volume_minor: number
  active_instances: number
  completed_wr: number
  forfeited: number
  wr_completion_rate: number
  forfeiture_rate: number
  total_cost_minor: number
  risk_denied: number
  risk_manual_review: number
}

const PERF_PERIODS = ['7d', '30d', '90d', 'all'] as const
type PerfPeriod = (typeof PERF_PERIODS)[number]

const tabBtn = (active: boolean) =>
  [
    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
    active
      ? 'bg-brand-500 text-white shadow-sm'
      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15',
  ].join(' ')

const primaryBtn =
  'rounded-lg bg-brand-500 px-3 py-1.5 text-sm text-white hover:bg-brand-600 disabled:opacity-50'

const inputCls =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'

const labelCls = 'mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400'

const simCountrySelectOptions = [
  { value: '', label: '— Any country —' },
  ...COUNTRY_OPTIONS.map((c) => ({
    value: c.code,
    label: `${flagEmoji(c.code)} ${c.name} (${c.code})`,
  })),
]

const manualCurrencyOptions = ADMIN_CURRENCY_OPTIONS

function errFromParsedBody(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error
    if (err?.code) {
      return { code: err.code, message: err.message ?? '', status }
    }
  }
  return null
}

export default function BonusHubOperationsPage() {
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const showRawApiDebug =
    isSuper && typeof localStorage !== 'undefined' && localStorage.getItem('admin_debug_raw') === '1'
  const [searchParams, setSearchParams] = useSearchParams()

  const tabFromUrl = useMemo((): BonusHubTab => {
    const raw = (searchParams.get('tab') || 'dashboard').toLowerCase()
    // Legacy bookmark: "automation" pointed at promotions; advanced tools now live separately.
    if (raw === 'automation') return 'simulate'
    return (TABS as readonly string[]).includes(raw) ? (raw as BonusHubTab) : 'dashboard'
  }, [searchParams])

  const [tab, setTabState] = useState<BonusHubTab>(tabFromUrl)

  useEffect(() => {
    setTabState(tabFromUrl)
  }, [tabFromUrl])

  const setTab = useCallback(
    (next: BonusHubTab) => {
      setTabState(next)
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === 'dashboard') p.delete('tab')
          else p.set('tab', next)
          return p
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  const [dash, setDash] = useState<DashboardSummary | null>(null)
  const [dashLoading, setDashLoading] = useState(false)
  const [dashErr, setDashErr] = useState<string | null>(null)

  const [promos, setPromos] = useState<PromotionRow[]>([])
  const [promosLoading, setPromosLoading] = useState(false)
  const [promosErr, setPromosErr] = useState<string | null>(null)
  const [selectedPromoId, setSelectedPromoId] = useState<number | null>(null)

  const promoFromUrl = searchParams.get('promo')
  useEffect(() => {
    if (!promoFromUrl) return
    const id = parseInt(promoFromUrl, 10)
    if (Number.isFinite(id) && id > 0) setSelectedPromoId(id)
  }, [promoFromUrl])
  const [promoDetail, setPromoDetail] = useState<PromotionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErr, setDetailErr] = useState<string | null>(null)
  const [pauseBusyId, setPauseBusyId] = useState<number | null>(null)

  const [newPromoName, setNewPromoName] = useState('')
  const [newPromoSlug, setNewPromoSlug] = useState('')
  const [createPromoBusy, setCreatePromoBusy] = useState(false)

  const [addVerBonusType, setAddVerBonusType] = useState('deposit_match')
  const [addVerRules, setAddVerRules] = useState<unknown>({})
  const [addVerTerms, setAddVerTerms] = useState('')
  const [addVerBusy, setAddVerBusy] = useState(false)
  const [bonusTypeOptions, setBonusTypeOptions] = useState<{ id: string; label: string }[]>([])
  const [publishBusyVid, setPublishBusyVid] = useState<number | null>(null)

  const [selectedPerfVid, setSelectedPerfVid] = useState<number | null>(null)
  const [perfPeriod, setPerfPeriod] = useState<PerfPeriod>('30d')
  const [verPerf, setVerPerf] = useState<VersionPerformance | null>(null)
  const [targetsTotal, setTargetsTotal] = useState<number | null>(null)
  const [perfLoading, setPerfLoading] = useState(false)
  const [perfErr, setPerfErr] = useState<string | null>(null)

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
  const [mgBusy, setMgBusy] = useState(false)
  const [mgResult, setMgResult] = useState<unknown>(null)
  const [mgErr, setMgErr] = useState<string | null>(null)

  const [riskReviews, setRiskReviews] = useState<RiskReviewRow[]>([])
  const [riskPending, setRiskPending] = useState(0)
  const [riskLoading, setRiskLoading] = useState(false)
  const [riskErr, setRiskErr] = useState<string | null>(null)
  const [riskResolveBusy, setRiskResolveBusy] = useState<number | null>(null)

  const [activeOffers, setActiveOffers] = useState<ActiveOfferRow[]>([])
  const [activeOffersLoading, setActiveOffersLoading] = useState(false)
  const [activeOffersErr, setActiveOffersErr] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    setDashErr(null)
    setDashLoading(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/dashboard/summary')
      if (!res.ok) {
        const e = await readApiError(res)
        setDashErr(formatApiError(e, `Load failed (${res.status})`))
        setDash(null)
        return
      }
      setDash((await res.json()) as DashboardSummary)
    } catch {
      setDashErr('Network error loading dashboard')
      setDash(null)
    } finally {
      setDashLoading(false)
    }
  }, [apiFetch])

  const loadPromotions = useCallback(async () => {
    setPromosErr(null)
    setPromosLoading(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/promotions?limit=50')
      if (!res.ok) {
        const e = await readApiError(res)
        setPromosErr(formatApiError(e, `Load failed (${res.status})`))
        setPromos([])
        return
      }
      const j = (await res.json()) as { promotions?: PromotionRow[] }
      setPromos(j.promotions ?? [])
    } catch {
      setPromosErr('Network error loading promotions')
      setPromos([])
    } finally {
      setPromosLoading(false)
    }
  }, [apiFetch])

  const loadPromotionDetail = useCallback(
    async (id: number) => {
      setDetailErr(null)
      setDetailLoading(true)
      setPromoDetail(null)
      try {
        const res = await apiFetch(`/v1/admin/bonushub/promotions/${id}`)
        if (!res.ok) {
          const e = await readApiError(res)
          setDetailErr(formatApiError(e, `Load failed (${res.status})`))
          return
        }
        const j = (await res.json()) as PromotionDetail
        setPromoDetail(j)
      } catch {
        setDetailErr('Network error loading promotion')
      } finally {
        setDetailLoading(false)
      }
    },
    [apiFetch],
  )

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch('/v1/admin/bonushub/bonus-types')
        if (!res.ok) return
        const j = (await res.json()) as { bonus_types?: { id: string; label: string }[] }
        setBonusTypeOptions(
          Array.isArray(j.bonus_types) ? j.bonus_types.map((t) => ({ id: t.id, label: t.label })) : [],
        )
      } catch {
        /* ignore */
      }
    })()
  }, [apiFetch])

  useEffect(() => {
    if (!promoDetail?.versions?.length) {
      setAddVerRules(defaultRulesForType('deposit_match'))
      setAddVerBonusType('deposit_match')
      setAddVerTerms('')
      return
    }
    const draft = promoDetail.versions.find((v) => !v.published)
    const latest = promoDetail.versions[0]
    const seed = draft ?? latest
    const bt =
      typeof seed.bonus_type === 'string' && seed.bonus_type.trim() !== '' ? seed.bonus_type : 'deposit_match'
    setAddVerBonusType(bt)
    if (seed.rules && typeof seed.rules === 'object' && Object.keys(seed.rules as object).length > 0) {
      setAddVerRules(seed.rules)
    } else {
      setAddVerRules(defaultRulesForType(bt))
    }
    setAddVerTerms(typeof seed.terms_text === 'string' ? seed.terms_text : '')
  }, [promoDetail])

  const toggleGrantsPaused = async (id: number, next: boolean) => {
    if (!isSuper) return
    setPauseBusyId(id)
    setPromosErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grants_paused: next }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setPromosErr(formatApiError(e, `Update failed (${res.status})`))
        return
      }
      await loadPromotions()
      if (selectedPromoId === id) void loadPromotionDetail(id)
    } catch {
      setPromosErr('Network error updating promotion')
    } finally {
      setPauseBusyId(null)
    }
  }

  const createPromotion = async () => {
    setCreatePromoBusy(true)
    setPromosErr(null)
    try {
      const res = await apiFetch('/v1/admin/bonushub/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPromoName.trim(), slug: newPromoSlug.trim() }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setPromosErr(formatApiError(e, `Create failed (${res.status})`))
        return
      }
      setNewPromoName('')
      setNewPromoSlug('')
      await loadPromotions()
    } catch {
      setPromosErr('Network error creating promotion')
    } finally {
      setCreatePromoBusy(false)
    }
  }

  const addVersion = async () => {
    if (selectedPromoId == null) return
    if (!addVerRules || typeof addVerRules !== 'object' || Object.keys(addVerRules as object).length === 0) {
      setPromosErr('Configure rules before adding a version.')
      return
    }
    setAddVerBusy(true)
    setPromosErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${selectedPromoId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: addVerRules,
          terms_text: addVerTerms,
          bonus_type: addVerBonusType,
        }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setPromosErr(formatApiError(e, `Add version failed (${res.status})`))
        return
      }
      setAddVerRules(defaultRulesForType(addVerBonusType))
      setAddVerTerms('')
      await loadPromotionDetail(selectedPromoId)
      await loadPromotions()
    } catch {
      setPromosErr('Network error adding version')
    } finally {
      setAddVerBusy(false)
    }
  }

  const publishVersion = async (vid: number) => {
    setPublishBusyVid(vid)
    setPromosErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotion-versions/${vid}/publish`, {
        method: 'POST',
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setPromosErr(formatApiError(e, `Publish failed (${res.status})`))
        return
      }
      if (selectedPromoId != null) void loadPromotionDetail(selectedPromoId)
      await loadPromotions()
    } catch {
      setPromosErr('Network error publishing version')
    } finally {
      setPublishBusyVid(null)
    }
  }

  const loadInstances = useCallback(async () => {
    setInstancesErr(null)
    setInstancesLoading(true)
    try {
      const q = new URLSearchParams({ limit: '50' })
      const u = userFilter.trim()
      if (u) q.set('user_id', u)
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
      const res = await apiFetch(`/v1/admin/bonushub/worker-failed-jobs/${id}/retry`, {
        method: 'POST',
      })
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

  const manualGrant = async () => {
    setMgErr(null)
    setMgResult(null)
    const pvid = Number.parseInt(mgPvid, 10)
    const amt = Number.parseInt(mgAmount, 10)
    if (!mgUserId.trim() || Number.isNaN(pvid) || pvid <= 0 || Number.isNaN(amt) || amt <= 0) {
      setMgErr('user_id, promotion_version_id, and positive grant_amount_minor are required')
      return
    }
    setMgBusy(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/instances/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: mgUserId.trim(),
          promotion_version_id: pvid,
          grant_amount_minor: amt,
          currency: mgCurrency.trim() || 'USDT',
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
    if (tab === 'dashboard') void loadDashboard()
  }, [tab, loadDashboard])

  useEffect(() => {
    if (tab === 'promotions') void loadPromotions()
  }, [tab, loadPromotions])

  useEffect(() => {
    if (tab === 'instances') void loadInstances()
  }, [tab, loadInstances])

  useEffect(() => {
    if (tab === 'failed_jobs') void loadFailedJobs()
  }, [tab, loadFailedJobs])

  const loadRiskQueue = useCallback(async () => {
    setRiskErr(null)
    setRiskLoading(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/risk-queue?limit=100')
      type RiskQueueJSON = { pending_count?: number; reviews?: RiskReviewRow[] }
      let j: RiskQueueJSON | null = null
      try {
        j = (await res.json()) as RiskQueueJSON
      } catch {
        j = null
      }
      if (!res.ok) {
        const e = errFromParsedBody(res.status, j)
        setRiskErr(formatApiError(e, `Load failed (${res.status})`))
        return
      }
      setRiskPending(j?.pending_count ?? 0)
      setRiskReviews(Array.isArray(j?.reviews) ? j!.reviews! : [])
    } catch {
      setRiskErr('Network error')
    } finally {
      setRiskLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (tab === 'risk') void loadRiskQueue()
  }, [tab, loadRiskQueue])

  const loadActiveOffers = useCallback(async () => {
    setActiveOffersErr(null)
    setActiveOffersLoading(true)
    try {
      const res = await apiFetch('/v1/admin/bonushub/offers/active')
      type ActiveOffersJSON = { offers?: ActiveOfferRow[] }
      let j: ActiveOffersJSON | null = null
      try {
        j = (await res.json()) as ActiveOffersJSON
      } catch {
        j = null
      }
      if (!res.ok) {
        const e = errFromParsedBody(res.status, j)
        setActiveOffersErr(formatApiError(e, `Load failed (${res.status})`))
        return
      }
      setActiveOffers(Array.isArray(j?.offers) ? j!.offers! : [])
    } catch {
      setActiveOffersErr('Network error')
    } finally {
      setActiveOffersLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    if (tab === 'active_offers') void loadActiveOffers()
  }, [tab, loadActiveOffers])

  const resolveRiskReview = async (id: number, decision: 'allowed' | 'denied') => {
    if (!isSuper) return
    setRiskResolveBusy(id)
    setRiskErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/risk-queue/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      if (!res.ok) {
        let j: unknown = null
        try {
          j = await res.json()
        } catch {
          j = null
        }
        const e = errFromParsedBody(res.status, j)
        setRiskErr(formatApiError(e, `Resolve failed (${res.status})`))
        return
      }
      await loadRiskQueue()
    } catch {
      setRiskErr('Network error')
    } finally {
      setRiskResolveBusy(null)
    }
  }

  useEffect(() => {
    setSelectedPerfVid(null)
    setVerPerf(null)
    setTargetsTotal(null)
    setPerfErr(null)
  }, [selectedPromoId])

  useEffect(() => {
    if (selectedPromoId != null) void loadPromotionDetail(selectedPromoId)
    else {
      setPromoDetail(null)
      setDetailErr(null)
    }
  }, [selectedPromoId, loadPromotionDetail])

  const loadVersionPerformance = useCallback(
    async (vid: number, period: PerfPeriod) => {
      setPerfErr(null)
      setPerfLoading(true)
      setVerPerf(null)
      setTargetsTotal(null)
      try {
        const [resP, resT] = await Promise.all([
          apiFetch(
            `/v1/admin/bonushub/promotion-versions/${vid}/performance?period=${encodeURIComponent(period)}`,
          ),
          apiFetch(`/v1/admin/bonushub/promotion-versions/${vid}/targets?limit=0`),
        ])
        let jt: unknown = null
        try {
          jt = await resT.json()
        } catch {
          jt = null
        }
        if (
          resT.ok &&
          jt &&
          typeof jt === 'object' &&
          'total' in jt &&
          typeof (jt as { total: unknown }).total === 'number'
        ) {
          setTargetsTotal((jt as { total: number }).total)
        }
        let jp: unknown = null
        try {
          jp = await resP.json()
        } catch {
          jp = null
        }
        if (!resP.ok) {
          const e = errFromParsedBody(resP.status, jp)
          setPerfErr(formatApiError(e, `Performance load failed (${resP.status})`))
          return
        }
        setVerPerf(jp as VersionPerformance)
      } catch {
        setPerfErr('Network error loading version performance')
      } finally {
        setPerfLoading(false)
      }
    },
    [apiFetch],
  )

  useEffect(() => {
    if (tab !== 'promotions' || selectedPerfVid == null) return
    void loadVersionPerformance(selectedPerfVid, perfPeriod)
  }, [tab, selectedPerfVid, perfPeriod, loadVersionPerformance])

  const { data: bonusStats } = useBonusStats()

  return (
    <>
      <PageMeta
        title="Bonus Engine · Operations"
        description="Primary: dashboard, promotions, active offers, instances, risk. Advanced: simulate payment, failed jobs, manual grant. Go-live: /bonushub/promotions/:id/delivery"
      />
      <PageBreadcrumb pageTitle="Bonus Engine · Operations" />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Bonus Cost (30d)"
          value={bonusStats ? formatCurrency(bonusStats.total_bonus_cost_30d) : '—'}
        />
        <StatCard
          label="WR Completion Rate"
          value={bonusStats ? formatPct(bonusStats.wr_completion_rate) : '—'}
        />
        <StatCard
          label="Forfeiture Rate"
          value={bonusStats ? formatPct(bonusStats.forfeiture_rate) : '—'}
        />
        <StatCard
          label="Risk Queue"
          value={bonusStats ? formatCompact(bonusStats.risk_queue_pending) : '—'}
        />
        <StatCard
          label="Grants (24h)"
          value={bonusStats ? formatCompact(bonusStats.grants_last_24h) : '—'}
        />
        <StatCard
          label="Bonus % of GGR"
          value={bonusStats ? formatPct(bonusStats.bonus_pct_of_ggr) : '—'}
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {PRIMARY_TABS.map(({ id, label }) => (
          <button key={id} type="button" className={tabBtn(tab === id)} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-700 dark:bg-white/[0.03]">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Advanced
        </p>
        <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
          Tools for <strong>testing deposit evaluation</strong> (simulate), <strong>replaying worker failures</strong>{' '}
          (Redis + worker must be running for real grants), and <strong>one-off credits</strong>. Most day-to-day work
          uses <strong>Schedule &amp; deliver</strong> on each promotion or the Promotions tab here. Superadmin only
          for simulate, retry, and manual grant.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ADVANCED_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={[
                'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                tab === id
                  ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/10',
              ].join(' ')}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'dashboard' ? (
        <ComponentCard title="Dashboard" desc="High-level bonus metrics (non-archived promos, active instances, grants in last 24h).">
          {dashErr ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{dashErr}</p> : null}
          {dashLoading && !dash ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : dash ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Promotions
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                  {dash.promotions_non_archived ?? '—'}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Non-archived</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Active instances
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                  {dash.active_bonus_instances ?? '—'}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Grants (24h)
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
                  {dash.grants_last_24h ?? '—'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">No data.</p>
          )}
          <button
            type="button"
            className={`mt-4 ${primaryBtn}`}
            onClick={() => void loadDashboard()}
            disabled={dashLoading}
          >
            {dashLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </ComponentCard>
      ) : null}

      {tab === 'active_offers' ? (
        <ComponentCard
          title="Active offers"
          desc="Published versions with grants enabled (not paused). Use Promotions tab for toggles."
        >
          {activeOffersErr ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{activeOffersErr}</p> : null}
          {activeOffersLoading && activeOffers.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : activeOffers.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No active offers.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Ver. ID</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Promotion</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Priority</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Active inst.</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Grants 24h</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Published</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                  {activeOffers.map((o) => (
                    <tr key={o.promotion_version_id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{o.promotion_version_id}</td>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{o.promotion_name}</td>
                      <td className="px-3 py-2">{o.priority}</td>
                      <td className="px-3 py-2">{o.active_instances}</td>
                      <td className="px-3 py-2">{o.grants_last_24h}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {o.published_at}
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
            onClick={() => void loadActiveOffers()}
            disabled={activeOffersLoading}
          >
            Refresh
          </button>
        </ComponentCard>
      ) : null}

      {tab === 'promotions' ? (
        <>
          <ComponentCard
            title="Promotions"
            desc="List, pause grants (superadmin), create promotions, add versions, publish."
          >
            {!isSuper ? (
              <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">
                Grants paused toggle requires superadmin.
              </p>
            ) : null}
            {promosErr ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{promosErr}</p> : null}
            {promosLoading && promos.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-white/5">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">ID</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Name</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Slug</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                        Grants paused
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">
                        Latest ver.
                      </th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                    {promos.map((p) => (
                      <tr
                        key={p.id}
                        className={
                          selectedPromoId === p.id
                            ? 'cursor-pointer bg-brand-500/10 hover:bg-brand-500/15'
                            : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5'
                        }
                        onClick={() => setSelectedPromoId(p.id)}
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-800 dark:text-gray-200">
                          {p.id}
                        </td>
                        <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{p.name}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{p.slug}</td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{p.status}</td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className={primaryBtn}
                            disabled={!isSuper || pauseBusyId === p.id}
                            onClick={() => void toggleGrantsPaused(p.id, !p.grants_paused)}
                          >
                            {pauseBusyId === p.id
                              ? '…'
                              : p.grants_paused
                                ? 'Resume'
                                : 'Pause'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{p.latest_version}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                          {p.created_at}
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
              onClick={() => void loadPromotions()}
              disabled={promosLoading}
            >
              Refresh list
            </button>
          </ComponentCard>

          <ComponentCard title="Create promotion" desc="POST name + slug.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelCls} htmlFor="np-name">
                  Name
                </label>
                <input
                  id="np-name"
                  className={inputCls}
                  value={newPromoName}
                  onChange={(e) => setNewPromoName(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="np-slug">
                  Slug
                </label>
                <input
                  id="np-slug"
                  className={inputCls}
                  value={newPromoSlug}
                  onChange={(e) => setNewPromoSlug(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className={`mt-3 ${primaryBtn}`}
              onClick={() => void createPromotion()}
              disabled={createPromoBusy || !newPromoName.trim() || !newPromoSlug.trim()}
            >
              {createPromoBusy ? 'Creating…' : 'Create promotion'}
            </button>
          </ComponentCard>

          <ComponentCard
            title="Promotion detail"
            desc={selectedPromoId ? `ID ${selectedPromoId}` : 'Click a row in the table to load detail.'}
          >
            {detailErr ? <p className="mb-2 text-sm text-red-600 dark:text-red-400">{detailErr}</p> : null}
            {detailLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading detail…</p>
            ) : promoDetail ? (
              <>
                <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Name</dt>
                    <dd className="font-medium text-gray-900 dark:text-gray-100">{promoDetail.name}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Slug</dt>
                    <dd className="font-mono text-gray-800 dark:text-gray-200">{promoDetail.slug}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Status</dt>
                    <dd>{promoDetail.status}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Grants paused</dt>
                    <dd>{String(!!promoDetail.grants_paused)}</dd>
                  </div>
                </dl>
                <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">Versions</h4>
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-white/5">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Version ID</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">#</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Published</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Created</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                      {(promoDetail.versions ?? []).map((v) => (
                        <tr key={v.id}>
                          <td className="px-3 py-2 font-mono text-xs">{v.id}</td>
                          <td className="px-3 py-2">{v.version}</td>
                          <td className="px-3 py-2">{v.published ? 'yes' : 'no'}</td>
                          <td className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{v.created_at}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                className={
                                  selectedPerfVid === v.id
                                    ? `${primaryBtn} ring-2 ring-brand-300 ring-offset-1 dark:ring-offset-gray-900`
                                    : primaryBtn
                                }
                                onClick={() => setSelectedPerfVid(v.id)}
                              >
                                Metrics
                              </button>
                              {!v.published ? (
                                <button
                                  type="button"
                                  className={primaryBtn}
                                  disabled={publishBusyVid === v.id}
                                  onClick={() => void publishVersion(v.id)}
                                >
                                  {publishBusyVid === v.id ? 'Publishing…' : 'Publish'}
                                </button>
                              ) : (
                                <span className="self-center text-xs text-gray-400">published</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedPerfVid != null ? (
                  <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                        Version {selectedPerfVid} performance
                      </h4>
                      {targetsTotal !== null ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Explicit targets: {formatCompact(targetsTotal)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {PERF_PERIODS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={tabBtn(perfPeriod === p)}
                          onClick={() => setPerfPeriod(p)}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    {perfErr ? (
                      <p className="mb-3 text-sm text-red-600 dark:text-red-400">{perfErr}</p>
                    ) : null}
                    {perfLoading && !verPerf ? (
                      <p className="text-sm text-gray-500 dark:text-gray-400">Loading metrics…</p>
                    ) : verPerf ? (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        <StatCard
                          label="Grants (period)"
                          value={formatCompact(verPerf.total_grants)}
                        />
                        <StatCard
                          label="Grants (24h)"
                          value={formatCompact(verPerf.grants_last_24h)}
                        />
                        <StatCard
                          label="Active instances"
                          value={formatCompact(verPerf.active_instances)}
                        />
                        <StatCard
                          label="WR completion"
                          value={formatPct(verPerf.wr_completion_rate)}
                        />
                        <StatCard
                          label="Forfeiture rate"
                          value={formatPct(verPerf.forfeiture_rate)}
                        />
                        <StatCard
                          label="Cost (period)"
                          value={formatCurrency(verPerf.total_cost_minor)}
                        />
                        <StatCard
                          label="Risk denied"
                          value={formatCompact(verPerf.risk_denied)}
                        />
                        <StatCard
                          label="Manual review"
                          value={formatCompact(verPerf.risk_manual_review)}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No promotion selected.</p>
            )}
          </ComponentCard>

          <ComponentCard
            title="Add version"
            desc="Requires a selected promotion. Drafts are pre-filled from the latest version when present."
          >
            <div className="space-y-4">
              <div className="max-w-md">
                <label className={labelCls} htmlFor="ver-bonus-type">
                  Bonus type (new version)
                </label>
                <select
                  id="ver-bonus-type"
                  className={inputCls}
                  value={addVerBonusType}
                  onChange={(e) => {
                    const id = e.target.value
                    setAddVerBonusType(id)
                    setAddVerRules(defaultRulesForType(id))
                  }}
                  disabled={selectedPromoId == null}
                >
                  {(bonusTypeOptions.length ? bonusTypeOptions : [{ id: 'deposit_match', label: 'Deposit match' }]).map(
                    (t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <RulesEditor
                apiFetch={apiFetch}
                bonusTypeId={addVerBonusType}
                rules={addVerRules}
                onRulesChange={setAddVerRules}
                termsText={addVerTerms}
                onTermsTextChange={setAddVerTerms}
              />
            </div>
            <button
              type="button"
              className={`mt-3 ${primaryBtn}`}
              onClick={() => void addVersion()}
              disabled={addVerBusy || selectedPromoId == null}
            >
              {addVerBusy ? 'Adding…' : 'Add version'}
            </button>
          </ComponentCard>
        </>
      ) : null}

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

      {tab === 'risk' ? (
        <ComponentCard
          title="Risk queue"
          desc={`Manual review items (${riskPending} pending). Resolve as allowed or denied (superadmin).`}
        >
          {!isSuper ? (
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">Resolve actions require superadmin.</p>
          ) : null}
          {riskErr ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{riskErr}</p> : null}
          {riskLoading && riskReviews.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
          ) : riskReviews.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No items in manual review.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-white/5">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">ID</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">User</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Promo ver.</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Rules</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Created</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900/30">
                  {riskReviews.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{row.id}</td>
                      <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs" title={row.user_id}>
                        {row.user_id}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {row.promotion_version_id ?? '—'}
                      </td>
                      <td className="max-w-xs truncate px-3 py-2 text-xs" title={(row.rule_codes || []).join(', ')}>
                        {(row.rule_codes || []).join(', ')}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {row.created_at}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={`${primaryBtn} bg-emerald-600 hover:bg-emerald-700`}
                            disabled={!isSuper || riskResolveBusy === row.id}
                            onClick={() => void resolveRiskReview(row.id, 'allowed')}
                          >
                            Allow
                          </button>
                          <button
                            type="button"
                            className={`${primaryBtn} bg-red-600 hover:bg-red-700`}
                            disabled={!isSuper || riskResolveBusy === row.id}
                            onClick={() => void resolveRiskReview(row.id, 'denied')}
                          >
                            Deny
                          </button>
                        </div>
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
            onClick={() => void loadRiskQueue()}
            disabled={riskLoading}
          >
            {riskLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </ComponentCard>
      ) : null}

      {tab === 'simulate' ? (
        <ComponentCard
          title="Simulate payment settled"
          desc="Superadmin. Models the Fystack deposit → bonus_payment_settled path (not Blue Ocean game wallet). Use dry_run first; set country to test geo targeting. Uncheck dry_run to actually grant (respects risk + idempotency)."
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
        <ComponentCard title="Manual grant" desc="Superadmin. Creates a bonus instance from a promotion version.">
          {!isSuper ? (
            <p className="mb-3 text-xs text-amber-700 dark:text-amber-400">Superadmin only.</p>
          ) : null}
          {mgErr ? <p className="mb-3 text-sm text-red-600 dark:text-red-400">{mgErr}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
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
            <div>
              <label className={labelCls} htmlFor="mg-pvid">
                Promotion version ID
              </label>
              <input
                id="mg-pvid"
                type="number"
                className={inputCls}
                value={mgPvid}
                onChange={(e) => setMgPvid(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="mg-amt">
                Bonus amount (minor units)
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
