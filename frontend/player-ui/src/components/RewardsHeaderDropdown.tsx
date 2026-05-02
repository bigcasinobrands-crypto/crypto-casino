import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'

import { usePlayerAuth } from '../playerAuth'
import {
  normalizeRewardsHubPayload,
  type HubBonusInstance,
  type RewardsHubPayload,
} from '../hooks/useRewardsHub'
import { playerBonusDisplayTitle } from '../lib/playerBonusDisplayTitle'
import { IconBarChart3, IconCrown, IconGift, IconZap } from './icons'
import {
  PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT,
  PLAYER_CHROME_CLOSE_REWARDS_EVENT,
  PLAYER_CHROME_CLOSE_WALLET_EVENT,
} from '../lib/playerChromeEvents'

const defaultOpenClass =
  'bg-casino-primary/25 text-white ring-casino-primary/40 [&_svg]:text-white'

/** My Bonuses / rewards flows — match bottom nav “Bonuses” active treatment on mobile & tablet only. */
const routeActiveCompactClass =
  'max-lg:bg-casino-primary/25 max-lg:text-white max-lg:ring-casino-primary/40 max-lg:[&_svg]:text-white'

const panelClass =
  'absolute right-0 top-full z-[60] mt-1.5 max-h-[min(80vh,32rem)] w-[min(100vw-2rem,24rem)] overflow-y-auto overflow-x-hidden rounded-casino-lg border border-white/[0.1] bg-casino-elevated text-casino-foreground shadow-[0_24px_64px_rgba(0,0,0,0.55),0_0_0_1px_rgba(123,97,255,0.12)]'

/** Branded content cards — match My Bonuses / lobby elevated surfaces. */
const sectionCard =
  'rounded-casino-md border border-white/[0.07] bg-casino-card/90 bg-gradient-to-b from-white/[0.06] to-white/[0.01] p-3 shadow-inner shadow-black/30'

const sectionTitle =
  'mb-2.5 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.18em] text-casino-primary'

const iconPill = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-casino-sm bg-casino-primary/18 text-casino-primary'

const ctaPrimary =
  'mt-2.5 flex w-full items-center justify-center rounded-casino-md bg-gradient-to-b from-casino-primary to-casino-primary-dim py-2 text-center text-xs font-extrabold text-white shadow-md shadow-casino-primary/20 ring-1 ring-casino-primary/40 transition hover:brightness-110 active:brightness-95'

const statLine =
  'flex min-h-[1.75rem] items-center justify-between gap-3 border-b border-white/[0.05] py-1.5 last:border-0 last:pb-0 first:pt-0'

const statLabel = 'text-xs font-medium text-casino-muted'

const statValue = 'text-right text-sm font-extrabold tabular-nums text-casino-foreground'

function usdMinor(n: number | undefined) {
  const v = Number(n)
  const safe = Number.isFinite(v) ? v : 0
  return `$${(safe / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Match GET /v1/rewards/hub server strip: non-exempt in-slot first, then oldest created_at. */
function pickStripBonusInstance(list: HubBonusInstance[]): HubBonusInstance | null {
  const act = list.filter((b) => {
    const s = (b.status ?? '').toLowerCase()
    return s === 'active' || s === 'pending' || s === 'pending_review'
  })
  if (act.length === 0) return null
  const sorted = [...act].sort((a, b) => {
    const exA = a.exempt_from_primary_slot ? 1 : 0
    const exB = b.exempt_from_primary_slot ? 1 : 0
    if (exA !== exB) return exA - exB
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  })
  return sorted[0] ?? null
}

function pickHeaderBonusInfo(instances: HubBonusInstance[]): { row: HubBonusInstance; mode: 'wr' | 'awaiting' } | null {
  const strip = pickStripBonusInstance(instances)
  if (strip) return { row: strip, mode: 'wr' }
  const ad = instances.find((b) => (b.status ?? '').toLowerCase() === 'awaiting_deposit')
  if (ad) return { row: ad, mode: 'awaiting' }
  return null
}

type PlayerWalletStats = {
  total_wagered: number
  total_bets: number
  total_won: number
  highest_win: number
  net_profit: number
}

function RewardsSnapshotPanel({
  setOpen,
  loading,
  hub,
  loadErr,
  stats,
}: {
  setOpen: (open: boolean) => void
  loading: boolean
  hub: RewardsHubPayload | null
  loadErr: string | null
  stats: PlayerWalletStats | null
}) {
  const bonus = hub ? pickHeaderBonusInfo(hub.bonus_instances ?? []) : null
  const ag = hub?.aggregates
  const vip = hub?.vip
  const hunt = hub?.hunt

  return (
    <>
      <div className="relative overflow-hidden border-b border-casino-primary/15 bg-gradient-to-r from-casino-primary/14 via-casino-surface/30 to-casino-elevated px-3.5 py-3.5">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_0%_0%,rgba(123,97,255,0.22),transparent_55%)]"
          aria-hidden
        />
        <div className="relative">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.22em] text-casino-primary">Rewards</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-casino-muted">
            Quick view — open full pages for every detail.
          </p>
        </div>
      </div>

      {loading && !hub ? (
        <div className="space-y-2.5 p-2.5" aria-live="polite" aria-busy>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-casino-md border border-white/[0.05] bg-white/[0.04]"
            />
          ))}
        </div>
      ) : loadErr && !hub ? (
        <p className="px-3.5 py-4 text-sm text-casino-destructive">{loadErr}</p>
      ) : (
        <div className="space-y-2.5 p-2.5 pb-3.5">
          <section className={sectionCard}>
            <h3 className={sectionTitle}>
              <span className={iconPill}>
                <IconGift size={14} aria-hidden />
              </span>
              Active bonus
            </h3>
            {bonus ? (
              <p className="mb-2.5 line-clamp-2 text-sm font-extrabold leading-snug text-casino-foreground">
                {playerBonusDisplayTitle(
                  {
                    title: bonus.row.title,
                    description: bonus.row.description,
                    promotionVersionId: bonus.row.promotion_version_id,
                    bonusType: bonus.row.bonus_type,
                  },
                  'Bonus',
                )}
              </p>
            ) : null}
            {!bonus ? (
              <p className="text-[13px] font-medium leading-relaxed text-casino-muted">No active bonus in progress right now.</p>
            ) : bonus.mode === 'awaiting' ? (
              <p className="text-[13px] font-medium leading-relaxed text-casino-muted">
                This offer is on your account — once a qualifying deposit is completed, the bonus and wagering will apply.
              </p>
            ) : null}

            <dl className="mt-1">
              <div className={statLine}>
                <dt className={statLabel}>Wagering left</dt>
                <dd className={statValue}>
                  {bonus?.mode === 'awaiting' ? <span className="text-casino-muted/90">—</span> : usdMinor(ag?.wagering_remaining_minor ?? 0)}
                </dd>
              </div>
              <div className={statLine}>
                <dt className={statLabel}>Locked bonus</dt>
                <dd className={statValue}>{usdMinor(ag?.bonus_locked_minor ?? 0)}</dd>
              </div>
              <div className={statLine}>
                <dt className={statLabel}>Promo granted (this bonus)</dt>
                <dd className={statValue}>{usdMinor(ag?.lifetime_promo_minor ?? 0)}</dd>
              </div>
            </dl>
            {bonus && bonus.mode === 'wr' && (bonus.row.wr_required_minor ?? 0) > 0 ? (
              <p className="mt-2.5 rounded-casino-sm border border-casino-success/15 bg-casino-success/8 px-2.5 py-1.5 text-[11px] text-casino-success">
                Progress: {usdMinor(bonus.row.wr_contributed_minor)} of {usdMinor(bonus.row.wr_required_minor)} wagered
              </p>
            ) : null}
            <Link to="/bonuses" onClick={() => setOpen(false)} className={ctaPrimary}>
              My Bonuses
            </Link>
          </section>

          {hunt && (hunt.next_threshold_wager_minor ?? 0) > 0 ? (
            <section className={sectionCard}>
              <h3 className={sectionTitle}>
                <span className={iconPill}>
                  <IconZap size={14} aria-hidden />
                </span>
                Wager hunt
              </h3>
              <p className="text-[13px] font-semibold leading-relaxed text-casino-foreground">
                {usdMinor(hunt.wager_accrued_minor)} toward next tier
                {typeof hunt.next_threshold_wager_minor === 'number' ? (
                  <span className="text-casino-muted"> · goal {usdMinor(hunt.next_threshold_wager_minor)}</span>
                ) : null}
              </p>
              {typeof hunt.next_reward_minor === 'number' && hunt.next_reward_minor > 0 ? (
                <p className="mt-1.5 text-xs text-casino-muted">Next reward: {usdMinor(hunt.next_reward_minor)}</p>
              ) : null}
            </section>
          ) : null}

          {vip ? (
            <section className={sectionCard}>
              <h3 className={sectionTitle}>
                <span className={iconPill}>
                  <IconCrown size={14} aria-hidden />
                </span>
                VIP
              </h3>
              <p className="text-base font-black uppercase leading-tight tracking-wide text-casino-foreground md:text-lg">
                {vip.tier || '—'}
              </p>
              {vip.next_tier ? <p className="mt-1.5 text-xs text-casino-primary/90">Next: {vip.next_tier}</p> : null}
              <p className="mt-1 text-sm font-medium text-casino-muted">Points: {Number(vip.points ?? 0).toLocaleString()}</p>
              {typeof vip.progress?.lifetime_wager_minor === 'number' ? (
                <p className="mt-2 text-sm font-semibold text-casino-foreground">
                  Lifetime wager: {usdMinor(vip.progress.lifetime_wager_minor)}
                </p>
              ) : null}
              {typeof vip.progress?.remaining_wager_minor === 'number' && vip.progress.remaining_wager_minor > 0 ? (
                <p className="mt-1.5 text-[12px] leading-relaxed text-casino-muted">
                  ≈{usdMinor(vip.progress.remaining_wager_minor)} more wager to the next rank (where configured).
                </p>
              ) : null}
              <Link to="/vip" onClick={() => setOpen(false)} className={ctaPrimary}>
                VIP program
              </Link>
            </section>
          ) : null}

          <section className={sectionCard}>
            <h3 className={sectionTitle}>
              <span className={iconPill}>
                <IconBarChart3 size={14} aria-hidden />
              </span>
              Your play
            </h3>
            {stats ? (
              <dl>
                <div className={statLine}>
                  <dt className={statLabel}>Total wagered</dt>
                  <dd className={statValue}>{usdMinor(stats.total_wagered)}</dd>
                </div>
                <div className={statLine}>
                  <dt className={statLabel}>Bets (rounds)</dt>
                  <dd className={statValue}>{Number(stats.total_bets).toLocaleString()}</dd>
                </div>
                <div className={statLine}>
                  <dt className={statLabel}>Net profit / loss</dt>
                  <dd
                    className={`text-right text-sm font-bold tabular-nums ${
                      (stats.net_profit ?? 0) >= 0 ? 'text-casino-success' : 'text-red-300'
                    }`}
                  >
                    {usdMinor(stats.net_profit)}
                  </dd>
                </div>
                <div className={statLine}>
                  <dt className={statLabel}>Biggest win</dt>
                  <dd className={statValue}>{usdMinor(stats.highest_win)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-[13px] text-casino-muted">Stats will load on your next visit if unavailable.</p>
            )}
            <p className="mt-2.5 text-[10px] font-medium text-casino-muted/80">All-time, from your account history.</p>
          </section>
        </div>
      )}
    </>
  )
}

type RewardsHeaderDropdownProps = {
  className?: string
  openClassName?: string
}

export default function RewardsHeaderDropdown({
  className = '',
  openClassName = defaultOpenClass,
}: RewardsHeaderDropdownProps) {
  const { pathname } = useLocation()
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const [open, setOpen] = useState(false)
  const [hub, setHub] = useState<RewardsHubPayload | null>(null)
  const [stats, setStats] = useState<PlayerWalletStats | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  /** Matches `.casino-shell-mobile-header` breakpoint (<768px) — portal + blur stack above wallet dropdown. */
  const [mobileChrome, setMobileChrome] = useState(false)

  const load = useCallback(async () => {
    if (!isAuthenticated) return
    setLoadErr(null)
    setLoading(true)
    try {
      const [rHub, rStats] = await Promise.all([
        apiFetch('/v1/rewards/hub?calendar_days=7'),
        apiFetch('/v1/wallet/stats'),
      ])
      if (!rHub.ok) {
        setLoadErr('Could not load rewards')
        setHub(null)
        return
      }
      const j = await rHub.json()
      setHub(normalizeRewardsHubPayload(j))
      if (!rStats.ok) {
        setStats(null)
      } else {
        const s = (await rStats.json()) as PlayerWalletStats
        setStats({
          total_wagered: typeof s?.total_wagered === 'number' ? s.total_wagered : 0,
          total_bets: typeof s?.total_bets === 'number' ? s.total_bets : 0,
          total_won: typeof s?.total_won === 'number' ? s.total_won : 0,
          highest_win: typeof s?.highest_win === 'number' ? s.highest_win : 0,
          net_profit: typeof s?.net_profit === 'number' ? s.net_profit : 0,
        })
      }
    } catch {
      setLoadErr('Could not load rewards')
      setHub(null)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, apiFetch])

  useEffect(() => {
    if (open && isAuthenticated) void load()
  }, [open, isAuthenticated, load])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const sync = () => setMobileChrome(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener(PLAYER_CHROME_CLOSE_REWARDS_EVENT, close)
    return () => window.removeEventListener(PLAYER_CHROME_CLOSE_REWARDS_EVENT, close)
  }, [])

  useEffect(() => {
    if (open && mobileChrome) {
      window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_WALLET_EVENT))
    }
  }, [open, mobileChrome])

  useEffect(() => {
    if (open) {
      window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT))
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (mobileChrome) return
    function onDoc(e: MouseEvent) {
      const el = rootRef.current
      if (el && !el.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, mobileChrome])

  if (!isAuthenticated) return null

  const onBonusesRoute = pathname.startsWith('/bonuses')
  const triggerClasses = [
    className,
    open ? openClassName : '',
    !open && onBonusesRoute ? routeActiveCompactClass : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={rootRef} className="relative inline-flex shrink-0">
      <button
        type="button"
        className={triggerClasses}
        aria-label="Rewards — bonus and VIP snapshot"
        aria-expanded={open}
        aria-haspopup="true"
        aria-current={onBonusesRoute ? 'page' : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <IconGift size={18} aria-hidden />
        <span className="hidden max-w-[4.5rem] truncate text-[10px] font-extrabold uppercase leading-none tracking-wide min-[1280px]:inline">
          Rewards
        </span>
      </button>

      {open && !mobileChrome ? (
        <div
          className={`${panelClass} scrollbar-casino overscroll-y-contain`}
          role="region"
          aria-label="Rewards snapshot"
        >
          <RewardsSnapshotPanel
            setOpen={setOpen}
            loading={loading}
            hub={hub}
            loadErr={loadErr}
            stats={stats}
          />
        </div>
      ) : null}

      {open && mobileChrome
        ? createPortal(
            <>
              {/*
                Mobile-only scrim: same vertical band as wallet (HeaderWalletBar) so blur reaches the bottom nav.
                z above wallet backdrop (199) / panel (219).
              */}
              <div
                className="fixed z-[228] bg-black/40 backdrop-blur-sm left-0 right-0 top-[calc(64px+env(safe-area-inset-top,0px))] bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]"
                onClick={() => setOpen(false)}
                aria-hidden
              />
              <div
                className="fixed z-[232] left-1/2 top-[calc(64px+env(safe-area-inset-top,0px))] bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-y-auto overflow-x-hidden rounded-casino-lg border border-white/[0.1] bg-casino-elevated text-casino-foreground shadow-[0_24px_64px_rgba(0,0,0,0.55),0_0_0_1px_rgba(123,97,255,0.12)] scrollbar-casino overscroll-y-contain"
                role="dialog"
                aria-modal="true"
                aria-label="Rewards snapshot"
              >
                <RewardsSnapshotPanel
                  setOpen={setOpen}
                  loading={loading}
                  hub={hub}
                  loadErr={loadErr}
                  stats={stats}
                />
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  )
}
