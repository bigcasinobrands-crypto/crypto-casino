import { adminAppHref, installPlayerCrossAppBridge } from '@repo/cross-app'
import { useEffect, useState, useCallback } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { PLAYER_MAIN_SCROLL_ID } from './lib/catalogReturn'
import { AuthModalProvider, useAuthModal, type PostAuthWalletTab } from './authModalContext'
import { AuthModal } from './components/AuthModal'
import BrandLogo from './components/BrandLogo'
import { InstallGlobalPlayerToasts } from './components/InstallGlobalPlayerToasts'
import { PlayerToaster } from './components/PlayerToaster'
import GameSearchOverlay from './components/GameSearchOverlay'
import CasinoSidebar from './components/CasinoSidebar'
import HeaderWalletBar from './components/HeaderWalletBar'
import { IconBell, IconMenu, IconMessageSquare, IconSearch, IconUser } from './components/icons'
import WalletFlowModal, { type WalletMainTab } from './components/WalletFlowModal'
import MainScrollRestoration from './components/MainScrollRestoration'
import OperationalBanner from './components/OperationalBanner'
import SiteFooter from './components/SiteFooter'
import { useOperationalHealth } from './hooks/useOperationalHealth'
import {
  dismissPlayerCatalogSyncToast,
  toastPlayerCatalogSyncWarning,
} from './notifications/playerToast'
import { PlayerAuthProvider, usePlayerAuth } from './playerAuth'
import DemoEmbedPage from './pages/DemoEmbedPage'
import GameLobbyPage from './pages/GameLobbyPage'
import LobbyPage from './pages/LobbyPage'
import ProfilePage from './pages/ProfilePage'
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
  if (pathname.startsWith('/casino/game-lobby/') || pathname.startsWith('/embed/')) return null
  return <SiteFooter />
}

/** Header icon actions: solid brand purple + white glyph (`visited:` covers profile `<Link>`). */
const iconBtn =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-casino-primary text-white no-underline shadow-sm transition hover:brightness-110 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-casino-primary focus-visible:text-white visited:text-white [&_svg]:shrink-0 [&_svg]:text-white'

export default function App() {
  useEffect(() => {
    return installPlayerCrossAppBridge(import.meta.env)
  }, [])

  return (
    <PlayerAuthProvider>
      <AuthModalProvider>
        <PlayerToaster />
        <InstallGlobalPlayerToasts />
        <AppShell />
        <AuthModal />
      </AuthModalProvider>
    </PlayerAuthProvider>
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

  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const catalogSearchQ = searchParams.get('q') ?? ''
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const [walletTab, setWalletTab] = useState<WalletMainTab>('deposit')
  const [gameSearchOpen, setGameSearchOpen] = useState(false)
  const { accessToken } = usePlayerAuth()
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
    if (!accessToken) return
    setWalletTab('withdraw')
    setWalletOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('walletTab')
    setSearchParams(next, { replace: true })
  }, [accessToken, searchParams, setSearchParams])

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-casino-bg text-[14px] leading-normal text-casino-foreground antialiased">
      <CasinoSidebar mobileOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0">
          <OperationalBanner data={op.data} error={op.error} />
        </div>
        <header className="relative z-50 flex h-16 shrink-0 items-center gap-2 border-b border-casino-border bg-casino-topbar px-3 sm:px-5 md:px-6">
          <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              className={`${iconBtn} shrink-0 lg:hidden`}
              aria-label="Open menu"
              onClick={() => setSidebarOpen(true)}
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
                className={iconBtn}
                aria-label="Search games"
                onClick={() => setGameSearchOpen(true)}
              >
                <IconSearch size={18} aria-hidden />
              </button>
            ) : null}
            {accessToken ? (
              <>
                <button
                  type="button"
                  className={`${iconBtn} hidden sm:inline-flex`}
                  aria-label="Messages (demo)"
                >
                  <IconMessageSquare size={18} aria-hidden />
                </button>
                <button
                  type="button"
                  className={`${iconBtn} hidden sm:inline-flex`}
                  aria-label="Notifications"
                >
                  <IconBell size={18} aria-hidden />
                </button>
                <HeaderProfileIcon />
                <StaffConsoleLink />
              </>
            ) : (
              <HeaderAccount />
            )}
          </div>
        </header>
        <WalletFlowModal
          open={Boolean(accessToken && walletOpen)}
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
          className="scrollbar-none overscroll-y-contain flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto scroll-smooth"
        >
          <MainScrollRestoration />
          <Routes>
            <Route path="/" element={<Navigate to="/casino/games" replace />} />
            <Route path="/casino/lobby" element={<LegacyCasinoRedirect />} />
            <Route path="/casino/blueocean" element={<LegacyCasinoRedirect />} />
            <Route path="/casino/game-lobby/:gameId" element={<GameLobbyPage />} />
            <Route path="/play/:gameId" element={<LegacyPlayToGameLobby />} />
            <Route path="/casino/:section" element={<LobbyPage operationalData={op.data} />} />
            <Route path="/login" element={<Navigate to="/casino/games?auth=login" replace />} />
            <Route path="/register" element={<Navigate to="/casino/games?auth=register" replace />} />
            <Route path="/forgot-password" element={<Navigate to="/casino/games?auth=forgot" replace />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/wallet/deposit" element={<WalletDepositPage />} />
            <Route path="/wallet/deposit/instructions" element={<LegacyDepositInstructionsRedirect />} />
            <Route path="/wallet/deposit/submitted" element={<LegacyDepositSubmittedRedirect />} />
            <Route path="/wallet/withdraw" element={<LegacyWalletWithdrawPathRedirect />} />
            <Route path="/wallet/withdraw/success" element={<LegacyWalletWithdrawPathRedirect />} />
            <Route path="/embed/demo/:demoId" element={<DemoEmbedPage />} />
          </Routes>
          <CatalogFooter />
        </main>
      </div>
    </div>
  )
}

function StaffConsoleLink() {
  const href = adminAppHref(import.meta.env, '/login')
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="hidden shrink-0 text-[10px] text-casino-muted underline hover:text-casino-primary xl:inline"
    >
      Staff
    </a>
  )
}

function HeaderAccount() {
  const { accessToken } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  if (!accessToken) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-[4px] bg-casino-primary-dim px-4 py-1.5 text-xs font-semibold text-casino-foreground transition hover:brightness-110"
          onClick={() => openAuth('login')}
        >
          Sign in
        </button>
        <button
          type="button"
          className="rounded-[4px] bg-casino-primary px-4 py-1.5 text-xs font-semibold text-white transition hover:brightness-110"
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
  const { accessToken, me } = usePlayerAuth()
  if (!accessToken) return null
  return (
    <Link
      to="/profile"
      className={iconBtn}
      aria-label={me?.email ? `Account: ${me.email}` : 'Account and profile'}
      title={me?.email ?? 'Profile'}
    >
      <IconUser size={18} aria-hidden />
    </Link>
  )
}

