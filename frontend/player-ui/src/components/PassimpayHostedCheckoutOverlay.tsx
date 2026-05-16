import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { PLAYER_MODAL_STACK_OVERLAY_Z } from '../lib/playerChromeLayers'
import { WalletCloseButton } from './wallet/WalletShell'

/**
 * Hosted PassimPay checkout in an iframe, styled as the next step of the wallet deposit sheet
 * (same width, backdrop, and mobile inset as {@link WalletFlowModal}).
 *
 * If PassimPay blocks framing, the iframe may stay blank — footer links to a new tab.
 */
export function PassimpayHostedCheckoutOverlay({
  url,
  onClose,
}: {
  url: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()

  useEffect(() => {
    if (!url) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [url])

  useEffect(() => {
    if (!url) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [url, onClose])

  if (!url) return null

  const node = (
    <div
      className={`fixed inset-0 ${PLAYER_MODAL_STACK_OVERLAY_Z} flex items-end justify-center sm:items-center sm:p-4`}
      role="presentation"
    >
      {/* Same backdrop token as the wallet modal — reads as one surface */}
      <div className="absolute inset-0 bg-wallet-backdrop backdrop-blur-sm" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-passimpay-flow-in relative z-10 flex min-h-0 w-full max-w-[440px] flex-col overflow-hidden rounded-t-2xl border border-casino-border bg-wallet-modal shadow-[0_32px_64px_rgba(0,0,0,0.55)] max-sm:mb-[var(--casino-mobile-nav-offset)] max-sm:max-h-[calc(100dvh-var(--casino-mobile-nav-offset))] sm:max-h-[min(90vh,720px)] sm:rounded-2xl"
      >
        <div className="flex shrink-0 flex-col gap-3 border-b border-white/[0.06] px-6 pb-4 pt-5 max-sm:px-5 max-sm:pb-3 max-sm:pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-casino-muted">
                {t('wallet.passimpayFlowEyebrow')}
              </p>
              <h2 id={titleId} className="mt-1 text-base font-semibold tracking-tight text-white">
                {t('wallet.passimpayHostedTitle')}
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-casino-muted">{t('wallet.passimpayFlowSubtitle')}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 text-left text-xs font-semibold text-casino-primary transition hover:brightness-110"
              >
                {t('wallet.passimpayBackToDeposit')}
              </button>
            </div>
            <WalletCloseButton label={t('wallet.passimpayCloseCheckout')} onClick={onClose} />
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-black">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-3 bg-gradient-to-b from-wallet-modal to-transparent"
            aria-hidden
          />
          <iframe
            src={url}
            title={t('wallet.passimpayHostedIframeTitle')}
            className="relative z-0 size-full min-h-[min(52dvh,420px)] sm:min-h-[min(56vh,480px)]"
            referrerPolicy="no-referrer-when-downgrade"
            allow="payment *; fullscreen"
          />
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-white/[0.06] bg-wallet-modal px-6 py-3 max-sm:px-5 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-casino-muted">{t('wallet.passimpayEmbedHint')}</p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs font-semibold text-casino-primary underline-offset-2 hover:underline"
            >
              {t('wallet.passimpayOpenNewTab')}
            </a>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
