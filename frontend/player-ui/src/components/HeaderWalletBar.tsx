import { useCallback, useEffect, useRef, useState, type FC } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { usePlayerAuth } from '../playerAuth'
import { useAuthModal } from '../authModalContext'
import { useCryptoLogoUrlMap } from '../lib/cryptoLogoUrls'
import { IconBanknote, IconChevronDown, IconSearch } from './icons'
import type { WalletMainTab } from './WalletFlowModal'
import type { DepositAssetSymbol, DepositNetworkId } from './DepositFlowShared'
import { NETWORK_CHAIN_LOGO } from './DepositFlowShared'
import {
  PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT,
  PLAYER_CHROME_CLOSE_REWARDS_EVENT,
  PLAYER_CHROME_CLOSE_WALLET_EVENT,
} from '../lib/playerChromeEvents'

type HeaderWalletBarProps = {
  onOpenWallet: (tab: WalletMainTab) => void
  /** Wallet modal showing Deposit tab — highlights header Deposit (tablet/iPad). */
  depositFlowActive?: boolean
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
  size?: 'xs' | 'sm' | 'md'
}) {
  const dim = size === 'md' ? 'size-8' : size === 'xs' ? 'size-4' : 'size-5 max-md:size-4'
  const textSize = size === 'md' ? 'text-[10px]' : size === 'xs' ? 'text-[6px]' : 'text-[7px] max-md:text-[6px]'
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

const HeaderWalletBar: FC<HeaderWalletBarProps> = ({ onOpenWallet, depositFlowActive = false }) => {
  const { pathname } = useLocation()
  const onDepositRoute = pathname.startsWith('/wallet/deposit')
  const depositNavActive = onDepositRoute || depositFlowActive
  const { isAuthenticated, balanceMinor, balanceBreakdown } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const logoUrls = useCryptoLogoUrlMap()
  const [active, setActive] = useState<WalletOption>(loadSavedWallet)
  const [open, setOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** Below lg: viewport-centered panel; lg+: right-anchored to the wallet chip (classic desktop). */
  const [panelPos, setPanelPos] = useState<
    | { top: number; mobileCentered: true }
    | { top: number; right: number }
    | null
  >(null)
  const [barRect, setBarRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  const [search, setSearch] = useState('')
  const [panelTab, setPanelTab] = useState<PanelTab>('crypto')
  const [assetFilter, setAssetFilter] = useState<DepositAssetSymbol>('ETH')
  const [hideZero, setHideZero] = useState(() => localStorage.getItem(HIDE_ZERO_KEY) === '1')

  const recalcPos = useCallback(() => {
    if (!barRef.current) return
    const r = barRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const gutter = 12
    const belowLg = vw < 1024

    setBarRect({ top: r.top, left: r.left, width: r.width, height: r.height })

    if (belowLg) {
      setPanelPos({ top: r.bottom + 8, mobileCentered: true })
      return
    }

    const isWide = vw >= 640
    const panelW = Math.min(isWide ? 340 : 320, vw - 2 * gutter)
    let right = Math.max(gutter, vw - r.right)
    if (vw - right - panelW < gutter) {
      right = Math.max(gutter, vw - panelW - gutter)
    }
    setPanelPos({ top: r.bottom + 6, right })
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

  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener(PLAYER_CHROME_CLOSE_WALLET_EVENT, close)
    return () => window.removeEventListener(PLAYER_CHROME_CLOSE_WALLET_EVENT, close)
  }, [])

  useEffect(() => {
    if (open) {
      window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_REWARDS_EVENT))
      window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT))
    }
  }, [open])

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
    if (!isAuthenticated) {
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

  /** Overall wallet balance $0.00 (minor units) — show perimeter pulse on every breakpoint. */
  const showZeroBalanceAlert = isAuthenticated && balanceMinor !== null && balanceMinor === 0

  const chipInnerClosed =
    'relative z-[1] inline-flex min-h-8 w-max max-w-full shrink-0 items-center overflow-hidden rounded-xl border border-white/[0.06] bg-casino-surface py-0.5 pl-1 pr-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-black/25 md:min-h-[36px] md:rounded-none md:border-0 md:bg-transparent md:py-0 md:pl-1 md:pr-2 md:shadow-none md:ring-0 max-[1279px]:md:min-h-[34px] max-[1279px]:md:pl-1 min-[1280px]:md:min-h-[40px] min-[1280px]:md:pl-0'

  const chipInnerFloating =
    'relative z-[1] inline-flex min-h-8 w-max max-w-full shrink-0 items-center overflow-hidden rounded-xl border border-white/[0.06] bg-casino-surface py-0.5 pl-1 pr-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-black/25 md:min-h-[36px] md:rounded-none md:border-0 md:bg-[#1A1A1A] md:py-0 md:pl-1 md:pr-2 md:shadow-none md:ring-0 max-[1279px]:md:min-h-[34px] max-[1279px]:md:pl-1 min-[1280px]:md:min-h-[40px] min-[1280px]:md:pl-0'

  /** Balance + asset picker — width hugs content (no full-column stretch). */
  const walletBarCore = (
    <div className="inline-flex min-h-8 w-max max-w-full items-center gap-1 md:min-h-9 md:gap-1 min-[1280px]:md:gap-1.5 min-[1280px]:gap-2">
      <div className="flex min-w-0 flex-col items-start leading-tight">
        <span className="truncate text-[10px] font-semibold tabular-nums text-white max-[1279px]:md:text-[10px] md:text-xs min-[1280px]:text-sm">
          {formatBalance(isAuthenticated ? balanceMinor : 0)}
        </span>
        {isAuthenticated && balanceBreakdown && balanceBreakdown.bonusLockedMinor > 0 ? (
          <span className="max-w-full truncate text-[8px] tabular-nums text-white/45 md:text-[9px] lg:text-[10px]">
            Bonus {formatBalance(balanceBreakdown.bonusLockedMinor)}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={!isAuthenticated}
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-7 max-w-[100vw] shrink-0 items-center gap-0.5 rounded-lg px-1 text-[10px] font-semibold text-white transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50 md:h-7 md:gap-1 md:px-1 md:text-[11px] max-[1279px]:md:h-7 min-[1280px]:md:h-8 min-[1280px]:md:gap-1.5 min-[1280px]:md:px-1.5 min-[1280px]:md:text-xs"
      >
        <ChainLogo wallet={active} logoUrl={logoUrls[chainLogoSlug]} />
        <span className="font-bold text-white md:inline">{active.symbol}</span>
        <span className="hidden text-casino-muted min-[1280px]:inline">·</span>
        <span className="hidden text-xs font-medium text-casino-muted min-[1280px]:inline">{active.network}</span>
        <IconChevronDown
          className={`size-3 shrink-0 text-white/50 transition md:size-3.5 md:text-white/45 ${open ? 'rotate-180' : ''}`}
          size={14}
          aria-hidden
        />
      </button>
    </div>
  )

  const depositButton = (
    <button
      type="button"
      onClick={onDeposit}
      title="Deposit"
      aria-label="Deposit"
      aria-current={depositNavActive ? 'page' : undefined}
      className={`inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[10px] px-3 py-2 text-center text-[11px] font-bold leading-none text-white transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 md:mx-0.5 md:mb-0.5 md:mt-0.5 md:w-auto md:rounded-xl md:px-3 md:py-2 md:text-xs md:font-bold md:shadow-none max-[1279px]:md:px-2.5 max-[1279px]:md:py-1.5 min-[1280px]:md:px-4 min-[1280px]:md:py-2 min-[1280px]:md:text-sm bg-casino-primary md:bg-[#9b6cff] max-[1000px]:min-[768px]:md:aspect-square max-[1000px]:min-[768px]:md:min-h-0 max-[1000px]:min-[768px]:md:w-8 max-[1000px]:min-[768px]:md:min-w-8 max-[1000px]:min-[768px]:md:px-0 max-[1000px]:min-[768px]:md:py-0 ${
        depositNavActive
          ? 'ring-2 ring-casino-primary/55 shadow-[0_0_12px_rgba(123,97,255,0.38)] md:ring-white/25 min-[1280px]:shadow-[0_0_6px_rgba(123,97,255,0.22)]'
          : ''
      }`}
    >
      <IconBanknote size={15} className="hidden shrink-0 max-[1000px]:min-[768px]:md:inline min-[1001px]:md:hidden" aria-hidden />
      <span className="max-[1000px]:min-[768px]:md:sr-only min-[1001px]:md:inline">Deposit</span>
    </button>
  )

  return (
    <div className="pointer-events-auto relative inline-flex min-w-0 w-full max-w-full flex-col items-center justify-center gap-1.5 max-[1279px]:min-w-0 max-[1279px]:max-w-full max-[1279px]:md:max-w-[min(100%,calc(100vw-15.5rem))] md:flex-row md:items-center md:justify-start md:gap-0 md:rounded-full md:border md:border-white/[0.08] md:bg-[#1A1A1A] md:p-0.5 md:pl-2 md:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] max-[1279px]:md:w-max max-[1279px]:md:p-0.5 max-[1279px]:md:pl-1 min-[1280px]:w-max min-[1280px]:max-w-[min(28rem,calc(100vw-15rem))] min-[1280px]:justify-start min-[1280px]:p-1 min-[1280px]:pl-3">
      {showZeroBalanceAlert ? (
        <div
          ref={barRef}
          className="relative inline-flex shrink-0 overflow-hidden rounded-xl p-[2px] wallet-chip-zero-ring"
        >
          <span className="wallet-chip-zero-ring__beam pointer-events-none" aria-hidden />
          <div className={chipInnerClosed}>{walletBarCore}</div>
        </div>
      ) : (
        <div ref={barRef} className={chipInnerClosed}>
          {walletBarCore}
        </div>
      )}

      <div
        className="hidden h-7 w-px shrink-0 bg-white/[0.12] max-[1279px]:md:h-6 min-[1280px]:md:h-8 md:block"
        aria-hidden
      />

      {/* Deposit: bottom nav below `md`; header shows Deposit from tablet / iPad landscape up. */}
      <div className="hidden w-full shrink-0 md:flex md:w-auto md:items-center md:justify-start">
        {depositButton}
      </div>

      {open && panelPos && createPortal(
        <>
          {/*
            Mobile (<768): blur fills content band under header + safe areas down to bottom nav (4rem + safe).
            Tablet (768–1023): full-width dim below tablet header; bottom flush (no bottom nav in shell).
            Desktop (lg+): full viewport dim.
          */}
          <div
            className="fixed z-[199] bg-black/40 backdrop-blur-sm max-[767px]:left-0 max-[767px]:right-0 max-[767px]:top-[calc(64px+env(safe-area-inset-top,0px))] max-[767px]:bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] min-[768px]:max-[1279px]:left-0 min-[768px]:max-[1279px]:right-0 min-[768px]:max-[1279px]:bottom-0 min-[768px]:max-[1279px]:top-[calc(var(--casino-header-h-tablet)+env(safe-area-inset-top,0px))] min-[1280px]:inset-0"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Floating wallet chip — matches barRef (balance + picker only); above header chrome (z-[210]) */}
          {barRect && (
            <div
              style={{ position: 'fixed', top: barRect.top, left: barRect.left, width: barRect.width, height: barRect.height, zIndex: 218 }}
              className={
                showZeroBalanceAlert
                  ? 'relative inline-flex shrink-0 overflow-hidden rounded-xl p-[2px] wallet-chip-zero-ring'
                  : chipInnerFloating
              }
            >
              {showZeroBalanceAlert ? (
                <>
                  <span className="wallet-chip-zero-ring__beam pointer-events-none" aria-hidden />
                  <div className={chipInnerFloating}>{walletBarCore}</div>
                </>
              ) : (
                walletBarCore
              )}
            </div>
          )}

          {/* Dropdown panel */}
          <div
            ref={panelRef}
            style={
              'mobileCentered' in panelPos
                ? { top: panelPos.top, left: '50%', transform: 'translateX(-50%)' }
                : { top: panelPos.top, right: panelPos.right }
            }
            className={`fixed z-[219] overflow-y-auto overflow-x-hidden rounded-xl border border-casino-border bg-casino-bg shadow-2xl max-lg:max-h-[min(70vh,calc(100dvh-8rem))] ${
              'mobileCentered' in panelPos
                ? 'w-[min(21.25rem,calc(100vw-1.5rem))]'
                : 'lg:w-[min(21.25rem,calc(100vw-1rem))]'
            }`}
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
