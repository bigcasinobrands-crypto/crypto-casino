import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { IconCopy, IconSearch } from './icons'

export type DepositNetworkId = 'BEP20' | 'ERC20' | 'TRC20'
export type DepositAssetSymbol = 'USDT' | 'USDC' | 'ETH' | 'TRX'

export const DEPOSIT_NETWORK_ORDER: DepositNetworkId[] = ['ERC20', 'TRC20', 'BEP20']

/** Logo.dev /crypto/{symbol} slug per chain card */
export const NETWORK_CHAIN_LOGO: Record<DepositNetworkId, string> = {
  BEP20: 'bnb',
  ERC20: 'eth',
  TRC20: 'trx',
}

export const DEPOSIT_ASSET_OPTIONS: { symbol: DepositAssetSymbol; label: string; networks: DepositNetworkId[] }[] = [
  { symbol: 'ETH', label: 'Ethereum', networks: ['ERC20'] },
  { symbol: 'USDT', label: 'Tether', networks: ['ERC20', 'TRC20', 'BEP20'] },
  { symbol: 'USDC', label: 'USD Coin', networks: ['ERC20'] },
  { symbol: 'TRX', label: 'Tron', networks: ['TRC20'] },
]

const NETWORK_META: Record<
  DepositNetworkId,
  { title: string; chainLine: string; accent: string }
> = {
  BEP20: {
    title: 'BNB Smart Chain',
    chainLine: 'BEP-20',
    accent: 'bg-[#F0B90B]',
  },
  ERC20: {
    title: 'Ethereum',
    chainLine: 'ERC-20',
    accent: 'bg-[#627EEA]',
  },
  TRC20: {
    title: 'Tron',
    chainLine: 'TRC-20',
    accent: 'bg-[#EB0029]',
  },
}

function CryptoLogoOrFallback({
  logoUrl,
  fallback,
  className,
}: {
  logoUrl?: string
  fallback: ReactNode
  className?: string
}) {
  const [bad, setBad] = useState(false)
  if (!logoUrl?.trim() || bad) return <>{fallback}</>
  return (
    <img
      src={logoUrl}
      alt=""
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="strict-origin-when-cross-origin"
      onError={() => setBad(true)}
    />
  )
}

function NetworkGlyph({ id, logoUrl }: { id: DepositNetworkId; logoUrl?: string }) {
  const m = NETWORK_META[id]
  const fallback = (
    <div
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white ${m.accent}`}
      aria-hidden
    >
      {id === 'BEP20' ? 'B' : id === 'ERC20' ? 'Ξ' : 'T'}
    </div>
  )
  return (
    <CryptoLogoOrFallback
      logoUrl={logoUrl}
      className="size-8 shrink-0 rounded-full bg-white/5 object-cover ring-1 ring-white/10"
      fallback={fallback}
    />
  )
}

export function parseDepositNetworkParam(v: string | null): DepositNetworkId {
  const u = (v || '').toUpperCase()
  if (u === 'TRC20' || u === 'TRON' || u === 'TRX') return 'TRC20'
  if (u === 'BEP20' || u === 'BSC' || u === 'BNB') return 'BEP20'
  return 'ERC20'
}

export function DepositSearchBar({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="relative mb-2">
      <IconSearch
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-casino-muted"
        size={14}
        aria-hidden
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('wallet.depositSearchPlaceholder')}
        className="w-full rounded-lg border border-casino-border bg-casino-bg py-2 pl-9 pr-2.5 text-sm text-casino-foreground outline-none placeholder:text-casino-muted focus:border-casino-primary"
        autoComplete="off"
      />
    </div>
  )
}

export function AssetToggleRow({
  symbol,
  onSymbol,
  searchFilter,
  logoUrls,
}: {
  symbol: DepositAssetSymbol
  onSymbol: (s: DepositAssetSymbol) => void
  searchFilter: string
  /** Lowercase symbol → img.logo.dev URL from API */
  logoUrls?: Record<string, string>
}) {
  const { t } = useTranslation()
  const q = searchFilter.trim().toLowerCase()
  const assets: { id: DepositAssetSymbol; label: string; sub: string; ring: string; glyph: string; bg: string }[] = [
    { id: 'ETH', label: 'ETH', sub: t('wallet.assets.ETH'), ring: 'ring-[#627EEA]/50', glyph: 'Ξ', bg: 'bg-[#627EEA]' },
    { id: 'USDT', label: 'USDT', sub: t('wallet.assets.USDT'), ring: 'ring-[#26A17B]/50', glyph: '₮', bg: 'bg-[#26A17B]' },
    { id: 'USDC', label: 'USDC', sub: t('wallet.assets.USDC'), ring: 'ring-[#2775CA]/50', glyph: '$', bg: 'bg-[#2775CA]' },
    { id: 'TRX', label: 'TRX', sub: t('wallet.assets.TRX'), ring: 'ring-[#EB0029]/50', glyph: 'T', bg: 'bg-[#EB0029]' },
  ]
  const visible = assets.filter(
    (a) => !q || a.label.toLowerCase().includes(q) || a.sub.toLowerCase().includes(q),
  )
  if (visible.length === 0) {
    return <p className="mb-2 text-xs text-casino-muted">{t('wallet.assetNoMatch')}</p>
  }
  return (
    <div className="mb-3 grid grid-cols-4 gap-1.5">
      {visible.map((a) => {
        const on = symbol === a.id
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onSymbol(a.id)}
            className={`flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2 text-center transition ${
              on
                ? `border-casino-primary bg-casino-surface ring-1 ${a.ring}`
                : 'border-casino-border bg-casino-surface hover:border-white/12 hover:bg-casino-chip-hover'
            }`}
          >
            <CryptoLogoOrFallback
              logoUrl={logoUrls?.[a.id.toLowerCase()]}
              className="size-8 shrink-0 rounded-full bg-white object-cover ring-1 ring-white/10"
              fallback={
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${a.bg}`}
                >
                  {a.glyph}
                </div>
              }
            />
            <div className="min-w-0 text-center">
              <div className="text-xs font-bold leading-tight text-casino-foreground">{a.label}</div>
              <div className="truncate text-[9px] leading-tight text-casino-muted">{a.sub}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

function parseAmountInput(v?: string): number {
  if (!v) return 0
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function NetworkCardGrid({
  symbol,
  network,
  onNetwork,
  balanceLabel,
  depositAmountInput,
  logoUrls,
}: {
  symbol: DepositAssetSymbol
  network: DepositNetworkId
  onNetwork: (n: DepositNetworkId) => void
  balanceLabel?: string
  /** Raw string from the USD amount input — used to preview new balance */
  depositAmountInput?: string
  logoUrls?: Record<string, string>
}) {
  const { t } = useTranslation()
  const bal = balanceLabel ?? '0.00'
  const balNum = Number(bal.replace(',', '.')) || 0
  const addAmt = parseAmountInput(depositAmountInput)
  const newBal = addAmt > 0 ? (balNum + addAmt).toFixed(2) : null
  const assetDef = DEPOSIT_ASSET_OPTIONS.find((a) => a.symbol === symbol)
  const availableNetworks = assetDef ? DEPOSIT_NETWORK_ORDER.filter((n) => assetDef.networks.includes(n)) : DEPOSIT_NETWORK_ORDER
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-casino-muted">{t('wallet.networkSection')}</p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {availableNetworks.map((id) => {
          const m = NETWORK_META[id]
          const selected = network === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNetwork(id)}
              className={`flex w-full items-start gap-2 rounded-lg border bg-casino-surface p-2 text-left transition ${
                selected
                  ? 'border-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]'
                  : 'border-casino-border hover:border-white/12 hover:bg-casino-chip-hover'
              }`}
            >
              <NetworkGlyph id={id} logoUrl={logoUrls?.[NETWORK_CHAIN_LOGO[id]]} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold leading-tight text-casino-foreground">{t(`wallet.net.${id}`)}</div>
                <div className="text-[10px] leading-tight text-casino-muted">
                  {m.chainLine} · {symbol}
                </div>
                <div className="mt-1 text-sm font-bold tabular-nums text-white">{bal}</div>
                {newBal && (
                  <div className="text-[10px] tabular-nums text-emerald-400">
                    {t('wallet.afterDeposit')} {newBal}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const WITHDRAW_NETWORK_IDS = ['ERC20', 'TRC20'] as const

/** Network cards matching deposit NetworkCardGrid styling; ERC20 / TRC20 only (withdraw). */
export function WithdrawNetworkCardGrid({
  symbol,
  network,
  onNetwork,
  balanceLabel,
  withdrawAmountInput,
  logoUrls,
}: {
  symbol: DepositAssetSymbol
  network: (typeof WITHDRAW_NETWORK_IDS)[number]
  onNetwork: (n: (typeof WITHDRAW_NETWORK_IDS)[number]) => void
  balanceLabel?: string
  /** Raw string from the withdrawal amount input — used to preview remaining balance */
  withdrawAmountInput?: string
  logoUrls?: Record<string, string>
}) {
  const { t } = useTranslation()
  const bal = balanceLabel ?? '0.00'
  const balNum = Number(bal.replace(',', '.')) || 0
  const wdAmt = parseAmountInput(withdrawAmountInput)
  const remaining = wdAmt > 0 ? Math.max(0, balNum - wdAmt).toFixed(2) : null
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-casino-muted">{t('wallet.networkSection')}</p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {WITHDRAW_NETWORK_IDS.map((id) => {
          const m = NETWORK_META[id]
          const selected = network === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNetwork(id)}
              className={`flex w-full items-start gap-2 rounded-lg border bg-casino-surface p-2 text-left transition ${
                selected
                  ? 'border-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]'
                  : 'border-casino-border hover:border-white/12 hover:bg-casino-chip-hover'
              }`}
            >
              <NetworkGlyph id={id} logoUrl={logoUrls?.[NETWORK_CHAIN_LOGO[id]]} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold leading-tight text-casino-foreground">{t(`wallet.net.${id}`)}</div>
                <div className="text-[10px] leading-tight text-casino-muted">
                  {m.chainLine} · {symbol}
                </div>
                <div className="mt-1 text-sm font-bold tabular-nums text-white">{bal}</div>
                {remaining && (
                  <div className="text-[10px] tabular-nums text-red-400">
                    {t('wallet.afterWithdrawal')} {remaining}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function UsdAmountField({
  value,
  onChange,
  minUsd,
  tone = 'default',
}: {
  value: string
  onChange: (v: string) => void
  minUsd?: number
  /** Banani-style wallet chrome (dark panels + field wells) */
  tone?: 'default' | 'wallet'
}) {
  const { t } = useTranslation()
  const min = minUsd ?? 10
  const wallet = tone === 'wallet'
  return (
    <div className="mb-3">
      <label
        className={`mb-2 block text-xs ${wallet ? 'text-casino-muted' : 'font-medium text-casino-foreground'}`}
      >
        {t('wallet.amountMinUsd')}
        <span className={wallet ? 'font-normal text-casino-muted/90' : 'font-normal text-casino-muted'}>
          {t('wallet.amountMinSuffix', { min })}
        </span>
      </label>
      <div className="flex gap-1.5">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type="text"
          inputMode="decimal"
          className={
            wallet
              ? 'min-w-0 flex-1 rounded-lg border border-casino-border bg-wallet-field px-4 py-3 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-casino-primary/45'
              : 'min-w-0 flex-1 rounded-lg border border-casino-border bg-casino-bg px-2.5 py-2 text-sm text-casino-foreground outline-none focus:border-casino-primary'
          }
        />
        <div
          className={
            wallet
              ? 'flex items-center rounded-lg border border-casino-border bg-casino-segment-track px-3 text-xs font-semibold text-casino-muted'
              : 'flex items-center rounded-lg border border-casino-border bg-casino-segment-track px-2.5 text-xs font-semibold text-casino-muted'
          }
        >
          {t('wallet.currencyUsd')}
        </div>
      </div>
    </div>
  )
}

export function DepositWrongChainWarning({
  symbol,
  networkLabel,
}: {
  symbol: string
  networkLabel: string
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs leading-snug text-amber-100/95">
      <p>{t('wallet.depositWrongChain', { symbol, network: networkLabel })}</p>
    </div>
  )
}

export function ChooseAssetNetworkHint() {
  const { t } = useTranslation()
  return (
    <p className="mb-2 text-[11px] text-casino-muted">
      {t('wallet.matchAssetDepositHint')}
    </p>
  )
}

/** Human label for instructions header / summary */
export function depositNetworkTitle(id: DepositNetworkId): string {
  const m = NETWORK_META[id]
  const title = i18n.t(`wallet.net.${id}`)
  return `${title} (${m.chainLine})`
}

export function InstructionsNetworkStrip({
  symbol,
  network,
  envBadge,
  logoUrls,
}: {
  symbol: DepositAssetSymbol
  network: DepositNetworkId
  envBadge?: string
  logoUrls?: Record<string, string>
}) {
  const { t } = useTranslation()
  const m = NETWORK_META[network]
  const badge = envBadge?.trim() || t('wallet.stagingBadge')
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-casino-muted">{t('wallet.networkSection')}</p>
      <div className="flex items-center gap-2 rounded-lg border border-casino-border bg-casino-surface p-2">
        <NetworkGlyph id={network} logoUrl={logoUrls?.[NETWORK_CHAIN_LOGO[network]]} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-casino-foreground">{t(`wallet.net.${network}`)}</span>
            <span className="rounded bg-casino-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase text-casino-muted">
              {badge}
            </span>
          </div>
          <div className="text-[10px] text-casino-muted">{m.chainLine}</div>
        </div>
        <div className="text-xs font-bold text-casino-foreground">{symbol}</div>
      </div>
    </div>
  )
}

export function InstructionsCryptoFiatChrome({
  children,
  onBack,
}: {
  children: ReactNode
  onBack: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-casino-border bg-casino-surface py-2 text-xs font-medium text-casino-foreground hover:border-white/12 hover:bg-casino-chip-hover"
      >
        {t('wallet.back')}
      </button>
      {children}
    </div>
  )
}

export function DepositAmountSummary({ amountUsdText }: { amountUsdText: string }) {
  const { t } = useTranslation()
  return (
    <p className="text-center text-xs text-casino-foreground">
      {t('wallet.referenceUsd', { amount: amountUsdText })}
    </p>
  )
}

export function FiatEstimateNote({ symbol }: { symbol: DepositAssetSymbol }) {
  const { t } = useTranslation()
  return (
    <p className="text-center text-[10px] leading-snug text-casino-muted">
      {t('wallet.fiatEstimateNote', { symbol })}
    </p>
  )
}

export function CopyAddressButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-red-600 to-red-700 py-2.5 text-sm font-bold text-white shadow-md shadow-red-900/25 transition hover:brightness-110 disabled:opacity-50"
    >
      <IconCopy size={16} aria-hidden />
      {t('wallet.copyAddress')}
    </button>
  )
}
