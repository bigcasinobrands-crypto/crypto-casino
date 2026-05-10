import { useTranslation } from 'react-i18next'
import { IconCoins, IconUsers } from './icons'
import { useSocialProof } from '../hooks/useSocialProof'

const cardBase =
  'flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'

function formatWagerMinor(minor: number) {
  const dollars = minor / 100
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(dollars)
}

function formatOnline(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
}

type Props = {
  variant: 'desktop' | 'desktop-collapsed' | 'mobile'
}

export default function SidebarSocialProof({ variant }: Props) {
  const { t } = useTranslation()
  const payload = useSocialProof()

  if (!payload?.enabled) return null

  const bets = formatWagerMinor(payload.bets_wagered_display_minor)
  const online = formatOnline(payload.online_count)

  if (variant === 'desktop-collapsed') {
    return (
      <div
        className="shrink-0 border-t border-white/[0.06] bg-casino-sidebar px-1 pb-2 pt-2"
        aria-label={t('sidebar.socialProof.regionLabel')}
      >
        <div className="flex flex-col gap-1">
          <div
            className="flex flex-col items-center gap-0.5 rounded-lg bg-white/[0.04] px-1 py-1.5"
            title={`${t('sidebar.socialProof.betsWagered')}: ${bets}`}
          >
            <IconCoins size={14} className="shrink-0 text-casino-primary" aria-hidden />
            <span className="max-w-full truncate px-0.5 text-center text-[9px] font-bold tabular-nums text-white/85">
              {formatOnline(Math.round(payload.bets_wagered_display_minor / 100))}
            </span>
          </div>
          <div
            className="flex flex-col items-center gap-0.5 rounded-lg bg-white/[0.04] px-1 py-1.5"
            title={`${t('sidebar.socialProof.online')}: ${online}`}
          >
            <span className="relative flex shrink-0">
              <IconUsers size={14} className="text-emerald-400" aria-hidden />
              <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-1 ring-casino-sidebar" />
            </span>
            <span className="text-[9px] font-bold tabular-nums text-white/85">{online}</span>
          </div>
        </div>
      </div>
    )
  }

  if (variant === 'mobile') {
    return (
      <div
        className="shrink-0 border-t border-white/[0.06] bg-casino-sidebar px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2"
        onClick={(e) => e.stopPropagation()}
        role="region"
        aria-label={t('sidebar.socialProof.regionLabel')}
      >
        <div className="flex gap-1.5">
          <div className={`${cardBase} gap-1.5 py-1.5 pl-1.5 pr-1`}>
            <IconCoins size={15} className="shrink-0 text-casino-primary" aria-hidden />
            <div className="min-w-0">
              <div className="text-[9px] font-semibold leading-tight text-white/75">
                {t('sidebar.socialProof.betsWagered')}
              </div>
              <div className="truncate text-[11px] font-bold tabular-nums text-white/85">{bets}</div>
            </div>
          </div>
          <div className={`${cardBase} gap-1.5 py-1.5 pl-1.5 pr-1`}>
            <span className="relative flex shrink-0">
              <IconUsers size={15} className="text-emerald-400" aria-hidden />
              <span className="absolute bottom-0 right-0 h-1.5 w-1.5 translate-x-px translate-y-px rounded-full bg-emerald-400 ring-1 ring-[rgba(24,24,28,0.9)]" />
            </span>
            <div className="min-w-0">
              <div className="text-[9px] font-semibold leading-tight text-white/75">{t('sidebar.socialProof.online')}</div>
              <div className="truncate text-[11px] font-bold tabular-nums text-white/85">{online}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // desktop expanded
  return (
    <div
      className="shrink-0 border-t border-white/[0.06] bg-casino-sidebar px-2 pb-3 pt-2"
      role="region"
      aria-label={t('sidebar.socialProof.regionLabel')}
    >
      <div className="flex gap-1.5">
        <div className={cardBase}>
          <IconCoins size={18} className="shrink-0 text-casino-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold text-white/78">{t('sidebar.socialProof.betsWagered')}</div>
            <div className="truncate text-[13px] font-bold tabular-nums text-white/[0.88]">{bets}</div>
          </div>
        </div>
        <div className={cardBase}>
          <span className="relative flex shrink-0">
            <IconUsers size={18} className="text-emerald-400" aria-hidden />
            <span className="absolute bottom-0 right-0 h-2 w-2 translate-x-px translate-y-px rounded-full bg-emerald-400 ring-2 ring-[rgba(24,24,28,0.95)]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold text-white/78">{t('sidebar.socialProof.online')}</div>
            <div className="truncate text-[13px] font-bold tabular-nums text-white/[0.88]">{online}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
