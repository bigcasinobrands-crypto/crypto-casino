import { useCallback, useEffect, useId, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { usePlayerAuth } from '../playerAuth'
import {
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
  IconSearch,
} from './icons'

type ReferredRow = {
  user_id: string
  username: string
  joined_at: string
  vip_tier: string
  total_wagered_minor: number
  commission_earned_minor: number
}

type Props = {
  active: boolean
}

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

function userInitials(name: string): string {
  const parts = name.replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2)
  return name.slice(0, 2).toUpperCase() || '?'
}

function displayLabel(r: ReferredRow): string {
  const u = r.username?.trim()
  if (u) return u
  return r.user_id.slice(0, 8)
}

function formatUsdFromMinor(minor: number, lng: string, opts?: { plus?: boolean }): string {
  const n = Math.round(Number(minor) || 0) / 100
  const locale = lng === 'fr-CA' ? 'fr-CA' : 'en-US'
  const formatted = n.toLocaleString(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (opts?.plus && n > 0) return `+${formatted}`
  return formatted
}

function formatJoinedDate(iso: string, lng: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString(lng === 'fr-CA' ? 'fr-CA' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const PAGE_SIZE = 20

export const AffiliateReferralHistoryPanel: FC<Props> = ({ active }) => {
  const { t, i18n } = useTranslation()
  const tableCaptionId = useId()
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const [search, setSearch] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<ReferredRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    setSearch('')
    setDebouncedQ('')
    setPage(1)
  }, [active])

  useEffect(() => {
    const tmr = window.setTimeout(() => setDebouncedQ(search.trim()), 350)
    return () => window.clearTimeout(tmr)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [debouncedQ])

  const load = useCallback(async () => {
    if (!isAuthenticated || !active) return
    setLoading(true)
    setLoadErr(null)
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      })
      if (debouncedQ) qs.set('q', debouncedQ)
      const res = await apiFetch(`/v1/referrals/referred?${qs.toString()}`)
      if (!res.ok) {
        setLoadErr(`HTTP ${res.status}`)
        setRows([])
        setTotal(0)
        return
      }
      const j = (await res.json()) as {
        rows?: ReferredRow[]
        total?: number
      }
      setRows(Array.isArray(j.rows) ? j.rows : [])
      setTotal(typeof j.total === 'number' ? j.total : 0)
    } catch {
      setLoadErr('network')
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [active, apiFetch, debouncedQ, isAuthenticated, page])

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)

  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  const sliceStart = (safePage - 1) * PAGE_SIZE
  const showingFrom = total === 0 ? 0 : sliceStart + 1
  const showingTo = sliceStart + rows.length

  if (!active) return null

  return (
    <div className="flex flex-col gap-5">
      {loadErr ? (
        <p className="text-sm text-red-400" role="alert">
          {t('affiliateHistoryModal.loadError', { defaultValue: 'Could not load referrals.' })}
        </p>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="flex h-10 w-full max-w-[300px] items-center gap-3 rounded-lg border border-white/[0.06] bg-[#231f2d] px-4 text-casino-muted lg:flex-1">
          <IconSearch size={18} aria-hidden className="shrink-0 opacity-80" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('affiliateHistoryModal.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-casino-muted focus:outline-none"
            autoComplete="off"
            aria-label={t('affiliateHistoryModal.searchPlaceholder')}
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/[0.06] bg-[#19171e] px-4 text-[13px] font-medium text-white transition hover:bg-white/[0.04]"
            onClick={() => toast.message(t('affiliateHistoryModal.dateFilterSoon'))}
          >
            <IconCalendar size={16} aria-hidden className="shrink-0 opacity-90" />
            {t('affiliateHistoryModal.last30Days')}
            <IconChevronDown size={16} aria-hidden className="shrink-0 opacity-90" />
          </button>
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/[0.06] bg-[#19171e] px-4 text-[13px] font-medium text-white transition hover:bg-white/[0.04]"
            onClick={() => toast.message(t('affiliateHistoryModal.filtersSoon'))}
          >
            <IconFilter size={16} aria-hidden className="shrink-0 opacity-90" />
            {t('affiliateHistoryModal.filters')}
          </button>
        </div>
      </div>

      <div className="scrollbar-casino-subtle overflow-x-auto overflow-y-hidden rounded-lg border border-white/[0.06] bg-[#19171e]">
        <table className="w-full min-w-[520px] border-collapse text-left" aria-describedby={tableCaptionId}>
          <caption id={tableCaptionId} className="sr-only">
            {t('affiliateHistoryModal.tableCaption')}
          </caption>
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th
                scope="col"
                className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-casino-muted sm:px-5"
              >
                {t('affiliateHistoryModal.colUser')}
              </th>
              <th
                scope="col"
                className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-casino-muted sm:px-5"
              >
                {t('affiliateHistoryModal.colJoined')}
              </th>
              <th
                scope="col"
                className="px-4 py-4 text-xs font-semibold uppercase tracking-wide text-casino-muted sm:px-5"
              >
                {t('affiliateHistoryModal.colTier')}
              </th>
              <th
                scope="col"
                className="hidden px-4 py-4 text-xs font-semibold uppercase tracking-wide text-casino-muted sm:table-cell sm:px-5"
              >
                {t('affiliateHistoryModal.colWagered')}
              </th>
              <th
                scope="col"
                className="px-4 py-4 text-right text-xs font-semibold uppercase tracking-wide text-casino-muted sm:px-5"
              >
                {t('affiliateHistoryModal.colCommission')}
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-casino-muted">
                  {t('affiliateHistoryModal.loading', { defaultValue: 'Loading…' })}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-casino-muted">
                  {t('affiliateHistoryModal.empty')}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const label = displayLabel(row)
                const hue = hashHue(row.user_id)
                const initials = userInitials(label)
                const commissionMinor = row.commission_earned_minor ?? 0
                const commissionPositive = commissionMinor > 0
                const vipName = row.vip_tier?.trim() || '—'
                return (
                  <tr key={row.user_id} className="border-b border-white/[0.06] last:border-b-0">
                    <td className="px-4 py-4 text-sm sm:px-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-1 ring-white/10"
                          style={{
                            background: `linear-gradient(135deg, hsl(${hue} 42% 38%) 0%, hsl(${(hue + 40) % 360} 48% 28%) 100%)`,
                          }}
                          aria-hidden
                        >
                          {initials}
                        </div>
                        <span className="min-w-0 truncate font-medium text-white">{label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-casino-muted sm:px-5">
                      {formatJoinedDate(row.joined_at, i18n.language)}
                    </td>
                    <td className="px-4 py-4 sm:px-5">
                      <span
                        className="inline-block max-w-[140px] truncate rounded bg-casino-primary/15 px-2 py-1 text-[11px] font-bold text-casino-primary"
                        title={vipName}
                      >
                        {vipName}
                      </span>
                    </td>
                    <td className="hidden px-4 py-4 text-sm tabular-nums text-white sm:table-cell sm:px-5">
                      {formatUsdFromMinor(row.total_wagered_minor ?? 0, i18n.language)}
                    </td>
                    <td
                      className={`px-4 py-4 text-right text-sm font-semibold tabular-nums sm:px-5 ${
                        commissionPositive ? 'text-emerald-500' : 'text-casino-muted'
                      }`}
                    >
                      {commissionPositive
                        ? formatUsdFromMinor(commissionMinor, i18n.language, { plus: true })
                        : formatUsdFromMinor(0, i18n.language)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <nav
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        aria-label={t('affiliateHistoryModal.paginationLabel')}
      >
        <p className="text-[13px] text-casino-muted">
          {t('affiliateHistoryModal.pageInfo', {
            from: showingFrom,
            to: showingTo,
            total,
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.06] bg-[#19171e] text-white transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('affiliateHistoryModal.prevPage')}
            disabled={safePage <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <IconChevronLeft size={16} aria-hidden />
          </button>
          <span className="px-2 text-sm tabular-nums text-white">
            {safePage} / {pageCount}
          </span>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.06] bg-[#19171e] text-white transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('affiliateHistoryModal.nextPage')}
            disabled={safePage >= pageCount || loading}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            <IconChevronRight size={16} aria-hidden />
          </button>
        </div>
      </nav>
    </div>
  )
}
