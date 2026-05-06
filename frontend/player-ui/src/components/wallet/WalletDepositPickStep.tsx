import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DepositWrongChainWarning, UsdAmountField, ChooseAssetNetworkHint } from '../DepositFlowShared'
import { useCryptoLogoUrlMap } from '../../lib/cryptoLogoUrls'
import type { PassimpayCurrency } from '../../lib/paymentCurrencies'
import { currencyOptionLabel, formatMinorHint, passimpayNetworkLabel } from '../../lib/paymentCurrencies'
import { WalletNativeSelectRow, WalletPanel, WalletPrimaryButton } from './WalletShell'
import { IconCircleDollarSign } from '../icons'

type Props = {
  amountUsd: string
  onAmountUsd: (v: string) => void
  amountErr: string | null
  minUsd: number
  onContinue: () => void
  continueLabel: string
  currencies: PassimpayCurrency[]
  currenciesLoading: boolean
  currenciesError: string | null
  /** Shown when currencies failed to load */
  onRetryCurrencies?: () => void
  selected: PassimpayCurrency | null
  onSelect: (c: PassimpayCurrency) => void
}

export function WalletDepositPickStep({
  amountUsd,
  onAmountUsd,
  amountErr,
  minUsd,
  onContinue,
  continueLabel,
  currencies,
  currenciesLoading,
  currenciesError,
  onRetryCurrencies,
  selected,
  onSelect,
}: Props) {
  const { t } = useTranslation()
  const logoUrls = useCryptoLogoUrlMap()

  const depositList = useMemo(() => currencies.filter((c) => c.deposit_enabled), [currencies])

  const selectOpts = useMemo(
    () =>
      depositList.map((c) => ({
        value: String(c.payment_id),
        label: currencyOptionLabel(c),
      })),
    [depositList],
  )

  const symLogo = selected ? logoUrls?.[selected.symbol.toLowerCase()] : undefined

  const minPassimpay = selected ? formatMinorHint(selected.symbol, selected.min_deposit_minor) : null

  return (
    <>
      <UsdAmountField value={amountUsd} onChange={onAmountUsd} minUsd={minUsd} tone="wallet" />
      {amountErr ? (
        <p className="mb-2 text-xs text-red-400" role="alert">
          {amountErr}
        </p>
      ) : null}

      <ChooseAssetNetworkHint />

      {currenciesLoading ? (
        <p className="mb-3 text-xs text-casino-muted">{t('wallet.passimpayCurrenciesLoading')}</p>
      ) : null}
      {currenciesError ? (
        <div className="mb-3 rounded-lg border border-casino-border bg-casino-elevated/80 px-3 py-2.5" role="alert">
          <p className="text-xs text-red-400">{currenciesError}</p>
          {onRetryCurrencies ? (
            <button
              type="button"
              onClick={onRetryCurrencies}
              className="mt-2 rounded-[10px] bg-casino-primary px-3 py-1.5 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition hover:brightness-110"
            >
              {t('wallet.passimpayRetry')}
            </button>
          ) : null}
        </div>
      ) : null}
      {!currenciesLoading && !currenciesError && depositList.length === 0 ? (
        <p className="mb-3 text-xs text-amber-200/90" role="status">
          {t('wallet.passimpayNoDepositCurrencies')}
        </p>
      ) : null}

      <WalletPanel className="mb-4 mt-2">
        <WalletNativeSelectRow
          label={t('wallet.passimpayCurrency')}
          value={selected ? String(selected.payment_id) : ''}
          onChange={(v) => {
            const row = depositList.find((c) => String(c.payment_id) === v)
            if (row) onSelect(row)
          }}
          options={selectOpts}
          icon={
            symLogo ? (
              <img src={symLogo} alt="" className="size-5 rounded-full object-cover" loading="lazy" />
            ) : (
              <IconCircleDollarSign size={16} className="text-casino-primary" aria-hidden />
            )
          }
        />
        {selected ? (
          <p className="mb-4 text-[11px] leading-snug text-casino-muted">
            {t('wallet.passimpayProviderNote', {
              id: selected.payment_id,
              sym: selected.symbol,
              net: selected.network || '—',
            })}
            {minPassimpay
              ? ` ${t('wallet.passimpayMinDeposit', { amount: minPassimpay })}`
              : ''}
            {selected.requires_tag ? ` ${t('wallet.passimpayRequiresTag')}` : ''}
          </p>
        ) : null}
      </WalletPanel>

      {selected ? (
        <div className="mb-3">
          <DepositWrongChainWarning
            symbol={selected.symbol}
            networkLabel={passimpayNetworkLabel(selected.network)}
          />
        </div>
      ) : null}

      <WalletPrimaryButton onClick={onContinue} disabled={!selected || depositList.length === 0}>
        {continueLabel}
      </WalletPrimaryButton>
    </>
  )
}
