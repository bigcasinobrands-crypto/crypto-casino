import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import i18n from '../../i18n'
import { toast } from 'sonner'
import { readApiError } from '../../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../../notifications/playerToast'
import { usePlayerAuth } from '../../playerAuth'
import { useVipProgram } from '../../hooks/useVipProgram'
import type { PlayerChallengeListItem } from './playerChallengeTypes'
import {
  canJoinChallengeInUi,
  challengeLinkedToCatalogKeys,
  firstCatalogGameId,
  formatEndsCountdown,
  isChallengeInPlayableWindow,
  parseTimeMs,
} from './challengeModalHelpers'
import { IconCircleDollarSign } from '../icons'
import { PrizeRailLogoMark } from './PayoutChainLogoMark'
import { PlayerChallengeDetailModal } from './PlayerChallengeDetailModal'
import { playerApiUrl } from '../../lib/playerApiUrl'

const USD_LIKE = new Set(['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'FDUSD'])

const LB_AVATAR_COLORS = [
  '#7b61ff',
  '#e91e63',
  '#00bcd4',
  '#ff9800',
  '#4caf50',
  '#9c27b0',
  '#f44336',
  '#2196f3',
]

function lbHashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function leaderboardAvatarFallbackBg(label: string): string {
  return LB_AVATAR_COLORS[lbHashCode(label) % LB_AVATAR_COLORS.length]
}

function leaderboardInitials(label: string): string {
  const t = label.trim().toUpperCase()
  if (!t) return '?'
  return t.slice(0, 2)
}

const LOBBY_LB_POLL_MS = 12_000

const lobbySectionInner = 'mx-auto w-full max-w-4xl px-2.5 sm:px-3 lg:max-w-5xl'

const challengeCardShell =
  'flex h-full flex-col overflow-hidden rounded-casino-sm border border-white/[0.08] bg-casino-surface transition hover:border-casino-primary/35 hover:bg-casino-elevated'

type LeaderboardRow = {
  rank: number
  player_label: string
  avatar_url?: string
  /** Present when this row is the authenticated viewer (requires Bearer on leaderboard request). */
  is_viewer?: boolean
  best_multiplier: number
  progress: number
  total_wagered_minor: number
  status: string
  achieved_at: string
}

function formatUsdMinor(minor: number, currency = 'USDT'): string {
  const v = typeof minor === 'number' && Number.isFinite(minor) ? minor : 0
  const major = v / 100
  const cur = (currency || 'USDT').trim().toUpperCase() || 'USDT'
  const formatted = major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (USD_LIKE.has(cur)) {
    const suffix = cur === 'USDT' ? '' : ` ${cur}`
    return `$${formatted}${suffix}`
  }
  return `${formatted} ${cur}`.trim()
}

function formatMult(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  return `${n >= 100 ? Math.round(n) : n.toFixed(2)}×`
}

/** Local date/time for leaderboard "when" column (short). */
function formatLbTime(iso: string): string {
  if (!iso?.trim()) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return '—'
  const lng = i18n.language === 'fr-CA' ? 'fr-CA' : 'en-US'
  return d.toLocaleString(lng, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function prizeShort(c: PlayerChallengeListItem): string {
  if (c.prize_type === 'cash' && typeof c.prize_amount_minor === 'number') {
    return formatUsdMinor(c.prize_amount_minor, c.prize_currency ?? 'USDT')
  }
  if (c.prize_type === 'free_spins') return i18n.t('challenges.prizeFreeSpins')
  if (c.prize_type === 'bonus') return i18n.t('challenges.prizeBonusCredit')
  return c.prize_type.replace(/_/g, ' ')
}

function isCashPrize(c: PlayerChallengeListItem): boolean {
  return c.prize_type === 'cash' && typeof c.prize_amount_minor === 'number'
}

/** One-line goal from challenge type + targets (matches lobby card expectations). */
function challengeGoalLine(c: PlayerChallengeListItem): string | null {
  const ty = (c.challenge_type ?? '').toLowerCase()
  if (ty === 'multiplier' && typeof c.target_multiplier === 'number' && c.target_multiplier > 0) {
    return i18n.t('challenges.goalWinTarget', { mult: formatMult(c.target_multiplier) })
  }
  if (ty === 'wager_volume' && typeof c.target_wager_amount_minor === 'number' && c.target_wager_amount_minor > 0) {
    return i18n.t('challenges.goalWagerTarget', { amount: formatUsdMinor(c.target_wager_amount_minor) })
  }
  if (ty === 'win_streak') return i18n.t('challenges.goalWinStreak')
  if (ty === 'race') return i18n.t('challenges.goalRace')
  return null
}

function isWagerRace(type: string): boolean {
  return type.trim().toLowerCase() === 'wager_volume'
}

/** Lobby leaderboard: highest mult / wager first; earlier `achieved_at` wins ties. */
function sortLobbyLeaderboardRows(rows: LeaderboardRow[], wagerMode: boolean): LeaderboardRow[] {
  const copy = [...rows]
  if (wagerMode) {
    copy.sort((a, b) => {
      if (b.total_wagered_minor !== a.total_wagered_minor) return b.total_wagered_minor - a.total_wagered_minor
      if (b.best_multiplier !== a.best_multiplier) return b.best_multiplier - a.best_multiplier
      const ta = parseTimeMs(a.achieved_at)
      const tb = parseTimeMs(b.achieved_at)
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
      return 0
    })
  } else {
    copy.sort((a, b) => {
      if (b.best_multiplier !== a.best_multiplier) return b.best_multiplier - a.best_multiplier
      const ta = parseTimeMs(a.achieved_at)
      const tb = parseTimeMs(b.achieved_at)
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
      if (b.total_wagered_minor !== a.total_wagered_minor) return b.total_wagered_minor - a.total_wagered_minor
      return 0
    })
  }
  return copy
}

const LOBBY_CHALLENGES_COL_MIN_H = 'lg:min-h-[min(18rem,38vh)]'

/**
 * Challenges linked to the current catalog game on the game lobby page.
 */
export default function GameLobbyActiveChallenges({
  catalogGameId,
  catalogGameKeys,
}: {
  catalogGameId: string
  /** Catalog identifiers for this title (at least URL `gameId`; include `id_hash` when known). */
  catalogGameKeys: readonly string[]
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { apiFetch, isAuthenticated, refreshProfile, me } = usePlayerAuth()
  const { data: vipProgram } = useVipProgram()
  const vipTiers = useMemo(() => vipProgram?.tiers ?? [], [vipProgram?.tiers])
  const [list, setList] = useState<PlayerChallengeListItem[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [claimBusyId, setClaimBusyId] = useState<string | null>(null)
  const [enterModalChallengeId, setEnterModalChallengeId] = useState<string | null>(null)
  const [focusChallengeId, setFocusChallengeId] = useState<string>('')
  const [lbRows, setLbRows] = useState<LeaderboardRow[]>([])
  const [lbType, setLbType] = useState<string>('')
  const [lbLoading, setLbLoading] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const loadChallenges = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!isAuthenticated || !catalogGameId.trim()) {
      setList(null)
      setErr(null)
      return
    }
    if (!silent) setErr(null)
    try {
      const q = new URLSearchParams({ game_id: catalogGameId.trim() })
      const path = `/v1/challenges?${q}`
      const res = await apiFetch(path)
      if (!res.ok) {
        const apiErr = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        if (!silent) {
          toastPlayerApiError(apiErr, res.status, `GET ${path}`, rid)
          setErr(i18n.t('challenges.lobby.loadError'))
        }
        return
      }
      const j = (await res.json()) as { challenges?: PlayerChallengeListItem[] }
      setList(Array.isArray(j.challenges) ? j.challenges : [])
    } catch {
      if (!silent) {
        toastPlayerNetworkError(i18n.t('common.networkError'), 'GET /v1/challenges')
        setErr(i18n.t('common.networkError'))
      }
    }
  }, [isAuthenticated, apiFetch, catalogGameId])

  const allowedKeySet = useMemo(() => {
    const keys = catalogGameKeys.length > 0 ? catalogGameKeys : [catalogGameId]
    return new Set(keys.map((k) => String(k).trim()).filter(Boolean))
  }, [catalogGameKeys, catalogGameId])

  const listFiltered = useMemo(() => {
    if (!list) return null
    return list.filter((c) => challengeLinkedToCatalogKeys(c, allowedKeySet))
  }, [list, allowedKeySet])

  const openChallengeLinkedGame = useCallback(
    (c: PlayerChallengeListItem) => {
      const id = firstCatalogGameId(c.game_ids)
      if (!id) {
        toast.message(i18n.t('challenges.toastGameUnavailableTitle'), {
          description: i18n.t('challenges.toastGameUnavailableBody'),
        })
        return
      }
      navigate(`/casino/game-lobby/${encodeURIComponent(id)}`)
    },
    [navigate],
  )

  useEffect(() => {
    if (!isAuthenticated || !catalogGameId.trim()) {
      setList(null)
      setErr(null)
      return
    }
    setList(null)
    setErr(null)
    void loadChallenges()
  }, [isAuthenticated, catalogGameId, loadChallenges])

  const loadLeaderboard = useCallback(
    async (challengeId: string, quiet: boolean) => {
      if (!challengeId || !isAuthenticated) {
        setLbRows([])
        setLbType('')
        return
      }
      if (!quiet) setLbLoading(true)
      try {
        const path = `/v1/challenges/${encodeURIComponent(challengeId)}/leaderboard`
        const res = await apiFetch(path)
        if (!res.ok) {
          if (!quiet) {
            const apiErr = await readApiError(res)
            toastPlayerApiError(apiErr, res.status, `GET ${path}`)
          }
          if (!quiet) {
            setLbRows([])
            setLbType('')
          }
          return
        }
        const j = (await res.json()) as { challenge_type?: string; leaderboard?: unknown[] }
        const rowsRaw = Array.isArray(j.leaderboard) ? j.leaderboard : []
        const normalized: LeaderboardRow[] = rowsRaw.map((raw) => {
          const o = raw as Record<string, unknown>
          const av = typeof o.avatar_url === 'string' ? o.avatar_url.trim() : ''
          const isViewer = o.is_viewer === true
          return {
            rank: Number(o.rank) || 0,
            player_label: String(o.player_label ?? '—'),
            ...(av ? { avatar_url: av } : {}),
            ...(isViewer ? { is_viewer: true } : {}),
            best_multiplier: Number(o.best_multiplier) || 0,
            progress: Number(o.progress) || 0,
            total_wagered_minor: Number(o.total_wagered_minor) || 0,
            status: String(o.status ?? ''),
            achieved_at: typeof o.achieved_at === 'string' ? o.achieved_at : '',
          }
        })
        setLbType(typeof j.challenge_type === 'string' ? j.challenge_type : '')
        setLbRows(normalized.slice(0, 14))
      } catch {
        if (!quiet) {
          toastPlayerNetworkError(i18n.t('common.networkError'), 'GET challenge leaderboard')
          setLbRows([])
          setLbType('')
        }
      } finally {
        if (!quiet) setLbLoading(false)
      }
    },
    [isAuthenticated, apiFetch],
  )

  useEffect(() => {
    if (!focusChallengeId || !isAuthenticated) {
      setLbRows([])
      setLbType('')
      return
    }
    void loadLeaderboard(focusChallengeId, false)
    const iv = window.setInterval(() => void loadLeaderboard(focusChallengeId, true), LOBBY_LB_POLL_MS)
    return () => window.clearInterval(iv)
  }, [focusChallengeId, isAuthenticated, loadLeaderboard])

  const visibleList = useMemo(
    () => (listFiltered?.filter((c) => isChallengeInPlayableWindow(c, nowTick)) ?? []),
    [listFiltered, nowTick],
  )

  /** Pick up `scheduled` → `active` after starts_at without clearing the strip (throttled). */
  const scheduledPromoSyncAtRef = useRef(0)
  useEffect(() => {
    if (!listFiltered?.length || !isAuthenticated) return
    const needsPromoSync = listFiltered.some((c) => {
      if ((c.status ?? '').trim().toLowerCase() !== 'scheduled') return false
      return isChallengeInPlayableWindow(c, nowTick)
    })
    if (!needsPromoSync) return
    const now = Date.now()
    if (now - scheduledPromoSyncAtRef.current < 12_000) return
    scheduledPromoSyncAtRef.current = now
    const t = window.setTimeout(() => void loadChallenges({ silent: true }), 500)
    return () => window.clearTimeout(t)
  }, [listFiltered, nowTick, isAuthenticated, loadChallenges])

  useEffect(() => {
    if (!visibleList.length) {
      setFocusChallengeId('')
      return
    }
    setFocusChallengeId((prev) => (prev && visibleList.some((c) => c.id === prev) ? prev : visibleList[0].id))
  }, [visibleList])

  useEffect(() => {
    if (!enterModalChallengeId || !listFiltered?.length) return
    if (listFiltered.some((c) => c.id === enterModalChallengeId && c.my_entry)) {
      setEnterModalChallengeId(null)
    }
  }, [enterModalChallengeId, listFiltered])

  const onClaimPrize = async (challengeId: string) => {
    if (!isAuthenticated) return
    setClaimBusyId(challengeId)
    try {
      const res = await apiFetch(`/v1/challenges/${encodeURIComponent(challengeId)}/claim`, { method: 'POST' })
      if (!res.ok) {
        const errRes = await readApiError(res)
        toastPlayerApiError(errRes, res.status, 'POST challenge claim')
        return
      }
      toast.success(i18n.t('challenges.modal.prizeClaimedTitle'), {
        description: i18n.t('challenges.modal.prizeClaimedBody'),
      })
      await refreshProfile()
      await loadChallenges()
      if (focusChallengeId === challengeId) void loadLeaderboard(challengeId, true)
    } catch {
      toastPlayerNetworkError(i18n.t('common.networkError'), 'POST challenge claim')
    } finally {
      setClaimBusyId(null)
    }
  }

  const focusedChallenge =
    visibleList.length > 0 ? (visibleList.find((c) => c.id === focusChallengeId) ?? null) : null
  const wagerMode = isWagerRace(lbType || focusedChallenge?.challenge_type || '')

  const sortedLbRows = useMemo(
    () => sortLobbyLeaderboardRows(lbRows, wagerMode).slice(0, 14),
    [lbRows, wagerMode],
  )

  if (!isAuthenticated) return null
  if (err) {
    return (
      <section className="border-t border-casino-border bg-casino-surface/30" aria-label={t('challenges.lobby.sectionAria')}>
        <div className={`${lobbySectionInner} py-2`}>
          <p className="text-center text-[11px] text-red-400/90 sm:text-xs">{err}</p>
        </div>
      </section>
    )
  }
  if (visibleList.length === 0) return null

  return (
    <section className="border-t border-casino-border bg-casino-surface/30" aria-label={t('challenges.lobby.sectionAria')}>
      <div className={`${lobbySectionInner} py-2 sm:py-2.5`}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
          <h2 className="text-[11px] font-bold text-casino-foreground sm:text-xs">{t('challenges.lobby.challengesOnGame')}</h2>
          <Link to="/casino/challenges" className="text-[10px] font-semibold text-casino-primary hover:underline sm:text-[11px]">
            {t('challenges.lobby.allChallenges')}
          </Link>
        </div>

        {visibleList.length > 1 ? (
          <div
            className="mb-2 flex flex-wrap gap-1 sm:gap-1.5"
            role="tablist"
            aria-label={t('challenges.lobby.leaderboardTabAria')}
          >
            {visibleList.map((c) => {
              const active = c.id === focusChallengeId
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`max-w-[14rem] truncate rounded-casino-sm border px-2 py-0.5 text-left text-[9px] font-extrabold transition sm:px-2.5 sm:text-[10px] ${
                    active
                      ? 'border-casino-primary/50 bg-casino-primary/15 text-casino-foreground'
                      : 'border-white/10 bg-white/[0.04] text-casino-muted hover:border-white/16 hover:bg-white/[0.07] hover:text-casino-foreground'
                  }`}
                  onClick={() => setFocusChallengeId(c.id)}
                >
                  {c.title}
                </button>
              )
            })}
          </div>
        ) : null}

        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-stretch lg:gap-3">
          <div
            className={`flex w-full flex-col gap-2 sm:mx-auto sm:max-w-[11.5rem] lg:mx-0 lg:w-[min(100%,11.5rem)] lg:shrink-0 lg:flex-1 ${LOBBY_CHALLENGES_COL_MIN_H}`}
          >
            {visibleList.map((c) => {
              const hero = c.hero_image_url?.trim() ?? ''
              const entry = c.my_entry
              const canClaim = entry?.can_claim_prize === true
              const joinOpen = canJoinChallengeInUi(c, nowTick) && !entry
              const showEnteredBadge = Boolean(!canClaim && entry)
              const isFocused = c.id === focusChallengeId
              const prizeCash = isCashPrize(c)
              const goalLine = challengeGoalLine(c)

              return (
                <article
                  key={c.id}
                  className={`group ${challengeCardShell} ${visibleList.length === 1 ? 'lg:flex-1 lg:min-h-0' : ''} ${isFocused ? 'ring-2 ring-casino-primary/55 ring-offset-2 ring-offset-casino-bg' : ''}`}
                >
                  <Link
                    to="/casino/challenges"
                    className="flex min-h-0 flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-casino-primary focus-visible:ring-offset-2 focus-visible:ring-offset-casino-surface"
                  >
                    <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden bg-black">
                      {hero ? (
                        <img
                          src={hero}
                          alt=""
                          className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-gradient-to-br from-casino-primary/20 to-transparent text-[10px] font-bold text-slate-500">
                          {t('challenges.lobby.placeholderTitle')}
                        </div>
                      )}
                      {c.is_featured ? (
                        <span className="pointer-events-none absolute right-1.5 top-1.5 rounded bg-black/75 px-1 py-px text-[8px] font-extrabold uppercase text-white backdrop-blur-sm">
                          {t('challenges.featuredDefault')}
                        </span>
                      ) : null}
                      {showEnteredBadge ? (
                        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-white backdrop-blur-sm">
                          {t('challenges.lobby.entered')}
                        </span>
                      ) : null}
                      {canClaim ? (
                        <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-amber-400/90 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-black backdrop-blur-sm">
                          {t('challenges.lobby.ready')}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-1 px-1.5 pb-1.5 pt-1">
                      <p className="line-clamp-2 text-[10px] font-extrabold leading-tight text-casino-foreground sm:text-[11px]">{c.title}</p>
                      <p className="line-clamp-2 text-[9px] font-semibold leading-snug text-slate-400">
                        {c.description?.trim() || '—'}
                      </p>
                      {goalLine ? (
                        <p className="text-[9px] font-bold leading-snug text-casino-primary/95">{goalLine}</p>
                      ) : null}
                      <div className="flex flex-col gap-px">
                        <span className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{t('challenges.minBet')}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-casino-foreground">
                          <IconCircleDollarSign size={10} className="shrink-0 text-casino-success" aria-hidden />
                          {formatUsdMinor(c.min_bet_amount_minor)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-px">
                        <span className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{t('challenges.prize')}</span>
                        <span
                          className={`inline-flex items-center gap-1.5 text-[10px] font-extrabold ${prizeCash ? 'text-casino-success' : 'text-casino-foreground'}`}
                        >
                          {prizeCash ? (
                            <PrizeRailLogoMark
                              assetKey={c.prize_payout_asset_key}
                              prizeCurrency={c.prize_currency}
                              sizePx={10}
                            />
                          ) : null}
                          {prizeShort(c)}
                        </span>
                      </div>
                      <div className="mt-auto flex flex-col gap-px pt-0.5">
                        <span className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{t('challenges.endsIn')}</span>
                        <span
                          className="font-mono text-[10px] font-extrabold tabular-nums leading-tight text-casino-foreground"
                          title={new Date(c.ends_at).toLocaleString()}
                        >
                          {formatEndsCountdown(c.ends_at, nowTick)}
                        </span>
                      </div>
                    </div>
                  </Link>
                  {canClaim ? (
                    <div className="mt-auto border-t border-white/[0.06] px-1.5 pb-1.5 pt-1.5">
                      <button
                        type="button"
                        className="w-full rounded-casino-sm bg-casino-primary px-2 py-1.5 text-[10px] font-extrabold text-white transition hover:brightness-110 disabled:opacity-50 sm:text-[11px]"
                        disabled={claimBusyId === c.id}
                        onClick={(e) => {
                          e.preventDefault()
                          void onClaimPrize(c.id)
                        }}
                      >
                        {claimBusyId === c.id ? t('challenges.lobby.claiming') : t('challenges.ctaClaimPrize')}
                      </button>
                    </div>
                  ) : joinOpen ? (
                    <div className="mt-auto border-t border-white/[0.06] px-1.5 pb-1.5 pt-1.5">
                      <button
                        type="button"
                        className="flex w-full items-center justify-center rounded-casino-sm bg-casino-primary px-2 py-1.5 text-center text-[10px] font-extrabold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 sm:text-[11px]"
                        disabled={!!entry}
                        onClick={() => {
                          if (entry) return
                          setEnterModalChallengeId(c.id)
                        }}
                      >
                        {t('challenges.modal.enterChallenge')}
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>

          <div
            className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-casino-sm border border-white/[0.08] bg-casino-bg ${LOBBY_CHALLENGES_COL_MIN_H}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.1] px-3 py-2.5 sm:px-3.5">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wide text-casino-foreground sm:text-sm">
                  {t('challenges.lobby.liveLeaderboard')}
                </p>
                {focusedChallenge ? (
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-casino-muted sm:text-xs">
                    {focusedChallenge.title}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400/70 opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-casino-muted sm:text-[11px]">
                  {t('challenges.lobby.liveBadge')}
                </span>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="scrollbar-casino flex min-h-[9.5rem] flex-1 flex-col overflow-auto px-2 pb-2 pt-1 sm:min-h-[11rem] sm:px-3">
                <table className="w-full border-collapse text-left text-[11px] sm:text-xs">
                  <thead className="sticky top-0 z-10 border-b border-white/[0.08]">
                    <tr className="text-[9px] font-bold uppercase tracking-wider text-casino-muted sm:text-[10px]">
                      <th className="bg-casino-bg py-2 pr-2 font-bold">{t('challenges.lobby.colPlayer')}</th>
                      <th className="bg-casino-bg py-2 pr-2 text-right font-bold whitespace-nowrap">{t('challenges.lobby.colTime')}</th>
                      {wagerMode ? (
                        <th className="bg-casino-bg py-2 font-bold text-right">{t('challenges.lobby.colWagered')}</th>
                      ) : (
                        <th className="bg-casino-bg py-2 text-right font-bold whitespace-nowrap">
                          {t('challenges.lobby.colMultiplier')}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.08] text-casino-foreground">
                    {lbLoading && lbRows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-sm font-semibold text-casino-muted">
                          {t('challenges.lobby.loadingStandings')}
                        </td>
                      </tr>
                    ) : sortedLbRows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-2 py-8 text-center text-sm font-medium leading-relaxed text-casino-muted">
                          {t('challenges.lobby.emptyLeaderboard')}
                        </td>
                      </tr>
                    ) : (
                      sortedLbRows.map((row, idx) => {
                        const isLeader = idx === 0
                        const rowAv = typeof row.avatar_url === 'string' ? row.avatar_url.trim() : ''
                        const profileAv =
                          row.is_viewer && typeof me?.avatar_url === 'string' ? me.avatar_url.trim() : ''
                        const avatarPath = rowAv || profileAv
                        const avatarSrc = avatarPath ? playerApiUrl(avatarPath) : null
                        const displayName = row.player_label
                        return (
                          <tr
                            key={`${row.player_label}-${row.achieved_at}-${idx}`}
                            className="transition hover:bg-white/[0.03]"
                            title={
                              isLeader
                                ? t('challenges.lobby.leaderTooltip')
                                : row.is_viewer
                                  ? t('challenges.lobby.yourStandingTooltip')
                                  : undefined
                            }
                          >
                            <td className="max-w-none py-1.5 pr-2 sm:py-2">
                              <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
                                {avatarSrc ? (
                                  <img
                                    src={avatarSrc}
                                    alt=""
                                    className="size-8 shrink-0 rounded-full object-cover ring-1 ring-white/15 sm:size-9"
                                  />
                                ) : (
                                  <div
                                    className="flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-1 ring-white/15 sm:size-9 sm:text-[11px]"
                                    style={{ background: leaderboardAvatarFallbackBg(displayName) }}
                                    aria-hidden
                                  >
                                    {leaderboardInitials(displayName)}
                                  </div>
                                )}
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="min-w-0 truncate text-[13px] font-bold tracking-tight text-white sm:text-sm">
                                    {displayName}
                                  </span>
                                  {row.is_viewer ? (
                                    <span className="shrink-0 rounded bg-casino-primary/25 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-casino-primary sm:text-[9px]">
                                      {t('challenges.lobby.youBadge')}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            </td>
                            <td className="whitespace-nowrap py-1.5 pr-2 text-right font-mono text-[10px] font-medium tabular-nums text-casino-muted/95 sm:py-2 sm:text-[11px]">
                              {formatLbTime(row.achieved_at)}
                            </td>
                            {wagerMode ? (
                              <td className="py-1.5 text-right text-xs font-bold tabular-nums text-casino-success sm:py-2">
                                {formatUsdMinor(row.total_wagered_minor)}
                              </td>
                            ) : (
                              <td className="py-1.5 text-right text-xs font-bold tabular-nums text-amber-300 sm:py-2 sm:text-[13px]">
                                {formatMult(row.best_multiplier)}
                              </td>
                            )}
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="shrink-0 border-t border-white/[0.08] px-3 py-2 text-[10px] font-medium leading-snug text-casino-muted sm:px-3.5 sm:text-[11px]">
              {wagerMode ? t('challenges.lobby.footerWagerMode') : t('challenges.lobby.footerMultMode')}
            </p>
          </div>
        </div>
      </div>

      <PlayerChallengeDetailModal
        challengeId={enterModalChallengeId}
        fallbackChallenge={
          enterModalChallengeId && listFiltered
            ? (listFiltered.find((x) => x.id === enterModalChallengeId) ?? null)
            : null
        }
        onClose={() => setEnterModalChallengeId(null)}
        vipTiers={vipTiers}
        onOpenLinkedGame={openChallengeLinkedGame}
        onAfterEnter={async () => {
          await loadChallenges()
          if (focusChallengeId) void loadLeaderboard(focusChallengeId, true)
        }}
        onAfterClaim={async () => {
          await refreshProfile()
          await loadChallenges()
          if (focusChallengeId) void loadLeaderboard(focusChallengeId, true)
        }}
      />
    </section>
  )
}
