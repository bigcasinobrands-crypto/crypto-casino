import { useEffect, useId, useMemo, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFilter,
  IconSearch,
} from './icons'

type ReferralHistoryRow = {
  id: string
  username: string
  joinedAt: string
  tier: 1 | 2
  totalWagered: number
  commissionEarned: number
}

/** Sample rows until GET /v1/affiliate/referrals exists. */
const DEMO_REFERRALS: ReferralHistoryRow[] = [
  {
    id: '1',
    username: 'CryptoWhale99',
    joinedAt: '2023-10-24',
    tier: 1,
    totalWagered: 4520,
    commissionEarned: 226,
  },
  {
    id: '2',
    username: 'LunaStakes',
    joinedAt: '2023-10-22',
    tier: 1,
    totalWagered: 1250.5,
    commissionEarned: 62.52,
  },
  {
    id: '3',
    username: 'HighRollerX',
    joinedAt: '2023-10-19',
    tier: 2,
    totalWagered: 12400,
    commissionEarned: 682,
  },
  {
    id: '4',
    username: 'BettyWins',
    joinedAt: '2023-10-15',
    tier: 1,
    totalWagered: 890,
    commissionEarned: 44.5,
  },
  {
    id: '5',
    username: 'JackpotHunter',
    joinedAt: '2023-10-12',
    tier: 1,
    totalWagered: 340.25,
    commissionEarned: 17.01,
  },
  {
    id: '6',
    username: 'SpinMaster',
    joinedAt: '2023-10-05',
    tier: 1,
    totalWagered: 0,
    commissionEarned: 0,
  },
]

const DEMO_TOTAL_REFERRALS = 142

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

function formatUsd(n: number, lng: string, opts?: { minFrac?: number; maxFrac?: number; plus?: boolean }): string {
  const locale = lng === 'fr-CA' ? 'fr-CA' : 'en-US'
  const minFrac = opts?.minFrac ?? 2
  const maxFrac = opts?.maxFrac ?? 2
  const formatted = n.toLocaleString(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: minFrac,
    maximumFractionDigits: maxFrac,
  })
  if (opts?.plus && n > 0) return `+${formatted}`
  return formatted
}

function formatJoinedDate(iso: string, lng: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(lng === 'fr-CA' ? 'fr-CA' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export const AffiliateReferralHistoryPanel: FC<Props> = ({ active }) => {
  const { t, i18n } = useTranslation()
  const tableCaptionId = useId()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!active) return
    setSearch('')
    setPage(1)
  }, [active])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return DEMO_REFERRALS
    return DEMO_REFERRALS.filter((r) => r.username.toLowerCase().includes(q))
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [search])

  const pageSize = 6
  const totalFiltered = filtered.length
  const totalForDisplay = search.trim() ? totalFiltered : DEMO_TOTAL_REFERRALS
  const pageCount = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const safePage = Math.min(page, pageCount)
  const sliceStart = (safePage - 1) * pageSize
  const pageRows = filtered.slice(sliceStart, sliceStart + pageSize)
  const showingFrom = totalFiltered === 0 ? 0 : sliceStart + 1
  const showingTo = sliceStart + pageRows.length

  if (!active) return null

  return (
    <div className="flex flex-col gap-5">
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
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-casino-muted">
                  {t('affiliateHistoryModal.empty')}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => {
                const hue = hashHue(row.username)
                const initials = userInitials(row.username)
                const commissionPositive = row.commissionEarned > 0
                return (
                  <tr key={row.id} className="border-b border-white/[0.06] last:border-b-0">
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
                        <span className="min-w-0 truncate font-medium text-white">{row.username}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-casino-muted sm:px-5">
                      {formatJoinedDate(row.joinedAt, i18n.language)}
                    </td>
                    <td className="px-4 py-4 sm:px-5">
                      <span className="inline-block rounded bg-casino-primary/15 px-2 py-1 text-[11px] font-bold text-casino-primary">
                        {t('affiliateModal.tierLabel', { n: row.tier })}
                      </span>
                    </td>
                    <td className="hidden px-4 py-4 text-sm tabular-nums text-white sm:table-cell sm:px-5">
                      {formatUsd(row.totalWagered, i18n.language)}
                    </td>
                    <td
                      className={`px-4 py-4 text-right text-sm font-semibold tabular-nums sm:px-5 ${
                        commissionPositive ? 'text-emerald-500' : 'text-casino-muted'
                      }`}
                    >
                      {commissionPositive
                        ? formatUsd(row.commissionEarned, i18n.language, { plus: true })
                        : formatUsd(0, i18n.language)}
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
            total: totalForDisplay,
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.06] bg-[#19171e] text-white transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('affiliateHistoryModal.prevPage')}
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <IconChevronLeft size={16} aria-hidden />
          </button>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm font-semibold transition ${
                safePage === n
                  ? 'border-casino-primary bg-casino-primary text-white'
                  : 'border-white/[0.06] bg-[#19171e] text-white hover:bg-white/[0.05]'
              }`}
              onClick={() => n <= pageCount && setPage(n)}
              disabled={n > pageCount}
              aria-label={t('affiliateHistoryModal.goToPage', { n })}
              aria-current={safePage === n ? 'page' : undefined}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.06] bg-[#19171e] text-casino-muted transition hover:bg-white/[0.05] hover:text-white"
            aria-label={t('affiliateHistoryModal.morePages')}
            onClick={() => toast.message(t('affiliateHistoryModal.paginationSoon'))}
          >
            <span className="text-xs font-bold leading-none" aria-hidden>
              ···
            </span>
          </button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.06] bg-[#19171e] text-white transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('affiliateHistoryModal.nextPage')}
            disabled={safePage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            <IconChevronRight size={16} aria-hidden />
          </button>
        </div>
      </nav>
    </div>
  )
}
