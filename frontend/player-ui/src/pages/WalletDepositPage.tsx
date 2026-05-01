import { useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import {
  AssetToggleRow,
  ChooseAssetNetworkHint,
  DepositWrongChainWarning,
  NetworkCardGrid,
  UsdAmountField,
  depositNetworkTitle,
  parseDepositNetworkParam,
  type DepositAssetSymbol,
  type DepositNetworkId,
} from '../components/DepositFlowShared'
import {
  DepositAddressPanel,
  DepositSentPanel,
  amountUsdTextFromSearchParams,
  effectiveWalletDepositPhase,
  validAddressStepParams,
} from '../components/walletDepositPanels'
import { useCryptoLogoUrlMap } from '../lib/cryptoLogoUrls'
import { usePlayerAuth } from '../playerAuth'

const MIN_USD = 10

export default function WalletDepositPage() {
  const { isAuthenticated, balanceMinor } = usePlayerAuth()
  const logoUrls = useCryptoLogoUrlMap()
  const [searchParams, setSearchParams] = useSearchParams()

  const phase = effectiveWalletDepositPhase(searchParams)

  const [amountUsd, setAmountUsd] = useState(() => {
    const a = searchParams.get('amount_usd')
    if (a && Number.isFinite(Number(a))) return a
    return '10.00'
  })
  const [amountErr, setAmountErr] = useState<string | null>(null)

  const [symbol, setSymbol] = useState<DepositAssetSymbol>(() => {
    const s = (searchParams.get('symbol') || '').toUpperCase()
    if (s === 'USDC' || s === 'ETH' || s === 'TRX') return s as DepositAssetSymbol
    return 'ETH'
  })
  const [network, setNetwork] = useState<DepositNetworkId>(() => {
    const raw = searchParams.get('network')
    return raw ? parseDepositNetworkParam(raw) : 'BEP20'
  })

  useEffect(() => {
    if (searchParams.get('step') === 'address' && !validAddressStepParams(searchParams)) {
      const n = new URLSearchParams(searchParams)
      n.delete('step')
      setSearchParams(n, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const balanceLabel = useMemo(() => {
    if (balanceMinor == null) return '0.00'
    return (balanceMinor / 100).toFixed(2)
  }, [balanceMinor])

  const symbolForStep = useMemo((): DepositAssetSymbol => {
    if (phase === 'form') return symbol
    const s = (searchParams.get('symbol') || 'ETH').toUpperCase()
    if (s === 'USDC' || s === 'ETH' || s === 'TRX' || s === 'USDT') return s as DepositAssetSymbol
    return 'ETH'
  }, [phase, searchParams, symbol])

  const networkForStep = useMemo((): DepositNetworkId => {
    if (phase === 'form') return network
    return parseDepositNetworkParam(searchParams.get('network'))
  }, [phase, searchParams, network])

  const amountUsdForAddress = useMemo(() => amountUsdTextFromSearchParams(searchParams), [searchParams])

  const continueToAddress = () => {
    setAmountErr(null)
    const parsed = Number(amountUsd.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed < MIN_USD) {
      setAmountErr(`Enter at least ${MIN_USD} USD.`)
      return
    }
    const cents = Math.round(parsed * 100)
    const next = new URLSearchParams(searchParams)
    next.set('symbol', symbol)
    next.set('network', network)
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
    setSearchParams(next, { replace: true })
  }

  if (!isAuthenticated) return <Navigate to="/?auth=login" replace />

  if (phase === 'address') {
    return (
      <div className="mx-auto max-w-md p-3 pb-8 sm:p-4">
        <h1 className="mb-3 text-base font-semibold text-casino-primary">Deposit</h1>
        <DepositAddressPanel
          symbol={symbolForStep}
          network={networkForStep}
          amountUsdText={amountUsdForAddress}
          onBack={backFromAddress}
          onSent={markSent}
        />
      </div>
    )
  }

  if (phase === 'sent') {
    const txHash = searchParams.get('tx_hash')?.trim() ?? ''
    const netLabel =
      networkForStep === 'BEP20' ? 'BEP20' : networkForStep === 'TRC20' ? 'TRC20' : 'ERC20'
    return (
      <div className="mx-auto max-w-md p-3 pb-8 sm:p-4">
        <h1 className="mb-3 text-base font-semibold text-casino-primary">Deposit</h1>
        <DepositSentPanel
          symbol={symbolForStep}
          network={netLabel}
          txHash={txHash}
          onDepositAgain={depositAgain}
          showGamesLink
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-0 p-3 pb-8 sm:p-4">
      <h1 className="mb-3 text-base font-semibold text-casino-primary">Deposit</h1>

      <UsdAmountField value={amountUsd} onChange={setAmountUsd} minUsd={MIN_USD} />
      {amountErr ? (
        <p className="mb-2 text-xs text-red-400" role="alert">
          {amountErr}
        </p>
      ) : null}
      <ChooseAssetNetworkHint />
      <AssetToggleRow symbol={symbol} onSymbol={setSymbol} searchFilter="" logoUrls={logoUrls} />
      <NetworkCardGrid
        symbol={symbol}
        network={network}
        onNetwork={setNetwork}
        balanceLabel={balanceLabel}
        depositAmountInput={amountUsd}
        logoUrls={logoUrls}
      />
      <div className="mt-2">
        <DepositWrongChainWarning symbol={symbol} networkLabel={depositNetworkTitle(network)} />
      </div>
      <button
        type="button"
        onClick={continueToAddress}
        className="mt-3 w-full rounded-lg bg-gradient-to-b from-casino-primary to-casino-primary-dim py-2.5 text-sm font-bold text-white shadow-md shadow-casino-primary/15 transition hover:brightness-110"
      >
        Continue
      </button>
    </div>
  )
}
