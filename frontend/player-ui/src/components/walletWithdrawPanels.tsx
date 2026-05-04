import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { readApiError } from '../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import {
  AssetToggleRow,
  DepositWrongChainWarning,
  WithdrawNetworkCardGrid,
  depositNetworkTitle,
} from './DepositFlowShared'
import { useCryptoLogoUrlMap } from '../lib/cryptoLogoUrls'
import { transactionExplorerUrl } from '../lib/walletExplorer'
import { getFingerprintForAction } from '../lib/fingerprintClient'
import { usePlayerAuth } from '../playerAuth'

export type WithdrawPanelNetwork = 'ERC20' | 'TRC20'
export type WithdrawPanelSymbol = 'ETH' | 'USDT' | 'USDC' | 'TRX'

type WithdrawFormPanelProps = {
  network: WithdrawPanelNetwork
  symbol: WithdrawPanelSymbol
  onNetwork: (n: WithdrawPanelNetwork) => void
  onSymbol: (s: WithdrawPanelSymbol) => void
  onSuccess: (p: { id: string; network: WithdrawPanelNetwork; symbol: WithdrawPanelSymbol }) => void
  /**
   * When true (e.g. wallet modal on mobile), primary action is pinned in a footer below a scroll area
   * so the submit button stays visible above the home indicator / bottom nav.
   */
  splitFooter?: boolean
}

export function WithdrawFormPanel({
  network,
  symbol,
  onNetwork,
  onSymbol,
  onSuccess,
  splitFooter = false,
}: WithdrawFormPanelProps) {
  const { apiFetch, refreshProfile, balanceMinor } = usePlayerAuth()
  const logoUrls = useCryptoLogoUrlMap()
  const [amount, setAmount] = useState('10')
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const balanceLabel = useMemo(() => {
    if (balanceMinor == null) return '0.00'
    return (balanceMinor / 100).toFixed(2)
  }, [balanceMinor])

  const submit = async () => {
    setErr(null)
    const amt = Math.round(Number(amount) * 100)
    if (!Number.isFinite(amt) || amt < 1) {
      setErr('Enter a valid amount.')
      return
    }
    if (!destination.trim()) {
      setErr('Enter a destination address.')
      return
    }
    setBusy(true)
    try {
      const fp = await getFingerprintForAction()
      const payload: Record<string, unknown> = {
        amount_minor: amt,
        currency: symbol,
        network,
        destination: destination.trim(),
      }
      if (fp?.requestId) {
        payload.fingerprint_request_id = fp.requestId
      }
      const res = await apiFetch('/v1/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const parsed = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(parsed, res.status, 'POST /v1/wallet/withdraw', rid)
        setErr(parsed?.message ?? 'Withdraw failed')
        return
      }
      const j = (await res.json()) as { withdrawal_id?: string }
      await refreshProfile()
      const id = j.withdrawal_id
      if (id) {
        onSuccess({ id, network, symbol })
      }
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/wallet/withdraw')
      setErr('Network error.')
    } finally {
      setBusy(false)
    }
  }

  const fields = (
    <>
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-casino-foreground">
          Amount (USD)<span className="font-normal text-casino-muted"> · e.g. 10.00</span>
        </label>
        <div className="flex gap-1.5">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="text"
            inputMode="decimal"
            className="min-w-0 flex-1 rounded-lg border border-casino-border bg-casino-bg px-2.5 py-2 text-sm text-casino-foreground outline-none focus:border-casino-primary"
          />
          <div className="flex items-center rounded-lg border border-casino-border bg-casino-elevated px-2.5 text-xs font-semibold text-casino-muted">
            USD
          </div>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-casino-muted">
          Match the asset and network to your destination wallet.
        </p>
        <span className="text-[11px] font-medium text-casino-foreground">Bal: ${balanceLabel}</span>
      </div>

      <AssetToggleRow symbol={symbol} onSymbol={onSymbol} searchFilter="" logoUrls={logoUrls} />

      <WithdrawNetworkCardGrid
        symbol={symbol}
        network={network}
        onNetwork={onNetwork}
        balanceLabel={balanceLabel}
        withdrawAmountInput={amount}
        logoUrls={logoUrls}
      />

      <label className="mb-3 mt-2 block">
        <span className="mb-1 block text-xs font-medium text-casino-foreground">Destination</span>
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder={`${symbol} · ${network} address`}
          className="w-full rounded-lg border border-casino-border bg-casino-bg px-2.5 py-2 text-sm text-casino-foreground outline-none focus:border-casino-primary"
        />
      </label>

      <div className="mb-3">
        <DepositWrongChainWarning symbol={symbol} networkLabel={depositNetworkTitle(network)} />
      </div>

      {err ? (
        <p className="mb-2 text-xs text-red-400" role="alert">
          {err}
        </p>
      ) : null}
    </>
  )

  const submitBtn = (
    <button
      type="button"
      disabled={busy}
      onClick={() => void submit()}
      className="w-full rounded-lg bg-gradient-to-b from-casino-primary to-casino-primary-dim py-2.5 text-sm font-bold text-white shadow-md shadow-casino-primary/15 transition hover:brightness-110 disabled:opacity-50"
    >
      {busy ? 'Processing…' : 'Withdraw'}
    </button>
  )

  if (splitFooter) {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth p-3 sm:p-4 scrollbar-casino">
          {fields}
        </div>
        <div className="shrink-0 border-t border-casino-border bg-casino-surface px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
          {submitBtn}
        </div>
      </>
    )
  }

  return (
    <div className="space-y-0">
      {fields}
      <div className="mt-3">{submitBtn}</div>
    </div>
  )
}

type WithdrawalRow = {
  id?: string
  status?: string
  amount_minor?: number
  currency?: string
  destination?: string
  tx_hash?: string
  explorer_url?: string
  error_message?: string
}

type WithdrawSuccessPanelProps = {
  id: string
  network: string
  symbol: string
  onAnother: () => void
  showGamesLink?: boolean
}

type StatusPhase = 'processing' | 'confirmed' | 'failed'

function resolvePhase(status?: string): StatusPhase {
  if (!status) return 'processing'
  switch (status) {
    case 'confirmed':
    case 'executed':
    case 'completed':
      return 'confirmed'
    case 'provider_error':
    case 'failed':
    case 'cancelled':
    case 'rejected':
      return 'failed'
    default:
      return 'processing'
  }
}

const phaseConfig: Record<StatusPhase, { label: string; color: string; bg: string; ring: string }> = {
  processing: {
    label: 'Processing',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    ring: 'ring-yellow-400/30',
  },
  confirmed: {
    label: 'Confirmed',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    ring: 'ring-emerald-400/30',
  },
  failed: {
    label: 'Failed',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    ring: 'ring-red-400/30',
  },
}

function StatusIcon({ phase }: { phase: StatusPhase }) {
  if (phase === 'processing')
    return (
      <div className="relative flex h-10 w-10 items-center justify-center">
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-yellow-400/30 border-t-yellow-400" />
        <div className="h-3 w-3 rounded-full bg-yellow-400/60" />
      </div>
    )
  if (phase === 'confirmed')
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/15">
        <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
    )
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-400/15">
      <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
  )
}

export function WithdrawSuccessPanel({ id, network, symbol, onAnother, showGamesLink }: WithdrawSuccessPanelProps) {
  const { apiFetch, refreshProfile } = usePlayerAuth()
  const [row, setRow] = useState<WithdrawalRow | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const hasRefreshedBalance = useRef(false)

  const poll = useCallback(async () => {
    if (!id) return
    try {
      const res = await apiFetch(`/v1/wallet/withdrawals/${encodeURIComponent(id)}`)
      if (!res.ok) {
        setErr(res.status === 404 ? 'Withdrawal not found.' : 'Could not load status.')
        return
      }
      const j = (await res.json()) as WithdrawalRow
      setRow(j)
      setErr(null)
    } catch {
      setErr('Network error')
    }
  }, [apiFetch, id])

  useEffect(() => {
    void poll()
    const phase = resolvePhase(row?.status)
    if (phase === 'confirmed' || phase === 'failed') {
      if (!hasRefreshedBalance.current) {
        hasRefreshedBalance.current = true
        void refreshProfile()
      }
      return
    }
    const t = window.setInterval(() => void poll(), 4000)
    return () => window.clearInterval(t)
  }, [poll, row?.status, refreshProfile])

  const phase = resolvePhase(row?.status)
  const cfg = phaseConfig[phase]

  const tx = row?.tx_hash?.trim() ?? ''
  const explorer =
    row?.explorer_url?.trim() || (tx ? transactionExplorerUrl(network, tx) : null) || null

  const amountLabel = row?.amount_minor != null ? `$${(row.amount_minor / 100).toFixed(2)}` : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-casino-foreground">Withdrawal</h2>
        {showGamesLink ? (
          <Link to="/casino/games" className="text-xs text-casino-muted hover:text-casino-primary">
            Games
          </Link>
        ) : null}
      </div>

      {err ? <p className="text-xs text-red-400">{err}</p> : null}

      {/* Status hero */}
      <div className={`flex flex-col items-center gap-2 rounded-xl ${cfg.bg} ring-1 ${cfg.ring} px-4 py-5`}>
        <StatusIcon phase={phase} />
        <span className={`text-lg font-bold ${cfg.color}`}>{cfg.label}</span>
        {amountLabel ? (
          <span className="text-sm text-casino-foreground">{amountLabel} <span className="text-casino-muted">via</span> {symbol} <span className="text-casino-muted">on</span> {network}</span>
        ) : null}
        {phase === 'processing' ? (
          <p className="mt-1 text-center text-[11px] text-casino-muted">
            Your withdrawal is being processed on-chain. This may take a few minutes.
          </p>
        ) : null}
        {phase === 'failed' && row?.error_message ? (
          <p className="mt-1 text-center text-xs text-red-300">{row.error_message}</p>
        ) : null}
      </div>

      {/* Details card */}
      <div className="space-y-2 rounded-lg border border-casino-border bg-casino-surface p-3 text-xs">
        {row?.destination ? (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-casino-muted">To</p>
            <p className="mt-0.5 break-all font-mono text-[10px] text-casino-foreground">{row.destination}</p>
          </div>
        ) : null}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-casino-muted">Ref</p>
          <p className="mt-0.5 break-all font-mono text-[10px] text-casino-foreground">{id}</p>
        </div>
        {explorer ? (
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-xs font-semibold text-casino-primary underline"
          >
            View on explorer
          </a>
        ) : phase === 'processing' ? (
          <p className="mt-1 text-[10px] text-casino-muted">Explorer link available once transaction is confirmed.</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onAnother}
        className="w-full rounded-lg border border-casino-border py-2 text-center text-xs text-casino-foreground hover:bg-casino-elevated"
      >
        {phase === 'failed' ? 'Try again' : 'Another withdrawal'}
      </button>
    </div>
  )
}
