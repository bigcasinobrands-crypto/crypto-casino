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
      className="flex w-[7.35rem] shrink-0 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#121212] shadow-[0_6px_18px_rgba(0,0,0,0.45)] sm:w-[7.75rem]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-black/50">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-white/25">—</div>
        )}
      </div>
      <div className="flex min-h-[3.35rem] flex-col gap-0.5 px-2 py-2">
        <p className="truncate text-[11px] font-semibold leading-tight text-white">{player}</p>
        <p className="truncate text-[9px] font-medium leading-tight text-white/38" title={title}>
          {title}
        </p>
        <p className="pt-0.5 text-[12px] font-bold tabular-nums leading-none text-casino-success">{amountLabel}</p>
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
    <section className="mb-6 min-w-0" aria-label={t('lobby.recentWinsAria')}>
      <div className="mb-2.5 flex items-center gap-2 px-0.5">
        <span className="inline-flex size-6 items-center justify-center rounded-md bg-white/[0.06] text-casino-success shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 2l2.09 6.26L20 9l-5 3.64L16.18 20 12 16.77 7.82 20 9 12.64 4 9l5.91-.74L12 2z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/88">{t('lobby.recentWinsTitle')}</h2>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-black/40 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div
          className="recent-wins-marquee-track gap-3 pl-3 pr-3"
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
