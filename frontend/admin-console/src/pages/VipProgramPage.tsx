import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import { StatCard } from '../components/dashboard'
import { ImageUrlField } from '../components/admin-ui'
import { VipLoyaltyHeroSection } from '../components/vip/VipLoyaltyHeroSection'
import { readApiError, formatApiError } from '../api/errors'
import {
  formatTierEventMeta,
  mergeVipTierPerksFromForm,
} from '../lib/adminFormatting'

type VipTierRow = {
  id: number
  sort_order: number
  name: string
  min_lifetime_wager_minor: number
  perks: Record<string, unknown>
  created_at?: string
}

type VipBenefitRow = {
  id: number
  tier_id: number
  sort_order: number
  enabled: boolean
  benefit_type: string
  promotion_version_id?: number
  config: Record<string, unknown>
  player_title?: string
  player_description?: string
  created_at?: string
  updated_at?: string
}

type VipDeliverySummary = {
  tier_population: { tier_id: number; name: string; sort_order: number; player_count: number }[]
  players_untiered: number
  tier_events_7d: number
  grant_log_7d_by_result: Record<string, number>
  delivery_cost_7d_minor?: number
  delivery_items_granted_7d?: number
  delivery_items_failed_7d?: number
  delivery_success_rate_7d?: number
  delivery_runs_7d?: number
  delivery_runs_failed_7d?: number
  delivery_avg_run_ms_7d?: number | null
  delivery_cost_7d_by_pipeline_minor?: Record<string, number>
  recent_tier_events: Array<{
    id: number
    user_id: string
    from_tier_id?: number
    to_tier_id?: number
    lifetime_wager_minor: number
    meta?: Record<string, unknown>
    created_at: string
  }>
}

type VipRewardPayoutLogRow = {
  ledger_id: string
  created_at: string
  user_id: string
  email?: string
  entry_type: string
  amount_minor: number
  currency: string
  ledger_idempotency_key: string
  reward_idempotency_key: string
  withdrawal_id?: string
  withdrawal_status?: string
  provider_withdrawal_id?: string
  destination?: string
}

type RakebackBoostWindowUI = {
  start_utc: string
  claim_window_minutes: number
  boost_duration_minutes: number
}

const inputCls = 'form-control form-control-sm'

const labelCls = 'form-label small mb-1'

function playerUiOrigin(): string {
  const env = import.meta.env as { VITE_PLAYER_UI_ORIGIN?: string; VITE_PLAYER_APP_ORIGIN?: string }
  const o = (env.VITE_PLAYER_UI_ORIGIN || env.VITE_PLAYER_APP_ORIGIN || '').trim()
  if (o) return o.replace(/\/$/, '')
  return `${window.location.protocol}//127.0.0.1:5174`
}

function rebateProgramKeyToDisplay(key: string): string {
  const k = key.trim().toLowerCase()
  if (k === 'weekly_cashback') return 'rakeback'
  return key
}

function rebateProgramKeyToPersist(key: string): string {
  const k = key.trim().toLowerCase()
  if (k === 'rakeback') return 'weekly_cashback'
  return key.trim()
}

function formatPercent(value: number | string, maxFractionDigits = 2): string {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '0'
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(n)
}

/** Admin field: dollars/cents text → stored minor units (1.00 → 100). */
function wagerMinorFromDollarField(s: string): number {
  const n = Number(String(s).replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

function formatWagerDollarsFromMinor(minor: number): string {
  return (minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export default function VipProgramPage() {
  const { apiFetch, role } = useAdminAuth()
  const [tab, setTab] = useState<'overview' | 'activity' | 'payouts'>('overview')
  const [tiers, setTiers] = useState<VipTierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [minWager, setMinWager] = useState('')
  const [showOnVipPage, setShowOnVipPage] = useState(true)
  const [perkHeaderColor, setPerkHeaderColor] = useState('')
  const [perkImageUrl, setPerkImageUrl] = useState('')
  const [perkRankLabel, setPerkRankLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [tierVisibilitySavingId, setTierVisibilitySavingId] = useState<number | null>(null)
  const [benefits, setBenefits] = useState<VipBenefitRow[]>([])
  const [summary, setSummary] = useState<VipDeliverySummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [weeklyBonusEnabled, setWeeklyBonusEnabled] = useState(false)
  const [monthlyBonusEnabled, setMonthlyBonusEnabled] = useState(false)
  const [scheduledBonusSaving, setScheduledBonusSaving] = useState(false)
  const [rakebackProgramKey, setRakebackProgramKey] = useState('rakeback')
  const [rakebackPercentAdd, setRakebackPercentAdd] = useState(5)
  const [rakebackTitle, setRakebackTitle] = useState('Rakeback')
  const [rakebackDescription, setRakebackDescription] = useState('')
  const [rakebackSort, setRakebackSort] = useState('0')
  const [rakebackEnabled, setRakebackEnabled] = useState(false)
  const [rakebackSaving, setRakebackSaving] = useState(false)
  const [rakebackBoostProgramKey, setRakebackBoostProgramKey] = useState('rakeback')
  const [rakebackBoostPercentAdd, setRakebackBoostPercentAdd] = useState(2)
  const [rakebackBoostMaxClaimsPerDay, setRakebackBoostMaxClaimsPerDay] = useState('3')
  const [rakebackBoostSort, setRakebackBoostSort] = useState('0')
  const [rakebackBoostTitle, setRakebackBoostTitle] = useState('Rakeback boost')
  const [rakebackBoostDescription, setRakebackBoostDescription] = useState('')
  const [rakebackBoostDisplayToCustomer, setRakebackBoostDisplayToCustomer] = useState(true)
  const [rakebackBoostWindows, setRakebackBoostWindows] = useState<RakebackBoostWindowUI[]>([
    { start_utc: '04:00', claim_window_minutes: 120, boost_duration_minutes: 120 },
    { start_utc: '14:00', claim_window_minutes: 120, boost_duration_minutes: 120 },
    { start_utc: '22:00', claim_window_minutes: 120, boost_duration_minutes: 120 },
  ])
  const [rakebackBoostEnabled, setRakebackBoostEnabled] = useState(false)
  const [rakebackBoostSaving, setRakebackBoostSaving] = useState(false)
  const [levelUpPercent, setLevelUpPercent] = useState('5')
  const [levelUpMaxGrantMinor, setLevelUpMaxGrantMinor] = useState('')
  const [levelUpTitle, setLevelUpTitle] = useState('Level-up cash reward')
  const [levelUpDescription, setLevelUpDescription] = useState('')
  const [levelUpSort, setLevelUpSort] = useState('0')
  const [levelUpEnabled, setLevelUpEnabled] = useState(false)
  const [levelUpSaving, setLevelUpSaving] = useState(false)
  const [payoutLog, setPayoutLog] = useState<VipRewardPayoutLogRow[]>([])
  const [payoutLoading, setPayoutLoading] = useState(false)
  const [payoutQuery, setPayoutQuery] = useState('')
  const [tierEditorOpen, setTierEditorOpen] = useState(false)
  const [createTierOpen, setCreateTierOpen] = useState(false)
  const [createTierName, setCreateTierName] = useState('')
  const [createTierMinWager, setCreateTierMinWager] = useState('0')
  const [createTierSaving, setCreateTierSaving] = useState(false)
  const [benefitOffConfirm, setBenefitOffConfirm] = useState<{
    title: string
    detail: string
    variant?: 'danger'
    confirmLabel?: string
    onConfirm: () => void | Promise<void>
  } | null>(null)

  const canEdit = role === 'superadmin'

  const openTierEditor = useCallback((tierId: number) => {
    setSelectedId(tierId)
    setTierEditorOpen(true)
  }, [])

  useEffect(() => {
    if (!tierEditorOpen && !benefitOffConfirm && !createTierOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [tierEditorOpen, benefitOffConfirm, createTierOpen])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/v1/admin/vip/tiers')
      if (!res.ok) {
        toast.error(`Could not load tiers (${res.status})`)
        setTiers([])
        return
      }
      const j = (await res.json()) as { tiers?: VipTierRow[] }
      const list = Array.isArray(j.tiers) ? j.tiers : []
      setTiers(list)
    } catch {
      toast.error('Network error loading VIP tiers')
      setTiers([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const res = await apiFetch('/v1/admin/vip/delivery/summary')
      if (!res.ok) {
        setSummary(null)
        return
      }
      const j = (await res.json()) as VipDeliverySummary
      setSummary(j)
    } catch {
      setSummary(null)
    } finally {
      setSummaryLoading(false)
    }
  }, [apiFetch])

  const loadPayoutLog = useCallback(async () => {
    setPayoutLoading(true)
    try {
      const qs = new URLSearchParams()
      qs.set('limit', '200')
      if (payoutQuery.trim()) qs.set('q', payoutQuery.trim())
      const res = await apiFetch(`/v1/admin/vip/rewards/payout-log?${qs.toString()}`)
      if (!res.ok) {
        setPayoutLog([])
        return
      }
      const j = (await res.json()) as { payouts?: VipRewardPayoutLogRow[] }
      setPayoutLog(Array.isArray(j.payouts) ? j.payouts : [])
    } catch {
      setPayoutLog([])
    } finally {
      setPayoutLoading(false)
    }
  }, [apiFetch, payoutQuery])

  const uploadFile = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await apiFetch('/v1/admin/content/upload', { method: 'POST', body: fd })
        if (!res.ok) {
          toast.error('Upload failed')
          return null
        }
        const j = (await res.json()) as { url: string }
        toast.success('Image uploaded')
        return j.url
      } catch {
        toast.error('Upload error')
        return null
      }
    },
    [apiFetch],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (tab === 'overview' || tab === 'activity') void loadSummary()
  }, [tab, loadSummary])

  useEffect(() => {
    if (tab === 'payouts') void loadPayoutLog()
  }, [tab, loadPayoutLog])

  const selected = tiers.find((t) => t.id === selectedId) ?? null

  useEffect(() => {
    if (!selected) return
    setName(selected.name)
    setMinWager(formatWagerDollarsFromMinor(selected.min_lifetime_wager_minor))
    const p = selected.perks ?? {}
    setShowOnVipPage(p.hide_from_public_page !== true)
    const d =
      p.display && typeof p.display === 'object' && !Array.isArray(p.display)
        ? (p.display as Record<string, unknown>)
        : {}
    setPerkHeaderColor(String(d.header_color ?? ''))
    setPerkImageUrl(String(d.character_image_url ?? ''))
    setPerkRankLabel(String(d.rank_label ?? ''))
    setWeeklyBonusEnabled(p.weekly_bonus_enabled === true)
    setMonthlyBonusEnabled(p.monthly_bonus_enabled === true)
  }, [selected])

  const loadBenefits = useCallback(async () => {
    if (selectedId == null) return
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}/benefits`)
      if (!res.ok) {
        setBenefits([])
        return
      }
      const j = (await res.json()) as { benefits?: VipBenefitRow[] }
      setBenefits(Array.isArray(j.benefits) ? j.benefits : [])
    } catch {
      setBenefits([])
    }
  }, [apiFetch, selectedId])

  useEffect(() => {
    void loadBenefits()
  }, [loadBenefits])

  useEffect(() => {
    const rb = benefits.find((b) => b.benefit_type === 'rebate_percent_add')
    if (rb) {
      setRakebackEnabled(!!rb.enabled)
      setRakebackSort(String(rb.sort_order ?? 0))
      setRakebackProgramKey(rebateProgramKeyToDisplay(String(rb.config?.rebate_program_key ?? 'rakeback')))
      setRakebackPercentAdd(Math.max(0, Number(rb.config?.percent_add ?? 5) || 5))
      const existingTitle = String(rb.player_title ?? '').trim()
      setRakebackTitle(existingTitle && existingTitle.toLowerCase() !== 'vip rakeback boost' ? existingTitle : 'Rakeback')
      setRakebackDescription(
        String(
          rb.player_description ??
            `Permanent +${formatPercent(Math.max(0.1, Number(rb.config?.percent_add ?? 5) || 5))}% rakeback uplift.`,
        ),
      )
    } else {
      setRakebackEnabled(false)
      setRakebackProgramKey('rakeback')
      setRakebackTitle('Rakeback')
      setRakebackDescription('')
    }
    const lu = benefits.find((b) => b.benefit_type === 'level_up_cash_percent')
    if (lu) {
      setLevelUpEnabled(!!lu.enabled)
      setLevelUpSort(String(lu.sort_order ?? 0))
      const pct = Number(lu.config?.percent_of_previous_level_wager ?? 0) || 0
      setLevelUpPercent(pct > 0 ? String(pct) : '5')
      const max = Number(lu.config?.max_grant_minor ?? 0) || 0
      setLevelUpMaxGrantMinor(max > 0 ? String(max) : '')
      setLevelUpTitle(String(lu.player_title ?? 'Level-up cash reward'))
      setLevelUpDescription(String(lu.player_description ?? `Cash credit at ${formatPercent(pct > 0 ? pct : 5)}% of wagering completed on previous level.`))
    } else {
      setLevelUpEnabled(false)
      setLevelUpTitle('Level-up cash reward')
      setLevelUpDescription('')
    }
    const rbBoost = benefits.find((b) => b.benefit_type === 'rakeback_boost_schedule')
    if (rbBoost) {
      setRakebackBoostEnabled(!!rbBoost.enabled)
      setRakebackBoostSort(String(rbBoost.sort_order ?? 0))
      setRakebackBoostProgramKey(rebateProgramKeyToDisplay(String(rbBoost.config?.rebate_program_key ?? 'weekly_cashback')))
      setRakebackBoostPercentAdd(Math.max(0.1, Number(rbBoost.config?.boost_percent_add ?? 2) || 2))
      setRakebackBoostMaxClaimsPerDay(String(Math.max(1, Number(rbBoost.config?.max_claims_per_day ?? 3) || 3)))
      setRakebackBoostDisplayToCustomer(rbBoost.config?.display_to_customer !== false)
      setRakebackBoostTitle(String(rbBoost.player_title ?? 'Rakeback boost'))
      setRakebackBoostDescription(String(rbBoost.player_description ?? 'Timed rakeback boosts unlock throughout the day.'))
      const windowsRaw = Array.isArray(rbBoost.config?.windows) ? rbBoost.config.windows : []
      const mapped = windowsRaw
        .map((w) => {
          if (!w || typeof w !== 'object') return null
          const row = w as Record<string, unknown>
          return {
            start_utc: String(row.start_utc ?? '').trim(),
            claim_window_minutes: Math.max(1, Number(row.claim_window_minutes ?? 60) || 60),
            boost_duration_minutes: Math.max(1, Number(row.boost_duration_minutes ?? 60) || 60),
          }
        })
        .filter((w): w is RakebackBoostWindowUI => Boolean(w && w.start_utc))
      if (mapped.length > 0) setRakebackBoostWindows(mapped)
    } else {
      setRakebackBoostEnabled(false)
      setRakebackBoostProgramKey('rakeback')
      setRakebackBoostPercentAdd(2)
      setRakebackBoostMaxClaimsPerDay('3')
      setRakebackBoostSort('0')
      setRakebackBoostDisplayToCustomer(true)
      setRakebackBoostTitle('Rakeback boost')
      setRakebackBoostDescription('')
      setRakebackBoostWindows([
        { start_utc: '04:00', claim_window_minutes: 120, boost_duration_minutes: 120 },
        { start_utc: '14:00', claim_window_minutes: 120, boost_duration_minutes: 120 },
        { start_utc: '22:00', claim_window_minutes: 120, boost_duration_minutes: 120 },
      ])
    }
  }, [benefits])

  const saveRakebackTierBenefit = async (): Promise<boolean> => {
    if (!selectedId || !canEdit) return false
    if (!rakebackProgramKey.trim() || rakebackPercentAdd <= 0) {
      toast.error('Set rebate programme key and positive percent')
      return false
    }
    const existing = existingRakebackBenefit
    const payload = {
      sort_order: parseInt(rakebackSort, 10) || 0,
      benefit_type: 'rebate_percent_add',
      config: {
        rebate_program_key: rebateProgramKeyToPersist(rakebackProgramKey),
        percent_add: Math.max(0.1, Number(rakebackPercentAdd.toFixed(2))),
      },
      player_title: rakebackTitle.trim() || 'Rakeback',
      player_description:
        rakebackDescription.trim() || `Permanent +${formatPercent(rakebackPercentAdd)}% rakeback uplift.`,
    }
    setRakebackSaving(true)
    try {
      const res = await apiFetch(
        existing ? `/v1/admin/vip/tiers/${selectedId}/benefits/${existing.id}` : `/v1/admin/vip/tiers/${selectedId}/benefits`,
        {
          method: existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) {
        toast.error(`Save rakeback failed (${res.status})`)
        return false
      }
      toast.success(existing ? 'Rakeback benefit updated' : 'Rakeback benefit created')
      await loadBenefits()
      return true
    } catch {
      toast.error('Network error saving rakeback benefit')
      return false
    } finally {
      setRakebackSaving(false)
    }
  }

  const applyRakebackBenefitEnabled = async (enabled: boolean) => {
    if (!selectedId || !canEdit) return
    if (!existingRakebackBenefit) {
      if (enabled) {
        setRakebackEnabled(true)
        await saveRakebackTierBenefit()
      } else {
        setRakebackEnabled(false)
      }
      return
    }
    setRakebackSaving(true)
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}/benefits/${existingRakebackBenefit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) {
        toast.error(`Rakeback toggle failed (${res.status})`)
        return
      }
      setRakebackEnabled(enabled)
      toast.success(`Rakeback ${enabled ? 'enabled' : 'disabled'}`)
      await loadBenefits()
    } catch {
      toast.error('Network error toggling rakeback')
    } finally {
      setRakebackSaving(false)
    }
  }

  const onRakebackBenefitToggle = (enabled: boolean) => {
    if (!enabled && rakebackEnabled) {
      setBenefitOffConfirm({
        title: 'Disable base rakeback for this tier?',
        detail:
          'Players at this tier will stop earning passive rakeback from this programme until you turn it back on. Existing accrued balances are unaffected.',
        onConfirm: async () => {
          setBenefitOffConfirm(null)
          await applyRakebackBenefitEnabled(false)
        },
      })
      return
    }
    void applyRakebackBenefitEnabled(enabled)
  }

  const parseRakebackBoostWindows = (): RakebackBoostWindowUI[] | null => {
    const re = /^([01]\d|2[0-3]):([0-5]\d)$/
    const normalized = rakebackBoostWindows
      .map((w) => ({
        start_utc: w.start_utc.trim(),
        claim_window_minutes: Math.max(1, Math.trunc(Number(w.claim_window_minutes) || 0)),
        boost_duration_minutes: Math.max(1, Math.trunc(Number(w.boost_duration_minutes) || 0)),
      }))
      .filter((w) => w.start_utc !== '')
    if (normalized.length === 0) return null
    for (const w of normalized) {
      if (!re.test(w.start_utc) || w.claim_window_minutes <= 0 || w.boost_duration_minutes <= 0) return null
    }
    return normalized
  }

  const saveRakebackBoostBenefit = async (): Promise<boolean> => {
    if (!selectedId || !canEdit) return false
    const windows = parseRakebackBoostWindows()
    if (!rakebackBoostProgramKey.trim() || rakebackBoostPercentAdd <= 0 || !windows) {
      toast.error('Set boost program key, positive boost percent, and valid HH:MM UTC windows')
      return false
    }
    const maxClaims = Math.max(1, parseInt(rakebackBoostMaxClaimsPerDay, 10) || 1)
    const existing = existingRakebackBoostBenefit
    const payload = {
      sort_order: parseInt(rakebackBoostSort, 10) || 0,
      benefit_type: 'rakeback_boost_schedule',
      config: {
        rebate_program_key: rebateProgramKeyToPersist(rakebackBoostProgramKey),
        boost_percent_add: Number(rakebackBoostPercentAdd.toFixed(2)),
        max_claims_per_day: maxClaims,
        display_to_customer: rakebackBoostDisplayToCustomer,
        windows,
      },
      player_title: rakebackBoostTitle.trim() || 'Rakeback boost',
      player_description:
        rakebackBoostDescription.trim() ||
        `Timed +${formatPercent(rakebackBoostPercentAdd)}% boosts unlock throughout the day.`,
    }
    setRakebackBoostSaving(true)
    try {
      const res = await apiFetch(
        existing ? `/v1/admin/vip/tiers/${selectedId}/benefits/${existing.id}` : `/v1/admin/vip/tiers/${selectedId}/benefits`,
        {
          method: existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null
        toast.error(j?.message ?? `Save rakeback boost schedule failed (${res.status})`)
        return false
      }
      toast.success(existing ? 'Rakeback boost schedule updated' : 'Rakeback boost schedule created')
      await loadBenefits()
      return true
    } catch {
      toast.error('Network error saving rakeback boost schedule')
      return false
    } finally {
      setRakebackBoostSaving(false)
    }
  }

  const applyRakebackBoostBenefitEnabled = async (enabled: boolean) => {
    if (!selectedId || !canEdit) return
    if (!existingRakebackBoostBenefit) {
      if (enabled) {
        setRakebackBoostEnabled(true)
        const ok = await saveRakebackBoostBenefit()
        if (!ok) setRakebackBoostEnabled(false)
      } else {
        setRakebackBoostEnabled(false)
      }
      return
    }
    setRakebackBoostSaving(true)
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}/benefits/${existingRakebackBoostBenefit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) {
        toast.error(`Rakeback boost toggle failed (${res.status})`)
        return
      }
      setRakebackBoostEnabled(enabled)
      toast.success(`Rakeback boost ${enabled ? 'enabled' : 'disabled'}`)
      await loadBenefits()
    } catch {
      toast.error('Network error toggling rakeback boost')
    } finally {
      setRakebackBoostSaving(false)
    }
  }

  const onRakebackBoostBenefitToggle = (enabled: boolean) => {
    if (!enabled && rakebackBoostEnabled) {
      setBenefitOffConfirm({
        title: 'Disable rakeback boost schedule for this tier?',
        detail:
          'Timed rakeback boost windows will stop for players at this tier until you turn this back on.',
        onConfirm: async () => {
          setBenefitOffConfirm(null)
          await applyRakebackBoostBenefitEnabled(false)
        },
      })
      return
    }
    void applyRakebackBoostBenefitEnabled(enabled)
  }

  const saveLevelUpCashBenefit = async (): Promise<boolean> => {
    if (!selectedId || !canEdit) return false
    const pct = Number(levelUpPercent)
    if (!pct || pct <= 0) {
      toast.error('Set a positive level-up percentage')
      return false
    }
    const existing = existingLevelUpBenefit
    const maxGrantMinor = parseInt(levelUpMaxGrantMinor, 10)
    const payload = {
      sort_order: parseInt(levelUpSort, 10) || 0,
      benefit_type: 'level_up_cash_percent',
      config: {
        percent_of_previous_level_wager: pct,
        max_grant_minor: maxGrantMinor > 0 ? maxGrantMinor : undefined,
      },
      player_title: levelUpTitle.trim() || 'Level-up cash reward',
      player_description:
        levelUpDescription.trim() || `Cash credit at ${formatPercent(pct)}% of wagering completed on previous level.`,
    }
    setLevelUpSaving(true)
    try {
      const res = await apiFetch(
        existing ? `/v1/admin/vip/tiers/${selectedId}/benefits/${existing.id}` : `/v1/admin/vip/tiers/${selectedId}/benefits`,
        {
          method: existing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) {
        toast.error(`Save level-up cash failed (${res.status})`)
        return false
      }
      toast.success(existing ? 'Level-up cash benefit updated' : 'Level-up cash benefit created')
      await loadBenefits()
      return true
    } catch {
      toast.error('Network error saving level-up benefit')
      return false
    } finally {
      setLevelUpSaving(false)
    }
  }

  const applyLevelUpBenefitEnabled = async (enabled: boolean) => {
    if (!selectedId || !canEdit) return
    if (!existingLevelUpBenefit) {
      if (enabled) {
        const pct = Number(levelUpPercent)
        if (!pct || pct <= 0) {
          toast.error('To enable level-up cash reward, first set a positive percentage and save.')
          setLevelUpEnabled(false)
          return
        }
        setLevelUpEnabled(true)
        const ok = await saveLevelUpCashBenefit()
        if (!ok) setLevelUpEnabled(false)
      } else {
        setLevelUpEnabled(false)
      }
      return
    }
    setLevelUpSaving(true)
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}/benefits/${existingLevelUpBenefit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) {
        toast.error(`Level-up toggle failed (${res.status})`)
        return
      }
      setLevelUpEnabled(enabled)
      toast.success(`Level-up cash ${enabled ? 'enabled' : 'disabled'}`)
      await loadBenefits()
    } catch {
      toast.error('Network error toggling level-up cash')
    } finally {
      setLevelUpSaving(false)
    }
  }

  const onLevelUpBenefitToggle = (enabled: boolean) => {
    if (!enabled && levelUpEnabled) {
      setBenefitOffConfirm({
        title: 'Disable level-up cash reward for this tier?',
        detail:
          'Players will no longer receive level-up cash when progressing into this tier until you turn this back on.',
        onConfirm: async () => {
          setBenefitOffConfirm(null)
          await applyLevelUpBenefitEnabled(false)
        },
      })
      return
    }
    void applyLevelUpBenefitEnabled(enabled)
  }

  const save = async () => {
    if (!selectedId || !canEdit || !selected) return
    const tierName = name.trim()
    if (!tierName) {
      toast.error('Tier name is required')
      return
    }
    const minMinor = wagerMinorFromDollarField(minWager)
    const rawMin = String(minWager).replace(/,/g, '').trim()
    if (rawMin !== '' && Number.isFinite(Number(rawMin)) && Number(rawMin) < 0) {
      toast.error('Minimum wager cannot be negative')
      return
    }
    const perks = mergeVipTierPerksFromForm(
      { ...(selected.perks ?? {}) },
      {
        showOnPublicPage: showOnVipPage,
        headerColor: perkHeaderColor,
        imageUrl: perkImageUrl,
        rankLabel: perkRankLabel,
        weeklyBonusEnabled,
        monthlyBonusEnabled,
      },
    )
    setSaving(true)
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tierName,
          min_lifetime_wager_minor: minMinor,
          perks,
        }),
      })
      if (!res.ok) {
        const apiErr = await readApiError(res)
        toast.error(formatApiError(apiErr, `Save failed (${res.status})`))
        return
      }
      toast.success('VIP tier updated')
      await load()
      setTierEditorOpen(false)
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  const setTierPublicVisibility = async (tier: VipTierRow, visible: boolean) => {
    if (!canEdit) return
    const nextPerks = mergeVipTierPerksFromForm(
      { ...(tier.perks ?? {}) },
      {
        showOnPublicPage: visible,
        headerColor:
          tier.perks && typeof tier.perks === 'object' && !Array.isArray(tier.perks)
            ? String(
                (tier.perks as Record<string, unknown>).display &&
                  typeof (tier.perks as Record<string, unknown>).display === 'object' &&
                  !Array.isArray((tier.perks as Record<string, unknown>).display)
                  ? (((tier.perks as Record<string, unknown>).display as Record<string, unknown>).header_color ?? '')
                  : '',
              )
            : '',
        imageUrl:
          tier.perks && typeof tier.perks === 'object' && !Array.isArray(tier.perks)
            ? String(
                (tier.perks as Record<string, unknown>).display &&
                  typeof (tier.perks as Record<string, unknown>).display === 'object' &&
                  !Array.isArray((tier.perks as Record<string, unknown>).display)
                  ? (((tier.perks as Record<string, unknown>).display as Record<string, unknown>).character_image_url ?? '')
                  : '',
              )
            : '',
        rankLabel:
          tier.perks && typeof tier.perks === 'object' && !Array.isArray(tier.perks)
            ? String(
                (tier.perks as Record<string, unknown>).display &&
                  typeof (tier.perks as Record<string, unknown>).display === 'object' &&
                  !Array.isArray((tier.perks as Record<string, unknown>).display)
                  ? (((tier.perks as Record<string, unknown>).display as Record<string, unknown>).rank_label ?? '')
                  : '',
              )
            : '',
      },
    )
    setTierVisibilitySavingId(tier.id)
    try {
      const res = await apiFetch(`/v1/admin/vip/tiers/${tier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tier.name,
          min_lifetime_wager_minor: tier.min_lifetime_wager_minor,
          perks: nextPerks,
        }),
      })
      if (!res.ok) {
        toast.error(`Visibility update failed (${res.status})`)
        return
      }
      toast.success(`Tier ${visible ? 'shown' : 'hidden'} on public VIP ladder`)
      await load()
    } catch {
      toast.error('Network error updating tier visibility')
    } finally {
      setTierVisibilitySavingId(null)
    }
  }

  const onTierPublicLadderToggle = (t: VipTierRow, nextChecked: boolean) => {
    if (!canEdit) return
    const perks = t.perks ?? {}
    const ladderOn = (perks.hide_from_public_page as boolean | undefined) !== true
    if (ladderOn && !nextChecked) {
      setBenefitOffConfirm({
        variant: 'danger',
        title: 'Hide from public VIP ladder?',
        detail:
          'This tier will disappear from the player-facing VIP ladder until you turn visibility back on. Player tier assignments and benefits are unchanged.',
        confirmLabel: 'Hide from ladder',
        onConfirm: async () => {
          setBenefitOffConfirm(null)
          await setTierPublicVisibility(t, false)
        },
      })
      return
    }
    void setTierPublicVisibility(t, nextChecked)
  }

  const submitCreateTier = async () => {
    if (!canEdit) return
    const nm = createTierName.trim()
    if (!nm) {
      toast.error('Tier name is required')
      return
    }
    const minMinor = wagerMinorFromDollarField(createTierMinWager)
    const rawMin = String(createTierMinWager).replace(/,/g, '').trim()
    if (rawMin !== '' && Number.isFinite(Number(rawMin)) && Number(rawMin) < 0) {
      toast.error('Minimum wager cannot be negative')
      return
    }
    setCreateTierSaving(true)
    try {
      const res = await apiFetch('/v1/admin/vip/tiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nm,
          min_lifetime_wager_minor: minMinor,
          perks: {},
        }),
      })
      if (!res.ok) {
        const apiErr = await readApiError(res)
        toast.error(formatApiError(apiErr, `Create tier failed (${res.status})`))
        return
      }
      const j = (await res.json()) as { id?: number }
      const id = typeof j.id === 'number' ? j.id : null
      toast.success('VIP tier created')
      await load()
      setCreateTierOpen(false)
      setCreateTierName('')
      setCreateTierMinWager('0')
      if (id != null) openTierEditor(id)
    } catch {
      toast.error('Network error creating tier')
    } finally {
      setCreateTierSaving(false)
    }
  }

  const persistTierScheduledBonuses = async (nextWeekly: boolean, nextMonthly: boolean) => {
    if (!selectedId || !canEdit || !selected) return
    setScheduledBonusSaving(true)
    try {
      const perks = mergeVipTierPerksFromForm(
        { ...(selected.perks ?? {}) },
        {
          showOnPublicPage: showOnVipPage,
          headerColor: perkHeaderColor,
          imageUrl: perkImageUrl,
          rankLabel: perkRankLabel,
          weeklyBonusEnabled: nextWeekly,
          monthlyBonusEnabled: nextMonthly,
        },
      )
      const res = await apiFetch(`/v1/admin/vip/tiers/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          min_lifetime_wager_minor: wagerMinorFromDollarField(minWager),
          perks,
        }),
      })
      if (!res.ok) {
        toast.error(`Scheduled bonus flags failed (${res.status})`)
        return
      }
      setWeeklyBonusEnabled(nextWeekly)
      setMonthlyBonusEnabled(nextMonthly)
      toast.success('Scheduled bonus eligibility updated')
      await load()
    } catch {
      toast.error('Network error')
    } finally {
      setScheduledBonusSaving(false)
    }
  }

  const onScheduledWeeklyToggle = (nextWeekly: boolean) => {
    if (!nextWeekly && weeklyBonusEnabled) {
      setBenefitOffConfirm({
        title: 'Disable weekly VIP bonus for this tier?',
        detail:
          'Players on this tier will no longer see the weekly reward card or receive scheduled weekly deliveries until you turn this back on.',
        onConfirm: () => {
          setBenefitOffConfirm(null)
          void persistTierScheduledBonuses(false, monthlyBonusEnabled)
        },
      })
      return
    }
    void persistTierScheduledBonuses(nextWeekly, monthlyBonusEnabled)
  }

  const onScheduledMonthlyToggle = (nextMonthly: boolean) => {
    if (!nextMonthly && monthlyBonusEnabled) {
      setBenefitOffConfirm({
        title: 'Disable monthly VIP bonus for this tier?',
        detail:
          'Players on this tier will no longer see the monthly reward card or receive scheduled monthly deliveries until you turn this back on.',
        onConfirm: () => {
          setBenefitOffConfirm(null)
          void persistTierScheduledBonuses(weeklyBonusEnabled, false)
        },
      })
      return
    }
    void persistTierScheduledBonuses(weeklyBonusEnabled, nextMonthly)
  }

  const origin = playerUiOrigin()
  const playerVipUrl = `${origin}/vip`
  const existingRakebackBenefit = benefits.find((b) => b.benefit_type === 'rebate_percent_add')
  const existingRakebackBoostBenefit = benefits.find((b) => b.benefit_type === 'rakeback_boost_schedule')
  const existingLevelUpBenefit = benefits.find((b) => b.benefit_type === 'level_up_cash_percent')

  return (
    <>
      <PageMeta
        title="VIP system — Admin"
        description="VIP tiers, unlock grants, rebate boosts, and delivery visibility."
      />
      <PageBreadcrumb
        pageTitle="VIP system"
        subtitle="Players advance by lifetime cash wager. Attach unlock bonuses and rebate boosts per tier."
      />

      <div className="mb-3 rounded-3 border border-secondary-subtle bg-body-tertiary p-2">
        <div className="btn-group flex-wrap" role="group" aria-label="VIP sections">
          <button
            type="button"
            className={`btn btn-sm ${tab === 'overview' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'activity' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setTab('activity')}
          >
            Activity
          </button>
          <button
            type="button"
            className={`btn btn-sm ${tab === 'payouts' ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setTab('payouts')}
          >
            Reward payouts
          </button>
        </div>
      </div>

      <div className="d-flex flex-wrap gap-2 mb-4 rounded-3 border border-secondary-subtle bg-body-tertiary p-2">
        <a href={playerVipUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">
          <i className="bi bi-box-arrow-up-right me-1" />
          Open player VIP page
        </a>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() => {
            void load()
            void loadSummary()
            void loadBenefits()
          }}
        >
          <i className="bi bi-arrow-clockwise me-1" />
          Refresh
        </button>
      </div>

      {tab === 'overview' ? (
        <div className="card card-body">
          {summaryLoading ? <p className="text-secondary small mb-0">Loading delivery summary…</p> : null}
          {summary ? (
            <>
              <div className="row g-3 mb-4">
                <div className="col-md-4">
                  <StatCard
                    label="Tier-ups (7d)"
                    value={String(summary.tier_events_7d)}
                    variant="success"
                    iconClass="bi-graph-up-arrow"
                  />
                </div>
                <div className="col-md-4">
                  <StatCard
                    label="Players untiered"
                    value={String(summary.players_untiered)}
                    variant="warning"
                    iconClass="bi-person-dash"
                  />
                </div>
                <div className="col-md-4">
                  <StatCard
                    label="Grant outcomes (7d)"
                    value={
                      Object.entries(summary.grant_log_7d_by_result || {})
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(' · ') || '—'
                    }
                    variant="info"
                    iconClass="bi-gift"
                  />
                </div>
                <div className="col-md-4">
                  <StatCard
                    label="VIP delivery cost (7d)"
                    value={`$${((summary.delivery_cost_7d_minor ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                    variant="danger"
                    iconClass="bi-cash-coin"
                  />
                </div>
                <div className="col-md-4">
                  <StatCard
                    label="Delivery success (7d)"
                    value={`${Math.round((summary.delivery_success_rate_7d ?? 0) * 100)}%`}
                    variant="success"
                    iconClass="bi-check2-circle"
                  />
                </div>
                <div className="col-md-4">
                  <StatCard
                    label="Runs failed (7d)"
                    value={`${summary.delivery_runs_failed_7d ?? 0} / ${summary.delivery_runs_7d ?? 0}`}
                    variant="warning"
                    iconClass="bi-exclamation-triangle"
                  />
                </div>
              </div>
              <div className="mb-4">
                <h3 className="h6">Delivery cost by pipeline (7d)</h3>
                <div className="table-responsive mt-2">
                  <table className="table table-sm table-striped mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="small">Pipeline</th>
                        <th className="small">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(summary.delivery_cost_7d_by_pipeline_minor || {}).map(([k, v]) => (
                        <tr key={k}>
                          <td className="small">{k}</td>
                          <td className="font-monospace small">
                            ${((v ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                      {Object.keys(summary.delivery_cost_7d_by_pipeline_minor || {}).length === 0 ? (
                        <tr>
                          <td className="small text-secondary" colSpan={2}>
                            No delivery cost rows yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <h3 className="h6">Population by tier</h3>
                <div className="table-responsive mt-2">
                  <table className="table table-sm table-striped mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="small">Tier</th>
                        <th className="small">Players</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.tier_population.map((r) => (
                        <tr key={r.tier_id}>
                          <td className="small">
                            {r.name}{' '}
                            <span className="text-secondary">(rank {r.sort_order}, id {r.tier_id})</span>
                          </td>
                          <td className="font-monospace small">{r.player_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="small text-secondary mt-3 mb-0">
                Tier-targeted broadcasts live under{' '}
                <Link to="/engagement/vip/broadcast" className="text-brand-600 underline dark:text-brand-400">
                  Player messaging
                </Link>
                .
              </p>
            </>
          ) : (
            !summaryLoading && <p className="text-sm text-gray-500">No summary data.</p>
          )}
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          {summaryLoading ? <p className="p-4 text-sm text-gray-500">Loading…</p> : null}
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800/80">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">When</th>
                <th className="px-3 py-2 text-left font-semibold">User</th>
                <th className="px-3 py-2 text-left font-semibold">From → To</th>
                <th className="px-3 py-2 text-left font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-transparent dark:divide-gray-700">
              {(summary?.recent_tier_events ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-300">
                    {e.created_at}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.user_id.slice(0, 8)}…</td>
                  <td className="px-3 py-2 text-xs">
                    {e.from_tier_id ?? '—'} → {e.to_tier_id ?? '—'}
                  </td>
                  <td className="max-w-md px-3 py-2 text-xs text-gray-700 dark:text-gray-300">
                    {formatTierEventMeta(e.meta as Record<string, unknown> | undefined)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!summaryLoading && (summary?.recent_tier_events?.length ?? 0) === 0 ? (
            <p className="p-4 text-sm text-gray-500">No tier events yet.</p>
          ) : null}
        </div>
      ) : null}

      {tab === 'payouts' ? (
        <div className="card card-body">
          <div className="d-flex flex-wrap align-items-end gap-2 mb-3">
            <div style={{ minWidth: 320 }} className="flex-grow-1">
              <label className={labelCls}>Search (customer, email, reward id, withdrawal id, provider id)</label>
              <input
                className={inputCls}
                value={payoutQuery}
                onChange={(e) => setPayoutQuery(e.target.value)}
                placeholder="e.g. user uuid, email, reward:hunt..., wdr_..."
              />
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void loadPayoutLog()}>
              Search
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => {
                setPayoutQuery('')
                void loadPayoutLog()
              }}
            >
              Clear
            </button>
          </div>

          <div className="table-responsive">
            <table className="table table-sm table-striped mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th className="small">Time</th>
                  <th className="small">Customer</th>
                  <th className="small">Reward type</th>
                  <th className="small">Amount</th>
                  <th className="small">Reward trace</th>
                  <th className="small">Payout rail</th>
                  <th className="small">Links</th>
                </tr>
              </thead>
              <tbody>
                {payoutLog.map((row) => (
                  <tr key={`${row.ledger_id}-${row.reward_idempotency_key}`}>
                    <td className="small">{row.created_at}</td>
                    <td className="small">
                      <div className="font-monospace">{row.user_id}</div>
                      {row.email ? <div className="text-secondary">{row.email}</div> : null}
                    </td>
                    <td className="small">{row.entry_type}</td>
                    <td className="small font-monospace">
                      {((row.amount_minor ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                      {row.currency}
                    </td>
                    <td className="small">
                      <div className="font-monospace">{row.reward_idempotency_key}</div>
                      <div className="text-secondary">ledger #{row.ledger_id}</div>
                    </td>
                    <td className="small">
                      <div className="font-monospace">{row.withdrawal_id || '—'}</div>
                      <div className="text-secondary">{row.withdrawal_status || '—'}</div>
                      {row.provider_withdrawal_id ? (
                        <div className="text-secondary font-monospace">{row.provider_withdrawal_id}</div>
                      ) : null}
                    </td>
                    <td className="small">
                      <div className="d-flex flex-wrap gap-1">
                        <Link to={`/support/player/${row.user_id}`} className="btn btn-outline-secondary btn-sm">
                          Player
                        </Link>
                        <Link to={`/ledger`} className="btn btn-outline-secondary btn-sm">
                          Ledger
                        </Link>
                        <Link to={`/withdrawals`} className="btn btn-outline-secondary btn-sm">
                          Withdrawals
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {!payoutLoading && payoutLog.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="small text-secondary">
                      No reward payout rows found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {payoutLoading ? <p className="small text-secondary mt-2 mb-0">Loading payout log…</p> : null}
        </div>
      ) : null}

      {tab === 'overview' ? (
        <>
          {loading ? <p className="text-sm text-gray-500">Loading…</p> : null}
          <p className="text-sm text-secondary mb-3 max-w-3xl">
            Author promotion versions in{' '}
            <Link to="/bonushub" className="text-brand-600 underline dark:text-brand-400">
              Bonus Hub
            </Link>
            , then attach them to tiers below. Tier benefits execute through the same grant pipeline as catalog promos; rakeback
            burst multipliers (when enabled) apply on top of base rebate programme keys.
          </p>
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
              <div className="border-bottom px-3 py-2 d-flex align-items-center justify-content-between flex-wrap gap-2 bg-body-tertiary">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <span className="small fw-semibold text-secondary text-uppercase">VIP tiers</span>
                  <span className="badge bg-secondary-subtle text-secondary-emphasis">{tiers.length} total</span>
                </div>
                {canEdit ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setCreateTierOpen(true)}
                  >
                    Create tier
                  </button>
                ) : null}
              </div>
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-800/80">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">ID</th>
                    <th
                      className="px-3 py-2 text-left font-semibold"
                      title="0 = lowest min wager; recomputed automatically when you save a tier."
                    >
                      Rank
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">Name</th>
                    <th className="px-3 py-2 text-left font-semibold">Min wager ($)</th>
                    <th className="px-3 py-2 text-left font-semibold text-nowrap">W / M bonus</th>
                    <th className="px-3 py-2 text-left font-semibold">Public VIP ladder</th>
                    <th className="px-3 py-2 text-end font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-transparent dark:divide-gray-700">
                  {tiers.map((t) => (
                    (() => {
                      const perks = t.perks ?? {}
                      const isVisible = (perks.hide_from_public_page as boolean | undefined) !== true
                      const wOn = perks.weekly_bonus_enabled === true
                      const mOn = perks.monthly_bonus_enabled === true
                      return (
                    <tr
                      key={t.id}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 ${selectedId === t.id ? 'bg-brand-500/10' : ''}`}
                      onClick={() => openTierEditor(t.id)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{t.id}</td>
                      <td className="px-3 py-2">{t.sort_order}</td>
                      <td className="px-3 py-2 font-medium">{t.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">${formatWagerDollarsFromMinor(t.min_lifetime_wager_minor)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <span className={wOn ? 'text-success' : 'text-secondary'}>{wOn ? 'W●' : 'W○'}</span>
                        {' · '}
                        <span className={mOn ? 'text-success' : 'text-secondary'}>{mOn ? 'M●' : 'M○'}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="form-check form-switch m-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={isVisible}
                            disabled={!canEdit || tierVisibilitySavingId === t.id}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => onTierPublicLadderToggle(t, e.target.checked)}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-end">
                        <button
                          type="button"
                          className="btn btn-outline-primary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            openTierEditor(t.id)
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                      )
                    })()
                  ))}
                  {tiers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-xs text-secondary">
                        No VIP tiers found.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <VipLoyaltyHeroSection apiFetch={apiFetch} role={role} />

            <p className="text-sm text-secondary mb-0">
              Click a tier row or <strong>Edit</strong> to open tier details, scheduled bonuses, and benefit configuration.
            </p>

            {createTierOpen ? (
              <div
                className="modal fade show d-block"
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                style={{
                  zIndex: 1055,
                  backgroundColor: 'rgba(0, 0, 0, 0.4)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
                onClick={(e) => {
                  if (createTierSaving) return
                  if (e.target === e.currentTarget) setCreateTierOpen(false)
                }}
              >
                <div className="modal-dialog modal-dialog-centered" onClick={(ev) => ev.stopPropagation()}>
                  <div className="modal-content">
                    <div className="modal-header">
                      <h5 className="modal-title">Create VIP tier</h5>
                      <button
                        type="button"
                        className="btn-close"
                        disabled={createTierSaving}
                        aria-label="Close"
                        onClick={() => !createTierSaving && setCreateTierOpen(false)}
                      />
                    </div>
                    <div className="modal-body">
                      <p className="small text-secondary">
                        New tiers start hidden on the public VIP ladder. Qualifying players are assigned automatically from
                        lifetime wager after save.
                      </p>
                      <div className="mb-3">
                        <label className={labelCls}>Name</label>
                        <input
                          className={inputCls}
                          value={createTierName}
                          onChange={(e) => setCreateTierName(e.target.value)}
                          placeholder="e.g. ORCA"
                          disabled={createTierSaving}
                          autoComplete="off"
                        />
                      </div>
                      <div className="mb-0">
                        <label className={labelCls}>Minimum lifetime wager ($)</label>
                        <input
                          className={inputCls}
                          type="text"
                          inputMode="decimal"
                          value={createTierMinWager}
                          onChange={(e) => setCreateTierMinWager(e.target.value)}
                          disabled={createTierSaving}
                        />
                      </div>
                    </div>
                    <div className="modal-footer">
                      <button
                        type="button"
                        className="btn btn-outline-secondary"
                        disabled={createTierSaving}
                        onClick={() => setCreateTierOpen(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={createTierSaving}
                        onClick={() => void submitCreateTier()}
                      >
                        {createTierSaving ? 'Creating…' : 'Create'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {tierEditorOpen ? (
              <div
                className="modal fade show d-block"
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-labelledby="vip-tier-editor-title"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.45)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setTierEditorOpen(false)
                }}
              >
                <div className="modal-dialog modal-xl modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-content">
                    <div className="modal-header align-items-center">
                      <h5 className="modal-title mb-0 me-auto" id="vip-tier-editor-title">
                        {selected ? `Edit tier — ${selected.name}` : 'Edit tier'}
                      </h5>
                      <div className="d-flex align-items-center gap-2">
                        {!canEdit && selected ? (
                          <span className="badge text-bg-secondary small">Superadmin only</span>
                        ) : null}
                        {canEdit && selected ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={saving}
                            onClick={() => void save()}
                          >
                            {saving ? 'Saving…' : 'Save tier'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-close m-0"
                          aria-label="Close"
                          onClick={() => setTierEditorOpen(false)}
                        />
                      </div>
                    </div>
                    <div className="modal-body">
              {!selected ? (
                <p className="text-sm text-gray-500">Select a tier from the table.</p>
              ) : (
                <div className="space-y-4">
                  <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-0">Edit tier #{selected.id}</h2>
                    <span className="badge text-bg-primary">{selected.name}</span>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="vip-name">
                      Name
                    </label>
                    <input id="vip-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="vip-min">
                      Minimum lifetime wager to reach this tier
                    </label>
                    <div className="input-group input-group-sm">
                      <span className="input-group-text">$</span>
                      <input
                        id="vip-min"
                        className={inputCls}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="e.g. 1.00"
                        value={minWager}
                        onChange={(e) => setMinWager(e.target.value)}
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Dollar amount (decimals allowed). Stored as cents/minor units internally (1.00 = 100). Player lifetime
                      wager increases from each qualifying real-money game stake ({' '}
                      <code className="small">game.debit</code> cash pocket) processed by the VIP accrual worker.
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-600 dark:bg-white/5">
                    <p className="mb-3 text-xs font-semibold text-gray-800 dark:text-gray-200">How this tier looks on the VIP page</p>
                    <div className="d-flex align-items-center gap-2">
                      <div className="form-check form-switch m-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={showOnVipPage}
                          onChange={(e) => setShowOnVipPage(e.target.checked)}
                        />
                      </div>
                      <span className="text-sm text-gray-800 dark:text-gray-200">
                        Show this tier on the public VIP ladder
                      </span>
                    </div>
                    <div className="mt-3">
                      <label className={labelCls} htmlFor="vip-rank-label">
                        Tier badge label (shown to players)
                      </label>
                      <input
                        id="vip-rank-label"
                        className={inputCls}
                        value={perkRankLabel}
                        onChange={(e) => setPerkRankLabel(e.target.value)}
                        placeholder="Rank 1"
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Player-facing short text for this tier (for example: Rank 1, Bronze, Starter).
                      </p>
                    </div>
                    <div className="mt-3">
                      <label className={labelCls} htmlFor="vip-header-color">
                        Header accent color
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          id="vip-header-color"
                          type="color"
                          className="h-10 w-14 cursor-pointer rounded border border-gray-300 bg-transparent dark:border-gray-600"
                          value={perkHeaderColor.match(/^#[0-9a-fA-F]{6}$/) ? perkHeaderColor : '#888888'}
                          onChange={(e) => setPerkHeaderColor(e.target.value)}
                        />
                        <input
                          className={`${inputCls} max-w-xs flex-1`}
                          value={perkHeaderColor}
                          onChange={(e) => setPerkHeaderColor(e.target.value)}
                          placeholder="#898b8a"
                        />
                        <span
                          className="d-inline-block rounded border border-secondary-subtle"
                          style={{
                            width: 18,
                            height: 18,
                            backgroundColor: perkHeaderColor.match(/^#[0-9a-fA-F]{6}$/) ? perkHeaderColor : '#888888',
                          }}
                          title="Current accent preview"
                        />
                      </div>
                    </div>
                    <div className="mt-3">
                      <ImageUrlField
                        id="vip-char-img"
                        label="Character image"
                        hint="Shown on the VIP ladder for this tier. Upload or paste a CDN URL."
                        value={perkImageUrl}
                        onChange={setPerkImageUrl}
                        disabled={!canEdit}
                        uploadFile={uploadFile}
                      />
                    </div>
                  </div>

                  <hr className="border-gray-200 dark:border-gray-700" />
                  <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 dark:border-gray-600 dark:bg-white/5">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Scheduled tier bonuses</h3>
                    <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                      When <strong>on</strong>, players on this tier see the weekly / monthly reward cards on the player VIP
                      page. Configure delivery windows and publish matching offers on{' '}
                      <Link to="/engagement/vip/schedules" className="link-primary">
                        VIP → Bonus scheduling
                      </Link>
                      .
                    </p>
                    <div className="row g-3">
                      <div className="col-12 col-md-6">
                        <div className="d-flex align-items-center justify-content-between rounded border border-secondary-subtle bg-body p-2">
                          <div>
                            <div className="small fw-semibold">Weekly bonus</div>
                            <div className="text-xs text-secondary">Show card + allow scheduled weekly delivery</div>
                          </div>
                          <div className="form-check form-switch m-0">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              role="switch"
                              checked={weeklyBonusEnabled}
                              disabled={!canEdit || scheduledBonusSaving}
                              onChange={(e) => void onScheduledWeeklyToggle(e.target.checked)}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="col-12 col-md-6">
                        <div className="d-flex align-items-center justify-content-between rounded border border-secondary-subtle bg-body p-2">
                          <div>
                            <div className="small fw-semibold">Monthly bonus</div>
                            <div className="text-xs text-secondary">Show card + allow scheduled monthly delivery</div>
                          </div>
                          <div className="form-check form-switch m-0">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              role="switch"
                              checked={monthlyBonusEnabled}
                              disabled={!canEdit || scheduledBonusSaving}
                              onChange={(e) => void onScheduledMonthlyToggle(e.target.checked)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    {!canEdit ? (
                      <p className="mt-2 mb-0 text-xs text-amber-700 dark:text-amber-400">Superadmin required to edit.</p>
                    ) : null}
                  </div>

                  <hr className="border-gray-200 dark:border-gray-700" />

                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Tier benefits</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Scheduled weekly / monthly bonuses are toggled above. Rakeback and level-up perks use Bonus Hub /
                    rebate programme keys consistently (e.g. weekly cashback keyed as rakeback).
                  </p>

                  {canEdit ? (
                    <div className="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-white/5">
                      <div className="row g-3 mb-2 align-items-stretch">
                        <div className="col-12 col-xxl-6">
                          <div className="rounded border border-secondary-subtle bg-body p-2 h-100 d-flex flex-column">
                            <div className="d-flex align-items-center justify-content-between mb-2">
                              <div className="small fw-semibold">Rakeback (base)</div>
                              <div className="form-check form-switch m-0">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={rakebackEnabled}
                                  disabled={rakebackSaving}
                                  onChange={(e) => void onRakebackBenefitToggle(e.target.checked)}
                                />
                              </div>
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Rebate programme key</label>
                              <input
                                className={inputCls}
                                value={rakebackProgramKey}
                                disabled={!rakebackEnabled}
                                onChange={(e) => setRakebackProgramKey(e.target.value)}
                                placeholder="e.g. rakeback"
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Extra rebate %</label>
                              <input
                                type="range"
                                className="form-range"
                                min={0.1}
                                max={30}
                                step={0.1}
                                value={rakebackPercentAdd}
                                disabled={!rakebackEnabled}
                                onChange={(e) => setRakebackPercentAdd(Number(e.target.value) || 0.1)}
                              />
                              <input
                                className={inputCls}
                                type="number"
                                min={0.1}
                                max={30}
                                step={0.1}
                                value={rakebackPercentAdd}
                                disabled={!rakebackEnabled}
                                onChange={(e) => setRakebackPercentAdd(Number(e.target.value) || 0.1)}
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Display order (lower first)</label>
                              <input
                                className={inputCls}
                                value={rakebackSort}
                                disabled={!rakebackEnabled}
                                onChange={(e) => setRakebackSort(e.target.value)}
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Player card title</label>
                              <input
                                className={inputCls}
                                value={rakebackTitle}
                                disabled={!rakebackEnabled}
                                onChange={(e) => setRakebackTitle(e.target.value)}
                                placeholder="Rakeback"
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Player card description</label>
                              <input
                                className={inputCls}
                                value={rakebackDescription}
                                disabled={!rakebackEnabled}
                                onChange={(e) => setRakebackDescription(e.target.value)}
                                placeholder="Permanent +X% rakeback uplift"
                              />
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm mt-auto align-self-start"
                              disabled={rakebackSaving || !rakebackEnabled}
                              onClick={() => void saveRakebackTierBenefit()}
                            >
                              {rakebackSaving ? 'Saving…' : 'Save rakeback'}
                            </button>
                          </div>
                        </div>
                        <div className="col-12 col-xxl-6">
                          <div className="rounded border border-secondary-subtle bg-body p-2 h-100 d-flex flex-column">
                            <div className="d-flex align-items-center justify-content-between mb-2">
                              <div className="small fw-semibold">Rakeback boost schedule</div>
                              <div className="form-check form-switch m-0">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={rakebackBoostEnabled}
                                  disabled={rakebackBoostSaving}
                                  onChange={(e) => void onRakebackBoostBenefitToggle(e.target.checked)}
                                />
                              </div>
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Rebate programme key</label>
                              <input
                                className={inputCls}
                                value={rakebackBoostProgramKey}
                                disabled={!rakebackBoostEnabled}
                                onChange={(e) => setRakebackBoostProgramKey(e.target.value)}
                                placeholder="e.g. rakeback"
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Boost extra % during active window</label>
                              <input
                                type="range"
                                className="form-range"
                                min={0.1}
                                max={15}
                                step={0.1}
                                value={rakebackBoostPercentAdd}
                                disabled={!rakebackBoostEnabled}
                                onChange={(e) => setRakebackBoostPercentAdd(Number(e.target.value) || 0.1)}
                              />
                              <input
                                className={inputCls}
                                type="number"
                                min={0.1}
                                max={15}
                                step={0.1}
                                value={rakebackBoostPercentAdd}
                                disabled={!rakebackBoostEnabled}
                                onChange={(e) => setRakebackBoostPercentAdd(Number(e.target.value) || 0.1)}
                              />
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="mb-2">
                                <label className={labelCls}>Max boosts per day</label>
                                <input
                                  className={inputCls}
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={rakebackBoostMaxClaimsPerDay}
                                  disabled={!rakebackBoostEnabled}
                                  onChange={(e) => setRakebackBoostMaxClaimsPerDay(e.target.value)}
                                />
                              </div>
                              <div className="mb-2">
                                <label className={labelCls}>Display order (lower first)</label>
                                <input
                                  className={inputCls}
                                  value={rakebackBoostSort}
                                  disabled={!rakebackBoostEnabled}
                                  onChange={(e) => setRakebackBoostSort(e.target.value)}
                                />
                              </div>
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Customer card visibility</label>
                              <label className="d-flex align-items-center gap-2 small mb-1">
                                <input
                                  className="form-check-input m-0"
                                  type="checkbox"
                                  checked={rakebackBoostDisplayToCustomer}
                                  disabled={!rakebackBoostEnabled}
                                  onChange={(e) => setRakebackBoostDisplayToCustomer(e.target.checked)}
                                />
                                Display to customers
                              </label>
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Player card title</label>
                              <input
                                className={inputCls}
                                value={rakebackBoostTitle}
                                disabled={!rakebackBoostEnabled}
                                onChange={(e) => setRakebackBoostTitle(e.target.value)}
                                placeholder="Rakeback boost"
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Player card description</label>
                              <input
                                className={inputCls}
                                value={rakebackBoostDescription}
                                disabled={!rakebackBoostEnabled}
                                onChange={(e) => setRakebackBoostDescription(e.target.value)}
                                placeholder="Unlock timed boosts during the day"
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Daily unlock windows (UTC)</label>
                              <div className="table-responsive">
                                <table className="table table-sm mb-2">
                                  <thead>
                                    <tr>
                                      <th className="small">Unlock (HH:MM)</th>
                                      <th className="small">Claim window (minutes)</th>
                                      <th className="small">Boost duration (minutes)</th>
                                      <th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rakebackBoostWindows.map((w, idx) => (
                                      <tr key={`rbw-${idx}`}>
                                        <td>
                                          <input
                                            className={inputCls}
                                            value={w.start_utc}
                                            disabled={!rakebackBoostEnabled}
                                            onChange={(e) =>
                                              setRakebackBoostWindows((prev) =>
                                                prev.map((row, i) => (i === idx ? { ...row, start_utc: e.target.value } : row)),
                                              )
                                            }
                                            placeholder="04:00"
                                          />
                                        </td>
                                        <td>
                                          <input
                                            className={inputCls}
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={w.claim_window_minutes}
                                            disabled={!rakebackBoostEnabled}
                                            onChange={(e) =>
                                              setRakebackBoostWindows((prev) =>
                                                prev.map((row, i) =>
                                                  i === idx ? { ...row, claim_window_minutes: Number(e.target.value) || 1 } : row,
                                                ),
                                              )
                                            }
                                          />
                                        </td>
                                        <td>
                                          <input
                                            className={inputCls}
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={w.boost_duration_minutes}
                                            disabled={!rakebackBoostEnabled}
                                            onChange={(e) =>
                                              setRakebackBoostWindows((prev) =>
                                                prev.map((row, i) =>
                                                  i === idx ? { ...row, boost_duration_minutes: Number(e.target.value) || 1 } : row,
                                                ),
                                              )
                                            }
                                          />
                                        </td>
                                        <td className="text-end">
                                          <button
                                            type="button"
                                            className="btn btn-outline-danger btn-sm"
                                            disabled={!rakebackBoostEnabled || rakebackBoostWindows.length <= 1}
                                            onClick={() =>
                                              setRakebackBoostWindows((prev) => prev.filter((_, i) => i !== idx))
                                            }
                                          >
                                            Remove
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                disabled={!rakebackBoostEnabled}
                                onClick={() =>
                                  setRakebackBoostWindows((prev) => [
                                    ...prev,
                                    { start_utc: '00:00', claim_window_minutes: 60, boost_duration_minutes: 60 },
                                  ])
                                }
                              >
                                Add window
                              </button>
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm mt-auto align-self-start"
                              disabled={rakebackBoostSaving || !rakebackBoostEnabled}
                              onClick={() => void saveRakebackBoostBenefit()}
                            >
                              {rakebackBoostSaving ? 'Saving…' : 'Save rakeback boost schedule'}
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="row g-3 mb-2">
                        <div className="col-12 col-xxl-6">
                          <div className="rounded border border-secondary-subtle bg-body p-2 h-100 d-flex flex-column">
                            <div className="d-flex align-items-center justify-content-between mb-2">
                              <div className="small fw-semibold">Level-up cash reward</div>
                              <div className="form-check form-switch m-0">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={levelUpEnabled}
                                  disabled={levelUpSaving}
                                  onChange={(e) => void onLevelUpBenefitToggle(e.target.checked)}
                                />
                              </div>
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Level-up cash % of previous-level wager</label>
                              <input
                                type="range"
                                className="form-range"
                                min={0.1}
                                max={100}
                                step={0.1}
                                value={Number(levelUpPercent) || 0.1}
                                disabled={!levelUpEnabled}
                                onChange={(e) => setLevelUpPercent(e.target.value)}
                              />
                              <input
                                className={inputCls}
                                type="number"
                                min={0.1}
                                max={100}
                                step={0.1}
                                value={levelUpPercent}
                                disabled={!levelUpEnabled}
                                onChange={(e) => setLevelUpPercent(e.target.value)}
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Optional max cash cap (minor)</label>
                              <input
                                className={inputCls}
                                type="number"
                                min={0}
                                step={1}
                                value={levelUpMaxGrantMinor}
                                disabled={!levelUpEnabled}
                                onChange={(e) => setLevelUpMaxGrantMinor(e.target.value)}
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Display order (lower first)</label>
                              <input
                                className={inputCls}
                                value={levelUpSort}
                                disabled={!levelUpEnabled}
                                onChange={(e) => setLevelUpSort(e.target.value)}
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Player card title</label>
                              <input
                                className={inputCls}
                                value={levelUpTitle}
                                disabled={!levelUpEnabled}
                                onChange={(e) => setLevelUpTitle(e.target.value)}
                                placeholder="Level-up cash reward"
                              />
                            </div>
                            <div className="mb-2">
                              <label className={labelCls}>Player card description</label>
                              <input
                                className={inputCls}
                                value={levelUpDescription}
                                disabled={!levelUpEnabled}
                                onChange={(e) => setLevelUpDescription(e.target.value)}
                                placeholder="Cash credit at X% of previous level progress"
                              />
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm mt-auto align-self-start"
                              disabled={levelUpSaving || !levelUpEnabled}
                              onClick={() => void saveLevelUpCashBenefit()}
                            >
                              {levelUpSaving ? 'Saving…' : 'Save level-up cash reward'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {benefitOffConfirm ? (
              <div
                className="modal fade show d-block"
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                style={{
                  zIndex: 1060,
                  backgroundColor: 'rgba(0, 0, 0, 0.4)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setBenefitOffConfirm(null)
                }}
              >
                <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-content">
                    <div className="modal-header">
                      <h5 className="modal-title d-flex align-items-center gap-2">
                        {benefitOffConfirm.variant === 'danger' ? (
                          <i className="bi bi-exclamation-triangle-fill text-danger" aria-hidden />
                        ) : null}
                        <span>{benefitOffConfirm.title}</span>
                      </h5>
                      <button
                        type="button"
                        className="btn-close"
                        aria-label="Close"
                        onClick={() => setBenefitOffConfirm(null)}
                      />
                    </div>
                    <div className="modal-body">
                      <p className="mb-0 text-secondary small">{benefitOffConfirm.detail}</p>
                    </div>
                    <div className="modal-footer">
                      <button type="button" className="btn btn-outline-secondary" onClick={() => setBenefitOffConfirm(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => void Promise.resolve(benefitOffConfirm.onConfirm())}
                      >
                        {benefitOffConfirm.confirmLabel ?? 'Confirm changes'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  )
}
