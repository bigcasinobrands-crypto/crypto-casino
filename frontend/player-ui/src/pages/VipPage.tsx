import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { readApiError } from '../api/errors'
import { IconGem } from '../components/icons'
import { VipBenefitIcon } from '../components/vip/VipBenefitIcon'
import { VipLoyaltyHeroBanner } from '../components/vip/VipLoyaltyHeroBanner'
import {
  mergeTierPresentation,
  formatVipWagerThreshold,
  humanizeRebateKey,
  VIP_HERO_TILES,
} from '../lib/vipPresentation'
import { useVipProgram } from '../hooks/useVipProgram'
import {
  useRewardsHub,
  type HubOffer,
  type RakebackBoostReleaseTimerInput,
  type RakebackBoostSlot,
  type RakebackBoostStatus,
  type RewardsHubPayload,
} from '../hooks/useRewardsHub'
import { useVipStatus, type VipTierPerk, type VipTierPerkState } from '../hooks/useVipStatus'
import { tierLadderBarPercent } from '../lib/vipProgressHelpers'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { usePlayerAuth } from '../playerAuth'

function formatScheduleInstant(iso?: string): string {
  if (!iso || typeof iso !== 'string') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function parseIsoMs(iso?: string): number {
  if (!iso || typeof iso !== 'string') return NaN
  const s = iso.trim().replace(/^(\d{4}-\d{2}-\d{2})[ ](\d)/, '$1T$2')
  const ms = new Date(s).getTime()
  return Number.isNaN(ms) ? NaN : ms
}

/** Remaining time until `targetMs` for scheduled VIP bonus tiles (weeks, days, hours, minutes, seconds). */
function formatVipScheduledCountdown(targetMs: number, nowMs: number): string {
  if (Number.isNaN(targetMs)) return '—'
  const remain = targetMs - nowMs
  if (remain <= 0) return '0s'
  let s = Math.floor(remain / 1000)
  const w = Math.floor(s / (7 * 86400))
  s %= 7 * 86400
  const d = Math.floor(s / 86400)
  s %= 86400
  const h = Math.floor(s / 3600)
  s %= 3600
  const m = Math.floor(s / 60)
  const sec = s % 60
  const parts: string[] = []
  if (w > 0) parts.push(`${w}w`)
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  parts.push(`${sec}s`)
  return parts.join(' ')
}

/** Weekly/monthly delivery preview lives in the hero cards; this block is rain-only. */
function VipRainTrack({ hub }: { hub: RewardsHubPayload | null }) {
  const rain = hub?.rain_eligibility
  const showRain =
    rain &&
    (typeof rain.eligible === 'boolean' ||
      (typeof rain.next_round_at === 'string' && rain.next_round_at.trim() !== ''))

  if (!showRain) return null

  return (
    <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
      <div>
        <p className="m-0 text-sm font-semibold text-white/70">Rain</p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/45">Community rain eligibility when the programme is live.</p>
        <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] p-2.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {typeof rain!.eligible === 'boolean' ? (
              <span
                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                  rain!.eligible ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/60'
                }`}
              >
                {rain!.eligible ? 'Eligible' : 'Not eligible'}
              </span>
            ) : null}
            {rain!.next_round_at && rain!.next_round_at.trim() !== '' ? (
              <span className="font-extrabold tabular-nums text-white">{formatScheduleInstant(rain!.next_round_at)}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Two-decimal display for claim cards (matches $0.00 style). */
function formatMoneyMinorCents(minor?: number): string {
  const v = typeof minor === 'number' && Number.isFinite(minor) ? minor : 0
  return `$${(v / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function InfoTip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-white/25 bg-white/5 text-[10px] font-bold text-white/60"
      title={label}
      role="img"
      aria-label={label}
    >
      i
    </span>
  )
}

/** Applied when the player's tier does not include this perk — visual lock only; buttons stay explicitly disabled. */
const VIP_TIER_LOCKED_SURFACE_CLS = 'opacity-[0.42] saturate-50 grayscale contrast-[0.96]'

type RewardsClaimActions = {
  busy: 'rake' | 'rakeWallet' | null
  canClaimRakeBoost: boolean
  canClaimRakeWallet: boolean
  claimRakeBoost: () => void
  claimRakeWallet: () => void
  rakeWalletDisplay: string
  rakeDisplayMain: string
  rakeSub: string | undefined
  rakeBoostSlots: RakebackBoostSlot[] | undefined
  rakeBoostRelease?: RakebackBoostReleaseTimerInput
  rakeClaimIdleCls: string
  rakeClaimReadyCls: string
}

function useRewardsClaimActions({
  hub,
  hubLoading,
  isAuthenticated,
  apiFetch,
  reloadHub,
  reloadVip,
  refreshProfile,
  tierPassiveRakeEligible = true,
  tierRakebackBoostEligible = true,
}: {
  hub: RewardsHubPayload | null
  hubLoading: boolean
  isAuthenticated: boolean
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  reloadHub: () => void
  reloadVip?: () => void
  refreshProfile?: () => void
  /** False when the player's tier has no passive rebate programmes configured. */
  tierPassiveRakeEligible?: boolean
  /** False when the tier has no rakeback boost schedule benefit. */
  tierRakebackBoostEligible?: boolean
}): RewardsClaimActions {
  const [busy, setBusy] = useState<'rake' | 'rakeWallet' | null>(null)
  const rb = hub?.vip?.rakeback_boost
  const rc = hub?.vip?.rakeback_claim

  const canClaimRakeBoost = Boolean(
    isAuthenticated && !hubLoading && tierRakebackBoostEligible && rb?.claimable_now === true,
  )
  const canClaimRakeWallet = Boolean(
    isAuthenticated &&
      !hubLoading &&
      tierPassiveRakeEligible &&
      rc?.claimable_now === true &&
      (rc?.claimable_minor ?? 0) > 0,
  )

  const rakeClaimIdleCls =
    'rounded-lg border border-white/10 bg-white/[0.06] px-5 py-2 text-xs font-extrabold uppercase tracking-wide text-white/38 cursor-not-allowed'
  const rakeClaimReadyCls =
    'rounded-lg bg-gradient-to-b from-amber-600 to-amber-800 px-5 py-2 text-xs font-extrabold uppercase tracking-wide text-white shadow-md hover:brightness-110'
  const claimRakeBoost = useCallback(async () => {
    if (!canClaimRakeBoost) return
    setBusy('rake')
    try {
      const res = await apiFetch('/v1/vip/rakeback-boost/claim', { method: 'POST' })
      if (!res.ok) {
        toastPlayerApiError(await readApiError(res), res.status, 'POST /v1/vip/rakeback-boost/claim')
        return
      }
      toast.success('Rakeback boost activated', { description: 'Your boosted rate applies for the active window.' })
      reloadHub()
      refreshProfile?.()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/vip/rakeback-boost/claim')
    } finally {
      setBusy(null)
    }
  }, [apiFetch, canClaimRakeBoost, reloadHub, refreshProfile, tierRakebackBoostEligible])

  const claimRakeWallet = useCallback(async () => {
    if (!canClaimRakeWallet) return
    setBusy('rakeWallet')
    try {
      const res = await apiFetch('/v1/rewards/rakeback/claim', { method: 'POST' })
      if (!res.ok) {
        toastPlayerApiError(await readApiError(res), res.status, 'POST /v1/rewards/rakeback/claim')
        return
      }
      const j = (await res.json()) as { paid_minor?: number }
      const paid = typeof j.paid_minor === 'number' && Number.isFinite(j.paid_minor) ? j.paid_minor : 0
      toast.success('Rakeback claimed', {
        description:
          paid > 0 ? `${formatMoneyMinorCents(paid)} added to your cash wallet.` : 'Your wallet is up to date.',
      })
      reloadHub()
      reloadVip?.()
      refreshProfile?.()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/rewards/rakeback/claim')
    } finally {
      setBusy(null)
    }
  }, [apiFetch, canClaimRakeWallet, reloadHub, reloadVip, refreshProfile, tierPassiveRakeEligible])

  const rakeWalletDisplay =
    !isAuthenticated ? '$0.00' : hubLoading ? '…' : !tierPassiveRakeEligible ? '—' : formatMoneyMinorCents(rc?.claimable_minor)

  let rakeDisplayMain = '—'
  let rakeSub: string | undefined
  if (isAuthenticated && !hubLoading && tierRakebackBoostEligible) {
    const add = typeof rb?.boost_percent_add === 'number' && rb.boost_percent_add > 0 ? rb.boost_percent_add : null
    if (rb?.active_now && add != null) {
      const p = add
      rakeDisplayMain = `+${p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)}%`
      rakeSub = 'Boost active'
    } else if (rb?.claimable_now) {
      rakeDisplayMain = add != null ? `+${add % 1 === 0 ? add.toFixed(0) : add.toFixed(1)}%` : 'Ready'
      rakeSub = 'Tap Claim in the window'
    } else if (rb?.enabled === true && add != null) {
      rakeDisplayMain = `+${add % 1 === 0 ? add.toFixed(0) : add.toFixed(1)}%`
      rakeSub = 'Extra on top of tier rakeback when you claim'
    }
  }

  return {
    busy,
    canClaimRakeBoost,
    canClaimRakeWallet,
    claimRakeBoost: () => void claimRakeBoost(),
    claimRakeWallet: () => void claimRakeWallet(),
    rakeWalletDisplay,
    rakeDisplayMain,
    rakeSub,
    rakeBoostSlots: rb?.slots,
    rakeBoostRelease:
      rb?.enabled === true
        ? {
            active_now: rb.active_now === true,
            claimable_now: rb.claimable_now === true,
            active_until_at: typeof rb.active_until_at === 'string' ? rb.active_until_at : undefined,
            boost_active_started_at:
              typeof rb.boost_active_started_at === 'string' ? rb.boost_active_started_at : undefined,
            claim_window_start_at:
              typeof rb.claim_window_start_at === 'string' ? rb.claim_window_start_at : undefined,
            claim_window_ends_at:
              typeof rb.claim_window_ends_at === 'string' ? rb.claim_window_ends_at : undefined,
            next_window_start_at:
              typeof rb.next_window_start_at === 'string' ? rb.next_window_start_at : undefined,
            slots: rb.slots,
          }
        : undefined,
    rakeClaimIdleCls,
    rakeClaimReadyCls,
  }
}

function RakebackBoostSlotStrip({
  slots,
  className,
}: {
  slots: RakebackBoostSlot[] | undefined
  /** e.g. centered promo card: `"mx-auto flex justify-center flex-wrap gap-1.5"` */
  className?: string
}) {
  if (!slots?.length) return null
  return (
    <div
      className={className ?? 'ml-auto flex shrink-0 items-center gap-1.5'}
      role="list"
      aria-label="Rakeback boost times today"
    >
      {slots.map((s) => {
        const hot = s.claimable || s.active
        /** Claim recorded for this UTC window and boost is not the one currently running. */
        const spent = s.claimed === true && !s.active
        const parts = [`${s.start_utc} UTC`]
        if (s.active) parts.push('Boost running')
        else if (s.claimable) parts.push('Claim open')
        else if (s.claimed) parts.push('Claimed for this window')
        else parts.push('Not in claim window')
        const title = parts.join(' — ')
        const outer = hot
          ? 'border-emerald-400/90 bg-emerald-500/[0.12] shadow-[0_0_12px_rgba(16,185,129,0.25)]'
          : spent
            ? 'border-white/15 bg-zinc-600/15 opacity-80'
            : 'border-white/20 bg-white/[0.04]'
        const inner = hot
          ? 'bg-emerald-400/25 text-emerald-100'
          : spent
            ? 'bg-zinc-500/25 text-zinc-400'
            : 'bg-white/10 text-white/35'
        return (
          <span
            key={`${s.index}-${s.start_utc}`}
            role="listitem"
            title={title}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 sm:h-8 sm:w-8 ${outer}`}
          >
            <span
              className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[11px] font-bold leading-none sm:h-[18px] sm:w-[18px] sm:text-xs ${inner}`}
              aria-hidden
            >
              ⚡
            </span>
          </span>
        )
      })}
    </div>
  )
}

function parseHubIsoMs(s: string | undefined): number {
  if (!s?.trim()) return NaN
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? NaN : t
}

function utcDayStartMsFromTimestamp(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)
}

/** Remaining time (count down). */
function formatDurationHms(ms: number): string {
  if (ms <= 0) return '0s'
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

/** Elapsed since phase anchor (count up). */
function formatElapsedHms(ms: number): string {
  if (ms <= 0) return '0s'
  const sec = Math.floor(ms / 1000)
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

type RakebackReleasePhase = {
  target: number
  phaseStart: number
  headline: string
  /** When false, hide the fill ratio (unknown anchor). */
  allowFill: boolean
}

function inferRakebackReleasePhase(rb: RakebackBoostReleaseTimerInput, nowMs: number): RakebackReleasePhase | null {
  const activeNow = rb.active_now === true
  const claimableNow = rb.claimable_now === true

  if (activeNow) {
    const target = parseHubIsoMs(rb.active_until_at)
    if (!Number.isNaN(target) && target > nowMs) {
      const started = parseHubIsoMs(rb.boost_active_started_at)
      const hasAnchor = !Number.isNaN(started) && started < target
      return {
        target,
        phaseStart: hasAnchor ? started : nowMs,
        headline: 'Boost active',
        allowFill: hasAnchor,
      }
    }
  }

  if (claimableNow && !activeNow) {
    const target = parseHubIsoMs(rb.claim_window_ends_at)
    const winStart = parseHubIsoMs(rb.claim_window_start_at)
    if (!Number.isNaN(target) && target > nowMs) {
      const hasAnchor = !Number.isNaN(winStart) && winStart < target
      return {
        target,
        phaseStart: hasAnchor ? winStart : nowMs,
        headline: 'Claim window',
        allowFill: hasAnchor,
      }
    }
  }

  let nextMs = parseHubIsoMs(rb.next_window_start_at)
  if (Number.isNaN(nextMs) && rb.slots?.length) {
    let best = Infinity
    for (const s of rb.slots) {
      const w = parseHubIsoMs(s.window_start_at)
      if (!Number.isNaN(w) && w > nowMs && w < best) best = w
    }
    if (best !== Infinity) nextMs = best
  }
  if (Number.isNaN(nextMs) || nextMs <= nowMs) return null

  let phaseStart = utcDayStartMsFromTimestamp(nextMs)
  if (rb.slots?.length) {
    for (const s of rb.slots) {
      const ce = parseHubIsoMs(s.claim_ends_at)
      if (!Number.isNaN(ce) && ce < nextMs && ce <= nowMs) {
        phaseStart = Math.max(phaseStart, ce)
      }
    }
  }

  const span = nextMs - phaseStart
  const allowFill = span >= 30_000 && phaseStart < nextMs

  return {
    target: nextMs,
    phaseStart,
    headline: 'Next boost',
    allowFill,
  }
}

/** Countdown to the next milestone + bar filling toward it; secondary line counts up from phase start. */
function RakebackBoostReleaseTimer({ config }: { config: RakebackBoostReleaseTimerInput }) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const snap = useMemo(() => {
    const nowMs = Date.now()
    const phase = inferRakebackReleasePhase(config, nowMs)
    if (!phase) return null
    const remainingMs = phase.target - nowMs
    const elapsedMs = nowMs - phase.phaseStart
    const span = phase.target - phase.phaseStart
    let fillPct: number | null = null
    if (phase.allowFill && span > 1000) {
      fillPct = Math.min(100, Math.max(0, (elapsedMs / span) * 100))
    }
    let primary = ''
    if (remainingMs <= 0) {
      primary = 'Starting soon'
    } else if (phase.headline === 'Boost active') {
      primary = `Ends in ${formatDurationHms(remainingMs)}`
    } else if (phase.headline === 'Claim window') {
      primary = `Claim closes in ${formatDurationHms(remainingMs)}`
    } else {
      primary = `Opens in ${formatDurationHms(remainingMs)}`
    }
    const secondary = `${formatElapsedHms(elapsedMs)} elapsed`
    const barGradient =
      phase.headline === 'Boost active'
        ? 'from-emerald-500 to-emerald-400'
        : phase.headline === 'Claim window'
          ? 'from-amber-500 to-amber-400'
          : 'from-sky-500 to-cyan-400'
    return { phase, primary, secondary, fillPct, barGradient }
  }, [config, tick])

  if (!snap) return null

  return (
    <div className="border-t border-white/10 bg-black/20 px-4 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-white/70">{snap.phase.headline}</span>
        <div className="flex min-w-0 flex-col items-end text-right">
          <span className="tabular-nums text-[11px] font-semibold text-white/90">{snap.primary}</span>
          <span className="tabular-nums text-[9px] text-white/45">{snap.secondary}</span>
        </div>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={snap.fillPct != null ? Math.round(snap.fillPct) : undefined}
        aria-label="Progress toward next boost release"
      >
        <div
          className={`h-full rounded-full bg-gradient-to-r transition-[width] duration-1000 ease-linear ${snap.barGradient}`}
          style={{ width: snap.fillPct != null ? `${snap.fillPct}%` : '100%', opacity: snap.fillPct != null ? 1 : 0.35 }}
        />
      </div>
      {snap.fillPct == null ? (
        <p className="mt-1 m-0 text-[9px] text-white/38">
          {snap.phase.headline === 'Next boost'
            ? `Next at ${formatScheduleInstant(new Date(snap.phase.target).toISOString())}`
            : `Ends at ${formatScheduleInstant(new Date(snap.phase.target).toISOString())}`}
        </p>
      ) : null}
    </div>
  )
}

function formatRebatePointsDisplay(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)
}

/** Passive VIP rakeback: tier rates + accrued wallet balance to claim (`rakeback_claim`). */
function VipRakebackCard({
  isAuthenticated,
  vipLoading,
  hubLoading,
  vip,
  rakebackBoost,
  claimActions,
  tierPassiveRakeEligible,
}: {
  isAuthenticated: boolean
  vipLoading: boolean
  hubLoading: boolean
  vip: { rebate_percent_add_by_program?: Record<string, number> } | null
  rakebackBoost?: RakebackBoostStatus | null
  claimActions: RewardsClaimActions
  /** Signed-in player tier has no passive rakeback % configured. */
  tierPassiveRakeEligible: boolean
}) {
  const programs = useMemo(() => {
    const m = vip?.rebate_percent_add_by_program
    if (!m || typeof m !== 'object') return [] as [string, number][]
    return Object.entries(m).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v !== 0)
  }, [vip?.rebate_percent_add_by_program])

  const boostKey = rakebackBoost?.rebate_program_key?.trim().toLowerCase() ?? ''
  const tierLocked = Boolean(isAuthenticated && !tierPassiveRakeEligible)

  return (
    <article
      className={`flex h-full min-h-[280px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-casino-surface shadow-[0_12px_40px_rgba(0,0,0,0.35)] ${tierLocked ? VIP_TIER_LOCKED_SURFACE_CLS : ''}`}
    >
      <div className="flex items-center gap-2 px-4 pt-4">
        <h3 className="m-0 shrink-0 text-base font-bold text-white">Rakeback</h3>
        <InfoTip label="Tier % is your passive add on eligible cash play. Periodic rakeback posts to your claimable balance (UTC schedule). Timed boost % applies only to stake during the boost window; when the boost ends that extra rakeback is booked to the same claimable balance. Claim sends the total to your cash wallet." />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-6">
        {VIP_HERO_TILES[0]?.image ? (
          <img
            src={VIP_HERO_TILES[0].image}
            alt=""
            className="h-[140px] w-full max-w-[200px] object-contain"
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="mt-auto space-y-2 border-t border-white/10 bg-black/25 px-4 py-3">
        {!isAuthenticated ? (
          <p className="m-0 text-center text-sm text-white/45">Sign in to see your tier rakeback and claim balance.</p>
        ) : vipLoading || hubLoading ? (
          <p className="m-0 text-center text-sm text-white/45">Loading…</p>
        ) : tierLocked ? (
          <p className="m-0 text-center text-[11px] leading-snug text-white/45">
            Passive rakeback is not part of your current VIP tier. It unlocks automatically when you reach a tier that includes it.
          </p>
        ) : programs.length === 0 ? (
          <p className="m-0 text-center text-[11px] leading-snug text-white/40">
            No passive rakeback add is assigned to your tier in programme data yet.
          </p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {programs.map(([key, pct]) => {
              const matchBoost =
                rakebackBoost?.active_now === true &&
                boostKey !== '' &&
                key.trim().toLowerCase() === boostKey &&
                typeof rakebackBoost.boost_percent_add === 'number' &&
                rakebackBoost.boost_percent_add > 0
              return (
                <li key={key} className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] pb-2 last:border-b-0 last:pb-0">
                  <span className="min-w-0 text-[11px] font-semibold uppercase tracking-wide text-white/50">
                    {humanizeRebateKey(key)}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 text-right">
                    <span className="text-lg font-black tabular-nums text-emerald-300 sm:text-xl">
                      +{formatRebatePointsDisplay(pct)}%
                    </span>
                    {matchBoost ? (
                      <span className="text-base font-black tabular-nums text-amber-300 sm:text-lg">
                        +{formatRebatePointsDisplay(rakebackBoost.boost_percent_add ?? 0)}% boost
                      </span>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {isAuthenticated && rakebackBoost?.active_now === true ? (
          <p className="m-0 text-center text-[10px] leading-snug text-amber-200/90">
            Boost tally (settles into claimable rakeback when boost ends): ~{formatMoneyMinorCents(rakebackBoost.boost_accrued_estimate_minor)}{' '}
            on {formatMoneyMinorCents(rakebackBoost.boost_wager_accrued_minor)} wager this window.
          </p>
        ) : null}
        {isAuthenticated && !vipLoading && programs.length > 0 ? (
          <p className="m-0 text-center text-[10px] text-white/35">Accrues from eligible play; rates are tier-based.</p>
        ) : null}
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            disabled={!claimActions.canClaimRakeWallet || claimActions.busy !== null}
            onClick={claimActions.claimRakeWallet}
            className={
              (claimActions.canClaimRakeWallet && claimActions.busy === null) || claimActions.busy === 'rakeWallet'
                ? claimActions.rakeClaimReadyCls
                : claimActions.rakeClaimIdleCls
            }
          >
            {claimActions.busy === 'rakeWallet' ? '…' : 'Claim'}
          </button>
          <div className="flex items-center gap-2 tabular-nums">
            <span className="text-sm font-bold text-white sm:text-base">{claimActions.rakeWalletDisplay}</span>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
              $
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}

function RakebackBoostCard(a: RewardsClaimActions & { tierBoostLocked: boolean }) {
  const tierLocked = a.tierBoostLocked
  const slots = tierLocked ? undefined : a.rakeBoostSlots
  const anyHot = Boolean(slots?.some((s) => s.claimable || s.active))
  const allWindowsSpent =
    Boolean(slots?.length) && slots!.every((s) => s.claimed && !s.active)
  const centerOrb = anyHot
    ? 'bg-gradient-to-br from-amber-500/35 to-orange-600/25 ring-amber-500/40 text-4xl'
    : allWindowsSpent
      ? 'bg-gradient-to-br from-zinc-600/25 to-zinc-800/40 ring-zinc-500/30 text-zinc-400 text-4xl'
      : 'bg-gradient-to-br from-amber-500/35 to-orange-600/25 ring-amber-500/40 text-4xl opacity-90'

  return (
    <article
      className={`flex h-full min-h-[280px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-casino-surface shadow-[0_12px_40px_rgba(0,0,0,0.35)] ${tierLocked ? VIP_TIER_LOCKED_SURFACE_CLS : ''}`}
    >
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 shrink-0 text-base font-bold text-white">Rakeback boost</h3>
          <InfoTip label="One lightning icon per scheduled UTC window today. Green: claim open or boost running. Gray: already claimed for that window. Timed windows match your VIP tier schedule." />
        </div>
        <RakebackBoostSlotStrip slots={slots} className="mt-3 flex w-full flex-wrap justify-center gap-2 sm:justify-start" />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-6">
        <div
          className={`flex h-[100px] w-[100px] items-center justify-center rounded-full shadow-inner ring-2 transition-colors duration-300 sm:h-[120px] sm:w-[120px] ${centerOrb}`}
          aria-hidden
        >
          ⚡
        </div>
      </div>
      {!tierLocked && a.rakeBoostRelease ? <RakebackBoostReleaseTimer config={a.rakeBoostRelease} /> : null}
      {tierLocked ? (
        <div className="border-t border-white/10 bg-black/20 px-4 py-2.5">
          <p className="m-0 text-center text-[10px] leading-snug text-white/45">
            Timed rakeback boosts are not included in your current tier. They activate when you reach a tier with this benefit.
          </p>
        </div>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/10 bg-black/25 px-4 py-3">
        <button
          type="button"
          disabled={!a.canClaimRakeBoost || a.busy !== null}
          onClick={a.claimRakeBoost}
          className={
            (a.canClaimRakeBoost && a.busy === null) || a.busy === 'rake' ? a.rakeClaimReadyCls : a.rakeClaimIdleCls
          }
        >
          {a.busy === 'rake' ? '…' : 'Claim'}
        </button>
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-2 tabular-nums">
            <span className="text-sm font-bold text-white sm:text-base">{a.rakeDisplayMain}</span>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-600/90 text-sm font-bold text-white">
              %
            </span>
          </div>
          {a.rakeSub ? <span className="max-w-[14rem] text-right text-[10px] text-white/45">{a.rakeSub}</span> : null}
        </div>
      </div>
    </article>
  )
}

function formatWagerMinor(minor?: number): string {
  const v = typeof minor === 'number' && Number.isFinite(minor) ? minor : 0
  const amount = v / 100
  if (amount >= 1000) return `$${(amount / 1000).toFixed(amount >= 100000 ? 0 : 1)}K`
  return `$${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function perkStateBadgeClass(state: VipTierPerkState): string {
  switch (state) {
    case 'active':
      return 'bg-emerald-500/20 text-emerald-300'
    case 'claimable':
      return 'bg-amber-500/20 text-amber-200'
    case 'pending':
      return 'bg-white/10 text-white/70'
    case 'unavailable':
      return 'bg-red-500/15 text-red-300'
    default:
      return 'bg-white/10 text-white/70'
  }
}

function perkStateLabel(state: VipTierPerkState): string {
  return state === 'active' ? 'Active' : state === 'claimable' ? 'Claimable' : state === 'pending' ? 'Pending' : 'Unavailable'
}

export default function VipPage() {
  const { data, loading, err, reload } = useVipProgram()
  const { data: vip, loading: vipLoading, reload: reloadVip } = useVipStatus()
  const { data: hub, loading: hubLoading, reload: reloadHub } = useRewardsHub()
  const { isAuthenticated, apiFetch, refreshProfile } = usePlayerAuth()

  const sortedTiers = useMemo(() => {
    const tiers = data?.tiers ?? []
    return [...tiers].sort((a, b) => a.min_lifetime_wager_minor - b.min_lifetime_wager_minor || a.id - b.id)
  }, [data?.tiers])
  /** No tier_id until lifetime wager meets at least one tier minimum (server assigns NULL below all thresholds). */
  const hasAssignedTier = Boolean(isAuthenticated && vip?.tier_id != null)
  const currentTier = hasAssignedTier ? sortedTiers.find((t) => t.id === vip?.tier_id) ?? null : null
  const tierPerksStrip: VipTierPerk[] | null = useMemo(() => {
    if (!isAuthenticated || !Array.isArray(vip?.tier_perks)) return null
    return vip!.tier_perks!
  }, [isAuthenticated, vip])
  const [openTierId, setOpenTierId] = useState<number | null>(null)
  const currentTierRewards = useMemo(() => {
    if (!isAuthenticated || !currentTier) return []
    const { benefits } = mergeTierPresentation(currentTier)
    const perks = Array.isArray(vip?.tier_perks) ? vip.tier_perks : []
    return benefits.map((b) => {
      const perk = b.benefit_id != null ? perks.find((x) => x.benefit_id === b.benefit_id) : undefined
      return {
        key: `${currentTier.id}-${b.benefit_id ?? b.title}`,
        title: perk?.title?.trim() || b.title,
        description: perk?.description?.trim() || b.description,
        state: perk?.state ?? ('active' as VipTierPerkState),
        icon: b.icon,
        iconColor: b.icon_color,
      }
    })
  }, [isAuthenticated, currentTier, vip?.tier_perks])

  const preview = hub?.vip_delivery_preview

  /** Tier toggles gate eligibility to claim — cards always visible so programme is discoverable. */
  const tierScheduleEligible = useMemo(() => {
    if (!currentTier) return { weekly: false, monthly: false }
    const perks = currentTier.perks ?? {}
    return {
      weekly: perks.weekly_bonus_enabled === true,
      monthly: perks.monthly_bonus_enabled === true,
    }
  }, [currentTier])

  /** Passive rakeback % from VIP status — tier must include rebate programmes. */
  const tierPassiveRakeEligible = useMemo(() => {
    if (!isAuthenticated) return true
    if (!hasAssignedTier) return false
    const m = vip?.rebate_percent_add_by_program
    if (!m || typeof m !== 'object') return false
    return Object.values(m).some((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0)
  }, [isAuthenticated, hasAssignedTier, vip?.rebate_percent_add_by_program])

  /** Tier row must define a rakeback boost schedule benefit (admin VIP programme). */
  const tierRakebackBoostEligible = useMemo(() => {
    if (!isAuthenticated) return true
    if (!hasAssignedTier) return false
    const tb = currentTier?.tier_benefits
    if (!Array.isArray(tb)) return false
    return tb.some((b) => {
      if (b.benefit_type !== 'rakeback_boost_schedule') return false
      const cfg = b.config
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return true
      return (cfg as Record<string, unknown>).display_to_customer !== false
    })
  }, [isAuthenticated, hasAssignedTier, currentTier?.tier_benefits])

  const promoHeroTiles = useMemo(() => {
    type PromoTile =
      | { key: 'weekly'; title: string; img?: string; unlockAt?: string }
      | { key: 'monthly'; title: string; img?: string; unlockAt?: string }
      | { key: 'browse'; title: string; img?: string }
    const tiles: PromoTile[] = [
      {
        key: 'weekly',
        title: 'Weekly bonus',
        img: VIP_HERO_TILES[0]?.image,
        unlockAt: preview?.weekly_next_at?.trim(),
      },
      {
        key: 'monthly',
        title: 'Monthly bonus',
        img: VIP_HERO_TILES[1]?.image,
        unlockAt: preview?.monthly_next_at?.trim(),
      },
      { key: 'browse', title: 'Earn rewards', img: VIP_HERO_TILES[2]?.image },
    ]
    return tiles
  }, [preview?.weekly_next_at, preview?.monthly_next_at])

  const promoHeroGridCls =
    promoHeroTiles.length <= 1
      ? 'grid-cols-1 max-w-sm mx-auto w-full'
      : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 max-w-none'

  const claimActions = useRewardsClaimActions({
    hub,
    hubLoading,
    isAuthenticated,
    apiFetch,
    reloadHub: () => void reloadHub(),
    reloadVip: () => void reloadVip(),
    refreshProfile: () => void refreshProfile(),
    tierPassiveRakeEligible,
    tierRakebackBoostEligible,
  })
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [vipDeliveryClaimBusy, setVipDeliveryClaimBusy] = useState<'weekly' | 'monthly' | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [])

  const weeklyUnlockMs = parseIsoMs(preview?.weekly_next_at)
  const monthlyUnlockMs = parseIsoMs(preview?.monthly_next_at)

  const scheduledOfferByKey = useMemo(() => {
    const offers = Array.isArray(hub?.available_offers) ? hub.available_offers : []
    const currentSort = typeof currentTier?.sort_order === 'number' ? currentTier.sort_order : null

    function offerRequiredTier(offer: HubOffer): number | null {
      const n = offer.offer_details?.audience?.vip_min_tier
      return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
    }

    function eligibleForTier(offer: HubOffer): boolean {
      const req = offerRequiredTier(offer)
      if (req == null) return true
      if (!hasAssignedTier || currentSort == null) return false
      return currentSort >= req
    }

    function pickByTitle(pattern: RegExp): { selected?: HubOffer; tierBlocked: boolean } {
      const matches = offers.filter((o) => pattern.test(o.title ?? ''))
      if (matches.length === 0) return { selected: undefined, tierBlocked: false }
      const eligible = matches.filter(eligibleForTier)
      if (eligible.length > 0) {
        const selected = eligible.sort((a, b) => {
          const ar = offerRequiredTier(a) ?? 0
          const br = offerRequiredTier(b) ?? 0
          return br - ar
        })[0]
        return { selected, tierBlocked: false }
      }
      return { selected: undefined, tierBlocked: true }
    }

    const weekly = pickByTitle(/weekly\s+bonus/i)
    const monthly = pickByTitle(/monthly\s+bonus/i)
    return {
      weekly: weekly.selected,
      monthly: monthly.selected,
      weeklyTierBlocked: weekly.tierBlocked,
      monthlyTierBlocked: monthly.tierBlocked,
    }
  }, [currentTier?.sort_order, hasAssignedTier, hub?.available_offers])

  /** Keep VIP delivery preview/offers aligned with admin automation (next_run / publishing). */
  useEffect(() => {
    if (!isAuthenticated) return
    const id = window.setInterval(() => {
      void reloadHub()
    }, 60_000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void reloadHub()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [isAuthenticated, reloadHub])

  const claimVipScheduled = useCallback(async (kind: 'weekly' | 'monthly') => {
    const unlockMs = kind === 'weekly' ? weeklyUnlockMs : monthlyUnlockMs
    if (Number.isNaN(unlockMs) || nowMs < unlockMs) return
    const offer = kind === 'weekly' ? scheduledOfferByKey.weekly : scheduledOfferByKey.monthly
    if (!offer) {
      toast.error('Bonus not ready', { description: 'This scheduled bonus is not published yet.' })
      return
    }
    setVipDeliveryClaimBusy(kind)
    try {
      const res = await apiFetch('/v1/bonuses/claim-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ promotion_version_id: offer.promotion_version_id }),
      })
      if (!res.ok) {
        const apiErr = await readApiError(res)
        toastPlayerApiError(apiErr, res.status, 'POST /v1/bonuses/claim-offer')
        return
      }
      toast.success(`${kind === 'weekly' ? 'Weekly' : 'Monthly'} bonus claimed`, {
        description: 'Added to My Bonuses. Normal bonus rules still apply.',
      })
      reloadHub()
      refreshProfile()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/bonuses/claim-offer')
    } finally {
      setVipDeliveryClaimBusy(null)
    }
  }, [apiFetch, monthlyUnlockMs, nowMs, refreshProfile, reloadHub, scheduledOfferByKey.monthly, scheduledOfferByKey.weekly, weeklyUnlockMs])

  return (
    <div className="w-full text-casino-foreground">
      <div className="mx-auto max-w-[1180px] px-4 pb-14 pt-6 sm:px-6 lg:px-8 lg:pb-20 lg:pt-10">
        <header className="relative mb-6">
          <h1 className="m-0 text-lg font-black uppercase tracking-[0.2em] text-casino-foreground">Rewards</h1>
          <IconGem size={78} className="pointer-events-none absolute -right-2 -top-6 text-white/5" aria-hidden />
        </header>

        <section className="mb-6 grid gap-4 lg:grid-cols-[1.1fr_1fr] lg:items-stretch lg:gap-6">
          <VipLoyaltyHeroBanner />
          <article className="flex h-full min-h-[232px] flex-col rounded-2xl border border-white/10 bg-casino-elevated p-6">
            {isAuthenticated && !vipLoading ? (
              <div className="flex flex-wrap items-start justify-end gap-2">
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                    hasAssignedTier ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/55'
                  }`}
                >
                  {hasAssignedTier ? 'VIP tier active' : 'Unlock your first tier'}
                </span>
              </div>
            ) : null}
            <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-white/50">VIP tier</p>
            <p className="mt-1 text-3xl font-black uppercase text-white">{vip?.tier ?? currentTier?.name ?? 'Novice'}</p>
            <p className="mt-1 text-[11px] text-white/45">
              Lifetime wager from real-money spins (summed stake on each qualifying game bet). Builds toward tier unlocks.
            </p>
            <div className="mt-3 h-2 rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pink-500 to-red-500 transition-all duration-500"
                style={{
                  width: `${tierLadderBarPercent(
                    vip?.progress?.lifetime_wager_minor ?? 0,
                    vip?.progress?.next_tier_min_wager_minor,
                  )}%`,
                }}
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
              {[
                { label: 'Wagered', value: formatWagerMinor(vip?.progress?.lifetime_wager_minor) },
                { label: 'Next tier', value: formatWagerMinor(vip?.progress?.next_tier_min_wager_minor) },
                { label: 'Remaining', value: formatWagerMinor(vip?.progress?.remaining_wager_minor) },
              ].map((x) => (
                <div key={x.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                  <div className="text-white/65">{x.label}</div>
                  <div className="mt-1 font-extrabold text-white">{isAuthenticated ? x.value : '—'}</div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="mb-8 space-y-4">
          <div className={`grid grid-cols-1 gap-3 ${promoHeroGridCls}`}>
            {promoHeroTiles.map((t) => (
              <article
                key={t.key}
                className={`flex flex-col items-center rounded-2xl border border-white/10 bg-casino-elevated px-4 pb-4 pt-5 text-center shadow-[0_12px_40px_rgba(0,0,0,0.35)] ${
                  isAuthenticated &&
                  (t.key === 'weekly' || t.key === 'monthly') &&
                  !(t.key === 'weekly' ? tierScheduleEligible.weekly : tierScheduleEligible.monthly)
                    ? VIP_TIER_LOCKED_SURFACE_CLS
                    : ''
                }`}
              >
                <p className="m-0 w-full text-left text-xs font-bold uppercase tracking-wide text-white/55">{t.title}</p>
                {t.img ? (
                  <img
                    src={t.img}
                    alt=""
                    className="mt-3 h-[100px] w-full max-w-[160px] rounded-xl object-cover ring-1 ring-white/10"
                    loading="lazy"
                  />
                ) : null}
                {t.key === 'browse' ? (
                  <Link
                    to="/casino/games"
                    className="mt-auto w-full rounded-xl border border-sky-500/70 bg-sky-500/15 py-2.5 text-center text-xs font-extrabold uppercase tracking-wide text-sky-100 no-underline transition hover:bg-sky-500/25"
                  >
                    Browse
                  </Link>
                ) : (
                  (() => {
                    const kind = t.key as 'weekly' | 'monthly'
                    const perkEligible = kind === 'weekly' ? tierScheduleEligible.weekly : tierScheduleEligible.monthly
                    const unlockMs = parseIsoMs(perkEligible ? t.unlockAt : undefined)
                    const unlocked = perkEligible && !Number.isNaN(unlockMs) && nowMs >= unlockMs
                    const offer = kind === 'weekly' ? scheduledOfferByKey.weekly : scheduledOfferByKey.monthly
                    const tierOfferBlocked =
                      kind === 'weekly' ? scheduledOfferByKey.weeklyTierBlocked : scheduledOfferByKey.monthlyTierBlocked
                    const blocked = tierOfferBlocked || !perkEligible
                    const isBusy = vipDeliveryClaimBusy === kind
                    let statusLine: string
                    if (!isAuthenticated) {
                      statusLine = 'Sign in for schedule'
                    } else if (!perkEligible) {
                      statusLine = !hasAssignedTier
                        ? 'Wager to unlock your first VIP tier for scheduled bonuses'
                        : kind === 'weekly'
                          ? 'Weekly bonus not enabled for your VIP tier'
                          : 'Monthly bonus not enabled for your VIP tier'
                    } else if (tierOfferBlocked) {
                      statusLine = 'Offer not available at your tier'
                    } else if (Number.isNaN(unlockMs)) {
                      statusLine = 'Unlock when scheduled'
                    } else if (unlocked) {
                      statusLine = offer
                        ? `Claim open · ${formatScheduleInstant(t.unlockAt)}`
                        : `Claim window open · ${formatScheduleInstant(t.unlockAt)}`
                    } else {
                      statusLine = `Opens · ${formatScheduleInstant(t.unlockAt)}`
                    }
                    const countdownLabel = formatVipScheduledCountdown(unlockMs, nowMs)
                    const slotShell =
                      'block w-full rounded-xl border border-amber-600/75 bg-gradient-to-b from-amber-950/55 via-[#1a1408] to-black/50 py-3 text-center shadow-[inset_0_1px_0_rgba(253,230,138,0.14)] ring-1 ring-amber-500/20'
                    return (
                      <div className="mt-auto w-full">
                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-white/45">{statusLine}</p>
                        {!unlocked ? (
                          <button
                            type="button"
                            disabled
                            aria-live="polite"
                            className={`${slotShell} cursor-wait`}
                          >
                            <span className="block whitespace-normal break-words tabular-nums text-sm font-black leading-snug tracking-tight text-amber-100 sm:text-[15px]">
                              {!Number.isNaN(unlockMs) ? countdownLabel : '—'}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={blocked || isBusy || !offer}
                            onClick={() => void claimVipScheduled(kind)}
                            className={`${slotShell} transition ${
                              offer && !blocked && !isBusy
                                ? 'cursor-pointer hover:brightness-110 active:brightness-95'
                                : 'cursor-not-allowed opacity-80'
                            }`}
                          >
                            {blocked ? (
                              <span className="text-xs font-extrabold uppercase tracking-wide text-amber-100/80">Unavailable</span>
                            ) : isBusy ? (
                              <span className="text-xs font-extrabold uppercase tracking-wide text-amber-100">Claiming…</span>
                            ) : offer ? (
                              <span className="text-xs font-extrabold uppercase tracking-wide text-amber-100">Claim bonus</span>
                            ) : (
                              <span className="block whitespace-normal break-words tabular-nums text-sm font-black leading-snug tracking-tight text-amber-100 sm:text-[15px]">
                                {!Number.isNaN(unlockMs) ? countdownLabel : '—'}
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    )
                  })()
                )}
              </article>
            ))}
          </div>

          <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
            <VipRakebackCard
              isAuthenticated={isAuthenticated}
              vipLoading={vipLoading}
              hubLoading={hubLoading}
              vip={vip}
              rakebackBoost={hub?.vip?.rakeback_boost}
              claimActions={claimActions}
              tierPassiveRakeEligible={tierPassiveRakeEligible}
            />
            <RakebackBoostCard {...claimActions} tierBoostLocked={Boolean(isAuthenticated && !tierRakebackBoostEligible)} />
          </div>

          {isAuthenticated ? (
            <VipRainTrack hub={hub} />
          ) : null}
        </section>

        {loading ? <p className="text-sm text-casino-muted">Loading programme…</p> : null}
        {err ? (
          <div className="mb-6 rounded-[var(--radius-casino-md)] border border-casino-destructive/40 bg-casino-destructive/10 px-4 py-3 text-sm">
            <span className="text-casino-foreground">{err}</span>{' '}
            <button type="button" className="font-semibold text-casino-primary underline" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        ) : null}

        <section className="mb-8">
          <h2 className="mb-3 text-base font-extrabold uppercase tracking-wide text-white">Rewards</h2>
          {!isAuthenticated ? (
            <p className="m-0 max-w-xl text-sm text-white/65">
              Sign in to see your active VIP perks and any claimable tier rewards in one place.
            </p>
          ) : vipLoading || loading ? (
            <p className="text-sm text-white/60">Loading your VIP perks…</p>
          ) : currentTierRewards.length === 0 ? (
            <p className="m-0 text-sm text-white/65">No tier-specific perks are configured for your rank yet.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {currentTierRewards.map((p) => (
                <article
                  key={p.key}
                  className="min-w-[260px] max-w-xl flex-1 rounded-xl border border-white/10 bg-gradient-to-b from-casino-surface to-casino-bg px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10"
                      style={p.iconColor ? { color: p.iconColor } : undefined}
                    >
                      <VipBenefitIcon name={p.icon} />
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-black uppercase leading-tight text-white">{p.title}</p>
                      {p.description ? (
                        <p className="mt-1 line-clamp-2 text-[13px] text-white/70">{p.description}</p>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {isAuthenticated && !vipLoading && tierPerksStrip && tierPerksStrip.length > 0 && currentTierRewards.length === 0 ? (
            <div className="mt-3 flex flex-wrap gap-3">
              {tierPerksStrip.map((p) => (
                <article
                  key={p.benefit_id}
                  className="min-w-[260px] max-w-xl flex-1 rounded-xl border border-white/10 bg-gradient-to-b from-casino-surface to-casino-bg px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60">
                      <VipBenefitIcon name={p.icon_key} />
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-black uppercase leading-tight text-white">{p.title}</p>
                      {p.description ? (
                        <p className="mt-1 line-clamp-2 text-[13px] text-white/70">{p.description}</p>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-cyan-500/40 bg-casino-surface p-3">
          <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
            <h2 className="m-0 text-base font-extrabold uppercase tracking-wide text-cyan-300">VIP Levels</h2>
            <span className="text-xs text-white/60">{currentTier?.name ?? 'Novice'}</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <div className="grid grid-cols-3 bg-white/[0.03] px-4 py-3 text-xs font-bold uppercase tracking-wide text-white/70">
              <span>Tier Level</span>
              <span className="justify-self-center">Wager Required</span>
              <span className="text-right">Completion</span>
            </div>
            {sortedTiers.map((tier) => {
              const required = formatVipWagerThreshold(tier.min_lifetime_wager_minor)
              const isCurrent = tier.id === currentTier?.id
              const { benefits, display } = mergeTierPresentation(tier)
              const tierColor = display.header_color ?? '#3b82f6'
              const tierImg = display.character_image_url
              const isOpen = openTierId === tier.id
              return (
                <div key={tier.id} className="border-t border-white/10">
                  <button
                    type="button"
                    className="grid w-full cursor-pointer grid-cols-3 items-center px-4 py-3 text-left text-sm text-white/90"
                    style={{
                      borderLeft: `3px solid ${tierColor}`,
                      background: `linear-gradient(90deg, ${tierColor}40 0%, ${tierColor}1f 38%, rgba(255,255,255,0.02) 100%)`,
                    }}
                    onClick={() =>
                      setOpenTierId((prev) => (prev === tier.id ? null : tier.id))
                    }
                  >
                    <span className="flex min-w-0 items-center gap-3 font-bold uppercase">
                      {tierImg ? (
                        <img
                          src={tierImg}
                          alt=""
                          className="h-7 w-7 shrink-0 rounded-full border border-white/20 object-cover"
                          loading="lazy"
                        />
                      ) : null}
                      <span className="truncate">
                        {tier.name}
                      </span>
                    </span>
                    <span className="block justify-self-center w-[8ch] text-left font-semibold tabular-nums">{required}</span>
                    <span className="flex items-center justify-end gap-2 text-right">
                      {isCurrent ? (
                        <span className="rounded bg-emerald-500/20 px-2 py-1 text-xs font-bold text-emerald-300">Current</span>
                      ) : null}
                      <span
                        className={`text-base leading-none text-white/70 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                      >
                        ▾
                      </span>
                    </span>
                  </button>
                  <div
                    className="grid transition-[grid-template-rows] duration-300 ease-out"
                    style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden">
                      <div className="grid grid-cols-1 gap-2 border-t border-white/5 bg-black/20 px-4 py-3 md:grid-cols-2">
                        {benefits.length === 0 ? (
                          <p className="m-0 text-xs text-white/60">No rewards configured for this tier yet.</p>
                        ) : (
                          benefits.map((b, bIdx) => {
                            const isUsersTier = vip?.tier_id != null && tier.id === vip.tier_id
                            const perk =
                              isUsersTier && b.benefit_id != null && Array.isArray(vip?.tier_perks)
                                ? vip!.tier_perks!.find((x) => x.benefit_id === b.benefit_id)
                                : undefined
                            const preview = !isUsersTier
                            return (
                              <div key={`${tier.id}-${b.title}-${bIdx}`} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                                <div className="flex items-start gap-2">
                                  <span
                                    className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10"
                                    style={b.icon_color ? { color: b.icon_color } : undefined}
                                  >
                                    <VipBenefitIcon name={b.icon} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="flex flex-wrap items-center gap-2">
                                      <span className="block text-xs font-extrabold uppercase text-white">{b.title}</span>
                                      {perk ? (
                                        <span
                                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${perkStateBadgeClass(perk.state)}`}
                                        >
                                          {perkStateLabel(perk.state)}
                                        </span>
                                      ) : preview ? (
                                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/55">
                                          At this tier
                                        </span>
                                      ) : null}
                                    </span>
                                    <span className="mt-1 block text-xs text-white/65">{b.description}</span>
                                  </span>
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
