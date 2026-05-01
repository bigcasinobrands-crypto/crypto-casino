import { useEffect, useId, useMemo, useState, type FC } from 'react'
import { createPortal } from 'react-dom'
import type { HubOffer, HubOfferAudience } from '../../hooks/useRewardsHub'
import { bonusDetailStringIds } from '../../lib/bonusDetailsHelpers'
import { GameThumbGrid, type GameThumbRow } from './GameThumbGrid'
import { playerBonusDisplayTitle } from '../../lib/playerBonusDisplayTitle'
import { formatOfferSubtitle } from './offerDisplayUtils'

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

function formatMinorUsd(minor: number) {
  return `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const CHANNEL_LABEL: Record<string, string> = {
  on_chain_deposit: 'On-chain deposit',
  hosted_checkout: 'Hosted checkout',
  card: 'Card checkout',
}

function channelLabel(id: string): string {
  const k = id.trim().toLowerCase()
  return CHANNEL_LABEL[k] ?? id.replace(/_/g, ' ')
}

function audienceLines(aud: HubOfferAudience | undefined): string[] {
  if (!aud) return []
  const lines: string[] = []
  if (aud.invitation_or_target_list) {
    lines.push('This offer is for players on an invitation or uploaded target list (or requires explicit targeting).')
  }
  if (aud.first_deposit_only) {
    lines.push('First qualifying deposit only.')
  }
  if (typeof aud.nth_deposit === 'number' && aud.nth_deposit > 0) {
    lines.push(`Applies on your ${aud.nth_deposit}${nthSuffix(aud.nth_deposit)} deposit only (not the first).`)
  }
  if (typeof aud.min_deposit_minor === 'number' && aud.min_deposit_minor > 0) {
    lines.push(`Minimum deposit: ${formatMinorUsd(aud.min_deposit_minor)}.`)
  }
  if (typeof aud.max_deposit_minor === 'number' && aud.max_deposit_minor > 0) {
    lines.push(`Maximum deposit (for match cap rules): ${formatMinorUsd(aud.max_deposit_minor)}.`)
  }
  if (aud.deposit_channels && aud.deposit_channels.length > 0) {
    lines.push(`Deposit channels: ${aud.deposit_channels.map(channelLabel).join(', ')}.`)
  }
  if (typeof aud.vip_min_tier === 'number' && aud.vip_min_tier > 0) {
    lines.push(`VIP: requires tier rank at least ${aud.vip_min_tier} (internal sort order — higher tiers qualify).`)
  }
  if (aud.country_allow && aud.country_allow.length > 0) {
    lines.push(`Available only in: ${aud.country_allow.map((c) => c.toUpperCase()).join(', ')}.`)
  }
  if (aud.country_deny && aud.country_deny.length > 0) {
    lines.push(`Not available in: ${aud.country_deny.map((c) => c.toUpperCase()).join(', ')}.`)
  }
  if (aud.tags && aud.tags.length > 0) {
    lines.push(`Audience tags: ${aud.tags.join(', ')}.`)
  }
  return lines
}

function nthSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

export const BonusOfferInfoModal: FC<{
  open: boolean
  offer: HubOffer
  onClose: () => void
  apiFetch: ApiFetch
}> = ({ open, offer, onClose, apiFetch }) => {
  const titleId = useId()
  const details = offer.offer_details
  const [gamesById, setGamesById] = useState<Map<string, GameThumbRow>>(new Map())

  const allowed = useMemo(() => bonusDetailStringIds(details?.allowed_game_ids), [details?.allowed_game_ids])
  const excluded = useMemo(() => bonusDetailStringIds(details?.excluded_game_ids), [details?.excluded_game_ids])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const ids = [...new Set([...allowed, ...excluded])].slice(0, 48)
    if (ids.length === 0) {
      setGamesById(new Map())
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch(`/v1/games?ids=${encodeURIComponent(ids.join(','))}&bonus_refs=1`)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { games?: GameThumbRow[] }
        const list = Array.isArray(j.games) ? j.games : []
        const m = new Map<string, GameThumbRow>()
        for (const g of list) {
          if (g?.id) m.set(g.id, g)
        }
        if (!cancelled) setGamesById(m)
      } catch {
        if (!cancelled) setGamesById(new Map())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, apiFetch, allowed, excluded])

  if (!open || typeof document === 'undefined') return null

  const subtitle = formatOfferSubtitle(offer.valid_to, offer.schedule_summary)
  const desc =
    offer.description?.trim() ||
    (offer.kind === 'redeem_code'
      ? 'Redeem this code under Profile → Promo Code. Staff configure this offer in the Bonus Hub.'
      : 'This offer is applied on a qualifying deposit when you meet Bonus Hub rules. Only one main bonus can be active at a time; finish or forfeit an active bonus before another deposit offer can credit. VIP tier perks from your tier may run alongside your main bonus.')

  const audLines = audienceLines(details?.audience)
  const wm = details?.wagering_multiplier
  const mb = details?.max_bet_minor
  const gwp = details?.game_weight_pct
  const wp = details?.withdraw_policy?.trim()
  const dialogTitle = playerBonusDisplayTitle({
    title: offer.title,
    description: offer.description,
    promotionVersionId: offer.promotion_version_id,
    bonusType: offer.bonus_type,
  })

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-md"
        aria-label="Close details"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col rounded-t-2xl border border-white/[0.12] bg-casino-card shadow-2xl sm:max-h-[85vh] sm:rounded-2xl"
      >
        <div className="shrink-0 border-b border-white/[0.08] px-4 py-3 sm:px-5">
          <h2 id={titleId} className="m-0 text-base font-extrabold text-casino-foreground">
            {dialogTitle}
          </h2>
          <p className="m-0 mt-1 text-[11px] text-casino-muted">{subtitle}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth px-4 py-4 sm:px-5 scrollbar-casino">
          <p className="m-0 text-[12px] leading-relaxed text-casino-muted">{desc}</p>

          <div className="mt-4 rounded-casino-md border border-white/[0.06] bg-casino-elevated/40 px-3 py-2.5">
            <h3 className="m-0 text-[10px] font-extrabold uppercase tracking-wide text-casino-muted">
              Wagering &amp; rules
            </h3>
            <div className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-casino-muted">
              {typeof wm === 'number' && wm > 0 ? (
                <p className="m-0">
                  <span className="font-bold text-casino-foreground">Wagering multiplier:</span> {wm}× — bonus funds must be
                  wagered this many times on eligible games (see below).
                </p>
              ) : (
                <p className="m-0 text-casino-muted/90">Wagering multiplier: see offer terms or contact support.</p>
              )}
              {typeof mb === 'number' && mb > 0 ? (
                <p className="m-0">
                  <span className="font-bold text-casino-foreground">Max bet while wagering:</span> {formatMinorUsd(mb)}{' '}
                  per bet.
                </p>
              ) : null}
              {typeof gwp === 'number' && gwp > 0 && gwp !== 100 ? (
                <p className="m-0">
                  <span className="font-bold text-casino-foreground">Stake weight:</span> {gwp}% of eligible play counts
                  toward wagering before category rules.
                </p>
              ) : null}
              {wp ? (
                <p className="m-0">
                  <span className="font-bold text-casino-foreground">Withdrawals:</span>{' '}
                  {wp === 'block' ? 'May be blocked until wagering is completed.' : wp}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 rounded-casino-md border border-white/[0.06] bg-casino-elevated/40 px-3 py-2.5">
            <h3 className="m-0 text-[10px] font-extrabold uppercase tracking-wide text-casino-muted">Who can get this</h3>
            {audLines.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-casino-muted">
                {audLines.map((line, i) => (
                  <li key={i} className="marker:text-casino-primary">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-2 text-[11px] text-casino-muted">
                General offer — no extra country, VIP, or deposit-number restrictions are exposed for this version. You
                already qualify if this card appears in your list.
              </p>
            )}
          </div>

          {allowed.length > 0 ? (
            <p className="m-0 mt-3 text-[11px] leading-relaxed text-casino-primary">
              <strong className="text-casino-foreground">Wagering games:</strong> only the titles below count toward this
              offer&apos;s wagering bar.
            </p>
          ) : excluded.length > 0 ? (
            <p className="m-0 mt-3 text-[11px] leading-relaxed text-amber-200/90">
              <strong className="text-casino-foreground">Excluded games:</strong> these titles do not count toward
              wagering for this offer.
            </p>
          ) : (
            <p className="m-0 mt-3 text-[11px] text-casino-muted">
              No specific allowed or excluded game list is set for this version — eligible catalog games follow site
              contribution rules unless staff add exclusions.
            </p>
          )}

          <GameThumbGrid title="Counts toward wagering" ids={allowed} gamesById={gamesById} variant="allowed" />
          <GameThumbGrid title="Excluded from wagering" ids={excluded} gamesById={gamesById} variant="excluded" />
        </div>
        <div className="shrink-0 border-t border-white/[0.08] px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-casino-md bg-casino-primary/90 py-2.5 text-sm font-extrabold text-white shadow-sm transition hover:brightness-110"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
