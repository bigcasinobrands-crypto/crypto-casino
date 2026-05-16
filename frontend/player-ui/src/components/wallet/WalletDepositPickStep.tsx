import { useMemo, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { DepositWrongChainWarning, UsdAmountField, ChooseAssetNetworkHint } from '../DepositFlowShared'
import { resolveCryptoLogoUrl, useCryptoLogoUrlMap } from '../../lib/cryptoLogoUrls'
import type { PassimpayCurrency } from '../../lib/paymentCurrencies'
import { currencyOptionLabel, currencyTokenLabelForGroupRow, formatMinorHint, groupPassimpayCurrenciesByNetwork, passimpayNetworkLabel } from '../../lib/paymentCurrencies'
import { WalletNativeSelectRow, WalletPanel, WalletPrimaryButton } from './WalletShell'
import { CryptoLogoMark } from './CryptoLogoMark'

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
  /**
   * When true (wallet modal on phones), pin Continue below a scroll area so the currency dropdown
   * has room and the CTA stays above the home indicator / bottom nav.
   */
  splitFooter?: boolean
  /** Wallet sheet ref — currency menu can translate the sheet up on small screens. */
  menuLiftScopeRef?: RefObject<HTMLElement | null>
  onMenuLiftPxChange?: (px: number) => void
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
  splitFooter = false,
  menuLiftScopeRef,
  onMenuLiftPxChange,
}: Props) {
  const { t } = useTranslation()
  const depositList = useMemo(() => currencies.filter((c) => c.deposit_enabled), [currencies])
  const depositSymbols = useMemo(() => depositList.map((c) => c.symbol), [depositList])
  const logoUrls = useCryptoLogoUrlMap(depositSymbols)

  const currencyGroups = useMemo(() => groupPassimpayCurrenciesByNetwork(depositList), [depositList])

  const optionGroups = useMemo(
    () =>
      currencyGroups.map((g) => ({
        groupId: g.groupId,
        heading: g.heading,
        options: g.currencies.map((c) => {
          const symLogo = resolveCryptoLogoUrl(logoUrls, c.symbol, c.network)
          return {
            value: String(c.payment_id),
            label: currencyTokenLabelForGroupRow(c),
            summaryLabel: currencyOptionLabel(c),
            icon: <CryptoLogoMark url={symLogo} />,
          }
        }),
      })),
    [currencyGroups, logoUrls],
  )

  const minPassimpay = selected ? formatMinorHint(selected.symbol, selected.min_deposit_minor, selected.decimals) : null

  const fields = (
    <>
      <WalletPanel className="mb-4 border border-white/[0.06] shadow-none">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-casino-muted">
          {t('wallet.depositSectionAmount')}
        </p>
        <UsdAmountField value={amountUsd} onChange={onAmountUsd} minUsd={minUsd} tone="wallet" />
        {amountErr ? (
          <p className="mt-2 text-xs text-red-400" role="alert">
            {amountErr}
          </p>
        ) : null}
      </WalletPanel>

      <ChooseAssetNetworkHint />

      {currenciesLoading ? (
        <p className="mb-3 text-xs text-casino-muted">{t('wallet.passimpayCurrenciesLoading')}</p>
      ) : null}
      {currenciesError ? (
        <div className="mb-3 rounded-lg border border-casino-border bg-casino-surface px-3 py-2.5" role="alert">
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

      <WalletPanel className="mb-4 border border-white/[0.06] shadow-none">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-casino-muted">
          {t('wallet.depositSectionAsset')}
        </p>
        <WalletNativeSelectRow
          label={t('wallet.passimpayCurrency')}
          value={selected ? String(selected.payment_id) : ''}
          onChange={(v) => {
            const row = depositList.find((c) => String(c.payment_id) === v)
            if (row) onSelect(row)
          }}
          optionGroups={optionGroups}
          menuLiftScopeRef={menuLiftScopeRef}
          onMenuLiftPxChange={onMenuLiftPxChange}
        />
        {selected && (minPassimpay || selected.requires_tag) ? (
          <p className="-mt-2 mb-0 text-[11px] leading-snug text-casino-muted">
            {minPassimpay ? t('wallet.passimpayMinDeposit', { amount: minPassimpay }) : null}
            {minPassimpay && selected.requires_tag ? ' ' : null}
            {selected.requires_tag ? t('wallet.passimpayRequiresTag') : null}
          </p>
        ) : null}
      </WalletPanel>

      {selected ? (
        <div className="mb-1">
          <DepositWrongChainWarning
            symbol={selected.symbol}
            networkLabel={passimpayNetworkLabel(selected.network)}
          />
        </div>
      ) : null}
    </>
  )

  const continueBtn = (
    <WalletPrimaryButton onClick={onContinue} disabled={!selected || depositList.length === 0}>
      {continueLabel}
    </WalletPrimaryButton>
  )

  if (splitFooter) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-sm:flex-none sm:min-h-0">
        <div className="min-h-0 overflow-y-auto overscroll-y-contain scroll-smooth px-3 py-1 scrollbar-casino max-sm:max-h-[min(62dvh,520px)] max-sm:flex-none sm:flex-1 sm:min-h-0 sm:px-4 sm:py-2">
          {fields}
        </div>
        <div className="z-[1] shrink-0 bg-wallet-modal pb-[max(1.125rem,calc(env(safe-area-inset-bottom,0px)+14px))] pt-1 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]">
          <div className="px-3 pt-3 sm:px-4 [&_button]:mt-0">
            {continueBtn}
          </div>
          <div className="mt-3 h-px shrink-0 bg-casino-border -mx-6" aria-hidden />
        </div>
      </div>
    )
  }

  return (
    <>
      {fields}
      {continueBtn}
    </>
  )
}
