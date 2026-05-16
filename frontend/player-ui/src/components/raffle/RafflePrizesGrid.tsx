import { useMemo, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MOCK_EXTRA_WINNERS_COUNT,
  MOCK_TOP_PRIZES,
  formatPrizeMinor,
  formatUsd,
  generateExtendedWinners,
  type ApiRafflePrizeRow,
  type PrizeBadgeTier,
} from '../../lib/raffleMockData'
import { IconUser } from '../icons'
import { RaffleWinnersModal } from './RaffleWinnersModal'

function badgeClass(tier: PrizeBadgeTier): string {
  switch (tier) {
    case 'gold':
      return 'bg-amber-400 text-black'
    case 'silver':
      return 'bg-zinc-400 text-black'
    case 'bronze':
      return 'bg-amber-800 text-white'
    default:
      return 'border border-white/[0.1] bg-casino-elevated text-casino-muted'
  }
}

function badgeForRank(rank: number): PrizeBadgeTier {
  if (rank <= 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'normal'
}

type Props = {
  /** When set, ladder comes from GET /v1/raffles/:slug (live API). */
  apiPrizes?: ApiRafflePrizeRow[] | null
}

export const RafflePrizesGrid: FC<Props> = ({ apiPrizes }) => {
  const { t } = useTranslation()
  const [winnersOpen, setWinnersOpen] = useState(false)
  const extendedWinners = useMemo(() => generateExtendedWinners(), [])

  const showMockWinnerNames = !apiPrizes || apiPrizes.length === 0

  const prizeCards = useMemo(() => {
    if (apiPrizes && apiPrizes.length > 0) {
      return apiPrizes.map((p) => ({
        key: `api-${p.rank_order}-${p.amount_minor}-${p.currency}`,
        rank: p.rank_order,
        moneyLabel: formatPrizeMinor(p.amount_minor, p.currency),
        badge: badgeForRank(p.rank_order),
        subtitle: p.prize_type,
        username: '',
      }))
    }
    return MOCK_TOP_PRIZES.map((row) => ({
      key: `mock-${row.rank}`,
      rank: row.rank,
      moneyLabel: formatUsd(row.amountUsd),
      badge: row.badge,
      subtitle: '',
      username: row.username,
    }))
  }, [apiPrizes])

  return (
    <>
      <section className="border-none bg-transparent p-0" aria-labelledby="raffle-prizes-heading">
        <h2 id="raffle-prizes-heading" className="mb-6 text-base font-bold uppercase tracking-wide text-casino-foreground">
          {t('raffle.prizes.title')}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {prizeCards.map((row) => (
            <article
              key={row.key}
              className="flex flex-col gap-8 rounded-casino-lg border border-casino-border bg-casino-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-xl font-extrabold text-casino-foreground">{row.moneyLabel}</div>
                <span className={`rounded-xl px-2.5 py-1 text-xs font-bold ${badgeClass(row.badge)}`}>
                  {row.rank >= 1 && row.rank <= 10
                    ? t(`raffle.badges.rank${row.rank}`)
                    : t('raffle.badges.rankOther', { n: row.rank })}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {row.subtitle ? (
                  <span className="text-xs font-semibold uppercase tracking-wide text-casino-muted">{row.subtitle}</span>
                ) : null}
                <span className="text-xs text-casino-muted">{t('raffle.prizes.lastWeek')}</span>
                {showMockWinnerNames ? (
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-casino-foreground">
                    <IconUser size={14} className="shrink-0 text-casino-muted" aria-hidden />
                    <span className="truncate">{row.username}</span>
                  </div>
                ) : (
                  <div className="text-[13px] text-casino-muted">{t('raffle.prizes.liveLadderHint')}</div>
                )}
              </div>
            </article>
          ))}

          <div className="flex flex-col justify-center gap-4 rounded-casino-lg border border-casino-border bg-casino-surface p-5 sm:col-span-2">
            <p className="m-0 text-base font-semibold text-casino-foreground">
              {t('raffle.prizes.moreWinners', { count: MOCK_EXTRA_WINNERS_COUNT })}
            </p>
            <button
              type="button"
              onClick={() => setWinnersOpen(true)}
              className="w-fit rounded-casino-sm border border-white/[0.1] bg-casino-elevated px-4 py-2 text-[13px] font-semibold text-casino-foreground transition hover:bg-casino-chip-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary"
            >
              {t('raffle.prizes.seeAllWinners')}
            </button>
          </div>
        </div>
      </section>

      <RaffleWinnersModal open={winnersOpen} onClose={() => setWinnersOpen(false)} winners={extendedWinners} />
    </>
  )
}
