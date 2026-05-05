import type { TFunction } from 'i18next'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { readApiError } from '../api/errors'
import { toast } from 'sonner'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { BonusForfeitConfirmModal } from '../components/rewards/BonusForfeitConfirmModal'
import { BonusInstanceDetailsPanel } from '../components/rewards/BonusInstanceDetailsPanel'
import type { HubBonusDetails } from '../hooks/useRewardsHub'
import { playerBonusDisplayTitle } from '../lib/playerBonusDisplayTitle'
import { usePlayerAuth } from '../playerAuth'
import {
  IconArrowDown,
  IconArrowRightLeft,
  IconArrowUp,
  IconBadgeCheck,
  IconCamera,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconCoins,
  IconCrown,
  IconDice5,
  IconEye,
  IconEyeOff,
  IconGift,
  IconGlobe,
  IconLock,
  IconSettings,
  IconShieldCheck,
  IconStar,
  IconTicket,
  IconTrendingUp,
  IconTrophy,
  IconUser,
  IconUsers,
  IconWallet,
} from '../components/icons'
import { getFingerprintForAction } from '../lib/fingerprintClient'
import { playerApiOriginConfigured, playerApiUrl } from '../lib/playerApiUrl'
import { useVipStatus } from '../hooks/useVipStatus'
import { useVipProgram } from '../hooks/useVipProgram'
import { PLAYER_MODAL_OVERLAY_Z } from '../lib/playerChromeLayers'
import { mergeTierPresentation } from '../lib/vipPresentation'

const supportUrl = import.meta.env.VITE_SUPPORT_URL as string | undefined
const rgUrl = import.meta.env.VITE_RG_URL as string | undefined

/** Absolute avatar URL for `<img src>`; optional revision avoids stale cache after upload. */
function playerAvatarDisplaySrc(
  avatarPath: string | undefined | null,
  revision: number,
): string | null {
  const p = typeof avatarPath === 'string' ? avatarPath.trim() : ''
  if (!p) return null
  const base = playerApiUrl(p)
  if (revision <= 0) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}v=${revision}`
}

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type Transaction = {
  id: string
  amount_minor: number
  currency: string
  entry_type: string
  idempotency_key: string
  metadata: Record<string, unknown> | null
  created_at: string
}

type ProfileTab = 'overview' | 'transactions' | 'history' | 'settings'

const TAB_ORDER: ProfileTab[] = ['overview', 'transactions', 'history', 'settings']

/* ------------------------------------------------------------------ */
/*  Transaction helpers                                               */
/* ------------------------------------------------------------------ */

type TxDisplayType =
  | 'received'
  | 'sent'
  | 'withdrawal'
  | 'bonus'
  | 'bonus_forfeit'
  | 'bonus_activation'
  | 'bonus_relinquish'
  | 'bonus_release'
  | 'refund'
  /** Zero-amount ledger rows (joined a challenge). */
  | 'challenge_activity'
type TxStatus = 'completed' | 'processing' | 'failed'

function classifyDisplayType(entryType: string, amountMinor: number): TxDisplayType {
  if (entryType === 'challenge.join') return 'challenge_activity'
  if (entryType === 'deposit.credit' || entryType === 'deposit.checkout') return 'received'
  if (entryType === 'withdrawal.debit') return 'withdrawal'
  if (entryType === 'withdrawal.compensation') return 'refund'
  if (entryType === 'game.credit') return 'received'
  if (entryType === 'game.debit') return 'sent'
  if (entryType === 'game.rollback') return 'refund'
  if (entryType === 'promo.activation') return 'bonus_activation'
  if (entryType === 'promo.relinquish') return 'bonus_relinquish'
  if (entryType === 'promo.forfeit') return 'bonus_forfeit'
  if (entryType === 'promo.grant') return 'bonus'
  if (entryType === 'promo.rakeback') return 'bonus'
  if (entryType === 'promo.daily_hunt_cash') return 'bonus'
  if (entryType === 'vip.level_up_cash') return 'bonus'
  if (entryType === 'challenge.prize') return 'received'
  if (entryType === 'promo.convert' && amountMinor > 0) return 'bonus_release'
  if (entryType === 'promo.convert' && amountMinor < 0) return 'sent'
  if (entryType.startsWith('promo')) return 'bonus'
  if (entryType.startsWith('deposit')) return 'received'
  if (entryType.startsWith('withdrawal')) return 'withdrawal'
  return amountMinor >= 0 ? 'received' : 'sent'
}

function classifyStatus(entryType: string): TxStatus {
  if (entryType === 'withdrawal.compensation') return 'failed'
  return 'completed'
}

function displayTypeLabel(dt: TxDisplayType, t: TFunction): string {
  return t(`tx.display.${dt}`)
}

function txChallengeTitle(tx: Transaction, t: TFunction): string {
  const m = tx.metadata
  if (m && typeof m === 'object' && typeof (m as Record<string, unknown>).challenge_title === 'string') {
    const title = String((m as Record<string, unknown>).challenge_title).trim()
    if (title) return title
  }
  return t('tx.challengeDefault')
}

function transactionTypeLabel(entryType: string, amountMinor: number, tx: Transaction | undefined, t: TFunction): string {
  switch (entryType) {
    case 'challenge.join':
      return tx
        ? t('tx.joinedChallenge', { title: txChallengeTitle(tx, t) })
        : t('tx.joinedChallengeShort')
    case 'challenge.prize':
      return tx
        ? t('tx.challengePayout', { title: txChallengeTitle(tx, t) })
        : t('tx.challengePayoutShort')
    case 'promo.rakeback':
      return t('tx.rakebackClaimed')
    case 'promo.daily_hunt_cash':
      return t('tx.dailyHuntCash')
    case 'vip.level_up_cash':
      return t('tx.vipLevelUpCash')
    case 'promo.grant':
      return t('tx.bonusCredited')
    case 'promo.forfeit':
      return t('tx.bonusForfeited')
    case 'promo.activation':
      return t('tx.bonusOfferActivated')
    case 'promo.relinquish':
      return t('tx.bonusOfferCancelled')
    case 'promo.convert':
      return amountMinor >= 0 ? t('tx.bonusReleasedToCash') : t('tx.bonusBalanceConverted')
    default:
      return displayTypeLabel(classifyDisplayType(entryType, amountMinor), t) || t('tx.fallback')
  }
}

function isManualBonusGrant(tx: Transaction): boolean {
  if (tx.entry_type !== 'promo.grant') return false
  const idem = (tx.idempotency_key ?? '').toLowerCase()
  return idem.startsWith('promo.grant:bonus:grant:admin:')
}


function formatMinorAmount(minor: number, currency: string): string {
  const abs = Math.abs(minor)
  const sign = minor >= 0 ? '+' : '-'
  const formatted = (abs / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${sign}${formatted} ${currency}`
}

function formatTxDate(iso: string, t: TFunction, lng: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)
  const loc = lng === 'fr-CA' ? 'fr-CA' : 'en-US'
  const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

  if (diffDays === 0) {
    return `${t('profile.today')}, ${d.toLocaleTimeString(loc, timeOpts)}`
  }
  if (diffDays === 1) {
    return `${t('profile.yesterday')}, ${d.toLocaleTimeString(loc, timeOpts)}`
  }
  return d.toLocaleDateString(loc, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* ------------------------------------------------------------------ */
/*  useTransactions — paginated, live-polling                         */
/* ------------------------------------------------------------------ */

const TX_POLL_MS = 8_000
const PAGE_SIZE = 10

function usePaginatedTransactions(perPage: number = PAGE_SIZE) {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const mountedRef = useRef(true)

  const fetchPage = useCallback(async (p: number) => {
    try {
      const offset = p * perPage
      const res = await apiFetch(`/v1/wallet/transactions?limit=${perPage + 1}&offset=${offset}`)
      if (!res.ok || !mountedRef.current) return
      const j = (await res.json()) as { transactions?: Transaction[] }
      if (!mountedRef.current) return
      const rows = j.transactions ?? []
      setHasMore(rows.length > perPage)
      setTxs(rows.slice(0, perPage))
      setLoading(false)
    } catch {
      if (mountedRef.current) setLoading(false)
    }
  }, [apiFetch, perPage])

  useEffect(() => {
    mountedRef.current = true
    if (!isAuthenticated) {
      setTxs([])
      setLoading(false)
      return
    }
    setLoading(true)
    void fetchPage(page)
    const id = window.setInterval(() => void fetchPage(page), TX_POLL_MS)
    return () => {
      mountedRef.current = false
      window.clearInterval(id)
    }
  }, [isAuthenticated, fetchPage, page])

  const goNext = useCallback(() => { if (hasMore) setPage((p) => p + 1) }, [hasMore])
  const goPrev = useCallback(() => setPage((p) => Math.max(0, p - 1)), [])
  const goTo = useCallback((p: number) => setPage(Math.max(0, p)), [])

  return { txs, loading, page, hasMore, goNext, goPrev, goTo }
}

function useRecentTransactions(limit: number) {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const fetchTxs = useCallback(async () => {
    try {
      const res = await apiFetch(`/v1/wallet/transactions?limit=${limit}`)
      if (!res.ok || !mountedRef.current) return
      const j = (await res.json()) as { transactions?: Transaction[] }
      if (mountedRef.current) {
        setTxs(j.transactions ?? [])
        setLoading(false)
      }
    } catch {
      if (mountedRef.current) setLoading(false)
    }
  }, [apiFetch, limit])

  useEffect(() => {
    mountedRef.current = true
    if (!isAuthenticated) {
      setTxs([])
      setLoading(false)
      return
    }
    void fetchTxs()
    const id = window.setInterval(() => void fetchTxs(), TX_POLL_MS)
    return () => {
      mountedRef.current = false
      window.clearInterval(id)
    }
  }, [isAuthenticated, fetchTxs])

  return { txs, loading }
}

/* ------------------------------------------------------------------ */
/*  Player betting stats (server-computed)                             */
/* ------------------------------------------------------------------ */

interface PlayerStats {
  totalWagered: number
  totalBets: number
  highestWin: number
  netProfit: number
}

const EMPTY_STATS: PlayerStats = { totalWagered: 0, totalBets: 0, highestWin: 0, netProfit: 0 }

function usePlayerStats(): { stats: PlayerStats; loading: boolean } {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [stats, setStats] = useState<PlayerStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthenticated) {
      setStats(EMPTY_STATS)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    const load = async () => {
      try {
        const res = await apiFetch('/v1/wallet/stats')
        if (!res.ok) {
          if (!cancelled) setStats(EMPTY_STATS)
          return
        }
        const j = (await res.json()) as {
          total_wagered?: number
          total_bets?: number
          highest_win?: number
          net_profit?: number
        }
        if (!cancelled) {
          setStats({
            totalWagered: Number(j.total_wagered ?? 0),
            totalBets: Number(j.total_bets ?? 0),
            highestWin: Number(j.highest_win ?? 0),
            netProfit: Number(j.net_profit ?? 0),
          })
        }
      } catch {
        if (!cancelled) setStats(EMPTY_STATS)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    const poll = window.setInterval(() => void load(), 30_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelled = true
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [apiFetch, isAuthenticated])

  return { stats, loading }
}

function formatMinorUsd(minor: number, lng: string) {
  const loc = lng === 'fr-CA' ? 'fr-CA' : 'en-US'
  return new Intl.NumberFormat(loc, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)
}

type PlayerBonusRow = {
  id: string
  promotion_version_id: number
  status: string
  granted_amount_minor: number
  currency: string
  wr_required_minor: number
  wr_contributed_minor: number
  created_at: string
  title?: string
  bonus_type?: string
  details?: HubBonusDetails
}

type OfferRow = {
  promotion_version_id: number
  title: string
  description: string
  kind: string
  schedule_summary?: string
  trigger_type?: string
  bonus_type?: string
}

type BonusListFilter = 'active' | 'past' | 'all'

function statusBucket(status: string): 'active' | 'past' {
  const s = status.toLowerCase()
  if (s === 'active' || s === 'pending' || s === 'pending_review') return 'active'
  return 'past'
}

function PlayerBonusesPanel() {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const { apiFetch, refreshProfile } = usePlayerAuth()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [bonuses, setBonuses] = useState<PlayerBonusRow[]>([])
  const [offers, setOffers] = useState<OfferRow[]>([])
  const [bonusLockedMinor, setBonusLockedMinor] = useState<number | null>(null)
  const [listFilter, setListFilter] = useState<BonusListFilter>('active')
  const [reloadTick, setReloadTick] = useState(0)
  const [forfeitBusyId, setForfeitBusyId] = useState<string | null>(null)
  const [forfeitTarget, setForfeitTarget] = useState<PlayerBonusRow | null>(null)
  const [detailsOpenId, setDetailsOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setErr(null)
      try {
        const [bRes, oRes] = await Promise.all([
          apiFetch('/v1/wallet/bonuses'),
          apiFetch('/v1/bonuses/available'),
        ])
        if (cancelled) return
        if (bRes.ok) {
          const j = (await bRes.json()) as {
            bonuses?: PlayerBonusRow[]
            wallet?: { bonus_locked_minor?: number }
          }
          setBonuses(Array.isArray(j.bonuses) ? j.bonuses : [])
          setBonusLockedMinor(typeof j.wallet?.bonus_locked_minor === 'number' ? j.wallet.bonus_locked_minor : null)
        } else {
          setBonuses([])
          setBonusLockedMinor(null)
        }
        if (oRes.ok) {
          const j2 = (await oRes.json()) as { offers?: OfferRow[] }
          setOffers(Array.isArray(j2.offers) ? j2.offers : [])
        } else {
          setOffers([])
        }
        if (!bRes.ok && !oRes.ok) {
          setErr(t('profile.couldNotLoadBonuses'))
        }
      } catch {
        if (!cancelled) setErr(t('profile.networkErrorShort'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch, reloadTick, t])

  const filteredBonuses = useMemo(() => {
    if (listFilter === 'all') return bonuses
    return bonuses.filter((b) => statusBucket(b.status) === listFilter)
  }, [bonuses, listFilter])

  const executeForfeit = useCallback(async () => {
    if (!forfeitTarget) return
    const id = forfeitTarget.id
    setForfeitBusyId(id)
    try {
      const res = await apiFetch(`/v1/wallet/bonuses/${encodeURIComponent(id)}/forfeit`, {
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
      setForfeitTarget(null)
      void refreshProfile()
      setReloadTick((t) => t + 1)
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/wallet/bonuses/forfeit')
    } finally {
      setForfeitBusyId(null)
    }
  }, [apiFetch, forfeitTarget, refreshProfile])

  return (
    <div className="rounded-casino-lg border border-white/[0.06] bg-casino-card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <IconGift size={20} className="text-casino-primary" aria-hidden />
        <h2 className="text-sm font-extrabold tracking-wide text-casino-foreground">{t('profile.bonusesTitle')}</h2>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-casino-muted">{t('profile.bonusesIntro')}</p>
      {loading ? <p className="text-sm text-casino-muted">{t('profile.loadingEllipsis')}</p> : null}
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {!loading && bonusLockedMinor != null ? (
        <p className="mb-3 text-xs text-casino-muted">
          {t('profile.lockedBonusBalance')}{' '}
          <span className="font-semibold text-casino-foreground">{formatMinorUsd(bonusLockedMinor, lng)}</span>
        </p>
      ) : null}
      {!loading && !err && offers.length > 0 ? (
        <div className="mb-4">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-casino-muted">{t('profile.eligibleForYou')}</h3>
          <ul className="space-y-2">
            {offers.map((o) => (
              <li
                key={o.promotion_version_id}
                className="rounded-casino-md border border-white/[0.06] bg-casino-elevated/40 px-3 py-2 text-sm"
              >
                <div className="font-semibold text-casino-foreground">
                  {playerBonusDisplayTitle(
                    {
                      title: o.title,
                      description: o.description,
                      promotionVersionId: o.promotion_version_id,
                      bonusType: o.bonus_type,
                    },
                    t('profile.offerFallback'),
                  )}
                </div>
                {o.description ? <p className="mt-1 text-xs text-casino-muted">{o.description}</p> : null}
                <p className="mt-1 text-[11px] text-casino-muted">
                  {o.kind === 'redeem_code' ? t('profile.redeemOrAuto') : t('profile.autoOnDeposit')} ·{' '}
                  {o.schedule_summary ?? t('profile.activeSchedule')}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!loading && bonuses.length > 0 ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-casino-muted">{t('profile.yourBonusInstances')}</h3>
            <div className="flex gap-1 rounded-casino-md border border-white/[0.08] p-0.5">
              {(['active', 'past', 'all'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setListFilter(key)}
                  className={`rounded-casino-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    listFilter === key
                      ? 'bg-casino-primary/20 text-casino-foreground'
                      : 'text-casino-muted hover:text-casino-foreground'
                  }`}
                >
                  {key === 'all' ? t('profile.filterAll') : key === 'past' ? t('profile.filterHistory') : t('profile.filterActive')}
                </button>
              ))}
            </div>
          </div>
          {filteredBonuses.length === 0 ? (
            <p className="text-xs text-casino-muted">{t('profile.nothingInTab')}</p>
          ) : (
            <ul className="space-y-2">
              {filteredBonuses.map((b) => {
                const st = b.status.toLowerCase()
                const canForfeit = st === 'active' || st === 'pending' || st === 'pending_review'
                const detailsOpen = detailsOpenId === b.id
                return (
                  <li
                    key={b.id}
                    className="rounded-casino-md border border-white/[0.06] bg-casino-elevated/40 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 font-semibold text-casino-foreground">
                        {playerBonusDisplayTitle(
                          {
                            title: b.title,
                            promotionVersionId: b.promotion_version_id,
                            bonusType: b.bonus_type,
                          },
                          `Promotion #${b.promotion_version_id}`,
                        )}
                        <span className="ml-2 text-xs font-normal capitalize text-casino-muted">({b.status})</span>
                      </span>
                      <span className="text-xs text-casino-muted">{b.currency}</span>
                    </div>
                    <p className="mt-1 text-xs text-casino-muted">
                      {t('profile.grantedLabel')} {formatMinorUsd(b.granted_amount_minor, lng)} · WR{' '}
                      {formatMinorUsd(b.wr_contributed_minor, lng)} / {formatMinorUsd(b.wr_required_minor, lng)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailsOpenId((x) => (x === b.id ? null : b.id))}
                        className="rounded-casino-sm border border-white/[0.1] px-2 py-1 text-[11px] font-semibold text-casino-foreground hover:bg-white/[0.04]"
                      >
                        {detailsOpen ? t('profile.rulesGamesHide') : t('profile.rulesGamesShow')}
                      </button>
                      {canForfeit ? (
                        <button
                          type="button"
                          disabled={forfeitBusyId === b.id}
                          onClick={() => setForfeitTarget(b)}
                          className="rounded-casino-sm border border-red-500/40 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          {t('profile.forfeit')}
                        </button>
                      ) : null}
                    </div>
                    {detailsOpen ? (
                      <div className="mt-3 rounded-casino-md border border-white/[0.06] bg-casino-card/50 px-2 py-2">
                        <BonusInstanceDetailsPanel
                          details={b.details}
                          infoOpen={detailsOpen}
                          apiFetch={apiFetch}
                          embedded
                        />
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
      {!loading && !err && offers.length === 0 && bonuses.length === 0 ? (
        <p className="text-sm text-casino-muted">{t('profile.noBonusesYet')}</p>
      ) : null}

      <BonusForfeitConfirmModal
        open={forfeitTarget != null}
        bonusTitle={
          forfeitTarget
            ? playerBonusDisplayTitle(
                {
                  title: forfeitTarget.title,
                  promotionVersionId: forfeitTarget.promotion_version_id,
                  bonusType: forfeitTarget.bonus_type,
                },
                `Bonus #${forfeitTarget.promotion_version_id}`,
              )
            : ''
        }
        onCancel={() => setForfeitTarget(null)}
        onConfirm={() => void executeForfeit()}
        busy={forfeitTarget != null && forfeitBusyId === forfeitTarget.id}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  ProfilePage                                                       */
/* ------------------------------------------------------------------ */

export default function ProfilePage() {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const { isAuthenticated, me, refreshProfile, logout, apiFetch } = usePlayerAuth()
  const { data: vipProgram } = useVipProgram()
  const [searchParams] = useSearchParams()
  const settingsPromo = searchParams.get('settings') === 'promo'
  const promoPrefill = searchParams.get('prefill_code') ?? undefined

  const [activeTab, setActiveTab] = useState<ProfileTab>(() => (settingsPromo ? 'settings' : 'overview'))
  const [resendMsg, setResendMsg] = useState<string | null>(null)

  useEffect(() => {
    if (settingsPromo) setActiveTab('settings')
  }, [settingsPromo])

  const { txs: recentTxs, loading: txLoading } = useRecentTransactions(10)
  const allTxPaginated = usePaginatedTransactions(PAGE_SIZE)
  const { stats, loading: statsLoading } = usePlayerStats()

  const resend = useCallback(async () => {
    setResendMsg(null)
    try {
      const res = await apiFetch('/v1/auth/verify-email/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        const p = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(p, res.status, 'POST /v1/auth/verify-email/resend', rid)
        setResendMsg(p?.message ?? t('profile.couldNotSendEmail'))
        return
      }
      setResendMsg(t('profile.resendCheckInbox'))
      void refreshProfile()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/auth/verify-email/resend')
      setResendMsg(t('profile.networkErrorShort'))
    }
  }, [apiFetch, refreshProfile, t])

  if (!isAuthenticated) return <Navigate to="/?auth=login" replace />

  const joinDate = me?.created_at
    ? new Date(me.created_at).toLocaleDateString(lng === 'fr-CA' ? 'fr-CA' : 'en-US', {
        year: 'numeric',
        month: 'long',
      })
    : null

  const tabs = useMemo(
    () =>
      TAB_ORDER.map((key) => ({
        key,
        label:
          key === 'overview'
            ? t('profile.tabOverview')
            : key === 'transactions'
              ? t('profile.tabTransactions')
              : key === 'history'
                ? t('profile.tabHistory')
                : t('profile.tabSettings'),
      })),
    [t],
  )

  const displayName = me?.username || me?.email?.split('@')[0] || 'Player'
  const currentVipTierImage = useMemo(() => {
    const tiers = vipProgram?.tiers ?? []
    if (tiers.length === 0 || !me?.vip_tier) return null
    const byID = typeof me.vip_tier_id === 'number' ? tiers.find((t) => t.id === me.vip_tier_id) : undefined
    const byName = tiers.find((t) => t.name.trim().toLowerCase() === me.vip_tier?.trim().toLowerCase())
    const tier = byID ?? byName
    if (!tier) return null
    const { display } = mergeTierPresentation(tier)
    const raw = display.character_image_url
    if (typeof raw !== 'string' || !raw.trim()) return null
    return playerApiUrl(raw.trim())
  }, [vipProgram?.tiers, me?.vip_tier, me?.vip_tier_id])

  const fmtUsd = (minor: number) => formatMinorUsd(minor, lng)

  return (
    <div className="mx-auto w-full max-w-[1160px] space-y-6 px-5 py-6 sm:px-6 md:px-8 md:py-8">
      {/* Profile Header — avatar + name grouped left; VIP panel right (md+) / below on narrow */}
      <div className="rounded-casino-lg bg-casino-card p-5 sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-6 lg:gap-10">
          <div className="flex min-w-0 flex-1 flex-row items-start gap-3 sm:gap-5">
            <div className="shrink-0">
              <AvatarUpload userId={me?.id} avatarUrl={me?.avatar_url} onUploaded={refreshProfile} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <h1 className="text-xl font-black leading-none text-casino-foreground sm:text-2xl">
                {displayName}
              </h1>
              {joinDate && (
                <span className="text-sm font-semibold text-casino-muted">{t('profile.joined', { date: joinDate })}</span>
              )}
              <div className="mt-1.5 flex flex-wrap gap-2">
                {me?.email_verified ? (
                  <span className="rounded-casino-sm bg-casino-success/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-casino-success">
                    {t('profile.verified')}
                  </span>
                ) : (
                  <span className="rounded-casino-sm bg-casino-warning/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-casino-warning">
                    {t('profile.unverified')}
                  </span>
                )}
                {me?.vip_tier ? (
                  <Link
                    to="/vip"
                    className="inline-flex items-center gap-1 rounded-casino-sm bg-casino-primary/20 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-casino-primary ring-1 ring-casino-primary/35 transition hover:bg-casino-primary/30"
                  >
                    {currentVipTierImage ? (
                      <img src={currentVipTierImage} alt={me.vip_tier} className="h-4 w-4 rounded-full object-cover" />
                    ) : (
                      <IconCrown size={12} aria-hidden />
                    )}
                    VIP · {me.vip_tier}
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
          <VipProgressPanel className="w-full shrink-0 md:w-[min(280px,36vw)] md:max-w-sm lg:w-72" lng={lng} />
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={<IconCoins size={24} />}
          label={t('profile.statTotalWagered')}
          value={statsLoading ? '…' : fmtUsd(stats.totalWagered)}
        />
        <StatCard
          icon={<IconDice5 size={24} />}
          label={t('profile.statTotalBets')}
          value={statsLoading ? '…' : stats.totalBets.toLocaleString(lng === 'fr-CA' ? 'fr-CA' : 'en-US')}
        />
        <StatCard
          icon={<IconTrophy size={24} />}
          label={t('profile.statHighestWin')}
          value={statsLoading ? '…' : fmtUsd(stats.highestWin)}
        />
        <StatCard
          icon={<IconTrendingUp size={24} />}
          label={t('profile.statNetProfit')}
          value={
            statsLoading
              ? '…'
              : stats.netProfit !== 0
                ? `${stats.netProfit > 0 ? '+' : ''}${fmtUsd(stats.netProfit)}`
                : '$0.00'
          }
          isProfit={stats.netProfit > 0}
        />
      </div>

      {/* Tabs */}
      <div className="scrollbar-none flex gap-6 overflow-x-auto border-b-2 border-white/[0.06] sm:gap-8" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`-mb-[2px] shrink-0 border-b-2 pb-3.5 text-[14px] font-bold transition sm:text-[15px] ${
              activeTab === tab.key
                ? 'border-casino-primary text-casino-foreground'
                : 'border-transparent text-casino-muted hover:text-casino-foreground'
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-6">
            <PlayerBonusesPanel />
            <TransactionsPanel txs={recentTxs.slice(0, 10)} loading={txLoading} />
          </div>
          <div className="flex flex-col gap-6">
            <WalletPanel />
            <AccountSettingsPanel
              email={me?.email}
              displayName={displayName}
              username={me?.username}
              emailVerified={me?.email_verified}
              onResendVerification={() => void resend()}
              resendMsg={resendMsg}
              onChangePassword={() => setActiveTab('settings')}
            />
          </div>
        </div>
      )}

      {activeTab === 'transactions' && (
        <TransactionsPanel
          txs={allTxPaginated.txs}
          loading={allTxPaginated.loading}
          page={allTxPaginated.page}
          hasMore={allTxPaginated.hasMore}
          onNext={allTxPaginated.goNext}
          onPrev={allTxPaginated.goPrev}
          onGoTo={allTxPaginated.goTo}
          paginated
        />
      )}

      {activeTab === 'history' && <GameHistoryPanel />}

      {activeTab === 'settings' && (
        <SettingsPanel
          email={me?.email}
          displayName={displayName}
          username={me?.username}
          emailVerified={me?.email_verified}
          onResendVerification={() => void resend()}
          resendMsg={resendMsg}
          initialSettingsSection={settingsPromo ? 'promo' : undefined}
          promoPrefill={promoPrefill}
        />
      )}

      {/* Quick Links */}
      <div className="flex flex-col gap-2 text-sm">
        {supportUrl && (
          <a href={supportUrl} target="_blank" rel="noreferrer" className="text-casino-primary hover:underline">
            {t('profile.helpSupport')}
          </a>
        )}
        {rgUrl && (
          <a href={rgUrl} target="_blank" rel="noreferrer" className="text-casino-primary hover:underline">
            {t('profile.rgResources')}
          </a>
        )}
      </div>

      <button
        type="button"
        className="w-full rounded-casino-md border border-casino-border py-2.5 text-sm font-semibold text-casino-muted transition hover:bg-casino-elevated"
        onClick={() => void logout()}
      >
        {t('profile.signOut')}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Avatar Upload                                                     */
/* ------------------------------------------------------------------ */

function AvatarUpload({
  userId,
  avatarUrl,
  onUploaded,
}: {
  userId?: string
  avatarUrl?: string
  onUploaded: () => void | Promise<void>
}) {
  const { apiFetch, setAvatarUrl, avatarUrlRevision } = usePlayerAuth()
  const modalTitleId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imgFail, setImgFail] = useState(false)

  const headerAvatarSrc = playerAvatarDisplaySrc(avatarUrl, avatarUrlRevision)
  const modalPreviewSrc =
    pendingPreview ?? playerAvatarDisplaySrc(avatarUrl, avatarUrlRevision)

  useEffect(() => {
    setImgFail(false)
  }, [headerAvatarSrc])

  const revokePendingPreview = useCallback(() => {
    setPendingPreview((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
      return null
    })
    setPendingFile(null)
  }, [])

  const closeModal = useCallback(() => {
    revokePendingPreview()
    setError(null)
    setModalOpen(false)
  }, [revokePendingPreview])

  useEffect(() => {
    if (!modalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modalOpen, closeModal])

  const pickFile = useCallback(
    (file: File) => {
      const maxSize = 2 * 1024 * 1024
      if (file.size > maxSize) {
        setError('File must be under 2 MB')
        return
      }
      setError(null)
      revokePendingPreview()
      const preview = URL.createObjectURL(file)
      setPendingFile(file)
      setPendingPreview(preview)
    },
    [revokePendingPreview],
  )

  const saveAvatar = useCallback(async () => {
    if (!pendingFile || !userId) {
      setError('Choose an image first.')
      return
    }
    setError(null)
    setUploading(true)
    const file = pendingFile
    try {
      const form = new FormData()
      form.append('avatar', file)
      const res = await apiFetch('/v1/auth/profile/avatar', {
        method: 'POST',
        body: form,
      })
      if (res.ok) {
        const j = (await res.json().catch(() => null)) as { avatar_url?: string } | null
        const path = j?.avatar_url?.trim()
        if (path) {
          setAvatarUrl(path)
        }
        closeModal()
        await onUploaded()
        toast.success('Profile picture saved', {
          description: playerApiOriginConfigured()
            ? 'Your new photo is stored on your account.'
            : 'Your new photo is stored. If the image does not show, set VITE_PLAYER_API_ORIGIN (or meta player-api-origin) to your API URL and redeploy.',
        })
      } else {
        const j2 = (await res.json().catch(() => null)) as { message?: string } | null
        setError(j2?.message ?? 'Upload failed')
      }
    } catch {
      setError('Network error')
    } finally {
      setUploading(false)
    }
  }, [apiFetch, closeModal, onUploaded, pendingFile, revokePendingPreview, setAvatarUrl, userId])

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="group relative">
        <button
          type="button"
          onClick={() => {
            setError(null)
            setModalOpen(true)
          }}
          className="relative block rounded-full ring-offset-2 ring-offset-casino-bg transition hover:ring-2 hover:ring-casino-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-casino-primary"
          aria-label="Change profile picture"
        >
          <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border-[3px] border-casino-primary/40 bg-casino-bg sm:size-[88px]">
            {headerAvatarSrc && !imgFail ? (
              <img
                src={headerAvatarSrc}
                alt="Profile"
                className="size-full object-cover"
                onError={() => setImgFail(true)}
              />
            ) : (
              <div className="flex size-full items-center justify-center bg-casino-elevated">
                <IconUser size={32} className="text-casino-muted" />
              </div>
            )}
          </div>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition group-hover:opacity-100">
            {uploading ? (
              <span className="size-5 animate-spin rounded-full border-2 border-white/50 border-t-white" />
            ) : (
              <IconCamera size={20} className="text-white" />
            )}
          </span>
        </button>
      </div>

      {modalOpen ? (
        <div
          className={`fixed inset-0 ${PLAYER_MODAL_OVERLAY_Z} flex items-end justify-center sm:items-center sm:p-4`}
          role="presentation"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            aria-label="Close"
            onClick={() => !uploading && closeModal()}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            className="relative flex w-full max-w-md flex-col overflow-hidden rounded-t-xl border border-casino-border bg-casino-surface shadow-2xl sm:rounded-xl"
          >
            <div className="flex items-center justify-between border-b border-casino-border px-4 py-3">
              <h2 id={modalTitleId} className="text-base font-black text-casino-foreground">
                Profile photo
              </h2>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center text-xl text-casino-muted transition hover:text-casino-foreground disabled:opacity-40"
                onClick={() => !uploading && closeModal()}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              <div className="mx-auto flex size-36 shrink-0 items-center justify-center overflow-hidden rounded-full border-[3px] border-casino-primary/40 bg-casino-bg">
                {modalPreviewSrc ? (
                  <img src={modalPreviewSrc} alt="" className="size-full object-cover" />
                ) : (
                  <IconUser size={48} className="text-casino-muted" />
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) pickFile(f)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="rounded-casino-md border border-casino-border bg-casino-elevated py-2.5 text-sm font-bold text-casino-foreground transition hover:bg-white/[0.06]"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                Choose image…
              </button>
              {error ? (
                <p className="text-center text-xs font-semibold text-casino-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="rounded-casino-md border border-casino-border py-2.5 text-sm font-bold text-casino-muted transition hover:bg-white/[0.04]"
                  onClick={() => !uploading && closeModal()}
                  disabled={uploading}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-casino-md bg-casino-primary py-2.5 text-sm font-black text-white shadow-inner transition hover:brightness-110 disabled:opacity-50"
                  onClick={() => void saveAvatar()}
                  disabled={uploading || !pendingFile}
                >
                  {uploading ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  VIP Progress                                                      */
/* ------------------------------------------------------------------ */

function VipProgressPanel({ className = '', lng }: { className?: string; lng: string }) {
  const { t } = useTranslation()
  const { data, loading, err } = useVipStatus()
  const nextMin = data?.progress?.next_tier_min_wager_minor
  const life = data?.progress?.lifetime_wager_minor ?? 0
  const pct =
    nextMin && nextMin > 0 ? Math.min(100, Math.round((life / nextMin) * 100)) : loading ? 0 : 0
  const remain = data?.progress?.remaining_wager_minor

  return (
    <div
      className={`flex w-full flex-col gap-3 rounded-casino-md border-2 border-casino-primary/45 bg-white/[0.02] p-4 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.12)] ring-1 ring-casino-primary/50 sm:p-5 ${className}`.trim()}
    >
      <div className="flex items-center justify-between text-[13px] font-bold">
        <div className="flex items-center gap-2 text-casino-foreground">
          <IconCrown size={16} className="text-casino-primary" />
          <span>{loading ? '…' : data?.tier ?? t('profile.vipMember')}</span>
        </div>
        <span className="text-xs text-casino-muted">
          {data?.next_tier ? t('profile.vipNextTier', { tier: data.next_tier }) : 'VIP'}
        </span>
      </div>
      {err ? <p className="text-xs text-red-400">{err}</p> : null}
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-casino-primary transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-right text-xs font-bold text-casino-primary">
        {loading
          ? t('profile.loadingEllipsis')
          : remain != null && nextMin
            ? t('profile.vipRemainToGo', { amount: formatMinorUsd(remain, lng) })
            : pct > 0
              ? t('profile.vipPctToward', { pct })
              : t('profile.vipPlayToProgress')}
      </div>
      <Link
        to="/vip"
        className="text-center text-[11px] font-semibold text-casino-muted underline transition hover:text-casino-primary"
      >
        {t('profile.viewVipProgramme')}
      </Link>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Stat Card                                                         */
/* ------------------------------------------------------------------ */

function StatCard({
  icon,
  label,
  value,
  isProfit,
}: {
  icon: React.ReactNode
  label: string
  value: string
  isProfit?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-casino-md bg-casino-card p-4 sm:gap-4 sm:p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-casino-md bg-casino-primary/10 text-casino-primary sm:size-12">
        {icon}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[12px] font-semibold text-casino-muted sm:text-[13px]">{label}</span>
        <span
          className={`text-base font-extrabold tabular-nums leading-none sm:text-lg ${
            isProfit ? 'text-casino-success' : 'text-casino-foreground'
          }`}
        >
          {value}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Transactions Panel (real data)                                    */
/* ------------------------------------------------------------------ */

function TransactionsPanel({
  txs,
  loading,
  page,
  hasMore,
  onNext,
  onPrev,
  onGoTo,
  paginated,
}: {
  txs: Transaction[]
  loading: boolean
  page?: number
  hasMore?: boolean
  onNext?: () => void
  onPrev?: () => void
  onGoTo?: (p: number) => void
  paginated?: boolean
}) {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const txHeaders = [t('profile.txColType'), t('profile.txColAmount'), t('profile.txColDate'), t('profile.txColStatus')]
  return (
    <div className="flex flex-col gap-5 rounded-casino-lg bg-casino-card p-5 sm:p-6">
      <h3 className="flex items-center gap-2.5 text-lg font-extrabold text-casino-foreground">
        <IconArrowRightLeft size={20} className="text-casino-primary" />
        {t('profile.recentTransactions')}
      </h3>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="size-6 animate-spin rounded-full border-2 border-casino-muted border-t-casino-primary" />
        </div>
      ) : txs.length === 0 ? (
        <p className="py-10 text-center text-sm text-casino-muted">
          {page != null && page > 0 ? t('profile.txNoMore') : t('profile.txNoneYet')}
        </p>
      ) : (
        <div className="-mx-2 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[540px] border-collapse">
            <thead>
              <tr>
                {txHeaders.map((h) => (
                  <th
                    key={h}
                    className="border-b border-white/[0.04] px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-casino-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txs.map((tx) => {
                const displayType = classifyDisplayType(tx.entry_type, tx.amount_minor)
                const status = classifyStatus(tx.entry_type)
                const isZero = tx.amount_minor === 0
                const isPositive = tx.amount_minor > 0
                return (
                  <tr key={tx.id} className="border-b border-white/[0.04] last:border-b-0">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <TxTypeIcon displayType={displayType} isPositive={isPositive} />
                        <span className="text-sm font-semibold text-[#e2dff0]">
                          {isManualBonusGrant(tx)
                            ? t('profile.manualBonusCredit')
                            : transactionTypeLabel(tx.entry_type, tx.amount_minor, tx, t)}
                          {tx.currency !== 'USDT' ? ` (${tx.currency})` : ''}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`font-mono text-[15px] font-bold ${
                          isZero
                            ? 'text-casino-muted'
                            : isPositive
                              ? 'text-casino-success'
                              : 'text-casino-foreground'
                        }`}
                      >
                        {isZero ? '—' : formatMinorAmount(tx.amount_minor, tx.currency)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-sm font-semibold text-[#e2dff0]">
                      {formatTxDate(tx.created_at, t, lng)}
                    </td>
                    <td className="px-4 py-3.5">
                      <TxStatusBadge status={status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {paginated && page != null && onNext && onPrev && onGoTo && (
        <Pagination page={page} hasMore={hasMore ?? false} onNext={onNext} onPrev={onPrev} onGoTo={onGoTo} />
      )}
    </div>
  )
}

function TxTypeIcon({ displayType, isPositive }: { displayType: TxDisplayType; isPositive: boolean }) {
  const iconMap: Record<TxDisplayType, { bg: string; icon: React.ReactNode }> = {
    received: {
      bg: 'bg-casino-success/10 text-casino-success',
      icon: <IconArrowDown size={14} />,
    },
    sent: {
      bg: 'bg-casino-destructive/10 text-casino-destructive',
      icon: <IconArrowUp size={14} />,
    },
    withdrawal: {
      bg: 'bg-casino-destructive/10 text-casino-destructive',
      icon: <IconArrowUp size={14} />,
    },
    bonus: {
      bg: 'bg-casino-primary/15 text-casino-primary',
      icon: <IconGift size={14} />,
    },
    bonus_forfeit: {
      bg: 'bg-casino-destructive/10 text-casino-destructive',
      icon: <IconLock size={14} />,
    },
    bonus_activation: {
      bg: 'bg-casino-primary/15 text-casino-primary',
      icon: <IconBadgeCheck size={14} />,
    },
    bonus_relinquish: {
      bg: 'bg-amber-500/15 text-amber-200/90',
      icon: <IconArrowRightLeft size={14} />,
    },
    bonus_release: {
      bg: 'bg-casino-success/10 text-casino-success',
      icon: <IconTrendingUp size={14} />,
    },
    refund: {
      bg: isPositive ? 'bg-casino-success/10 text-casino-success' : 'bg-casino-destructive/10 text-casino-destructive',
      icon: <IconArrowRightLeft size={14} />,
    },
    challenge_activity: {
      bg: 'bg-violet-500/15 text-violet-200/90',
      icon: <IconTrophy size={14} />,
    },
  }
  const { bg, icon } = iconMap[displayType] ?? iconMap.bonus
  return (
    <div className={`flex size-7 items-center justify-center rounded-full ${bg}`}>
      {icon}
    </div>
  )
}

function TxStatusBadge({ status }: { status: TxStatus }) {
  const { t } = useTranslation()
  switch (status) {
    case 'completed':
      return (
        <span className="inline-flex items-center rounded-full bg-casino-success/15 px-3 py-1 text-[11px] font-extrabold text-casino-success">
          {t('profile.completed')}
        </span>
      )
    case 'processing':
      return (
        <span className="inline-flex items-center rounded-full bg-casino-warning/15 px-3 py-1 text-[11px] font-extrabold text-casino-warning">
          {t('profile.statusProcessing')}
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center rounded-full bg-casino-destructive/15 px-3 py-1 text-[11px] font-extrabold text-casino-destructive">
          {t('profile.statusFailed')}
        </span>
      )
  }
}

/* ------------------------------------------------------------------ */
/*  Game History Panel (real data from /v1/wallet/game-history)        */
/* ------------------------------------------------------------------ */

type GameStat = {
  game_id: string
  title: string
  category: string
  thumbnail_url: string
  provider: string
  sessions: number
  avg_session_mins: number
  first_played: string
  last_played: string
}

type GameHistoryData = {
  games: GameStat[]
  total_sessions: number
  total_wagered: number
  total_won: number
  total_bets: number
  total_wins: number
  avg_wager: number
}

const GH_POLL_MS = 15_000

function useGameHistory() {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [data, setData] = useState<GameHistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const fetch_ = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/wallet/game-history')
      if (!res.ok || !mountedRef.current) return
      const j = (await res.json()) as GameHistoryData
      if (mountedRef.current) {
        setData(j)
        setLoading(false)
      }
    } catch {
      if (mountedRef.current) setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    mountedRef.current = true
    if (!isAuthenticated) {
      setData(null)
      setLoading(false)
      return
    }
    void fetch_()
    const id = window.setInterval(() => void fetch_(), GH_POLL_MS)
    return () => {
      mountedRef.current = false
      window.clearInterval(id)
    }
  }, [isAuthenticated, fetch_])

  return { data, loading }
}

const CATEGORY_LABELS: Record<string, string> = {
  slots: 'Slots',
  live: 'Live Casino',
  table: 'Table Games',
  crash: 'Crash',
  instant: 'Instant Win',
}

function formatSessionTime(mins: number): string {
  if (mins <= 0) return '--'
  if (mins < 1) return '<1m'
  if (mins < 60) return `${Math.round(mins)}m`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function GameHistoryPanel() {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const { data, loading } = useGameHistory()

  const fmtUsd = (minor: number) => formatMinorUsd(minor, lng)

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-casino-lg bg-casino-card p-12">
        <div className="size-6 animate-spin rounded-full border-2 border-casino-muted border-t-casino-primary" />
      </div>
    )
  }

  if (!data || data.games.length === 0) {
    return (
      <div className="rounded-casino-lg bg-casino-card p-6">
        <h3 className="mb-4 flex items-center gap-2.5 text-lg font-extrabold text-casino-foreground">
          <IconDice5 size={20} className="text-casino-primary" />
          {t('profile.gameHistoryTitle')}
        </h3>
        <p className="py-10 text-center text-sm text-casino-muted">{t('profile.ghEmpty')}</p>
      </div>
    )
  }

  const favourite = data.games[0]

  return (
    <div className="flex flex-col gap-6">
      {/* Favourite Game Hero */}
      <div className="relative overflow-hidden rounded-casino-lg bg-casino-card p-5 sm:p-6">
        <div className="absolute inset-0 bg-gradient-to-r from-casino-primary/[0.06] to-transparent" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-casino-md border border-casino-primary/20 bg-casino-primary/10 sm:size-24">
            {favourite.thumbnail_url ? (
              <img
                src={favourite.thumbnail_url}
                alt={favourite.title}
                className="size-full object-cover"
              />
            ) : (
              <IconStar size={36} className="text-casino-primary" />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <IconStar size={16} className="text-casino-warning" />
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-casino-warning">
                {t('profile.favouriteGameBadge')}
              </span>
            </div>
            <h3 className="text-xl font-black text-casino-foreground sm:text-2xl">
              {favourite.title}
            </h3>
            <div className="flex flex-wrap gap-3 text-[13px] font-semibold text-casino-muted">
              {favourite.category && (
                <span className="rounded-casino-sm bg-white/[0.04] px-2.5 py-1">
                  {CATEGORY_LABELS[favourite.category] ?? favourite.category}
                </span>
              )}
              <span>{favourite.sessions} session{favourite.sessions !== 1 ? 's' : ''}</span>
              {favourite.avg_session_mins > 0 && (
                <span>~{formatSessionTime(favourite.avg_session_mins)} avg</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={<IconDice5 size={24} />}
          label={t('profile.ghStatSessions')}
          value={data.total_sessions.toLocaleString(lng === 'fr-CA' ? 'fr-CA' : 'en-US')}
        />
        <StatCard
          icon={<IconCoins size={24} />}
          label={t('profile.statTotalWagered')}
          value={data.total_wagered > 0 ? fmtUsd(data.total_wagered) : '$0.00'}
        />
        <StatCard
          icon={<IconTrendingUp size={24} />}
          label={t('profile.ghStatAvgWager')}
          value={data.avg_wager > 0 ? fmtUsd(data.avg_wager) : '$0.00'}
        />
        <StatCard
          icon={<IconTrophy size={24} />}
          label={t('profile.statTotalWonLabel')}
          value={data.total_won > 0 ? fmtUsd(data.total_won) : '$0.00'}
        />
      </div>

      {/* Per-Game Table */}
      <div className="flex flex-col gap-5 rounded-casino-lg bg-casino-card p-5 sm:p-6">
        <h3 className="flex items-center gap-2.5 text-lg font-extrabold text-casino-foreground">
          <IconDice5 size={20} className="text-casino-primary" />
          {t('profile.gamesPlayedTitle')}
        </h3>
        <div className="-mx-2 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr>
                {[t('profile.ghColGame'), t('profile.ghColCategory'), t('profile.ghColSessions'), t('profile.ghColAvgPlay'), t('profile.ghColLastPlayed')].map((h) => (
                  <th
                    key={h}
                    className="border-b border-white/[0.04] px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-casino-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.games.map((g) => (
                <tr key={g.game_id} className="border-b border-white/[0.04] last:border-b-0">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-casino-sm bg-white/[0.04]">
                        {g.thumbnail_url ? (
                          <img src={g.thumbnail_url} alt={g.title} className="size-full object-cover" />
                        ) : (
                          <IconDice5 size={16} className="text-casino-muted" />
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-sm font-extrabold text-casino-foreground">{g.title}</span>
                        <span className="text-[11px] font-semibold text-casino-muted">{g.provider}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="rounded-casino-sm bg-white/[0.04] px-2.5 py-1 text-xs font-bold text-casino-muted">
                      {CATEGORY_LABELS[g.category] ?? (g.category || '--')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-sm font-bold text-casino-foreground">
                    {g.sessions}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-casino-muted">
                      <IconClock size={14} className="shrink-0" />
                      {formatSessionTime(g.avg_session_mins)}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-sm font-semibold text-[#e2dff0]">
                    {formatTxDate(g.last_played, t, lng)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Wallet Panel (real per-currency balances)                         */
/* ------------------------------------------------------------------ */

type WalletEntry = {
  currency: string
  balance_minor: number
  cash_minor?: number
  bonus_locked_minor?: number
}

const CURRENCY_META: Record<string, { name: string; color: string; symbol: string }> = {
  USDT: { name: 'Tether', color: '#26a17b', symbol: '$' },
  USDC: { name: 'USDC', color: '#2775ca', symbol: '$' },
  SOL: { name: 'Solana', color: '#14f195', symbol: 'S' },
  BTC: { name: 'Bitcoin', color: '#f7931a', symbol: '₿' },
  ETH: { name: 'Ethereum', color: '#627eea', symbol: 'Ξ' },
  DOGE: { name: 'Dogecoin', color: '#d7b33e', symbol: 'Ð' },
  XRP: { name: 'Ripple', color: '#6f677f', symbol: 'X' },
  LTC: { name: 'Litecoin', color: '#5d8dff', symbol: 'Ł' },
  TRX: { name: 'Tron', color: '#ff0013', symbol: 'T' },
}

function getCurrencyMeta(code: string) {
  return CURRENCY_META[code.toUpperCase()] ?? { name: code, color: '#a099a8', symbol: code.charAt(0) }
}

const WALLET_POLL_MS = 15_000

function useWallets() {
  const { apiFetch, isAuthenticated } = usePlayerAuth()
  const [wallets, setWallets] = useState<WalletEntry[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const fetchWallets = useCallback(async () => {
    try {
      const res = await apiFetch('/v1/wallet/balances')
      if (!mountedRef.current) return
      if (!res.ok) {
        setLoading(false)
        return
      }
      const j = (await res.json()) as { wallets?: WalletEntry[] }
      if (mountedRef.current) {
        setWallets(j.wallets ?? [])
        setLoading(false)
      }
    } catch {
      if (mountedRef.current) setLoading(false)
    }
  }, [apiFetch])

  useEffect(() => {
    mountedRef.current = true
    if (!isAuthenticated) {
      setWallets([])
      setLoading(false)
      return
    }
    void fetchWallets()
    const id = window.setInterval(() => void fetchWallets(), WALLET_POLL_MS)
    return () => {
      mountedRef.current = false
      window.clearInterval(id)
    }
  }, [isAuthenticated, fetchWallets])

  return { wallets, loading }
}

function WalletPanel() {
  const { t, i18n } = useTranslation()
  const lng = i18n.language
  const { wallets, loading } = useWallets()

  return (
    <div className="flex flex-col gap-5 rounded-casino-lg bg-casino-card p-5 sm:p-6">
      <h3 className="flex items-center gap-2.5 text-lg font-extrabold text-casino-foreground">
        <IconWallet size={20} className="text-casino-primary" />
        {t('profile.myWallets')}
      </h3>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="size-5 animate-spin rounded-full border-2 border-casino-muted border-t-casino-primary" />
        </div>
      ) : wallets.length === 0 ? (
        <p className="py-6 text-center text-sm text-casino-muted">{t('profile.walletEmpty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {wallets.map((w) => {
            const meta = getCurrencyMeta(w.currency)
            const bal = (w.balance_minor / 100).toLocaleString(lng === 'fr-CA' ? 'fr-CA' : 'en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
            return (
              <div
                key={w.currency}
                className="flex items-center justify-between rounded-casino-md border border-white/[0.04] bg-white/[0.02] px-4 py-3.5"
              >
                <div className="flex items-center gap-3.5">
                  <div
                    className="flex size-9 items-center justify-center rounded-full text-sm font-bold"
                    style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
                  >
                    {meta.symbol}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-extrabold text-casino-foreground">{w.currency}</span>
                    <span className="text-xs font-semibold text-casino-muted">{meta.name}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[15px] font-extrabold tabular-nums text-casino-foreground">{bal}</span>
                  {w.currency === 'USDT' || w.currency === 'USDC' ? (
                    <span className="text-xs font-semibold text-casino-muted">${bal}</span>
                  ) : (
                    <span className="text-xs font-semibold text-casino-muted">{w.currency}</span>
                  )}
                  <span className="text-[11px] font-semibold text-casino-muted">
                    {t('profile.bonusRemaining')}{' '}
                    <span className="text-casino-foreground">
                      {((w.bonus_locked_minor ?? 0) / 100).toLocaleString(lng === 'fr-CA' ? 'fr-CA' : 'en-US', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Account Settings Panel                                            */
/* ------------------------------------------------------------------ */

function AccountSettingsPanel({
  email,
  displayName,
  username,
  emailVerified,
  onResendVerification,
  resendMsg,
  onChangePassword,
}: {
  email?: string
  displayName: string
  username?: string
  emailVerified?: boolean
  onResendVerification: () => void
  resendMsg: string | null
  onChangePassword: () => void
}) {
  const { t } = useTranslation()
  const { apiFetch, refreshProfile } = usePlayerAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(username ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) setDraft(username ?? '')
  }, [username, editing])

  const save = useCallback(async () => {
    setErr(null)
    const trimmed = draft.trim()
    if (!trimmed) {
      setErr(t('settings.usernameRequired'))
      return
    }
    if (trimmed.length < 3) {
      setErr(t('settings.usernameMinLength'))
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/v1/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed }),
      })
      if (res.ok) {
        setEditing(false)
        setSuccessMsg(t('settings.usernameUpdated'))
        void refreshProfile()
        setTimeout(() => setSuccessMsg(null), 3000)
      } else {
        const j = (await res.json().catch(() => null)) as { message?: string } | null
        setErr(j?.message ?? t('settings.couldNotUpdateUsername'))
      }
    } catch {
      setErr(t('settings.networkError'))
    } finally {
      setSaving(false)
    }
  }, [apiFetch, draft, refreshProfile, t])

  return (
    <div className="flex flex-col gap-5 rounded-casino-lg bg-casino-card p-5 sm:p-6">
      <h3 className="flex items-center gap-2.5 text-lg font-extrabold text-casino-foreground">
        <IconSettings size={20} className="text-casino-primary" />
        {t('profile.accountSettingsTitle')}
      </h3>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-bold text-casino-muted">{t('settings.username')}</label>
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={20}
                className="flex h-11 items-center rounded-casino-sm border border-casino-primary/50 bg-white/[0.015] px-4 text-sm font-semibold text-casino-foreground placeholder:text-casino-muted/60 focus:outline-none focus:ring-1 focus:ring-casino-primary/30"
                placeholder={t('settings.usernamePlaceholder')}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { setEditing(false); setErr(null) } }}
              />
              <p className="text-[11px] text-casino-muted">{t('settings.usernameHint')}</p>
              {err && <span className="text-xs font-semibold text-casino-destructive">{err}</span>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="rounded-casino-sm bg-casino-primary px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {saving ? t('settings.saving') : t('settings.save')}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setErr(null) }}
                  className="rounded-casino-sm border border-casino-border px-4 py-2 text-xs font-bold text-casino-muted transition hover:text-casino-foreground"
                >
                  {t('settings.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex h-11 flex-1 items-center rounded-casino-sm border border-casino-border bg-white/[0.015] px-4 text-sm font-semibold text-casino-muted">
                {username || displayName}
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="shrink-0 text-xs font-bold text-casino-primary hover:underline"
              >
                {t('settings.edit')}
              </button>
            </div>
          )}
          {successMsg && <span className="text-xs font-semibold text-casino-success">{successMsg}</span>}
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-bold text-casino-muted">{t('settings.emailAddress')}</label>
          <div className="flex h-11 items-center rounded-casino-sm border border-casino-border bg-white/[0.015] px-4 text-sm font-semibold text-casino-muted">
            {email ? maskEmail(email) : '…'}
          </div>
        </div>
        {!emailVerified && (
          <div>
            <button
              type="button"
              className="text-sm font-semibold text-casino-warning underline"
              onClick={onResendVerification}
            >
              {t('settings.verifyEmail')}
            </button>
            {resendMsg && <p className="mt-1.5 text-xs text-casino-muted">{resendMsg}</p>}
          </div>
        )}
        <button
          type="button"
          onClick={onChangePassword}
          className="mt-2 flex h-11 items-center justify-center rounded-casino-sm border border-casino-primary/40 text-sm font-bold text-casino-primary transition hover:bg-casino-primary/10"
        >
          {t('settings.changePassword')}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Settings Panel (sidebar + content, like reference design)         */
/* ------------------------------------------------------------------ */

type SettingsSection = 'general' | 'security' | 'privacy' | 'preference' | 'sessions' | 'verify' | 'promo' | 'responsible'

function settingsMenuItems(t: TFunction): { key: SettingsSection; label: string; icon: React.ReactNode }[] {
  return [
    { key: 'general', label: t('settings.sidebar.general'), icon: <IconUser size={18} /> },
    { key: 'security', label: t('settings.sidebar.security'), icon: <IconLock size={18} /> },
    { key: 'privacy', label: t('settings.sidebar.privacy'), icon: <IconEyeOff size={18} /> },
    { key: 'preference', label: t('settings.sidebar.preference'), icon: <IconEye size={18} /> },
    { key: 'sessions', label: t('settings.sidebar.sessions'), icon: <IconUsers size={18} /> },
    { key: 'verify', label: t('settings.sidebar.verify'), icon: <IconBadgeCheck size={18} /> },
    { key: 'promo', label: t('settings.sidebar.promo'), icon: <IconTicket size={18} /> },
    { key: 'responsible', label: t('settings.sidebar.responsible'), icon: <IconGlobe size={18} /> },
  ]
}

function SettingsPanel({
  email,
  displayName,
  username,
  emailVerified,
  onResendVerification,
  resendMsg,
  initialSettingsSection,
  promoPrefill,
}: {
  email?: string
  displayName: string
  username?: string
  emailVerified?: boolean
  onResendVerification: () => void
  resendMsg: string | null
  initialSettingsSection?: SettingsSection
  promoPrefill?: string
}) {
  const { t } = useTranslation()
  const settingsMenu = useMemo(() => settingsMenuItems(t), [t])
  const [section, setSection] = useState<SettingsSection>(initialSettingsSection ?? 'general')

  useEffect(() => {
    if (initialSettingsSection) setSection(initialSettingsSection)
  }, [initialSettingsSection])

  return (
    <div className="flex flex-col gap-0 rounded-casino-lg bg-casino-card md:flex-row">
      {/* Sidebar */}
      <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-white/[0.06] p-3 md:w-52 md:flex-col md:overflow-x-visible md:border-b-0 md:border-r md:p-4 lg:w-56">
        {settingsMenu.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSection(item.key)}
            className={`flex shrink-0 items-center gap-3 rounded-casino-sm px-3.5 py-2.5 text-[13px] font-bold transition md:w-full ${
              section === item.key
                ? 'bg-casino-primary/10 text-casino-primary'
                : 'text-casino-muted hover:bg-white/[0.04] hover:text-casino-foreground'
            }`}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="min-h-[420px] flex-1 p-5 sm:p-6 md:p-8">
        {section === 'general' && (
          <SettingsGeneral
            email={email}
            displayName={displayName}
            username={username}
            emailVerified={emailVerified}
            onResendVerification={onResendVerification}
            resendMsg={resendMsg}
          />
        )}
        {section === 'security' && <SettingsSecurity />}
        {section === 'privacy' && <SettingsPrivacy />}
        {section === 'preference' && <SettingsPreference />}
        {section === 'sessions' && <SettingsSessions />}
        {section === 'verify' && (
          <SettingsVerify
            emailVerified={emailVerified}
            onResendVerification={onResendVerification}
            resendMsg={resendMsg}
          />
        )}
        {section === 'promo' && <SettingsPromo initialCode={promoPrefill} />}
        {section === 'responsible' && <SettingsResponsibleGambling />}
      </div>
    </div>
  )
}

/* ---- General ---- */

function SettingsGeneral({
  email,
  displayName,
  username,
  emailVerified,
  onResendVerification,
  resendMsg,
}: {
  email?: string
  displayName: string
  username?: string
  emailVerified?: boolean
  onResendVerification: () => void
  resendMsg: string | null
}) {
  const { t } = useTranslation()
  const { apiFetch, refreshProfile } = usePlayerAuth()
  const [editingUsername, setEditingUsername] = useState(false)
  const [newUsername, setNewUsername] = useState(username ?? '')
  const [usernameErr, setUsernameErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editingUsername) setNewUsername(username ?? '')
  }, [username, editingUsername])

  const saveUsername = useCallback(async () => {
    setUsernameErr(null)
    const trimmed = newUsername.trim()
    if (!trimmed) {
      setUsernameErr(t('settings.usernameRequired'))
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/v1/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed }),
      })
      if (res.ok) {
        setEditingUsername(false)
        void refreshProfile()
      } else {
        const j = (await res.json().catch(() => null)) as { message?: string } | null
        setUsernameErr(j?.message ?? t('settings.couldNotUpdateUsername'))
      }
    } catch {
      setUsernameErr(t('settings.networkError'))
    } finally {
      setSaving(false)
    }
  }, [apiFetch, newUsername, refreshProfile, t])

  return (
    <>
      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">{t('settings.sidebar.general')}</h3>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-bold text-casino-muted">{t('settings.username')}</label>
          {editingUsername ? (
            <div className="flex flex-col gap-2">
              <SettingsInput
                icon={<IconUser size={16} />}
                placeholder={t('settings.usernamePlaceholder')}
                value={newUsername}
                onChange={setNewUsername}
              />
              {usernameErr && <span className="text-xs font-semibold text-casino-destructive">{usernameErr}</span>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void saveUsername()}
                  className="w-fit rounded-casino-sm bg-casino-primary px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {saving ? t('settings.saving') : t('settings.save')}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingUsername(false); setUsernameErr(null) }}
                  className="w-fit rounded-casino-sm border border-casino-border px-4 py-2 text-xs font-bold text-casino-muted transition hover:text-casino-foreground"
                >
                  {t('settings.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex h-11 flex-1 items-center rounded-casino-sm border border-casino-border bg-white/[0.015] px-4 text-sm font-semibold text-casino-muted">
                {username || displayName}
              </div>
              <button
                type="button"
                onClick={() => { setNewUsername(username ?? ''); setEditingUsername(true) }}
                className="shrink-0 text-xs font-bold text-casino-primary hover:underline"
              >
                {t('settings.edit')}
              </button>
            </div>
          )}
        </div>
        <SettingsField label={t('settings.emailAddress')} value={email ? maskEmail(email) : '…'} />
        {!emailVerified && (
          <div>
            <button
              type="button"
              className="text-sm font-semibold text-casino-warning underline"
              onClick={onResendVerification}
            >
              {t('settings.verifyEmail')}
            </button>
            {resendMsg && <p className="mt-1.5 text-xs text-casino-muted">{resendMsg}</p>}
          </div>
        )}
      </div>
    </>
  )
}

/* ---- Security ---- */

function SettingsSecurity() {
  const { apiFetch } = usePlayerAuth()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [tfaCode, setTfaCode] = useState('')

  const savePassword = useCallback(async () => {
    setPwMsg(null)
    if (!currentPw) { setPwMsg({ ok: false, text: 'Enter your current password' }); return }
    if (!newPw) { setPwMsg({ ok: false, text: 'Enter a new password' }); return }
    if (newPw !== confirmPw) { setPwMsg({ ok: false, text: 'New passwords do not match' }); return }
    if (newPw.length < 12) { setPwMsg({ ok: false, text: 'Password must be at least 12 characters' }); return }
    setSaving(true)
    try {
      const res = await apiFetch('/v1/auth/profile/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      })
      if (res.ok) {
        setPwMsg({ ok: true, text: 'Password updated successfully' })
        setCurrentPw('')
        setNewPw('')
        setConfirmPw('')
      } else {
        const j = (await res.json().catch(() => null)) as { message?: string } | null
        setPwMsg({ ok: false, text: j?.message ?? 'Could not change password' })
      }
    } catch {
      setPwMsg({ ok: false, text: 'Network error' })
    } finally {
      setSaving(false)
    }
  }, [apiFetch, currentPw, newPw, confirmPw])

  return (
    <>
      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">Password</h3>
      <div className="flex flex-col gap-4">
        <SettingsInput
          icon={<IconLock size={16} />}
          placeholder="Current Password"
          type="password"
          value={currentPw}
          onChange={setCurrentPw}
        />
        <SettingsInput
          icon={<IconLock size={16} />}
          placeholder="New Password"
          type="password"
          value={newPw}
          onChange={setNewPw}
        />
        <SettingsInput
          icon={<IconLock size={16} />}
          placeholder="Repeat New Password"
          type="password"
          value={confirmPw}
          onChange={setConfirmPw}
        />
        {pwMsg && (
          <span className={`text-xs font-semibold ${pwMsg.ok ? 'text-casino-success' : 'text-casino-destructive'}`}>
            {pwMsg.text}
          </span>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={() => void savePassword()}
          className="mt-1 w-fit rounded-casino-md bg-casino-primary px-6 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Password'}
        </button>
      </div>

      <div className="my-8 border-t border-white/[0.06]" />

      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">Two Factor</h3>
      <p className="mb-5 text-sm text-casino-muted">
        To keep your account extra secure, keep a two factor authentication enabled.
      </p>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-bold text-casino-muted">Authenticator App Code</label>
          <div className="flex h-11 items-center gap-2 rounded-casino-sm border border-casino-border bg-white/[0.015] px-4">
            <IconShieldCheck size={16} className="shrink-0 text-casino-muted" />
            <span className="select-all font-mono text-sm tracking-wider text-casino-muted">
              BU9D22DQF2NNKONDFDM4U4N4C7
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-bold text-casino-muted">Two Factor Code</label>
          <SettingsInput
            placeholder="Enter 6-digit code"
            value={tfaCode}
            onChange={setTfaCode}
          />
        </div>
        <button
          type="button"
          className="mt-1 w-fit rounded-casino-md border border-casino-primary/40 px-6 py-2.5 text-sm font-bold text-casino-primary transition hover:bg-casino-primary/10"
        >
          Activate
        </button>
      </div>
    </>
  )
}

/* ---- Privacy ---- */

const PREF_ANONYMISE_PUBLIC_NAME = 'anonymise_public_name'

function parsePrefBool(v: unknown): boolean {
  if (v === true) return true
  if (typeof v === 'string') {
    const s = v.toLowerCase().trim()
    return s === 'true' || s === '1' || s === 'yes'
  }
  return false
}

function SettingsPrivacy() {
  const { apiFetch } = usePlayerAuth()
  const [anon, setAnon] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/v1/auth/profile/preferences')
        if (res.ok) {
          const j = (await res.json()) as Record<string, unknown>
          if (!cancelled) {
            setAnon(parsePrefBool(j[PREF_ANONYMISE_PUBLIC_NAME]))
            setLoaded(true)
          }
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch])

  const apply = useCallback(
    async (value: boolean) => {
      setAnon(value)
      setSaved(null)
      try {
        const res = await apiFetch('/v1/auth/profile/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [PREF_ANONYMISE_PUBLIC_NAME]: value }),
        })
        setSaved(res.ok ? 'Saved' : 'Could not save')
      } catch {
        setSaved('Network error')
      }
      window.setTimeout(() => setSaved(null), 2400)
    },
    [apiFetch],
  )

  return (
    <>
      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">Privacy</h3>
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between rounded-casino-md border border-casino-border bg-white/[0.02] px-4 py-3.5">
          <div className="flex min-w-0 flex-col gap-0.5 pr-3">
            <span className="text-sm font-bold text-casino-foreground">Hide public name</span>
            <span className="text-xs leading-relaxed text-casino-muted">
              When on, your public name appears with the centre masked everywhere it is shown — including on your own leaderboard
              row and chat messages (for example dr****ik). That matches what others see so you know you are anonymous. Your profile
              picture stays visible. Deposit, profile, and support areas still use your real account details where required.
            </span>
          </div>
          <ToggleSwitch on={anon} onToggle={(v) => void apply(v)} disabled={!loaded} />
        </div>
      </div>
      {saved && (
        <p className={`mt-3 text-xs font-semibold ${saved === 'Saved' ? 'text-casino-success' : 'text-casino-destructive'}`}>
          {saved}
        </p>
      )}
    </>
  )
}

/* ---- Preference ---- */

function SettingsPreference() {
  const { apiFetch } = usePlayerAuth()
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    email_notifications: false,
    sound_effects: true,
    transaction_alerts: true,
  })
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch('/v1/auth/profile/preferences')
        if (res.ok) {
          const j = (await res.json()) as Record<string, unknown>
          if (!cancelled) {
            setPrefs((prev) => ({
              ...prev,
              email_notifications: parsePrefBool(j.email_notifications ?? prev.email_notifications),
              sound_effects: parsePrefBool(j.sound_effects ?? prev.sound_effects),
              transaction_alerts: parsePrefBool(j.transaction_alerts ?? prev.transaction_alerts),
            }))
            setLoaded(true)
          }
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [apiFetch])

  const toggle = useCallback(
    async (key: string, value: boolean) => {
      setPrefs((p) => ({ ...p, [key]: value }))
      setSaved(null)
      try {
        const res = await apiFetch('/v1/auth/profile/preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        })
        setSaved(res.ok ? 'Saved' : 'Failed to save')
      } catch {
        setSaved('Network error')
      }
      setTimeout(() => setSaved(null), 2000)
    },
    [apiFetch],
  )

  const items: { key: string; label: string; desc: string }[] = [
    { key: 'email_notifications', label: 'Email Notifications', desc: 'Receive promotional emails and updates' },
    { key: 'sound_effects', label: 'Sound Effects', desc: 'Play sounds during gameplay' },
    { key: 'transaction_alerts', label: 'Transaction Alerts', desc: 'Get notified for deposits and withdrawals' },
  ]

  return (
    <>
      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">Preferences</h3>
      <div className="flex flex-col gap-5">
        {items.map((item) => (
          <div key={item.key} className="flex items-center justify-between rounded-casino-md border border-casino-border bg-white/[0.02] px-4 py-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-casino-foreground">{item.label}</span>
              <span className="text-xs text-casino-muted">{item.desc}</span>
            </div>
            <ToggleSwitch
              on={!!prefs[item.key]}
              onToggle={(v) => void toggle(item.key, v)}
              disabled={!loaded}
            />
          </div>
        ))}
      </div>
      {saved && (
        <p className={`mt-3 text-xs font-semibold ${saved === 'Saved' ? 'text-casino-success' : 'text-casino-destructive'}`}>
          {saved}
        </p>
      )}
    </>
  )
}

/* ---- Sessions ---- */

type AuthSessionRow = {
  id: string
  family_id?: string
  created_at: string
  expires_at: string
  last_seen_at: string
  client_ip: string
  user_agent: string
  country_iso2: string
  region: string
  city: string
  device_type: string
  fingerprint_visitor_id: string
  geo_source: string
  has_fingerprint_request: boolean
}

const SESSIONS_PAGE_SIZE = 4

type SessionGroup = {
  /** Best row to show (latest last_seen, then richest IP/region/device). */
  display: AuthSessionRow
  /** Every player_sessions id merged into this card — revoke all on log out. */
  sourceIds: string[]
}

function sessionRichness(s: AuthSessionRow): number {
  let n = 0
  if (String(s.client_ip || '').trim()) n += 4
  if (String(s.country_iso2 || '').trim()) n += 2
  if (String(s.region || '').trim()) n += 1
  if (String(s.device_type || '').trim() && s.device_type !== 'unknown') n += 2
  if (String(s.fingerprint_visitor_id || '').trim()) n += 2
  return n
}

function pickBetterSession(a: AuthSessionRow, b: AuthSessionRow): AuthSessionRow {
  const ta = new Date(a.last_seen_at).getTime()
  const tb = new Date(b.last_seen_at).getTime()
  if (tb !== ta) return tb > ta ? b : a
  const ra = sessionRichness(a)
  const rb = sessionRichness(b)
  if (rb !== ra) return rb > ra ? b : a
  return a
}

/**
 * One card per logical session: same Fingerprint visitorId (multiple DB rows from refresh/login quirks),
 * or same family_id when no visitor id. Rows without visitor id still join a family that has FP metadata.
 */
function dedupeSessions(rows: AuthSessionRow[]): SessionGroup[] {
  if (rows.length === 0) return []

  const asc = [...rows].sort(
    (a, b) => new Date(a.last_seen_at).getTime() - new Date(b.last_seen_at).getTime(),
  )
  const famToFp = new Map<string, string>()
  for (const s of asc) {
    const fp = String(s.fingerprint_visitor_id || '').trim()
    const fam = String(s.family_id || '').trim()
    if (fp && fam) famToFp.set(fam, fp)
  }

  const sorted = [...rows].sort(
    (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime(),
  )

  const byKey = new Map<string, AuthSessionRow[]>()
  for (const s of sorted) {
    const fp = String(s.fingerprint_visitor_id || '').trim()
    const fam = String(s.family_id || '').trim()
    let key: string
    if (fp) {
      key = `fp:${fp}`
    } else if (fam && famToFp.has(fam)) {
      key = `fp:${famToFp.get(fam)!}`
    } else if (fam) {
      key = `fam:${fam}`
    } else {
      key = `id:${s.id}`
    }
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(s)
  }

  const groups: SessionGroup[] = []
  for (const [, list] of byKey) {
    const display = list.reduce((acc, cur) => pickBetterSession(acc, cur))
    const sourceIds = [...new Set(list.map((r) => r.id))]
    groups.push({ display, sourceIds })
  }

  return groups.sort(
    (a, b) =>
      new Date(b.display.last_seen_at).getTime() - new Date(a.display.last_seen_at).getTime(),
  )
}

function groupStableKey(g: SessionGroup): string {
  return [...g.sourceIds].sort().join(',')
}

function formatSessionRegion(s: AuthSessionRow): string {
  const reg = String(s.region || '').trim()
  const cc = String(s.country_iso2 || '').trim().toUpperCase()
  if (reg && cc) return `${reg} (${cc})`
  if (reg) return reg
  if (cc) return cc
  return '—'
}

function SettingsSessions() {
  const { apiFetch, logout } = usePlayerAuth()
  const [sessions, setSessions] = useState<AuthSessionRow[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [currentVisitorId, setCurrentVisitorId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [revokingKey, setRevokingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadErr(null)
    const [res, fp] = await Promise.all([
      apiFetch('/v1/auth/sessions'),
      getFingerprintForAction().catch(() => null),
    ])
    if (fp?.visitorId) setCurrentVisitorId(fp.visitorId)
    else setCurrentVisitorId(null)
    if (!res.ok) {
      setSessions([])
      setLoadErr('Could not load sessions.')
      return
    }
    const j = (await res.json()) as { sessions?: AuthSessionRow[] }
    setSessions(Array.isArray(j.sessions) ? j.sessions : [])
  }, [apiFetch])

  useEffect(() => {
    void load()
  }, [load])

  const deduped = useMemo(() => dedupeSessions(sessions ?? []), [sessions])
  const totalPages = Math.max(1, Math.ceil(deduped.length / SESSIONS_PAGE_SIZE))

  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(0, totalPages - 1)))
  }, [totalPages, deduped.length])

  const pageRows = useMemo(() => {
    const start = page * SESSIONS_PAGE_SIZE
    return deduped.slice(start, start + SESSIONS_PAGE_SIZE)
  }, [deduped, page])

  const revokeSession = async (g: SessionGroup, isThisDevice: boolean) => {
    const rk = groupStableKey(g)
    setRevokingKey(rk)
    try {
      for (const id of g.sourceIds) {
        const res = await apiFetch(`/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (!res.ok) {
          const err = await readApiError(res)
          toast.error(err?.message ?? 'Could not sign out that session.')
          return
        }
      }
      toast.success(isThisDevice ? 'Signed out from this device.' : 'That session was signed out.')
      if (isThisDevice) await logout()
      await load()
    } finally {
      setRevokingKey(null)
    }
  }

  return (
    <>
      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">Active Sessions</h3>
      {loadErr ? <p className="mb-3 text-sm text-casino-destructive">{loadErr}</p> : null}
      {!loadErr && sessions === null ? (
        <p className="text-sm text-casino-muted">Loading…</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {pageRows.map((g) => {
          const s = g.display
          const rk = groupStableKey(g)
          const isThisDevice =
            !!currentVisitorId &&
            (String(s.fingerprint_visitor_id || '').trim() === currentVisitorId ||
              g.sourceIds.some((sid) => {
                const row = sessions?.find((r) => r.id === sid)
                return row && String(row.fingerprint_visitor_id || '').trim() === currentVisitorId
              }))
          return (
            <div
              key={rk}
              className={`flex flex-col gap-3 rounded-casino-md border px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between ${
                isThisDevice
                  ? 'border-casino-primary/20 bg-casino-primary/[0.04]'
                  : 'border-casino-border bg-white/[0.02]'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-casino-primary/10">
                  <IconGlobe size={16} className="text-casino-primary" />
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-casino-foreground">
                      {isThisDevice ? 'This device' : 'Signed-in session'}
                    </span>
                    <span className="rounded-full bg-casino-success/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-casino-success">
                      Active
                    </span>
                  </div>
                  <div className="text-xs text-casino-muted space-y-0.5">
                    <p>
                      <span className="font-semibold text-casino-foreground/90">IP:</span>{' '}
                      {s.client_ip?.trim() || '—'}
                    </p>
                    <p>
                      <span className="font-semibold text-casino-foreground/90">Region:</span>{' '}
                      {formatSessionRegion(s)}
                    </p>
                    <p>
                      <span className="font-semibold text-casino-foreground/90">Device:</span>{' '}
                      {s.device_type?.trim() || '—'}
                    </p>
                    <p>
                      <span className="font-semibold text-casino-foreground/90">Last seen:</span>{' '}
                      {s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : '—'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 sm:pt-0.5">
                <button
                  type="button"
                  disabled={revokingKey !== null}
                  onClick={() => void revokeSession(g, isThisDevice)}
                  className="rounded-casino-md border border-casino-border bg-white/[0.04] px-3 py-2 text-xs font-bold text-casino-foreground transition hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {revokingKey === rk ? 'Signing out…' : 'Log out'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {deduped.length > SESSIONS_PAGE_SIZE ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-casino-border pt-4">
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="inline-flex items-center gap-1 rounded-casino-md border border-casino-border bg-white/[0.04] px-3 py-2 text-xs font-bold text-casino-foreground transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconChevronLeft size={14} /> Previous
          </button>
          <span className="text-xs font-semibold text-casino-muted">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="inline-flex items-center gap-1 rounded-casino-md border border-casino-border bg-white/[0.04] px-3 py-2 text-xs font-bold text-casino-foreground transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <IconChevronRight size={14} />
          </button>
        </div>
      ) : null}
      {sessions && deduped.length === 0 && !loadErr ? (
        <p className="mt-2 text-sm text-casino-muted">No active sessions found.</p>
      ) : null}
      <p className="mt-6 text-sm text-casino-muted">
        If you notice any unfamiliar sessions, change your password immediately.
      </p>
    </>
  )
}

/* ---- Verify ---- */

function SettingsVerify({
  emailVerified,
  onResendVerification,
  resendMsg,
}: {
  emailVerified?: boolean
  onResendVerification: () => void
  resendMsg: string | null
}) {
  return (
    <>
      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">Verification</h3>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-casino-md border border-casino-border bg-white/[0.02] px-4 py-3.5">
          <span className="text-sm font-bold text-casino-foreground">Email Verification</span>
          {emailVerified ? (
            <span className="rounded-full bg-casino-success/15 px-3 py-1 text-[11px] font-extrabold text-casino-success">
              Verified
            </span>
          ) : (
            <span className="rounded-full bg-casino-warning/15 px-3 py-1 text-[11px] font-extrabold text-casino-warning">
              Pending
            </span>
          )}
        </div>
        <div className="flex items-center justify-between rounded-casino-md border border-casino-border bg-white/[0.02] px-4 py-3.5">
          <span className="text-sm font-bold text-casino-foreground">KYC Verification</span>
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-extrabold text-casino-muted">
            Not Started
          </span>
        </div>
        <div className="flex items-center justify-between rounded-casino-md border border-casino-border bg-white/[0.02] px-4 py-3.5">
          <span className="text-sm font-bold text-casino-foreground">Phone Verification</span>
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-extrabold text-casino-muted">
            Not Started
          </span>
        </div>
      </div>
      {!emailVerified && (
        <div className="mt-5">
          <button
            type="button"
            className="text-sm font-semibold text-casino-warning underline"
            onClick={onResendVerification}
          >
            Resend verification email
          </button>
          {resendMsg && <p className="mt-2 text-xs text-casino-muted">{resendMsg}</p>}
        </div>
      )}
    </>
  )
}

/* ---- Promo Code ---- */

function SettingsPromo({ initialCode }: { initialCode?: string }) {
  const { apiFetch } = usePlayerAuth()
  const [code, setCode] = useState(() => initialCode ?? '')

  useEffect(() => {
    if (initialCode) setCode(initialCode)
  }, [initialCode])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const apply = useCallback(async () => {
    const trimmed = code.trim()
    if (!trimmed) { setMsg({ ok: false, text: 'Enter a promo code' }); return }
    setMsg(null)
    setSaving(true)
    try {
      const res = await apiFetch('/v1/auth/profile/redeem-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      })
      if (res.ok) {
        setMsg({ ok: true, text: 'Promo code applied successfully!' })
        setCode('')
      } else {
        const j = (await res.json().catch(() => null)) as { message?: string } | null
        setMsg({ ok: false, text: j?.message ?? 'Invalid promo code' })
      }
    } catch {
      setMsg({ ok: false, text: 'Network error' })
    } finally {
      setSaving(false)
    }
  }, [apiFetch, code])

  return (
    <>
      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">Promo Code</h3>
      <p className="mb-5 text-sm text-casino-muted">
        Enter a promo code to claim bonuses and special rewards.
      </p>
      <div className="flex flex-col gap-4">
        <SettingsInput
          icon={<IconTicket size={16} />}
          placeholder="Enter promo code"
          value={code}
          onChange={setCode}
        />
        {msg && (
          <span className={`text-xs font-semibold ${msg.ok ? 'text-casino-success' : 'text-casino-destructive'}`}>
            {msg.text}
          </span>
        )}
        <button
          type="button"
          disabled={saving}
          onClick={() => void apply()}
          className="mt-1 w-fit rounded-casino-md bg-casino-primary px-6 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {saving ? 'Applying…' : 'Apply Code'}
        </button>
      </div>
    </>
  )
}

/* ---- Responsible Gambling ---- */

function SettingsResponsibleGambling() {
  return (
    <>
      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">Responsible Gambling</h3>
      <p className="mb-5 text-sm text-casino-muted">
        We encourage you to gamble responsibly. Use the tools below to manage your activity.
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-casino-md border border-casino-border bg-white/[0.02] px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-casino-foreground">Deposit Limits</span>
            <span className="text-xs text-casino-muted">Set daily, weekly, or monthly limits</span>
          </div>
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-extrabold text-casino-muted">
            Not Set
          </span>
        </div>
        <div className="flex items-center justify-between rounded-casino-md border border-casino-border bg-white/[0.02] px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-casino-foreground">Loss Limits</span>
            <span className="text-xs text-casino-muted">Set maximum loss amounts per period</span>
          </div>
          <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] font-extrabold text-casino-muted">
            Not Set
          </span>
        </div>
        <div className="flex items-center justify-between rounded-casino-md border border-casino-border bg-white/[0.02] px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-casino-foreground">Self-Exclusion</span>
            <span className="text-xs text-casino-muted">Temporarily or permanently restrict access</span>
          </div>
          <button
            type="button"
            className="rounded-casino-sm border border-casino-destructive/40 px-3 py-1.5 text-[11px] font-extrabold text-casino-destructive transition hover:bg-casino-destructive/10"
          >
            Configure
          </button>
        </div>
      </div>
      {rgUrl && (
        <a
          href={rgUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-casino-primary hover:underline"
        >
          <IconGlobe size={14} />
          More responsible gambling resources
        </a>
      )}
    </>
  )
}

/* ---- Settings shared components ---- */

function SettingsField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[13px] font-bold text-casino-muted">{label}</label>
      <div className="flex h-11 items-center rounded-casino-sm border border-casino-border bg-white/[0.015] px-4 text-sm font-semibold text-casino-muted">
        {value}
      </div>
    </div>
  )
}

function SettingsInput({
  icon,
  placeholder,
  type = 'text',
  value,
  onChange,
}: {
  icon?: React.ReactNode
  placeholder: string
  type?: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex h-11 items-center gap-2.5 rounded-casino-sm border border-casino-border bg-white/[0.015] px-4 focus-within:border-casino-primary/50 focus-within:ring-1 focus-within:ring-casino-primary/20">
      {icon && <span className="shrink-0 text-casino-muted">{icon}</span>}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-full bg-transparent text-sm font-semibold text-casino-foreground placeholder:text-casino-muted/60 focus:outline-none"
      />
    </div>
  )
}

function ToggleSwitch({
  on,
  onToggle,
  disabled,
  defaultOn = false,
}: {
  on?: boolean
  onToggle?: (v: boolean) => void
  disabled?: boolean
  defaultOn?: boolean
}) {
  const [local, setLocal] = useState(defaultOn)
  const checked = on ?? local
  const toggle = () => {
    const next = !checked
    setLocal(next)
    onToggle?.(next)
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={toggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 ${
        checked ? 'bg-casino-primary' : 'bg-white/[0.12]'
      }`}
    >
      <span
        className={`inline-block size-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Pagination                                                        */
/* ------------------------------------------------------------------ */

function Pagination({
  page,
  hasMore,
  onNext,
  onPrev,
  onGoTo,
}: {
  page: number
  hasMore: boolean
  onNext: () => void
  onPrev: () => void
  onGoTo: (p: number) => void
}) {
  const nearbyPages = useMemo(() => {
    const pages: number[] = []
    const start = Math.max(0, page - 2)
    const end = hasMore ? page + 2 : page
    for (let i = start; i <= end; i++) pages.push(i)
    return pages
  }, [page, hasMore])

  if (page === 0 && !hasMore) return null

  return (
    <div className="flex items-center justify-between border-t border-white/[0.04] pt-4">
      <span className="text-xs font-semibold text-casino-muted">
        Page {page + 1}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page === 0}
          onClick={onPrev}
          aria-label="Previous page"
          className="flex size-8 items-center justify-center rounded-casino-sm border border-white/[0.06] text-casino-muted transition enabled:hover:bg-casino-elevated enabled:hover:text-casino-foreground disabled:opacity-30"
        >
          <IconChevronLeft size={16} />
        </button>

        {nearbyPages.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onGoTo(p)}
            className={`flex size-8 items-center justify-center rounded-casino-sm text-xs font-bold transition ${
              p === page
                ? 'bg-casino-primary text-white'
                : 'border border-white/[0.06] text-casino-muted hover:bg-casino-elevated hover:text-casino-foreground'
            }`}
          >
            {p + 1}
          </button>
        ))}

        <button
          type="button"
          disabled={!hasMore}
          onClick={onNext}
          aria-label="Next page"
          className="flex size-8 items-center justify-center rounded-casino-sm border border-white/[0.06] text-casino-muted transition enabled:hover:bg-casino-elevated enabled:hover:text-casino-foreground disabled:opacity-30"
        >
          <IconChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain || user.length <= 3) return email
  return `${user.slice(0, 3)}${'*'.repeat(Math.min(user.length - 3, 5))}@${domain}`
}
