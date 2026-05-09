import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { usePlayerAuth } from '../playerAuth'
import { useAuthModal } from '../authModalContext'
import { useCryptoLogoUrlMap, passimpayNetworkToLogoSlug, resolveCryptoLogoUrl } from '../lib/cryptoLogoUrls'
import { usePassimpayCurrencies } from '../hooks/usePassimpayCurrencies'
import { formatCryptoQuantityUpToFourDecimals, isUsdDollarPrefixedSymbol, passimpayNetworkLabel, passimpayWalletChainSectionMeta, type PassimpayCurrency } from '../lib/paymentCurrencies'
import { IconBanknote, IconChevronDown, IconSearch } from './icons'
import type { WalletMainTab } from './WalletFlowModal'
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

/** Playable bonus lines — USD cents, always 2 decimals; leading $ when `prefixDollar`. */
function formatPlayableBalanceMinor(minor: number | null, prefixDollar: boolean): string {
  if (minor == null) return prefixDollar ? '$0.00' : '0.00'
  const s = (minor / 100).toFixed(2)
  return prefixDollar ? `$${s}` : s
}

/**
 * Header + token grid amounts (USD-cent minor from API).
 * - USD mode on: `$` + 2 dp.
 * - USD mode off: up to 4 dp (trimmed); `$` only for USD-pegged symbols.
 */
function formatWalletChipAmount(minor: number | null, showBalancesUsd: boolean, symbol: string): string {
  const dollarPrefix = showBalancesUsd || isUsdDollarPrefixedSymbol(symbol)
  const v = minor == null || !Number.isFinite(minor) ? 0 : minor / 100
  if (showBalancesUsd) {
    return `$${v.toFixed(2)}`
  }
  const qty = formatCryptoQuantityUpToFourDecimals(v)
  return dollarPrefix ? `$${qty}` : qty
}

type WalletOption = {
  /** PassimPay `payment_id`; `0` on legacy placeholder rows (logged out / preload). */
  paymentId: number
  symbol: string
  network: string
  chainTitle: string
  accent: string
  glyph: string
}

/** Shown when logged out, still loading, or API returned no deposit rails. */
const LEGACY_WALLET_OPTIONS: WalletOption[] = [
  { paymentId: 0, symbol: 'ETH', network: 'ERC20', chainTitle: 'Ethereum', accent: 'bg-[#627EEA]', glyph: 'Ξ' },
  { paymentId: 0, symbol: 'USDT', network: 'ERC20', chainTitle: 'Ethereum', accent: 'bg-[#627EEA]', glyph: 'Ξ' },
  { paymentId: 0, symbol: 'USDT', network: 'TRC20', chainTitle: 'Tron', accent: 'bg-[#EB0029]', glyph: 'T' },
  { paymentId: 0, symbol: 'USDT', network: 'BEP20', chainTitle: 'BSC', accent: 'bg-[#F0B90B]', glyph: 'B' },
  { paymentId: 0, symbol: 'USDC', network: 'ERC20', chainTitle: 'Ethereum', accent: 'bg-[#627EEA]', glyph: 'Ξ' },
  { paymentId: 0, symbol: 'TRX', network: 'TRC20', chainTitle: 'Tron', accent: 'bg-[#EB0029]', glyph: 'T' },
]

const PERSIST_KEY = 'player_active_wallet'
const HIDE_ZERO_KEY = 'player_hide_zero_bal'
/** When on, header + wallet grid use a leading $ (USD account). Off uses per-token style (e.g. no $ on ETH). */
const SHOW_BALANCES_USD_KEY = 'player_wallet_show_balances_usd'
const WALLET_TOKEN_GRID_INITIAL = 12

/** Space to leave under the dropdown so it does not sit under the mobile bottom nav (hidden → small gap only). */
function walletDropdownBottomReservePx(): number {
  if (typeof document === 'undefined') return 12
  try {
    const nav = document.querySelector('.casino-shell-mobile-nav') as HTMLElement | null
    if (!nav) return 12
    const cs = getComputedStyle(nav)
    if (cs.display === 'none' || cs.visibility === 'hidden') return 12
    const br = nav.getBoundingClientRect()
    if (br.height <= 0) return 12
    return Math.round(br.height + 10)
  } catch {
    return 12
  }
}

function chainAccentGlyphFromGroupId(groupId: string): { accent: string; glyph: string } {
  const g = groupId.toLowerCase()
  if (g === 'tron') return { accent: 'bg-[#EB0029]', glyph: 'T' }
  if (g === 'bsc') return { accent: 'bg-[#F0B90B]', glyph: 'B' }
  if (g === 'solana') return { accent: 'bg-[#9945FF]', glyph: 'S' }
  if (g === 'polygon') return { accent: 'bg-[#8247E5]', glyph: 'P' }
  if (g === 'arbitrum') return { accent: 'bg-[#28A0F0]', glyph: 'A' }
  if (g === 'optimism') return { accent: 'bg-[#FF0420]', glyph: 'O' }
  if (g === 'base') return { accent: 'bg-[#0052FF]', glyph: 'B' }
  if (g === 'avalanche') return { accent: 'bg-[#E84142]', glyph: 'A' }
  if (g === 'ton') return { accent: 'bg-[#0098EA]', glyph: 'T' }
  if (g === 'dash') return { accent: 'bg-[#008DE4]', glyph: 'D' }
  if (g.startsWith('chain-')) return { accent: 'bg-zinc-600', glyph: '#' }
  return { accent: 'bg-[#627EEA]', glyph: 'Ξ' }
}

function passimpayCurrencyToWalletOption(c: PassimpayCurrency): WalletOption {
  const meta = passimpayWalletChainSectionMeta(c.network)
  const { accent, glyph } = chainAccentGlyphFromGroupId(meta.groupId)
  return {
    paymentId: c.payment_id,
    symbol: c.symbol.trim().toUpperCase(),
    network: c.network.trim(),
    chainTitle: meta.heading,
    accent,
    glyph,
  }
}

function sortWalletRails(rails: WalletOption[]): WalletOption[] {
  return [...rails].sort((a, b) => {
    const sym = a.symbol.localeCompare(b.symbol, undefined, { sensitivity: 'base' })
    if (sym !== 0) return sym
    const sa = passimpayWalletChainSectionMeta(a.network).sortKey
    const sb = passimpayWalletChainSectionMeta(b.network).sortKey
    if (sa !== sb) return sa - sb
    return a.network.localeCompare(b.network, undefined, { sensitivity: 'base' })
  })
}

type ChainPickerRow = {
  groupId: string
  sortKey: number
  heading: string
  accent: string
  glyph: string
  /** Representative `network` from API for chain logo resolution. */
  sampleNetwork: string
}

function buildChainPickerRows(rails: WalletOption[]): ChainPickerRow[] {
  const map = new Map<string, ChainPickerRow>()
  for (const w of rails) {
    const meta = passimpayWalletChainSectionMeta(w.network)
    const existing = map.get(meta.groupId)
    if (!existing) {
      const { accent, glyph } = chainAccentGlyphFromGroupId(meta.groupId)
      map.set(meta.groupId, {
        groupId: meta.groupId,
        sortKey: meta.sortKey,
        heading: meta.heading,
        accent,
        glyph,
        sampleNetwork: w.network,
      })
    } else if (meta.sortKey < existing.sortKey) {
      existing.sortKey = meta.sortKey
      existing.sampleNetwork = w.network
    }
  }
  return [...map.values()].sort((a, b) =>
    a.sortKey !== b.sortKey ? a.sortKey - b.sortKey : a.heading.localeCompare(b.heading, undefined, { sensitivity: 'base' }),
  )
}

function chainRowWalletStub(row: ChainPickerRow): WalletOption {
  return {
    paymentId: 0,
    symbol: '',
    network: row.sampleNetwork,
    chainTitle: row.heading,
    accent: row.accent,
    glyph: row.glyph,
  }
}

type PersistedWallet = { payment_id?: number; symbol?: string; network?: string }

function matchSavedWallet(rails: WalletOption[]): WalletOption | null {
  if (rails.length === 0) return null
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedWallet
    if (typeof parsed.payment_id === 'number' && parsed.payment_id > 0) {
      const byId = rails.find((r) => r.paymentId === parsed.payment_id)
      if (byId) return byId
    }
    if (parsed.symbol && parsed.network) {
      const sym = parsed.symbol.trim().toUpperCase()
      const net = parsed.network.trim()
      const found = rails.find((r) => r.symbol === sym && r.network === net)
      if (found) return found
    }
  } catch {
    // ignore
  }
  return null
}

function initialActiveWallet(): WalletOption {
  return matchSavedWallet(LEGACY_WALLET_OPTIONS) ?? LEGACY_WALLET_OPTIONS[0]!
}

/** Same rail — uses `payment_id` when both sides are from PassimPay, else symbol + network (legacy rows use `paymentId` 0). */
function walletOptionsMatch(a: WalletOption, b: WalletOption): boolean {
  if (a.paymentId > 0 && b.paymentId > 0) return a.paymentId === b.paymentId
  return a.symbol === b.symbol && a.network === b.network
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
  symbol: string
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
  const bgMap: Record<string, string> = { ETH: 'bg-[#627EEA]', USDT: 'bg-[#26A17B]', USDC: 'bg-[#2775CA]', TRX: 'bg-[#EB0029]', BTC: 'bg-[#F7931A]', SOL: 'bg-[#9945FF]', TON: 'bg-[#0098EA]' }
  const charMap: Record<string, string> = { ETH: 'Ξ', USDT: '₮', USDC: '$', TRX: 'T', BTC: '₿', SOL: 'S', TON: 'T' }
  const sym = symbol.toUpperCase()
  const bg = bgMap[sym] ?? 'bg-[#627EEA]'
  const char = charMap[sym] ?? sym[0] ?? '?'
  return (
    <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${bg}`} aria-hidden>
      {char}
    </span>
  )
}

const HeaderWalletBar: FC<HeaderWalletBarProps> = ({ onOpenWallet, depositFlowActive = false }) => {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const onDepositRoute = pathname.startsWith('/wallet/deposit')
  const depositNavActive = onDepositRoute || depositFlowActive
  const { isAuthenticated, balanceMinor, balanceBreakdown, playableBalanceCurrency } = usePlayerAuth()
  const { openAuth } = useAuthModal()
  const { currencies } = usePassimpayCurrencies(isAuthenticated)
  const extraLogoSymbols = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const c of currencies) {
      if (!c.deposit_enabled) continue
      for (const raw of [c.symbol, c.network]) {
        const u = raw.trim()
        if (!u || seen.has(u)) continue
        seen.add(u)
        out.push(u)
      }
      const chainSlug = passimpayNetworkToLogoSlug(c.network.trim())
      if (chainSlug && !seen.has(chainSlug)) {
        seen.add(chainSlug)
        out.push(chainSlug)
      }
    }
    return out
  }, [currencies])
  const logoUrls = useCryptoLogoUrlMap(extraLogoSymbols)

  const apiRails = useMemo(() => {
    const rows = currencies.filter((c) => c.deposit_enabled).map(passimpayCurrencyToWalletOption)
    return sortWalletRails(rows)
  }, [currencies])

  const effectiveRails = apiRails.length > 0 ? apiRails : LEGACY_WALLET_OPTIONS
  const chainRows = useMemo(() => buildChainPickerRows(effectiveRails), [effectiveRails])

  const [active, setActive] = useState<WalletOption>(initialActiveWallet)
  const [open, setOpen] = useState(false)
  const barRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** Viewport <1280: centered dropdown. ≥1280 (desktop shell): position under wallet pill. */
  const [panelPos, setPanelPos] = useState<
    | { top: number; mobileCentered: true }
    | { top: number; left: number }
    | null
  >(null)
  const [panelMaxHeightPx, setPanelMaxHeightPx] = useState(() =>
    typeof window !== 'undefined' ? Math.round(Math.min(window.innerHeight * 0.85, 720)) : 560,
  )
  const [barRect, setBarRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  const [search, setSearch] = useState('')
  const [selectedChainGroupId, setSelectedChainGroupId] = useState(
    () => passimpayWalletChainSectionMeta(initialActiveWallet().network).groupId,
  )
  const [hideZero, setHideZero] = useState(() => localStorage.getItem(HIDE_ZERO_KEY) === '1')
  const [showBalancesUsd, setShowBalancesUsd] = useState(() => localStorage.getItem(SHOW_BALANCES_USD_KEY) !== '0')
  const [tokenListExpanded, setTokenListExpanded] = useState(false)

  useEffect(() => {
    if (effectiveRails.length === 0) return
    const saved = matchSavedWallet(effectiveRails)
    setActive((prev) => {
      if (prev) {
        if (prev.paymentId > 0) {
          const byId = effectiveRails.find((r) => r.paymentId === prev.paymentId)
          if (byId) return byId
        }
        const bySymNet = effectiveRails.find((r) => walletOptionsMatch(r, prev))
        if (bySymNet) return bySymNet
      }
      return saved ?? effectiveRails[0]!
    })
  }, [effectiveRails])

  const recalcPos = useCallback(() => {
    if (!barRef.current) return
    const r = barRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const gutter = 12
    /** Match `casino-shell.css`: tablet/mobile headers &lt;1280; desktop sidebar + header ≥1280. */
    const useViewportCenteredPanel = vw < 1280

    setBarRect({ top: r.top, left: r.left, width: r.width, height: r.height })

    const vh = window.innerHeight
    const panelTopGap = useViewportCenteredPanel ? 8 : 6
    const panelTopPx = r.bottom + panelTopGap
    const bottomReserve = walletDropdownBottomReservePx()
    setPanelMaxHeightPx(Math.max(220, Math.min(vh * 0.85, vh - panelTopPx - bottomReserve)))

    if (useViewportCenteredPanel) {
      setPanelPos({ top: panelTopPx, mobileCentered: true })
      return
    }

    /** Desktop shell (≥1280): align under wallet pill — 50% viewport center is wrong with fixed sidebar. */
    const panelW = Math.min(512, vw - 2 * gutter)
    const cx = r.left + r.width / 2
    let left = cx - panelW / 2
    left = Math.max(gutter, Math.min(left, vw - panelW - gutter))
    setPanelPos({ top: panelTopPx, left })
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
      setSelectedChainGroupId(passimpayWalletChainSectionMeta(active.network).groupId)
    }
  }, [open, active.network])

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
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ payment_id: w.paymentId, symbol: w.symbol, network: w.network }),
    )
  }

  const toggleHideZero = () => {
    setHideZero((v) => {
      const next = !v
      localStorage.setItem(HIDE_ZERO_KEY, next ? '1' : '0')
      return next
    })
  }

  const toggleShowBalancesUsd = () => {
    setShowBalancesUsd((v) => {
      const next = !v
      localStorage.setItem(SHOW_BALANCES_USD_KEY, next ? '1' : '0')
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

  const activeTokenLogoUrl = resolveCryptoLogoUrl(logoUrls, active.symbol, active.network)
  const activeChainLogoUrl = resolveCryptoLogoUrl(logoUrls, '', active.network)
  const activeChipLogoUrl = activeTokenLogoUrl ?? activeChainLogoUrl

  const q = search.trim().toLowerCase()

  const chainRowsFiltered = useMemo(() => {
    if (!q) return chainRows
    return chainRows.filter((row) => {
      if (row.heading.toLowerCase().includes(q)) return true
      if (row.groupId.toLowerCase().includes(q)) return true
      return effectiveRails.some((w) => {
        if (passimpayWalletChainSectionMeta(w.network).groupId !== row.groupId) return false
        return (
          w.symbol.toLowerCase().includes(q) ||
          w.network.toLowerCase().includes(q) ||
          passimpayNetworkLabel(w.network).toLowerCase().includes(q)
        )
      })
    })
  }, [chainRows, effectiveRails, q])

  const effectiveSelectedGroupId = useMemo(() => {
    if (chainRowsFiltered.length === 0) return ''
    if (chainRowsFiltered.some((c) => c.groupId === selectedChainGroupId)) return selectedChainGroupId
    return chainRowsFiltered[0]!.groupId
  }, [chainRowsFiltered, selectedChainGroupId])

  useEffect(() => {
    setTokenListExpanded(false)
  }, [open, effectiveSelectedGroupId, search])

  const tokenRailsForChain = useMemo(() => {
    const gid = effectiveSelectedGroupId
    if (!gid) return []
    return effectiveRails.filter((w) => {
      if (passimpayWalletChainSectionMeta(w.network).groupId !== gid) return false
      if (hideZero) {
        const isActiveRow = walletOptionsMatch(w, active)
        if (!isActiveRow && (balanceMinor == null || balanceMinor === 0)) return false
      }
      if (
        q &&
        !w.symbol.toLowerCase().includes(q) &&
        !w.network.toLowerCase().includes(q) &&
        !passimpayNetworkLabel(w.network).toLowerCase().includes(q) &&
        !w.chainTitle.toLowerCase().includes(q)
      ) {
        return false
      }
      return true
    })
  }, [effectiveRails, effectiveSelectedGroupId, hideZero, active, balanceMinor, q])

  const tokenSymbolDupCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of tokenRailsForChain) {
      m.set(w.symbol, (m.get(w.symbol) ?? 0) + 1)
    }
    return m
  }, [tokenRailsForChain])

  const sortedTokenRailsForChain = useMemo(() => {
    const list = [...tokenRailsForChain]
    const rowBalMinor = (w: WalletOption) =>
      walletOptionsMatch(w, active) ? (balanceMinor ?? 0) : 0
    const isRowActive = (w: WalletOption) => walletOptionsMatch(w, active)
    list.sort((a, b) => {
      const balDiff = rowBalMinor(b) - rowBalMinor(a)
      if (balDiff !== 0) return balDiff
      const activeDiff = (isRowActive(b) ? 1 : 0) - (isRowActive(a) ? 1 : 0)
      if (activeDiff !== 0) return activeDiff
      const sy = a.symbol.localeCompare(b.symbol, undefined, { sensitivity: 'base' })
      if (sy !== 0) return sy
      return a.network.localeCompare(b.network, undefined, { sensitivity: 'base' })
    })
    return list
  }, [tokenRailsForChain, active, balanceMinor])

  const tokenGridOverflow = sortedTokenRailsForChain.length > WALLET_TOKEN_GRID_INITIAL
  const displayedTokenRails = useMemo(() => {
    if (!tokenGridOverflow || tokenListExpanded) return sortedTokenRailsForChain
    return sortedTokenRailsForChain.slice(0, WALLET_TOKEN_GRID_INITIAL)
  }, [sortedTokenRailsForChain, tokenGridOverflow, tokenListExpanded])

  /** Overall wallet balance $0.00 (minor units) — show perimeter pulse on every breakpoint. */
  const showZeroBalanceAlert = isAuthenticated && balanceMinor !== null && balanceMinor === 0

  const balanceDisplaySymbol =
    isAuthenticated && playableBalanceCurrency ? playableBalanceCurrency : active.symbol

  /** Left tray: compact on desktop; tablet can still grow in centered header slot. */
  const chipInnerClosed =
    'relative z-[1] flex min-h-8 min-w-0 w-auto max-w-full flex-1 items-center overflow-hidden rounded-xl border border-white/[0.06] bg-casino-surface py-0.5 pl-1 pr-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-black/25 md:min-h-9 md:self-stretch md:w-auto md:rounded-none md:border-0 md:bg-transparent md:py-1.5 md:pl-1 md:pr-2 md:shadow-none md:ring-0 max-[1279px]:md:min-h-9 max-[1279px]:md:flex-1 max-[1279px]:md:py-1.5 max-[1279px]:md:pl-1 max-[1279px]:md:pr-2 min-[1280px]:md:min-h-9 min-[1280px]:md:w-auto min-[1280px]:max-w-[min(11.5rem,calc(100vw-14rem))] min-[1280px]:md:flex-none min-[1280px]:md:shrink min-[1280px]:md:py-1.5 min-[1280px]:md:pl-1.5 min-[1280px]:md:pr-1.5'

  /** Balance + asset picker — grows/shrinks inside `chipInnerClosed`; balance line truncates. */
  const walletBarCore = (
    <div className="flex min-h-8 min-w-0 flex-1 items-center gap-1 md:min-h-9 md:gap-1 max-[1279px]:md:flex-1 min-[1280px]:md:flex-none min-[1280px]:md:gap-1">
      <div className="flex min-w-0 flex-col items-start leading-tight">
        <span className="truncate text-[10px] font-semibold tabular-nums text-white max-[1279px]:md:text-[10px] md:text-xs min-[1280px]:text-xs">
          {formatWalletChipAmount(isAuthenticated ? balanceMinor : 0, showBalancesUsd, balanceDisplaySymbol)}
        </span>
        {isAuthenticated && balanceBreakdown && balanceBreakdown.bonusLockedMinor > 0 ? (
          <span className="max-w-full truncate text-[8px] tabular-nums text-white/45 md:text-[9px] lg:text-[10px]">
            Bonus{' '}
            {formatPlayableBalanceMinor(
              balanceBreakdown.bonusLockedMinor,
              showBalancesUsd || isUsdDollarPrefixedSymbol(balanceDisplaySymbol),
            )}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        disabled={!isAuthenticated}
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-7 max-w-[100vw] shrink-0 items-center gap-0.5 rounded-lg px-1 text-[10px] font-semibold text-white transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50 md:h-7 md:gap-0.5 md:px-1 md:text-[11px] max-[1279px]:md:h-7 min-[1280px]:md:h-7 min-[1280px]:md:gap-1 min-[1280px]:md:px-1 min-[1280px]:md:text-xs"
      >
        <ChainLogo wallet={active} logoUrl={activeChipLogoUrl} />
        <span className="font-bold text-white md:inline">{active.symbol}</span>
        <span className="hidden text-casino-muted min-[1280px]:inline">·</span>
        <span className="hidden max-w-[4.5rem] truncate text-xs font-medium text-casino-muted min-[1280px]:inline">
          {passimpayNetworkLabel(active.network)}
        </span>
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
      title={t('header.deposit')}
      aria-label={t('header.depositAriaLabel')}
      aria-current={depositNavActive ? 'page' : undefined}
      className={`inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[10px] px-3 py-2 text-center text-[11px] font-bold leading-tight text-white antialiased transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 md:h-full md:min-h-0 md:w-auto md:min-w-0 md:rounded-l-none md:rounded-r-full md:border-0 md:px-2 md:py-0 md:text-xs md:font-bold md:leading-tight md:shadow-none max-[1279px]:md:px-2.5 max-[1000px]:min-[768px]:md:w-8 max-[1000px]:min-[768px]:md:min-w-8 max-[1000px]:min-[768px]:md:max-w-8 max-[1000px]:min-[768px]:md:px-0 min-[1280px]:md:w-max min-[1280px]:md:px-2 min-[1280px]:md:py-0 min-[1280px]:md:text-xs bg-casino-primary md:bg-[#9b6cff] max-[1000px]:min-[768px]:md:justify-center ${
        depositNavActive
          ? 'ring-2 ring-casino-primary/55 shadow-[0_0_12px_rgba(123,97,255,0.38)] md:ring-0 md:shadow-none md:brightness-[1.05]'
          : ''
      }`}
    >
      <IconBanknote size={15} className="hidden shrink-0 max-[1000px]:min-[768px]:md:inline min-[1001px]:md:hidden" aria-hidden />
      <span className="max-[1000px]:min-[768px]:md:sr-only min-[1001px]:md:inline">{t('header.deposit')}</span>
    </button>
  )

  const walletDivider = (
    <div
      className="hidden w-px shrink-0 self-stretch bg-white/[0.12] md:block md:min-h-0"
      aria-hidden
    />
  )

  const walletDepositWrap = (
    <div className="hidden shrink-0 md:flex md:h-auto md:min-h-0 md:w-auto md:items-stretch md:self-stretch md:overflow-hidden md:rounded-r-full">
      {depositButton}
    </div>
  )

  /** Full pill shell (balance tray + divider + deposit) — same chrome as the non-zero outer `md:` frame. */
  const walletPillInnerSurface =
    'relative z-[1] flex min-w-0 w-full max-w-full flex-col items-center justify-center gap-1.5 max-[1279px]:min-w-0 max-[1279px]:max-w-full max-[1279px]:md:max-w-[min(28rem,100%)] md:flex-row md:items-stretch md:justify-start md:gap-0 md:overflow-hidden md:rounded-full md:border md:border-white/[0.08] md:bg-[#1A1A1A] md:py-0 md:pl-1.5 md:pr-0 max-[1279px]:md:w-full max-[1279px]:md:min-w-0 max-[1279px]:md:pl-1 min-[1280px]:w-max min-[1280px]:max-w-[min(17rem,calc(100vw-14rem))] min-[1280px]:justify-start min-[1280px]:pl-1.5 min-[1280px]:pr-0'

  /** Outer frame for the full pill (used for layout measurement + floating clone when not in zero-balance ring). */
  const walletPillOuterFrame =
    'pointer-events-auto relative inline-flex min-w-0 w-full max-w-full flex-col items-center justify-center gap-1.5 max-[1279px]:min-w-0 max-[1279px]:max-w-full max-[1279px]:md:max-w-[min(28rem,100%)] md:flex-row md:items-stretch md:justify-start md:gap-0 md:overflow-hidden md:rounded-full md:border md:border-white/[0.08] md:bg-[#1A1A1A] md:py-0 md:pl-1.5 md:pr-0 max-[1279px]:md:w-full max-[1279px]:md:min-w-0 max-[1279px]:md:pl-1 min-[1280px]:w-max min-[1280px]:max-w-[min(17rem,calc(100vw-14rem))] min-[1280px]:justify-start min-[1280px]:pl-1.5 min-[1280px]:pr-0'

  return (
    <>
      {showZeroBalanceAlert ? (
        <div
          ref={barRef}
          className="pointer-events-auto relative inline-flex min-w-0 w-full max-w-full flex-col items-center justify-center overflow-hidden rounded-xl p-[2px] wallet-chip-zero-ring max-[1279px]:min-w-0 max-[1279px]:max-w-full max-[1279px]:md:max-w-[min(28rem,100%)] md:rounded-full max-[1279px]:md:w-full max-[1279px]:md:min-w-0 min-[1280px]:w-max min-[1280px]:max-w-[min(17rem,calc(100vw-14rem))]"
        >
          <span className="wallet-chip-zero-ring__beam pointer-events-none" aria-hidden />
          <div className={walletPillInnerSurface}>
            <div className={chipInnerClosed}>{walletBarCore}</div>
            {walletDivider}
            {walletDepositWrap}
          </div>
        </div>
      ) : (
        <div ref={barRef} className={walletPillOuterFrame}>
          <div className={chipInnerClosed}>{walletBarCore}</div>
          {walletDivider}
          {walletDepositWrap}
        </div>
      )}

      {open && panelPos && createPortal(
        <>
          {/*
            Mobile (<768): blur fills content band under header + safe areas down to bottom nav (4rem + safe).
            Tablet (768–1023): full-width dim below tablet header; bottom flush (no bottom nav in shell).
            Desktop (lg+): full viewport dim.
          */}
          <div
            className="fixed z-[199] bg-black/40 backdrop-blur-sm max-[767px]:left-0 max-[767px]:right-0 max-[767px]:top-[calc(64px+env(safe-area-inset-top,0px))] max-[767px]:bottom-[var(--casino-mobile-nav-offset)] min-[768px]:max-[1279px]:left-0 min-[768px]:max-[1279px]:right-0 min-[768px]:max-[1279px]:bottom-0 min-[768px]:max-[1279px]:top-[calc(var(--casino-header-h-tablet)+env(safe-area-inset-top,0px))] min-[1280px]:inset-0"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Floating clone — geometry matches `barRef` (full pill when $0 alert includes Deposit). */}
          {barRect && (
            <div
              style={{ position: 'fixed', top: barRect.top, left: barRect.left, width: barRect.width, height: barRect.height, zIndex: 218 }}
              className={
                showZeroBalanceAlert
                  ? 'relative box-border inline-flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl p-[2px] wallet-chip-zero-ring md:rounded-full'
                  : `${walletPillOuterFrame} box-border h-full min-h-0 w-full min-w-0 shrink-0`
              }
            >
              {showZeroBalanceAlert ? (
                <>
                  <span className="wallet-chip-zero-ring__beam pointer-events-none" aria-hidden />
                  <div className={`${walletPillInnerSurface} min-h-0 flex-1`}>
                    <div className={chipInnerClosed}>{walletBarCore}</div>
                    {walletDivider}
                    {walletDepositWrap}
                  </div>
                </>
              ) : (
                <>
                  <div className={chipInnerClosed}>{walletBarCore}</div>
                  {walletDivider}
                  {walletDepositWrap}
                </>
              )}
            </div>
          )}

          {/* Dropdown panel — flex column + scrollable middle so footer toggles stay on-screen */}
          <div
            ref={panelRef}
            style={{
              ...('mobileCentered' in panelPos
                ? { top: panelPos.top, left: '50%', transform: 'translateX(-50%)' }
                : { top: panelPos.top, left: panelPos.left, transform: 'none', right: 'auto' }),
              maxHeight: panelMaxHeightPx,
            }}
            className={`fixed z-[219] flex flex-col overflow-hidden rounded-xl border border-casino-border bg-casino-bg shadow-2xl ${
              'mobileCentered' in panelPos
                ? 'w-[min(24rem,calc(100vw-1.5rem))]'
                : 'w-[min(32rem,calc(100vw-2rem))]'
            }`}
          >
            <div className="relative shrink-0 px-3 pt-3">
              <IconSearch
                className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-casino-muted"
                size={14}
                aria-hidden
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('wallet.currencySelectSearchPlaceholder')}
                aria-label={t('wallet.currencySelectSearchAria')}
                className="w-full rounded-lg border border-casino-border bg-casino-surface py-2 pl-8 pr-3 text-xs text-casino-foreground outline-none placeholder:text-casino-muted focus:border-casino-primary"
                autoComplete="off"
                autoFocus
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain scrollbar-casino">
              <div className="p-3">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-casino-muted">
                  {t('wallet.networkSection')}
                </p>
              <div className="mb-3 grid grid-cols-4 gap-1.5 sm:grid-cols-5 lg:grid-cols-6">
                {chainRowsFiltered.length === 0 ? (
                  <p className="col-span-full py-2 text-center text-xs text-casino-muted">{t('wallet.assetNoMatch')}</p>
                ) : (
                  chainRowsFiltered.map((row) => {
                    const on = row.groupId === effectiveSelectedGroupId
                    const stub = chainRowWalletStub(row)
                    const chainLogoUrl = resolveCryptoLogoUrl(logoUrls, '', row.sampleNetwork)
                    return (
                      <button
                        key={row.groupId}
                        type="button"
                        title={row.heading}
                        onClick={() => setSelectedChainGroupId(row.groupId)}
                        className={`flex flex-col items-center justify-center gap-1 rounded-lg border bg-casino-surface px-1 py-2 text-center transition ${
                          on
                            ? 'border-casino-primary text-white ring-1 ring-casino-primary/30'
                            : 'border-casino-border text-casino-muted hover:border-white/12 hover:bg-casino-chip-hover hover:text-casino-foreground'
                        }`}
                      >
                        <ChainLogo wallet={stub} logoUrl={chainLogoUrl} />
                        <span
                          className={`line-clamp-2 w-full text-[10px] font-bold leading-tight ${on ? 'text-white' : 'text-casino-foreground'}`}
                        >
                          {row.heading}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>

              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-casino-muted">
                {t('wallet.tokenSection')}
              </p>

              <div className="grid grid-cols-2 gap-1.5 lg:grid-cols-3">
                {tokenRailsForChain.length === 0 ? (
                  <p className="col-span-full py-4 text-center text-xs text-casino-muted">
                    {t('wallet.assetNoMatch')}
                  </p>
                ) : (
                  displayedTokenRails.map((w) => {
                    const key = `${w.paymentId}-${w.symbol}-${w.network}`
                    const isActive = walletOptionsMatch(w, active)
                    const tokenLogo = resolveCryptoLogoUrl(logoUrls, w.symbol, w.network)
                    const bal = formatWalletChipAmount(
                      isActive ? balanceMinor : 0,
                      showBalancesUsd,
                      isActive ? balanceDisplaySymbol : w.symbol,
                    )
                    const showNetHint = (tokenSymbolDupCount.get(w.symbol) ?? 0) > 1
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => selectWallet(w)}
                        className={`flex w-full items-start gap-2 rounded-lg border border-casino-border bg-casino-surface p-2 text-left transition ${
                          isActive
                            ? 'border-casino-primary shadow-[0_0_0_1px_rgba(139,92,246,0.25)] ring-1 ring-casino-primary/25'
                            : 'hover:border-white/12 hover:bg-casino-chip-hover'
                        }`}
                      >
                        <AssetLogo symbol={w.symbol} logoUrl={tokenLogo} />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold leading-tight text-casino-foreground">{w.symbol}</div>
                          {showNetHint ? (
                            <div className="mt-0.5 truncate text-[10px] text-casino-muted">
                              {passimpayNetworkLabel(w.network)}
                              {w.network !== passimpayNetworkLabel(w.network) ? ` · ${w.network}` : ''}
                            </div>
                          ) : null}
                          <div className="mt-1.5 border-t border-casino-border pt-1.5">
                            <div className="flex items-center justify-between px-0.5">
                              <span className="text-[10px] text-casino-muted">{t('wallet.tokenBalanceLabel')}</span>
                              <span className="text-xs font-bold tabular-nums text-casino-foreground">{bal}</span>
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
              {tokenGridOverflow ? (
                <button
                  type="button"
                  onClick={() => setTokenListExpanded((v) => !v)}
                  className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-casino-border bg-casino-surface py-2 text-xs font-semibold text-casino-foreground transition hover:border-white/12 hover:bg-casino-chip-hover"
                >
                  <span>
                    {tokenListExpanded
                      ? t('wallet.tokensShowLess')
                      : t('wallet.tokensShowMore', {
                          count: sortedTokenRailsForChain.length - WALLET_TOKEN_GRID_INITIAL,
                        })}
                  </span>
                  <IconChevronDown
                    className={`size-3.5 shrink-0 text-casino-muted transition ${tokenListExpanded ? 'rotate-180' : ''}`}
                    size={14}
                    aria-hidden
                  />
                </button>
              ) : null}
              </div>
            </div>

            <div className="shrink-0 space-y-3 border-t border-casino-border bg-casino-bg px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5">
              <button
                type="button"
                onClick={toggleShowBalancesUsd}
                className="flex w-full items-center gap-3 text-left"
              >
                <span
                  className={`relative flex h-5 w-9 shrink-0 items-center rounded-full transition ${
                    showBalancesUsd ? 'bg-casino-primary' : 'bg-casino-border'
                  }`}
                >
                  <span
                    className={`absolute size-3.5 rounded-full bg-white shadow-sm transition-transform ${
                      showBalancesUsd ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-casino-foreground">{t('wallet.showBalancesUsd')}</p>
                </div>
              </button>
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
                <div className="min-w-0">
                  <p className="text-xs font-medium text-casino-foreground">{t('wallet.hideZeroBalances')}</p>
                  <p className="text-[10px] leading-tight text-casino-muted">{t('wallet.hideZeroBalancesHint')}</p>
                </div>
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

export default HeaderWalletBar
