import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  IconChevronLeft,
  IconChevronRight,
  IconCoins,
  IconGift,
  IconInfo,
  IconLock,
  IconZap,
} from '../icons'
import type { HubBonusInstance, RewardsCalendarDay, RewardsHubPayload } from '../../hooks/useRewardsHub'

export function formatMinorUsd(minor: number) {
  return `$${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatCalendarLabel(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
}

function useCountdownTo(targetIso?: string) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!targetIso) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [targetIso])
  if (!targetIso) return null
  const t = new Date(targetIso).getTime()
  const ms = Math.max(0, t - now)
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}h: ${String(m).padStart(2, '0')}m: ${String(sec).padStart(2, '0')}s`
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-casino-md bg-white/[0.06] ${className ?? ''}`} />
}

/** Small (i) control with hover/focus tooltip — keeps complex rules off the main card. */
function InfoTip({ title, body }: { title: string; body: string }) {
  return (
    <span className="group relative inline-flex shrink-0 align-middle">
      <button
        type="button"
        className="rounded-full p-0.5 text-casino-muted transition hover:text-casino-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-casino-primary"
        aria-label={`About ${title}`}
      >
        <IconInfo size={16} aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full right-0 z-30 mb-2 w-[min(20rem,calc(100vw-2rem))] rounded-casino-md border border-white/[0.12] bg-casino-elevated px-3 py-2.5 text-left text-[11px] leading-relaxed text-casino-foreground shadow-xl opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <span className="block font-extrabold text-casino-foreground">{title}</span>
        <span className="mt-1 block font-normal text-casino-muted">{body}</span>
      </span>
    </span>
  )
}

function useHorizontalScroll(ref: React.RefObject<HTMLElement | null>) {
  return (delta: number) => ref.current?.scrollBy({ left: delta, behavior: 'smooth' })
}

export type RewardsLayoutProps = {
  displayName: string
  data: RewardsHubPayload | null
  loading: boolean
  err: string | null
  onRetry?: () => void
  claimBusy: string | null
  onClaimDay?: (date: string) => void
  previewMode?: boolean
  topBanner?: ReactNode
  subNav?: ReactNode
}

export function RewardsLayout({
  displayName,
  data,
  loading,
  err,
  onRetry,
  claimBusy,
  onClaimDay,
  previewMode,
  topBanner,
  subNav,
}: RewardsLayoutProps) {
  const calScroll = useRef<HTMLDivElement>(null)
  const inventoryScroll = useRef<HTMLDivElement>(null)
  const scrollCal = useHorizontalScroll(calScroll)
  const scrollInv = useHorizontalScroll(inventoryScroll)

  const aggregates = data?.aggregates
  const hunt = data?.hunt
  const vip = data?.vip
  const offers = data?.available_offers ?? []
  const instances = data?.bonus_instances ?? []
  const calendar = data?.calendar ?? []

  const rebateOffer = useMemo(
    () => offers.find((o) => (o.bonus_type || '').includes('rebate') || (o.bonus_type || '').includes('cashback')),
    [offers],
  )
  const periodicOffers = useMemo(() => offers.filter((o) => o !== rebateOffer), [offers, rebateOffer])
  const weeklyStyle = periodicOffers[0]
  const monthlyStyle = periodicOffers[1]

  const activeInstances = useMemo(
    () => instances.filter((b) => ['active', 'pending', 'pending_review'].includes(b.status.toLowerCase())),
    [instances],
  )

  const nextTierMin = vip?.progress?.next_tier_min_wager_minor
  const lifeWager = vip?.progress?.lifetime_wager_minor ?? 0
  const tierPct =
    nextTierMin && nextTierMin > 0 ? Math.min(100, Math.round((lifeWager / nextTierMin) * 100)) : 0

  const huntPct =
    hunt?.next_threshold_wager_minor && hunt.next_threshold_wager_minor > 0
      ? Math.min(100, (100 * (hunt.wager_accrued_minor ?? 0)) / hunt.next_threshold_wager_minor)
      : 0

  const vipStatusLine = vip?.tier ? `${vip.tier}` : 'Tadpole'

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
      {topBanner}
      <header className="relative mb-8 flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="m-0 text-lg font-black uppercase tracking-[0.18em] text-casino-foreground">Rewards</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-casino-muted">
              Your <strong className="text-casino-foreground">inventory</strong> is where scheduled bonuses and offers
              you qualify for show up. Play to fill progress bars, then claim or use each reward from its card.
            </p>
          </div>
          <div className="pointer-events-none hidden text-[72px] leading-none text-white/[0.03] sm:block">
            <IconGift size={64} aria-hidden />
          </div>
        </div>
        {subNav ? <div className="text-sm">{subNav}</div> : null}
      </header>

      {err ? (
        <div className="mb-6 rounded-casino-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}{' '}
          {onRetry ? (
            <button type="button" className="ml-2 underline" onClick={() => void onRetry()}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Quick balances — compact, always visible */}
      <section className="mb-10">
        <h2 className="m-0 text-[11px] font-extrabold uppercase tracking-wider text-casino-muted">Your balances</h2>
        {loading ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <StatMini label="Wagering left on bonuses" value={formatMinorUsd(aggregates?.wagering_remaining_minor ?? 0)} />
            <StatMini label="Locked bonus" value={formatMinorUsd(aggregates?.bonus_locked_minor ?? 0)} />
            <StatMini label="Lifetime promo credited" value={formatMinorUsd(aggregates?.lifetime_promo_minor ?? 0)} />
          </div>
        )}
      </section>

      {/* Inventory: offers “land” here */}
      <section className="mb-10">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-extrabold text-casino-foreground">Inventory</h2>
            <p className="mt-1 max-w-2xl text-sm text-casino-muted">
              Timed promotions and paths to earn more. Use the arrows to scroll if you have several live offers.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-casino-sm bg-white/[0.05] text-casino-muted hover:text-casino-foreground"
              aria-label="Scroll inventory left"
              onClick={() => scrollInv(-280)}
            >
              <IconChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-casino-sm bg-white/[0.05] text-casino-muted hover:text-casino-foreground"
              aria-label="Scroll inventory right"
              onClick={() => scrollInv(280)}
            >
              <IconChevronRight size={18} aria-hidden />
            </button>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-52 w-full" />
        ) : (
          <div
            ref={inventoryScroll}
            className="scrollbar-none flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2"
          >
            <div className="min-w-[min(100%,260px)] shrink-0 snap-start sm:min-w-[240px]">
              <InvCard
                title={weeklyStyle?.title || 'Weekly bonus'}
                statusLine={vipStatusLine}
                subtitle={
                  weeklyStyle?.description ||
                  'A recurring offer may appear here when your casino runs a weekly promotion.'
                }
                footer={weeklyStyle?.schedule_summary || 'Unlocks when eligible'}
                ctaVariant="outline"
                tooltipTitle={weeklyStyle?.title || 'Weekly bonus'}
                tooltipBody={
                  weeklyStyle?.description ||
                  'When a weekly promotion is live, it shows up in your inventory with its schedule. Eligibility depends on your play and the rules of that offer.'
                }
              />
            </div>
            <div className="min-w-[min(100%,260px)] shrink-0 snap-start sm:min-w-[240px]">
              <InvCard
                title={monthlyStyle?.title || 'Monthly bonus'}
                statusLine={vipStatusLine}
                subtitle={
                  monthlyStyle?.description ||
                  'Monthly or longer promos you qualify for will display dates and requirements here.'
                }
                footer={monthlyStyle?.schedule_summary || 'See promotions'}
                ctaVariant="outline"
                accentOrange={!monthlyStyle}
                tooltipTitle={monthlyStyle?.title || 'Monthly bonus'}
                tooltipBody={
                  monthlyStyle?.description ||
                  'Monthly rewards unlock on the schedule set by the house (for example the first day of the month). Check back here for the exact timing.'
                }
              />
            </div>
            <div className="min-w-[min(100%,260px)] shrink-0 snap-start sm:min-w-[240px]">
              <InvCard
                title="Earn rewards"
                statusLine="Go play"
                subtitle="Real-money play unlocks more bonuses and VIP progress."
                footer="Browse games"
                ctaVariant="primaryBlue"
                href="/casino/games"
                tooltipTitle="Earn rewards"
                tooltipBody="Go play to earn rewards and unlock more bonuses. Your VIP level and hunt progress update as you wager."
              />
            </div>
            {periodicOffers.slice(2).map((o) => (
              <div key={o.promotion_version_id} className="min-w-[min(100%,260px)] shrink-0 snap-start sm:min-w-[240px]">
                <InvCard
                  title={o.title}
                  statusLine={vipStatusLine}
                  subtitle={o.description || o.schedule_summary || 'Promotion'}
                  footer={o.schedule_summary || 'View details'}
                  ctaVariant="outline"
                  tooltipTitle={o.title}
                  tooltipBody={o.description || 'See wallet and promotions for how to use this offer.'}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Daily calendar strip */}
      <section className="mb-10">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-extrabold text-casino-foreground">Daily reward calendar</h2>
            <p className="mt-1 text-sm text-casino-muted">
              Claim each day when it opens. If you have another bonus with wagering left, daily claims stay on hold until
              that wagering is done.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-casino-sm bg-white/[0.05] text-casino-muted hover:text-casino-foreground"
              aria-label="Scroll calendar left"
              onClick={() => scrollCal(-180)}
            >
              <IconChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-casino-sm bg-white/[0.05] text-casino-muted hover:text-casino-foreground"
              aria-label="Scroll calendar right"
              onClick={() => scrollCal(180)}
            >
              <IconChevronRight size={18} aria-hidden />
            </button>
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-36 w-full" />
        ) : calendar.length === 0 ? (
          <p className="text-sm text-casino-muted">Daily rewards are not configured yet.</p>
        ) : (
          <div ref={calScroll} className="scrollbar-none flex gap-4 overflow-x-auto pb-2">
            {calendar.map((day: RewardsCalendarDay) => (
              <CalendarDayCard
                key={day.date}
                day={day}
                busy={claimBusy === day.date}
                previewMode={previewMode}
                onClaim={onClaimDay ? () => onClaimDay(day.date) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      {/* Cashback-style cards + wide hunt */}
      <section className="mb-10">
        <h2 className="m-0 text-lg font-extrabold text-casino-foreground">Earn as you play</h2>
        <p className="mt-1 mb-6 max-w-2xl text-sm text-casino-muted">
          Rebates and wager milestones. Amounts update as you bet; use <strong className="text-casino-foreground">Play</strong> to
          keep progress moving.
        </p>
        {loading ? (
          <div className="grid gap-4 lg:grid-cols-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 lg:min-h-[200px]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-6 lg:grid-rows-[auto_minmax(0,1fr)]">
            <BalanceActionCard
              className="lg:col-span-1"
              title="Rakeback / rebate"
              amountMinor={0}
              tooltipTitle="Rakeback / rebate"
              tooltipBody={
                rebateOffer?.description ||
                  'When a rebate or cashback programme is active, part of your play can be returned on a schedule. This tile shows what you can collect once the house credits it — keep playing to qualify.'
              }
              footnote={rebateOffer?.title || 'Programme inactive'}
              actionLabel="Play"
              href="/casino/games"
            />
            <BalanceActionCard
              className="lg:col-span-1"
              title="Daily dollars"
              amountMinor={hunt?.next_reward_minor ?? 0}
              tooltipTitle="Daily dollars"
              tooltipBody="Play games to gain wager toward your daily hunt. This bar is separate from VIP level: it pays the next milestone amount when you cross each threshold."
              footnote="Next milestone reward"
              actionLabel="Play"
              href="/casino/games"
            />
            <div className="flex flex-col gap-4 rounded-casino-md bg-casino-card p-4 lg:col-span-4 lg:row-span-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-extrabold text-casino-foreground">Daily wager hunt progress</div>
                  <p className="mt-0.5 text-[11px] text-casino-muted">Track today&apos;s betting progress toward the next payout.</p>
                </div>
                <InfoTip
                  title="Daily wager hunt"
                  body="Wager counts toward the next threshold. When you cross it, the reward shown below can be granted according to your casino’s rules."
                />
              </div>
              <div className="text-[11px] font-bold text-casino-foreground">
                <div className="mb-1 flex justify-between gap-2">
                  <span>{formatMinorUsd(hunt?.wager_accrued_minor ?? 0)} wagered (period)</span>
                  <span>
                    {hunt?.next_threshold_wager_minor != null
                      ? `Next at ${formatMinorUsd(hunt.next_threshold_wager_minor)}`
                      : '—'}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-casino-primary/60 to-casino-primary transition-all"
                    style={{ width: `${huntPct}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4">
                <div className="rounded-casino-sm bg-white/[0.04] px-3 py-2">
                  <div className="font-semibold text-casino-muted">Next reward</div>
                  <div className="font-extrabold text-casino-foreground">
                    {hunt?.next_reward_minor != null ? formatMinorUsd(hunt.next_reward_minor) : '—'}
                  </div>
                </div>
                <div className="rounded-casino-sm bg-white/[0.04] px-3 py-2">
                  <div className="font-semibold text-casino-muted">Milestones passed</div>
                  <div className="font-extrabold text-casino-foreground">{(hunt?.last_threshold_index ?? -1) + 1}</div>
                </div>
                <div className="rounded-casino-sm bg-white/[0.04] px-3 py-2">
                  <div className="font-semibold text-casino-muted">Locked bonus (wallet)</div>
                  <div className="font-extrabold text-casino-foreground">
                    {formatMinorUsd(aggregates?.bonus_locked_minor ?? 0)}
                  </div>
                </div>
                <div className="rounded-casino-sm bg-white/[0.04] px-3 py-2">
                  <div className="font-semibold text-casino-muted">Promo credited (lifetime)</div>
                  <div className="font-extrabold text-casino-foreground">
                    {formatMinorUsd(aggregates?.lifetime_promo_minor ?? 0)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 rounded-casino-md bg-casino-card p-4 lg:col-span-2 lg:row-start-2">
              <div className="flex w-full items-center justify-between text-[12px] font-extrabold text-casino-foreground">
                <span>Boosts</span>
                <InfoTip
                  title="Boosts"
                  body="Limited-time multiplier promotions can appear here when published. Activate them from the offer details or your inbox when available."
                />
              </div>
              <div className="flex size-[72px] items-center justify-center rounded-full border-[3px] border-casino-success shadow-[0_0_24px_rgba(20,241,149,0.15)]">
                <IconZap size={36} className="text-casino-success" aria-hidden />
              </div>
              <div className="flex gap-1 text-casino-success">
                <IconZap size={14} aria-hidden />
                <IconZap size={14} aria-hidden />
                <IconZap size={14} aria-hidden />
              </div>
              <span className="rounded-casino-sm border border-orange-500/50 px-3 py-2 text-center text-[11px] font-bold text-orange-300">
                When a boost is live, open it from promotions
              </span>
            </div>

            <div className="relative flex flex-col gap-3 rounded-casino-md bg-casino-card p-4 sm:flex-row sm:items-stretch lg:col-span-4 lg:row-start-2">
              <div className="pointer-events-none absolute left-0 right-0 top-3 text-center text-[12px] font-extrabold text-casino-foreground">
                VIP level progress
              </div>
              <div className="mx-auto mt-7 flex size-24 shrink-0 items-center justify-center rounded-casino-md bg-casino-primary/15 sm:mt-9">
                <IconCrownMini />
              </div>
              <div className="min-w-0 flex-1 pt-6 sm:pt-8">
                <div className="text-[15px] font-extrabold text-casino-foreground">{displayName}</div>
                <div className="mt-1 text-[12px] font-bold text-casino-foreground">
                  {formatMinorUsd(lifeWager)}
                  {nextTierMin ? ` / ${formatMinorUsd(nextTierMin)}` : ''}{' '}
                  <span className="font-semibold text-casino-muted">lifetime wager</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-casino-primary/80 transition-all"
                    style={{ width: `${tierPct}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between gap-2 text-[11px] font-bold">
                  <span className="rounded bg-white/[0.08] px-2 py-1 text-casino-foreground">{vip?.tier ?? '—'}</span>
                  <span className="rounded bg-white/[0.08] px-2 py-1 text-casino-foreground">
                    {vip?.next_tier ?? 'Top tier'}
                  </span>
                </div>
                <Link
                  to="/vip"
                  className="mt-3 inline-block text-[11px] font-bold text-casino-primary underline hover:no-underline"
                >
                  View full VIP ladder
                </Link>
              </div>
            </div>
          </div>
        )}
      </section>

      {!loading && activeInstances.length > 0 ? (
        <section className="mb-12">
          <h2 className="m-0 text-lg font-extrabold text-casino-foreground">In your wallet</h2>
          <p className="mt-1 mb-4 text-sm text-casino-muted">
            Bonuses already credited — complete wagering to withdraw winnings according to each offer&apos;s rules.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {activeInstances.map((b: HubBonusInstance) => (
              <li
                key={b.id}
                className="flex gap-3 rounded-casino-md border border-white/[0.08] bg-casino-elevated/50 p-4"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-casino-sm bg-casino-primary/15">
                  <IconGift size={24} className="text-casino-primary" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-casino-foreground">
                      {b.title?.trim() || `Bonus #${b.promotion_version_id}`}
                    </span>
                    <span className="text-xs capitalize text-casino-muted">{b.status.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-1 text-xs text-casino-muted">
                    Granted {formatMinorUsd(b.granted_amount_minor)} · Wagering{' '}
                    {formatMinorUsd(b.wr_contributed_minor)} / {formatMinorUsd(b.wr_required_minor)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-16 rounded-casino-lg bg-casino-card p-6 sm:p-8">
        <h2 className="mt-0 text-xl font-extrabold text-casino-foreground">Common questions</h2>
        <FaqList />
      </section>
    </div>
  )
}

function IconCrownMini() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden className="text-casino-primary">
      <path
        d="M2 17l4-10 4 5 4-9 4 10 4-3v13H2V17z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-2 rounded-casino-md bg-casino-card px-4 py-3">
      <div className="text-[12px] font-semibold text-casino-muted">{label}</div>
      <div className="rounded-casino-sm bg-white/[0.04] px-3 py-2 text-sm font-extrabold text-casino-foreground">
        {value}
      </div>
    </div>
  )
}

function BalanceActionCard({
  title,
  amountMinor,
  tooltipTitle,
  tooltipBody,
  footnote,
  actionLabel,
  href,
  className,
}: {
  title: string
  amountMinor: number
  tooltipTitle: string
  tooltipBody: string
  footnote: string
  actionLabel: string
  href: string
  className?: string
}) {
  return (
    <div
      className={`flex min-h-[200px] flex-col gap-3 rounded-casino-md bg-casino-card p-4 ${className ?? ''}`}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className="text-[13px] font-extrabold text-casino-foreground">{title}</span>
        <InfoTip title={tooltipTitle} body={tooltipBody} />
      </div>
      <div className="flex min-h-[72px] flex-1 items-center justify-center">
        <IconCoins size={44} className="text-casino-success/90" aria-hidden />
      </div>
      <div className="flex items-center justify-between gap-2 rounded-casino-sm bg-white/[0.04] px-3 py-2">
        <Link
          to={href}
          className="shrink-0 rounded-casino-sm border border-orange-500 px-3 py-1.5 text-[11px] font-extrabold text-orange-300 hover:bg-orange-500/10"
        >
          {actionLabel}
        </Link>
        <div className="text-sm font-extrabold text-casino-foreground">{formatMinorUsd(amountMinor)}</div>
      </div>
      <p className="text-center text-[11px] font-semibold text-casino-muted">{footnote}</p>
    </div>
  )
}

function CalendarDayCard({
  day,
  onClaim,
  busy,
  previewMode,
}: {
  day: RewardsCalendarDay
  onClaim?: () => void
  busy: boolean
  previewMode?: boolean
}) {
  const countdown = useCountdownTo(day.state === 'locked' ? day.unlock_at : undefined)
  const active = day.state === 'claimable' || day.state === 'claimed'
  const blockedWager = day.state === 'blocked' && day.block_reason === 'active_wagering'

  return (
    <div
      className={`flex min-w-[140px] shrink-0 flex-col items-center gap-4 rounded-casino-md px-4 py-5 ${
        active ? 'border border-casino-primary/30 bg-casino-primary/[0.08]' : ''
      } ${day.state === 'blocked' ? 'border border-amber-500/35 bg-amber-500/[0.07]' : ''} ${
        !active && day.state !== 'blocked' ? 'bg-casino-card' : ''
      }`}
    >
      <div className="text-[13px] font-bold text-casino-foreground">{formatCalendarLabel(day.date)}</div>
      <div className="text-lg font-extrabold text-casino-success">{formatMinorUsd(day.amount_minor)}</div>
      {day.state === 'claimed' ? (
        <span className="w-full rounded-casino-sm bg-casino-primary py-2.5 text-center text-[12px] font-bold text-white">
          Claimed
        </span>
      ) : day.state === 'claimable' ? (
        <button
          type="button"
          disabled={busy || !onClaim}
          onClick={onClaim}
          className="w-full rounded-casino-sm bg-casino-primary py-2.5 text-center text-[12px] font-bold text-white disabled:opacity-50"
        >
          {busy ? '…' : previewMode ? 'Claim (demo)' : 'Claim'}
        </button>
      ) : day.state === 'blocked' ? (
        <span className="w-full rounded-casino-sm border border-amber-500/50 bg-amber-500/10 px-2 py-2.5 text-center text-[10px] font-bold leading-snug text-amber-200">
          {blockedWager
            ? 'Finish bonus wagering first'
            : day.block_reason?.replace(/_/g, ' ') || 'Unavailable'}
        </span>
      ) : (
        <span className="flex w-full items-center justify-center gap-1 rounded-casino-sm border border-white/[0.08] py-2.5 text-center text-[11px] font-bold text-casino-muted">
          <IconLock size={14} aria-hidden />
          {countdown ?? 'Locked'}
        </span>
      )}
    </div>
  )
}

function InvCard({
  title,
  subtitle,
  statusLine,
  footer,
  className,
  ctaVariant,
  href,
  accentOrange,
  icon,
  tooltipTitle,
  tooltipBody,
}: {
  title: string
  subtitle: string
  statusLine?: string
  footer: string
  className?: string
  ctaVariant?: 'outline' | 'primaryBlue'
  href?: string
  accentOrange?: boolean
  icon?: ReactNode
  tooltipTitle: string
  tooltipBody: string
}) {
  const ctaClass =
    ctaVariant === 'primaryBlue'
      ? 'bg-blue-500 text-white border-transparent'
      : accentOrange
        ? 'border border-orange-500 text-orange-300 bg-transparent'
        : 'border border-casino-primary text-casino-primary bg-transparent'

  const body = (
    <>
      <div className="flex w-full items-start justify-between gap-2 text-[13px] font-extrabold text-casino-foreground">
        <span className="min-w-0 leading-tight">{title}</span>
        <InfoTip title={tooltipTitle} body={tooltipBody} />
      </div>
      <div className="flex min-h-[80px] flex-1 items-center justify-center">
        {icon ?? <IconGift size={52} className="text-casino-primary/35" aria-hidden />}
      </div>
      {statusLine ? (
        <p className="text-center text-[11px] font-bold uppercase tracking-wide text-casino-muted">{statusLine}</p>
      ) : null}
      <p className="line-clamp-3 text-center text-[12px] font-semibold leading-snug text-casino-muted">{subtitle}</p>
      {href ? (
        <Link to={href} className={`w-full rounded-casino-sm py-2.5 text-center text-[12px] font-bold ${ctaClass}`}>
          {footer}
        </Link>
      ) : (
        <span className={`block w-full rounded-casino-sm py-2.5 text-center text-[12px] font-bold ${ctaClass}`}>
          {footer}
        </span>
      )}
    </>
  )
  return (
    <div
      className={`flex h-full min-h-[220px] flex-col items-center gap-3 rounded-casino-md bg-casino-card p-4 ${className ?? ''}`}
    >
      {body}
    </div>
  )
}

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'What is my inventory?',
    a: 'Inventory lists promotions you can qualify for on a schedule, plus shortcuts to earn more by playing. Bonuses you already received appear under In your wallet.',
  },
  {
    q: 'How does the daily wager hunt work?',
    a: 'Real-money bets fill the progress bar. When you pass a threshold, a reward may be granted according to the programme rules. Milestones can repeat throughout the day.',
  },
  {
    q: 'What is rakeback or rebate?',
    a: 'Some programmes return a share of play over time. When credited, it may show as collectable value here or in your wallet, depending on configuration.',
  },
  {
    q: 'How do VIP tiers work?',
    a: 'Your lifetime eligible wager moves you toward the next tier. Open the VIP page for the full ladder and perks.',
  },
]

function FaqList() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="flex flex-col gap-3">
      {FAQ_ITEMS.map((item, i) => (
        <button
          key={item.q}
          type="button"
          onClick={() => setOpen((o) => (o === i ? null : i))}
          className="w-full rounded-casino-md bg-white/[0.03] px-4 py-4 text-left text-sm font-bold text-casino-foreground transition hover:bg-white/[0.05]"
        >
          {item.q}
          {open === i ? (
            <p className="mt-2 text-xs font-normal leading-relaxed text-casino-muted">{item.a}</p>
          ) : null}
        </button>
      ))}
    </div>
  )
}
