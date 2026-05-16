import { type FC, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useRecentWins } from '../hooks/useRecentWins'

function formatWinMinor(minor: number, currency: string, locale: string): string {
  const ccyRaw = currency.trim().toUpperCase() || 'USD'
  const iso = ccyRaw === 'USDT' ? 'USD' : ccyRaw
  const major = minor / 100
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: iso,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major)
  } catch {
    return `$${major.toFixed(2)}`
  }
}

function RecentWinCard({
  thumb,
  title,
  player,
  amountLabel,
}: {
  thumb: string
  title: string
  player: string
  amountLabel: string
}) {
  return (
    <article
      className="flex w-[5.25rem] shrink-0 flex-col overflow-hidden rounded-lg border border-white/[0.07] bg-[#121212] shadow-[0_4px_12px_rgba(0,0,0,0.38)] sm:w-[5.875rem] md:w-[6.25rem]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-black/50">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[8px] font-bold text-white/25 sm:text-[9px]">
            —
          </div>
        )}
      </div>
      <div className="flex min-h-[2.6rem] flex-col gap-px px-1.5 py-1.5 sm:min-h-[2.85rem] sm:gap-0.5 sm:px-2 sm:py-1.5 md:min-h-[3rem] md:py-2">
        <p className="truncate text-[10px] font-semibold leading-tight text-white sm:text-[11px]">{player}</p>
        <p
          className="truncate text-[8px] font-medium leading-tight text-white/38 sm:text-[9px]"
          title={title}
        >
          {title}
        </p>
        <p className="pt-0.5 text-[10px] font-bold tabular-nums leading-none text-casino-success sm:text-[11px] md:text-[12px]">
          {amountLabel}
        </p>
      </div>
    </article>
  )
}

const RecentWinsMarquee: FC = () => {
  const { t, i18n } = useTranslation()
  const data = useRecentWins()

  const live = data && data.enabled === true ? data : null
  const rows = live?.wins ?? []
  const doubled = useMemo(() => {
    if (rows.length === 0) return []
    return [...rows, ...rows]
  }, [rows])

  const durationSec = live ? Math.max(12, Math.min(200, live.marquee_duration_sec || 42)) : 42

  if (!live || rows.length === 0) return null

  return (
    <section className="mb-4 min-w-0 sm:mb-5 md:mb-6">
      <div
        className="relative -mx-0.5 overflow-hidden py-0.5 mask-marquee-fade-x sm:py-1"
        role="region"
        aria-label={t('lobby.recentWinsAria')}
      >
        <div
          className="recent-wins-marquee-track gap-2 sm:gap-2.5 md:gap-3"
          style={{ animationDuration: `${durationSec}s` }}
        >
          {doubled.map((w, i) => (
            <RecentWinCard
              key={`${w.game_id}-${w.player_label}-${w.amount_minor}-${i}`}
              thumb={w.thumbnail_url}
              title={w.game_title || 'Game'}
              player={w.player_label}
              amountLabel={formatWinMinor(w.amount_minor, w.currency, i18n.language)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

export default RecentWinsMarquee
