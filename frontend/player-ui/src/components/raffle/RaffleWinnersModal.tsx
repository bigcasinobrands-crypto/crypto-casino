import { useEffect, useId, type FC } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { formatUsd, type ExtendedWinner } from '../../lib/raffleMockData'
import { IconUser, IconX } from '../icons'

type Props = {
  open: boolean
  onClose: () => void
  winners: ExtendedWinner[]
}

export const RaffleWinnersModal: FC<Props> = ({ open, onClose, winners }) => {
  const { t } = useTranslation()
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-md"
        aria-label={t('raffle.winnersModal.closeAria')}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col rounded-t-2xl border border-white/[0.12] bg-casino-card shadow-2xl sm:max-h-[85vh] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.08] px-4 py-3 sm:px-5">
          <h2 id={titleId} className="m-0 pr-8 text-base font-extrabold text-casino-foreground">
            {t('raffle.winnersModal.title')}
          </h2>
          <button
            type="button"
            className="absolute right-3 top-3 rounded-lg p-2 text-casino-muted transition hover:bg-white/[0.06] hover:text-casino-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary"
            aria-label={t('raffle.winnersModal.closeAria')}
            onClick={onClose}
          >
            <IconX size={18} aria-hidden />
          </button>
        </div>
        <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-y-contain px-4 py-3 sm:px-5 scrollbar-casino">
          {winners.map((w) => (
            <li
              key={w.rank}
              className="flex items-center justify-between gap-3 border-b border-white/[0.06] py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="w-8 shrink-0 text-xs font-bold tabular-nums text-casino-muted">#{w.rank}</span>
                <IconUser size={14} className="shrink-0 text-casino-muted" aria-hidden />
                <span className="truncate text-sm font-semibold text-casino-foreground">{w.username}</span>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums text-casino-foreground">{formatUsd(w.amountUsd)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
