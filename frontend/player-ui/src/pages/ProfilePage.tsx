import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
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
import { cachePlayerAvatarUrl } from '../lib/avatarCache'
import { mergeTierPresentation } from '../lib/vipPresentation'

const supportUrl = import.meta.env.VITE_SUPPORT_URL as string | undefined
const rgUrl = import.meta.env.VITE_RG_URL as string | undefined

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

const TABS: { key: ProfileTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'history', label: 'Game History' },
  { key: 'settings', label: 'Settings' },
]

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

const DISPLAY_TYPE_LABELS: Record<TxDisplayType, string> = {
  received: 'Received',
  sent: 'Sent',
  withdrawal: 'Withdrawal',
  bonus: 'Bonus',
  bonus_forfeit: 'Bonus',
  bonus_activation: 'Bonus',
  bonus_relinquish: 'Bonus',
  bonus_release: 'Bonus',
  refund: 'Refund',
  challenge_activity: 'Challenge',
}

function txChallengeTitle(tx: Transaction): string {
  const m = tx.metadata
  if (m && typeof m === 'object' && typeof (m as Record<string, unknown>).challenge_title === 'string') {
    const t = String((m as Record<string, unknown>).challenge_title).trim()
    if (t) return t
  }
  return 'Challenge'
}

function transactionTypeLabel(entryType: string, amountMinor: number, tx?: Transaction): string {
  switch (entryType) {
    case 'challenge.join':
      return tx ? `Joined challenge — ${txChallengeTitle(tx)}` : 'Joined challenge'
    case 'challenge.prize':
      return tx ? `Challenge payout — ${txChallengeTitle(tx)}` : 'Challenge payout'
    case 'promo.rakeback':
      return 'Rakeback cash claimed'
    case 'promo.daily_hunt_cash':
      return 'Daily hunt cash claimed'
    case 'vip.level_up_cash':
      return 'VIP level-up cash reward'
    case 'promo.grant':
      return 'Bonus credited'
    case 'promo.forfeit':
      return 'Bonus forfeited'
    case 'promo.activation':
      return 'Bonus offer activated'
    case 'promo.relinquish':
      return 'Bonus offer cancelled'
    case 'promo.convert':
      return amountMinor >= 0 ? 'Bonus released to cash' : 'Bonus balance converted'
    default:
      return DISPLAY_TYPE_LABELS[classifyDisplayType(entryType, amountMinor)] ?? 'Transaction'
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

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays === 0) {
    return `Today, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  }
  if (diffDays === 1) {
    return `Yesterday, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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

    const load = async () => {
      setLoading(true)
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

function formatMinorUsd(minor: number) {
  return `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
          setErr('Could not load bonuses')
        }
      } catch {
        if (!cancelled) setErr('Network error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [apiFetch, reloadTick])

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
        <h2 className="text-sm font-extrabold tracking-wide text-casino-foreground">Bonuses</h2>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-casino-muted">
        Eligible deposit offers can credit automatically after a qualifying deposit (when the platform worker is
        running). Promo codes use Settings → Promo Code.
      </p>
      {loading ? <p className="text-sm text-casino-muted">Loading…</p> : null}
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {!loading && bonusLockedMinor != null ? (
        <p className="mb-3 text-xs text-casino-muted">
          Locked bonus balance: <span className="font-semibold text-casino-foreground">{formatMinorUsd(bonusLockedMinor)}</span>
        </p>
      ) : null}
      {!loading && !err && offers.length > 0 ? (
        <div className="mb-4">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-casino-muted">Eligible for you</h3>
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
                    'Offer',
                  )}
                </div>
                {o.description ? <p className="mt-1 text-xs text-casino-muted">{o.description}</p> : null}
                <p className="mt-1 text-[11px] text-casino-muted">
                  {o.kind === 'redeem_code' ? 'Redeem with a code' : 'Auto on deposit'} ·{' '}
                  {o.schedule_summary ?? 'Active'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!loading && bonuses.length > 0 ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-casino-muted">Your bonus instances</h3>
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
                  {key === 'all' ? 'All' : key === 'past' ? 'History' : 'Active'}
                </button>
              ))}
            </div>
          </div>
          {filteredBonuses.length === 0 ? (
            <p className="text-xs text-casino-muted">Nothing in this tab.</p>
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
                      Granted {formatMinorUsd(b.granted_amount_minor)} · WR {formatMinorUsd(b.wr_contributed_minor)} /{' '}
                      {formatMinorUsd(b.wr_required_minor)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailsOpenId((x) => (x === b.id ? null : b.id))}
                        className="rounded-casino-sm border border-white/[0.1] px-2 py-1 text-[11px] font-semibold text-casino-foreground hover:bg-white/[0.04]"
                      >
                        {detailsOpen ? 'Hide rules & games' : 'Rules & games'}
                      </button>
                      {canForfeit ? (
                        <button
                          type="button"
                          disabled={forfeitBusyId === b.id}
                          onClick={() => setForfeitTarget(b)}
                          className="rounded-casino-sm border border-red-500/40 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          Forfeit
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
        <p className="text-sm text-casino-muted">No active bonuses yet. Published deposit offers appear here when you qualify.</p>
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
        setResendMsg(p?.message ?? 'Could not send email')
        return
      }
      setResendMsg('Check your inbox for a new verification link.')
      void refreshProfile()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/auth/verify-email/resend')
      setResendMsg('Network error.')
    }
  }, [apiFetch, refreshProfile])

  if (!isAuthenticated) return <Navigate to="/?auth=login" replace />

  const joinDate = me?.created_at
    ? new Date(me.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
    : null

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

  const fmtUsd = (minor: number) =>
    `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  return (
    <div className="mx-auto w-full max-w-[1160px] space-y-6 px-5 py-6 sm:px-6 md:px-8 md:py-8">
      {/* Profile Header */}
      <div className="flex flex-col gap-6 rounded-casino-lg bg-casino-card p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-5 sm:gap-6">
          <AvatarUpload userId={me?.id} avatarUrl={me?.avatar_url} onUploaded={refreshProfile} />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl font-black leading-none text-casino-foreground sm:text-2xl">
              {displayName}
            </h1>
            {joinDate && (
              <span className="text-sm font-semibold text-casino-muted">Joined {joinDate}</span>
            )}
            <div className="mt-1.5 flex flex-wrap gap-2">
              {me?.email_verified ? (
                <span className="rounded-casino-sm bg-casino-success/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-casino-success">
                  Verified
                </span>
              ) : (
                <span className="rounded-casino-sm bg-casino-warning/15 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-casino-warning">
                  Unverified
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
        <VipProgressPanel />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={<IconCoins size={24} />}
          label="Total Wagered"
          value={statsLoading ? '…' : fmtUsd(stats.totalWagered)}
        />
        <StatCard
          icon={<IconDice5 size={24} />}
          label="Total Bets"
          value={statsLoading ? '…' : stats.totalBets.toLocaleString()}
        />
        <StatCard
          icon={<IconTrophy size={24} />}
          label="Highest Win"
          value={statsLoading ? '…' : fmtUsd(stats.highestWin)}
        />
        <StatCard
          icon={<IconTrendingUp size={24} />}
          label="Net Profit"
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
        {TABS.map((tab) => (
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
            Help & support
          </a>
        )}
        {rgUrl && (
          <a href={rgUrl} target="_blank" rel="noreferrer" className="text-casino-primary hover:underline">
            Responsible gambling resources
          </a>
        )}
      </div>

      <button
        type="button"
        className="w-full rounded-casino-md border border-casino-border py-2.5 text-sm font-semibold text-casino-muted transition hover:bg-casino-elevated"
        onClick={() => void logout()}
      >
        Sign out
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
  onUploaded: () => void
}) {
  const { apiFetch } = usePlayerAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imgFail, setImgFail] = useState(false)

  const resolvedAvatar = previewUrl ?? (avatarUrl ? playerApiUrl(avatarUrl) : null)

  useEffect(() => {
    setImgFail(false)
  }, [resolvedAvatar])

  const handleFile = useCallback(
    async (file: File) => {
      const maxSize = 2 * 1024 * 1024
      if (file.size > maxSize) {
        setError('File must be under 2 MB')
        return
      }
      setError(null)

      const preview = URL.createObjectURL(file)
      setPreviewUrl(preview)
      setUploading(true)

      try {
        const form = new FormData()
        form.append('avatar', file)
        const res = await apiFetch('/v1/auth/profile/avatar', {
          method: 'POST',
          body: form,
        })
        if (res.ok) {
          const j = (await res.json().catch(() => null)) as { avatar_url?: string } | null
          if (j?.avatar_url?.trim() && userId) {
            cachePlayerAvatarUrl(userId, j.avatar_url.trim())
          }
          if (preview.startsWith('blob:')) {
            URL.revokeObjectURL(preview)
          }
          setPreviewUrl(null)
          onUploaded()
          toast.success('Profile picture saved', {
            description: playerApiOriginConfigured()
              ? 'Your new photo is stored on your account.'
              : 'Your new photo is stored. If the image does not show, set VITE_PLAYER_API_ORIGIN (or meta player-api-origin) to your API URL and redeploy.',
          })
        } else {
          const j = (await res.json().catch(() => null)) as { message?: string } | null
          setError(j?.message ?? 'Upload failed')
          if (preview.startsWith('blob:')) {
            URL.revokeObjectURL(preview)
          }
          setPreviewUrl(null)
        }
      } catch {
        setError('Network error')
        if (preview.startsWith('blob:')) {
          URL.revokeObjectURL(preview)
        }
        setPreviewUrl(null)
      } finally {
        setUploading(false)
      }
    },
    [apiFetch, onUploaded, userId],
  )

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="group relative">
        <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border-[3px] border-casino-primary/40 bg-casino-bg sm:size-[88px]">
          {resolvedAvatar && !imgFail ? (
            <img
              src={resolvedAvatar}
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
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition group-hover:opacity-100"
          aria-label="Upload profile picture"
        >
          {uploading ? (
            <div className="size-5 animate-spin rounded-full border-2 border-white/50 border-t-white" />
          ) : (
            <IconCamera size={20} className="text-white" />
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ''
          }}
        />
      </div>
      {error && <span className="text-[10px] font-semibold text-casino-destructive">{error}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  VIP Progress                                                      */
/* ------------------------------------------------------------------ */

function VipProgressPanel() {
  const { data, loading, err } = useVipStatus()
  const nextMin = data?.progress?.next_tier_min_wager_minor
  const life = data?.progress?.lifetime_wager_minor ?? 0
  const pct =
    nextMin && nextMin > 0 ? Math.min(100, Math.round((life / nextMin) * 100)) : loading ? 0 : 0
  const remain = data?.progress?.remaining_wager_minor

  return (
    <div className="flex w-full max-w-sm flex-col gap-3 rounded-casino-md bg-white/[0.02] p-4 sm:p-5">
      <div className="flex items-center justify-between text-[13px] font-bold">
        <div className="flex items-center gap-2 text-casino-foreground">
          <IconCrown size={16} className="text-casino-primary" />
          <span>{loading ? '…' : data?.tier ?? 'Member'}</span>
        </div>
        <span className="text-xs text-casino-muted">
          {data?.next_tier ? `Next: ${data.next_tier}` : 'VIP'}
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
          ? 'Loading…'
          : remain != null && nextMin
            ? `${formatMinorUsd(remain)} to go`
            : pct > 0
              ? `${pct}% toward next tier`
              : 'Play to progress'}
      </div>
      <Link
        to="/vip"
        className="text-center text-[11px] font-semibold text-casino-muted underline transition hover:text-casino-primary"
      >
        View VIP programme
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
          className={`text-base font-extrabold leading-none sm:text-lg ${
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
  return (
    <div className="flex flex-col gap-5 rounded-casino-lg bg-casino-card p-5 sm:p-6">
      <h3 className="flex items-center gap-2.5 text-lg font-extrabold text-casino-foreground">
        <IconArrowRightLeft size={20} className="text-casino-primary" />
        Recent Transactions
      </h3>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="size-6 animate-spin rounded-full border-2 border-casino-muted border-t-casino-primary" />
        </div>
      ) : txs.length === 0 ? (
        <p className="py-10 text-center text-sm text-casino-muted">
          {page != null && page > 0 ? 'No more transactions.' : 'No transactions yet.'}
        </p>
      ) : (
        <div className="-mx-2 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[540px] border-collapse">
            <thead>
              <tr>
                {['Type', 'Amount', 'Date', 'Status'].map((h) => (
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
                            ? 'Manual bonus credit'
                            : transactionTypeLabel(tx.entry_type, tx.amount_minor, tx)}
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
                      {formatDate(tx.created_at)}
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
  switch (status) {
    case 'completed':
      return (
        <span className="inline-flex items-center rounded-full bg-casino-success/15 px-3 py-1 text-[11px] font-extrabold text-casino-success">
          Completed
        </span>
      )
    case 'processing':
      return (
        <span className="inline-flex items-center rounded-full bg-casino-warning/15 px-3 py-1 text-[11px] font-extrabold text-casino-warning">
          Processing
        </span>
      )
    case 'failed':
      return (
        <span className="inline-flex items-center rounded-full bg-casino-destructive/15 px-3 py-1 text-[11px] font-extrabold text-casino-destructive">
          Failed
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
  const { data, loading } = useGameHistory()

  const fmtUsd = (minor: number) =>
    `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

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
          Game History
        </h3>
        <p className="py-10 text-center text-sm text-casino-muted">
          No game history yet. Start playing to see your stats here.
        </p>
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
                Favourite Game
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
          label="Total Sessions"
          value={data.total_sessions.toLocaleString()}
        />
        <StatCard
          icon={<IconCoins size={24} />}
          label="Total Wagered"
          value={data.total_wagered > 0 ? fmtUsd(data.total_wagered) : '$0.00'}
        />
        <StatCard
          icon={<IconTrendingUp size={24} />}
          label="Avg Wager / Bet"
          value={data.avg_wager > 0 ? fmtUsd(data.avg_wager) : '$0.00'}
        />
        <StatCard
          icon={<IconTrophy size={24} />}
          label="Total Won"
          value={data.total_won > 0 ? fmtUsd(data.total_won) : '$0.00'}
        />
      </div>

      {/* Per-Game Table */}
      <div className="flex flex-col gap-5 rounded-casino-lg bg-casino-card p-5 sm:p-6">
        <h3 className="flex items-center gap-2.5 text-lg font-extrabold text-casino-foreground">
          <IconDice5 size={20} className="text-casino-primary" />
          Games Played
        </h3>
        <div className="-mx-2 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr>
                {['Game', 'Category', 'Sessions', 'Avg Play Time', 'Last Played'].map((h) => (
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
                    {formatDate(g.last_played)}
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
  const { wallets, loading } = useWallets()

  return (
    <div className="flex flex-col gap-5 rounded-casino-lg bg-casino-card p-5 sm:p-6">
      <h3 className="flex items-center gap-2.5 text-lg font-extrabold text-casino-foreground">
        <IconWallet size={20} className="text-casino-primary" />
        My Wallets
      </h3>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="size-5 animate-spin rounded-full border-2 border-casino-muted border-t-casino-primary" />
        </div>
      ) : wallets.length === 0 ? (
        <p className="py-6 text-center text-sm text-casino-muted">
          No wallets yet. Make a deposit to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {wallets.map((w) => {
            const meta = getCurrencyMeta(w.currency)
            const bal = (w.balance_minor / 100).toLocaleString('en-US', {
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
                    Bonus remaining:{' '}
                    <span className="text-casino-foreground">
                      {((w.bonus_locked_minor ?? 0) / 100).toLocaleString('en-US', {
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
    if (!trimmed) { setErr('Username is required'); return }
    if (trimmed.length < 3) { setErr('Must be at least 3 characters'); return }
    setSaving(true)
    try {
      const res = await apiFetch('/v1/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: trimmed }),
      })
      if (res.ok) {
        setEditing(false)
        setSuccessMsg('Username updated!')
        void refreshProfile()
        setTimeout(() => setSuccessMsg(null), 3000)
      } else {
        const j = (await res.json().catch(() => null)) as { message?: string } | null
        setErr(j?.message ?? 'Could not update username')
      }
    } catch {
      setErr('Network error')
    } finally {
      setSaving(false)
    }
  }, [apiFetch, draft, refreshProfile])

  return (
    <div className="flex flex-col gap-5 rounded-casino-lg bg-casino-card p-5 sm:p-6">
      <h3 className="flex items-center gap-2.5 text-lg font-extrabold text-casino-foreground">
        <IconSettings size={20} className="text-casino-primary" />
        Account Settings
      </h3>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-bold text-casino-muted">Username</label>
          {editing ? (
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={20}
                className="flex h-11 items-center rounded-casino-sm border border-casino-primary/50 bg-white/[0.015] px-4 text-sm font-semibold text-casino-foreground placeholder:text-casino-muted/60 focus:outline-none focus:ring-1 focus:ring-casino-primary/30"
                placeholder="Choose a username"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { setEditing(false); setErr(null) } }}
              />
              <p className="text-[11px] text-casino-muted">3-20 characters, letters, numbers, underscores</p>
              {err && <span className="text-xs font-semibold text-casino-destructive">{err}</span>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save()}
                  className="rounded-casino-sm bg-casino-primary px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setErr(null) }}
                  className="rounded-casino-sm border border-casino-border px-4 py-2 text-xs font-bold text-casino-muted transition hover:text-casino-foreground"
                >
                  Cancel
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
                Edit
              </button>
            </div>
          )}
          {successMsg && <span className="text-xs font-semibold text-casino-success">{successMsg}</span>}
        </div>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-bold text-casino-muted">Email Address</label>
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
              Verify your email
            </button>
            {resendMsg && <p className="mt-1.5 text-xs text-casino-muted">{resendMsg}</p>}
          </div>
        )}
        <button
          type="button"
          onClick={onChangePassword}
          className="mt-2 flex h-11 items-center justify-center rounded-casino-sm border border-casino-primary/40 text-sm font-bold text-casino-primary transition hover:bg-casino-primary/10"
        >
          Change Password
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Settings Panel (sidebar + content, like reference design)         */
/* ------------------------------------------------------------------ */

type SettingsSection = 'general' | 'security' | 'privacy' | 'preference' | 'sessions' | 'verify' | 'promo' | 'responsible'

const SETTINGS_MENU: { key: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: 'General', icon: <IconUser size={18} /> },
  { key: 'security', label: 'Security', icon: <IconLock size={18} /> },
  { key: 'privacy', label: 'Privacy', icon: <IconEyeOff size={18} /> },
  { key: 'preference', label: 'Preference', icon: <IconEye size={18} /> },
  { key: 'sessions', label: 'Sessions', icon: <IconUsers size={18} /> },
  { key: 'verify', label: 'Verify', icon: <IconBadgeCheck size={18} /> },
  { key: 'promo', label: 'Promo Code', icon: <IconTicket size={18} /> },
  { key: 'responsible', label: 'Responsible Gambling', icon: <IconGlobe size={18} /> },
]

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
  const [section, setSection] = useState<SettingsSection>(initialSettingsSection ?? 'general')

  useEffect(() => {
    if (initialSettingsSection) setSection(initialSettingsSection)
  }, [initialSettingsSection])

  return (
    <div className="flex flex-col gap-0 rounded-casino-lg bg-casino-card md:flex-row">
      {/* Sidebar */}
      <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-white/[0.06] p-3 md:w-52 md:flex-col md:overflow-x-visible md:border-b-0 md:border-r md:p-4 lg:w-56">
        {SETTINGS_MENU.map((item) => (
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
      setUsernameErr('Username is required')
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
        setUsernameErr(j?.message ?? 'Could not update username')
      }
    } catch {
      setUsernameErr('Network error')
    } finally {
      setSaving(false)
    }
  }, [apiFetch, newUsername, refreshProfile])

  return (
    <>
      <h3 className="mb-6 text-lg font-extrabold text-casino-foreground">General</h3>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-bold text-casino-muted">Username</label>
          {editingUsername ? (
            <div className="flex flex-col gap-2">
              <SettingsInput
                icon={<IconUser size={16} />}
                placeholder="Choose a username"
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
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingUsername(false); setUsernameErr(null) }}
                  className="w-fit rounded-casino-sm border border-casino-border px-4 py-2 text-xs font-bold text-casino-muted transition hover:text-casino-foreground"
                >
                  Cancel
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
                Edit
              </button>
            </div>
          )}
        </div>
        <SettingsField label="Email Address" value={email ? maskEmail(email) : '…'} />
        {!emailVerified && (
          <div>
            <button
              type="button"
              className="text-sm font-semibold text-casino-warning underline"
              onClick={onResendVerification}
            >
              Verify your email
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

/** One row per browser (visitor id) or session family so duplicate DB rows from the same login surface once. */
function dedupeSessions(rows: AuthSessionRow[]): AuthSessionRow[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime(),
  )
  const byKey = new Map<string, AuthSessionRow>()
  for (const s of sorted) {
    const fp = String(s.fingerprint_visitor_id || '').trim()
    const fam = String(s.family_id || '').trim()
    const key = fp !== '' ? `fp:${fp}` : fam !== '' ? `fam:${fam}` : `id:${s.id}`
    if (!byKey.has(key)) byKey.set(key, s)
  }
  return [...byKey.values()].sort(
    (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime(),
  )
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
  const [revokingId, setRevokingId] = useState<string | null>(null)

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

  const revokeSession = async (s: AuthSessionRow, isThisDevice: boolean) => {
    setRevokingId(s.id)
    try {
      const res = await apiFetch(`/v1/auth/sessions/${encodeURIComponent(s.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await readApiError(res)
        toast.error(err?.message ?? 'Could not sign out that session.')
        return
      }
      toast.success(isThisDevice ? 'Signed out from this device.' : 'That session was signed out.')
      if (isThisDevice) await logout()
      await load()
    } finally {
      setRevokingId(null)
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
        {pageRows.map((s) => {
          const isThisDevice =
            !!currentVisitorId &&
            String(s.fingerprint_visitor_id || '').trim() !== '' &&
            s.fingerprint_visitor_id === currentVisitorId
          return (
            <div
              key={s.id}
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
                  disabled={revokingId !== null}
                  onClick={() => void revokeSession(s, isThisDevice)}
                  className="rounded-casino-md border border-casino-border bg-white/[0.04] px-3 py-2 text-xs font-bold text-casino-foreground transition hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {revokingId === s.id ? 'Signing out…' : 'Log out'}
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
