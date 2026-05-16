import { useCallback, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthModal } from '../../authModalContext'
import { usePlayerAuth } from '../../playerAuth'
import {
  MOCK_MAX_PURCHASE_TICKETS,
  MOCK_REWARDS_GOLD_BALANCE,
  computePurchaseCostGold,
} from '../../lib/raffleMockData'
import { IconCoins } from '../icons'

export const RafflePurchasePanel: FC = () => {
  const { t } = useTranslation()
  const { isAuthenticated } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const [tickets, setTickets] = useState(0)

  const max = MOCK_MAX_PURCHASE_TICKETS
  const costGold = computePurchaseCostGold(tickets)

  const pctMarks = [0, 0.25, 0.5, 0.75, 1] as const

  const onBuy = useCallback(() => {
    if (!isAuthenticated) {
      openAuth('login', { navigateTo: '/raffle' })
      return
    }
    toast.message(t('raffle.purchase.comingSoonTitle'), {
      description: t('raffle.purchase.comingSoonBody'),
    })
  }, [isAuthenticated, openAuth, t])

  const sliderId = 'raffle-tickets-slider'

  return (
    <section className="rounded-casino-lg border border-casino-border bg-casino-surface p-6" aria-labelledby="raffle-buy-heading">
      <h2 id="raffle-buy-heading" className="sr-only">
        {t('raffle.purchase.sectionTitle')}
      </h2>
      <div className="grid gap-8 lg:grid-cols-[1fr_1.55fr]">
        <div className="flex flex-col gap-4">
          <h3 className="m-0 text-base font-bold uppercase tracking-wide text-casino-foreground">
            {t('raffle.purchase.balanceTitle')}
          </h3>
          <div className="inline-flex items-center gap-2 rounded-casino-md border border-white/[0.08] bg-casino-elevated px-4 py-3 text-sm font-semibold text-casino-foreground">
            <IconCoins size={18} className="shrink-0 text-casino-muted" aria-hidden />
            <span className="tabular-nums">
              {MOCK_REWARDS_GOLD_BALANCE.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className="text-[13px] leading-relaxed text-casino-muted">
            <p className="m-0 font-semibold text-casino-foreground">{t('raffle.purchase.pricingTitle')}</p>
            <p className="m-0 mt-1">{t('raffle.purchase.pricingNote')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-casino-md border border-white/[0.08] bg-casino-elevated px-4 py-3">
            <span className="text-sm text-casino-muted" id={`${sliderId}-label`}>
              {t('raffle.purchase.ticketsLabel')}
            </span>
            <span className="text-base font-bold tabular-nums text-casino-foreground" aria-live="polite">
              {tickets}
            </span>
          </div>

          <div className="px-2">
            <label htmlFor={sliderId} className="sr-only">
              {t('raffle.purchase.sliderAria')}
            </label>
            <input
              id={sliderId}
              type="range"
              min={0}
              max={max}
              step={1}
              value={tickets}
              onChange={(e) => setTickets(Number(e.target.value))}
              aria-labelledby={`${sliderId}-label`}
              aria-valuemin={0}
              aria-valuemax={max}
              aria-valuenow={tickets}
              className="h-2 w-full cursor-pointer accent-casino-primary"
            />
            <div className="mt-2 flex justify-between text-[10px] text-casino-muted" aria-hidden>
              {pctMarks.map((p) => (
                <span key={p}>{Math.round(p * 100)}%</span>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-casino-md border border-white/[0.08] bg-casino-elevated px-4 py-3">
            <span className="text-sm text-casino-muted">{t('raffle.purchase.costLabel')}</span>
            <span className="inline-flex items-center gap-2 text-base font-bold tabular-nums text-casino-foreground">
              <IconCoins size={18} className="text-casino-muted" aria-hidden />
              {costGold.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>

          <button
            type="button"
            onClick={onBuy}
            className="flex h-12 w-full items-center justify-center rounded-casino-md bg-casino-primary text-base font-bold text-white transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary"
          >
            {t('raffle.purchase.buyCta')}
          </button>
        </div>
      </div>
    </section>
  )
}
