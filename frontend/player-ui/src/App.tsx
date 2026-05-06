import { installPlayerCrossAppBridge } from '@repo/cross-app'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { PLAYER_MAIN_SCROLL_ID } from './lib/catalogReturn'
import {
  PLAYER_CHROME_CLOSE_CHAT_EVENT,
  PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT,
  PLAYER_CHROME_CLOSE_NOTIFICATIONS_EVENT,
  PLAYER_CHROME_CLOSE_REWARDS_EVENT,
  PLAYER_CHROME_CLOSE_WALLET_EVENT,
} from './lib/playerChromeEvents'
import { playerApiUrl } from './lib/playerApiUrl'
import { prefetchCryptoTickersOnce } from './lib/prefetchCryptoTickers'
import { useTrafficSessionTracker } from './hooks/useTrafficSessionTracker'
import { useRakebackBoostLiveToast } from './hooks/useRakebackBoostLiveToast'
import { useRewardsHub } from './hooks/useRewardsHub'
import { AuthModalProvider, useAuthModal, type PostAuthWalletTab } from './authModalContext'
import { AuthModal } from './components/AuthModal'
import ChatDrawer from './components/ChatDrawer'
import { InstallGlobalPlayerToasts } from './components/InstallGlobalPlayerToasts'
import { PlayerToaster } from './components/PlayerToaster'
import GameSearchOverlay from './components/GameSearchOverlay'
import CasinoSidebar from './components/CasinoSidebar'
import HeaderWalletBar from './components/HeaderWalletBar'
import { IconMenu, IconMessageSquare, IconSearch, IconUser } from './components/icons'
import NotificationBell from './components/NotificationBell'
import RewardsHeaderDropdown from './components/RewardsHeaderDropdown'
import PlayerHeaderLogo from './components/PlayerHeaderLogo'
import WalletFlowModal, { type WalletMainTab } from './components/WalletFlowModal'
import MainScrollRestoration from './components/MainScrollRestoration'
import MainScrollTopOnRouteChange from './components/MainScrollTopOnRouteChange'
import OperationalBanner from './components/OperationalBanner'
import PlayerApiOriginBanner from './components/PlayerApiOriginBanner'
import SiteFooter from './components/SiteFooter'
import PlayerMobileBottomNav from './components/PlayerMobileBottomNav'
import MobileCasinoMenuOverlay from './components/MobileCasinoMenuOverlay'
import { PullToRefreshOverlay } from './components/PullToRefresh'
import { useChat } from './hooks/useChat'
import { useOperationalHealth } from './hooks/useOperationalHealth'
import { useMobilePlayerChrome } from './hooks/useMobilePlayerChrome'
import { PlayerLayoutProvider } from './context/PlayerLayoutContext'
import { PersistentMiniPlayerProvider } from './context/PersistentMiniPlayerContext'
import PlayerBootOverlay from './components/PlayerBootOverlay'
import { SiteContentProvider } from './hooks/useSiteContent'
import { dismissPlayerCatalogSyncToast, toastPlayerCatalogSyncWarning } from './notifications/playerToast'
import { PlayerAuthProvider, usePlayerAuth } from './playerAuth'
import { BootNonLobbyRoutes, InitialAppLoadProvider } from './context/InitialAppLoadContext'
import DemoEmbedPage from './pages/DemoEmbedPage'
import GameLobbyPage from './pages/GameLobbyPage'
import CasinoSportsPage from './pages/CasinoSportsPage'
import { oddinIframeEnabled } from './lib/oddin/oddin.config'
import LegalPage from './pages/LegalPage'
import LobbyPage from './pages/LobbyPage'
import ProfilePage from './pages/ProfilePage'
import BonusesPage from './pages/BonusesPage'
import BonusesPreviewPage from './pages/BonusesPreviewPage'
import VipPage from './pages/VipPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import WalletDepositPage from './pages/WalletDepositPage'
import StudiosPage from './pages/StudiosPage'

function LegacyCasinoRedirect() {
  const loc = useLocation()
  return <Navigate to={{ pathname: '/casino/games', search: loc.search, hash: loc.hash }} replace />
}

function LegacyPlayToGameLobby() {
  const { gameId } = useParams()
  if (!gameId) return <Navigate to="/casino/games" replace />
  return <Navigate to={`/casino/game-lobby/${encodeURIComponent(gameId)}`} replace />
}

/** Old bookmarked URLs → single `/wallet/deposit` flow with `step` query. */
function LegacyDepositInstructionsRedirect() {
  const [sp] = useSearchParams()
  const q = new URLSearchParams(sp)
  q.set('step', 'address')
  return <Navigate to={`/wallet/deposit?${q}`} replace />
}

function LegacyDepositSubmittedRedirect() {
  const [sp] = useSearchParams()
  const q = new URLSearchParams(sp)
  q.set('step', 'sent')
  return <Navigate to={`/wallet/deposit?${q}`} replace />
}

/** Old `/wallet/withdraw` URLs → lobby + open wallet (Withdraw tab in modal). */
function LegacyWalletWithdrawPathRedirect() {
  return <Navigate to="/casino/games?walletTab=withdraw" replace />
}

function CatalogFooter() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/casino/sports') || pathname.startsWith('/embed/')) {
    return null
  }
  return <SiteFooter />
}

/** Header utility tiles — chip grey (vybebet reference). */
const iconBtn =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-casino-chip text-white/90 no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50 [&_svg]:shrink-0'

/** Tablet shell only (768–1279): shorter tiles so wallet/deposit are not covered by search/icons. */
const iconBtnTablet =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-casino-chip text-white/90 no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50 [&_svg]:shrink-0'

/** Rewards trigger — icon-only until tablet shell (`md:`) so wallet + deposit stay visible. */
const rewardsHeaderBtn =
  'inline-flex h-9 min-h-9 w-9 min-w-[2.25rem] shrink-0 items-center justify-center gap-0 rounded-[10px] bg-casino-chip px-0 text-[10px] font-extrabold uppercase tracking-wide text-white/95 no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50 max-[1279px]:h-8 max-[1279px]:min-h-8 max-[1279px]:w-8 max-[1279px]:min-w-8 max-[1279px]:rounded-[10px] md:w-auto md:min-w-0 md:gap-1.5 md:px-3 min-[1280px]:h-9 min-[1280px]:min-h-9 min-[1280px]:w-auto [&_svg]:shrink-0'

const iconBtnActive =
  'bg-casino-primary/25 text-white ring-casino-primary/40 [&_svg]:text-white'

export default function App() {
  useEffect(() => {
    return installPlayerCrossAppBridge(import.meta.env)
  }, [])

  return (
    <SiteContentProvider>
      <PlayerBootOverlay />
      <PlayerAuthProvider>
        <AuthModalProvider>
          <InitialAppLoadProvider>
            <PlayerToaster />
            <InstallGlobalPlayerToasts />
            <AppShell />
            <AuthModal />
          </InitialAppLoadProvider>
        </AuthModalProvider>
      </PlayerAuthProvider>
    </SiteContentProvider>
  )
}

function AppShell() {
  const op = useOperationalHealth()

  const catalogSyncOk = op.data?.catalog_sync_ok
  useEffect(() => {
    if (!op.data) return
    if (catalogSyncOk === false) {
      toastPlayerCatalogSyncWarning()
    } else {
      dismissPlayerCatalogSyncToast()
    }
  }, [catalogSyncOk, op.data])

  const location = useLocation()
  const { pathname } = location
  /** Oddin iframe: hide outer scroll on narrow viewports; phones keep bottom nav (see `showBottomNav`). */
  const oddinBifrostShell = oddinIframeEnabled() && pathname.startsWith('/casino/sports')
  const isMobileChrome = useMobilePlayerChrome()
  const [searchParams, setSearchParams] = useSearchParams()
  const catalogSearchQ = searchParams.get('q') ?? ''
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebar_collapsed') === 'true',
  )
  const [walletOpen, setWalletOpen] = useState(false)
  const [walletTab, setWalletTab] = useState<WalletMainTab>('deposit')
  const [gameSearchOpen, setGameSearchOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const { accessToken, isAuthenticated } = usePlayerAuth()
  const rewardsHub = useRewardsHub()
  useRakebackBoostLiveToast(isAuthenticated ? rewardsHub.data : null, isAuthenticated)

  useEffect(() => {
    prefetchCryptoTickersOnce()
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    const id = window.setInterval(() => void rewardsHub.reload(), 90_000)
    return () => window.clearInterval(id)
  }, [isAuthenticated, rewardsHub.reload])

  useTrafficSessionTracker(pathname, location.search, accessToken, isAuthenticated)
  const chat = useChat(accessToken, isAuthenticated, chatOpen)
  const { registerPostAuthWalletHandler } = useAuthModal()
  const showCasinoSearch =
    pathname.startsWith('/casino/') && !pathname.startsWith('/embed/')

  const closeHeaderDropdowns = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_WALLET_EVENT))
    window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_REWARDS_EVENT))
    window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_NOTIFICATIONS_EVENT))
  }, [])

  /** Closes menu drawer, game search, wallet modal, chat, and header wallet/rewards dropdowns. */
  const dismissAllChrome = useCallback(() => {
    setSidebarOpen(false)
    setGameSearchOpen(false)
    setWalletOpen(false)
    setChatOpen(false)
    closeHeaderDropdowns()
  }, [closeHeaderDropdowns])

  useEffect(() => {
    const closeMenu = () => setSidebarOpen(false)
    window.addEventListener(PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT, closeMenu)
    return () => window.removeEventListener(PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT, closeMenu)
  }, [])

  useEffect(() => {
    const closeChat = () => setChatOpen(false)
    window.addEventListener(PLAYER_CHROME_CLOSE_CHAT_EVENT, closeChat)
    return () => window.removeEventListener(PLAYER_CHROME_CLOSE_CHAT_EVENT, closeChat)
  }, [])

  const openMobileMenu = useCallback(() => {
    dismissAllChrome()
    setSidebarCollapsed(false)
    setSidebarOpen(true)
  }, [dismissAllChrome])

  const toggleMobileMenu = useCallback(() => {
    if (sidebarOpen) {
      setSidebarOpen(false)
      return
    }
    openMobileMenu()
  }, [sidebarOpen, openMobileMenu])

  const openGameSearchExclusive = useCallback(() => {
    dismissAllChrome()
    setGameSearchOpen(true)
  }, [dismissAllChrome])

  const openWalletTab = useCallback(
    (tab: PostAuthWalletTab) => {
      dismissAllChrome()
      setWalletTab(tab)
      setWalletOpen(true)
    },
    [dismissAllChrome],
  )

  const openWallet = useCallback(
    (tab: WalletMainTab) => {
      dismissAllChrome()
      setWalletTab(tab)
      setWalletOpen(true)
    },
    [dismissAllChrome],
  )

  const toggleChat = useCallback(() => {
    if (chatOpen) {
      setChatOpen(false)
      return
    }
    dismissAllChrome()
    setChatOpen(true)
    chat.resetUnread()
  }, [chatOpen, dismissAllChrome, chat])

  useEffect(() => {
    registerPostAuthWalletHandler(openWalletTab)
    return () => registerPostAuthWalletHandler(null)
  }, [openWalletTab, registerPostAuthWalletHandler])

  useEffect(() => {
    if (searchParams.get('walletTab') !== 'withdraw') return
    if (!isAuthenticated) return
    setSidebarOpen(false)
    setGameSearchOpen(false)
    setChatOpen(false)
    closeHeaderDropdowns()
    setWalletTab('withdraw')
    setWalletOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('walletTab')
    setSearchParams(next, { replace: true })
  }, [isAuthenticated, searchParams, setSearchParams, closeHeaderDropdowns])

  useEffect(() => {
    if (searchParams.get('gamesearch') !== '1') return
    setSidebarOpen(false)
    setWalletOpen(false)
    setChatOpen(false)
    closeHeaderDropdowns()
    setGameSearchOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('gamesearch')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, closeHeaderDropdowns])

  /**
   * Oddin iframe previously hid the mobile bottom nav — on phones we show it so Menu / Search / Deposit
   * stay reachable while browsing E-Sports (tablet/desktop unchanged).
   */
  const showBottomNav = !pathname.startsWith('/embed/') && (!oddinBifrostShell || isMobileChrome)

  const mainScrollRef = useRef<HTMLDivElement>(null)
  const pullToRefreshEnabled = !pathname.startsWith('/embed/') && !oddinBifrostShell
  /** Logged-in mobile E-Sports: rely on bottom nav + centered wallet; drop noisy header icon cluster. */
  const hideMobileHeaderActions = oddinBifrostShell && isMobileChrome && isAuthenticated

  return (
    <PlayerLayoutProvider chatOpen={chatOpen}>
      <PersistentMiniPlayerProvider>
        <BootNonLobbyRoutes />
        <div
          className={`player-app-shell flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-x-hidden overflow-y-hidden bg-casino-bg text-[14px] leading-normal text-casino-foreground antialiased ${chatOpen ? 'shell-chat-open' : ''}`}
          style={
            {
              ['--shell-sidebar-w']: sidebarCollapsed ? '52px' : '200px',
            } as React.CSSProperties
          }
        >
          <header className="casino-shell-mobile-header border-b border-white/[0.06] bg-casino-topbar shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
            {/* Mobile: wallet centered in header (`absolute`); actions on the right. */}
            <div className="relative isolate flex h-16 min-h-[4rem] w-full min-w-0 items-center justify-between gap-x-1 px-2">
              <PlayerHeaderLogo className="relative z-[2] max-w-[38vw] truncate sm:max-w-[10rem]" />
              {isAuthenticated ? (
                <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center px-10 sm:px-12">
                  <div className="pointer-events-auto flex min-h-[36px] min-w-0 max-w-[min(28rem,calc(100vw-7.5rem))] items-center justify-center overflow-hidden px-0.5">
                    <HeaderWalletBar
                      onOpenWallet={openWallet}
                      depositFlowActive={Boolean(isAuthenticated && walletOpen && walletTab === 'deposit')}
                    />
                  </div>
                </div>
              ) : null}
              {/* Mobile shell: Rewards + profile (search/chat via bottom nav); hidden on logged-in E-Sports phones. */}
              <div
                className={`relative z-[2] ml-auto flex shrink-0 items-center gap-0.5 ${hideMobileHeaderActions ? 'hidden' : ''}`}
              >
                {!showBottomNav ? (
                  <button
                    type="button"
                    className={`${iconBtn} shrink-0`}
                    aria-label="Open menu"
                    onClick={openMobileMenu}
                  >
                    <IconMenu size={20} aria-hidden />
                  </button>
                ) : null}
                {isAuthenticated ? (
                  <>
                    <NotificationBell className={`${iconBtn} relative inline-flex`} rewardsHub={rewardsHub.data} />
                    <RewardsHeaderDropdown className={`${rewardsHeaderBtn} relative inline-flex`} />
                    <HeaderProfileIcon />
                  </>
                ) : (
                  <HeaderAccount />
                )}
              </div>
            </div>
          </header>

          <div className="casino-shell-desktop-sidebar">
            <CasinoSidebar
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => {
                setSidebarCollapsed((c) => {
                  localStorage.setItem('sidebar_collapsed', String(!c))
                  return !c
                })
              }}
              onOpenChat={isAuthenticated ? toggleChat : undefined}
              chatOpen={chatOpen}
              chatUnreadCount={chat.unreadCount}
            />
          </div>

          <header className="casino-shell-tablet-header border-b border-white/[0.06] bg-casino-topbar shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
            <div
              className={`relative isolate mx-auto flex h-full min-h-0 w-full min-w-0 max-w-full items-center gap-1.5 pl-2 pr-2 md:gap-1.5 md:px-3 ${isAuthenticated ? '' : 'justify-between'}`}
            >
              {/*
                Tablet / small laptop (768–1279): wallet is viewport-centered (absolute) so it sits in the middle
                of the header between menu/logo and action icons. Desktop (≥1280) uses `casino-shell-desktop-header`.
              */}
              <div className="relative z-[2] flex min-w-0 shrink-0 items-center gap-2 md:gap-3">
                <button
                  type="button"
                  className={`${iconBtnTablet} shrink-0 ${sidebarOpen ? iconBtnActive : ''}`}
                  aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
                  aria-expanded={sidebarOpen}
                  onClick={toggleMobileMenu}
                >
                  <IconMenu size={18} aria-hidden />
                </button>
                <PlayerHeaderLogo className="max-w-[9rem] truncate" />
              </div>
              {isAuthenticated ? (
                <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center px-10 sm:px-12 md:px-14">
                  <div className="pointer-events-auto flex min-h-[34px] min-w-0 max-w-[min(28rem,100%)] items-center justify-center max-[1023px]:min-h-[32px] min-[1024px]:min-h-[38px]">
                    <HeaderWalletBar
                      onOpenWallet={openWallet}
                      depositFlowActive={Boolean(isAuthenticated && walletOpen && walletTab === 'deposit')}
                    />
                  </div>
                </div>
              ) : null}
              <div className="relative z-[2] ml-auto flex shrink-0 items-center justify-end gap-0.5 md:gap-1">
                {showCasinoSearch ? (
                  <button
                    type="button"
                    className={`${iconBtnTablet} ${gameSearchOpen ? iconBtnActive : ''}`}
                    aria-label="Search games"
                    onClick={openGameSearchExclusive}
                  >
                    <IconSearch size={16} aria-hidden />
                  </button>
                ) : null}
                {isAuthenticated ? (
                  <>
                    <button
                      type="button"
                      className={`${iconBtnTablet} ${chatOpen ? iconBtnActive : ''} relative inline-flex`}
                      aria-label="Chat"
                      onClick={toggleChat}
                    >
                      <IconMessageSquare size={16} aria-hidden />
                      {chat.unreadCount > 0 && !chatOpen && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-casino-segment px-1 text-[10px] font-bold text-casino-bg ring-2 ring-casino-bg">
                          {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                        </span>
                      )}
                    </button>
                    <NotificationBell
                      className={`${iconBtnTablet} relative inline-flex`}
                      rewardsHub={rewardsHub.data}
                      iconSize={16}
                    />
                    <RewardsHeaderDropdown className={`${rewardsHeaderBtn} relative inline-flex`} />
                    <HeaderProfileIcon />
                  </>
                ) : (
                  <HeaderAccount />
                )}
              </div>
            </div>
          </header>

          <header className="casino-shell-desktop-header border-b border-white/[0.06] bg-casino-topbar shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)]">
            <div className="isolate mx-auto flex h-full min-h-0 w-full min-w-0 max-w-full items-center gap-2 pl-2 pr-3 md:gap-3 md:px-5 min-[1280px]:px-6">
              <PlayerHeaderLogo className="relative z-[2]" />
              {isAuthenticated ? (
                <div className="relative z-[1] flex min-h-[40px] min-w-0 flex-1 basis-0 items-center justify-center overflow-hidden px-0 md:px-1">
                  <HeaderWalletBar
                    onOpenWallet={openWallet}
                    depositFlowActive={Boolean(isAuthenticated && walletOpen && walletTab === 'deposit')}
                  />
                </div>
              ) : (
                <div className="min-w-0 flex-1" aria-hidden />
              )}
              <div className="relative z-[2] flex shrink-0 items-center justify-end gap-0.5 md:gap-2 min-[1280px]:gap-3">
                {showCasinoSearch ? (
                  <button
                    type="button"
                    className={`${iconBtn} ${gameSearchOpen ? iconBtnActive : ''}`}
                    aria-label="Search games"
                    onClick={openGameSearchExclusive}
                  >
                    <IconSearch size={18} aria-hidden />
                  </button>
                ) : null}
                {isAuthenticated ? (
                  <>
                    <button
                      type="button"
                      className={`${iconBtn} ${chatOpen ? iconBtnActive : ''} relative inline-flex`}
                      aria-label="Chat"
                      onClick={toggleChat}
                    >
                      <IconMessageSquare size={18} aria-hidden />
                      {chat.unreadCount > 0 && !chatOpen && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-casino-segment px-1 text-[10px] font-bold text-casino-bg ring-2 ring-casino-bg">
                          {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                        </span>
                      )}
                    </button>
                    <NotificationBell className={`${iconBtn} relative inline-flex`} rewardsHub={rewardsHub.data} />
                    <RewardsHeaderDropdown className={`${rewardsHeaderBtn} relative inline-flex`} />
                    <HeaderProfileIcon />
                  </>
                ) : (
                  <HeaderAccount />
                )}
              </div>
            </div>
          </header>

          {/*
            Game search + wallet modal must sit outside the z-[200] scroll shell so fixed overlays beat shell
            tiles and headers; otherwise dim/backdrops paint under lobby content.
          */}
          <GameSearchOverlay
            open={gameSearchOpen}
            onClose={() => setGameSearchOpen(false)}
            initialQuery={catalogSearchQ}
          />

          <WalletFlowModal
            open={Boolean(isAuthenticated && walletOpen)}
            onClose={() => setWalletOpen(false)}
            initialTab={walletTab}
          />

          <div className="casino-shell-main relative z-[200] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <PullToRefreshOverlay scrollRef={mainScrollRef} enabled={pullToRefreshEnabled} />
            <div
              ref={mainScrollRef}
              id={PLAYER_MAIN_SCROLL_ID}
              className={`scrollbar-none overscroll-y-contain overscroll-x-none casino-shell-scroll flex min-h-0 min-w-0 flex-col overflow-x-hidden scroll-smooth [overflow-anchor:none] touch-pan-y ${
                oddinBifrostShell ? 'overflow-y-hidden' : 'overflow-y-auto'
              } ${showBottomNav ? '' : 'casino-shell-scroll--no-bottom-nav'}`}
            >
              <div className="relative z-[210] shrink-0">
                <PlayerApiOriginBanner />
                <OperationalBanner data={op.data} />
              </div>
              {/*
                Flex column so route content grows (`flex-1`) and `CatalogFooter` / SiteFooter stay at the
                bottom of the scroll viewport on short pages (iPad + desktop — avoids the footer block
                visually dominating immediately under sparse content).
              */}
              <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/*
                  Do not use min-h-0 on this routes wrapper: it lets the flex item shrink below game/grid
                  content; overflow stays visible so tiles painted onto the footer below (nested flex bug).
                */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <Routes>
                    <Route path="/" element={<Navigate to="/casino/games" replace />} />
                    <Route path="/casino/lobby" element={<LegacyCasinoRedirect />} />
                    <Route path="/casino/blueocean" element={<LegacyCasinoRedirect />} />
                    <Route path="/casino/game-lobby/:gameId" element={<GameLobbyPage />} />
                    <Route path="/casino/sports" element={<CasinoSportsPage />} />
                    <Route path="/casino/studios" element={<StudiosPage />} />
                    <Route path="/sportsbook" element={<Navigate to="/casino/sports" replace />} />
                    <Route path="/play/:gameId" element={<LegacyPlayToGameLobby />} />
                    <Route path="/casino/:section" element={<LobbyPage operationalData={op.data} />} />
                    <Route path="/login" element={<Navigate to="/casino/games?auth=login" replace />} />
                    <Route path="/register" element={<Navigate to="/casino/games?auth=register" replace />} />
                    <Route path="/forgot-password" element={<Navigate to="/casino/games?auth=forgot" replace />} />
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                    <Route path="/verify-email" element={<VerifyEmailPage />} />
                    <Route path="/profile" element={<ProfilePage />} />
                    <Route path="/bonuses/preview" element={<BonusesPreviewPage />} />
                    <Route path="/bonuses" element={<BonusesPage />} />
                    <Route path="/rewards/preview" element={<Navigate to="/bonuses/preview" replace />} />
                    <Route path="/rewards" element={<Navigate to="/bonuses" replace />} />
                    <Route path="/vip" element={<VipPage />} />
                    <Route path="/wallet/deposit" element={<WalletDepositPage />} />
                    <Route path="/wallet/deposit/instructions" element={<LegacyDepositInstructionsRedirect />} />
                    <Route path="/wallet/deposit/submitted" element={<LegacyDepositSubmittedRedirect />} />
                    <Route path="/wallet/withdraw" element={<LegacyWalletWithdrawPathRedirect />} />
                    <Route path="/wallet/withdraw/success" element={<LegacyWalletWithdrawPathRedirect />} />
                    <Route path="/terms" element={<LegalPage contentKey="legal.terms_of_service" fallbackTitle="Vybe Bet Terms of Service" />} />
                    <Route path="/privacy" element={<LegalPage contentKey="legal.privacy_policy" fallbackTitle="Vybe Bet Privacy Policy" />} />
                    <Route path="/responsible-gambling" element={<LegalPage contentKey="legal.responsible_gambling" fallbackTitle="Vybe Bet Responsible Gaming Policy" />} />
                    <Route path="/aml" element={<LegalPage contentKey="legal.fairness" fallbackTitle="Vybe Bet Anti-Money Laundering Policy" />} />
                    <Route path="/fairness" element={<Navigate to="/aml" replace />} />
                    <Route path="/embed/demo/:demoId" element={<DemoEmbedPage />} />
                  </Routes>
                  <MainScrollTopOnRouteChange />
                  <MainScrollRestoration />
                </div>
                <div className="relative z-[1] shrink-0 bg-casino-bg">
                  <CatalogFooter />
                </div>
              </main>
            </div>
            {showBottomNav ? (
              <PlayerMobileBottomNav
                menuOpen={sidebarOpen}
                gameSearchOpen={gameSearchOpen}
                depositFlowActive={Boolean(isAuthenticated && walletOpen && walletTab === 'deposit')}
                onDismissAllChrome={dismissAllChrome}
                onOpenMenu={openMobileMenu}
                onOpenGameSearch={openGameSearchExclusive}
                onOpenDeposit={() => openWallet('deposit')}
                showCasinoSearch={showCasinoSearch}
              />
            ) : null}
          </div>

          <MobileCasinoMenuOverlay
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            onOpenChat={isAuthenticated ? toggleChat : undefined}
            chatOpen={chatOpen}
            chatUnreadCount={chat.unreadCount}
          />
          <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} chat={chat} />
        </div>
      </PersistentMiniPlayerProvider>
    </PlayerLayoutProvider>
  )
}

function HeaderAccount() {
  const { isAuthenticated } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  if (!isAuthenticated) {
    return (
      <div className="flex max-w-full items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          className="rounded-[10px] bg-casino-chip px-2.5 py-1.5 text-[11px] font-bold text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover sm:px-4 sm:py-2 sm:text-xs"
          onClick={() => openAuth('login')}
        >
          Sign in
        </button>
        <button
          type="button"
          className="rounded-[10px] bg-casino-primary px-2.5 py-1.5 text-[11px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:brightness-110 sm:px-4 sm:py-2 sm:text-xs"
          onClick={() => openAuth('register')}
        >
          Register
        </button>
      </div>
    )
  }
  return null
}

function HeaderProfileIcon() {
  const { isAuthenticated, me, avatarUrlRevision } = usePlayerAuth()
  const [avatarBroken, setAvatarBroken] = useState(false)
  const avatarSrc = useMemo(() => {
    const raw = me?.avatar_url?.trim()
    if (!raw) return null
    const base = playerApiUrl(raw)
    if (avatarUrlRevision <= 0) return base
    const sep = base.includes('?') ? '&' : '?'
    return `${base}${sep}v=${avatarUrlRevision}`
  }, [me?.avatar_url, avatarUrlRevision])
  useEffect(() => {
    setAvatarBroken(false)
  }, [me?.avatar_url, avatarUrlRevision])
  if (!isAuthenticated) return null
  const label = me?.username ?? me?.email ?? 'Profile'
  const vip = me?.vip_tier?.trim()
  return (
    <Link
      to="/profile"
      className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1 transition hover:bg-white/[0.06]"
      aria-label={`Account: ${label}${vip ? ` · VIP ${vip}` : ''}`}
      title={vip ? `${label} · VIP ${vip}` : label}
      onClick={() => {
        window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_WALLET_EVENT))
        window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_REWARDS_EVENT))
        window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_NOTIFICATIONS_EVENT))
      }}
    >
      <div className="relative shrink-0">
        {avatarSrc && !avatarBroken ? (
          <img
            src={avatarSrc}
            alt=""
            className="size-8 rounded-full object-cover ring-2 ring-casino-primary/35"
            onError={() => setAvatarBroken(true)}
          />
        ) : (
          <div className="flex size-8 items-center justify-center rounded-full bg-casino-chip ring-2 ring-casino-primary/35">
            <IconUser size={15} aria-hidden />
          </div>
        )}
      </div>
      <span className="hidden min-w-0 flex-col leading-tight min-[1280px]:flex">
        {me?.username ? (
          <span className="truncate text-sm font-bold text-white">{me.username}</span>
        ) : null}
        {vip ? (
          <span className="truncate text-[10px] font-bold uppercase tracking-wide text-casino-primary">{vip}</span>
        ) : null}
      </span>
    </Link>
  )
}

