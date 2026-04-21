import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { IconGem, IconZap } from '../components/icons'
import { VipBenefitIcon } from '../components/vip/VipBenefitIcon'
import {
  mergeTierPresentation,
  VIP_FAQ_BENEFITS,
  VIP_FAQ_GENERAL,
  VIP_HERO_TILES,
  formatVipWagerThreshold,
} from '../lib/vipPresentation'
import { useVipProgram } from '../hooks/useVipProgram'
import { useVipStatus } from '../hooks/useVipStatus'

const INFO_CARDS: {
  title: string
  body: string
  icon: 'zap' | 'arrow' | 'dollar' | 'image'
  iconBg: string
  iconFg: string
  imageSrc?: string
}[] = [
  {
    title: 'Rakeback Boost',
    body: 'Rakeback boosts increase your rakeback for a limited time. You can claim your rakeback boosts 3 times per day — typical unlock windows are 6am, 2pm and 10pm UTC (confirm in-product).',
    icon: 'zap',
    iconBg: '#f97316',
    iconFg: '#fff',
  },
  {
    title: 'Level Up Rewards',
    body: 'You receive a bonus when you achieve a new level or rank. Credits may appear in your balance and on your Rewards calendar.',
    icon: 'arrow',
    iconBg: '#eab308',
    iconFg: '#000',
  },
  {
    title: 'Weekly Bonus',
    body: 'Each week you may receive a cash bonus based on recent activity. Claim from your Rewards page when available.',
    icon: 'dollar',
    iconBg: '#22c55e',
    iconFg: '#000',
  },
  {
    title: 'Monthly Bonus',
    body: 'Monthly rewards summarise your play over the prior period. Check Rewards for claim windows and eligibility.',
    icon: 'image',
    iconBg: 'transparent',
    iconFg: '#fff',
    imageSrc:
      'https://storage.googleapis.com/banani-generated-images/generated-images/875c64d7-2a77-4fd8-8555-1820d0429791.jpg',
  },
]

function InfoIcon({
  kind,
  bg,
  fg,
  imageSrc,
}: {
  kind: 'zap' | 'arrow' | 'dollar' | 'image'
  bg: string
  fg: string
  imageSrc?: string
}) {
  if (kind === 'image' && imageSrc) {
    return (
      <div className="flex h-12 w-12 shrink-0 overflow-hidden rounded-full">
        <img src={imageSrc} alt="" className="h-full w-full object-cover" loading="lazy" />
      </div>
    )
  }
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-2xl"
      style={{ background: bg, color: fg }}
    >
      {kind === 'zap' ? <IconZap size={24} aria-hidden /> : null}
      {kind === 'arrow' ? (
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 19V5M5 12l7-7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
      {kind === 'dollar' ? (
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
  )
}

function FaqDisclosure({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="rounded-[var(--radius-casino-sm)] bg-casino-card px-4 py-3 text-sm text-casino-foreground shadow-sm open:ring-1 open:ring-casino-primary/25">
      <summary className="cursor-pointer font-bold leading-snug text-casino-foreground">{question}</summary>
      <p className="mt-3 text-[13px] font-medium leading-relaxed text-casino-muted">{answer}</p>
    </details>
  )
}

export default function VipPage() {
  const { data, loading, err, reload } = useVipProgram()
  const { data: vip } = useVipStatus()

  const tiers = data?.tiers ?? []

  const sortedTiers = useMemo(() => [...tiers].sort((a, b) => a.sort_order - b.sort_order), [tiers])

  return (
    <div className="w-full text-casino-foreground">
      <div className="mx-auto max-w-[1080px] px-4 pb-14 pt-6 sm:px-6 lg:px-8 lg:pb-20 lg:pt-10">
        <header className="relative mb-8 flex items-center justify-between lg:mb-10">
          <h1 className="m-0 text-lg font-black uppercase tracking-[0.2em] text-casino-foreground">VIP</h1>
          <IconGem
            size={90}
            className="pointer-events-none absolute -top-8 right-2 text-casino-foreground opacity-[0.04] sm:right-10"
            aria-hidden
          />
        </header>

        <section
          className="mb-10 rounded-[var(--radius-casino-lg)] bg-casino-card p-6 sm:p-8 lg:mb-12"
          aria-labelledby="vip-hero-heading"
        >
          <h2 id="vip-hero-heading" className="m-0 text-xl font-extrabold text-casino-foreground">
            Join the most lucrative VIP casino experience
          </h2>
          <p className="mb-8 mt-3 max-w-[800px] text-[13px] font-medium leading-relaxed text-casino-muted">
            Our VIP experience is designed to reward players of all levels. We aim to ensure you receive strong rewards
            for the play you bring — with clear tiers, scheduled bonuses, and transparent progress.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {VIP_HERO_TILES.map((tile) => (
              <div
                key={tile.title}
                className="flex flex-col items-center gap-4 rounded-[var(--radius-casino-md)] bg-white/[0.03] p-4 sm:p-6"
              >
                <div className="text-[13px] font-extrabold text-casino-foreground">{tile.title}</div>
                <img
                  src={tile.image}
                  alt=""
                  className="h-16 w-16 object-contain sm:h-20 sm:w-20"
                  width={80}
                  height={80}
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        </section>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-lg font-extrabold text-casino-foreground">VIP Rewards</h2>
          {vip?.tier ? (
            <span className="rounded-[var(--radius-casino-sm)] bg-casino-primary-dim px-3 py-1 text-xs font-bold text-white">
              Your tier: {vip.tier}
            </span>
          ) : null}
        </div>
        {vip?.rebate_percent_add_by_program &&
        Object.keys(vip.rebate_percent_add_by_program).length > 0 ? (
          <p className="mb-4 text-[11px] font-semibold text-casino-muted">
            Active VIP rebate boosts:{' '}
            {Object.entries(vip.rebate_percent_add_by_program)
              .map(([k, v]) => `${k} +${v}pp`)
              .join(' · ')}
            . Applied on the next rebate run for each programme.
          </p>
        ) : null}
        {vip?.tier && vip.tier.trim().toLowerCase() === 'tadpole' ? (
          <p className="mb-4 text-xs text-casino-muted">
            You are on the entry tier. The cards below start at the first public milestone — keep playing to unlock them.
          </p>
        ) : null}

        {loading ? <p className="text-sm text-casino-muted">Loading programme…</p> : null}
        {err ? (
          <div className="mb-6 rounded-[var(--radius-casino-md)] border border-casino-destructive/40 bg-casino-destructive/10 px-4 py-3 text-sm">
            <span className="text-casino-foreground">{err}</span>{' '}
            <button type="button" className="font-semibold text-casino-primary underline" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !err && sortedTiers.length === 0 ? (
          <p className="text-sm text-casino-muted">
            No public VIP tiers are configured yet. Ask an administrator to publish tiers or run the latest database
            migrations.
          </p>
        ) : null}

        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:mb-12 xl:grid-cols-4">
          {sortedTiers.map((tier) => {
            const { display, benefits } = mergeTierPresentation(tier)
            const headerColor = display.header_color ?? '#5b5860'
            const img = display.character_image_url
            const rank = display.rank_label ?? `Tier ${tier.sort_order}`
            const wagerLabel = formatVipWagerThreshold(tier.min_lifetime_wager_minor)
            const isCurrent =
              (vip?.tier_id != null && vip.tier_id === tier.id) ||
              (vip?.tier != null && vip.tier.trim().toUpperCase() === tier.name.trim().toUpperCase())

            return (
              <article
                key={tier.id}
                className={`flex flex-col overflow-hidden rounded-[var(--radius-casino-md)] border border-casino-border bg-casino-bg shadow-sm ${
                  isCurrent ? 'ring-2 ring-casino-primary ring-offset-2 ring-offset-casino-bg' : ''
                }`}
              >
                <div className="flex flex-col gap-1 px-4 py-3" style={{ background: headerColor }}>
                  <div className="text-base font-black uppercase text-white">{tier.name}</div>
                  <div className="text-xs font-bold text-white/90">{rank}</div>
                </div>
                <div className="relative flex h-[140px] items-end justify-end bg-white/[0.02] px-4 pb-4">
                  <div className="absolute left-4 top-4 flex flex-col">
                    <span className="text-base font-black text-casino-foreground">{wagerLabel}</span>
                    <span className="text-[11px] font-semibold text-casino-muted">Lifetime wager (min)</span>
                  </div>
                  {img ? (
                    <img src={img} alt="" className="h-[100px] w-[100px] object-contain" width={100} height={100} loading="lazy" />
                  ) : null}
                </div>
                <div className="flex flex-1 flex-col gap-4 bg-casino-card p-4">
                  {benefits.map((b) => (
                    <div key={`${tier.id}-${b.title}`} className="flex items-start gap-3">
                      <div
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/[0.05]"
                        style={b.icon_color ? { color: b.icon_color } : undefined}
                      >
                        <VipBenefitIcon name={b.icon} />
                      </div>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="text-xs font-extrabold text-casino-foreground">{b.title}</div>
                        <div className="text-[11px] font-semibold leading-snug text-casino-muted">{b.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            )
          })}
        </div>

        <div className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-2 lg:mb-12">
          {INFO_CARDS.map((c) => (
            <div
              key={c.title}
              className="flex gap-5 rounded-[var(--radius-casino-md)] bg-casino-card p-5 sm:p-6"
            >
              <InfoIcon kind={c.icon} bg={c.iconBg} fg={c.iconFg} imageSrc={c.imageSrc} />
              <div className="min-w-0">
                <h3 className="m-0 text-[15px] font-extrabold text-casino-foreground">{c.title}</h3>
                <p className="mt-2 text-[13px] font-medium leading-relaxed text-casino-muted">{c.body}</p>
              </div>
            </div>
          ))}
        </div>

        <h2 className="mb-3 mt-10 text-lg font-extrabold text-casino-foreground lg:mt-14">General</h2>
        <div className="mb-10 flex flex-col gap-2 lg:mb-12">
          {VIP_FAQ_GENERAL.map((f) => (
            <FaqDisclosure key={f.q} question={f.q} answer={f.a} />
          ))}
        </div>

        <h2 className="mb-3 mt-10 text-lg font-extrabold text-casino-foreground lg:mt-14">Benefits</h2>
        <div className="mb-6 flex flex-col gap-2">
          {VIP_FAQ_BENEFITS.map((f) => (
            <FaqDisclosure key={f.q} question={f.q} answer={f.a} />
          ))}
        </div>

        <p className="text-center text-[13px] text-casino-muted">
          Ready to claim?{' '}
          <Link to="/rewards" className="font-semibold text-casino-primary underline">
            Open Rewards
          </Link>
        </p>
      </div>
    </div>
  )
}
