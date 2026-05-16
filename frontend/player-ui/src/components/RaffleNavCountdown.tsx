import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type { PromoRaffleLiveState } from '../hooks/usePromoRaffleLive'
import { useRaffleCountdown } from './raffle/RaffleCountdown'

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

const RaffleNavCountdownLoaded: FC<{ endMs: number; className?: string }> = ({ endMs, className }) => {
  const { t } = useTranslation()
  const { days, hours, minutes, seconds, expired } = useRaffleCountdown(endMs)
  if (expired) {
    return (
      <span className={className} aria-live="polite">
        {t('lobby.hero.raffleCountdownEnded')}
      </span>
    )
  }
  return (
    <span className={`tabular-nums ${className ?? ''}`} aria-live="polite">
      {pad2(days)}:{pad2(hours)}:{pad2(minutes)}:{pad2(seconds)}
    </span>
  )
}

/** Compact DD:HH:MM:SS line for nav raffle CTAs (sidebar / drawer). */
export function RaffleNavCountdown({
  raffleLive,
  className,
}: {
  raffleLive: PromoRaffleLiveState
  className?: string
}) {
  const { t } = useTranslation()
  if (raffleLive.loading) {
    return <span className={className}>{t('lobby.hero.raffleCountdownLoading')}</span>
  }
  if (raffleLive.endMs == null) {
    return <span className={className}>{t('lobby.hero.noActiveRaffleShort')}</span>
  }
  return <RaffleNavCountdownLoaded endMs={raffleLive.endMs} className={className} />
}
