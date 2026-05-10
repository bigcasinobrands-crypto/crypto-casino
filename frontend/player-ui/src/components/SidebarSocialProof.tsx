import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCoins, IconUsers } from './icons'
import { useSocialProof } from '../hooks/useSocialProof'

const PLACEHOLDER = '—'

const statCardClass =
  'flex w-full min-w-0 items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'

/** Plain grouped integer (marketing-style total wager display). */
function formatWagerDisplay(minor: number) {
  const n = Math.round(Number(minor))
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
}

function formatOnline(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
}

/** Narrow collapsed rail (~48px): short labels, full precision in `title`. */
function formatCollapsedInteger(n: number) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return PLACEHOLDER
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000_000) {
    const x = abs / 1e9
    const d = x >= 100 ? 0 : x >= 10 ? 1 : 2
    return `${sign}${new Intl.NumberFormat(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(x)}B`
  }
  if (abs >= 1_000_000) {
    const x = abs / 1e6
    const d = x >= 100 ? 0 : x >= 10 ? 1 : 2
    return `${sign}${new Intl.NumberFormat(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(x)}M`
  }
  if (abs >= 100_000) {
    return `${sign}${Math.round(abs / 1000)}K`
  }
  return formatOnline(v)
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className={statCardClass}>
      <div className="flex shrink-0 pt-0.5">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold leading-snug text-white/78">{label}</p>
        <p className="mt-1 text-[13px] font-bold tabular-nums leading-snug tracking-tight text-white/[0.92] [overflow-wrap:anywhere]">
          {value}
        </p>
      </div>
    </div>
  )
}

type Props = {
  variant: 'desktop' | 'desktop-collapsed' | 'mobile'
}

export default function SidebarSocialProof({ variant }: Props) {
  const { t } = useTranslation()
  const payload = useSocialProof()

  if (payload !== null && payload.enabled === false) return null

  const live = payload?.enabled === true
  const bets = live ? formatWagerDisplay(payload.bets_wagered_display_minor) : PLACEHOLDER
  const online = live ? formatOnline(payload.online_count) : PLACEHOLDER

  if (variant === 'desktop-collapsed') {
    const wagerShort = live ? formatCollapsedInteger(payload.bets_wagered_display_minor) : PLACEHOLDER
    return (
      <div
        className="shrink-0 border-t border-white/[0.06] bg-casino-sidebar px-1 pb-2 pt-2"
        aria-label={t('sidebar.socialProof.regionLabel')}
        aria-busy={!live}
      >
        <div className="flex flex-col gap-1">
          <div
            className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.04] px-1 py-2"
            title={live ? `${t('sidebar.socialProof.betsWagered')}: ${bets}` : t('sidebar.socialProof.betsWagered')}
          >
            <IconCoins size={14} className="shrink-0 text-casino-primary" aria-hidden />
            <span className="max-w-full whitespace-normal break-words text-center text-[9px] font-bold tabular-nums leading-tight text-white/85">
              {wagerShort}
            </span>
          </div>
          <div
            className="flex flex-col items-center gap-1 rounded-lg bg-white/[0.04] px-1 py-2"
            title={live ? `${t('sidebar.socialProof.online')}: ${online}` : t('sidebar.socialProof.online')}
          >
            <span className="relative flex shrink-0">
              <IconUsers size={14} className="text-emerald-400" aria-hidden />
              <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-1 ring-casino-sidebar" />
            </span>
            <span className="text-[9px] font-bold tabular-nums leading-tight text-white/85">{online}</span>
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'mobile') {
    return (
      <div
        className="shrink-0 border-t border-white/[0.06] bg-casino-sidebar px-3 pb-[max(12px,calc(env(safe-area-inset-bottom)+12px))] pt-2"
        onClick={(e) => e.stopPropagation()}
        role="region"
        aria-label={t('sidebar.socialProof.regionLabel')}
        aria-busy={!live}
      >
        <div className="flex flex-col gap-2">
          <StatCard
            icon={<IconCoins size={18} className="text-casino-primary" aria-hidden />}
            label={t('sidebar.socialProof.betsWagered')}
            value={bets}
          />
          <StatCard
            icon={
              <span className="relative inline-flex">
                <IconUsers size={18} className="text-emerald-400" aria-hidden />
                <span className="absolute bottom-0 right-0 h-2 w-2 translate-x-px translate-y-px rounded-full bg-emerald-400 ring-2 ring-[rgba(24,24,28,0.95)]" />
              </span>
            }
            label={t('sidebar.socialProof.online')}
            value={online}
          />
        </div>
      </div>
    )
  }

  // desktop expanded — sidebar ~204px: stack full-width rows so values are not truncated
  return (
    <div
      className="shrink-0 border-t border-white/[0.06] bg-casino-sidebar px-2 pb-0 pt-2"
      role="region"
      aria-label={t('sidebar.socialProof.regionLabel')}
      aria-busy={!live}
    >
      <div className="flex flex-col gap-2">
        <StatCard
          icon={<IconCoins size={18} className="text-casino-primary" aria-hidden />}
          label={t('sidebar.socialProof.betsWagered')}
          value={bets}
        />
        <StatCard
          icon={
            <span className="relative inline-flex">
              <IconUsers size={18} className="text-emerald-400" aria-hidden />
              <span className="absolute bottom-0 right-0 h-2 w-2 translate-x-px translate-y-px rounded-full bg-emerald-400 ring-2 ring-[rgba(24,24,28,0.95)]" />
            </span>
          }
          label={t('sidebar.socialProof.online')}
          value={online}
        />
      </div>
    </div>
  )
}
