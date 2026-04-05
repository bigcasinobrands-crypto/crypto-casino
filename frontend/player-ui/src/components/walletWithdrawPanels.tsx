import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { usePlayerAuth } from '../playerAuth'

export type WithdrawPanelNetwork = 'ERC20' | 'TRC20'
export type WithdrawPanelSymbol = 'ETH' | 'USDT' | 'USDC' | 'TRX'

type WithdrawFormPanelProps = {
  network: WithdrawPanelNetwork
  symbol: WithdrawPanelSymbol
  onNetwork: (n: WithdrawPanelNetwork) => void
  onSymbol: (s: WithdrawPanelSymbol) => void
  onSuccess: (p: { id: string; network: WithdrawPanelNetwork; symbol: WithdrawPanelSymbol }) => void
}

export function WithdrawFormPanel({ network, symbol, onNetwork, onSymbol, onSuccess }: WithdrawFormPanelProps) {
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
      const res = await apiFetch('/v1/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          amount_minor: amt,
          currency: symbol,
          network,
          destination: destination.trim(),
        }),
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

  return (
    <div className="space-y-0">
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-casino-foreground">
          Amount ({symbol})<span className="font-normal text-casino-muted"> · decimal (e.g. 10.50)</span>
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
            {symbol}
          </div>
        </div>
      </div>

      <p className="mb-2 text-[11px] text-casino-muted">
        Match the asset and network to the wallet you withdraw to.
      </p>

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

      <button
        type="button"
        disabled={busy}
        onClick={() => void submit()}
        className="mt-3 w-full rounded-lg bg-gradient-to-b from-casino-primary to-casino-primary-dim py-2.5 text-sm font-bold text-white shadow-md shadow-casino-primary/15 transition hover:brightness-110 disabled:opacity-50"
      >
        {busy ? 'Processing…' : 'Withdraw'}
      </button>
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
}

type WithdrawSuccessPanelProps = {
  id: string
  network: string
  symbol: string
  onAnother: () => void
  /** Full-page: show Games link */
  showGamesLink?: boolean
}

export function WithdrawSuccessPanel({ id, network, symbol, onAnother, showGamesLink }: WithdrawSuccessPanelProps) {
  const { apiFetch } = usePlayerAuth()
  const [row, setRow] = useState<WithdrawalRow | null>(null)
  const [err, setErr] = useState<string | null>(null)

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
    const t = window.setInterval(() => void poll(), 4000)
    return () => window.clearInterval(t)
  }, [poll])

  const tx = row?.tx_hash?.trim() ?? ''
  const explorer =
    row?.explorer_url?.trim() || (tx ? transactionExplorerUrl(network, tx) : null) || null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-casino-primary">Withdrawal</h2>
        {showGamesLink ? (
          <Link to="/casino/games" className="text-xs text-casino-muted hover:text-casino-primary">
            Games
          </Link>
        ) : null}
      </div>

      {err ? <p className="text-xs text-red-400">{err}</p> : null}

      <div className="rounded-lg border border-casino-border bg-casino-surface p-3 text-xs">
        <p className="text-[10px] uppercase tracking-wide text-casino-muted">Ref</p>
        <p className="mt-0.5 break-all font-mono text-[10px] text-casino-foreground">{id}</p>
        <p className="mt-2 text-[10px] uppercase tracking-wide text-casino-muted">Status</p>
        <p className="mt-0.5 font-semibold text-casino-foreground">{row?.status ?? '…'}</p>
        {row?.amount_minor != null ? (
          <p className="mt-2 text-casino-foreground">
            <span className="text-casino-muted">Amount </span>
            {row.amount_minor} {row.currency ?? ''}{' '}
            <span className="text-casino-muted">(minor)</span>
          </p>
        ) : null}
        {explorer ? (
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs font-semibold text-casino-primary underline"
          >
            Explorer
          </a>
        ) : (
          <p className="mt-2 text-[10px] text-casino-muted">Explorer link when a tx hash is available.</p>
        )}
      </div>

      <p className="text-[10px] text-casino-muted">
        {symbol} on {network}
      </p>

      <button
        type="button"
        onClick={onAnother}
        className="w-full rounded-lg border border-casino-border py-2 text-center text-xs text-casino-foreground hover:bg-casino-elevated"
      >
        Another withdrawal
      </button>
    </div>
  )
}
