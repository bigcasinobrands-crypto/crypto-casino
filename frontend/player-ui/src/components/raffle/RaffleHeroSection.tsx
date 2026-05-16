import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { IconTicket } from '../icons'
import { RAFFLE_ASSET_PATHS } from '../../lib/raffleMockData'
import { RaffleCountdown } from './RaffleCountdown'

type Props = {
  endMs: number
  userTickets: number
}

export const RaffleHeroSection: FC<Props> = ({ endMs, userTickets }) => {
  const { t } = useTranslation()

  return (
    <section
      className="flex min-h-[280px] flex-col overflow-hidden rounded-casino-lg border border-casino-border bg-casino-surface lg:min-h-[320px] lg:flex-row"
      aria-labelledby="raffle-hero-title"
    >
      <div className="flex flex-1 flex-col justify-center gap-8 p-8 lg:p-10">
        <h2 id="raffle-hero-title" className="text-2xl font-extrabold leading-tight text-casino-foreground sm:text-[28px] lg:text-[32px]">
          {t('raffle.heroTitle')}
        </h2>

        <RaffleCountdown
          endMs={endMs}
          dayLabel={t('raffle.countdown.day')}
          hourLabel={t('raffle.countdown.hour')}
          minLabel={t('raffle.countdown.min')}
          secLabel={t('raffle.countdown.sec')}
        />

        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-casino-muted">{t('raffle.yourTicketsLabel')}</span>
          <div className="inline-flex w-fit items-center gap-2 rounded-casino-md border border-white/[0.08] bg-casino-elevated px-4 py-2 text-sm font-semibold text-casino-foreground">
            <span className="tabular-nums">{userTickets}</span>
            <IconTicket size={18} className="shrink-0 text-casino-primary" aria-hidden />
          </div>
        </div>
      </div>

      <div className="relative flex min-h-[200px] flex-1 items-center justify-center bg-[radial-gradient(circle,_rgb(48,48,48)_0%,_rgb(28,28,28)_72%)] lg:max-w-[400px] lg:flex-none lg:basis-[400px]">
        <img
          src={RAFFLE_ASSET_PATHS.heroGraphic}
          alt={t('raffle.heroImageAlt')}
          className="max-h-[260px] w-full object-contain p-5 opacity-95 lg:max-h-none lg:h-full lg:max-h-[320px]"
        />
      </div>
    </section>
  )
}
