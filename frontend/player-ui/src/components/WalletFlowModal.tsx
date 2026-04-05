import { useCallback, useEffect, useId, useState, type FC } from 'react'
import { formatApiError, readApiError } from '../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { usePlayerAuth } from '../playerAuth'
import { IconCopy, IconChevronDown } from './icons'

export type WalletMainTab = 'deposit' | 'withdraw'

type WalletFlowModalProps = {
  open: boolean
  onClose: () => void
  initialTab: WalletMainTab
}

type PayTab = 'crypto' | 'banking'

function addressFromCheckoutId(checkoutId: string): string {
  const raw = checkoutId.replace(/[^a-fA-F0-9]/g, '')
  const pad = (raw + '0'.repeat(40)).slice(0, 40)
  return `0x${pad.toLowerCase()}`
}

const WalletFlowModal: FC<WalletFlowModalProps> = ({ open, onClose, initialTab }) => {
  const titleId = useId()
  const { apiFetch, refreshProfile, me } = usePlayerAuth()
  const [mainTab, setMainTab] = useState<WalletMainTab>(initialTab)
  const [payTab, setPayTab] = useState<PayTab>('crypto')
  const [currency, setCurrency] = useState('USDT')
  const [network, setNetwork] = useState('ERC20')
  const [session, setSession] = useState<{
    checkout_id: string
    redirect_stub?: string
    amount_minor?: number
  } | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionErr, setSessionErr] = useState<string | null>(null)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)
  const [withdrawDest, setWithdrawDest] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('10')
  const [withdrawBusy, setWithdrawBusy] = useState(false)
  const [withdrawErr, setWithdrawErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setMainTab(initialTab)
      setSessionErr(null)
      setCopyMsg(null)
      setWithdrawErr(null)
    }
  }, [open, initialTab])

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

  const loadDepositSession = useCallback(async () => {
    setSessionErr(null)
    setSessionLoading(true)
    setSession(null)
    try {
      const res = await apiFetch('/v1/wallet/deposit-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ amount_minor: 10000, currency }),
      })
      if (!res.ok) {
        const parsed = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(parsed, res.status, 'POST /v1/wallet/deposit-session', rid)
        setSessionErr(formatApiError(parsed, 'Could not start deposit'))
        return
      }
      const j = (await res.json()) as {
        checkout_id: string
        redirect_stub?: string
        amount_minor?: number
      }
      setSession(j)
    } catch {
      toastPlayerNetworkError('Network error — try again.', 'POST /v1/wallet/deposit-session')
      setSessionErr('Network error — try again.')
    } finally {
      setSessionLoading(false)
    }
  }, [apiFetch, currency])

  useEffect(() => {
    if (!open || mainTab !== 'deposit' || payTab !== 'crypto') return
    void loadDepositSession()
  }, [open, mainTab, payTab, loadDepositSession])

  const depositAddress = session ? addressFromCheckoutId(session.checkout_id) : ''

  const copyAddress = async () => {
    if (!depositAddress) return
    try {
      await navigator.clipboard.writeText(depositAddress)
      setCopyMsg('Copied')
      setTimeout(() => setCopyMsg(null), 2000)
    } catch {
      setCopyMsg('Copy failed')
    }
  }

  const submitWithdraw = async () => {
    setWithdrawErr(null)
    const amt = Math.round(Number(withdrawAmount) * 100)
    if (!Number.isFinite(amt) || amt < 1) {
      setWithdrawErr('Enter a valid amount.')
      return
    }
    if (!withdrawDest.trim()) {
      setWithdrawErr('Enter a destination address.')
      return
    }
    setWithdrawBusy(true)
    try {
      const res = await apiFetch('/v1/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          amount_minor: amt,
          currency: 'USDT',
          destination: withdrawDest.trim(),
        }),
      })
      if (!res.ok) {
        const parsed = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(parsed, res.status, 'POST /v1/wallet/withdraw', rid)
        setWithdrawErr(formatApiError(parsed, 'Withdraw failed'))
        return
      }
      await refreshProfile()
      onClose()
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/wallet/withdraw')
      setWithdrawErr('Network error.')
    } finally {
      setWithdrawBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(92vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border border-casino-border bg-casino-surface shadow-2xl sm:rounded-xl"
      >
        <h2 id={titleId} className="sr-only">
          {mainTab === 'deposit' ? 'Deposit funds' : 'Withdraw funds'}
        </h2>
        <div className="flex shrink-0 items-stretch border-b border-casino-border">
          <button
            type="button"
            className={`flex-1 py-3.5 text-sm font-bold transition ${
              mainTab === 'deposit'
                ? 'bg-casino-elevated text-white'
                : 'text-casino-muted hover:text-casino-foreground'
            }`}
            onClick={() => setMainTab('deposit')}
          >
            Deposit
          </button>
          <button
            type="button"
            className={`flex-1 py-3.5 text-sm font-bold transition ${
              mainTab === 'withdraw'
                ? 'bg-casino-elevated text-white'
                : 'text-casino-muted hover:text-casino-foreground'
            }`}
            onClick={() => setMainTab('withdraw')}
          >
            Withdraw
          </button>
          <button
            type="button"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-casino-bg text-lg text-casino-muted hover:text-casino-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto p-5">
          {mainTab === 'deposit' ? (
            <>
              <div className="mb-4 flex gap-2 border-b border-casino-border pb-4">
                <button
                  type="button"
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold ${
                    payTab === 'crypto'
                      ? 'border-b-2 border-amber-500 text-white'
                      : 'text-casino-muted hover:text-casino-foreground'
                  }`}
                  onClick={() => setPayTab('crypto')}
                >
                  <span className="text-amber-500" aria-hidden>
                    ₿
                  </span>
                  Crypto
                </button>
                <button
                  type="button"
                  disabled
                  className="flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-casino-muted opacity-50"
                  title="Coming soon"
                >
                  Banking
                </button>
              </div>

              {payTab === 'crypto' ? (
                <>
                  <div className="mb-5 rounded-lg border border-casino-border bg-casino-elevated/50 p-4">
                    <h3 className="text-sm font-bold text-casino-foreground">Choose your Bonus</h3>
                    <p className="mt-2 text-xs text-casino-muted">
                      Now active bonus: First Welcome Bonus (demo){' '}
                      <span className="inline-block text-casino-primary" title="Info">
                        ⓘ
                      </span>
                    </p>
                    <button
                      type="button"
                      className="mt-3 w-full rounded-lg bg-white py-2.5 text-sm font-semibold text-black hover:bg-white/90"
                    >
                      Forfeit
                    </button>
                  </div>

                  <label className="mb-3 block">
                    <span className="mb-1.5 block text-xs font-medium text-casino-muted">Deposit Currency</span>
                    <div className="relative">
                      <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full appearance-none rounded-lg border border-casino-border bg-casino-bg py-2.5 pl-3 pr-9 text-sm text-casino-foreground outline-none focus:border-casino-primary"
                      >
                        <option value="USDT">USDT</option>
                      </select>
                      <IconChevronDown
                        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-casino-muted"
                        size={16}
                        aria-hidden
                      />
                    </div>
                  </label>

                  <label className="mb-3 block">
                    <span className="mb-1.5 block text-xs font-medium text-casino-muted">Choose Network</span>
                    <div className="relative">
                      <select
                        value={network}
                        onChange={(e) => setNetwork(e.target.value)}
                        className="w-full appearance-none rounded-lg border border-casino-border bg-casino-bg py-2.5 pl-3 pr-9 text-sm text-casino-foreground outline-none focus:border-casino-primary"
                      >
                        <option value="ERC20">ERC20</option>
                        <option value="TRC20">TRC20</option>
                      </select>
                      <IconChevronDown
                        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-casino-muted"
                        size={16}
                        aria-hidden
                      />
                    </div>
                  </label>

                  {sessionErr ? (
                    <p className="mb-3 text-sm text-red-400" role="alert">
                      {sessionErr}
                    </p>
                  ) : null}
                  {!me?.email_verified ? (
                    <p className="mb-3 text-sm text-amber-400">
                      Verify your email before depositing (check your inbox or profile).
                    </p>
                  ) : null}

                  <label className="mb-3 block">
                    <span className="mb-1.5 block text-xs font-medium text-casino-muted">
                      Your {currency} deposit address (demo mapping)
                    </span>
                    <input
                      readOnly
                      value={sessionLoading ? 'Loading…' : depositAddress || '—'}
                      className="w-full truncate rounded-lg border border-casino-border bg-casino-bg px-3 py-2.5 font-mono text-xs text-casino-foreground"
                    />
                  </label>

                  {session?.redirect_stub ? (
                    <a
                      href={session.redirect_stub}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-3 block text-center text-xs text-casino-primary underline"
                    >
                      Open payment provider (demo link)
                    </a>
                  ) : null}

                  <button
                    type="button"
                    disabled={!depositAddress || sessionLoading}
                    onClick={() => void copyAddress()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-casino-primary to-casino-primary-dim py-3 text-sm font-bold text-white shadow-lg shadow-casino-primary/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <IconCopy size={18} aria-hidden />
                    Copy address
                  </button>
                  {copyMsg ? <p className="mt-2 text-center text-xs text-emerald-400">{copyMsg}</p> : null}

                  <button
                    type="button"
                    className="mt-3 w-full text-xs text-casino-muted underline hover:text-casino-primary"
                    onClick={() => void loadDepositSession()}
                    disabled={sessionLoading}
                  >
                    Refresh session
                  </button>
                </>
              ) : (
                <p className="text-sm text-casino-muted">Banking deposits are not available in this demo.</p>
              )}
            </>
          ) : (
            <>
              <p className="mb-4 text-sm text-casino-muted">
                Withdraw to a wallet address. Demo uses integer minor units (e.g. 10 = 1000 minor if you enter 10.00
                with scale below).
              </p>
              <label className="mb-3 block">
                <span className="mb-1.5 block text-xs font-medium text-casino-muted">Amount (USDT, 2 decimals → ×100)</span>
                <input
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  type="text"
                  inputMode="decimal"
                  className="w-full rounded-lg border border-casino-border bg-casino-bg px-3 py-2.5 text-sm text-casino-foreground outline-none focus:border-casino-primary"
                />
              </label>
              <label className="mb-4 block">
                <span className="mb-1.5 block text-xs font-medium text-casino-muted">Destination</span>
                <input
                  value={withdrawDest}
                  onChange={(e) => setWithdrawDest(e.target.value)}
                  placeholder="Wallet address"
                  className="w-full rounded-lg border border-casino-border bg-casino-bg px-3 py-2.5 text-sm text-casino-foreground outline-none focus:border-casino-primary"
                />
              </label>
              {withdrawErr ? (
                <p className="mb-3 text-sm text-red-400" role="alert">
                  {withdrawErr}
                </p>
              ) : null}
              <button
                type="button"
                disabled={withdrawBusy}
                onClick={() => void submitWithdraw()}
                className="w-full rounded-lg bg-gradient-to-b from-casino-primary to-casino-primary-dim py-3 text-sm font-bold text-white shadow-md shadow-casino-primary/20 transition hover:brightness-110 disabled:opacity-50"
              >
                {withdrawBusy ? 'Processing…' : 'Withdraw'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default WalletFlowModal
