import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { usePassimpayCurrencies } from '../hooks/usePassimpayCurrencies'
import { passimpayNetworkLabel } from '../lib/paymentCurrencies'
import type { PassimpayCurrency } from '../lib/paymentCurrencies'
import {
  DepositAddressPanel,
  DepositSentPanel,
  type DepositAddrRes,
  amountUsdTextFromSearchParams,
  effectiveWalletDepositPhase,
  validAddressStepParams,
} from '../components/walletDepositPanels'
import { WalletDepositPickStep } from '../components/wallet/WalletDepositPickStep'
import { usePlayerAuth } from '../playerAuth'

const MIN_USD = 10

export default function WalletDepositPage() {
  const { t } = useTranslation()
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [addrPrefetch, setAddrPrefetch] = useState<{ key: string; data: DepositAddrRes } | null>(null)

  const phase = effectiveWalletDepositPhase(searchParams)

  const { currencies, loading: currenciesLoading, error: currenciesError, reload: reloadCurrencies } =
    usePassimpayCurrencies(isAuthenticated)

  const [amountUsd, setAmountUsd] = useState(() => {
    const a = searchParams.get('amount_usd')
    if (a && Number.isFinite(Number(a))) return a
    return '10.00'
  })
  const [amountErr, setAmountErr] = useState<string | null>(null)

  const [selected, setSelected] = useState<PassimpayCurrency | null>(null)

  useEffect(() => {
    if (searchParams.get('step') === 'address' && !validAddressStepParams(searchParams)) {
      const n = new URLSearchParams(searchParams)
      n.delete('step')
      setSearchParams(n, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const pid = Number(searchParams.get('payment_id'))
    if (!Number.isFinite(pid) || pid < 1 || !currencies.length) return
    const row = currencies.find((c) => c.payment_id === pid)
    if (row) setSelected(row)
  }, [currencies, searchParams])

  useEffect(() => {
    if (!isAuthenticated || phase !== 'form' || !selected) return
    const key = `${selected.payment_id}|${selected.symbol}|${selected.network}`
    let cancelled = false
    void (async () => {
      try {
        const q = new URLSearchParams({
          payment_id: String(selected.payment_id),
          symbol: selected.symbol,
          network: selected.network,
        })
        const res = await apiFetch(`/v1/wallet/deposit-address?${q}`)
        if (!res.ok || cancelled) return
        const j = (await res.json()) as DepositAddrRes
        if (!cancelled && j?.address?.trim()) {
          setAddrPrefetch((prev) => (prev?.key === key ? prev : { key, data: j }))
        }
      } catch {
        /* prefetch is best-effort */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, phase, selected, apiFetch])

  const paymentIdFromUrl = useMemo(() => {
    const pid = Number(searchParams.get('payment_id'))
    return Number.isFinite(pid) && pid >= 1 ? pid : null
  }, [searchParams])

  const symbolForStep = useMemo(() => {
    if (phase === 'form') return selected?.symbol ?? ''
    return searchParams.get('symbol')?.trim() ?? ''
  }, [phase, searchParams, selected?.symbol])

  const networkForStep = useMemo(() => {
    if (phase === 'form') return selected?.network ?? ''
    return searchParams.get('network')?.trim() ?? ''
  }, [phase, searchParams, selected?.network])

  const amountUsdForAddress = useMemo(() => amountUsdTextFromSearchParams(searchParams), [searchParams])

  const sentNetworkLabel = useMemo(() => passimpayNetworkLabel(networkForStep), [networkForStep])

  const addressStepKey =
    paymentIdFromUrl != null && symbolForStep && networkForStep
      ? `${paymentIdFromUrl}|${symbolForStep}|${networkForStep}`
      : ''
  const initialDepositSnapshot =
    addressStepKey && addrPrefetch?.key === addressStepKey ? addrPrefetch.data : null

  const continueToAddress = () => {
    setAmountErr(null)
    const parsed = Number(amountUsd.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed < MIN_USD) {
      setAmountErr(t('wallet.enterMinUsd', { min: MIN_USD }))
      return
    }
    if (!selected) {
      setAmountErr(t('wallet.passimpayPickCurrency'))
      return
    }
    const cents = Math.round(parsed * 100)
    const next = new URLSearchParams(searchParams)
    next.set('payment_id', String(selected.payment_id))
    next.set('symbol', selected.symbol)
    next.set('network', selected.network)
    next.set('amount_minor', String(cents))
    next.set('amount_usd', parsed.toFixed(2))
    next.set('step', 'address')
    setSearchParams(next, { replace: true })
  }

  const backFromAddress = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('step')
    setSearchParams(next, { replace: true })
  }

  const markSent = () => {
    const next = new URLSearchParams(searchParams)
    next.set('step', 'sent')
    setSearchParams(next, { replace: true })
  }

  const depositAgain = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('step')
    next.delete('tx_hash')
    next.delete('payment_id')
    setSearchParams(next, { replace: true })
  }

  if (!isAuthenticated) return <Navigate to="/casino/games?auth=login" replace />

  const shell = (children: ReactNode) => (
    <div className="min-h-[min(100dvh,880px)] bg-wallet-backdrop px-4 py-10 pb-16 sm:py-14">
      <div className="mx-auto w-full max-w-[440px] rounded-2xl border border-casino-border bg-wallet-modal p-6 shadow-[0_32px_64px_rgba(0,0,0,0.55)]">
        {children}
      </div>
    </div>
  )

  if (phase === 'address' && paymentIdFromUrl != null) {
    return shell(
      <>
        <h1 className="mb-6 text-lg font-bold text-white">{t('wallet.deposit')}</h1>
        <DepositAddressPanel
          key={addressStepKey}
          paymentId={paymentIdFromUrl}
          symbol={symbolForStep}
          network={networkForStep}
          amountUsdText={amountUsdForAddress}
          amountMinor={(() => {
            const n = Number(searchParams.get('amount_minor'))
            return Number.isFinite(n) && n >= MIN_USD * 100 ? Math.round(n) : null
          })()}
          onBack={backFromAddress}
          onSent={markSent}
          initialDepositSnapshot={initialDepositSnapshot}
        />
      </>,
    )
  }

  if (phase === 'sent') {
    const txHash = searchParams.get('tx_hash')?.trim() ?? ''
    return shell(
      <>
        <h1 className="mb-6 text-lg font-bold text-white">{t('wallet.deposit')}</h1>
        <DepositSentPanel
          symbol={symbolForStep || '—'}
          network={sentNetworkLabel}
          txHash={txHash}
          onDepositAgain={depositAgain}
          showGamesLink
          showHeader={false}
        />
      </>,
    )
  }

  return shell(
    <>
      <h1 className="mb-6 text-lg font-bold text-white">{t('wallet.deposit')}</h1>
      <WalletDepositPickStep
        amountUsd={amountUsd}
        onAmountUsd={setAmountUsd}
        amountErr={amountErr}
        minUsd={MIN_USD}
        onContinue={continueToAddress}
        continueLabel={t('wallet.continue')}
        currencies={currencies}
        currenciesLoading={currenciesLoading}
        currenciesError={currenciesError}
        onRetryCurrencies={() => void reloadCurrencies()}
        selected={selected}
        onSelect={setSelected}
      />
    </>,
  )
}
