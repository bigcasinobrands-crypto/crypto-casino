import { useCallback, useEffect, useRef, useState, type FC } from 'react'
import { createPortal } from 'react-dom'
import { usePlayerAuth } from '../playerAuth'
import { useAuthModal } from '../authModalContext'
import { useCryptoLogoUrlMap } from '../lib/cryptoLogoUrls'
import { IconChevronDown, IconSearch } from './icons'
import type { WalletMainTab } from './WalletFlowModal'
import type { DepositAssetSymbol, DepositNetworkId } from './DepositFlowShared'
import { NETWORK_CHAIN_LOGO } from './DepositFlowShared'

type HeaderWalletBarProps = {
  onOpenWallet: (tab: WalletMainTab) => void
}

function formatBalance(minor: number | null): string {
  if (minor == null) return '0.00'
  return (minor / 100).toFixed(2)
}

type WalletOption = {
  symbol: DepositAssetSymbol
  network: DepositNetworkId
  chainTitle: string
  accent: string
  glyph: string
}

const WALLET_OPTIONS: WalletOption[] = [
  { symbol: 'ETH', network: 'ERC20', chainTitle: 'Ethereum', accent: 'bg-[#627EEA]', glyph: 'Ξ' },
  { symbol: 'USDT', network: 'ERC20', chainTitle: 'Ethereum', accent: 'bg-[#627EEA]', glyph: 'Ξ' },
  { symbol: 'USDT', network: 'TRC20', chainTitle: 'Tron', accent: 'bg-[#EB0029]', glyph: 'T' },
  { symbol: 'USDT', network: 'BEP20', chainTitle: 'BSC', accent: 'bg-[#F0B90B]', glyph: 'B' },
  { symbol: 'USDC', network: 'ERC20', chainTitle: 'Ethereum', accent: 'bg-[#627EEA]', glyph: 'Ξ' },
  { symbol: 'TRX', network: 'TRC20', chainTitle: 'Tron', accent: 'bg-[#EB0029]', glyph: 'T' },
]

const PERSIST_KEY = 'player_active_wallet'
const HIDE_ZERO_KEY = 'player_hide_zero_bal'

function loadSavedWallet(): WalletOption {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { symbol?: string; network?: string }
      const found = WALLET_OPTIONS.find(
        (w) => w.symbol === parsed.symbol && w.network === parsed.network,
      )
      if (found) return found
    }
  } catch {
    // ignore
  }
  return WALLET_OPTIONS[0]
}

function ChainLogo({
  wallet,
  logoUrl,
  size = 'sm',
}: {
  wallet: WalletOption
  logoUrl?: string
  size?: 'sm' | 'md'
}) {
  const dim = size === 'md' ? 'size-8' : 'size-5'
  const textSize = size === 'md' ? 'text-[10px]' : 'text-[7px]'
  const [bad, setBad] = useState(false)

  if (logoUrl && !bad) {
    return (
      <img
        src={logoUrl}
        alt=""
        className={`${dim} shrink-0 rounded-full bg-white/5 object-cover ring-1 ring-white/10`}
        loading="lazy"
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => setBad(true)}
      />
    )
  }

  return (
    <span
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full ${textSize} font-black text-white ${wallet.accent}`}
      aria-hidden
    >
      {wallet.glyph}
    </span>
  )
}

function AssetLogo({
  symbol,
  logoUrl,
}: {
  symbol: DepositAssetSymbol
  logoUrl?: string
}) {
  const [bad, setBad] = useState(false)
  if (logoUrl && !bad) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="size-6 shrink-0 rounded-full bg-white object-cover ring-1 ring-white/10"
        loading="lazy"
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => setBad(true)}
      />
    )
  }
  const bgMap: Record<string, string> = { ETH: 'bg-[#627EEA]', USDT: 'bg-[#26A17B]', USDC: 'bg-[#2775CA]', TRX: 'bg-[#EB0029]' }
  const charMap: Record<string, string> = { ETH: 'Ξ', USDT: '₮', USDC: '$', TRX: 'T' }
  const bg = bgMap[symbol] ?? 'bg-[#627EEA]'
  const char = charMap[symbol] ?? symbol[0]
  return (
    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${bg}`} aria-hidden>
      {char}
    </span>
  )
}

type PanelTab = 'crypto' | 'fiat'

const HeaderWalletBar: FC<HeaderWalletBarProps> = ({ onOpenWallet }) => {
  const { accessToken, balanceMinor } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const logoUrls = useCryptoLogoUrlMap()
  const [active, setActive] = useState<WalletOption>(loadSavedWallet)
  const [open, setOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null)
  const [barRect, setBarRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  const [search, setSearch] = useState('')
  const [panelTab, setPanelTab] = useState<PanelTab>('crypto')
  const [assetFilter, setAssetFilter] = useState<DepositAssetSymbol>('ETH')
  const [hideZero, setHideZero] = useState(() => localStorage.getItem(HIDE_ZERO_KEY) === '1')

  const recalcPos = useCallback(() => {
    if (barRef.current) {
      const r = barRef.current.getBoundingClientRect()
      setBarRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      setPanelPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    recalcPos()
    window.addEventListener('resize', recalcPos)
    return () => window.removeEventListener('resize', recalcPos)
  }, [open, recalcPos])

  useEffect(() => {
    if (open) {
      setSearch('')
      setAssetFilter(active.symbol)
    }
  }, [open, active.symbol])

  const selectWallet = (w: WalletOption) => {
    setActive(w)
    setOpen(false)
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ symbol: w.symbol, network: w.network }))
  }

  const toggleHideZero = () => {
    setHideZero((v) => {
      const next = !v
      localStorage.setItem(HIDE_ZERO_KEY, next ? '1' : '0')
      return next
    })
  }

  const onDeposit = () => {
    if (!accessToken) {
      openAuth('login', { walletTab: 'deposit' })
      return
    }
    setOpen(false)
    onOpenWallet('deposit')
  }

  const chainLogoSlug = NETWORK_CHAIN_LOGO[active.network]

  const q = search.trim().toLowerCase()
  const networkWallets = WALLET_OPTIONS.filter((w) => {
    if (w.symbol !== assetFilter) return false
    if (q && !w.chainTitle.toLowerCase().includes(q) && !w.network.toLowerCase().includes(q)) return false
    if (hideZero) {
      const isActive = w.symbol === active.symbol && w.network === active.network
      if (!isActive && (balanceMinor == null || balanceMinor === 0)) return false
    }
    return true
  })

  const walletBarInner = (
    <>
      <span className="shrink-0 pl-3 text-sm font-semibold tabular-nums text-white">
        {formatBalance(accessToken ? balanceMinor : 0)}
      </span>
      <div className="ml-1 shrink-0">
        <button
          type="button"
          disabled={!accessToken}
          onClick={() => setOpen((p) => !p)}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-casino-muted transition hover:text-casino-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChainLogo wallet={active} logoUrl={logoUrls[chainLogoSlug]} />
          <span className="hidden text-white sm:inline">{active.symbol}</span>
          <span className="hidden text-casino-muted sm:inline">·</span>
          <span className="hidden sm:inline">{active.network}</span>
          <IconChevronDown
            className={`size-3.5 text-casino-muted transition ${open ? 'rotate-180' : ''}`}
            size={14}
            aria-hidden
          />
        </button>
      </div>
      <div className="mx-1 hidden h-6 w-px shrink-0 bg-casino-border sm:block" aria-hidden />
      <button
        type="button"
        onClick={onDeposit}
        className="shrink-0 bg-gradient-to-b from-casino-primary to-casino-primary-dim px-4 py-2.5 text-sm font-bold text-white shadow-inner shadow-casino-primary/20 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary"
      >
        Deposit
      </button>
    </>
  )

  return (
    <div className="mx-auto flex w-full max-w-md min-w-0 items-center justify-center">
      <div
        ref={barRef}
        className="flex min-w-0 max-w-full items-center gap-0 overflow-hidden rounded-lg border border-casino-border bg-casino-surface shadow-sm"
      >
        {walletBarInner}
      </div>

      {open && panelPos && createPortal(
        <>
          {/* Blur backdrop — covers everything including header */}
          <div
            className="fixed inset-0 z-[199] bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Floating wallet bar — sharp, above the blur */}
          {barRect && (
            <div
              style={{ position: 'fixed', top: barRect.top, left: barRect.left, width: barRect.width, height: barRect.height, zIndex: 200 }}
              className="flex items-center gap-0 overflow-hidden rounded-lg border border-casino-border bg-casino-surface shadow-sm"
            >
              {walletBarInner}
            </div>
          )}

          {/* Dropdown panel */}
          <div
            ref={panelRef}
            style={{ top: panelPos.top, right: panelPos.right }}
            className="fixed z-[200] w-80 overflow-hidden rounded-xl border border-casino-border bg-casino-bg shadow-2xl sm:w-[340px]"
          >
            <div className="relative px-3 pt-3">
              <IconSearch
                className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-casino-muted"
                size={14}
                aria-hidden
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search crypto balances..."
                className="w-full rounded-lg border border-casino-border bg-casino-surface py-2 pl-8 pr-3 text-xs text-casino-foreground outline-none placeholder:text-casino-muted focus:border-casino-primary"
                autoComplete="off"
                autoFocus
              />
            </div>

            <div className="mx-3 mt-2 flex gap-0 rounded-lg border border-casino-border bg-casino-surface p-0.5">
              {(['crypto', 'fiat'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPanelTab(t)}
                  className={`flex-1 rounded-md py-1.5 text-[11px] font-semibold capitalize transition ${
                    panelTab === t
                      ? 'bg-casino-elevated text-white shadow-sm'
                      : 'text-casino-muted hover:text-casino-foreground'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {panelTab === 'crypto' ? (
              <div className="p-3">
                <div className="mb-3 grid grid-cols-4 gap-1.5">
                  {(['ETH', 'USDT', 'USDC', 'TRX'] as const).map((s) => {
                    const on = assetFilter === s
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setAssetFilter(s)}
                        className={`flex items-center justify-center gap-2 rounded-lg border py-2 text-xs font-bold transition ${
                          on
                            ? 'border-casino-primary bg-casino-elevated text-white ring-1 ring-casino-primary/30'
                            : 'border-casino-border text-casino-muted hover:border-casino-border/80 hover:text-casino-foreground'
                        }`}
                      >
                        <AssetLogo symbol={s} logoUrl={logoUrls[s.toLowerCase()]} />
                        {s}
                      </button>
                    )
                  })}
                </div>

                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-casino-muted">
                  Network
                </p>

                <div className="grid grid-cols-2 gap-1.5">
                  {networkWallets.length === 0 ? (
                    <p className="col-span-2 py-4 text-center text-xs text-casino-muted">
                      No wallets match.
                    </p>
                  ) : (
                    networkWallets.map((w) => {
                      const key = `${w.symbol}-${w.network}`
                      const isActive =
                        w.symbol === active.symbol && w.network === active.network
                      const slug = NETWORK_CHAIN_LOGO[w.network]
                      const bal = isActive ? formatBalance(balanceMinor) : '0.00'
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => selectWallet(w)}
                          className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left transition hover:bg-casino-elevated/40 ${
                            isActive
                              ? 'border-casino-primary bg-casino-elevated/60 shadow-[0_0_0_1px_rgba(139,92,246,0.25)]'
                              : 'border-casino-border'
                          }`}
                        >
                          <ChainLogo wallet={w} logoUrl={logoUrls[slug]} size="md" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-semibold leading-tight text-casino-foreground">
                                {w.network}
                              </span>
                              <span className="truncate text-[10px] leading-tight text-casino-muted">
                                ({w.chainTitle})
                              </span>
                            </div>
                            <div className="mt-0.5 text-[10px] font-medium text-casino-muted">
                              {w.symbol}
                            </div>
                            <div className="mt-1.5 rounded-md bg-casino-bg/60 px-1.5 py-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-casino-muted">Balance</span>
                                <span className="text-xs font-bold tabular-nums text-casino-foreground">
                                  {bal}
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <p className="text-xs text-casino-muted">Fiat wallets coming soon.</p>
              </div>
            )}

            <div className="border-t border-casino-border px-3 py-2.5">
              <button
                type="button"
                onClick={toggleHideZero}
                className="flex w-full items-center gap-3 text-left"
              >
                <span
                  className={`relative flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                    hideZero ? 'bg-casino-primary' : 'bg-casino-border'
                  }`}
                >
                  <span
                    className={`absolute size-3.5 rounded-full bg-white shadow-sm transition-transform ${
                      hideZero ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </span>
                <div>
                  <p className="text-xs font-medium text-casino-foreground">Hide zero balances</p>
                  <p className="text-[10px] leading-tight text-casino-muted">
                    Your zero balances won't appear in your wallet
                  </p>
                </div>
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

export default HeaderWalletBar
