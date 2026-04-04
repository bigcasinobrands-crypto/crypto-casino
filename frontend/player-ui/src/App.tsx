import { adminAppHref, installPlayerCrossAppBridge } from '@repo/cross-app'
import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { readApiError, formatApiError } from './api/errors'
import { AuthModalProvider, useAuthModal } from './authModalContext'
import { AuthModal } from './components/AuthModal'
import CasinoSidebar from './components/CasinoSidebar'
import HeaderGameSearch from './components/HeaderGameSearch'
import OperationalBanner from './components/OperationalBanner'
import { useOperationalHealth } from './hooks/useOperationalHealth'
import { PlayerAuthProvider, usePlayerAuth } from './playerAuth'
import DemoEmbedPage from './pages/DemoEmbedPage'
import LobbyPage from './pages/LobbyPage'
import PlayPage from './pages/PlayPage'
import ProfilePage from './pages/ProfilePage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import VerifyEmailPage from './pages/VerifyEmailPage'

const quickNav = [
  { to: '/casino/blueocean', label: 'Blue Ocean' },
  { to: '/casino/lobby', label: 'Lobby' },
  { to: '/casino/featured', label: 'Featured' },
  { to: '/casino/slots', label: 'Slots' },
  { to: '/casino/live', label: 'Live' },
  { to: '/casino/new', label: 'New' },
]

function initials(email: string | undefined) {
  if (!email) return '?'
  const p = email.split('@')[0] ?? email
  return p.slice(0, 2).toUpperCase()
}

export default function App() {
  useEffect(() => {
    return installPlayerCrossAppBridge(import.meta.env)
  }, [])

  return (
    <PlayerAuthProvider>
      <AuthModalProvider>
        <AppShell />
        <AuthModal />
      </AuthModalProvider>
    </PlayerAuthProvider>
  )
}

function AppShell() {
  const op = useOperationalHealth()

  return (
    <div className="flex min-h-screen bg-casino-bg text-casino-foreground">
      <CasinoSidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <OperationalBanner data={op.data} error={op.error} />
        <header className="flex flex-wrap items-center gap-3 border-b border-casino-border bg-casino-surface px-4 py-3">
          <NavLink
            to="/casino/blueocean"
            className="text-sm font-semibold text-casino-primary md:hidden hover:opacity-90"
          >
            Casino
          </NavLink>
          <HeaderGameSearch />
          <HeaderAccount />
          <StaffConsoleLink />
          <div className="flex items-center gap-2">
            <WalletActions />
          </div>
        </header>
        <div className="border-b border-casino-border bg-casino-surface px-4 py-2">
          <div className="flex gap-2 overflow-x-auto text-sm">
            {quickNav.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  isActive
                    ? 'whitespace-nowrap rounded-casino-sm bg-casino-primary px-3 py-1 font-medium text-casino-bg'
                    : 'whitespace-nowrap rounded-casino-sm px-3 py-1 text-casino-muted hover:text-casino-primary'
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
        </div>
        <main className="flex flex-1 flex-col">
          <Routes>
            <Route path="/" element={<Navigate to="/casino/blueocean" replace />} />
            <Route path="/casino/:section" element={<LobbyPage operationalData={op.data} />} />
            <Route path="/login" element={<Navigate to="/casino/blueocean?auth=login" replace />} />
            <Route path="/register" element={<Navigate to="/casino/blueocean?auth=register" replace />} />
            <Route path="/forgot-password" element={<Navigate to="/casino/blueocean?auth=forgot" replace />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/verify-email" element={<VerifyEmailPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/play/:gameId" element={<PlayPage />} />
            <Route path="/embed/demo/:demoId" element={<DemoEmbedPage />} />
          </Routes>
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
      className="hidden shrink-0 text-xs text-casino-muted underline hover:text-casino-primary sm:inline"
    >
      Staff console
    </a>
  )
}

function HeaderAccount() {
  const { accessToken, me, logout } = usePlayerAuth()
  const { openAuth } = useAuthModal()

  if (!accessToken) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          className="text-casino-muted hover:text-casino-primary"
          onClick={() => openAuth('login')}
        >
          Sign in
        </button>
        <button
          type="button"
          className="rounded-casino-md bg-casino-primary px-3 py-1.5 text-sm font-medium text-casino-bg"
          onClick={() => openAuth('register')}
        >
          Register
        </button>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <Link
        to="/profile"
        className="flex max-w-[200px] items-center gap-2 rounded-casino-md border border-casino-border bg-casino-bg px-2 py-1.5 text-left text-sm hover:border-casino-primary"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-casino-elevated text-xs font-semibold text-casino-primary">
          {initials(me?.email)}
        </span>
        <span className="min-w-0 truncate text-casino-foreground">{me?.email ?? 'Account'}</span>
      </Link>
      <button
        type="button"
        className="hidden text-xs text-casino-muted underline sm:inline"
        onClick={() => void logout()}
      >
        Sign out
      </button>
    </div>
  )
}

function WalletActions() {
  const { accessToken, balanceMinor, refreshProfile, apiFetch } = usePlayerAuth()
  const [msg, setMsg] = useState<string | null>(null)

  return (
    <>
      {msg && (
        <span className="max-w-[140px] truncate text-xs text-amber-400" title={msg}>
          {msg}
        </span>
      )}
      <span className="text-sm text-casino-muted">
        {accessToken ? `${balanceMinor ?? 0} minor USDT` : '—'}
      </span>
      {accessToken && (
        <button
          type="button"
          className="rounded-casino-md bg-casino-primary px-3 py-2 text-sm font-medium text-casino-bg"
          onClick={() => void deposit(apiFetch, refreshProfile, setMsg)}
        >
          Deposit
        </button>
      )}
      {accessToken && (
        <button
          type="button"
          className="rounded-casino-md border border-casino-border px-3 py-2 text-sm"
          onClick={() => void withdraw(apiFetch, refreshProfile, setMsg)}
        >
          Withdraw
        </button>
      )}
    </>
  )
}

async function deposit(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  refresh: () => Promise<void>,
  setMsg: (s: string | null) => void,
) {
  setMsg(null)
  const res = await apiFetch('/v1/wallet/deposit-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ amount_minor: 10000, currency: 'USDT' }),
  })
  if (!res.ok) {
    setMsg(formatApiError(await readApiError(res), 'Deposit failed'))
    return
  }
  await refresh()
}

async function withdraw(
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>,
  refresh: () => Promise<void>,
  setMsg: (s: string | null) => void,
) {
  setMsg(null)
  const res = await apiFetch('/v1/wallet/withdraw', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      amount_minor: 1000,
      currency: 'USDT',
      destination: 'demo-withdraw-address',
    }),
  })
  if (!res.ok) {
    setMsg(formatApiError(await readApiError(res), 'Withdraw failed'))
    return
  }
  await refresh()
}
