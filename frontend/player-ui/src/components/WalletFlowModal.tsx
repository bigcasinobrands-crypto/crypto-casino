import { useCallback, useEffect, useId, useRef, useState, type FC } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { PLAYER_MODAL_OVERLAY_Z } from '../lib/playerChromeLayers'
import { isFiatDepositCurrencyCode } from '../lib/fiatCurrencies'
import { fetchPassimpayFiatInvoiceUrl } from '../lib/passimpayFiatInvoice'
import { passimpayNetworkLabel, passimpayWithdrawRailMeetsBalance } from '../lib/paymentCurrencies'
import { usePassimpayCurrencies } from '../hooks/usePassimpayCurrencies'
import type { PassimpayCurrency } from '../lib/paymentCurrencies'
import { usePlayerAuth } from '../playerAuth'
import {
  PLAYER_FIAT_DEPOSIT_INVOICE_TOAST_ID,
  toastPlayerApiError,
  toastPlayerNetworkError,
} from '../notifications/playerToast'
import { DepositAddressPanel, DepositSentPanel, type DepositAddrRes } from './walletDepositPanels'
import { WithdrawFormPanel, WithdrawSuccessPanel } from './walletWithdrawPanels'
import { WalletDepositPickStep } from './wallet/WalletDepositPickStep'
import { WalletFiatOnrampPanel } from './wallet/WalletFiatOnrampPanel'
import {
  WalletCloseButton,
  WalletDepositMethodTabs,
  WalletMainTabs,
  type WalletDepositMethodId,
} from './wallet/WalletShell'

export type WalletMainTab = 'deposit' | 'withdraw'

type WalletFlowModalProps = {
  open: boolean
  onClose: () => void
  initialTab: WalletMainTab
  /** Mirrored from payment_ops_flags / admin kill switches */
  depositsEnabled?: boolean
  withdrawalsEnabled?: boolean
  /** When false, Withdraw tab shows verification gate (caller should prompt verify). */
  emailVerified?: boolean
  /** Called when user tries Withdraw without a verified email. */
  onWithdrawBlocked?: () => void
  /** Called when withdrawal fails with kyc_required — navigate to profile verification. */
  onKYCVerificationRequired?: () => void
}

const MIN_USD = 10

const WalletFlowModal: FC<WalletFlowModalProps> = ({
  open,
  onClose,
  initialTab,
  depositsEnabled = true,
  withdrawalsEnabled = true,
  emailVerified = true,
  onWithdrawBlocked,
  onKYCVerificationRequired,
}) => {
  const { t } = useTranslation()
  const titleId = useId()
  const { apiFetch, isAuthenticated, balanceMinor } = usePlayerAuth()
  const [mainTab, setMainTab] = useState<WalletMainTab>(initialTab)
  const [amountUsd, setAmountUsd] = useState('10.00')
  const [amountErr, setAmountErr] = useState<string | null>(null)
  const [depositAddrPrefetch, setDepositAddrPrefetch] = useState<{ key: string; data: DepositAddrRes } | null>(null)

  const { currencies, loading: currenciesLoading, error: currenciesError, reload: reloadCurrencies } =
    usePassimpayCurrencies(open)

  const [depositPick, setDepositPick] = useState<PassimpayCurrency | null>(null)
  const [withdrawPick, setWithdrawPick] = useState<PassimpayCurrency | null>(null)
  const [committedDeposit, setCommittedDeposit] = useState<PassimpayCurrency | null>(null)

  const [depositFlowStep, setDepositFlowStep] = useState<'pick' | 'address' | 'sent'>('pick')
  const [depositMethod, setDepositMethod] = useState<WalletDepositMethodId>('crypto')
  const [fiatDepositCurrency, setFiatDepositCurrency] = useState('USD')
  const [fiatPayErr, setFiatPayErr] = useState<string | null>(null)
  const [fiatPayBusy, setFiatPayBusy] = useState(false)
  const [committedAmountUsd, setCommittedAmountUsd] = useState('10.00')

  const [withdrawFlowStep, setWithdrawFlowStep] = useState<'form' | 'success'>('form')
  const [withdrawCtx, setWithdrawCtx] = useState<{
    id: string
    symbol: string
    network: string
    payment_id?: number
  } | null>(null)

  const fiatPayLockRef = useRef(false)
  const sheetLiftRef = useRef<HTMLDivElement>(null)
  const [currencyMenuLiftPx, setCurrencyMenuLiftPx] = useState(0)
  const onCurrencyMenuLiftPxChange = useCallback((px: number) => {
    setCurrencyMenuLiftPx(px)
  }, [])

  useEffect(() => {
    if (!open) return
    let tab: WalletMainTab = initialTab === 'withdraw' && !emailVerified ? 'deposit' : initialTab
    if (!depositsEnabled && tab === 'deposit' && withdrawalsEnabled) tab = 'withdraw'
    if (!withdrawalsEnabled && tab === 'withdraw' && depositsEnabled) tab = 'deposit'
    setMainTab(tab)
    setDepositFlowStep('pick')
    setWithdrawFlowStep('form')
    setWithdrawCtx(null)
    setCommittedDeposit(null)
    setDepositPick(null)
    setWithdrawPick(null)
    setDepositAddrPrefetch(null)
    setDepositMethod('crypto')
    setFiatDepositCurrency('USD')
    setFiatPayErr(null)
    fiatPayLockRef.current = false
    setFiatPayBusy(false)
    setCurrencyMenuLiftPx(0)
  }, [open, initialTab, emailVerified, depositsEnabled, withdrawalsEnabled])

  useEffect(() => {
    setFiatPayErr(null)
  }, [amountUsd, fiatDepositCurrency])

  const handleFiatPay = useCallback(async () => {
    setFiatPayErr(null)
    const parsed = Number(amountUsd.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed < MIN_USD) {
      setFiatPayErr(t('wallet.enterMinFiat', { min: MIN_USD, currency: fiatDepositCurrency }))
      return
    }
    if (!isAuthenticated) return
    if (fiatPayLockRef.current) return
    fiatPayLockRef.current = true
    setFiatPayBusy(true)
    try {
      const minor = Math.round(parsed * 100)
      const cur = isFiatDepositCurrencyCode(fiatDepositCurrency) ? fiatDepositCurrency : 'USD'
      const result = await fetchPassimpayFiatInvoiceUrl(apiFetch, minor, cur)
      if (!result.ok) {
        toastPlayerApiError(result.apiErr, result.status, 'POST /v1/wallet/fiat-deposit-invoice', null, {
          toastId: PLAYER_FIAT_DEPOSIT_INVOICE_TOAST_ID,
        })
        return
      }
      window.location.assign(result.invoiceUrl)
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/wallet/fiat-deposit-invoice', {
        toastId: PLAYER_FIAT_DEPOSIT_INVOICE_TOAST_ID,
      })
    } finally {
      fiatPayLockRef.current = false
      setFiatPayBusy(false)
    }
  }, [amountUsd, apiFetch, fiatDepositCurrency, isAuthenticated, t])

  useEffect(() => {
    if (open) return
    setCurrencyMenuLiftPx(0)
  }, [open])

  useEffect(() => {
    if (
      !open ||
      !isAuthenticated ||
      mainTab !== 'deposit' ||
      depositFlowStep !== 'pick' ||
      depositMethod !== 'crypto' ||
      !depositPick
    )
      return
    const key = `${depositPick.payment_id}|${depositPick.symbol}|${depositPick.network}`
    let cancelled = false
    void (async () => {
      try {
        const q = new URLSearchParams({
          payment_id: String(depositPick.payment_id),
          symbol: depositPick.symbol,
          network: depositPick.network,
        })
        const res = await apiFetch(`/v1/wallet/deposit-address?${q}`)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as DepositAddrRes
        if (!cancelled && j?.address?.trim()) {
          setDepositAddrPrefetch((prev) => (prev?.key === key ? prev : { key, data: j }))
        }
      } catch {
        /* prefetch is best-effort */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, isAuthenticated, mainTab, depositFlowStep, depositMethod, depositPick, apiFetch])

  useEffect(() => {
    if (!currencies.length) return
    setDepositPick((prev) => prev ?? currencies.find((c) => c.deposit_enabled) ?? null)
    setWithdrawPick((prev) => {
      if (prev != null) return prev
      const eligible = currencies.filter((c) => passimpayWithdrawRailMeetsBalance(c, balanceMinor))
      return eligible[0] ?? null
    })
  }, [currencies, balanceMinor])

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
      if (e.key !== 'Escape') return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const handleMainTabChange = useCallback(
    (next: WalletMainTab) => {
      if (next === 'deposit' && !depositsEnabled) return
      if (next === 'withdraw') {
        if (!withdrawalsEnabled) return
        if (!emailVerified) {
          onWithdrawBlocked?.()
          return
        }
      }
      setMainTab(next)
    },
    [emailVerified, onWithdrawBlocked, depositsEnabled, withdrawalsEnabled],
  )

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
    flushSync(() => {
      setCommittedAmountUsd(parsed.toFixed(2))
      setCommittedDeposit(depositPick)
      setDepositFlowStep('address')
    })
  }

  if (!open) return null

  const walletFullyPaused = !depositsEnabled && !withdrawalsEnabled

  const depositSentNetworkLabel =
    committedDeposit != null ? passimpayNetworkLabel(committedDeposit.network) : ''

  const committedDepositKey = committedDeposit
    ? `${committedDeposit.payment_id}|${committedDeposit.symbol}|${committedDeposit.network}`
    : ''
  const initialDepositSnapshot =
    committedDepositKey && depositAddrPrefetch?.key === committedDepositKey ? depositAddrPrefetch.data : null

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
        ref={sheetLiftRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ transform: `translateY(-${currencyMenuLiftPx}px)` }}
        className="relative flex w-full max-w-[440px] flex-col overflow-hidden rounded-t-2xl border border-casino-border bg-wallet-modal shadow-[0_32px_64px_rgba(0,0,0,0.55)] max-sm:mb-[var(--casino-mobile-nav-offset)] max-sm:h-fit max-sm:max-h-[calc(100dvh-var(--casino-mobile-nav-offset))] max-sm:transition-transform max-sm:duration-200 max-sm:ease-out sm:max-h-[min(90vh,720px)] sm:rounded-2xl"
      >
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

        <div className="flex shrink-0 justify-end px-6 pb-2 pt-5 max-sm:px-5 max-sm:pt-4">
          <WalletCloseButton label={t('wallet.close')} onClick={onClose} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-6 pb-6 pt-2 max-sm:flex-none max-sm:px-5 max-sm:pb-4 sm:min-h-0">
          {!walletFullyPaused ? (
            <WalletMainTabs
              active={mainTab}
              onChange={handleMainTabChange}
              depositLabel={t('wallet.deposit')}
              withdrawLabel={t('wallet.withdraw')}
              depositDisabled={!depositsEnabled}
              withdrawDisabled={!withdrawalsEnabled}
              depositHint={t('operational.depositsUnavailable')}
              withdrawHint={t('operational.withdrawalsUnavailable')}
            />
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-sm:flex-none">
            {walletFullyPaused ? (
              <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-6 text-center text-sm leading-relaxed text-casino-muted">
                {t('operational.walletUnavailableBoth')}
              </p>
            ) : mainTab === 'deposit' ? (
              depositFlowStep === 'pick' ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-sm:flex-none">
                  <WalletDepositMethodTabs
                    active={depositMethod}
                    onChange={setDepositMethod}
                    cryptoLabel={t('wallet.railCrypto')}
                    fiatLabel={t('wallet.depositMethodFiat')}
                  />
                  {depositMethod === 'crypto' ? (
                    <WalletDepositPickStep
                      splitFooter
                      menuLiftScopeRef={sheetLiftRef}
                      onMenuLiftPxChange={onCurrencyMenuLiftPxChange}
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
                  ) : (
                    <WalletFiatOnrampPanel
                      amountUsd={amountUsd}
                      onAmountUsd={setAmountUsd}
                      minUsd={MIN_USD}
                      fiatCurrency={fiatDepositCurrency}
                      onFiatCurrency={setFiatDepositCurrency}
                      amountErr={fiatPayErr}
                      onPay={handleFiatPay}
                      payBusy={fiatPayBusy}
                    />
                  )}
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth scrollbar-casino max-sm:max-h-[min(75dvh,calc(100dvh-var(--casino-mobile-nav-offset)-10rem))]">
                  {depositFlowStep === 'address' && committedDeposit ? (
                    <DepositAddressPanel
                      key={committedDepositKey}
                      paymentId={committedDeposit.payment_id}
                      symbol={committedDeposit.symbol}
                      network={committedDeposit.network}
                      amountUsdText={committedAmountUsd}
                      amountMinor={(() => {
                        const n = Number(committedAmountUsd.replace(',', '.'))
                        return Number.isFinite(n) && n >= MIN_USD ? Math.round(n * 100) : null
                      })()}
                      onBack={() => setDepositFlowStep('pick')}
                      onSent={() => setDepositFlowStep('sent')}
                      initialDepositSnapshot={initialDepositSnapshot}
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
                onEmailVerificationRequired={onWithdrawBlocked}
                onKYCVerificationRequired={onKYCVerificationRequired}
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
