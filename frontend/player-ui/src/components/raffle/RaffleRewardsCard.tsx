import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RAFFLE_ASSET_PATHS } from '../../lib/raffleMockData'

export const RaffleRewardsCard: FC = () => {
  const { t } = useTranslation()

  return (
    <section className="rounded-casino-lg border border-casino-border bg-casino-surface p-6" aria-labelledby="raffle-rewards-heading">
      <h2 id="raffle-rewards-heading" className="mb-4 text-base font-bold uppercase tracking-wide text-casino-foreground">
        {t('raffle.rewards.title')}
      </h2>
      <ul className="m-0 mb-6 flex list-none flex-col gap-3 p-0">
        <li className="text-sm font-medium text-casino-foreground">{t('raffle.rewards.casinoLine')}</li>
        <li className="text-sm font-medium text-casino-foreground">{t('raffle.rewards.sportsLine')}</li>
      </ul>
      <div className="-mt-2 flex justify-end sm:-mt-5">
        <img
          src={RAFFLE_ASSET_PATHS.goldenTicket}
          alt=""
          className="h-auto w-[100px] rounded-casino-md shadow-[0_10px_20px_rgba(0,0,0,0.45)] motion-safe:rotate-[15deg] sm:w-[120px]"
          loading="lazy"
        />
      </div>
    </section>
  )
}
