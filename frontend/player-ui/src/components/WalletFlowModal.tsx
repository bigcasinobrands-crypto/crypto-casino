import { useEffect, useId, useMemo, useState, type FC } from 'react'
import { useTranslation } from 'react-i18next'
import { PLAYER_MODAL_OVERLAY_Z } from '../lib/playerChromeLayers'
import { useCryptoLogoUrlMap } from '../lib/cryptoLogoUrls'
import { usePlayerAuth } from '../playerAuth'
import {
  AssetToggleRow,
  ChooseAssetNetworkHint,
  DEPOSIT_ASSET_OPTIONS,
  DepositWrongChainWarning,
  NetworkCardGrid,
  UsdAmountField,
  depositNetworkTitle,
  type DepositAssetSymbol,
  type DepositNetworkId,
} from './DepositFlowShared'
import { DepositAddressPanel, DepositSentPanel } from './walletDepositPanels'
import {
  WithdrawFormPanel,
  WithdrawSuccessPanel,
  type WithdrawPanelNetwork,
  type WithdrawPanelSymbol,
} from './walletWithdrawPanels'

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
  const { balanceMinor } = usePlayerAuth()
  const logoUrls = useCryptoLogoUrlMap()
  const [mainTab, setMainTab] = useState<WalletMainTab>(initialTab)
  const [amountUsd, setAmountUsd] = useState('10.00')
  const [amountErr, setAmountErr] = useState<string | null>(null)
  const [symbol, setSymbol] = useState<DepositAssetSymbol>('ETH')
  const [network, setNetwork] = useState<DepositNetworkId>('ERC20')

  const [depositFlowStep, setDepositFlowStep] = useState<'pick' | 'address' | 'sent'>('pick')
  const [committedAmountUsd, setCommittedAmountUsd] = useState('10.00')

  const [withdrawFlowStep, setWithdrawFlowStep] = useState<'form' | 'success'>('form')
  const [withdrawCtx, setWithdrawCtx] = useState<{
    id: string
    network: WithdrawPanelNetwork
    symbol: WithdrawPanelSymbol
  } | null>(null)
  const [wdNetwork, setWdNetwork] = useState<WithdrawPanelNetwork>('ERC20')
  const [wdSymbol, setWdSymbol] = useState<WithdrawPanelSymbol>('ETH')

  const balanceLabel = useMemo(() => {
    if (balanceMinor == null) return '0.00'
    return (balanceMinor / 100).toFixed(2)
  }, [balanceMinor])

  useEffect(() => {
    if (!open) return
    setMainTab(initialTab)
    setDepositFlowStep('pick')
    setWithdrawFlowStep('form')
    setWithdrawCtx(null)
  }, [open, initialTab])

  useEffect(() => {
    if (mainTab !== 'deposit') setDepositFlowStep('pick')
  }, [mainTab])

  useEffect(() => {
    const def = DEPOSIT_ASSET_OPTIONS.find((a) => a.symbol === symbol)
    if (def && !def.networks.includes(network)) {
      setNetwork(def.networks[0])
    }
  }, [symbol, network])

  useEffect(() => {
    if (!open || mainTab !== 'withdraw') return
    if (withdrawFlowStep === 'success') return
    const symMap: Record<string, WithdrawPanelSymbol> = { ETH: 'ETH', USDC: 'USDC', USDT: 'USDT', TRX: 'TRX' }
    setWdSymbol(symMap[symbol] ?? 'ETH')
    setWdNetwork(network === 'TRC20' ? 'TRC20' : 'ERC20')
  }, [open, mainTab, withdrawFlowStep, symbol, network])

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
    setCommittedAmountUsd(parsed.toFixed(2))
    setDepositFlowStep('address')
  }

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 ${PLAYER_MODAL_OVERLAY_Z} flex items-end justify-center sm:items-center sm:p-4`}
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label={t('wallet.close')}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(90dvh,640px)] w-full max-w-md flex-col overflow-hidden rounded-t-xl border border-casino-border bg-casino-surface shadow-2xl sm:max-h-[min(90vh,640px)] sm:rounded-xl"
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
        <div className="flex shrink-0 items-stretch border-b border-casino-border">
          <button
            type="button"
            className={`flex-1 py-2.5 text-xs font-bold transition ${
              mainTab === 'deposit'
                ? 'bg-casino-elevated text-white'
                : 'text-casino-muted hover:text-casino-foreground'
            }`}
            onClick={() => setMainTab('deposit')}
          >
            {t('wallet.deposit')}
          </button>
          <button
            type="button"
            className={`flex-1 py-2.5 text-xs font-bold transition ${
              mainTab === 'withdraw'
                ? 'bg-casino-elevated text-white'
                : 'text-casino-muted hover:text-casino-foreground'
            }`}
            onClick={() => setMainTab('withdraw')}
          >
            {t('wallet.withdraw')}
          </button>
          <button
            type="button"
            className="flex w-10 shrink-0 items-center justify-center text-base text-casino-muted hover:text-casino-foreground"
            onClick={onClose}
            aria-label={t('wallet.close')}
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mainTab === 'deposit' ? (
            depositFlowStep === 'pick' ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth p-3 sm:p-4 scrollbar-casino">
                  <UsdAmountField value={amountUsd} onChange={setAmountUsd} minUsd={MIN_USD} />
                  {amountErr ? (
                    <p className="mb-1 text-xs text-red-400" role="alert">
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
                </div>
                <div className="shrink-0 border-t border-casino-border bg-casino-surface px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
                  <button
                    type="button"
                    onClick={continueToAddressInModal}
                    className="w-full rounded-lg bg-gradient-to-b from-casino-primary to-casino-primary-dim py-2.5 text-sm font-bold text-white shadow-md shadow-casino-primary/15 transition hover:brightness-110"
                  >
                    {t('wallet.continue')}
                  </button>
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth p-3 sm:p-4 scrollbar-casino">
                {depositFlowStep === 'address' ? (
                  <DepositAddressPanel
                    symbol={symbol}
                    network={network}
                    amountUsdText={committedAmountUsd}
                    onBack={() => setDepositFlowStep('pick')}
                    onSent={() => setDepositFlowStep('sent')}
                  />
                ) : (
                  <DepositSentPanel symbol={symbol} network={network} onDepositAgain={() => setDepositFlowStep('pick')} />
                )}
              </div>
            )
          ) : withdrawFlowStep === 'form' ? (
            <WithdrawFormPanel
              splitFooter
              network={wdNetwork}
              symbol={wdSymbol}
              onNetwork={setWdNetwork}
              onSymbol={setWdSymbol}
              onSuccess={(p) => {
                setWithdrawCtx(p)
                setWithdrawFlowStep('success')
              }}
            />
          ) : withdrawCtx ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth p-3 sm:p-4 scrollbar-casino">
              <WithdrawSuccessPanel
                id={withdrawCtx.id}
                network={withdrawCtx.network}
                symbol={withdrawCtx.symbol}
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
  )
}

export default WalletFlowModal
