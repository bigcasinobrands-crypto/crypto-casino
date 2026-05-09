import { useCallback, useEffect, useId, useMemo, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthModal } from '../authModalContext'
import { useRewardsHub } from '../hooks/useRewardsHub'
import { PLAYER_MODAL_OVERLAY_Z } from '../lib/playerChromeLayers'
import { usePlayerAuth } from '../playerAuth'
import { AffiliateReferralHistoryPanel } from './AffiliateReferralHistoryPanel'
import { IconCopy, IconExternalLink, IconUsers, IconX } from './icons'

type TabId = 'refer' | 'earnings' | 'history'

type ChartRange = '30d' | '14d' | '7d'

type Props = {
  open: boolean
  onClose: () => void
}

const AFFILIATE_PROGRAM_URL = import.meta.env.VITE_AFFILIATE_PROGRAM_URL?.trim() || ''

/** Public partner signup: env wins; otherwise same-origin `/affiliate` (add redirect or page there). */
function partnerProgramHref(): string {
  if (AFFILIATE_PROGRAM_URL) return AFFILIATE_PROGRAM_URL
  if (typeof window !== 'undefined') return `${window.location.origin}/affiliate`
  return '/affiliate'
}

/** Design baseline when API omits tier progress. */
const DEFAULT_TIER_PROGRESS_PCT = 0

function buildRefUrl(refSlug: string): string {
  if (typeof window === 'undefined') return ''
  const q = new URLSearchParams()
  q.set('ref', refSlug)
  return `${window.location.origin}/?${q.toString()}`
}

function pickStageCount(stages: Record<string, number> | undefined, keys: string[]): number {
  if (!stages) return 0
  for (const k of keys) {
    const v = stages[k]
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
    const lo = stages[k.toLowerCase()]
    if (typeof lo === 'number' && Number.isFinite(lo)) return Math.trunc(lo)
  }
  return 0
}

function formatUsdAmount(n: number, lng: string): string {
  const locale = lng === 'fr-CA' ? 'fr-CA' : 'en-US'
  return n.toLocaleString(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatChartDayLabel(iso: string, lng: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(lng === 'fr-CA' ? 'fr-CA' : 'en-US', { month: 'short', day: 'numeric' })
}

function minorToUsdAmount(minor: number): number {
  if (!Number.isFinite(minor)) return 0
  return Math.round(minor) / 100
}

const ReferAndEarnModal: FC<Props> = ({ open, onClose }) => {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const referPanelId = useId()
  const earningsPanelId = useId()
  const historyPanelId = useId()
  const tabReferId = useId()
  const tabEarningsId = useId()
  const tabHistoryId = useId()
  const { openAuth } = useAuthModal()
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const { data: hub, reload } = useRewardsHub()
  const [tab, setTab] = useState<TabId>('refer')
  const [chartRange, setChartRange] = useState<ChartRange>('7d')
  const [claimBusy, setClaimBusy] = useState(false)
  const [chartAccrued, setChartAccrued] = useState<{ date: string; amount_minor: number }[]>([])

  useEffect(() => {
    if (!open) return
    setTab('refer')
    setChartRange('7d')
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !isAuthenticated) return
    void reload()
  }, [open, isAuthenticated, reload])

  const loadEarningsChart = useCallback(async () => {
    if (!isAuthenticated) return
    const res = await apiFetch(`/v1/referrals/earnings-series?range=${encodeURIComponent(chartRange)}`)
    if (!res.ok) return
    const j = (await res.json()) as { accrued_daily?: { date: string; amount_minor: number }[] }
    setChartAccrued(Array.isArray(j.accrued_daily) ? j.accrued_daily : [])
  }, [apiFetch, chartRange, isAuthenticated])

  useEffect(() => {
    if (!open || !isAuthenticated || tab !== 'earnings') return
    void loadEarningsChart()
  }, [open, isAuthenticated, tab, loadEarningsChart])

  const refSlug = useMemo(() => hub?.referral?.link_code?.trim() ?? '', [hub?.referral?.link_code])

  const referralUrl = refSlug ? buildRefUrl(refSlug) : ''

  const stages = hub?.referral?.stages
  const statReferrals = useMemo(() => pickStageCount(stages, ['referrals', 'referral', 'signups', 'signup']), [stages])
  const statDepositors = useMemo(() => pickStageCount(stages, ['depositors', 'ftd', 'first_deposit']), [stages])
  const statDeposits = useMemo(
    () => pickStageCount(stages, ['deposits', 'deposit_count', 'total_deposits']),
    [stages],
  )

  const availableCredit = minorToUsdAmount(hub?.referral?.pending_minor ?? 0)
  const lifetimeEarnings = minorToUsdAmount(hub?.referral?.lifetime_paid_minor ?? 0)
  const tierProgressPct = Math.min(
    100,
    Math.max(0, Math.round(hub?.referral?.tier_progress_pct ?? DEFAULT_TIER_PROGRESS_PCT)),
  )
  const tierTitle =
    hub?.referral?.tier_name?.trim() ||
    (hub?.referral?.tier_id != null ? `Tier ${hub.referral.tier_id}` : t('affiliateModal.tierLabel', { n: 1 }))
  const currentNgrPct = (hub?.referral?.ngr_revshare_bps ?? 500) / 100
  const nextTierName =
    typeof hub?.referral?.next_tier?.name === 'string' ? hub.referral.next_tier.name.trim() : ''
  const nextTierRec =
    hub?.referral?.next_tier && typeof hub.referral.next_tier === 'object'
      ? (hub.referral.next_tier as Record<string, unknown>)
      : null
  const nextNgrBpsRaw = nextTierRec?.ngr_revshare_bps
  const nextNgrPct =
    typeof nextNgrBpsRaw === 'number' && Number.isFinite(nextNgrBpsRaw) ? nextNgrBpsRaw / 100 : null
  const chartMaxMinor = useMemo(() => {
    const m = Math.max(0, ...chartAccrued.map((p) => p.amount_minor))
    return m > 0 ? m : 1
  }, [chartAccrued])
  const chartMaxUsd = minorToUsdAmount(chartMaxMinor)

  const copyUrl = async () => {
    if (!referralUrl) return
    try {
      await navigator.clipboard.writeText(referralUrl)
      toast.success(t('affiliateModal.copySuccess'))
    } catch {
      toast.error(t('affiliateModal.copyFail'))
    }
  }

  const claimAffiliate = async () => {
    if (!isAuthenticated || claimBusy) return
    setClaimBusy(true)
    try {
      const res = await apiFetch('/v1/referrals/claim', { method: 'POST' })
      if (!res.ok) {
        toast.error(t('affiliateModal.claimFail', { defaultValue: 'Could not claim' }))
        return
      }
      const j = (await res.json()) as { grants_paid?: number }
      const n = j.grants_paid ?? 0
      toast.success(
        t('affiliateModal.claimOk', {
          defaultValue: 'Paid {{count}} reward(s) to your wallet',
          count: n,
        }),
      )
      await reload()
      await loadEarningsChart()
    } catch {
      toast.error(t('affiliateModal.claimFail', { defaultValue: 'Could not claim' }))
    } finally {
      setClaimBusy(false)
    }
  }

  if (!open) return null

  const partnerHref = partnerProgramHref()

  const panelCls =
    'rounded-lg border border-white/[0.06] bg-[#1a1820] px-5 py-4 sm:px-5 sm:py-5'
  const panelHeaderCls = 'text-xs font-medium text-casino-muted'

  return (
    <div
      className={`fixed inset-0 ${PLAYER_MODAL_OVERLAY_Z} flex items-end justify-center px-4 sm:items-center sm:p-4`}
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/72 backdrop-blur-sm"
        aria-label={t('affiliateModal.close')}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex w-full max-w-[min(720px,100%)] flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#131116] shadow-[0_32px_64px_rgba(0,0,0,0.6)] max-sm:mb-[calc(var(--casino-mobile-nav-offset)+0.75rem)] max-sm:max-h-[calc(100dvh-var(--casino-mobile-nav-offset)-1.75rem)] sm:max-h-[min(90vh,880px)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-6 sm:px-6">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-white">
            {t('affiliateModal.title')}
          </h2>
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/[0.06] text-casino-muted transition hover:border-white/15 hover:bg-white/[0.04] hover:text-white"
            onClick={onClose}
            aria-label={t('affiliateModal.close')}
          >
            <IconX size={16} aria-hidden />
          </button>
        </div>

        <div
          className="scrollbar-casino-subtle mt-2 flex shrink-0 gap-0 overflow-x-auto border-b border-white/[0.06] px-6"
          role="tablist"
          aria-label={t('affiliateModal.title')}
        >
          <button
            id={tabReferId}
            type="button"
            role="tab"
            aria-selected={tab === 'refer'}
            aria-controls={referPanelId}
            className={`relative min-w-0 flex-1 whitespace-nowrap px-2 py-3 text-center text-[13px] font-semibold transition sm:px-3 sm:text-sm ${
              tab === 'refer' ? 'text-white' : 'text-casino-muted hover:text-white/85'
            }`}
            onClick={() => setTab('refer')}
          >
            {t('affiliateModal.tabRefer')}
            {tab === 'refer' ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-casino-primary" aria-hidden />
            ) : null}
          </button>
          <button
            id={tabEarningsId}
            type="button"
            role="tab"
            aria-selected={tab === 'earnings'}
            aria-controls={earningsPanelId}
            className={`relative min-w-0 flex-1 whitespace-nowrap px-2 py-3 text-center text-[13px] font-semibold transition sm:px-3 sm:text-sm ${
              tab === 'earnings' ? 'text-white' : 'text-casino-muted hover:text-white/85'
            }`}
            onClick={() => setTab('earnings')}
          >
            {t('affiliateModal.tabEarnings')}
            {tab === 'earnings' ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-casino-primary" aria-hidden />
            ) : null}
          </button>
          <button
            id={tabHistoryId}
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            aria-controls={historyPanelId}
            className={`relative min-w-0 flex-1 whitespace-nowrap px-2 py-3 text-center text-[13px] font-semibold transition sm:px-3 sm:text-sm ${
              tab === 'history' ? 'text-white' : 'text-casino-muted hover:text-white/85'
            }`}
            onClick={() => setTab('history')}
          >
            {t('affiliateHistoryModal.tabHistory')}
            {tab === 'history' ? (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-casino-primary" aria-hidden />
            ) : null}
          </button>
        </div>

        <div className="scrollbar-casino-subtle scrollbar-phone-autohide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-8 pt-5 max-sm:gap-6 sm:pb-6">
          <div
            id={referPanelId}
            role="tabpanel"
            aria-labelledby={tabReferId}
            hidden={tab !== 'refer'}
            className={tab !== 'refer' ? 'hidden' : 'flex flex-col gap-5'}
          >
            <div className="flex min-h-[200px] flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-r from-casino-surface via-casino-surface to-casino-primary/[0.12] sm:min-h-[240px] sm:flex-row">
              <div className="flex flex-1 flex-col justify-center px-5 py-6 sm:px-8 sm:py-8">
                <h3 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                  {t('affiliateModal.heroTitle')}
                </h3>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-white/72">
                  {t('affiliateModal.heroBody')}
                </p>
              </div>
              <div className="flex min-h-[140px] items-center justify-center border-t border-white/[0.05] bg-black/25 px-6 py-8 sm:w-[200px] sm:min-h-0 sm:border-l sm:border-t-0 sm:py-6 md:w-[240px]">
                <div className="flex h-28 w-28 items-center justify-center rounded-full bg-casino-primary/12 ring-2 ring-casino-primary/35 sm:h-32 sm:w-32">
                  <IconUsers size={52} className="text-casino-primary/90" aria-hidden />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="text-sm font-medium text-white/90">{t('affiliateModal.shareLabel')}</div>
              {!isAuthenticated ? (
                <p className="text-sm text-casino-muted">{t('affiliateModal.signInHint')}</p>
              ) : !referralUrl ? (
                <p className="text-sm text-casino-muted">{t('affiliateModal.codePending')}</p>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                  <div className="flex min-h-[48px] min-w-0 flex-1 items-center rounded-lg border border-white/[0.08] bg-[#1c1a22] px-3 sm:px-4">
                    <span className="truncate font-mono text-sm text-casino-muted">{referralUrl}</span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-casino-primary to-casino-primary/85 px-6 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:brightness-110 sm:h-auto"
                    onClick={() => void copyUrl()}
                  >
                    <IconCopy size={18} aria-hidden />
                    {t('affiliateModal.copyCta')}
                  </button>
                </div>
              )}
              {!isAuthenticated ? (
                <button
                  type="button"
                  className="mt-1 w-full rounded-lg bg-casino-primary py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:brightness-110 sm:w-auto sm:px-8"
                  onClick={() => {
                    onClose()
                    openAuth('login')
                  }}
                >
                  {t('affiliateModal.signInCta')}
                </button>
              ) : null}
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-[#1a1820] px-5 py-4 sm:px-5 sm:py-5">
              <h3 className="text-sm font-semibold text-white">{t('affiliateModal.becomePartnerTitle')}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-casino-muted">
                {t('affiliateModal.becomePartnerBody')}
              </p>
              <a
                href={partnerHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-casino-primary to-casino-primary/85 px-5 py-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:brightness-110 sm:w-auto"
              >
                {t('affiliateModal.becomePartnerCta')}
                <IconExternalLink size={16} aria-hidden className="opacity-90" />
              </a>
            </div>
          </div>

          <div
            id={earningsPanelId}
            role="tabpanel"
            aria-labelledby={tabEarningsId}
            hidden={tab !== 'earnings'}
            className={tab !== 'earnings' ? 'hidden' : 'flex flex-col gap-5'}
          >
            {!isAuthenticated ? (
              <p className="text-sm text-casino-muted">{t('affiliateModal.earningsSignInHint')}</p>
            ) : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-4">
                <div className={`${panelCls} flex flex-row items-center justify-between gap-4`}>
                  <div className="min-w-0">
                    <div className={panelHeaderCls}>{t('affiliateModal.availableCredit')}</div>
                    <div className="mt-2 text-2xl font-bold tabular-nums text-white">
                      {formatUsdAmount(availableCredit, i18n.language)}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!isAuthenticated || claimBusy || availableCredit <= 0}
                    className="shrink-0 rounded-md bg-gradient-to-r from-casino-primary to-casino-primary/85 px-6 py-2.5 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void claimAffiliate()}
                  >
                    {claimBusy ? '…' : t('affiliateModal.claim')}
                  </button>
                </div>
                <div className={panelCls}>
                  <div className={panelHeaderCls}>{t('affiliateModal.lifetimeEarnings')}</div>
                  <div className="mt-2 text-2xl font-bold tabular-nums text-white">
                    {formatUsdAmount(lifetimeEarnings, i18n.language)}
                  </div>
                </div>
              </div>

              <div className={`${panelCls} flex min-h-[220px] flex-col`}>
                <div className={panelHeaderCls}>{t('affiliateModal.commissionTier')}</div>
                <div className="mt-1 text-xl font-bold text-white">{tierTitle}</div>
                <div className="mt-auto pt-6">
                  <div className={`${panelHeaderCls} mb-3`}>{t('affiliateModal.tierProgressLabel')}</div>
                  <div
                    className="mb-3 h-1 w-full overflow-hidden rounded-sm bg-[#1c1a22]"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={tierProgressPct}
                  >
                    <div
                      className="h-full rounded-sm bg-casino-primary"
                      style={{ width: `${tierProgressPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-casino-muted">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-white">{tierTitle}</span>
                      <span>{currentNgrPct.toFixed(1)}%</span>
                    </div>
                    <div className="flex flex-col gap-1 text-right">
                      <span className="font-medium text-white">{nextTierName || '—'}</span>
                      <span>{nextNgrPct != null ? `${nextNgrPct.toFixed(1)}%` : '—'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className={panelCls}>
                <div className={panelHeaderCls}>{t('affiliateModal.statReferrals')}</div>
                <div className="mt-2 text-xl font-bold tabular-nums text-white">{statReferrals}</div>
              </div>
              <div className={panelCls}>
                <div className={panelHeaderCls}>{t('affiliateModal.statDepositors')}</div>
                <div className="mt-2 text-xl font-bold tabular-nums text-white">{statDepositors}</div>
              </div>
              <div className={panelCls}>
                <div className={panelHeaderCls}>{t('affiliateModal.statDeposits')}</div>
                <div className="mt-2 text-xl font-bold tabular-nums text-white">{statDeposits}</div>
              </div>
            </div>

            <div className={`${panelCls} pb-3 pt-4`}>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[13px] font-semibold text-white">{t('affiliateModal.chartTitle')}</div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('affiliateModal.chartTitle')}>
                  {(['30d', '14d', '7d'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                        chartRange === r
                          ? 'bg-casino-primary text-white'
                          : 'bg-[#1c1a22] text-casino-muted hover:text-white/85'
                      }`}
                      onClick={() => setChartRange(r)}
                    >
                      {r === '30d'
                        ? t('affiliateModal.range30d')
                        : r === '14d'
                          ? t('affiliateModal.range14d')
                          : t('affiliateModal.range7d')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-stretch gap-3">
                <div className="flex flex-col justify-between py-1 text-right text-[11px] tabular-nums text-casino-muted">
                  <span>{formatUsdAmount(chartMaxUsd, i18n.language)}</span>
                  <span>{formatUsdAmount(chartMaxUsd * 0.5, i18n.language)}</span>
                  <span>{formatUsdAmount(0, i18n.language)}</span>
                </div>
                <div className="min-h-[160px] min-w-0 flex-1 rounded-lg border border-white/[0.06] bg-[#141218] px-2 pb-1 pt-3">
                  {chartAccrued.length === 0 ? (
                    <p className="flex h-[140px] items-center justify-center px-2 text-center text-sm text-casino-muted">
                      {t('affiliateModal.chartEmpty', { defaultValue: 'No commission in this range yet.' })}
                    </p>
                  ) : (
                    <div className="flex h-[140px] items-end gap-1">
                      {chartAccrued.map((p) => {
                        const pct =
                          p.amount_minor <= 0
                            ? 0
                            : Math.max(8, (p.amount_minor / chartMaxMinor) * 100)
                        return (
                          <div key={p.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                            <div
                              className="w-full max-w-[28px] rounded-t-sm bg-gradient-to-t from-casino-primary/25 to-casino-primary"
                              style={{ height: `${pct}%` }}
                              title={formatUsdAmount(minorToUsdAmount(p.amount_minor), i18n.language)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
              {chartAccrued.length > 0 ? (
                <div className="mt-2 flex gap-1 px-1">
                  {chartAccrued.map((p) => (
                    <div key={`lbl-${p.date}`} className="min-w-0 flex-1 text-center text-[10px] text-casino-muted">
                      <span className="block truncate">{formatChartDayLabel(p.date, i18n.language)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {hub?.referral?.description?.trim() && isAuthenticated ? (
              <p className="text-xs leading-relaxed text-casino-muted">{hub.referral.description.trim()}</p>
            ) : null}
          </div>

          <div
            id={historyPanelId}
            role="tabpanel"
            aria-labelledby={tabHistoryId}
            hidden={tab !== 'history'}
            className={tab !== 'history' ? 'hidden' : 'flex flex-col gap-5'}
          >
            {!isAuthenticated ? (
              <p className="text-sm text-casino-muted">{t('affiliateModal.earningsSignInHint')}</p>
            ) : (
              <AffiliateReferralHistoryPanel active={tab === 'history'} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ReferAndEarnModal
