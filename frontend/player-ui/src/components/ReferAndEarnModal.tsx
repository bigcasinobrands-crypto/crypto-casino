import { useEffect, useId, useMemo, useState, type FC } from 'react'
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

/** Design baseline until earnings API exists. */
const DEFAULT_TIER_PROGRESS_PCT = 15
const CHART_Y_TICKS = [1, 0.8, 0.6, 0.4, 0.2, 0] as const

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

function formatChartTick(n: number, lng: string): string {
  const locale = lng === 'fr-CA' ? 'fr-CA' : 'en-US'
  return n.toLocaleString(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
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
  const { isAuthenticated, me } = usePlayerAuth()
  const { data: hub, reload } = useRewardsHub()
  const [tab, setTab] = useState<TabId>('refer')
  const [chartRange, setChartRange] = useState<ChartRange>('7d')

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

  const refSlug = useMemo(() => {
    const code = hub?.referral?.link_code?.trim()
    if (code) return code
    const un = me?.username?.trim()
    if (un) return un
    return ''
  }, [hub?.referral?.link_code, me?.username])

  const referralUrl = refSlug ? buildRefUrl(refSlug) : ''

  const stages = hub?.referral?.stages
  const statReferrals = useMemo(() => pickStageCount(stages, ['referrals', 'referral', 'signups', 'signup']), [stages])
  const statDepositors = useMemo(() => pickStageCount(stages, ['depositors', 'ftd', 'first_deposit']), [stages])
  const statDeposits = useMemo(
    () => pickStageCount(stages, ['deposits', 'deposit_count', 'total_deposits']),
    [stages],
  )

  const availableCredit = 0
  const lifetimeEarnings = 0

  const copyUrl = async () => {
    if (!referralUrl) return
    try {
      await navigator.clipboard.writeText(referralUrl)
      toast.success(t('affiliateModal.copySuccess'))
    } catch {
      toast.error(t('affiliateModal.copyFail'))
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
                    className="shrink-0 rounded-md bg-gradient-to-r from-casino-primary to-casino-primary/85 px-6 py-2.5 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => toast.message(t('affiliateModal.claimSoon'))}
                  >
                    {t('affiliateModal.claim')}
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
                <div className="mt-1 text-xl font-bold text-white">{t('affiliateModal.tierLabel', { n: 1 })}</div>
                <div className="mt-auto pt-6">
                  <div className={`${panelHeaderCls} mb-3`}>{t('affiliateModal.tierProgressLabel')}</div>
                  <div className="mb-3 h-1 w-full overflow-hidden rounded-sm bg-[#1c1a22]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={DEFAULT_TIER_PROGRESS_PCT}>
                    <div
                      className="h-full rounded-sm bg-casino-primary"
                      style={{ width: `${DEFAULT_TIER_PROGRESS_PCT}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-casino-muted">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-white">{t('affiliateModal.tierLabel', { n: 1 })}</span>
                      <span>5%</span>
                    </div>
                    <div className="flex flex-col gap-1 text-right">
                      <span className="font-medium text-white">{t('affiliateModal.tierLabel', { n: 2 })}</span>
                      <span>5.5%</span>
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
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
              <div className="flex flex-col gap-6">
                {CHART_Y_TICKS.map((tick) => (
                  <div key={tick} className="flex items-center gap-4">
                    <div
                      className="h-px min-w-0 flex-1 border-t border-dashed border-white/10"
                      aria-hidden
                    />
                    <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-casino-muted">
                      {formatChartTick(tick, i18n.language)}
                    </span>
                  </div>
                ))}
              </div>
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
