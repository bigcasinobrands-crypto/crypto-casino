import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

export const RaffleHowItWorks: FC = () => {
  const { t } = useTranslation()

  return (
    <section className="rounded-casino-lg border border-casino-border bg-casino-surface p-6" aria-labelledby="raffle-how-heading">
      <h2 id="raffle-how-heading" className="mb-4 text-base font-bold uppercase tracking-wide text-casino-foreground">
        {t('raffle.howItWorks.title')}
      </h2>
      <p className="m-0 text-sm leading-relaxed text-casino-muted">{t('raffle.howItWorks.body')}</p>
    </section>
  )
}
