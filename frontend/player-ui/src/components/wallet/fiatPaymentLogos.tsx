import { type FC } from 'react'
import { useTranslation } from 'react-i18next'

const PASSIMPAY_FIAT_LOGO = 'https://cdn1.passimpay.io/brandbook/logo/small_fiat2.svg'

/** Official Passim Pay fiat mark — orange brand plate per Passim brandbook. */
export const FiatPaymentMethodStrip: FC = () => {
  const { t } = useTranslation()

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-4">
      <div className="flex justify-center">
        <div
          className="flex min-h-[80px] w-full max-w-[min(100%,340px)] items-center justify-center gap-[10px] rounded-[10px] border-2 border-[rgb(255,102,0)] bg-[rgb(255,102,0)] px-4 py-3 sm:min-w-[300px]"
          role="img"
          aria-label={t('wallet.fiatPaymentMethodsAria')}
        >
          <img
            src={PASSIMPAY_FIAT_LOGO}
            alt=""
            className="h-auto max-h-[52px] w-auto max-w-[min(100%,280px)] object-contain"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </div>
  )
}
