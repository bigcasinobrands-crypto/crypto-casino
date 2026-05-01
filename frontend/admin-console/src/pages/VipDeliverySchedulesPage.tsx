import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAdminAuth } from '../authContext'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import VipDeliveryPeriodMatrix from '../components/vip/VipDeliveryPeriodMatrix'
import {
  MONTH_GRID_COLS,
  MONTH_GRID_MAX_COLS,
  WEEK_GRID_MAX_COLS,
  WEEK_GRID_PAGE_SIZE,
  firstNonPastMonthlyColumnIndex,
  firstNonPastWeeklyColumnIndex,
  buildMonthlyNextRunIsoFromAnchorLocal,
  buildWeeklyNextRunIsoFromAnchorLocal,
  hydrateMonthlyColumn0NextRunUtcDateInput,
  hydrateMonthlyColumnDeliveryDates,
  hydrateMonthlyDeliveryUtcHm,
  hydrateMonthlyMatrix,
  hydrateWeeklyColumn0NextRunUtcDateInput,
  hydrateWeeklyColumnDeliveryDates,
  hydrateWeeklyDeliveryUtcHm,
  hydrateWeeklyMatrix,
  isoFromUtcDateAndHm,
  monthlyAnchorLocalForHydration,
  monthlyAnchorLocalFromMonthStartDateAndHm,
  monthlyHydrateColumnCount,
  monthlyMatrixToPersist,
  utcMonthStartDateFromAnchorLocal,
  utcWeekStartDateFromAnchorLocal,
  weeklyAnchorLocalForHydration,
  weeklyAnchorLocalFromWeekStartDateAndHm,
  weeklyHydrateColumnCount,
  duplicatePromotionAtSameInstantMessage,
  weeklyMatrixToPersist,
  type TierPvCol,
} from '../lib/vipDeliveryPeriodMatrix'
import {
  collectScheduleHintsForPv,
  formatScheduleDayUtc,
  type ScheduleHint,
  type TrackerScheduleRow,
} from '../lib/vipPromotionScheduleHints'
import { vipTierCharacterImageUrl } from '../lib/vipTierDisplay'

type ScheduleRow = {
  pipeline: string
  enabled: boolean
  config: Record<string, unknown>
  next_run_at?: string
  updated_at?: string
}

type VipTierRow = {
  id: number
  sort_order: number
  name: string
  perks: Record<string, unknown>
}

type BonusHubPromotion = {
  id: number
  name: string
  slug: string
  status?: string
  vip_only?: boolean
  latest_version_id?: number
  latest_version_published?: boolean
  has_published_version?: boolean
}

type DeliveryRunRow = {
  id: string
  pipeline: string
  status: string
  window_start: string
  window_end: string
  started_at: string
  finished_at?: string
  trigger_kind: string
}

const PIPELINE_IDS = ['weekly_bonus', 'monthly_bonus'] as const

function isoToDatetimeLocal(iso?: string): string {
  if (!iso || typeof iso !== 'string') return ''
  const d = new Date(iso.trim())
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const PIPELINE_LABEL: Record<string, string> = {
  weekly_bonus: 'Weekly VIP bonus',
  monthly_bonus: 'Monthly VIP bonus',
}

const VIP_PIPELINE_SAVE_CONFIRM =
  'Saving updates live VIP delivery timing, planned runs, and next run times in UTC. This can reschedule when VIP bonuses grant. Continue?'

const VIP_SCHEDULE_DEFAULTS_SAVE_CONFIRM =
  'Saving schedule defaults updates anchors and the default delivery time for both weekly and monthly VIP automation. This is a high-impact change. Continue?'

const VIP_COLUMN_DATE_CONFIRM =
  'Pinning or changing a delivery UTC date shifts when that column’s bonuses actually grant. Continue?'

function confirmTurnOffAutomation(pipelineLabel: string): boolean {
  return window.confirm(
    `Turn off automation for "${pipelineLabel}"? Scheduled VIP bonus runs pause until automation is enabled again — remember to Save to apply.`,
  )
}

/** Persisted shape: `{ "3": { "promotion_version_id": 101 } }` */
function parseTierPromotionMap(cfg: Record<string, unknown>): Record<number, string> {
  const raw = cfg.tier_promotion_versions
  const out: Record<number, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const tid = Number(k)
    if (!Number.isFinite(tid)) continue
    let pvid = ''
    if (typeof v === 'number' && Number.isFinite(v)) pvid = String(v)
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const n = Number((v as { promotion_version_id?: unknown }).promotion_version_id)
      if (Number.isFinite(n)) pvid = String(n)
    }
    if (pvid) out[tid] = pvid
  }
  return out
}

function buildTierPromotionVersionsObject(
  map: Record<number, string>,
): Record<string, { promotion_version_id: number }> {
  const o: Record<string, { promotion_version_id: number }> = {}
  for (const [tid, pvStr] of Object.entries(map)) {
    const pv = Number(pvStr)
    const tierId = Number(tid)
    if (!Number.isFinite(pv) || pv <= 0 || !Number.isFinite(tierId)) continue
    o[String(tierId)] = { promotion_version_id: pv }
  }
  return o
}

function collectReferencedPromotionVersionIds(schedules: ScheduleRow[]): Set<number> {
  const s = new Set<number>()
  const addFromCfg = (cfg: Record<string, unknown>) => {
    const m = parseTierPromotionMap(cfg)
    for (const pvStr of Object.values(m)) {
      const n = Number(pvStr)
      if (Number.isFinite(n) && n > 0) s.add(n)
    }
    const raw = cfg.planned_runs
    if (!Array.isArray(raw)) return
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const inner = (item as Record<string, unknown>).tier_promotion_versions
      const fake: Record<string, unknown> = {}
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) fake.tier_promotion_versions = inner
      const pm = parseTierPromotionMap(fake)
      for (const pvStr of Object.values(pm)) {
        const n = Number(pvStr)
        if (Number.isFinite(n) && n > 0) s.add(n)
      }
    }
  }
  for (const row of schedules) {
    addFromCfg((row.config ?? {}) as Record<string, unknown>)
  }
  return s
}

type PlannedRunPersist = {
  run_at: string
  tier_promotion_versions: Record<string, { promotion_version_id: number }>
}

type PlannedRunDraft = {
  id: string
  runAtLocal: string
  tierPv: Record<number, string>
}

function parsePlannedRunsFromConfig(cfg: Record<string, unknown>): PlannedRunDraft[] {
  const raw = cfg.planned_runs
  if (!Array.isArray(raw)) return []
  const out: PlannedRunDraft[] = []
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return
    const o = item as Record<string, unknown>
    const ra = typeof o.run_at === 'string' ? isoToDatetimeLocal(o.run_at) : ''
    const inner = o.tier_promotion_versions
    const fakeCfg: Record<string, unknown> = {}
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) fakeCfg.tier_promotion_versions = inner
    const tierPv = parseTierPromotionMap(fakeCfg)
    out.push({ id: `loaded-${i}`, runAtLocal: ra, tierPv: { ...tierPv } })
  })
  return out
}

/** Merge tier + optional planned runs into schedule config (preserves unrelated keys like legacy cadence). */
function buildPipelineScheduleConfig(
  prev: Record<string, unknown>,
  tierPv: Record<number, string>,
  plannedRuns: PlannedRunPersist[],
): Record<string, unknown> {
  const next = { ...prev }

  const mergedTiers = buildTierPromotionVersionsObject(tierPv)
  if (Object.keys(mergedTiers).length === 0) delete next.tier_promotion_versions
  else next.tier_promotion_versions = mergedTiers

  if (plannedRuns.length === 0) delete next.planned_runs
  else next.planned_runs = plannedRuns

  return next
}

function normalizeScheduleRows(rows: ScheduleRow[]): ScheduleRow[] {
  const byPipe = new Map(rows.map((r) => [r.pipeline, r]))
  return PIPELINE_IDS.map((p) => byPipe.get(p) ?? { pipeline: p, enabled: false, config: {} })
}

function tierEligibleWeekly(t: VipTierRow): boolean {
  return (t.perks ?? {}).weekly_bonus_enabled === true
}

function tierEligibleMonthly(t: VipTierRow): boolean {
  return (t.perks ?? {}).monthly_bonus_enabled === true
}

function tierEligibleForPipeline(pipeline: 'weekly_bonus' | 'monthly_bonus', t: VipTierRow): boolean {
  return pipeline === 'weekly_bonus' ? tierEligibleWeekly(t) : tierEligibleMonthly(t)
}

export default function VipDeliverySchedulesPage() {
  const { apiFetch, role } = useAdminAuth()
  const canEdit = role === 'superadmin'
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [tiers, setTiers] = useState<VipTierRow[]>([])
  const [vipPromotions, setVipPromotions] = useState<BonusHubPromotion[]>([])
  const [promoLoadOk, setPromoLoadOk] = useState(true)
  const [loading, setLoading] = useState(true)
  const [draftEnabled, setDraftEnabled] = useState<Record<string, boolean>>({})
  const [weeklyCols, setWeeklyCols] = useState<TierPvCol[]>(() =>
    Array.from({ length: WEEK_GRID_PAGE_SIZE }, () => ({})),
  )
  const [weeklyPageOffset, setWeeklyPageOffset] = useState(0)
  const [monthlyCols, setMonthlyCols] = useState<TierPvCol[]>(() =>
    Array.from({ length: MONTH_GRID_COLS }, () => ({})),
  )
  const [monthlyPageOffset, setMonthlyPageOffset] = useState(0)
  const [savingPipeline, setSavingPipeline] = useState<string | null>(null)
  /** Set when GET delivery/schedules fails so the banner can show HTTP status / API message. */
  const [scheduleLoadIssue, setScheduleLoadIssue] = useState<{
    status?: number
    detail: string
  } | null>(null)
  const [deliveryRuns, setDeliveryRuns] = useState<DeliveryRunRow[]>([])
  /** UTC `HH:mm` per weekly grid column (index aligns with `weeklyCols`). */
  const [weeklyDeliveryUtcHm, setWeeklyDeliveryUtcHm] = useState<string[]>([])
  const [monthlyDeliveryUtcHm, setMonthlyDeliveryUtcHm] = useState<string[]>([])
  /** Default UTC delivery clock for new columns; columns can override per-card. */
  const [globalDeliveryUtcHm, setGlobalDeliveryUtcHm] = useState('12:00')
  /** `YYYY-MM-DD` — UTC week containing this calendar day defines column 0 (Monday–Sunday grid). */
  const [weeklyScheduleStartDate, setWeeklyScheduleStartDate] = useState('')
  /** `YYYY-MM-DD` — year/month used; automation uses the 1st (UTC) of that month. */
  const [monthlyScheduleStartDate, setMonthlyScheduleStartDate] = useState('')
  const [weeklyDeliveryTimeOverrides, setWeeklyDeliveryTimeOverrides] = useState<Set<number>>(() => new Set())
  const [monthlyDeliveryTimeOverrides, setMonthlyDeliveryTimeOverrides] = useState<Set<number>>(() => new Set())
  /** Optional per-column UTC calendar date (`YYYY-MM-DD`); empty = grid slot. */
  const [weeklyDeliveryUtcDate, setWeeklyDeliveryUtcDate] = useState<string[]>([])
  const [monthlyDeliveryUtcDate, setMonthlyDeliveryUtcDate] = useState<string[]>([])
  /** Snapshot after load; used to detect unsaved changes in Schedule defaults. */
  const [defaultsSnapshot, setDefaultsSnapshot] = useState<{
    weekly: string
    monthly: string
    global: string
  } | null>(null)

  useEffect(() => {
    setWeeklyDeliveryUtcHm((hm) => {
      if (hm.length === weeklyCols.length) return hm
      if (hm.length > weeklyCols.length) return hm.slice(0, weeklyCols.length)
      return [...hm, ...Array.from({ length: weeklyCols.length - hm.length }, () => globalDeliveryUtcHm)]
    })
  }, [weeklyCols.length, globalDeliveryUtcHm])

  useEffect(() => {
    setMonthlyDeliveryUtcHm((hm) => {
      if (hm.length === monthlyCols.length) return hm
      if (hm.length > monthlyCols.length) return hm.slice(0, monthlyCols.length)
      return [...hm, ...Array.from({ length: monthlyCols.length - hm.length }, () => globalDeliveryUtcHm)]
    })
  }, [monthlyCols.length, globalDeliveryUtcHm])

  useEffect(() => {
    setWeeklyDeliveryUtcDate((d) => {
      if (d.length === weeklyCols.length) return d
      if (d.length > weeklyCols.length) return d.slice(0, weeklyCols.length)
      return [...d, ...Array.from({ length: weeklyCols.length - d.length }, () => '')]
    })
  }, [weeklyCols.length])

  useEffect(() => {
    setMonthlyDeliveryUtcDate((d) => {
      if (d.length === monthlyCols.length) return d
      if (d.length > monthlyCols.length) return d.slice(0, monthlyCols.length)
      return [...d, ...Array.from({ length: monthlyCols.length - d.length }, () => '')]
    })
  }, [monthlyCols.length])

  /** When default delivery time changes, fill non-overridden column pickers. */
  useEffect(() => {
    setWeeklyDeliveryUtcHm((prev) => {
      if (prev.length === 0) return prev
      return prev.map((t, i) => (weeklyDeliveryTimeOverrides.has(i) ? t : globalDeliveryUtcHm))
    })
    setMonthlyDeliveryUtcHm((prev) => {
      if (prev.length === 0) return prev
      return prev.map((t, i) => (monthlyDeliveryTimeOverrides.has(i) ? t : globalDeliveryUtcHm))
    })
  }, [globalDeliveryUtcHm, weeklyDeliveryTimeOverrides, monthlyDeliveryTimeOverrides])

  const loadNextWeekPage = useCallback(() => {
    setWeeklyPageOffset((o) => {
      const next = Math.min(o + WEEK_GRID_PAGE_SIZE, WEEK_GRID_MAX_COLS - WEEK_GRID_PAGE_SIZE)
      setWeeklyCols((prev) => {
        const required = next + WEEK_GRID_PAGE_SIZE
        if (prev.length >= required) return prev
        const add = Math.min(required - prev.length, WEEK_GRID_MAX_COLS - prev.length)
        return [...prev, ...Array.from({ length: add }, (): TierPvCol => ({}))]
      })
      return next
    })
  }, [])

  const loadPreviousWeekPage = useCallback(() => {
    setWeeklyPageOffset((o) => Math.max(0, o - WEEK_GRID_PAGE_SIZE))
  }, [])

  const loadNextMonthPage = useCallback(() => {
    setMonthlyPageOffset((o) => {
      const next = Math.min(o + MONTH_GRID_COLS, MONTH_GRID_MAX_COLS - MONTH_GRID_COLS)
      setMonthlyCols((prev) => {
        const required = next + MONTH_GRID_COLS
        if (prev.length >= required) return prev
        const add = Math.min(required - prev.length, MONTH_GRID_MAX_COLS - prev.length)
        return [...prev, ...Array.from({ length: add }, (): TierPvCol => ({}))]
      })
      return next
    })
  }, [])

  const loadPreviousMonthPage = useCallback(() => {
    setMonthlyPageOffset((o) => Math.max(0, o - MONTH_GRID_COLS))
  }, [])

  const patchMatrixCell = useCallback(
    (setter: Dispatch<SetStateAction<TierPvCol[]>>, colIdx: number, tierId: number, pvId: string, maxCols: number) => {
      setter((prev) => {
        const need = maxCols - prev.length
        const base: TierPvCol[] =
          need > 0 ? [...prev, ...Array.from({ length: need }, (): TierPvCol => ({}))] : [...prev]
        const next: TierPvCol[] = base.map((c) => ({ ...c }))
        const col: TierPvCol = { ...next[colIdx] }
        if (!pvId) delete col[tierId]
        else col[tierId] = pvId
        next[colIdx] = col
        return next
      })
    },
    [],
  )

  const updateWeeklyDeliveryUtcDate = useCallback((colIdx: number, next: string) => {
    setWeeklyDeliveryUtcDate((arr) => {
      const prev = arr[colIdx] ?? ''
      if (next === prev) return arr
      if ((next || prev) && !window.confirm(VIP_COLUMN_DATE_CONFIRM)) return arr
      const copy = [...arr]
      while (copy.length <= colIdx) copy.push('')
      copy[colIdx] = next
      return copy
    })
  }, [])

  const updateMonthlyDeliveryUtcDate = useCallback((colIdx: number, next: string) => {
    setMonthlyDeliveryUtcDate((arr) => {
      const prev = arr[colIdx] ?? ''
      if (next === prev) return arr
      if ((next || prev) && !window.confirm(VIP_COLUMN_DATE_CONFIRM)) return arr
      const copy = [...arr]
      while (copy.length <= colIdx) copy.push('')
      copy[colIdx] = next
      return copy
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sRes, tRes, pRes, runsRes] = await Promise.all([
        apiFetch('/v1/admin/vip/delivery/schedules'),
        apiFetch('/v1/admin/vip/tiers'),
        apiFetch('/v1/admin/bonushub/promotions?status=all&limit=300'),
        apiFetch('/v1/admin/vip/delivery/runs?limit=25'),
      ])

      if (runsRes.ok) {
        const rj = (await runsRes.json()) as { runs?: DeliveryRunRow[] }
        setDeliveryRuns(Array.isArray(rj.runs) ? rj.runs : [])
      } else {
        setDeliveryRuns([])
      }

      if (tRes.ok) {
        const j = (await tRes.json()) as { tiers?: VipTierRow[] }
        setTiers(Array.isArray(j.tiers) ? j.tiers : [])
      } else {
        setTiers([])
      }

      if (pRes.ok) {
        setPromoLoadOk(true)
        const j = (await pRes.json()) as { promotions?: BonusHubPromotion[] }
        const list = Array.isArray(j.promotions) ? j.promotions : []
        setVipPromotions(list.filter((p) => p.vip_only === true))
      } else {
        setPromoLoadOk(false)
        setVipPromotions([])
      }

      if (!sRes.ok) {
        setSchedules([])
        setDraftEnabled({})
        setWeeklyDeliveryUtcHm([])
        setMonthlyDeliveryUtcHm([])
        setWeeklyDeliveryUtcDate([])
        setMonthlyDeliveryUtcDate([])
        setGlobalDeliveryUtcHm('12:00')
        setWeeklyScheduleStartDate('')
        setMonthlyScheduleStartDate('')
        setWeeklyDeliveryTimeOverrides(new Set())
        setMonthlyDeliveryTimeOverrides(new Set())
        setDefaultsSnapshot(null)
        let detail = ''
        try {
          const text = await sRes.text()
          if (text) {
            try {
              const j = JSON.parse(text) as { error?: string; message?: string; code?: string }
              detail = [j.message, j.error, j.code].filter(Boolean).join(' — ')
            } catch {
              detail = text.slice(0, 280)
            }
          }
        } catch {
          detail = ''
        }
        setScheduleLoadIssue({
          status: sRes.status,
          detail: detail || 'No response body',
        })
        return
      }

      setScheduleLoadIssue(null)
      const j = (await sRes.json()) as { schedules?: ScheduleRow[] }
      const raw = Array.isArray(j.schedules) ? j.schedules : []
      const nextSchedules = normalizeScheduleRows(raw)
      setSchedules(nextSchedules)

      const en: Record<string, boolean> = {}
      for (const r of nextSchedules) {
        en[r.pipeline] = !!r.enabled
      }
      setDraftEnabled(en)

      const wRow = nextSchedules.find((r) => r.pipeline === 'weekly_bonus')
      const mRow = nextSchedules.find((r) => r.pipeline === 'monthly_bonus')
      const wCfg = (wRow?.config ?? {}) as Record<string, unknown>
      const mCfg = (mRow?.config ?? {}) as Record<string, unknown>
      const wPlanned = parsePlannedRunsFromConfig(wCfg).map((p) => ({
        runAtLocal: p.runAtLocal,
        tierPv: p.tierPv,
      }))
      const mPlanned = parsePlannedRunsFromConfig(mCfg).map((p) => ({
        runAtLocal: p.runAtLocal,
        tierPv: p.tierPv,
      }))
      const wAnchor = weeklyAnchorLocalForHydration(wRow?.next_run_at)
      const mAnchor = monthlyAnchorLocalForHydration(mRow?.next_run_at)

      const weeklyColsNeededRaw = weeklyHydrateColumnCount(wAnchor, wPlanned, WEEK_GRID_PAGE_SIZE)
      const wFirst = firstNonPastWeeklyColumnIndex(wAnchor, WEEK_GRID_MAX_COLS)
      const weeklyColsNeeded = Math.min(
        WEEK_GRID_MAX_COLS,
        Math.max(weeklyColsNeededRaw, wFirst + WEEK_GRID_PAGE_SIZE),
      )
      setWeeklyCols(hydrateWeeklyMatrix(wAnchor, parseTierPromotionMap(wCfg), wPlanned, weeklyColsNeeded))
      const wHm = hydrateWeeklyDeliveryUtcHm(wAnchor, wRow?.next_run_at, wPlanned, weeklyColsNeeded)
      setWeeklyDeliveryUtcHm(wHm)
      const maxWeekOff = Math.min(
        WEEK_GRID_MAX_COLS - WEEK_GRID_PAGE_SIZE,
        Math.max(0, weeklyColsNeeded - WEEK_GRID_PAGE_SIZE),
      )
      setWeeklyPageOffset(Math.min(wFirst, maxWeekOff))

      const monthlyColsNeededRaw = monthlyHydrateColumnCount(mAnchor, mPlanned, MONTH_GRID_COLS)
      const mFirst = firstNonPastMonthlyColumnIndex(mAnchor, MONTH_GRID_MAX_COLS)
      const monthlyColsNeeded = Math.min(
        MONTH_GRID_MAX_COLS,
        Math.max(monthlyColsNeededRaw, mFirst + MONTH_GRID_COLS),
      )
      setMonthlyCols(hydrateMonthlyMatrix(mAnchor, parseTierPromotionMap(mCfg), mPlanned, monthlyColsNeeded))
      const mHm = hydrateMonthlyDeliveryUtcHm(mAnchor, mRow?.next_run_at, mPlanned, monthlyColsNeeded)
      setMonthlyDeliveryUtcHm(mHm)
      const glob = wHm[0] ?? mHm[0] ?? '12:00'
      setGlobalDeliveryUtcHm(glob)
      const weekStartDateUi = utcWeekStartDateFromAnchorLocal(wAnchor)
      const monthStartDateUi = utcMonthStartDateFromAnchorLocal(mAnchor)
      setWeeklyScheduleStartDate(weekStartDateUi)
      setMonthlyScheduleStartDate(monthStartDateUi)
      const wDates = hydrateWeeklyColumnDeliveryDates(wAnchor, wPlanned, weeklyColsNeeded)
      const wHm0 = wHm[0] ?? glob
      const wAnchorLocalForCol0 = weeklyAnchorLocalFromWeekStartDateAndHm(weekStartDateUi, wHm0)
      wDates[0] = hydrateWeeklyColumn0NextRunUtcDateInput(wAnchorLocalForCol0, wRow?.next_run_at, wHm0)
      setWeeklyDeliveryUtcDate(wDates)
      const mDates = hydrateMonthlyColumnDeliveryDates(mAnchor, mPlanned, monthlyColsNeeded)
      const mHm0 = mHm[0] ?? glob
      const mAnchorLocalForCol0 = monthlyAnchorLocalFromMonthStartDateAndHm(monthStartDateUi, mHm0)
      mDates[0] = hydrateMonthlyColumn0NextRunUtcDateInput(mAnchorLocalForCol0, mRow?.next_run_at, mHm0)
      setMonthlyDeliveryUtcDate(mDates)
      setDefaultsSnapshot({ weekly: weekStartDateUi, monthly: monthStartDateUi, global: glob })
      const wOv = new Set<number>()
      wHm.forEach((v, i) => {
        if (v !== glob) wOv.add(i)
      })
      const mOv = new Set<number>()
      mHm.forEach((v, i) => {
        if (v !== glob) mOv.add(i)
      })
      setWeeklyDeliveryTimeOverrides(wOv)
      setMonthlyDeliveryTimeOverrides(mOv)
      const maxMonthOff = Math.max(0, monthlyColsNeeded - MONTH_GRID_COLS)
      setMonthlyPageOffset(Math.min(mFirst, maxMonthOff))
    } catch {
      toast.error('Network error loading schedules')
      setSchedules([])
      setScheduleLoadIssue({
        detail:
          'Browser could not complete the request. Is the API running? Check admin dev proxy / VITE base URL matches your core API (e.g. port 9090).',
      })
      setTiers([])
      setVipPromotions([])
      setDeliveryRuns([])
      setWeeklyDeliveryUtcHm([])
      setMonthlyDeliveryUtcHm([])
      setWeeklyDeliveryUtcDate([])
      setMonthlyDeliveryUtcDate([])
      setGlobalDeliveryUtcHm('12:00')
      setWeeklyScheduleStartDate('')
      setMonthlyScheduleStartDate('')
      setWeeklyDeliveryTimeOverrides(new Set())
      setMonthlyDeliveryTimeOverrides(new Set())
      setDefaultsSnapshot(null)
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const sortedTiers = [...tiers].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
  const publishedVipOffers = vipPromotions.filter((p) => p.has_published_version && typeof p.latest_version_id === 'number')

  const referencedPvIds = useMemo(() => collectReferencedPromotionVersionIds(schedules), [schedules])

  const vipAwaitingScheduling = publishedVipOffers.filter((p) => !referencedPvIds.has(Number(p.latest_version_id)))
  const vipAssignedInPipeline = publishedVipOffers.filter((p) => referencedPvIds.has(Number(p.latest_version_id)))

  const draftVipOnly = vipPromotions.filter((p) => !p.has_published_version)

  const trackerScheduleRows = schedules as unknown as TrackerScheduleRow[]

  const assignedScheduleHints = useMemo(() => {
    return vipAssignedInPipeline.map((p) => ({
      promo: p,
      hints: collectScheduleHintsForPv(Number(p.latest_version_id), trackerScheduleRows),
    }))
  }, [vipAssignedInPipeline, schedules])

  const upcomingWithDates = useMemo(
    () =>
      assignedScheduleHints
        .filter((x) => x.hints.length > 0)
        .sort((a, b) => a.hints[0].at.getTime() - b.hints[0].at.getTime()),
    [assignedScheduleHints],
  )

  const assignedWithoutUpcomingDate = useMemo(
    () => assignedScheduleHints.filter((x) => x.hints.length === 0).map((x) => x.promo),
    [assignedScheduleHints],
  )

  const weeklyRow = schedules.find((r) => r.pipeline === 'weekly_bonus')
  const monthlyRow = schedules.find((r) => r.pipeline === 'monthly_bonus')

  const weeklyAnchorForUi = useMemo(() => {
    if (!weeklyScheduleStartDate.trim()) {
      return weeklyAnchorLocalForHydration(weeklyRow?.next_run_at)
    }
    const hm0 = weeklyDeliveryTimeOverrides.has(0)
      ? (weeklyDeliveryUtcHm[0] ?? globalDeliveryUtcHm)
      : globalDeliveryUtcHm
    return weeklyAnchorLocalFromWeekStartDateAndHm(weeklyScheduleStartDate, hm0)
  }, [
    weeklyScheduleStartDate,
    weeklyRow?.next_run_at,
    weeklyDeliveryUtcHm,
    globalDeliveryUtcHm,
    weeklyDeliveryTimeOverrides,
  ])

  const monthlyAnchorForUi = useMemo(() => {
    if (!monthlyScheduleStartDate.trim()) {
      return monthlyAnchorLocalForHydration(monthlyRow?.next_run_at)
    }
    const hm0 = monthlyDeliveryTimeOverrides.has(0)
      ? (monthlyDeliveryUtcHm[0] ?? globalDeliveryUtcHm)
      : globalDeliveryUtcHm
    return monthlyAnchorLocalFromMonthStartDateAndHm(monthlyScheduleStartDate, hm0)
  }, [
    monthlyScheduleStartDate,
    monthlyRow?.next_run_at,
    monthlyDeliveryUtcHm,
    globalDeliveryUtcHm,
    monthlyDeliveryTimeOverrides,
  ])

  const defaultsDirty = useMemo(() => {
    if (!defaultsSnapshot) return false
    return (
      weeklyScheduleStartDate !== defaultsSnapshot.weekly ||
      monthlyScheduleStartDate !== defaultsSnapshot.monthly ||
      globalDeliveryUtcHm !== defaultsSnapshot.global
    )
  }, [defaultsSnapshot, weeklyScheduleStartDate, monthlyScheduleStartDate, globalDeliveryUtcHm])

  function fmtRunUtc(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return `${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`
  }

  function trackerScheduledCard(p: BonusHubPromotion, hints: ScheduleHint[]) {
    const first = hints[0]
    const more = hints.length > 1 ? hints.length - 1 : 0
    const paused = !!first.deliveryPaused
    return (
      <div key={`sched-${p.id}`} className="col-md-6 col-xl-4">
        <div className="card h-100 border-secondary-subtle border-success border-opacity-25">
          <div className="card-body py-2">
            <div className="d-flex justify-content-between align-items-start gap-2">
              <div className="fw-semibold small">{p.name}</div>
              <span
                className={`badge shrink-0 ${paused ? 'text-bg-secondary' : 'text-bg-success'}`}
                title={paused ? 'Automation is off for this pipeline until you turn it back on.' : undefined}
              >
                {paused ? 'In pipeline · paused' : 'In pipeline'}
              </span>
            </div>
            <div className="small text-secondary font-monospace">{p.slug}</div>
            <div className="small mt-2">
              <span className="text-secondary">Expected delivery </span>
              <strong className="text-body">{formatScheduleDayUtc(first.at)}</strong>
              <span className="text-secondary"> UTC</span>
              <span className="text-secondary">
                {' · '}
                {first.label}
                {first.source === 'planned' ? ' · Planned run' : ' · Recurring'}
                {more > 0 ? ` · +${more} more` : ''}
              </span>
            </div>
            {p.latest_version_id != null ? (
              <div className="small mt-1 text-secondary">
                pv <strong>{p.latest_version_id}</strong>
              </div>
            ) : null}
            <Link to={`/bonushub/promotions/${p.id}`} className="small mt-1 d-inline-block">
              Bonus Hub →
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const promoCardSmall = (
    p: BonusHubPromotion,
    badge: 'awaiting' | 'assigned' | 'draft',
    pipelineHint?: ScheduleHint | null,
  ) => (
    <div key={`${badge}-${p.id}`} className="col-md-6 col-xl-4">
      <div
        className={`card h-100 border-secondary-subtle ${
          badge === 'awaiting' ? 'border-warning border-opacity-50' : ''
        }`}
      >
        <div className="card-body py-2">
          <div className="d-flex justify-content-between align-items-start gap-2">
            <div className="fw-semibold small">{p.name}</div>
            {badge === 'awaiting' ? (
              <span className="badge text-bg-warning text-dark shrink-0">Unassigned</span>
            ) : null}
            {badge === 'assigned' ? (
              <span
                className={`badge shrink-0 ${pipelineHint?.deliveryPaused ? 'text-bg-secondary' : 'text-bg-info'}`}
              >
                {pipelineHint?.deliveryPaused ? 'In pipeline · paused' : 'In pipeline'}
              </span>
            ) : null}
            {badge === 'draft' ? (
              <span className="badge text-bg-secondary shrink-0">Draft</span>
            ) : null}
          </div>
          <div className="small text-secondary font-monospace">{p.slug}</div>
          {p.latest_version_id != null ? (
            <div className="small mt-1 text-secondary">
              pv <strong>{p.latest_version_id}</strong>
              {!p.has_published_version ? <span className="ms-1">— publish to schedule</span> : null}
            </div>
          ) : (
            <div className="small mt-1 text-secondary">No version yet</div>
          )}
          {badge === 'assigned' ? (
            pipelineHint ? (
              <div className="small mt-2 text-secondary">
                Expected delivery <strong className="text-body">{formatScheduleDayUtc(pipelineHint.at)}</strong> UTC
                {' · '}
                {pipelineHint.label}
              </div>
            ) : (
              <div className="small mt-2 text-secondary">
                Expected delivery not projected yet — add a planned run or save <strong className="text-body">next run</strong> on the
                schedule.
              </div>
            )
          ) : null}
          <Link to={`/bonushub/promotions/${p.id}`} className="small mt-1 d-inline-block">
            Bonus Hub →
          </Link>
        </div>
      </div>
    </div>
  )

  const persistPipelineImpl = async (pipeline: string): Promise<boolean> => {
    const row = schedules.find((r) => r.pipeline === pipeline)
    const prevCfg = (row?.config ?? {}) as Record<string, unknown>
    const anchorLocal =
      pipeline === 'weekly_bonus'
        ? weeklyScheduleStartDate.trim() !== ''
          ? weeklyAnchorLocalFromWeekStartDateAndHm(
              weeklyScheduleStartDate,
              weeklyDeliveryUtcHm[0] ?? globalDeliveryUtcHm,
            )
          : weeklyAnchorLocalForHydration(row?.next_run_at)
        : monthlyScheduleStartDate.trim() !== ''
          ? monthlyAnchorLocalFromMonthStartDateAndHm(
              monthlyScheduleStartDate,
              monthlyDeliveryUtcHm[0] ?? globalDeliveryUtcHm,
            )
          : monthlyAnchorLocalForHydration(row?.next_run_at)
    const columnUtcHm = (k: number) =>
      pipeline === 'weekly_bonus' ? weeklyDeliveryUtcHm[k] : monthlyDeliveryUtcHm[k]
    const columnDateUtc = (k: number) =>
      pipeline === 'weekly_bonus' ? weeklyDeliveryUtcDate[k] : monthlyDeliveryUtcDate[k]
    const { tierPv, planned } =
      pipeline === 'weekly_bonus'
        ? weeklyMatrixToPersist(weeklyCols, anchorLocal, columnUtcHm, columnDateUtc)
        : monthlyMatrixToPersist(monthlyCols, anchorLocal, columnUtcHm, columnDateUtc)
    const mergedCfg = buildPipelineScheduleConfig(prevCfg, tierPv, planned)

    const enabled = !!draftEnabled[pipeline]

    let nextRunIsoForDup: string | null = null
    if (enabled) {
      if (pipeline === 'weekly_bonus') {
        const hm0 = weeklyDeliveryUtcHm[0] ?? globalDeliveryUtcHm
        const d0 = weeklyDeliveryUtcDate[0]?.trim()
        if (d0 && /^\d{4}-\d{2}-\d{2}$/.test(d0)) {
          nextRunIsoForDup = isoFromUtcDateAndHm(d0, hm0)
        } else {
          nextRunIsoForDup = buildWeeklyNextRunIsoFromAnchorLocal(anchorLocal, hm0)
        }
      } else {
        const hm0 = monthlyDeliveryUtcHm[0] ?? globalDeliveryUtcHm
        const d0 = monthlyDeliveryUtcDate[0]?.trim()
        if (d0 && /^\d{4}-\d{2}-\d{2}$/.test(d0)) {
          nextRunIsoForDup = isoFromUtcDateAndHm(d0, hm0)
        } else {
          nextRunIsoForDup = buildMonthlyNextRunIsoFromAnchorLocal(anchorLocal, hm0)
        }
      }
    }

    const dupMsg = duplicatePromotionAtSameInstantMessage(planned, tierPv, enabled ? nextRunIsoForDup : null)
    if (dupMsg) {
      toast.error(dupMsg)
      return false
    }

    try {
      const payload: Record<string, unknown> = { enabled, config: mergedCfg }
      if (enabled && nextRunIsoForDup) payload.next_run_at = nextRunIsoForDup

      const res = await apiFetch(`/v1/admin/vip/delivery/schedules/${encodeURIComponent(pipeline)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        let msg = `Save failed (${res.status})`
        try {
          const j = (await res.json()) as { error?: { code?: string; message?: string } }
          const detail = typeof j?.error?.message === 'string' ? j.error.message.trim() : ''
          if (detail) msg = detail
        } catch {
          /* keep generic */
        }
        toast.error(msg)
        return false
      }
      return true
    } catch {
      toast.error('Network error')
      return false
    }
  }

  const savePipeline = async (pipeline: string) => {
    if (!canEdit) return
    if (!window.confirm(VIP_PIPELINE_SAVE_CONFIRM)) return
    setSavingPipeline(pipeline)
    try {
      const ok = await persistPipelineImpl(pipeline)
      if (!ok) return
      toast.success(`${PIPELINE_LABEL[pipeline] ?? pipeline} saved`)
      await load()
    } finally {
      setSavingPipeline(null)
    }
  }

  const saveScheduleDefaults = async () => {
    if (!canEdit || !defaultsSnapshot || !defaultsDirty) return
    if (!window.confirm(VIP_SCHEDULE_DEFAULTS_SAVE_CONFIRM)) return
    setSavingPipeline('__defaults__')
    try {
      if (!(await persistPipelineImpl('weekly_bonus'))) return
      if (!(await persistPipelineImpl('monthly_bonus'))) return
      setDefaultsSnapshot({
        weekly: weeklyScheduleStartDate,
        monthly: monthlyScheduleStartDate,
        global: globalDeliveryUtcHm,
      })
      toast.success('Schedule defaults saved')
      await load()
    } finally {
      setSavingPipeline(null)
    }
  }

  const renderPipelinePanel = (pipeline: 'weekly_bonus' | 'monthly_bonus') => {
    const row = schedules.find((r) => r.pipeline === pipeline)
    const label = PIPELINE_LABEL[pipeline]
    const tiersForPipeline = sortedTiers.filter((t) => tierEligibleForPipeline(pipeline, t))
    const eligibleNames = tiersForPipeline.map((t) => t.name).join(', ')
    const cols = pipeline === 'weekly_bonus' ? weeklyCols : monthlyCols
    const setter = pipeline === 'weekly_bonus' ? setWeeklyCols : setMonthlyCols
    const maxCols = pipeline === 'weekly_bonus' ? WEEK_GRID_MAX_COLS : MONTH_GRID_MAX_COLS
    const anchorLocalForUi = pipeline === 'weekly_bonus' ? weeklyAnchorForUi : monthlyAnchorForUi

    return (
      <div key={pipeline} className="card border-secondary-subtle mb-3 h-100">
        <div className="card-header py-2">
          <span className="fw-semibold">{label}</span>
        </div>
        <div className="card-body">
          <div className="d-flex align-items-center flex-wrap gap-2 gap-md-3 mb-2">
            <div className="form-check form-switch mb-0">
              <input
                className="form-check-input"
                type="checkbox"
                role="switch"
                id={`vip-delivery-automation-${pipeline}`}
                checked={!!draftEnabled[pipeline]}
                disabled={!canEdit || !row}
                onChange={(e) => {
                  const nextChecked = e.target.checked
                  if (!nextChecked && draftEnabled[pipeline]) {
                    if (!confirmTurnOffAutomation(label)) return
                  }
                  setDraftEnabled((prev) => ({ ...prev, [pipeline]: nextChecked }))
                }}
              />
              <label className="form-check-label small" htmlFor={`vip-delivery-automation-${pipeline}`}>
                Automation
              </label>
            </div>
            <span className="small text-secondary">UTC schedule</span>
          </div>

          <p className="small text-secondary mb-2">
            {tiersForPipeline.length === 0 ? (
              <>
                Enable <strong>{pipeline === 'weekly_bonus' ? 'weekly' : 'monthly'}</strong> for tiers on{' '}
                <Link to="/engagement/vip">VIP Program</Link>.
              </>
            ) : (
              <>
                <strong>{eligibleNames}</strong>
                {' · '}
                <Link to="/bonushub">VIP-only offers</Link>
              </>
            )}
          </p>

          {tiersForPipeline.length > 0 ? (
            <>
              <p className="small text-secondary mb-2 mb-sm-3">
                Empty <strong>Date override</strong> uses each card&apos;s grid slot. All times UTC.
              </p>
              <VipDeliveryPeriodMatrix
                variant={pipeline === 'weekly_bonus' ? 'weekly' : 'monthly'}
                cols={cols}
                anchorLocal={anchorLocalForUi}
                deliveryUtcHm={pipeline === 'weekly_bonus' ? weeklyDeliveryUtcHm : monthlyDeliveryUtcHm}
                onDeliveryUtcHmChange={(colIdx, hhmm) => {
                  if (pipeline === 'weekly_bonus') {
                    setWeeklyDeliveryUtcHm((prev) => {
                      const next = [...prev]
                      while (next.length <= colIdx) next.push(globalDeliveryUtcHm)
                      next[colIdx] = hhmm
                      return next
                    })
                    setWeeklyDeliveryTimeOverrides((prev) => {
                      const n = new Set(prev)
                      if (hhmm === globalDeliveryUtcHm) n.delete(colIdx)
                      else n.add(colIdx)
                      return n
                    })
                  } else {
                    setMonthlyDeliveryUtcHm((prev) => {
                      const next = [...prev]
                      while (next.length <= colIdx) next.push(globalDeliveryUtcHm)
                      next[colIdx] = hhmm
                      return next
                    })
                    setMonthlyDeliveryTimeOverrides((prev) => {
                      const n = new Set(prev)
                      if (hhmm === globalDeliveryUtcHm) n.delete(colIdx)
                      else n.add(colIdx)
                      return n
                    })
                  }
                }}
                deliveryUtcDate={pipeline === 'weekly_bonus' ? weeklyDeliveryUtcDate : monthlyDeliveryUtcDate}
                onDeliveryUtcDateChange={
                  pipeline === 'weekly_bonus' ? updateWeeklyDeliveryUtcDate : updateMonthlyDeliveryUtcDate
                }
                tiers={tiersForPipeline.map((t) => ({
                  id: t.id,
                  name: t.name,
                  imageUrl: vipTierCharacterImageUrl(t.perks as Record<string, unknown>),
                }))}
                promotions={publishedVipOffers}
                disabled={!canEdit || !row}
                onCellChange={(colIdx, tierId, pvId) => patchMatrixCell(setter, colIdx, tierId, pvId, maxCols)}
                {...(pipeline === 'weekly_bonus'
                  ? {
                      weekPageOffset: weeklyPageOffset,
                      onLoadMoreWeeks: loadNextWeekPage,
                      onLoadPreviousWeeks: loadPreviousWeekPage,
                      canLoadMoreWeeks: weeklyPageOffset < WEEK_GRID_MAX_COLS - WEEK_GRID_PAGE_SIZE,
                      canLoadPreviousWeeks: weeklyPageOffset > 0,
                    }
                  : {
                      monthPageOffset: monthlyPageOffset,
                      onLoadMoreMonths: loadNextMonthPage,
                      onLoadPreviousMonths: loadPreviousMonthPage,
                      canLoadMoreMonths: monthlyPageOffset < MONTH_GRID_MAX_COLS - MONTH_GRID_COLS,
                      canLoadPreviousMonths: monthlyPageOffset > 0,
                    })}
              />
            </>
          ) : null}

          <div className="mt-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="small text-secondary">Updated {row?.updated_at ?? '—'}</span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={
                !canEdit ||
                savingPipeline === pipeline ||
                savingPipeline === '__defaults__' ||
                schedules.length === 0
              }
              onClick={() => void savePipeline(pipeline)}
            >
              {savingPipeline === pipeline ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageMeta
        title="VIP — Tier bonus scheduling"
        description="Automate VIP-only bonus grants by tier: weekly and monthly schedules."
      />
      <PageBreadcrumb
        pageTitle="Tier bonus scheduling"
        trail={[{ label: 'Engagement' }, { label: 'VIP', to: '/engagement/vip' }]}
      />

      {!canEdit ? <p className="text-warning small mb-2">Superadmin required to edit.</p> : null}

      {loading ? (
        <p className="text-secondary small">Loading…</p>
      ) : null}

      {!loading ? (
        <div className="card border-secondary-subtle mb-4">
          <div className="card-header py-2 d-flex flex-wrap justify-content-between align-items-center gap-2">
            <span className="small fw-semibold">Overview</span>
            <Link className="small text-secondary" to="/engagement/vip/delivery">
              Delivery log →
            </Link>
          </div>
          <div className="card-body py-3">
            {schedules.length === 0 ? (
              <div className="alert alert-warning small py-2 mb-3" role="status">
                Schedules unavailable—upcoming dates may be incomplete.
              </div>
            ) : null}
            {!promoLoadOk ? (
              <p className="text-danger small mb-0">Could not load promotions (check permissions).</p>
            ) : vipPromotions.length === 0 ? (
              <p className="text-secondary small mb-0">
                No VIP-only promotions. <Link to="/bonushub">Create one</Link>.
              </p>
            ) : (
              <>
                {upcomingWithDates.length > 0 ? (
                  <>
                    <h3 className="small fw-semibold text-success-emphasis mb-2">Next deliveries (UTC)</h3>
                    <div className="row g-2 mb-3">
                      {upcomingWithDates.map(({ promo, hints }) => trackerScheduledCard(promo, hints))}
                    </div>
                  </>
                ) : null}

                {deliveryRuns.length > 0 ? (
                  <>
                    <h3 className="small fw-semibold mb-2">Recent delivery runs</h3>
                    <div className="table-responsive mb-3">
                      <table className="table table-sm table-striped mb-0 align-middle">
                        <thead>
                          <tr className="small text-secondary">
                            <th>Started (UTC)</th>
                            <th>Pipeline</th>
                            <th>Status</th>
                            <th>Window</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deliveryRuns.slice(0, 12).map((r) => (
                            <tr key={r.id}>
                              <td className="small text-nowrap">{fmtRunUtc(r.started_at)}</td>
                              <td className="small font-monospace">{r.pipeline}</td>
                              <td className="small">{r.status}</td>
                              <td className="small">
                                {fmtRunUtc(r.window_start)} → {fmtRunUtc(r.window_end)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}

                {assignedWithoutUpcomingDate.length > 0 ? (
                  <>
                    <h3 className="small fw-semibold mb-2">In pipeline</h3>
                    <div className="row g-2 mb-3">{assignedWithoutUpcomingDate.map((p) => promoCardSmall(p, 'assigned'))}</div>
                  </>
                ) : null}

                <h3 className="small fw-semibold text-warning-emphasis mb-2">Unassigned</h3>
                {vipAwaitingScheduling.length === 0 ? (
                  <p className="small text-secondary mb-3">All published VIP-only offers are on a schedule.</p>
                ) : (
                  <div className="row g-2 mb-3">{vipAwaitingScheduling.map((p) => promoCardSmall(p, 'awaiting'))}</div>
                )}

                {draftVipOnly.length > 0 ? (
                  <>
                    <h3 className="small fw-semibold mb-2">Drafts</h3>
                    <div className="row g-2">{draftVipOnly.map((p) => promoCardSmall(p, 'draft'))}</div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {!loading && schedules.length === 0 ? (
        <div className="alert alert-warning" role="alert">
          <div className="fw-semibold mb-1">Can’t load schedules</div>
          <p className="small font-monospace text-break mb-0">
            HTTP {scheduleLoadIssue?.status ?? '—'}
            {scheduleLoadIssue?.detail ? ` — ${scheduleLoadIssue.detail}` : null}
          </p>
          <details className="small mt-2 mb-0">
            <summary className="text-secondary" style={{ cursor: 'pointer' }}>
              Troubleshooting
            </summary>
            <ul className="mb-0 mt-2 ps-3 text-secondary">
              <li>401/403: sign in; editing needs superadmin.</li>
              <li>404: rebuild/restart core API; dev proxy port should match API (e.g. 9090).</li>
              <li>5xx: check Postgres, <code>DATABASE_URL</code>, API logs, migration <code>00042_vip_delivery_engine.sql</code>.</li>
            </ul>
          </details>
        </div>
      ) : null}

      {!loading && schedules.length > 0 ? (
        <>
          <h2 className="h6 fw-semibold text-secondary mb-2">Weekly & monthly</h2>
          <div className="row g-3 mb-4">
            <div className="col-12">{renderPipelinePanel('weekly_bonus')}</div>
            <div className="col-12">{renderPipelinePanel('monthly_bonus')}</div>
          </div>

          <details className="mb-4 card border-secondary-subtle">
            <summary className="card-header py-2 small fw-semibold" style={{ cursor: 'pointer' }}>
              Schedule defaults (UTC)
            </summary>
            <div className="card-body py-3">
              <div className="row g-3 align-items-end">
                <div className="col-md-4">
                  <label className="form-label small mb-1" htmlFor="vip-sched-global-utc">
                    Default delivery time (UTC)
                  </label>
                  <input
                    id="vip-sched-global-utc"
                    type="time"
                    step={60}
                    className="form-control form-control-sm vip-native-datetime-input"
                    disabled={!canEdit || schedules.length === 0}
                    value={globalDeliveryUtcHm}
                    onChange={(e) => setGlobalDeliveryUtcHm(e.target.value)}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label small mb-1" htmlFor="vip-sched-week-start">
                    Weekly grid starts
                  </label>
                  <input
                    id="vip-sched-week-start"
                    type="date"
                    className="form-control form-control-sm vip-native-datetime-input"
                    disabled={!canEdit || schedules.length === 0}
                    value={weeklyScheduleStartDate}
                    onChange={(e) => setWeeklyScheduleStartDate(e.target.value)}
                  />
                  <div className="small text-secondary mt-1">Any day in that ISO week (UTC).</div>
                </div>
                <div className="col-md-4">
                  <label className="form-label small mb-1" htmlFor="vip-sched-month-start">
                    Monthly grid starts
                  </label>
                  <input
                    id="vip-sched-month-start"
                    type="date"
                    className="form-control form-control-sm vip-native-datetime-input"
                    disabled={!canEdit || schedules.length === 0}
                    value={monthlyScheduleStartDate}
                    onChange={(e) => setMonthlyScheduleStartDate(e.target.value)}
                  />
                  <div className="small text-secondary mt-1">Month + year; grid uses 1st (UTC).</div>
                </div>
              </div>
              <p className="small text-secondary mb-0 mt-3">Cards inherit this default UTC time unless a card overrides it.</p>
              <div className="mt-3 d-flex flex-wrap gap-2 align-items-center">
                <button
                  type="button"
                  className="btn btn-warning btn-sm"
                  disabled={
                    !canEdit ||
                    schedules.length === 0 ||
                    !defaultsDirty ||
                    !defaultsSnapshot ||
                    savingPipeline != null
                  }
                  onClick={() => void saveScheduleDefaults()}
                >
                  {savingPipeline === '__defaults__' ? 'Saving…' : 'Save schedule defaults'}
                </button>
                <span className="small text-secondary">Applies grid anchors + default time to both pipelines.</span>
              </div>
            </div>
          </details>

          <details className="mb-4 card border-secondary-subtle">
            <summary className="card-header py-2 small text-secondary" style={{ cursor: 'pointer' }}>
              DB shape (<code>vip_delivery_schedules</code>)
            </summary>
            <div className="card-body py-2 small font-monospace text-secondary">
              <code className="user-select-all d-block">
                config: tier_promotion_versions, planned_runs[] &#123; run_at, tier_promotion_versions &#125;
              </code>
            </div>
          </details>
        </>
      ) : null}
    </div>
  )
}
