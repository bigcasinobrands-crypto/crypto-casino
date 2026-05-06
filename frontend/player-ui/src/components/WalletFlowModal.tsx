import { useEffect, useId, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { PLAYER_MODAL_OVERLAY_Z } from '../lib/playerChromeLayers'
import { passimpayNetworkLabel } from '../lib/paymentCurrencies'
import { usePassimpayCurrencies } from '../hooks/usePassimpayCurrencies'
import type { PassimpayCurrency } from '../lib/paymentCurrencies'
import { DepositAddressPanel, DepositSentPanel } from './walletDepositPanels'
import { WithdrawFormPanel, WithdrawSuccessPanel } from './walletWithdrawPanels'
import { WalletDepositPickStep } from './wallet/WalletDepositPickStep'
import { WalletCloseButton, WalletMainTabs } from './wallet/WalletShell'

export type WalletMainTab = 'deposit' | 'withdraw'

type WalletFlowModalProps = {
  open: boolean
  onClose: () => void
  initialTab: WalletMainTab
}

const MIN_USD = 10

const WalletFlowModal: FC<WalletFlowModalProps> = ({ open, onClose, initialTab }) => {
  const { t } = useTranslation()
  const titleId = useId()
  const [mainTab, setMainTab] = useState<WalletMainTab>(initialTab)
  const [amountUsd, setAmountUsd] = useState('10.00')
  const [amountErr, setAmountErr] = useState<string | null>(null)

  const { currencies, loading: currenciesLoading, error: currenciesError, reload: reloadCurrencies } =
    usePassimpayCurrencies(open)

  const [depositPick, setDepositPick] = useState<PassimpayCurrency | null>(null)
  const [withdrawPick, setWithdrawPick] = useState<PassimpayCurrency | null>(null)
  const [committedDeposit, setCommittedDeposit] = useState<PassimpayCurrency | null>(null)

  const [depositFlowStep, setDepositFlowStep] = useState<'pick' | 'address' | 'sent'>('pick')
  const [committedAmountUsd, setCommittedAmountUsd] = useState('10.00')

  const [withdrawFlowStep, setWithdrawFlowStep] = useState<'form' | 'success'>('form')
  const [withdrawCtx, setWithdrawCtx] = useState<{
    id: string
    symbol: string
    network: string
    payment_id?: number
  } | null>(null)

  useEffect(() => {
    if (!open) return
    setMainTab(initialTab)
    setDepositFlowStep('pick')
    setWithdrawFlowStep('form')
    setWithdrawCtx(null)
    setCommittedDeposit(null)
    setDepositPick(null)
    setWithdrawPick(null)
  }, [open, initialTab])

  useEffect(() => {
    if (!currencies.length) return
    setDepositPick((prev) => prev ?? currencies.find((c) => c.deposit_enabled) ?? null)
    setWithdrawPick((prev) => prev ?? currencies.find((c) => c.withdraw_enabled) ?? null)
  }, [currencies])

  useEffect(() => {
    if (mainTab !== 'deposit') setDepositFlowStep('pick')
  }, [mainTab])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const continueToAddressInModal = () => {
    setAmountErr(null)
    const parsed = Number(amountUsd.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed < MIN_USD) {
      setAmountErr(t('wallet.enterMinUsd', { min: MIN_USD }))
      return
    }
    if (!depositPick) {
      setAmountErr(t('wallet.passimpayPickCurrency'))
      return
    }
    setCommittedAmountUsd(parsed.toFixed(2))
    setCommittedDeposit(depositPick)
    setDepositFlowStep('address')
  }

  if (!open) return null

  const depositSentNetworkLabel =
    committedDeposit != null ? passimpayNetworkLabel(committedDeposit.network) : ''

  return (
    <div
      className={`fixed inset-0 ${PLAYER_MODAL_OVERLAY_Z} flex items-end justify-center sm:items-center sm:p-4`}
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-wallet-backdrop backdrop-blur-sm"
        aria-label={t('wallet.close')}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(90dvh,720px)] w-full max-w-[440px] flex-col overflow-hidden rounded-t-2xl border border-casino-border bg-wallet-modal shadow-[0_32px_64px_rgba(0,0,0,0.55)] sm:max-h-[min(90vh,720px)] sm:rounded-2xl"
      >
        <WalletCloseButton label={t('wallet.close')} onClick={onClose} />
        <h2 id={titleId} className="sr-only">
          {mainTab === 'deposit'
            ? depositFlowStep === 'address'
              ? t('wallet.srDepositAddress')
              : depositFlowStep === 'sent'
                ? t('wallet.srDepositSubmitted')
                : t('wallet.srDepositFunds')
            : withdrawFlowStep === 'success'
              ? t('wallet.srWithdrawStatus')
              : t('wallet.srWithdrawFunds')}
        </h2>

        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-6">
          <WalletMainTabs
            active={mainTab}
            onChange={setMainTab}
            depositLabel={t('wallet.deposit')}
            withdrawLabel={t('wallet.withdraw')}
          />

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {mainTab === 'deposit' ? (
              depositFlowStep === 'pick' ? (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth scrollbar-casino">
                  <WalletDepositPickStep
                    amountUsd={amountUsd}
                    onAmountUsd={setAmountUsd}
                    amountErr={amountErr}
                    minUsd={MIN_USD}
                    onContinue={continueToAddressInModal}
                    continueLabel={t('wallet.continue')}
                    currencies={currencies}
                    currenciesLoading={currenciesLoading}
                    currenciesError={currenciesError}
                    onRetryCurrencies={() => void reloadCurrencies()}
                    selected={depositPick}
                    onSelect={setDepositPick}
                  />
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth scrollbar-casino">
                  {depositFlowStep === 'address' && committedDeposit ? (
                    <DepositAddressPanel
                      paymentId={committedDeposit.payment_id}
                      symbol={committedDeposit.symbol}
                      network={committedDeposit.network}
                      amountUsdText={committedAmountUsd}
                      onBack={() => setDepositFlowStep('pick')}
                      onSent={() => setDepositFlowStep('sent')}
                    />
                  ) : depositFlowStep === 'sent' && committedDeposit ? (
                    <DepositSentPanel
                      symbol={committedDeposit.symbol}
                      network={depositSentNetworkLabel}
                      onDepositAgain={() => setDepositFlowStep('pick')}
                    />
                  ) : null}
                </div>
              )
            ) : withdrawFlowStep === 'form' ? (
              <WithdrawFormPanel
                splitFooter
                currencies={currencies}
                currenciesLoading={currenciesLoading}
                currenciesError={currenciesError}
                onRetryCurrencies={() => void reloadCurrencies()}
                selected={withdrawPick}
                onSelect={setWithdrawPick}
                onSuccess={(p) => {
                  setWithdrawCtx(p)
                  setWithdrawFlowStep('success')
                }}
              />
            ) : withdrawCtx ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth scrollbar-casino">
                <WithdrawSuccessPanel
                  id={withdrawCtx.id}
                  network={withdrawCtx.network}
                  symbol={withdrawCtx.symbol}
                  paymentId={withdrawCtx.payment_id}
                  onAnother={() => {
                    setWithdrawFlowStep('form')
                    setWithdrawCtx(null)
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default WalletFlowModal
