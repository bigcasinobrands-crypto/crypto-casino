import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { readApiError } from '../../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../../notifications/playerToast'
import { usePlayerAuth } from '../../playerAuth'
import { useVipProgram } from '../../hooks/useVipProgram'
import type { VipProgramTier } from '../../lib/vipPresentation'
import { IconCircleDollarSign, IconTarget } from '../icons'
import { PrizeRailLogoMark } from './PayoutChainLogoMark'
import {
  canJoinChallengeInUi,
  ChallengeThumbBadgeStack,
  firstCatalogGameId,
  formatChallengeEndAt,
  formatEndsCountdown,
  formatStartsInCountdown,
  formatUsdMinor,
  isChallengeInPlayableWindow,
  msUntilStart,
  prizeLabel,
  shouldShowStartCountdown,
} from './challengeModalHelpers'
import type { PlayerChallengeListItem } from './playerChallengeTypes'
import { PlayerChallengeDetailModal } from './PlayerChallengeDetailModal'

export type { PlayerChallengeListItem } from './playerChallengeTypes'

const rgUrl = (import.meta.env.VITE_RG_URL as string | undefined)?.trim()

type FilterKey = 'all' | 'active' | 'completed'

const FILTER_OPTIONS: { id: FilterKey; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
]

function ChallengeCard({
  challenge,
  vipTiers,
  nowMs,
  onCountdownReached,
  onOpen,
  onOpenLinkedGame,
}: {
  challenge: PlayerChallengeListItem
  vipTiers: VipProgramTier[]
  nowMs: number
  onCountdownReached: () => void
  onOpen: () => void
  onOpenLinkedGame: (c: PlayerChallengeListItem) => void
}) {
  const { label: prizeText, cash: prizeCash } = prizeLabel(challenge)
  const entry = challenge.my_entry
  const completed = entry?.status === 'completed'
  const claimReady = entry?.can_claim_prize === true
  const hero = challenge.hero_image_url?.trim() ?? ''

  const showCountdown = shouldShowStartCountdown(challenge, nowMs)
  const joinOpen = canJoinChallengeInUi(challenge, nowMs)
  const endsLiveCountdown = isChallengeInPlayableWindow(challenge, nowMs)

  const prevUntilStartRef = useRef<number | null>(null)
  useEffect(() => {
    if (challenge.my_entry) {
      prevUntilStartRef.current = null
      return
    }
    const until = msUntilStart(challenge, nowMs)
    const prev = prevUntilStartRef.current
    prevUntilStartRef.current = until
    if (prev != null && prev > 0 && until === 0) {
      onCountdownReached()
    }
  }, [challenge.id, challenge.my_entry, challenge.starts_at, nowMs, onCountdownReached])

  const ctaLabel = claimReady ? 'Claim prize' : entry ? 'View details' : 'Claim'
  const ctaPrimary = claimReady || (!entry && joinOpen)

  const playGameId = useMemo(() => firstCatalogGameId(challenge.game_ids), [challenge.game_ids])

  const heroAreaClass =
    'relative aspect-[5/6] w-full shrink-0 overflow-hidden bg-black transition-[filter] duration-200 motion-reduce:transition-none'
  const heroInteractiveClass = playGameId
    ? 'cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-casino-primary focus-visible:ring-offset-2 focus-visible:ring-offset-casino-surface'
    : ''

  const heroFigure = (
    <>
      {hero ? (
        <img
          src={hero}
          alt=""
          className="size-full object-cover transition-transform duration-300 ease-out motion-reduce:transition-none group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
          loading="lazy"
          onError={(e) => {
            const t = e.target as HTMLImageElement
            t.style.display = 'none'
          }}
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-gradient-to-br from-casino-primary/20 to-transparent text-[10px] font-bold text-slate-500">
          Challenge
        </div>
      )}
      <ChallengeThumbBadgeStack challenge={challenge} vipTiers={vipTiers} />
      {completed ? (
        <span className="pointer-events-none absolute left-2 top-2 rounded-casino-sm bg-casino-success px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-black backdrop-blur-sm">
          Completed
        </span>
      ) : null}
      {claimReady ? (
        <span className="pointer-events-none absolute left-2 top-[2rem] rounded-casino-sm bg-amber-400/90 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-black backdrop-blur-sm">
          Claim
        </span>
      ) : null}
    </>
  )

  return (
    <article className="group flex flex-col overflow-hidden rounded-casino-md border border-transparent bg-casino-surface text-[13px] transition-all duration-200 ease-out hover:-translate-y-1 hover:border-white/14 hover:bg-casino-elevated hover:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.55)] motion-reduce:hover:-translate-y-0 motion-reduce:hover:shadow-none">
      <button
        type="button"
        className={`${heroAreaClass} ${heroInteractiveClass} block border-0 p-0 text-left ${playGameId ? '' : 'cursor-default hover:brightness-100'}`}
        onClick={() => onOpenLinkedGame(challenge)}
        aria-label={playGameId ? `Open game: ${challenge.title}` : `${challenge.title} — no linked game`}
      >
        {heroFigure}
      </button>
      <div className="flex flex-1 flex-col gap-2 px-3 py-3">
        <h2 className="truncate text-[13px] font-extrabold leading-tight text-casino-foreground">
          {challenge.title}
        </h2>
        <p className="line-clamp-3 min-h-[2.1rem] text-[11px] font-semibold leading-snug text-slate-400">
          {challenge.description || '—'}
        </p>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Min bet</span>
          <span className="inline-flex items-center gap-1 text-[12px] font-extrabold text-casino-foreground">
            <IconCircleDollarSign size={11} className="shrink-0 text-casino-success" aria-hidden />
            {formatUsdMinor(challenge.min_bet_amount_minor)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Prize</span>
          <span
            className={`inline-flex items-center gap-1.5 text-[12px] font-extrabold ${prizeCash ? 'text-casino-success' : 'text-casino-foreground'}`}
          >
            {prizeCash ? (
              <PrizeRailLogoMark
                assetKey={challenge.prize_payout_asset_key}
                prizeCurrency={challenge.prize_currency}
                sizePx={11}
              />
            ) : null}
            {prizeText}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {endsLiveCountdown ? 'Ends in' : 'Ends'}
          </span>
          <span
            className={`text-[12px] font-extrabold leading-tight text-casino-foreground ${endsLiveCountdown ? 'font-mono tabular-nums' : ''}`}
            title={new Date(challenge.ends_at).toLocaleString()}
          >
            {endsLiveCountdown ? formatEndsCountdown(challenge.ends_at, nowMs) : formatChallengeEndAt(challenge.ends_at)}
          </span>
        </div>
        <div className="mt-auto border-t border-white/[0.06] pt-2">
          {entry ? (
            <p className="mb-1.5 text-[10px] text-slate-400">
              Your status:{' '}
              <span className="font-bold text-casino-foreground">{entry.status}</span>
            </p>
          ) : null}
          {showCountdown ? (
            <button
              type="button"
              onClick={onOpen}
              className="flex h-9 w-full flex-col items-center justify-center rounded-casino-sm border border-white/10 bg-white/[0.06] px-1.5 py-1 text-center transition-colors hover:border-white/15 hover:bg-white/[0.09]"
              aria-live="polite"
            >
              <span className="text-[8px] font-bold uppercase tracking-wide text-slate-500">Starts in</span>
              <span className="font-mono text-[11px] font-extrabold tabular-nums text-casino-foreground">
                {formatStartsInCountdown(msUntilStart(challenge, nowMs))}
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled={!entry && !joinOpen}
              className={`flex h-9 w-full items-center justify-center rounded-casino-sm text-[11px] font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary disabled:cursor-not-allowed disabled:opacity-45 ${
                ctaPrimary
                  ? 'bg-casino-primary text-white hover:bg-casino-primary/90'
                  : 'border border-white/15 bg-white/[0.06] text-casino-foreground hover:bg-white/10'
              }`}
              onClick={onOpen}
            >
              {!entry && !joinOpen ? 'Closed' : ctaLabel}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

export default function ChallengesPageContent() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { apiFetch, isAuthenticated, refreshProfile } = usePlayerAuth()
  const { data: vipProgram } = useVipProgram()
  const vipTiers = useMemo(() => vipProgram?.tiers ?? [], [vipProgram?.tiers])
  const [filter, setFilter] = useState<FilterKey>('all')
  const [list, setList] = useState<PlayerChallengeListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [meStats, setMeStats] = useState<{ active: number; completed: number } | null>(null)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const [modalId, setModalId] = useState<string | null>(null)

  const openChallengeLinkedGame = useCallback(
    (c: PlayerChallengeListItem) => {
      const id = firstCatalogGameId(c.game_ids)
      if (!id) {
        toast.message('Game link unavailable', {
          description: 'This challenge has no linked game in the catalog yet.',
        })
        return
      }
      navigate(`/casino/game-lobby/${encodeURIComponent(id)}`)
    },
    [navigate],
  )

  const loadList = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) setLoading(true)
    try {
      const res = await apiFetch('/v1/challenges')
      if (!res.ok) {
        const err = await readApiError(res)
        toastPlayerApiError(err, res.status, 'GET /v1/challenges')
        if (!silent) setList([])
        return
      }
      const j = (await res.json()) as { challenges?: PlayerChallengeListItem[] }
      setList(Array.isArray(j.challenges) ? j.challenges : [])
    } catch {
      toastPlayerNetworkError('Network error.', 'GET /v1/challenges')
      if (!silent) setList([])
    } finally {
      if (!silent) setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    void loadList()
  }, [loadList])

  /** Deep-link: `?open=<challengeId>` opens the enter/confirm modal (e.g. shared link). */
  useEffect(() => {
    const raw = searchParams.get('open')?.trim()
    if (!raw) return
    setModalId(raw)
    const next = new URLSearchParams(searchParams)
    next.delete('open')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!isAuthenticated) {
      setMeStats(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch('/v1/challenges/me/list')
        if (!res.ok || cancelled) return
        const j = (await res.json()) as { entries?: { entry_status: string }[] }
        const entries = Array.isArray(j.entries) ? j.entries : []
        const active = entries.filter((e) => e.entry_status === 'active').length
        const completed = entries.filter((e) => e.entry_status === 'completed').length
        if (!cancelled) setMeStats({ active, completed })
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, apiFetch, list])

  const countdownListRefreshRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (countdownListRefreshRef.current != null) {
        window.clearTimeout(countdownListRefreshRef.current)
        countdownListRefreshRef.current = null
      }
    }
  }, [])

  const onChallengeCountdownReached = useCallback(() => {
    if (countdownListRefreshRef.current != null) return
    countdownListRefreshRef.current = window.setTimeout(() => {
      countdownListRefreshRef.current = null
      void loadList({ silent: true })
    }, 500)
  }, [loadList])

  const visible = useMemo(() => {
    if (filter === 'all') return list
    if (filter === 'active') {
      return list.filter((c) => {
        const e = c.my_entry
        if (!e) return false
        return e.status !== 'completed'
      })
    }
    if (filter === 'completed') {
      return list.filter((c) => {
        const e = c.my_entry
        return e?.status === 'completed'
      })
    }
    return list
  }, [filter, list])

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <header className="mb-8 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-casino-md bg-casino-primary/20 text-casino-primary">
            <IconTarget size={26} aria-hidden />
          </div>
          <div>
            <h1 className="mb-1 text-xl font-black uppercase tracking-wide text-casino-foreground">Challenges</h1>
            <p className="text-[13px] font-medium text-casino-muted">
              Hit multipliers and wagering targets to win cash and rewards. Play responsibly.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter challenges">
          {FILTER_OPTIONS.map(({ id, label }) => {
            const active = filter === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`flex h-9 items-center justify-center rounded-casino-sm border px-4 text-[13px] font-bold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary ${
                  active
                    ? 'border-white/12 bg-white/[0.1] text-casino-foreground hover:border-white/[0.14] hover:bg-white/[0.12]'
                    : 'border-transparent bg-white/[0.03] text-casino-muted hover:border-white/[0.12] hover:bg-white/[0.08] hover:text-casino-foreground'
                }`}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            )
          })}
        </div>
      </header>

      <section
        className="mb-8 flex flex-col gap-6 rounded-casino-md border border-casino-primary/20 bg-gradient-to-r from-casino-primary/10 via-white/[0.02] to-transparent p-6 sm:flex-row sm:items-center sm:justify-between"
        aria-label="Your challenge activity"
      >
        <div>
          <h2 className="mb-1 text-lg font-black text-casino-foreground">Your progress</h2>
          <p className="max-w-xl text-[13px] font-medium text-casino-muted">
            {isAuthenticated
              ? 'Active entries update every few seconds while this page is open.'
              : 'Sign in to enter challenges and track progress.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-8">
          <div>
            <div className="text-xs font-semibold text-casino-muted">Active entries</div>
            <strong className="text-lg font-black text-casino-foreground">
              {isAuthenticated ? (meStats?.active ?? '—') : '—'}
            </strong>
          </div>
          <div>
            <div className="text-xs font-semibold text-casino-muted">Completed</div>
            <strong className="text-lg font-black text-casino-foreground">
              {isAuthenticated ? (meStats?.completed ?? '—') : '—'}
            </strong>
          </div>
        </div>
      </section>

      <section aria-label="Challenge list">
        {loading ? (
          <p className="text-center text-sm text-casino-muted">Loading challenges…</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {visible.map((c) => (
              <li key={c.id}>
                <ChallengeCard
                  challenge={c}
                  vipTiers={vipTiers}
                  nowMs={nowTick}
                  onCountdownReached={onChallengeCountdownReached}
                  onOpenLinkedGame={openChallengeLinkedGame}
                  onOpen={() => {
                    setModalId(c.id)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {!loading && visible.length === 0 ? (
          <p className="mt-8 text-center text-sm text-casino-muted">No challenges match this filter.</p>
        ) : null}
      </section>

      {rgUrl ? (
        <footer className="mt-10 border-t border-white/10 pt-6 text-center text-[12px] text-slate-500">
          Gambling can be addictive.{' '}
          <a href={rgUrl} className="font-semibold text-casino-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
            Responsible gambling resources
          </a>
          .
        </footer>
      ) : (
        <footer className="mt-10 border-t border-white/10 pt-6 text-center text-[12px] text-slate-500">
          Play within your limits. If you need help, use your operator&apos;s responsible gambling tools.
        </footer>
      )}

      <PlayerChallengeDetailModal
        challengeId={modalId}
        fallbackChallenge={modalId ? (list.find((c) => c.id === modalId) ?? null) : null}
        onClose={() => setModalId(null)}
        vipTiers={vipTiers}
        onOpenLinkedGame={openChallengeLinkedGame}
        onAfterEnter={() => void loadList()}
        onAfterClaim={async () => {
          await refreshProfile()
          await loadList()
        }}
      />
    </div>
  )
}
