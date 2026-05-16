import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { readApiError, formatApiError } from '../api/errors'
import { useAdminAuth } from '../authContext'
import { StatCard } from '../components/dashboard'
import ComponentCard from '../components/common/ComponentCard'
import PageBreadcrumb from '../components/common/PageBreadCrumb'
import PageMeta from '../components/common/PageMeta'
import BonusWizardFlow from '../components/bonus/BonusWizardFlow'
import BonusOperationsTools, { parseBonusOpsTab } from '../components/bonus/BonusOperationsTools'
import { useBonusStats } from '../hooks/useDashboard'
import { formatCompact, formatCurrency, formatPct } from '../lib/format'
import {
  isLiveForPlayerHub,
  playerHubOperationalState,
  playerHubVisibilityBadge,
  type PlayerHubPromotionFlags,
} from '../lib/bonusHubPlayerHubBadge'

type PromotionRow = {
  id: number
  name: string
  slug: string
  status: string
  created_at: string
  latest_version: number
  grants_paused?: boolean
  bonus_type?: string
  latest_version_id?: number
  latest_version_published?: boolean
  has_published_version?: boolean
  player_hub_force_visible?: boolean
  admin_color?: string
  vip_only?: boolean
  latest_published_valid_from?: string
  latest_published_valid_to?: string
}

type ConfirmModal =
  | null
  | {
      promo: PromotionRow
      mode: 'on' | 'off'
    }

type CalEvent = {
  promotion_version_id: number
  promotion_id: number
  name: string
  valid_from: string | null
  valid_to: string | null
  published_at: string | null
  admin_color?: string
  bonus_type?: string
}

type BonusTypeTone = {
  label: string
  dotClass: string
  itemClass: string
}

const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const UTC_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const DEFAULT_PROMO_COLOR = '#3B82F6'

const BONUS_TYPE_TONES: Record<string, BonusTypeTone> = {
  deposit_match: { label: 'Deposit match', dotClass: 'bg-primary', itemClass: 'text-bg-primary' },
  cashback: { label: 'Cashback', dotClass: 'bg-success', itemClass: 'text-bg-success' },
  free_spins: { label: 'Free spins', dotClass: 'bg-warning', itemClass: 'text-bg-warning' },
  free_spins_only: { label: 'Free spins', dotClass: 'bg-warning', itemClass: 'text-bg-warning' },
  wager_race: { label: 'Wager race', dotClass: 'bg-danger', itemClass: 'text-bg-danger' },
  vip: { label: 'VIP', dotClass: 'bg-info', itemClass: 'text-bg-info' },
  referral: { label: 'Referral', dotClass: 'bg-secondary', itemClass: 'text-bg-secondary' },
}

function normalizeBonusType(v: string | null | undefined): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

function toneForBonusType(v: string | null | undefined): BonusTypeTone {
  const key = normalizeBonusType(v)
  if (key && BONUS_TYPE_TONES[key]) return BONUS_TYPE_TONES[key]
  return { label: v?.trim() || 'Other', dotClass: 'bg-dark', itemClass: 'text-bg-dark' }
}

function isDemoCalendarEventName(name: string | null | undefined): boolean {
  const n = String(name ?? '').trim().toLowerCase()
  return n.startsWith('demo:')
}

function isHexColor(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v.trim())
}

function resolveEventColorHex(ev: CalEvent, promotionColor?: string): string | null {
  if (isHexColor(promotionColor)) return promotionColor.trim().toUpperCase()
  if (isHexColor(ev.admin_color)) return ev.admin_color.trim().toUpperCase()
  return null
}

function monthBounds(year: number, monthIndex0: number): { from: string; to: string } {
  const from = new Date(year, monthIndex0, 1, 0, 0, 0, 0)
  const to = new Date(year, monthIndex0 + 1, 0, 23, 59, 59, 999)
  return { from: from.toISOString(), to: to.toISOString() }
}

function monthAnchor(year: number, monthIndex0: number) {
  return new Date(year, monthIndex0, 1, 12, 0, 0, 0)
}

function buildMonthGridCells(year: number, monthIndex0: number): ({ kind: 'pad' } | { kind: 'day'; day: number })[] {
  const firstDow = new Date(year, monthIndex0, 1).getDay()
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate()
  const cells: ({ kind: 'pad' } | { kind: 'day'; day: number })[] = []
  for (let i = 0; i < firstDow; i++) cells.push({ kind: 'pad' })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ kind: 'day', day: d })
  while (cells.length % 7 !== 0) cells.push({ kind: 'pad' })
  return cells
}

function chunk7<T>(items: T[]): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += 7) rows.push(items.slice(i, i + 7))
  return rows
}



function calendarEventsForDay(events: CalEvent[], y: number, m: number, day: number): CalEvent[] {
  const dayStart = new Date(y, m, day, 0, 0, 0, 0).getTime()
  const dayEnd = new Date(y, m, day, 23, 59, 59, 999).getTime()
  return events.filter((ev) => {
    const ws =
      ev.valid_from != null && String(ev.valid_from).trim() !== ''
        ? new Date(ev.valid_from).getTime()
        : Number.NEGATIVE_INFINITY
    const we =
      ev.valid_to != null && String(ev.valid_to).trim() !== ''
        ? new Date(ev.valid_to).getTime()
        : Number.POSITIVE_INFINITY
    return ws <= dayEnd && we >= dayStart
  })
}

function clipEventToMonth(ev: CalEvent, y: number, m: number): { startDay: number; endDay: number } | null {
  const monthStart = new Date(y, m, 1, 0, 0, 0, 0).getTime()
  const monthEnd = new Date(y, m + 1, 0, 23, 59, 59, 999).getTime()
  const startRaw =
    ev.valid_from != null && String(ev.valid_from).trim() !== ''
      ? new Date(ev.valid_from).getTime()
      : Number.NEGATIVE_INFINITY
  const endRaw =
    ev.valid_to != null && String(ev.valid_to).trim() !== ''
      ? new Date(ev.valid_to).getTime()
      : Number.POSITIVE_INFINITY
  if (startRaw > monthEnd || endRaw < monthStart) return null
  const clippedStart = Math.max(startRaw, monthStart)
  const clippedEnd = Math.min(endRaw, monthEnd)
  const sd = new Date(clippedStart).getDate()
  const ed = new Date(clippedEnd).getDate()
  return { startDay: sd, endDay: ed }
}

function rowHubFlags(p: PromotionRow): PlayerHubPromotionFlags {
  return {
    status: p.status,
    has_published_version: !!p.has_published_version,
    grants_paused: p.grants_paused === true,
    player_hub_force_visible: p.player_hub_force_visible === true,
    latest_published_valid_from: p.latest_published_valid_from ?? null,
  }
}

function recordStatusBadgeClass(status: string): string {
  if (status === 'archived') return 'text-bg-secondary'
  if (status === 'live') return 'text-bg-success'
  if (status === 'scheduled') return 'text-bg-info text-dark'
  if (status === 'paused') return 'text-bg-warning text-dark'
  return 'text-bg-warning text-dark'
}

function recordStatusLabel(row: PromotionRow): 'live' | 'scheduled' | 'paused' | 'draft' | 'archived' {
  return playerHubOperationalState(rowHubFlags(row))
}

function staffCanPlayerHubToggle(r: string | null): boolean {
  return r === 'superadmin' || r === 'admin' || r === 'support'
}

export default function BonusesCatalogPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const bonusOpsInitialTab = useMemo(() => parseBonusOpsTab(searchParams.get('tab')), [searchParams])
  const { apiFetch, role } = useAdminAuth()
  const isSuper = role === 'superadmin'
  const canPlayerHubToggle = staffCanPlayerHubToggle(role)
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'archived' | 'live'>('all')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [rows, setRows] = useState<PromotionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [colorBusyId, setColorBusyId] = useState<number | null>(null)
  const [colorDraftById, setColorDraftById] = useState<Record<number, string>>({})
  const [confirmModal, setConfirmModal] = useState<ConfirmModal>(null)

  const { data: bonusStats } = useBonusStats()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [operationsExpanded, setOperationsExpanded] = useState(false)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const now = new Date()
  const [cursor, setCursor] = useState(() => monthAnchor(now.getFullYear(), now.getMonth()))
  const [calendarEvents, setCalendarEvents] = useState<CalEvent[]>([])
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarErr, setCalendarErr] = useState<string | null>(null)

  useEffect(() => {
    const raw = searchParams.get('tab')
    if (raw && parseBonusOpsTab(raw) !== 'instances') {
      setOperationsExpanded(true)
    }
  }, [searchParams])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', '100')
      if (statusFilter === 'draft' || statusFilter === 'archived') params.set('status', statusFilter)
      if (debouncedQ) params.set('q', debouncedQ)
      const res = await apiFetch(`/v1/admin/bonushub/promotions?${params.toString()}`)
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Load failed (${res.status})`))
        setRows([])
        return
      }
      const j = (await res.json()) as { promotions?: PromotionRow[] }
      const raw = Array.isArray(j.promotions) ? j.promotions : []
      if (statusFilter === 'live') {
        setRows(raw.filter((p) => isLiveForPlayerHub(rowHubFlags(p))))
        return
      }
      setRows(raw)
    } catch {
      setErr('Network error')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [apiFetch, statusFilter, debouncedQ])

  useEffect(() => {
    void load()
  }, [load])

  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const { from, to } = useMemo(() => monthBounds(y, m), [y, m])
  const gridCells = useMemo(() => buildMonthGridCells(y, m), [y, m])
  const gridRows = useMemo(() => chunk7(gridCells), [gridCells])

  const loadCalendar = useCallback(async () => {
    setCalendarErr(null)
    setCalendarLoading(true)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await apiFetch(`/v1/admin/bonushub/promotions/calendar?${params.toString()}`)
      if (!res.ok) {
        const e = await readApiError(res)
        setCalendarErr(formatApiError(e, `Calendar load failed (${res.status})`))
        setCalendarEvents([])
        return
      }
      const j = (await res.json()) as { events?: CalEvent[] }
      const raw = Array.isArray(j.events) ? j.events : []
      setCalendarEvents(raw.filter((ev) => !isDemoCalendarEventName(ev.name)))
    } catch {
      setCalendarErr('Network error')
      setCalendarEvents([])
    } finally {
      setCalendarLoading(false)
    }
  }, [apiFetch, from, to])

  useEffect(() => {
    void loadCalendar()
  }, [loadCalendar])

  useEffect(() => {
    if (!wizardOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [wizardOpen])

  const setArchived = async (id: number, archived: boolean) => {
    if (!isSuper) return
    setBusyId(id)
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: archived ? 'archived' : 'draft' }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Update failed (${res.status})`))
        return
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusyId(null)
    }
  }

  const setPromotionColor = async (id: number, color: string) => {
    const normalized = color.trim().toUpperCase()
    if (!isHexColor(normalized)) return
    setColorBusyId(id)
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_color: normalized }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `Color update failed (${res.status})`))
        return
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, admin_color: normalized } : r)))
      setCalendarEvents((prev) => prev.map((ev) => (ev.promotion_id === id ? { ...ev, admin_color: normalized } : ev)))
    } catch {
      setErr('Network error')
    } finally {
      setColorBusyId(null)
    }
  }

  const setVipOnly = async (id: number, next: boolean) => {
    setBusyId(id)
    setErr(null)
    try {
      const res = await apiFetch(`/v1/admin/bonushub/promotions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vip_only: next }),
      })
      if (!res.ok) {
        const e = await readApiError(res)
        setErr(formatApiError(e, `VIP-only update failed (${res.status})`))
        return
      }
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, vip_only: next } : r)))
    } catch {
      setErr('Network error')
    } finally {
      setBusyId(null)
    }
  }

  /** Latest version row from API (fixes stale catalog ids / “already published” on older APIs). */
  const fetchHeadVersion = useCallback(
    async (promoId: number): Promise<{ id: number; published: boolean } | null> => {
      try {
        const res = await apiFetch(`/v1/admin/bonushub/promotions/${promoId}`)
        if (!res.ok) return null
        const j = (await res.json()) as { versions?: { id?: number; published?: boolean }[] }
        const v = j.versions?.[0]
        if (!v || typeof v.id !== 'number' || v.id <= 0) return null
        return { id: v.id, published: !!v.published }
      } catch {
        return null
      }
    },
    [apiFetch],
  )

  const runLiveToggle = async (p: PromotionRow, turnOn: boolean) => {
    if (!canPlayerHubToggle) return
    setBusyId(p.id)
    setErr(null)
    try {
      if (turnOn) {
        // Always load fresh head version from API — catalog row can have stale ids or has_published_version.
        const head = await fetchHeadVersion(p.id)
        if (!head) {
          setErr(
            'Could not load this promotion or it has no versions yet. Use Create promotion / Wizard, then try again.',
          )
          return
        }
        if (!head.published) {
          let pubRes = await apiFetch(`/v1/admin/bonushub/promotion-versions/${head.id}/publish`, {
            method: 'POST',
          })
          if (!pubRes.ok) {
            const recheck = await fetchHeadVersion(p.id)
            if (recheck?.published) {
              // Published by another tab, idempotent API, or race; continue to PATCH.
            } else if (recheck && recheck.id !== head.id) {
              pubRes = await apiFetch(`/v1/admin/bonushub/promotion-versions/${recheck.id}/publish`, {
                method: 'POST',
              })
            }
            if (!pubRes.ok) {
              const final = await fetchHeadVersion(p.id)
              if (!final?.published) {
                const e = await readApiError(pubRes)
                setErr(
                  `${formatApiError(e, `Publish failed (${pubRes.status})`)} — fix rules/conflicts in Schedule, or check API logs.`,
                )
                return
              }
            }
          }
        }
        const patchOn = async () => {
          const resFull = await apiFetch(`/v1/admin/bonushub/promotions/${p.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grants_paused: false, player_hub_force_visible: true }),
          })
          if (resFull.ok) return resFull
          return apiFetch(`/v1/admin/bonushub/promotions/${p.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grants_paused: false }),
          })
        }
        const res = await patchOn()
        if (!res.ok) {
          const e = await readApiError(res)
          setErr(formatApiError(e, `Resume grants failed (${res.status})`))
          return
        }
      } else {
        const patchOff = async () => {
          const resFull = await apiFetch(`/v1/admin/bonushub/promotions/${p.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grants_paused: true, player_hub_force_visible: false }),
          })
          if (resFull.ok) return resFull
          return apiFetch(`/v1/admin/bonushub/promotions/${p.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grants_paused: true }),
          })
        }
        const res = await patchOff()
        if (!res.ok) {
          const e = await readApiError(res)
          setErr(formatApiError(e, `Pause failed (${res.status})`))
          return
        }
      }
      await load()
    } catch {
      setErr('Network error')
    } finally {
      setBusyId(null)
      setConfirmModal(null)
    }
  }

  const prevMonth = () => setCursor(monthAnchor(y, m - 1))
  const nextMonth = () => setCursor(monthAnchor(y, m + 1))
  const fmt = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  }
  const today = new Date()
  const isToday = (day: number) => y === today.getFullYear() && m === today.getMonth() && day === today.getDate()
  const bonusTypeByPromotionId = useMemo(() => {
    const out = new Map<number, string>()
    for (const row of rows) out.set(row.id, row.bonus_type ?? '')
    return out
  }, [rows])
  const promotionColorById = useMemo(() => {
    const out = new Map<number, string>()
    for (const row of rows) {
      out.set(row.id, isHexColor(row.admin_color) ? row.admin_color.trim().toUpperCase() : DEFAULT_PROMO_COLOR)
    }
    return out
  }, [rows])
  const livePromotionIds = useMemo(() => {
    const ids = new Set<number>()
    for (const row of rows) {
      if (isLiveForPlayerHub(rowHubFlags(row))) ids.add(row.id)
    }
    return ids
  }, [rows])
  const visibleCalendarEvents = useMemo(
    () => calendarEvents.filter((ev) => livePromotionIds.has(ev.promotion_id)),
    [calendarEvents, livePromotionIds],
  )
  const calendarLegend = useMemo(() => {
    const buckets = new Map<string, string>()
    for (const ev of visibleCalendarEvents) {
      const hex = resolveEventColorHex(ev, promotionColorById.get(ev.promotion_id))
      if (!hex) continue
      if (!buckets.has(hex)) {
        const typeLabel = toneForBonusType(ev.bonus_type ?? bonusTypeByPromotionId.get(ev.promotion_id)).label
        buckets.set(hex, typeLabel)
      }
    }
    return Array.from(buckets.entries()).map(([hex, label]) => ({ hex, label }))
  }, [bonusTypeByPromotionId, visibleCalendarEvents, promotionColorById])
  const timelineRows = useMemo(() => {
    return visibleCalendarEvents
      .map((ev) => {
        const span = clipEventToMonth(ev, y, m)
        if (!span) return null
        return { ev, ...span }
      })
      .filter((v): v is { ev: CalEvent; startDay: number; endDay: number } => v != null)
      .sort((a, b) => a.startDay - b.startDay || a.endDay - b.endDay || a.ev.name.localeCompare(b.ev.name))
  }, [visibleCalendarEvents, m, y])
  const visibleTimelineRows = useMemo(() => timelineRows.slice(0, 3), [timelineRows])
  const visibleTimelineIds = useMemo(
    () => new Set(visibleTimelineRows.map(({ ev }) => ev.promotion_version_id)),
    [visibleTimelineRows],
  )
  const selectedDayEvents = useMemo(
    () => (selectedDay == null ? [] : calendarEventsForDay(visibleCalendarEvents, y, m, selectedDay)),
    [visibleCalendarEvents, m, selectedDay, y],
  )
  const selectedDateLabel =
    selectedDay == null
      ? ''
      : new Date(y, m, selectedDay).toLocaleDateString('en-GB', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
  const dayStateLabel = (ev: CalEvent, day: number) => {
    const start = ev.valid_from ? new Date(ev.valid_from) : null
    const end = ev.valid_to ? new Date(ev.valid_to) : null
    const isStartDay =
      start != null &&
      !Number.isNaN(start.getTime()) &&
      start.getFullYear() === y &&
      start.getMonth() === m &&
      start.getDate() === day
    const isEndDay =
      end != null &&
      !Number.isNaN(end.getTime()) &&
      end.getFullYear() === y &&
      end.getMonth() === m &&
      end.getDate() === day
    if (isStartDay && isEndDay) return 'Starts & ends today'
    if (isStartDay) return 'Starts today'
    if (isEndDay) return 'Ends today'
    return 'Active window'
  }

  return (
    <>
      <PageMeta
        title="Bonus Engine · Promotions"
        description="Bonus hub home: KPIs, quick create, and the promotions catalog."
      />
      <PageBreadcrumb
        pageTitle="Bonus hub"
        subtitle="Overview, create promotions, and open any promotion for schedule, rules, and delivery."
      />

      <div className="row g-3 mb-4 dashboard-kpi-grid">
        <div className="col-6 col-md-4 col-xl-2 min-w-0">
          <StatCard
            label="Bonus cost (30d)"
            value={bonusStats ? formatCurrency(bonusStats.total_bonus_cost_30d) : '—'}
            iconClass="bi-cash-stack"
            variant="primary"
          />
        </div>
        <div className="col-6 col-md-4 col-xl-2 min-w-0">
          <StatCard
            label="WR completion"
            value={bonusStats ? formatPct(bonusStats.wr_completion_rate) : '—'}
            iconClass="bi-check2-circle"
            variant="success"
          />
        </div>
        <div className="col-6 col-md-4 col-xl-2 min-w-0">
          <StatCard
            label="Forfeiture rate"
            value={bonusStats ? formatPct(bonusStats.forfeiture_rate) : '—'}
            iconClass="bi-exclamation-circle"
            variant="warning"
          />
        </div>
        <div className="col-6 col-md-4 col-xl-2 min-w-0">
          <Link to="/bonushub/risk" className="text-decoration-none d-block">
            <StatCard
              label="Risk queue (open)"
              value={bonusStats ? formatCompact(bonusStats.risk_queue_pending) : '—'}
              iconClass="bi-shield-exclamation"
              variant="danger"
            />
          </Link>
        </div>
        <div className="col-6 col-md-4 col-xl-2 min-w-0">
          <StatCard
            label="Grants (24h)"
            value={bonusStats ? formatCompact(bonusStats.grants_last_24h) : '—'}
            iconClass="bi-gift"
            variant="info"
          />
        </div>
        <div className="col-6 col-md-4 col-xl-2 min-w-0">
          <StatCard
            label="Bonus % of GGR"
            value={bonusStats ? formatPct(bonusStats.bonus_pct_of_ggr) : '—'}
            iconClass="bi-pie-chart"
            variant="secondary"
          />
        </div>
      </div>

      <div className="row g-3 mb-4">
        <div className="col-lg-6">
          <ComponentCard
            title="Create bonus"
            desc="Use one guided flow directly in this page (type, name, rules), without leaving the promotions hub."
          >
            <div className="bonushub-action-card mt-3">
              <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap">
                <div>
                  <p className="mb-1 fw-semibold">Launch bonus wizard</p>
                  <p className="mb-0 small text-secondary">Create and configure a promotion in one guided flow.</p>
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setWizardOpen(true)}>
                  <i className="bi bi-plus-circle me-1" />
                  Create bonus
                </button>
              </div>
            </div>
          </ComponentCard>
        </div>
        <div className="col-lg-6">
          <ComponentCard title="Catalog tips" desc="How player hub and grants interact.">
            <div className="bonushub-tip-stack mt-2">
              <p className="small mb-2">
                <i className="bi bi-check2-circle text-success me-2" />
                <strong>Live</strong> = published + grants on.
              </p>
              <p className="small mb-2">
                <i className="bi bi-stars text-info me-2" />
                <strong>Player hub ON</strong> adds a <strong>hub boost</strong> so the offer appears under{' '}
                <strong>My Bonuses → Available</strong> (granting automation still applies).
              </p>
              <p className="small mb-0">
                <i className="bi bi-pause-circle text-warning me-2" />
                <strong>Player hub OFF</strong> pauses grants and clears the boost.
              </p>
            </div>
          </ComponentCard>
        </div>
      </div>

      <ComponentCard title="Promotions" desc="Filter and manage promotions. Click a row to open its hub.">
        <div className="row g-3 align-items-end mb-3">
          <div className="col-auto">
            <label className="form-label small mb-1">Catalog filter</label>
            <select
              className="form-select form-select-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'draft' | 'archived' | 'live')}
            >
              <option value="all">All</option>
              <option value="live">Live</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="col-md-4">
            <label className="form-label small mb-1">Search</label>
            <input
              className="form-control form-control-sm"
              placeholder="Name or slug"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="col-auto">
            <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => void load()} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {err ? (
          <div className="alert alert-danger small py-2 mb-3" role="alert">
            {err}
          </div>
        ) : null}
        {loading && rows.length === 0 ? (
          <p className="text-secondary small mb-0">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-secondary small mb-0">No promotions match. Create one to get started.</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0 bonushub-promotions-table">
              <thead className="table-light">
                <tr>
                  <th scope="col" className="text-nowrap">
                    Color
                  </th>
                  <th scope="col">ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Hub state</th>
                  <th scope="col">Type</th>
                  <th scope="col">Ver.</th>
                  <th scope="col">Hub</th>
                  <th scope="col" className="text-nowrap">
                    Archive
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const flags = rowHubFlags(p)
                  const live = isLiveForPlayerHub(flags)
                  const statusLabel = recordStatusLabel(p)
                  const badge = playerHubVisibilityBadge(flags)
                  const hasAnyVersion = (p.latest_version ?? 0) >= 1 || (p.latest_version_id != null && p.latest_version_id > 0)
                  const toggleDisabled =
                    !canPlayerHubToggle || busyId === p.id || p.status === 'archived' || !hasAnyVersion
                  const toggleTitle = !canPlayerHubToggle
                    ? 'Sign in as admin (or superadmin) to use this switch.'
                    : p.status === 'archived'
                      ? 'Archived promotions cannot go live from here.'
                      : !hasAnyVersion
                        ? 'Create a version first (wizard / operations).'
                        : live
                          ? 'Turn off: pause grants for this promotion.'
                          : 'Turn on: publish latest if needed, then resume grants.'
                  return (
                    <tr
                      key={p.id}
                      className={live ? 'bonushub-row-live' : undefined}
                      role="button"
                      tabIndex={0}
                      title="Open promotion hub"
                      aria-label={`Open promotion: ${p.name}`}
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        const el = e.target as HTMLElement
                        if (el.closest('input, button, a, label')) return
                        navigate(`/bonushub/promotions/${p.id}`)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(`/bonushub/promotions/${p.id}`)
                        }
                      }}
                    >
                      <td className="small">
                        <div className="d-flex align-items-center gap-2">
                          <input
                            type="color"
                            className="form-control form-control-color p-0 border-0"
                            value={colorDraftById[p.id] ?? (isHexColor(p.admin_color) ? p.admin_color : DEFAULT_PROMO_COLOR)}
                            title="Pick calendar color"
                            disabled={colorBusyId === p.id || !canPlayerHubToggle}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              e.stopPropagation()
                              const v = e.target.value.trim().toUpperCase()
                              setColorDraftById((prev) => ({ ...prev, [p.id]: isHexColor(v) ? v : DEFAULT_PROMO_COLOR }))
                            }}
                            style={{ width: 24, height: 24 }}
                          />
                          <button
                            type="button"
                            className="btn btn-outline-primary btn-sm px-2 py-0"
                            disabled={
                              colorBusyId === p.id ||
                              !canPlayerHubToggle ||
                              (colorDraftById[p.id] ?? (isHexColor(p.admin_color) ? p.admin_color : DEFAULT_PROMO_COLOR)) ===
                                (isHexColor(p.admin_color) ? p.admin_color : DEFAULT_PROMO_COLOR)
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              const draft = colorDraftById[p.id] ?? (isHexColor(p.admin_color) ? p.admin_color : DEFAULT_PROMO_COLOR)
                              void setPromotionColor(p.id, draft)
                            }}
                          >
                            Apply
                          </button>
                        </div>
                      </td>
                      <td className="font-monospace small text-nowrap">{p.id}</td>
                      <td className="small fw-medium text-primary">
                        <div className="d-flex flex-column gap-1">
                          <span>{p.name}</span>
                          {p.vip_only ? (
                            <span className="badge text-bg-info align-self-start" title="Only visible after VIP tier grant">
                              VIP-only
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="small text-capitalize">
                        <span className={`badge ${recordStatusBadgeClass(statusLabel)}`}>{statusLabel}</span>
                      </td>
                      <td className="small">
                        <span className={`badge ${badge.className}`} title={badge.hint}>
                          {badge.label}
                        </span>
                        {p.player_hub_force_visible ? (
                          <div className="mt-1">
                            <span
                              className="badge text-bg-info text-dark"
                              title="Listed for all players in My Bonuses, ignoring schedule and segment for this screen."
                            >
                              Hub boost
                            </span>
                          </div>
                        ) : null}
                        {canPlayerHubToggle ? (
                          <div className="mt-1">
                            <button
                              type="button"
                              className={`btn btn-sm ${p.vip_only ? 'btn-info' : 'btn-outline-info'} py-0 px-2`}
                              disabled={busyId === p.id}
                              onClick={(e) => {
                                e.stopPropagation()
                                void setVipOnly(p.id, !(p.vip_only === true))
                              }}
                            >
                              {p.vip_only ? 'VIP-only' : 'Set VIP-only'}
                            </button>
                          </div>
                        ) : null}
                      </td>
                      <td className="small">
                        <span className="font-monospace">{p.bonus_type ?? '—'}</span>
                      </td>
                      <td className={`small ${live ? 'text-dark' : 'text-body'}`}>{p.latest_version ?? '—'}</td>
                      <td className="small">
                        <div className="form-check form-switch mb-0" title={toggleTitle}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            role="switch"
                            id={`live-${p.id}`}
                            checked={live}
                            disabled={toggleDisabled}
                            onChange={() => {
                              if (toggleDisabled) return
                              setConfirmModal({ promo: p, mode: live ? 'off' : 'on' })
                            }}
                            aria-label={live ? 'Turn off player hub' : 'Turn on player hub'}
                          />
                          <label
                            className={`form-check-label small ${live ? 'text-dark' : 'text-body'}`}
                            htmlFor={`live-${p.id}`}
                          >
                            {live ? 'On' : 'Off'}
                          </label>
                        </div>
                      </td>
                      <td className="small text-nowrap">
                        {isSuper ? (
                          p.status === 'archived' ? (
                            <button
                              type="button"
                              className="btn btn-link btn-sm p-0 align-baseline"
                              disabled={busyId === p.id}
                              onClick={() => void setArchived(p.id, false)}
                            >
                              Restore
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-link btn-sm p-0 align-baseline text-warning"
                              disabled={busyId === p.id}
                              onClick={() => void setArchived(p.id, true)}
                            >
                              Archive
                            </button>
                          )
                        ) : (
                          <span className="text-muted small">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!canPlayerHubToggle ? (
          <p className="text-warning small mb-0 mt-3">
            Player hub on/off requires an <strong>admin</strong> or <strong>superadmin</strong> staff account.
          </p>
        ) : null}
      </ComponentCard>

      <div className="card shadow-sm mb-4">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h3 className="card-title mb-0 fs-6">Calendar</h3>
            <p className="text-secondary small mb-0 mt-1">Published promotions by day</p>
          </div>
        </div>
        <div className="card-body">
            <div className="mb-3 d-flex flex-wrap align-items-center gap-2">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={prevMonth}>
                ← Prev
              </button>
              <span className="fw-semibold text-body px-1">
                {monthNames[m]} {y}
              </span>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={nextMonth}>
                Next →
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  void Promise.all([loadCalendar(), load()])
                }}
                disabled={calendarLoading}
              >
                {calendarLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <div className="mb-3 d-flex flex-wrap align-items-center gap-2">
              {calendarLegend.length > 0
                ? calendarLegend.map((item) => (
                    <span key={item.hex} className="badge rounded-pill border border-secondary-subtle text-body bg-body">
                      <span
                        className="d-inline-block rounded-circle me-1"
                        style={{ width: 8, height: 8, backgroundColor: item.hex }}
                      />
                      {item.label}
                    </span>
                  ))
                : Object.values(BONUS_TYPE_TONES).map((tone) => (
                    <span key={tone.label} className="badge rounded-pill border border-secondary-subtle text-body bg-body">
                      <span className={`d-inline-block rounded-circle me-1 ${tone.dotClass}`} style={{ width: 8, height: 8 }} />
                      {tone.label}
                    </span>
                  ))}
              <span className="small text-secondary">Click any day to inspect start/end states.</span>
            </div>

            {calendarErr ? <p className="mb-3 text-danger small">{calendarErr}</p> : null}
            {calendarLoading && calendarEvents.length === 0 ? (
              <p className="small text-secondary mb-0">Loading…</p>
            ) : calendarEvents.length === 0 ? (
              <p className="small text-secondary mb-0">No published promotions overlap this month in UTC.</p>
            ) : (
              <>
                <div className="table-responsive rounded border mb-3">
                  <table className="table table-bordered table-sm mb-0">
                    <thead className="table-light">
                      <tr>
                        {UTC_WEEKDAYS.map((w) => (
                          <th key={w} scope="col" className="text-center small text-secondary py-2">
                            {w}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gridRows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((cell, ci) => {
                            if (cell.kind === 'pad') {
                              return (
                                <td
                                  key={`pad-${ri}-${ci}`}
                                  className="bg-body-secondary p-0"
                                  style={{ height: '6.5rem' }}
                                />
                              )
                            }
                            const dayEvents = calendarEventsForDay(visibleCalendarEvents, y, m, cell.day)
                            const todayCell = isToday(cell.day)
                            const hiddenCount = dayEvents.filter((ev) => !visibleTimelineIds.has(ev.promotion_version_id)).length
                            return (
                              <td
                                key={cell.day}
                                className={`align-top p-0 small ${todayCell ? 'bg-primary-subtle' : ''} ${dayEvents.length > 0 ? 'cursor-pointer' : ''}`}
                                style={{ height: '6.5rem', width: '14.28%', verticalAlign: 'top' }}
                                onClick={() => {
                                  if (dayEvents.length > 0) setSelectedDay(cell.day)
                                }}
                              >
                                <div className="d-flex justify-content-between align-items-start mb-1 px-1 pt-1">
                                  <span className={`fw-semibold ${todayCell ? 'text-primary' : 'text-body'}`}>{cell.day}</span>
                                </div>
                                <div className="d-flex flex-column gap-1 px-0">
                                  {visibleTimelineRows.map(({ ev, startDay, endDay }) => {
                                    const inWindow = cell.day >= startDay && cell.day <= endDay
                                    if (!inWindow) return <div key={`${cell.day}-${ev.promotion_version_id}`} style={{ minHeight: '1.15rem' }} />
                                    const tone = toneForBonusType(ev.bonus_type ?? bonusTypeByPromotionId.get(ev.promotion_id))
                                    const eventColor = resolveEventColorHex(ev, promotionColorById.get(ev.promotion_id))
                                    const actualStart = ev.valid_from ? new Date(ev.valid_from) : null
                                    const actualEnd = ev.valid_to ? new Date(ev.valid_to) : null
                                    const isActualStartDay =
                                      actualStart != null &&
                                      !Number.isNaN(actualStart.getTime()) &&
                                      actualStart.getFullYear() === y &&
                                      actualStart.getMonth() === m &&
                                      actualStart.getDate() === cell.day
                                    const isActualEndDay =
                                      actualEnd != null &&
                                      !Number.isNaN(actualEnd.getTime()) &&
                                      actualEnd.getFullYear() === y &&
                                      actualEnd.getMonth() === m &&
                                      actualEnd.getDate() === cell.day
                                    const isStart = cell.day === startDay
                                    const isEnd = cell.day === endDay
                                    const timelineClass = isStart && isEnd
                                      ? 'calendar-timeline-chip calendar-timeline-chip-single'
                                      : isStart
                                        ? 'calendar-timeline-chip calendar-timeline-chip-start'
                                        : isEnd
                                          ? 'calendar-timeline-chip calendar-timeline-chip-end'
                                          : 'calendar-timeline-chip calendar-timeline-chip-mid'
                                    return (
                                      <button
                                        key={`${cell.day}-${ev.promotion_version_id}`}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          setSelectedDay(cell.day)
                                        }}
                                        className={`btn btn-sm text-truncate d-block w-100 text-start px-1 py-0 border-0 ${timelineClass} ${
                                          eventColor ? 'text-white' : tone.itemClass
                                        }`}
                                        style={{
                                          fontSize: '0.68rem',
                                          lineHeight: 1.25,
                                          backgroundColor: eventColor ?? undefined,
                                          minHeight: '0.95rem',
                                        }}
                                        title={`${ev.name} · ${tone.label} · ${fmt(ev.valid_from)} → ${fmt(ev.valid_to)}`}
                                      >
                                        {isActualStartDay ? ev.name : isActualEndDay ? 'End' : '\u00A0'}
                                      </button>
                                    )
                                  })}
                                  {hiddenCount > 0 ? (
                                    <span className="text-muted" style={{ fontSize: '0.65rem' }}>
                                      +{hiddenCount} more
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
      </div>

      <div className="card shadow-sm mb-4">
        <div className="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
          <div>
            <h3 className="card-title mb-0 fs-6">Operations tools</h3>
            <p className="text-secondary small mb-0 mt-1">
              Instances, ledger deposit simulation, failed jobs, manual grant, free spin grants
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={() => setOperationsExpanded((v) => !v)}
          >
            {operationsExpanded ? 'Hide operations' : 'Show operations'}
          </button>
        </div>
        {operationsExpanded ? (
          <div className="card-body">
            <BonusOperationsTools initialTab={bonusOpsInitialTab} />
          </div>
        ) : null}
      </div>

      {confirmModal ? (
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
                <h5 className="modal-title">
                  {confirmModal.mode === 'on' ? 'Turn ON for player hub?' : 'Turn OFF for player hub?'}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Close"
                  onClick={() => setConfirmModal(null)}
                />
              </div>
              <div className="modal-body small">
                <p className="mb-2 fw-medium">{confirmModal.promo.name}</p>
                {confirmModal.mode === 'on' ? (
                  <>
                    <p className="mb-0">
                      This will <strong>publish the latest version</strong> (if it is not already published),{' '}
                      <strong>resume grants</strong>, and enable <strong>hub boost</strong> so the offer appears under{' '}
                      <strong>My Bonuses → Available</strong> for <strong>all players</strong>, even if the schedule
                      window or segment rules would normally hide it.
                    </p>
                    {!confirmModal.promo.has_published_version ? (
                      <p className="mt-2 text-warning mb-0">
                        No published version yet — the <strong>latest</strong> version will be published, then grants
                        resumed.
                      </p>
                    ) : !confirmModal.promo.latest_version_published ? (
                      <p className="mt-2 text-muted mb-0">
                        An older published version exists; this action only <strong>resumes grants</strong>. To publish a
                        newer draft, use <strong>Schedule &amp; deliver</strong>.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mb-0">
                    This will <strong>pause grants</strong> and <strong>clear hub boost</strong> (schedule/segment gates
                    apply again for listing). Existing bonus instances stay; new automated grants stop until you turn the
                    hub back on.
                  </p>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmModal(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={confirmModal.mode === 'on' ? 'btn btn-success btn-sm' : 'btn btn-warning btn-sm'}
                  disabled={busyId !== null}
                  onClick={() => void runLiveToggle(confirmModal.promo, confirmModal.mode === 'on')}
                >
                  {confirmModal.mode === 'on' ? 'Confirm — go live' : 'Confirm — pause'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {wizardOpen ? (
        <div
          className="modal fade show d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          aria-modal="true"
          role="dialog"
        >
          <div className="modal-dialog modal-xl modal-dialog-scrollable modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-body">
                <BonusWizardFlow
                  onCancel={() => setWizardOpen(false)}
                  onCreated={async (pid) => {
                    setWizardOpen(false)
                    await load()
                    navigate(`/bonushub/promotions/${pid}/rules`)
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedDay != null ? (
        <div
          className="modal fade show d-block"
          tabIndex={-1}
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          aria-modal="true"
          role="dialog"
        >
          <div className="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {selectedDateLabel} · {selectedDayEvents.length} bonus{selectedDayEvents.length === 1 ? '' : 'es'}
                </h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setSelectedDay(null)} />
              </div>
              <div className="modal-body">
                {selectedDayEvents.length === 0 ? (
                  <p className="small text-secondary mb-0">No promotions on this date.</p>
                ) : (
                  <div className="list-group">
                    {selectedDayEvents.map((ev) => {
                      const row = rows.find((r) => r.id === ev.promotion_id)
                      const tone = toneForBonusType(ev.bonus_type ?? bonusTypeByPromotionId.get(ev.promotion_id))
                      const eventColor = resolveEventColorHex(ev, promotionColorById.get(ev.promotion_id))
                      return (
                        <div key={`${ev.promotion_version_id}-${ev.promotion_id}`} className="list-group-item">
                          <div className="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-2">
                            <div className="min-w-0">
                              <p className="fw-semibold mb-1">{ev.name}</p>
                              <div className="d-flex flex-wrap gap-2">
                                <span
                                  className={`badge ${eventColor ? 'text-white' : tone.itemClass}`}
                                  style={{ backgroundColor: eventColor ?? undefined }}
                                >
                                  {tone.label}
                                </span>
                                <span className="badge text-bg-light border border-secondary-subtle">
                                  {dayStateLabel(ev, selectedDay)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <p className="small text-secondary mb-2">
                            Start: {fmt(ev.valid_from)} · End: {fmt(ev.valid_to)}
                          </p>
                          <div className="d-flex flex-wrap gap-2">
                            <Link to={`/bonushub/promotions/${ev.promotion_id}`} className="btn btn-sm btn-outline-secondary">
                              Edit promotion
                            </Link>
                            <Link
                              to={`/bonushub/promotions/${ev.promotion_id}/delivery`}
                              className="btn btn-sm btn-outline-primary"
                            >
                              Schedule & deliver
                            </Link>
                            {row ? (
                              <button
                                type="button"
                                className={`btn btn-sm ${isLiveForPlayerHub(rowHubFlags(row)) ? 'btn-warning' : 'btn-success'}`}
                                onClick={() =>
                                  setConfirmModal({
                                    promo: row,
                                    mode: isLiveForPlayerHub(rowHubFlags(row)) ? 'off' : 'on',
                                  })
                                }
                              >
                                {isLiveForPlayerHub(rowHubFlags(row)) ? 'Turn off' : 'Turn on'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
