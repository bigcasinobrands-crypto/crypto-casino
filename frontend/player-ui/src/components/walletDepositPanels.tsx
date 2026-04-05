import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CopyAddressButton,
  DepositAmountSummary,
  FiatEstimateNote,
  InstructionsCryptoFiatChrome,
  InstructionsNetworkStrip,
  type DepositAssetSymbol,
  type DepositNetworkId,
} from './DepositFlowShared'
import { useCryptoLogoUrlMap } from '../lib/cryptoLogoUrls'
import { readApiError } from '../api/errors'
import { toastPlayerApiError, toastPlayerNetworkError } from '../notifications/playerToast'
import { usePlayerAuth } from '../playerAuth'
import { networkHelpUrl, transactionExplorerUrl } from '../lib/walletExplorer'

const MIN_USD_CENTS = 1000

const ENV_BADGE = (import.meta.env.VITE_DEPOSIT_ENV_BADGE as string | undefined)?.trim() || 'Staging'

type DepositAddrRes = {
  address?: string
  qr_url?: string
  symbol?: string
  network?: string
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
  return '—'
}

export function validAddressStepParams(sp: URLSearchParams): boolean {
  const cents = Number(sp.get('amount_minor'))
  if (Number.isFinite(cents) && cents >= MIN_USD_CENTS) return true
  const usd = sp.get('amount_usd')
  return !!(usd && Number.isFinite(Number(usd)) && Number(usd) >= MIN_USD_CENTS / 100)
}

export function effectiveWalletDepositPhase(sp: URLSearchParams): 'form' | 'address' | 'sent' {
  const s = sp.get('step')
  if (s === 'sent') return 'sent'
  if (s === 'address' && validAddressStepParams(sp)) return 'address'
  return 'form'
}

type DepositAddressPanelProps = {
  symbol: DepositAssetSymbol
  network: DepositNetworkId
  amountUsdText: string
  onBack: () => void
  onSent: () => void
}

export function DepositAddressPanel({ symbol, network, amountUsdText, onBack, onSent }: DepositAddressPanelProps) {
  const { accessToken, apiFetch } = usePlayerAuth()
  const logoUrls = useCryptoLogoUrlMap()
  const [data, setData] = useState<DepositAddrRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    setLoading(true)
    try {
      const q = new URLSearchParams({ symbol, network })
      const res = await apiFetch(`/v1/wallet/deposit-address?${q}`)
      if (!res.ok) {
        const parsed = await readApiError(res)
        const rid = res.headers.get('X-Request-Id') ?? res.headers.get('X-Request-ID')
        toastPlayerApiError(parsed, res.status, 'GET /v1/wallet/deposit-address', rid)
        setErr(parsed?.message ?? 'Could not load deposit address')
        setData(null)
        return
      }
      const j = (await res.json()) as DepositAddrRes
      setData(j)
    } catch {
      toastPlayerNetworkError('Network error.', 'GET /v1/wallet/deposit-address')
      setErr('Network error')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [apiFetch, symbol, network])

  useEffect(() => {
    if (!accessToken) return
    void load()
  }, [accessToken, load])

  const copyAddress = async () => {
    const a = data?.address?.trim()
    if (!a) return
    try {
      await navigator.clipboard.writeText(a)
      setCopyMsg('Copied')
      setTimeout(() => setCopyMsg(null), 2000)
    } catch {
      setCopyMsg('Copy failed')
    }
  }

  const address = data?.address?.trim() ?? ''
  const qrUrl = data?.qr_url?.trim()

  return (
    <div className="space-y-3">
      <InstructionsCryptoFiatChrome onBack={onBack}>
        <DepositAmountSummary amountUsdText={amountUsdText} />
        <FiatEstimateNote symbol={symbol} />
        <InstructionsNetworkStrip symbol={symbol} network={network} envBadge={ENV_BADGE} logoUrls={logoUrls} />
      </InstructionsCryptoFiatChrome>

      {loading ? <p className="text-xs text-casino-muted">Loading…</p> : null}
      {err ? (
        <p className="text-xs text-red-400" role="alert">
          {err}
        </p>
      ) : null}

      {!loading && !err && address ? (
        <>
          <div className="flex flex-col items-center gap-3 pt-1">
            {qrUrl ? (
              <img src={qrUrl} alt="Deposit QR" className="size-[140px] rounded-lg bg-white p-2 shadow-md" />
            ) : (
              <div className="rounded-lg bg-white p-2 shadow-md">
                <QRCodeSVG value={address} size={128} level="M" />
              </div>
            )}
            <code className="w-full break-all rounded-md bg-casino-bg px-2 py-1.5 text-center text-[10px] leading-snug text-casino-foreground">
              {address}
            </code>
          </div>

          <CopyAddressButton onClick={() => void copyAddress()} />
          {copyMsg ? <p className="text-center text-[10px] text-emerald-400">{copyMsg}</p> : null}

          <button
            type="button"
            onClick={onSent}
            className="w-full rounded-lg border border-casino-border py-2 text-xs font-semibold text-casino-foreground hover:bg-casino-elevated"
          >
            I’ve sent it
          </button>
        </>
      ) : null}

      {!loading && !err && !address ? (
        <p className="text-xs text-casino-muted">No address — check FYSTACK deposit assets.</p>
      ) : null}
    </div>
  )
}

type DepositSentPanelProps = {
  symbol: string
  network: string
  txHash?: string
  onDepositAgain: () => void
  /** Full page: show Games link in header row */
  showGamesLink?: boolean
}

export function DepositSentPanel({ symbol, network, txHash = '', onDepositAgain, showGamesLink }: DepositSentPanelProps) {
  const explorer = txHash ? transactionExplorerUrl(network, txHash) : null
  const help = networkHelpUrl(network)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-casino-primary">Deposit sent</h2>
        {showGamesLink ? (
          <Link to="/casino/games" className="text-xs text-casino-muted hover:text-casino-primary">
            Games
          </Link>
        ) : null}
      </div>

      <div className="rounded-lg border border-casino-border bg-casino-surface p-3 text-xs leading-snug text-casino-foreground">
        <p>
          We’ll credit after {network} confirms your {symbol}. Usually a few minutes.
        </p>
        {explorer ? (
          <a
            href={explorer}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs font-semibold text-casino-primary underline"
          >
            Transaction
          </a>
        ) : (
          <a
            href={help}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-casino-primary underline"
          >
            {network} explorer
          </a>
        )}
      </div>

      <button
        type="button"
        onClick={onDepositAgain}
        className="w-full rounded-lg border border-casino-border py-2 text-center text-xs text-casino-foreground hover:bg-casino-elevated"
      >
        Deposit again
      </button>
    </div>
  )
}
