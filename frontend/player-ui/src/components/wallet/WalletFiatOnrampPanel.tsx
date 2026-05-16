import { type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { FIAT_DEPOSIT_CURRENCY_CODES } from '../../lib/fiatCurrencies'
import { UsdAmountField } from '../DepositFlowShared'
import { WalletPanel, WalletPrimaryButton } from './WalletShell'
import { FiatPaymentMethodStrip } from './fiatPaymentLogos'

export type WalletFiatOnrampPanelProps = {
  amountUsd: string
  onAmountUsd: (v: string) => void
  minUsd: number
  fiatCurrency: string
  onFiatCurrency: (code: string) => void
  /** Validation message shown below amount (e.g. after Pay tapped). */
  amountErr: string | null
  onPay: () => void | Promise<void>
  /** Disables Pay while opening hosted checkout. */
  payBusy?: boolean
}

export const WalletFiatOnrampPanel: FC<WalletFiatOnrampPanelProps> = ({
  amountUsd,
  onAmountUsd,
  minUsd,
  fiatCurrency,
  onFiatCurrency,
  amountErr,
  onPay,
  payBusy = false,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-1 max-sm:flex-none sm:px-4 sm:py-2">
      <WalletPanel className="border border-white/[0.06] shadow-none">
        <p className="text-sm font-semibold text-white">{t('wallet.fiatOnrampPlaceholderTitle')}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-casino-muted">{t('wallet.fiatOnrampPlaceholderBody')}</p>

        <div className="mt-4">
          <UsdAmountField
            value={amountUsd}
            onChange={onAmountUsd}
            minUsd={minUsd}
            tone="wallet"
            fiatCurrency={{
              value: fiatCurrency,
              options: FIAT_DEPOSIT_CURRENCY_CODES,
              onChange: onFiatCurrency,
            }}
          />
          {amountErr ? (
            <p className="mt-2 text-xs text-red-400" role="alert">
              {amountErr}
            </p>
          ) : null}
        </div>

        <div className="mt-4 [&_button]:mt-0">
          <WalletPrimaryButton onClick={() => void onPay()} disabled={payBusy}>
            {payBusy ? t('wallet.depositInvoiceOpening') : t('wallet.fiatPayCta')}
          </WalletPrimaryButton>
        </div>

        <FiatPaymentMethodStrip />
      </WalletPanel>
    </div>
  )
}
