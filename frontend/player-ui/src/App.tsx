import { installPlayerCrossAppBridge } from '@repo/cross-app'
import { useEffect, useState, useCallback } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { PLAYER_MAIN_SCROLL_ID } from './lib/catalogReturn'
import { playerApiUrl } from './lib/playerApiUrl'
import { useTrafficSessionTracker } from './hooks/useTrafficSessionTracker'
import { useRakebackBoostLiveToast } from './hooks/useRakebackBoostLiveToast'
import { useRewardsHub } from './hooks/useRewardsHub'
import { AuthModalProvider, useAuthModal, type PostAuthWalletTab } from './authModalContext'
import { AuthModal } from './components/AuthModal'
import BrandLogo from './components/BrandLogo'
import ChatDrawer from './components/ChatDrawer'
import { InstallGlobalPlayerToasts } from './components/InstallGlobalPlayerToasts'
import { PlayerToaster } from './components/PlayerToaster'
import GameSearchOverlay from './components/GameSearchOverlay'
import CasinoSidebar from './components/CasinoSidebar'
import HeaderWalletBar from './components/HeaderWalletBar'
import { IconMenu, IconMessageSquare, IconSearch, IconUser } from './components/icons'
import NotificationBell from './components/NotificationBell'
import RewardsHeaderDropdown from './components/RewardsHeaderDropdown'
import WalletFlowModal, { type WalletMainTab } from './components/WalletFlowModal'
import MainScrollRestoration from './components/MainScrollRestoration'
import OperationalBanner from './components/OperationalBanner'
import SiteFooter from './components/SiteFooter'
import { useChat } from './hooks/useChat'
import { useOperationalHealth } from './hooks/useOperationalHealth'
import { PlayerLayoutProvider } from './context/PlayerLayoutContext'
import { PersistentMiniPlayerProvider } from './context/PersistentMiniPlayerContext'
import { SiteContentProvider } from './hooks/useSiteContent'
import { dismissPlayerCatalogSyncToast, toastPlayerCatalogSyncWarning } from './notifications/playerToast'
import { PlayerAuthProvider, usePlayerAuth } from './playerAuth'
import DemoEmbedPage from './pages/DemoEmbedPage'
import GameLobbyPage from './pages/GameLobbyPage'
import SportsPage from './pages/SportsPage'
import LegalPage from './pages/LegalPage'
import LobbyPage from './pages/LobbyPage'
import ProfilePage from './pages/ProfilePage'
import BonusesPage from './pages/BonusesPage'
import BonusesPreviewPage from './pages/BonusesPreviewPage'
import VipPage from './pages/VipPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import WalletDepositPage from './pages/WalletDepositPage'

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
  if (
    pathname.startsWith('/casino/game-lobby/') ||
    pathname.startsWith('/casino/sports') ||
    pathname.startsWith('/embed/')
  ) {
    return null
  }
  return <SiteFooter />
}

/** Header utility tiles — chip grey (vybebet reference). */
const iconBtn =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-casino-chip text-white/90 no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50 [&_svg]:shrink-0'

/** Rewards trigger — same family as icon tiles, wider. */
const rewardsHeaderBtn =
  'inline-flex h-9 min-h-9 min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-[10px] bg-casino-chip px-2.5 text-[10px] font-extrabold uppercase tracking-wide text-white/95 no-underline shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-casino-primary/50 sm:px-3 [&_svg]:shrink-0'

const iconBtnActive =
  'bg-casino-primary/25 text-white ring-casino-primary/40 [&_svg]:text-white'

export default function App() {
  useEffect(() => {
    return installPlayerCrossAppBridge(import.meta.env)
  }, [])

  return (
    <SiteContentProvider>
      <PlayerAuthProvider>
        <AuthModalProvider>
          <PlayerToaster />
          <InstallGlobalPlayerToasts />
          <AppShell />
          <AuthModal />
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
    if (!isAuthenticated) return
    const id = window.setInterval(() => void rewardsHub.reload(), 90_000)
    return () => window.clearInterval(id)
  }, [isAuthenticated, rewardsHub.reload])

  useTrafficSessionTracker(pathname, location.search, accessToken, isAuthenticated)
  const chat = useChat(accessToken, isAuthenticated, chatOpen)
  const { registerPostAuthWalletHandler } = useAuthModal()
  const showCasinoSearch =
    pathname.startsWith('/casino/') && !pathname.startsWith('/embed/')

  const openWalletTab = useCallback((tab: PostAuthWalletTab) => {
    setWalletTab(tab)
    setWalletOpen(true)
  }, [])

  useEffect(() => {
    registerPostAuthWalletHandler(openWalletTab)
    return () => registerPostAuthWalletHandler(null)
  }, [openWalletTab, registerPostAuthWalletHandler])

  const openWallet = (tab: WalletMainTab) => {
    setWalletTab(tab)
    setWalletOpen(true)
  }

  useEffect(() => {
    if (searchParams.get('walletTab') !== 'withdraw') return
    if (!isAuthenticated) return
    setWalletTab('withdraw')
    setWalletOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('walletTab')
    setSearchParams(next, { replace: true })
  }, [isAuthenticated, searchParams, setSearchParams])

  return (
    <PlayerLayoutProvider chatOpen={chatOpen}>
      <PersistentMiniPlayerProvider>
        <div className="flex h-full min-h-0 w-full overflow-hidden bg-casino-bg text-[14px] leading-normal text-casino-foreground antialiased">
          <CasinoSidebar
            mobileOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => {
              setSidebarCollapsed(c => {
                localStorage.setItem('sidebar_collapsed', String(!c))
                return !c
              })
            }}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0">
              <OperationalBanner data={op.data} />
            </div>
            <header className="relative z-50 flex h-16 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-casino-topbar px-3 shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)] sm:px-5 md:px-6">
              <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  className={`${iconBtn} shrink-0 lg:hidden`}
                  aria-label="Open menu"
                  onClick={() => {
                    setSidebarCollapsed(false)
                    setSidebarOpen(true)
                  }}
                >
                  <IconMenu size={18} aria-hidden />
                </button>
                <BrandLogo
                  compact
                  className="min-w-0 shrink-0"
                  onNavigate={() => setSidebarOpen(false)}
                />
              </div>
              <div className="min-w-0 flex-1 px-1">
                <HeaderWalletBar onOpenWallet={openWallet} />
              </div>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 md:gap-3">
                {showCasinoSearch ? (
                  <button
                    type="button"
                    className={`${iconBtn} ${gameSearchOpen ? iconBtnActive : ''}`}
                    aria-label="Search games"
                    onClick={() => setGameSearchOpen(true)}
                  >
                    <IconSearch size={18} aria-hidden />
                  </button>
                ) : null}
                {isAuthenticated ? (
                  <>
                    <button
                      type="button"
                      className={`${iconBtn} ${chatOpen ? iconBtnActive : ''} relative hidden sm:inline-flex`}
                      aria-label="Chat"
                      onClick={() => { setChatOpen(o => !o); if (!chatOpen) chat.resetUnread() }}
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
            </header>
            <WalletFlowModal
              open={Boolean(isAuthenticated && walletOpen)}
              onClose={() => setWalletOpen(false)}
              initialTab={walletTab}
            />
            <GameSearchOverlay
              open={gameSearchOpen}
              onClose={() => setGameSearchOpen(false)}
              initialQuery={catalogSearchQ}
            />
            <main
              id={PLAYER_MAIN_SCROLL_ID}
              className="scrollbar-none overscroll-y-contain flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scroll-smooth [overflow-anchor:none]"
            >
              <Routes>
                <Route path="/" element={<Navigate to="/casino/games" replace />} />
                <Route path="/casino/lobby" element={<LegacyCasinoRedirect />} />
                <Route path="/casino/blueocean" element={<LegacyCasinoRedirect />} />
                <Route path="/casino/game-lobby/:gameId" element={<GameLobbyPage />} />
                <Route path="/casino/sports" element={<SportsPage />} />
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
                <Route path="/terms" element={<LegalPage contentKey="legal.terms_of_service" fallbackTitle="Terms of Service" />} />
                <Route path="/privacy" element={<LegalPage contentKey="legal.privacy_policy" fallbackTitle="Privacy Policy" />} />
                <Route path="/responsible-gambling" element={<LegalPage contentKey="legal.responsible_gambling" fallbackTitle="Responsible Gambling" />} />
                <Route path="/fairness" element={<LegalPage contentKey="legal.fairness" fallbackTitle="Fairness" />} />
                <Route path="/embed/demo/:demoId" element={<DemoEmbedPage />} />
              </Routes>
              <MainScrollRestoration />
              <CatalogFooter />
            </main>
          </div>
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
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-[10px] bg-casino-chip px-4 py-2 text-xs font-bold text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.06] transition hover:bg-casino-chip-hover"
          onClick={() => openAuth('login')}
        >
          Sign in
        </button>
        <button
          type="button"
          className="rounded-[10px] bg-casino-primary px-4 py-2 text-xs font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition hover:brightness-110"
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
  const { isAuthenticated, me } = usePlayerAuth()
  if (!isAuthenticated) return null
  const avatarSrc = me?.avatar_url ? playerApiUrl(me.avatar_url) : null
  const label = me?.username ?? me?.email ?? 'Profile'
  const vip = me?.vip_tier?.trim()
  return (
    <Link
      to="/profile"
      className="flex items-center gap-2.5 rounded-[10px] px-1.5 py-1 transition hover:bg-white/[0.06]"
      aria-label={`Account: ${label}${vip ? ` · VIP ${vip}` : ''}`}
      title={vip ? `${label} · VIP ${vip}` : label}
    >
      <div className="relative shrink-0">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt=""
            className="size-8 rounded-full object-cover ring-2 ring-casino-primary/35"
          />
        ) : (
          <div className="flex size-8 items-center justify-center rounded-full bg-casino-chip ring-2 ring-casino-primary/35">
            <IconUser size={15} aria-hidden />
          </div>
        )}
      </div>
      <span className="hidden min-w-0 flex-col leading-tight sm:flex">
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

