import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuthModal } from '../../authModalContext'
import { readApiError } from '../../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../../notifications/playerToast'
import { usePlayerAuth } from '../../playerAuth'
import { PLAYER_MODAL_OVERLAY_Z } from '../../lib/playerChromeLayers'
import type { VipProgramTier } from '../../lib/vipPresentation'
import { PrizeRailLogoMark } from './PayoutChainLogoMark'
import type { PlayerChallengeListItem } from './playerChallengeTypes'
import {
  canJoinChallengeInUi,
  ChallengeThumbBadgeStack,
  firstCatalogGameId,
  formatChallengeEndAt,
  formatEndsCountdown,
  formatPayoutRail,
  formatStartsInCountdown,
  formatUsdMinor,
  isChallengeInPlayableWindow,
  msUntilStart,
  prizeLabel,
  shouldShowStartCountdown,
} from './challengeModalHelpers'

type ModalTab = 'overview' | 'rules' | 'terms'

type Props = {
  challengeId: string | null
  /** Row from a list (e.g. game lobby) for instant title before GET /detail completes. */
  fallbackChallenge: PlayerChallengeListItem | null
  onClose: () => void
  vipTiers: VipProgramTier[]
  onOpenLinkedGame: (c: PlayerChallengeListItem) => void
  onAfterEnter: () => void | Promise<void>
  onAfterClaim: () => void | Promise<void>
}

export function PlayerChallengeDetailModal({
  challengeId,
  fallbackChallenge,
  onClose,
  vipTiers,
  onOpenLinkedGame,
  onAfterEnter,
  onAfterClaim,
}: Props) {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const [modalDetail, setModalDetail] = useState<PlayerChallengeListItem | null>(null)
  const [modalTab, setModalTab] = useState<ModalTab>('overview')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [enterBusy, setEnterBusy] = useState(false)
  const [claimBusy, setClaimBusy] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())

  useEffect(() => {
    if (!challengeId) return
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [challengeId])

  const refreshModalDetail = useCallback(async () => {
    if (!challengeId) return
    try {
      const res = await apiFetch(`/v1/challenges/${encodeURIComponent(challengeId)}`)
      if (!res.ok) return
      const row = (await res.json()) as PlayerChallengeListItem
      setModalDetail(row)
    } catch {
      /* ignore */
    }
  }, [apiFetch, challengeId])

  useEffect(() => {
    if (!challengeId) {
      setModalDetail(null)
      setAcceptTerms(false)
      setModalTab('overview')
      return
    }
    setAcceptTerms(false)
    setModalTab('overview')
    void refreshModalDetail()
  }, [challengeId, refreshModalDetail])

  useEffect(() => {
    if (!challengeId) return
    const t = window.setInterval(() => void refreshModalDetail(), 5000)
    return () => window.clearInterval(t)
  }, [challengeId, refreshModalDetail])

  const onEnter = async () => {
    if (!challengeId) return
    if (!isAuthenticated) {
      openAuth('login')
      return
    }
    if (!acceptTerms) return
    const preEntry = modalDetail ?? (fallbackChallenge?.id === challengeId ? fallbackChallenge : null)
    if (preEntry?.my_entry) {
      toast.message('Already entered', { description: 'You are already in this challenge.' })
      onClose()
      return
    }
    setEnterBusy(true)
    try {
      const res = await apiFetch(`/v1/challenges/${encodeURIComponent(challengeId)}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept_terms: true }),
      })
      if (!res.ok) {
        const err = await readApiError(res)
        if (res.status === 409 && err?.code === 'already_entered') {
          toast.message('Already entered', { description: 'You are already in this challenge.' })
          await onAfterEnter()
          await refreshModalDetail()
          onClose()
          return
        }
        toastPlayerApiError(err, res.status, 'POST /v1/challenges/.../enter')
        return
      }
      setAcceptTerms(false)
      await onAfterEnter()
      await refreshModalDetail()
      onClose()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST enter challenge')
    } finally {
      setEnterBusy(false)
    }
  }

  const onClaim = async () => {
    if (!challengeId) return
    if (!isAuthenticated) {
      openAuth('login')
      return
    }
    setClaimBusy(true)
    try {
      const res = await apiFetch(`/v1/challenges/${encodeURIComponent(challengeId)}/claim`, { method: 'POST' })
      if (!res.ok) {
        const err = await readApiError(res)
        toastPlayerApiError(err, res.status, 'POST challenge claim')
        return
      }
      toast.success('Prize claimed', { description: 'Funds were added to your cash wallet.' })
      await onAfterClaim()
      await refreshModalDetail()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST challenge claim')
    } finally {
      setClaimBusy(false)
    }
  }

  const modalChallenge =
    modalDetail ?? (fallbackChallenge && fallbackChallenge.id === challengeId ? fallbackChallenge : null)
  const modalHeroUrl = modalChallenge?.hero_image_url?.trim() ?? ''
  const modalPrizeInfo = modalChallenge ? prizeLabel(modalChallenge) : null
  const modalShowStartCountdown =
    modalChallenge && !modalChallenge.my_entry ? shouldShowStartCountdown(modalChallenge, nowTick) : false
  const modalCanJoin =
    modalChallenge && !modalChallenge.my_entry ? canJoinChallengeInUi(modalChallenge, nowTick) : false
  const modalEndsLiveCountdown = modalChallenge ? isChallengeInPlayableWindow(modalChallenge, nowTick) : false

  const countdownListRefreshRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (countdownListRefreshRef.current != null) {
        window.clearTimeout(countdownListRefreshRef.current)
        countdownListRefreshRef.current = null
      }
    }
  }, [])

  const bumpListAfterCountdown = useCallback(() => {
    if (countdownListRefreshRef.current != null) return
    countdownListRefreshRef.current = window.setTimeout(() => {
      countdownListRefreshRef.current = null
      void onAfterEnter()
      void refreshModalDetail()
    }, 500)
  }, [onAfterEnter, refreshModalDetail])

  const modalCountdownSawFutureRef = useRef(false)
  const modalCountdownCrossedRef = useRef(false)
  useEffect(() => {
    modalCountdownSawFutureRef.current = false
    modalCountdownCrossedRef.current = false
  }, [challengeId])

  useEffect(() => {
    if (!modalChallenge || modalChallenge.my_entry) return
    const until = msUntilStart(modalChallenge, nowTick)
    if (until > 0) {
      modalCountdownSawFutureRef.current = true
      return
    }
    if (!modalCountdownSawFutureRef.current) return
    if (!canJoinChallengeInUi(modalChallenge, nowTick)) return
    if (modalCountdownCrossedRef.current) return
    modalCountdownCrossedRef.current = true
    void bumpListAfterCountdown()
  }, [
    modalChallenge?.id,
    modalChallenge?.starts_at,
    modalChallenge?.ends_at,
    modalChallenge?.my_entry,
    modalChallenge?.status,
    nowTick,
    bumpListAfterCountdown,
  ])

  if (!challengeId || !modalChallenge) return null

  return (
    <div
      className={`fixed inset-0 ${PLAYER_MODAL_OVERLAY_Z} flex items-end justify-center bg-black/60 p-4 backdrop-blur-[6px] sm:items-center`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="challenge-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-casino-md border border-white/10 bg-casino-surface shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="challenge-modal-title" className="text-base font-black leading-tight text-casino-foreground sm:text-lg">
              {modalChallenge.title}
            </h2>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {modalChallenge.challenge_type.replace(/_/g, ' ')} · {modalChallenge.status}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-casino-sm px-2.5 py-1.5 text-sm font-bold text-slate-400 hover:bg-white/10 hover:text-white"
            onClick={() => {
              onClose()
              setModalTab('overview')
              setAcceptTerms(false)
            }}
          >
            ✕
          </button>
        </div>

        <div className="flex shrink-0 gap-1 border-b border-white/10 px-4 sm:px-5">
          {(['overview', 'rules', 'terms'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`rounded-t-casino-sm px-3 py-2.5 text-[12px] font-bold capitalize transition-colors sm:px-4 ${
                modalTab === t ? 'bg-white/10 text-casino-foreground' : 'text-slate-500 hover:text-slate-300'
              }`}
              onClick={() => setModalTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 text-[13px] text-slate-300 sm:px-5 sm:pb-6">
          {modalTab === 'overview' ? (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-stretch sm:gap-8">
                <div className="mx-auto w-full max-w-[11rem] shrink-0 sm:mx-0 sm:w-[10.5rem] sm:max-w-none">
                  <button
                    type="button"
                    className={`relative aspect-[3/4] w-full overflow-hidden rounded-casino-md border border-white/[0.08] bg-black text-left shadow-lg shadow-black/40 transition-[filter] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-casino-primary focus-visible:ring-offset-2 focus-visible:ring-offset-casino-surface ${
                      firstCatalogGameId(modalChallenge.game_ids)
                        ? 'cursor-pointer hover:brightness-110'
                        : 'cursor-default hover:brightness-100'
                    }`}
                    onClick={() => onOpenLinkedGame(modalChallenge)}
                    aria-label={
                      firstCatalogGameId(modalChallenge.game_ids)
                        ? `Open game: ${modalChallenge.title}`
                        : `${modalChallenge.title} — artwork`
                    }
                  >
                    <ChallengeThumbBadgeStack challenge={modalChallenge} vipTiers={vipTiers} />
                    {modalHeroUrl ? (
                      <img
                        src={modalHeroUrl}
                        alt=""
                        className="size-full object-cover"
                        loading="eager"
                        onError={(e) => {
                          const t = e.target as HTMLImageElement
                          t.style.display = 'none'
                        }}
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-gradient-to-br from-casino-primary/15 to-transparent px-2 text-center text-[11px] font-bold leading-snug text-slate-500">
                        No artwork
                      </div>
                    )}
                  </button>
                </div>

                <div className="flex min-h-0 w-full flex-1 flex-col gap-6 sm:justify-between sm:gap-5">
                  <p className="leading-relaxed text-slate-300 sm:pt-0.5">{modalChallenge.description || '—'}</p>

                  <div className="rounded-casino-md border border-white/[0.08] bg-white/[0.02] px-4 py-4 sm:px-5 sm:py-5">
                    <p className="mb-4 text-[10px] font-extrabold uppercase tracking-wider text-slate-500">At a glance</p>
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-[12px] sm:grid-cols-2">
                      <div>
                        <dt className="text-slate-500">Prize</dt>
                        <dd className="mt-1 flex items-center gap-2 font-semibold text-casino-foreground">
                          {modalPrizeInfo?.cash ? (
                            <PrizeRailLogoMark
                              assetKey={modalChallenge.prize_payout_asset_key}
                              prizeCurrency={modalChallenge.prize_currency}
                              sizePx={14}
                            />
                          ) : null}
                          {modalPrizeInfo?.label}
                        </dd>
                      </div>
                      {formatPayoutRail(modalChallenge.prize_payout_asset_key) ? (
                        <div>
                          <dt className="text-slate-500">Payout</dt>
                          <dd className="mt-1 flex items-center gap-2 font-medium text-slate-200">
                            <PrizeRailLogoMark
                              assetKey={modalChallenge.prize_payout_asset_key}
                              prizeCurrency={modalChallenge.prize_currency}
                              sizePx={14}
                            />
                            {formatPayoutRail(modalChallenge.prize_payout_asset_key)}
                          </dd>
                        </div>
                      ) : null}
                      {typeof modalChallenge.target_multiplier === 'number' ? (
                        <div>
                          <dt className="text-slate-500">Target multiplier</dt>
                          <dd className="mt-1 font-medium text-slate-200">{modalChallenge.target_multiplier}×</dd>
                        </div>
                      ) : null}
                      {typeof modalChallenge.target_wager_amount_minor === 'number' ? (
                        <div>
                          <dt className="text-slate-500">Target wager</dt>
                          <dd className="mt-1 font-medium text-slate-200">
                            {formatUsdMinor(modalChallenge.target_wager_amount_minor)}
                          </dd>
                        </div>
                      ) : null}
                      <div className="sm:col-span-2">
                        <dt className="text-slate-500">{modalEndsLiveCountdown ? 'Ends in' : 'Ends'}</dt>
                        <dd
                          className={`mt-1 font-medium text-slate-200 ${modalEndsLiveCountdown ? 'font-mono tabular-nums' : ''}`}
                          title={new Date(modalChallenge.ends_at).toLocaleString()}
                        >
                          {modalEndsLiveCountdown
                            ? formatEndsCountdown(modalChallenge.ends_at, nowTick)
                            : formatChallengeEndAt(modalChallenge.ends_at)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>

              <div className="border-t border-white/[0.1] pt-6">
                {modalChallenge.my_entry ? (
                  <div className="rounded-casino-md border border-casino-primary/25 bg-casino-primary/10 p-4 sm:p-5">
                    <div className="text-[11px] font-bold uppercase text-casino-primary">Your entry</div>
                    <div className="mt-1.5 text-sm font-semibold text-casino-foreground">Status: {modalChallenge.my_entry.status}</div>
                    {typeof modalChallenge.my_entry.best_multiplier === 'number' ? (
                      <div className="mt-2 text-[12px] text-slate-300">
                        Best multiplier: {modalChallenge.my_entry.best_multiplier}×
                        {typeof modalChallenge.target_multiplier === 'number'
                          ? ` / ${modalChallenge.target_multiplier}×`
                          : ''}
                      </div>
                    ) : null}
                    {typeof modalChallenge.my_entry.total_wagered_minor === 'number' &&
                    typeof modalChallenge.target_wager_amount_minor === 'number' ? (
                      <div className="mt-2 text-[12px] text-slate-300">
                        Wagered {formatUsdMinor(modalChallenge.my_entry.total_wagered_minor)} /{' '}
                        {formatUsdMinor(modalChallenge.target_wager_amount_minor)}
                      </div>
                    ) : null}
                    {typeof modalChallenge.my_entry.prize_awarded_minor === 'number' &&
                    modalChallenge.my_entry.prize_awarded_minor > 0 ? (
                      <div className="mt-3 text-[12px] font-bold text-casino-success">
                        Prize paid: {formatUsdMinor(modalChallenge.my_entry.prize_awarded_minor)}
                      </div>
                    ) : null}
                    {modalChallenge.my_entry.can_claim_prize ? (
                      <button
                        type="button"
                        disabled={claimBusy}
                        className="mt-4 flex h-11 w-full items-center justify-center rounded-casino-sm bg-amber-400 text-xs font-extrabold text-black transition-opacity hover:opacity-95 disabled:opacity-40"
                        onClick={() => void onClaim()}
                      >
                        {claimBusy ? 'Claiming…' : 'Claim prize to wallet'}
                      </button>
                    ) : null}
                    {modalChallenge.my_entry.status === 'completed' &&
                    modalChallenge.prize_type === 'cash' &&
                    !modalChallenge.my_entry.can_claim_prize &&
                    (!(typeof modalChallenge.my_entry.prize_awarded_minor === 'number') ||
                      modalChallenge.my_entry.prize_awarded_minor <= 0) ? (
                      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                        {modalChallenge.require_claim_for_prize === false
                          ? 'When you finish, the prize is credited to your wallet automatically.'
                          : 'Prize crediting may be pending review or already processed—check your wallet balance.'}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-casino-md border border-white/[0.1] bg-white/[0.03] px-4 pb-5 pt-5 sm:px-5 sm:pb-6 sm:pt-5">
                    {modalShowStartCountdown ? (
                      <div
                        className="flex min-h-[5.5rem] flex-col items-center justify-center rounded-casino-sm border border-white/10 bg-white/[0.04] px-4 py-5 text-center"
                        aria-live="polite"
                      >
                        <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Challenge starts in</span>
                        <span className="mt-2 font-mono text-lg font-black tabular-nums text-casino-foreground">
                          {formatStartsInCountdown(msUntilStart(modalChallenge, nowTick))}
                        </span>
                        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                          You can accept the terms and enter once the countdown finishes. Opening times are enforced on the server.
                        </p>
                      </div>
                    ) : (
                      <>
                        <label className="flex cursor-pointer items-start gap-3.5 text-[12px] leading-relaxed">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 shrink-0 rounded border-casino-border text-casino-primary"
                            checked={acceptTerms}
                            onChange={(e) => setAcceptTerms(e.target.checked)}
                            disabled={!modalCanJoin}
                          />
                          <span className="text-slate-300">
                            I confirm I have read the rules and terms for this challenge and accept them. I am playing within my
                            limits.
                          </span>
                        </label>
                        <button
                          type="button"
                          disabled={!modalCanJoin || !acceptTerms || enterBusy}
                          className="mt-5 flex h-11 w-full items-center justify-center rounded-casino-sm bg-casino-primary text-xs font-extrabold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                          onClick={() => void onEnter()}
                        >
                          {!isAuthenticated
                            ? 'Sign in to enter'
                            : !modalCanJoin
                              ? 'Not open for entry'
                              : enterBusy
                                ? 'Entering…'
                                : 'Enter challenge'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          {modalTab === 'rules' ? (
            <div className="whitespace-pre-wrap leading-relaxed">{modalChallenge.rules?.trim() || 'No rules provided.'}</div>
          ) : null}
          {modalTab === 'terms' ? (
            <div className="whitespace-pre-wrap leading-relaxed">{modalChallenge.terms?.trim() || 'No terms provided.'}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
