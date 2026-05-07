import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { readApiError } from '../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { DepositWrongChainWarning } from './DepositFlowShared'
import {
  WalletAmountCurrencyRow,
  WalletFeeSummary,
  WalletInfoTrigger,
  WalletNativeSelectRow,
  WalletPanel,
  WalletPrimaryButton,
  WalletTextField,
} from './wallet/WalletShell'
import { transactionExplorerUrl } from '../lib/walletExplorer'
import { getFingerprintForAction } from '../lib/fingerprintClient'
import { usePlayerAuth } from '../playerAuth'
import {
  type PassimpayCurrency,
  currencyOptionLabel,
  formatMinorHint,
  passimpayNetworkLabel,
} from '../lib/paymentCurrencies'

type WithdrawFormPanelProps = {
  currencies: PassimpayCurrency[]
  currenciesLoading: boolean
  currenciesError: string | null
  onRetryCurrencies?: () => void
  selected: PassimpayCurrency | null
  onSelect: (c: PassimpayCurrency) => void
  onSuccess: (p: { id: string; symbol: string; network: string; payment_id?: number }) => void
  /**
   * When true (e.g. wallet modal on mobile), primary action is pinned in a footer below a scroll area
   * so the submit button stays visible above the home indicator / bottom nav.
   */
  splitFooter?: boolean
}

export function WithdrawFormPanel({
  currencies,
  currenciesLoading,
  currenciesError,
  onRetryCurrencies,
  selected,
  onSelect,
  onSuccess,
  splitFooter = false,
}: WithdrawFormPanelProps) {
  const { t } = useTranslation()
  const { apiFetch, refreshProfile, balanceMinor } = usePlayerAuth()
  const [amount, setAmount] = useState('10')
  const [destination, setDestination] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // P2: Persist a single Idempotency-Key per withdrawal intent. A double-click,
  // network retry, or transient browser hiccup must not produce two ledger
  // locks. The key resets after a successful submit (handled below) and after
  // an explicit selected-currency change (the user is starting a new intent).
  const idemKeyRef = useRef<string | null>(null)
  const ensureIdemKey = useCallback(() => {
    if (!idemKeyRef.current) {
      idemKeyRef.current = crypto.randomUUID()
    }
    return idemKeyRef.current
  }, [])

  const balanceLabel = useMemo(() => {
    if (balanceMinor == null) return '0.00'
    return (balanceMinor / 100).toFixed(2)
  }, [balanceMinor])

  const parsedAmountUsd = useMemo(() => {
    const n = Number(amount.replace(',', '.'))
    return Number.isFinite(n) && n >= 0 ? n : null
  }, [amount])

  const withdrawList = useMemo(() => currencies.filter((c) => c.withdraw_enabled), [currencies])

  const selectOpts = useMemo(
    () =>
      withdrawList.map((c) => ({
        value: String(c.payment_id),
        label: currencyOptionLabel(c),
      })),
    [withdrawList],
  )

  const minFmt = selected ? formatMinorHint(selected.symbol, selected.min_withdraw_minor) : null
  const minHint = minFmt ? `${minFmt} · ${t('wallet.minWithdrawHint')}` : t('wallet.minWithdrawHint')

  // P2: Switching currencies starts a new withdrawal intent — generate a fresh key
  // on the next submit so we don't accidentally reuse a previous key for a different
  // currency.
  const selectedPaymentID = selected?.payment_id ?? null
  useEffect(() => {
    idemKeyRef.current = null
  }, [selectedPaymentID])

  const submit = async () => {
    setErr(null)
    if (!selected) {
      setErr(t('wallet.passimpayPickCurrency'))
      return
    }
    const amt = Math.round(Number(amount.replace(',', '.')) * 100)
    if (!Number.isFinite(amt) || amt < 1) {
      setErr(t('wallet.errEnterValidAmount'))
      return
    }
    if (!destination.trim()) {
      setErr(t('wallet.errEnterDestination'))
      return
    }
    setBusy(true)
    try {
      const fp = await getFingerprintForAction()
      const payload: Record<string, unknown> = {
        amount_minor: amt,
        currency: selected.symbol,
        network: selected.network,
        destination: destination.trim(),
        payment_id: selected.payment_id,
      }
      if (fp?.requestId) {
        payload.fingerprint_request_id = fp.requestId
      }
      const res = await apiFetch('/v1/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': ensureIdemKey(),
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const parsed = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(parsed, res.status, 'POST /v1/wallet/withdraw', rid)
        setErr(parsed?.message ?? t('wallet.errWithdrawFailed'))
        // Keep the same Idempotency-Key — a 4xx may be transient (e.g. min amount,
        // address validation). Retrying with the same key is safe: the server will
        // either accept the new params or, if the original lock already happened,
        // return the existing withdrawal_id.
        return
      }
      const j = (await res.json()) as { withdrawal_id?: string }
      await refreshProfile()
      // Successful submit: clear the key so the next withdrawal opens a new intent.
      idemKeyRef.current = null
      const id = j.withdrawal_id
      if (id) {
        onSuccess({
          id,
          symbol: selected.symbol,
          network: selected.network,
          payment_id: selected.payment_id,
        })
      }
    } catch {
      toastPlayerNetworkError('Network error.', 'POST /v1/wallet/withdraw')
      setErr(t('wallet.errWithdrawNetwork'))
    } finally {
      setBusy(false)
    }
  }

  const netLabel = selected ? passimpayNetworkLabel(selected.network) : ''

  const fields = (
    <>
      {currenciesLoading ? (
        <p className="mb-2 text-xs text-casino-muted">{t('wallet.passimpayCurrenciesLoading')}</p>
      ) : null}
      {currenciesError ? (
        <div className="mb-2 rounded-lg border border-casino-border bg-casino-elevated/80 px-3 py-2.5" role="alert">
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
      {!currenciesLoading && !currenciesError && withdrawList.length === 0 ? (
        <p className="mb-2 text-xs text-amber-200/90" role="status">
          {t('wallet.passimpayNoWithdrawCurrencies')}
        </p>
      ) : null}

      <WalletPanel className="mb-4">
        <div className="mb-2 flex items-center justify-between gap-2 text-[13px] font-semibold text-white">
          <span>{t('wallet.availableToWithdraw')}</span>
          <WalletInfoTrigger
            label={t('wallet.availableToWithdrawInfo')}
            title={t('wallet.availableToWithdrawTitle')}
          />
        </div>
        <div className="text-2xl font-bold tabular-nums tracking-tight text-white">${balanceLabel}</div>
      </WalletPanel>

      <WalletPanel className="mb-0">
        <WalletAmountCurrencyRow
          amount={amount}
          onAmountChange={setAmount}
          currencyLabel={t('wallet.currencyUsd')}
          hint={minHint}
        />

        <WalletNativeSelectRow
          label={t('wallet.passimpayCurrency')}
          value={selected ? String(selected.payment_id) : ''}
          onChange={(v) => {
            const row = withdrawList.find((c) => String(c.payment_id) === v)
            if (row) onSelect(row)
          }}
          options={selectOpts}
        />

        {selected ? (
          <p className="mb-3 text-[11px] leading-snug text-casino-muted">
            {t('wallet.passimpayProviderNote', {
              id: selected.payment_id,
              sym: selected.symbol,
              net: selected.network || '—',
            })}
            {selected.requires_tag ? ` ${t('wallet.passimpayRequiresTag')}` : ''}
          </p>
        ) : null}

        <WalletTextField
          label={t('wallet.withdrawDestinationLabel')}
          value={destination}
          onChange={setDestination}
          placeholder={
            selected
              ? t('wallet.withdrawAddrPlaceholder', {
                  symbol: selected.symbol,
                  network: netLabel,
                })
              : t('wallet.withdrawDestinationPlaceholderGeneric')
          }
        />

        <div className="mb-3">
          {selected ? (
            <DepositWrongChainWarning symbol={selected.symbol} networkLabel={netLabel} />
          ) : null}
        </div>

        <WalletFeeSummary
          lines={[{ label: `${t('wallet.processingFee')}:`, value: t('wallet.feeNotApplicable') }]}
          totalLabel={`${t('wallet.total')}:`}
          totalValue={parsedAmountUsd != null ? `$${parsedAmountUsd.toFixed(2)}` : '—'}
        />

        {err ? (
          <p className="mb-2 mt-3 text-xs text-red-400" role="alert">
            {err}
          </p>
        ) : null}
      </WalletPanel>
    </>
  )

  const submitBtn = (
    <WalletPrimaryButton disabled={busy || !selected || withdrawList.length === 0} onClick={() => void submit()}>
      {busy ? t('wallet.withdrawProcessing') : t('wallet.withdraw')}
    </WalletPrimaryButton>
  )

  if (splitFooter) {
    return (
      <>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth p-3 sm:p-4 scrollbar-casino">
          {fields}
        </div>
        <div className="shrink-0 border-t border-casino-border bg-wallet-modal px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
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
  network?: string
  payment_id?: number
  provider?: string
}

type WithdrawSuccessPanelProps = {
  id: string
  network: string
  symbol: string
  paymentId?: number
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

export function WithdrawSuccessPanel({ id, network, symbol, paymentId, onAnother, showGamesLink }: WithdrawSuccessPanelProps) {
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
  const explorerNetwork = (row?.network ?? network).trim()
  const explorer =
    row?.explorer_url?.trim() || (tx ? transactionExplorerUrl(explorerNetwork, tx) : null) || null

  const amountLabel = row?.amount_minor != null ? `$${(row.amount_minor / 100).toFixed(2)}` : null

  const displaySym = row?.currency?.trim() || symbol
  const displayNetLabel = passimpayNetworkLabel(row?.network ?? network)

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
          <span className="text-sm text-casino-foreground">
            {amountLabel} <span className="text-casino-muted">via</span> {displaySym}{' '}
            <span className="text-casino-muted">on</span> {displayNetLabel}
          </span>
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
        {row?.payment_id != null || paymentId != null ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-casino-muted">PassimPay ID</p>
              <p className="mt-0.5 font-mono text-[10px] text-casino-foreground">{row?.payment_id ?? paymentId}</p>
            </div>
            {(row?.network ?? network).trim() ? (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-casino-muted">Network</p>
                <p className="mt-0.5 text-[10px] text-casino-foreground">{displayNetLabel}</p>
              </div>
            ) : null}
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
