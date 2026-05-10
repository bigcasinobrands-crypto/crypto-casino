import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconGift, IconInfo } from '../icons'
import { readApiError } from '../../api/errors'
import { usePlayerAuth } from '../../playerAuth'
import { toastPlayerApiError, toastPlayerNetworkError } from '../../notifications/playerToast'
import type { HubBonusInstance, HubOffer, RewardsHubPayload } from '../../hooks/useRewardsHub'
import { playerBonusDisplayTitle } from '../../lib/playerBonusDisplayTitle'
import { AvailableBonusOfferCard } from './AvailableBonusOfferCard'
import { bonusHeroImageSrc } from './offerDisplayUtils'
import { BonusForfeitConfirmModal } from './BonusForfeitConfirmModal'
import { BonusInstanceDetailsPanel } from './BonusInstanceDetailsPanel'

function formatMinorUsd(minor: number | undefined, lng: string) {
  const n = Number(minor)
  const safe = Number.isFinite(n) ? n : 0
  const loc = lng === 'fr-CA' ? 'fr-CA' : 'en-US'
  return new Intl.NumberFormat(loc, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe / 100)
}

/** Until GET /v1/rewards/hub includes the new row, keep the offer visible under Active. */
function syntheticFromStagedOffer(offer: HubOffer): HubBonusInstance {
  return {
    id: `client-pending-${offer.promotion_version_id}`,
    promotion_version_id: offer.promotion_version_id,
    status: 'awaiting_deposit',
    granted_amount_minor: 0,
    currency: 'USDT',
    wr_required_minor: 0,
    wr_contributed_minor: 0,
    title: offer.title,
    description: offer.description,
    bonus_type: offer.bonus_type,
    created_at: new Date().toISOString(),
    hero_image_url: offer.hero_image_url,
  }
}

export type MyBonusesLayoutProps = {
  /** From operational health — new claims / deposit-intent disabled */
  bonusesEnabled?: boolean
  data: RewardsHubPayload | null
  loading: boolean
  err: string | null
  onRetry?: () => void
  /** After forfeit or canceling deposit intent; optional promotion id for clearing optimistic UI. */
  onBonusForfeited?: (promotionVersionId?: number) => void
  /**
   * Called after claim-offer or deposit-intent succeeds; pass the same offer you claimed so the UI
   * can show it under Active if the next hub response is still missing the row.
   */
  onHubUpdated?: (offer: HubOffer) => void | Promise<void>
  /** Merged with hub `bonus_instances` so Active never looks empty when eligibility hid the offer first. */
  stagedAfterClaim?: HubOffer | null
  subNav?: ReactNode
}

export function MyBonusesLayout({
  bonusesEnabled = true,
  data,
  loading,
  err,
  onRetry,
  onBonusForfeited,
  onHubUpdated,
  stagedAfterClaim,
  subNav,
}: MyBonusesLayoutProps) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const fmtUsd = useCallback((minor: number | undefined) => formatMinorUsd(minor, lng), [lng])

  const offers = useMemo(() => {
    const raw = data?.available_offers ?? []
    if (!stagedAfterClaim) return raw
    return raw.filter((o) => o.promotion_version_id !== stagedAfterClaim.promotion_version_id)
  }, [data?.available_offers, stagedAfterClaim])
  const rawInstances = useMemo(() => data?.bonus_instances ?? [], [data?.bonus_instances])
  const instances = useMemo(() => {
    if (!stagedAfterClaim) return rawInstances
    const has = rawInstances.some((b) => b.promotion_version_id === stagedAfterClaim.promotion_version_id)
    if (has) return rawInstances
    return [...rawInstances, syntheticFromStagedOffer(stagedAfterClaim)]
  }, [rawInstances, stagedAfterClaim])
  const aggregates = data?.aggregates

  const activeInstances = useMemo(
    () =>
      instances.filter((b) => {
        const s = (b?.status ?? '').toLowerCase()
        return ['active', 'pending', 'pending_review', 'awaiting_deposit'].includes(s)
      }),
    [instances],
  )

  /** Do not replace Active with skeletons while a staged card should stay visible during hub refetch. */
  const showActiveLoadingPlaceholders = loading && !stagedAfterClaim

  const cardGrid =
    'm-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4'

  return (
    <div className="min-w-0 w-full max-w-none px-3 py-6 sm:px-5 sm:py-8 lg:px-8 xl:px-10 2xl:px-12">
      {/* Hero banner */}
      <div className="relative mb-6 overflow-hidden rounded-casino-lg border border-white/[0.08] bg-gradient-to-br from-casino-elevated via-casino-card to-casino-elevated px-4 py-5 sm:mb-8 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 5 L35 25 L55 30 L35 35 L30 55 L25 35 L5 30 L25 25 Z' fill='none' stroke='%23fff' stroke-width='0.5'/%3E%3C/svg%3E")`,
            backgroundSize: '48px 48px',
          }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-casino-md bg-casino-primary/20 text-casino-primary ring-1 ring-casino-primary/35">
              <IconGift size={26} aria-hidden />
            </span>
            <div>
              <h1 className="m-0 text-xl font-black uppercase tracking-wide text-casino-foreground sm:text-2xl">
                {t('bonuses.pageTitle')}
              </h1>
              <p className="mt-1 text-sm text-casino-muted">{t('bonuses.pageSubtitle')}</p>
            </div>
          </div>
          <div className="hidden text-casino-primary/25 sm:block">
            <IconGift size={56} aria-hidden />
          </div>
        </div>
      </div>

      {subNav ? <div className="mb-6 text-sm">{subNav}</div> : null}

      {err ? (
        <div className="mb-6 rounded-casino-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}{' '}
          {onRetry ? (
            <button type="button" className="ml-2 underline" onClick={() => void onRetry()}>
              {t('bonuses.retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      {!err && !bonusesEnabled ? (
        <div className="mb-6 rounded-casino-lg border border-amber-500/35 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {t('operational.bonusesUnavailable')}
        </div>
      ) : null}

      {/* Balances — GET /v1/rewards/hub `aggregates` = current in-progress instance (non-exempt / primary first) */}
      {!err && (loading || data) ? (
        <div className="mb-6 min-w-0 sm:mb-8">
          <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3 md:gap-3">
          <div className="min-w-0 overflow-hidden rounded-casino-md border border-white/[0.06] bg-casino-card px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-casino-muted">{t('bonuses.wageringLeft')}</div>
            {loading && !data ? (
              <div className="mt-1.5 h-5 w-24 max-w-full animate-pulse rounded bg-white/[0.08]" aria-hidden />
            ) : (
              <div className="text-sm font-extrabold text-casino-foreground">
                {fmtUsd(aggregates?.wagering_remaining_minor ?? 0)}
              </div>
            )}
          </div>
          <div className="min-w-0 rounded-casino-md border border-white/[0.06] bg-casino-card px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-casino-muted">{t('bonuses.lockedBonus')}</div>
            {loading && !data ? (
              <div className="mt-1.5 h-5 w-24 max-w-full animate-pulse rounded bg-white/[0.08]" aria-hidden />
            ) : (
              <div className="text-sm font-extrabold text-casino-foreground">
                {fmtUsd(aggregates?.bonus_locked_minor ?? 0)}
              </div>
            )}
          </div>
          <div className="min-w-0 rounded-casino-md border border-white/[0.06] bg-casino-card px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-casino-muted">{t('bonuses.lifetimePromo')}</div>
            {loading && !data ? (
              <div className="mt-1.5 h-5 w-24 max-w-full animate-pulse rounded bg-white/[0.08]" aria-hidden />
            ) : (
              <div className="text-sm font-extrabold text-casino-foreground">
                {fmtUsd(aggregates?.lifetime_promo_minor ?? 0)}
              </div>
            )}
          </div>
          </div>
        </div>
      ) : null}

      {/* —— Active —— */}
      <section className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 text-base font-extrabold text-casino-foreground">
          <IconGift size={20} className="text-casino-success" aria-hidden />
          {t('bonuses.activeSection')}
        </h2>

        {showActiveLoadingPlaceholders ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-[240px] animate-pulse rounded-casino-lg bg-white/[0.06]" />
            ))}
          </div>
        ) : activeInstances.length === 0 ? (
          <p className="rounded-casino-lg border border-white/[0.06] bg-casino-card px-4 py-6 text-center text-sm text-casino-muted">
            {t('bonuses.activeEmpty')}
          </p>
        ) : (
          <ul className={cardGrid}>
            {activeInstances.map((b: HubBonusInstance) => (
              <ActiveBonusCard key={b.id} bonus={b} formatUsd={fmtUsd} onForfeited={onBonusForfeited} />
            ))}
          </ul>
        )}
      </section>

      {/* —— Available —— */}
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-base font-extrabold text-casino-foreground">
          <IconGift size={20} className="text-casino-primary" aria-hidden />
          {t('bonuses.availableSection')}
        </h2>

        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[220px] animate-pulse rounded-casino-lg bg-white/[0.06]" />
            ))}
          </div>
        ) : offers.length === 0 ? (
          <p className="rounded-casino-lg border border-white/[0.06] bg-casino-card px-4 py-6 text-center text-sm text-casino-muted">
            {t('bonuses.availableEmpty')}
          </p>
        ) : (
          <ul className={cardGrid}>
            {offers.map((o: HubOffer) => (
              <AvailableBonusOfferCard
                key={o.promotion_version_id}
                offer={o}
                onHubUpdated={onHubUpdated}
                claimsDisabled={!bonusesEnabled}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ActiveBonusCard({
  bonus,
  formatUsd,
  onForfeited,
}: {
  bonus: HubBonusInstance
  formatUsd: (minor: number | undefined) => string
  onForfeited?: (promotionVersionId?: number) => void
}) {
  const { t } = useTranslation()
  const { apiFetch, refreshProfile } = usePlayerAuth()
  const [infoOpen, setInfoOpen] = useState(false)
  const [forfeitOpen, setForfeitOpen] = useState(false)
  const [forfeitBusy, setForfeitBusy] = useState(false)
  const heroSrc = bonusHeroImageSrc(bonus.hero_image_url)
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => {
    setImgFailed(false)
  }, [bonus.id, bonus.hero_image_url])
  const showHero = Boolean(heroSrc) && !imgFailed
  const wrReq = bonus.wr_required_minor
  const wrDone = bonus.wr_contributed_minor
  const wrPct = wrReq > 0 ? Math.min(100, Math.round((100 * wrDone) / wrReq)) : 0
  const st = (bonus.status ?? '').toLowerCase()
  const statusLabel = (bonus.status ?? 'unknown').replace(/_/g, ' ')
  const isAwaitingDeposit =
    st === 'awaiting_deposit' ||
    String(bonus.id).startsWith('promo-intent-') ||
    String(bonus.id).startsWith('client-pending-')

  const runForfeit = useCallback(async () => {
    setForfeitBusy(true)
    try {
      if (isAwaitingDeposit) {
        const res = await apiFetch('/v1/bonuses/cancel-deposit-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (!res.ok) {
          const apiErr = await readApiError(res)
          const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
          toastPlayerApiError(apiErr, res.status, 'POST /v1/bonuses/cancel-deposit-intent', rid)
          return
        }
        setForfeitOpen(false)
        void refreshProfile()
        onForfeited?.(bonus.promotion_version_id)
        return
      }
      const res = await apiFetch(`/v1/wallet/bonuses/${encodeURIComponent(bonus.id)}/forfeit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        const apiErr = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(apiErr, res.status, 'POST /v1/wallet/bonuses/forfeit', rid)
        return
      }
      setForfeitOpen(false)
      void refreshProfile()
      onForfeited?.(bonus.promotion_version_id)
    } catch {
      toastPlayerNetworkError('Network error.', 'forfeit or cancel offer')
    } finally {
      setForfeitBusy(false)
    }
  }, [apiFetch, bonus.id, bonus.promotion_version_id, isAwaitingDeposit, onForfeited, refreshProfile])

  return (
    <li className="flex h-full flex-col overflow-hidden rounded-casino-lg border border-casino-success/25 bg-casino-card shadow-md shadow-black/15 ring-1 ring-casino-success/15">
      <div className="relative h-[100px] shrink-0 overflow-hidden bg-gradient-to-b from-casino-success/20 via-casino-primary/10 to-casino-card">
        {showHero ? (
          <img
            src={heroSrc}
            alt=""
            className="absolute inset-0 z-0 size-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : null}
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
          {showHero ? null : <IconGift size={44} className="text-casino-success/50" aria-hidden />}
        </div>
        <span className="absolute right-2 top-2 rounded-casino-sm bg-casino-success/25 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-casino-success">
          {isAwaitingDeposit ? t('bonuses.statusActivated') : t('bonuses.statusActive')}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-3.5">
        <div>
          <h3 className="m-0 line-clamp-2 text-sm font-extrabold leading-tight text-casino-foreground">
            {bonus.title?.trim() || `Bonus #${bonus.promotion_version_id}`}
          </h3>
          <p className="mt-1 text-[11px] capitalize text-casino-muted">{statusLabel}</p>
          {bonus.description?.trim() ? (
            <p className="mt-1 text-[11px] leading-relaxed text-casino-muted">{bonus.description.trim()}</p>
          ) : null}
          {isAwaitingDeposit ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-casino-muted">{t('bonuses.awaitingDepositHint')}</p>
          ) : (
            <p className="mt-1 text-[11px] text-casino-muted">
              {t('bonuses.grantedLabel')}{' '}
              <span className="font-semibold text-casino-foreground">{formatUsd(bonus.granted_amount_minor)}</span>
            </p>
          )}
        </div>

        {isAwaitingDeposit ? null : (
          <div>
            <div className="mb-1 flex justify-between gap-2 text-[10px] font-bold text-casino-muted">
              <span>{t('bonuses.wageringLabel')}</span>
              <span className="text-casino-foreground">
                {formatUsd(wrDone)} / {formatUsd(wrReq)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-casino-success/80 to-casino-success transition-all"
                style={{ width: `${wrPct}%` }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setInfoOpen((v) => !v)}
          className="flex w-fit items-center gap-1 text-[11px] font-bold text-casino-muted transition hover:text-casino-primary"
        >
          <IconInfo size={13} aria-hidden />
          {t('bonuses.moreInfo')}
        </button>
        <BonusInstanceDetailsPanel details={bonus.details} infoOpen={infoOpen} apiFetch={apiFetch} />

        <div className="mt-auto flex flex-col gap-2">
          <span className="block w-full rounded-casino-md border border-casino-success/40 bg-casino-success/10 py-2 text-center text-xs font-extrabold text-casino-success">
            {isAwaitingDeposit ? t('bonuses.statusActivated') : t('bonuses.inProgress')}
          </span>
          <button
            type="button"
            onClick={() => setForfeitOpen(true)}
            className="block w-full rounded-casino-md border border-red-500/35 py-2 text-center text-xs font-extrabold text-red-300 transition hover:bg-red-500/10"
          >
            {isAwaitingDeposit ? t('bonuses.forfeitCancelOffer') : t('bonuses.forfeitBonus')}
          </button>
        </div>
      </div>

      <BonusForfeitConfirmModal
        open={forfeitOpen}
        bonusTitle={playerBonusDisplayTitle(
          {
            title: bonus.title,
            description: bonus.description,
            promotionVersionId: bonus.promotion_version_id,
            bonusType: bonus.bonus_type,
          },
          `Bonus #${bonus.promotion_version_id}`,
        )}
        variant={isAwaitingDeposit ? 'deposit_intent' : 'instance'}
        onCancel={() => setForfeitOpen(false)}
        onConfirm={() => void runForfeit()}
        busy={forfeitBusy}
      />
    </li>
  )
}
