import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthModal } from '../authModalContext'
import { PLAYER_CHROME_OPEN_WALLET_MODAL_EVENT } from '../lib/playerChromeEvents'
import { usePlayerAuth } from '../playerAuth'
import { IconChevronDown } from './icons'
import { resolveCryptoLogoUrl, useCryptoLogoUrlMap } from '../lib/cryptoLogoUrls'

const CRYPTO_TICKERS = ['USDT', 'TRX', 'XRP', 'ETH', 'BTC', 'BNB'] as const

function BannerCryptoLogo({ symbol, src }: { symbol: string; src: string | undefined }) {
  const [bad, setBad] = useState(false)
  if (src && !bad) {
    return (
      <img
        src={src}
        alt=""
        width={36}
        height={36}
        className="size-[1.65rem] object-contain sm:size-[2rem]"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setBad(true)}
      />
    )
  }
  return (
    <span className="text-[8px] font-extrabold uppercase tracking-tight text-white/90" aria-hidden>
      {symbol}
    </span>
  )
}

/**
 * Lobby home strip: Vybe Bet surfaces + primary accent; coin marks use {@link useCryptoLogoUrlMap} / built-in CoinGecko list.
 */
export default function HomeCryptoPaymentsBanner({ depositsEnabled = true }: { depositsEnabled?: boolean }) {
  const { t } = useTranslation()
  const { isAuthenticated } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const logoUrls = useCryptoLogoUrlMap(CRYPTO_TICKERS)

  const resolved = useMemo(
    () =>
      CRYPTO_TICKERS.map((sym) => ({
        symbol: sym,
        url: resolveCryptoLogoUrl(logoUrls, sym),
      })),
    [logoUrls],
  )

  const openDepositFlow = () => {
    if (!depositsEnabled) return
    if (!isAuthenticated) {
      openAuth('login', { walletTab: 'deposit' })
      return
    }
    window.dispatchEvent(
      new CustomEvent(PLAYER_CHROME_OPEN_WALLET_MODAL_EVENT, { detail: { tab: 'deposit' as const } }),
    )
  }

  return (
    <section className="mb-4 min-[1280px]:mb-5" aria-label={t('lobby.cryptoPayments.ariaLabel')}>
      <div className="flex flex-col gap-3.5 rounded-2xl border border-white/[0.08] bg-casino-bg px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] sm:px-5 sm:py-4">
        <p className="text-center text-[13px] font-medium leading-snug text-white sm:text-sm">
          <span className="text-white/88">{t('lobby.cryptoPayments.supporting')}</span>{' '}
          <span className="font-bold text-casino-primary">{t('lobby.cryptoPayments.count')}</span>{' '}
          <span className="text-white/88">{t('lobby.cryptoPayments.currencies')}</span>
        </p>
        <div className="flex flex-col items-center gap-3 lg:flex-row lg:flex-wrap lg:justify-center lg:gap-x-4 lg:gap-y-2">
          <div
            className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5"
            role="list"
            aria-label={t('lobby.cryptoPayments.ariaLabel')}
          >
            {resolved.map(({ symbol, url }) => (
              <span
                key={symbol}
                role="listitem"
                title={symbol}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] ring-2 ring-casino-bg sm:h-11 sm:w-11"
              >
                <BannerCryptoLogo symbol={symbol} src={url} />
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={openDepositFlow}
            disabled={!depositsEnabled}
            title={!depositsEnabled ? t('operational.depositsUnavailable') : undefined}
            aria-label={!depositsEnabled ? t('operational.depositsUnavailable') : t('header.depositAriaLabel')}
            className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-casino-primary px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_12px_color-mix(in_srgb,var(--color-casino-primary)_35%,transparent)] transition-[filter,transform] hover:brightness-110 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/55 ${
              !depositsEnabled ? 'cursor-not-allowed opacity-40 hover:brightness-100' : ''
            }`}
          >
            {t('header.deposit')}
            <IconChevronDown size={16} className="opacity-95" aria-hidden />
          </button>
        </div>
      </div>
    </section>
  )
}
