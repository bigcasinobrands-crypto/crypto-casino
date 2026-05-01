import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { readApiError } from '../../api/errors'
import type { HubOffer } from '../../hooks/useRewardsHub'
import { usePlayerAuth } from '../../playerAuth'
import { toastPlayerApiError, toastPlayerNetworkError } from '../../notifications/playerToast'
import { IconGift, IconInfo } from '../icons'
import { BonusOfferInfoModal } from './BonusOfferInfoModal'
import { playerBonusDisplayTitle } from '../../lib/playerBonusDisplayTitle'
import { bonusHeroImageSrc, formatOfferSubtitle } from './offerDisplayUtils'

export { bonusHeroImageSrc, formatOfferSubtitle } from './offerDisplayUtils'

type ClaimOfferResponse = {
  mode?: string
  bonus_instance_id?: string
}

export function AvailableBonusOfferCard({
  offer,
  onHubUpdated,
}: {
  offer: HubOffer
  /** Refetch hub / lobby after activation; pass the claimed offer for optimistic Active row. */
  onHubUpdated?: (offer: HubOffer) => void | Promise<void>
}) {
  const [infoOpen, setInfoOpen] = useState(false)
  const [claimBusy, setClaimBusy] = useState(false)
  const { apiFetch, refreshProfile } = usePlayerAuth()
  const subtitle = formatOfferSubtitle(offer.valid_to, offer.schedule_summary)
  const isCode = offer.kind === 'redeem_code'
  const code = offer.promo_code?.trim()
  const heroSrc = bonusHeroImageSrc(offer.hero_image_url)
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => {
    setImgFailed(false)
  }, [offer.promotion_version_id, offer.hero_image_url])
  const showHero = Boolean(heroSrc) && !imgFailed

  const codeEntryHref = isCode
    ? `/profile?settings=promo${code ? `&prefill_code=${encodeURIComponent(code)}` : ''}`
    : '/bonuses'

  const heading = playerBonusDisplayTitle({
    title: offer.title,
    description: offer.description,
    promotionVersionId: offer.promotion_version_id,
    bonusType: offer.bonus_type,
  })

  /** API without /bonuses/claim-offer: only deposit-intent exists — still activates selection, no wallet. */
  async function legacyIntentOnly() {
    const res = await apiFetch('/v1/bonuses/deposit-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promotion_version_id: offer.promotion_version_id }),
    })
    if (!res.ok) {
      const apiErr = await readApiError(res)
      const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
      toastPlayerApiError(apiErr, res.status, 'POST /v1/bonuses/deposit-intent', rid)
      return
    }
    toast.success('Promotion activated', { description: 'It will appear under Active bonuses.' })
    void refreshProfile()
    try {
      await onHubUpdated?.(offer)
    } catch {
      toastPlayerNetworkError('Could not refresh bonuses.', 'rewards hub')
    }
  }

  async function handleClaimOffer() {
    if (isCode) return
    setClaimBusy(true)
    try {
      const res = await apiFetch('/v1/bonuses/claim-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promotion_version_id: offer.promotion_version_id }),
      })
      if (!res.ok) {
        if (res.status === 404) {
          await legacyIntentOnly()
          return
        }
        const apiErr = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(apiErr, res.status, 'POST /v1/bonuses/claim-offer', rid)
        return
      }
      const j = (await res.json()) as ClaimOfferResponse
      const mode = j.mode
      if (mode === 'granted') {
        toast.success('Bonus activated', { description: 'It’s under Active bonuses with your balance.' })
        void refreshProfile()
        try {
          await onHubUpdated?.(offer)
        } catch {
          toastPlayerNetworkError('Could not refresh bonuses.', 'rewards hub')
        }
        return
      }
      if (mode === 'activated' || mode === 'deposit_intent') {
        toast.success('Promotion activated', { description: 'It’s under Active bonuses.' })
        void refreshProfile()
        try {
          await onHubUpdated?.(offer)
        } catch {
          toastPlayerNetworkError('Could not refresh bonuses.', 'rewards hub')
        }
        return
      }
      toast.error('Unexpected response', { description: 'Could not finish activation.' })
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/bonuses/claim-offer')
    } finally {
      setClaimBusy(false)
    }
  }

  return (
    <li className="flex h-full flex-col overflow-hidden rounded-casino-lg border border-white/[0.08] bg-casino-card shadow-md shadow-black/15">
      <div className="relative h-[100px] shrink-0 overflow-hidden bg-gradient-to-b from-casino-primary/30 via-casino-primary/10 to-casino-card">
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
          {showHero ? null : <IconGift size={44} className="text-casino-primary/45" aria-hidden />}
        </div>
        {offer.hub_boost ? (
          <span className="absolute left-2 top-2 z-[1] rounded-casino-sm bg-casino-primary/35 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
            Featured
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-3.5">
        <div className="min-h-0 flex-1">
          <h3 className="m-0 line-clamp-2 text-sm font-extrabold leading-tight text-casino-foreground">{heading}</h3>
          <p className="mt-1 text-[11px] text-casino-muted">{subtitle}</p>
          {isCode && code ? (
            <p className="mt-1.5 font-mono text-[10px] font-bold tracking-wide text-casino-foreground">
              Code: <span className="text-casino-primary">{code}</span>
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          className="flex w-fit items-center gap-1 text-[11px] font-bold text-casino-muted transition hover:text-casino-primary"
        >
          <IconInfo size={13} aria-hidden />
          More info
        </button>

        {isCode ? (
          <Link
            to={codeEntryHref}
            className="mt-auto block w-full rounded-casino-md bg-gradient-to-b from-casino-primary to-casino-primary/80 py-2 text-center text-xs font-extrabold text-white shadow-sm shadow-casino-primary/20 transition hover:brightness-110"
          >
            Get bonus
          </Link>
        ) : (
          <button
            type="button"
            disabled={claimBusy}
            onClick={() => void handleClaimOffer()}
            className="mt-auto block w-full rounded-casino-md bg-gradient-to-b from-casino-primary to-casino-primary/80 py-2 text-center text-xs font-extrabold text-white shadow-sm shadow-casino-primary/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {claimBusy ? 'Please wait…' : 'Get bonus'}
          </button>
        )}
      </div>
      <BonusOfferInfoModal open={infoOpen} offer={offer} onClose={() => setInfoOpen(false)} apiFetch={apiFetch} />
    </li>
  )
}
