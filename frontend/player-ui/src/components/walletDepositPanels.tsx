import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { readApiError } from '../api/errors'
import { resolveCryptoLogoUrl, useCryptoLogoUrlMap } from '../lib/cryptoLogoUrls'
import { networkHelpUrl, transactionExplorerUrl } from '../lib/walletExplorer'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { usePlayerAuth } from '../playerAuth'
import { CryptoLogoMark } from './wallet/CryptoLogoMark'
import { WalletBonusStrip } from './wallet/WalletBonusStrip'
import {
  WalletBackButton,
  WalletCopyAddressButton,
  WalletDisplayRow,
  WalletPanel,
  WalletReadOnlyRow,
} from './wallet/WalletShell'
const MIN_USD_CENTS = 1000

export type DepositAddrRes = {
  address?: string
  qr_url?: string
  symbol?: string
  network?: string
  memo?: string
  memo_tag?: string
  tag_warning?: boolean
  order_id?: string
  payment_id?: number
  provider?: string
}

export function amountUsdTextFromSearchParams(sp: URLSearchParams): string {
  const cents = Number(sp.get('amount_minor'))
  if (Number.isFinite(cents) && cents > 0) {
    return (cents / 100).toFixed(2)
  }
  const fallback = sp.get('amount_usd')
  if (fallback && Number.isFinite(Number(fallback))) {
    return Number(fallback).toFixed(2)
  }
  return '\u2014'
}

export function validAddressStepParams(sp: URLSearchParams): boolean {
  const cents = Number(sp.get('amount_minor'))
  const okMoney = Number.isFinite(cents) && cents >= MIN_USD_CENTS
  const usd = sp.get('amount_usd')
  const okUsd = !!(usd && Number.isFinite(Number(usd)) && Number(usd) >= MIN_USD_CENTS / 100)
  if (!okMoney && !okUsd) return false
  const pid = Number(sp.get('payment_id'))
  return Number.isFinite(pid) && pid >= 1
}

export function effectiveWalletDepositPhase(sp: URLSearchParams): 'form' | 'address' | 'sent' {
  const s = sp.get('step')
  if (s === 'sent') return 'sent'
  if (s === 'address' && validAddressStepParams(sp)) return 'address'
  return 'form'
}

type DepositAddressPanelProps = {
  paymentId: number
  symbol: string
  network: string
  amountUsdText: string
  /** USD amount in cents when known (e.g. from URL); used for PassimPay invoice link */
  amountMinor?: number | null
  onBack: () => void
  onSent: () => void
  /** When present (e.g. prefetched on pick step), show details immediately and refresh in background */
  initialDepositSnapshot?: DepositAddrRes | null
}

export function DepositAddressPanel({
  paymentId,
  symbol,
  network,
  amountUsdText,
  amountMinor: amountMinorProp = null,
  onBack,
  onSent,
  initialDepositSnapshot = null,
}: DepositAddressPanelProps) {
  const { t } = useTranslation()
  const { isAuthenticated, apiFetch } = usePlayerAuth()
  const logoUrls = useCryptoLogoUrlMap([symbol])
  const [data, setData] = useState<DepositAddrRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceErr, setInvoiceErr] = useState<string | null>(null)

  const amountMinorResolved = useMemo(() => {
    if (amountMinorProp != null && Number.isFinite(amountMinorProp) && amountMinorProp >= MIN_USD_CENTS) {
      return Math.round(amountMinorProp)
    }
    const n = Number(String(amountUsdText).replace(',', '.'))
    if (Number.isFinite(n) && n * 100 >= MIN_USD_CENTS) {
      return Math.round(n * 100)
    }
    return null
  }, [amountMinorProp, amountUsdText])

  const load = useCallback(
    async (opts?: { background?: boolean }) => {
      if (!opts?.background) {
        setErr(null)
        setLoading(true)
      }
      try {
        const q = new URLSearchParams({
          payment_id: String(paymentId),
          symbol,
          network,
        })
        const res = await apiFetch(`/v1/wallet/deposit-address?${q}`)
        if (!res.ok) {
          const parsed = await readApiError(res)
          const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
          toastPlayerApiError(parsed, res.status, 'GET /v1/wallet/deposit-address', rid)
          setErr(parsed?.message ?? 'Could not load deposit address')
          if (!opts?.background) setData(null)
          return
        }
        const j = (await res.json()) as DepositAddrRes
        setData(j)
        setErr(null)
      } catch {
        toastPlayerNetworkError('Network error.', 'GET /v1/wallet/deposit-address')
        setErr('Network error')
        if (!opts?.background) setData(null)
      } finally {
        if (!opts?.background) setLoading(false)
      }
    },
    [apiFetch, paymentId, symbol, network],
  )

  const snapshotRef = useRef<DepositAddrRes | null>(null)
  snapshotRef.current = initialDepositSnapshot
  const snapshotAddr = initialDepositSnapshot?.address?.trim() ?? ''

  useEffect(() => {
    if (!isAuthenticated) return
    if (snapshotAddr) {
      const snap = snapshotRef.current
      if (snap?.address?.trim()) {
        setData(snap)
        setErr(null)
        setLoading(false)
      }
      return
    }
    void load()
  }, [isAuthenticated, paymentId, symbol, network, snapshotAddr, load])

  const memo = (data?.memo ?? data?.memo_tag)?.trim() ?? ''

  const copyAddress = async () => {
    const a = data?.address?.trim()
    if (!a) return
    try {
      const payload = memo ? `${a}\n${memo}` : a
      await navigator.clipboard.writeText(payload)
      setCopyMsg('Copied')
      setTimeout(() => setCopyMsg(null), 2000)
    } catch {
      setCopyMsg('Copy failed')
    }
  }

  const openPassimpayHostedCheckout = useCallback(async () => {
    const minor = amountMinorResolved
    if (minor == null) {
      setInvoiceErr(t('wallet.depositInvoiceAmountUnknown'))
      return
    }
    setInvoiceErr(null)
    setInvoiceBusy(true)
    try {
      const res = await apiFetch('/v1/wallet/deposit-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_id: paymentId,
          symbol,
          network,
          amount_minor: minor,
        }),
      })
      if (!res.ok) {
        const parsed = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(parsed, res.status, 'POST /v1/wallet/deposit-invoice', rid)
        setInvoiceErr(parsed?.message ?? t('wallet.depositInvoiceFailed'))
        return
      }
      const j = (await res.json()) as { invoice_url?: string }
      const url = j.invoice_url?.trim()
      if (!url) {
        setInvoiceErr(t('wallet.depositInvoiceFailed'))
        return
      }
      const popup = window.open(url, '_blank', 'noopener,noreferrer')
      if (!popup) {
        window.location.href = url
      }
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/wallet/deposit-invoice')
      setInvoiceErr(t('wallet.depositInvoiceFailed'))
    } finally {
      setInvoiceBusy(false)
    }
  }, [amountMinorResolved, apiFetch, network, paymentId, symbol, t])

  const address = data?.address?.trim() ?? ''
  const qrUrl = data?.qr_url?.trim()
  const symLogo = resolveCryptoLogoUrl(logoUrls, symbol, network)
  const showPaymentPanel = !loading && !err && address

  return (
    <div className="space-y-0">
      <WalletBackButton onClick={onBack}>{t('wallet.back')}</WalletBackButton>

      <p className="mb-4 text-center text-xs text-wallet-subtext">{t('wallet.referenceUsd', { amount: amountUsdText })}</p>

      <WalletBonusStrip />

      {loading ? (
        <WalletPanel className="mb-0">
          <div className="mb-4 flex flex-col items-center gap-3 pt-1">
            <div
              className="size-[140px] shrink-0 animate-pulse rounded-lg bg-white/[0.08]"
              aria-hidden
            />
          </div>
          <p className="text-center text-xs text-wallet-subtext">{t('wallet.loadingPaymentDetails')}</p>
        </WalletPanel>
      ) : null}
      {err ? (
        <p className="mb-3 text-xs text-red-400" role="alert">
          {err}
        </p>
      ) : null}

      {showPaymentPanel ? (
        <WalletPanel className="mb-0">
          <div className="mb-4 flex flex-col items-center gap-3 pt-1">
            {qrUrl ? (
              <img src={qrUrl} alt={t('wallet.depositQrAlt')} className="size-[140px] rounded-lg bg-white p-2 shadow-md" />
            ) : (
              <div className="rounded-lg bg-white p-2 shadow-md">
                <QRCodeSVG value={address} size={128} level="M" />
              </div>
            )}
          </div>

          <WalletDisplayRow
            label={t('wallet.depositCurrency')}
            icon={<CryptoLogoMark url={symLogo} className="text-emerald-400" />}
            value={symbol}
          />
          <WalletDisplayRow label={t('wallet.chooseNetwork')} value={network} />

          {data?.order_id ? (
            <WalletReadOnlyRow label={t('wallet.passimpayOrderId')}>
              <span className="font-mono text-[12px] text-white/90">{data.order_id}</span>
            </WalletReadOnlyRow>
          ) : null}
          {data?.payment_id != null ? (
            <WalletReadOnlyRow label={t('wallet.passimpayPaymentId')}>
              <span className="font-mono text-[12px] text-white/90">{String(data.payment_id)}</span>
            </WalletReadOnlyRow>
          ) : null}

          {memo ? (
            <WalletReadOnlyRow label={t('wallet.passimpayMemoLabel')}>
              <span className="font-mono text-[12px] text-amber-100/95">{memo}</span>
            </WalletReadOnlyRow>
          ) : null}
          {data?.tag_warning ? (
            <p className="mb-4 text-[11px] leading-snug text-amber-200/90">{t('wallet.passimpayMemoWarning')}</p>
          ) : null}

          <WalletReadOnlyRow label={t('wallet.depositAddressLabel', { symbol })}>
            <span className="block max-w-full truncate font-mono text-[13px]">{address}</span>
          </WalletReadOnlyRow>

          <WalletCopyAddressButton label={t('wallet.copyAddress')} onClick={() => void copyAddress()} />
          {copyMsg ? <p className="mt-2 text-center text-[10px] text-emerald-400">{copyMsg}</p> : null}

          <button
            type="button"
            onClick={onSent}
            className="mt-4 w-full rounded-lg border border-white/[0.08] py-2.5 text-xs font-semibold text-white transition hover:bg-white/[0.04]"
          >
            {t('wallet.depositSentCta')}
          </button>

          {amountMinorResolved != null ? (
            <>
              <div className="relative my-5 w-full">
                <div className="absolute inset-0 flex items-center" aria-hidden>
                  <div className="w-full border-t border-white/[0.08]" />
                </div>
                <div className="relative flex justify-center">
                  <span className="border border-casino-border bg-casino-segment-track px-2 text-[10px] font-semibold uppercase tracking-wider text-casino-muted">
                    {t('wallet.depositOrDivider')}
                  </span>
                </div>
              </div>
              <button
                type="button"
                disabled={invoiceBusy}
                onClick={() => void openPassimpayHostedCheckout()}
                className="w-full rounded-full border border-violet-400/40 bg-violet-600/25 py-3 text-sm font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:bg-violet-600/35 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {invoiceBusy ? t('wallet.depositInvoiceOpening') : t('wallet.depositPayWithWeb3')}
              </button>
              <p className="mt-2.5 text-center text-[11px] leading-snug text-amber-200/90">{t('wallet.depositOneMethodOnly')}</p>
              {invoiceErr ? (
                <p className="mb-1 mt-2 text-center text-[11px] text-red-400" role="alert">
                  {invoiceErr}
                </p>
              ) : null}
            </>
          ) : null}
        </WalletPanel>
      ) : null}

      {!loading && !err && !address ? (
        <p className="text-xs text-wallet-subtext">{t('wallet.noDepositAddress')}</p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Deposit "Sent" panel with live Processing -> Confirmed status     */
/* ------------------------------------------------------------------ */

type DepositSentPanelProps = {
  symbol: string
  network: string
  txHash?: string
  onDepositAgain: () => void
  showGamesLink?: boolean
  /** When false, omit the inline “Deposit” heading (page/modal already titled). */
  showHeader?: boolean
}

type DepositPhase = 'processing' | 'confirmed'

const depositPhaseConfig: Record<DepositPhase, { label: string; color: string; bg: string; ring: string }> = {
  processing: {
    label: 'Processing',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    ring: 'ring-yellow-400/30',
  },
  confirmed: {
    label: 'Deposit Confirmed',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    ring: 'ring-emerald-400/30',
  },
}

function DepositStatusIcon({ phase }: { phase: DepositPhase }) {
  if (phase === 'processing')
    return (
      <div className="relative flex h-10 w-10 items-center justify-center">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-yellow-400/30 border-t-yellow-400" />
        <div className="h-3 w-3 rounded-full bg-yellow-400/60" />
      </div>
    )
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15">
      <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  )
}

export function DepositSentPanel({
  symbol,
  network,
  txHash = '',
  onDepositAgain,
  showGamesLink,
  showHeader = true,
}: DepositSentPanelProps) {
  const { t } = useTranslation()
  const { balanceMinor, refreshProfile } = usePlayerAuth()
  const initialBalRef = useRef(balanceMinor ?? 0)
  const [phase, setPhase] = useState<DepositPhase>('processing')
  const [creditedAmount, setCreditedAmount] = useState<number | null>(null)

  // Detect balance increase -> confirmed
  useEffect(() => {
    if (phase === 'confirmed') return
    const current = balanceMinor ?? 0
    if (current > initialBalRef.current) {
      setCreditedAmount(current - initialBalRef.current)
      setPhase('confirmed')
    }
  }, [balanceMinor, phase])

  // Fast-poll balance every 5s while processing (on top of auth provider's 15s interval)
  useEffect(() => {
    if (phase === 'confirmed') return
    const timer = window.setInterval(() => void refreshProfile(), 5000)
    return () => window.clearInterval(timer)
  }, [phase, refreshProfile])

  const cfg = depositPhaseConfig[phase]
  const explorer = txHash ? transactionExplorerUrl(network, txHash) : null
  const help = networkHelpUrl(network)

  return (
    <div className="space-y-4">
      {showHeader ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-white">{t('wallet.deposit')}</h2>
          {showGamesLink ? (
            <Link to="/casino/games" className="text-xs text-wallet-subtext hover:text-wallet-accent">
              {t('wallet.gamesShort')}
            </Link>
          ) : null}
        </div>
      ) : showGamesLink ? (
        <div className="flex justify-end">
          <Link to="/casino/games" className="text-xs text-wallet-subtext hover:text-wallet-accent">
            {t('wallet.gamesShort')}
          </Link>
        </div>
      ) : null}

      {/* Status hero */}
      <div className={`flex flex-col items-center gap-2 rounded-xl ${cfg.bg} ring-1 ${cfg.ring} px-4 py-5`}>
        <DepositStatusIcon phase={phase} />
        <span className={`text-lg font-bold ${cfg.color}`}>{cfg.label}</span>
        {phase === 'confirmed' && creditedAmount != null ? (
          <span className="text-sm text-casino-foreground">
            +${(creditedAmount / 100).toFixed(2)} <span className="text-casino-muted">credited</span>
          </span>
        ) : null}
        <span className="text-xs text-casino-muted">
          {symbol} on {network}
        </span>
        {phase === 'processing' ? (
          <p className="mt-1 text-center text-[11px] text-casino-muted">
            Waiting for on-chain confirmation. This usually takes a few minutes.
          </p>
        ) : null}
      </div>

      {/* Explorer / balance */}
      <div className="rounded-lg border border-casino-border bg-casino-surface p-3 text-xs">
        {explorer ? (
          <a href={explorer} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-casino-primary underline">
            View on explorer
          </a>
        ) : (
          <a href={help} target="_blank" rel="noreferrer" className="inline-block text-xs text-casino-primary underline">
            {network} explorer
          </a>
        )}
        {phase === 'confirmed' ? (
          <p className="mt-1.5 text-[10px] text-casino-muted">
            Balance: ${((balanceMinor ?? 0) / 100).toFixed(2)}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onDepositAgain}
        className="w-full rounded-lg border border-casino-border py-2 text-center text-xs text-casino-foreground hover:bg-casino-chip-hover"
      >
        {phase === 'confirmed' ? 'Deposit again' : 'Make another deposit'}
      </button>
    </div>
  )
}
