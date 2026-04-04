import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export type AuthPanel = 'login' | 'register' | 'forgot'

/** Matches wallet modal tabs (deposit / withdraw). */
export type PostAuthWalletTab = 'deposit' | 'withdraw'

export type OpenAuthOptions = {
  /** Navigate here after successful sign-in or registration. */
  navigateTo?: string | null
  /** Open wallet modal on this tab after auth (e.g. Deposit). */
  walletTab?: PostAuthWalletTab | null
}

type WalletHandler = ((tab: PostAuthWalletTab) => void) | null

type Ctx = {
  panel: AuthPanel | null
  openAuth: (p: AuthPanel, opts?: OpenAuthOptions) => void
  closeAuth: () => void
  setPanel: (p: AuthPanel | null) => void
  /** Call after login/register succeeds so pending navigation / wallet run. */
  schedulePostAuthContinuation: () => void
  /** App shell registers how to open the wallet modal. */
  registerPostAuthWalletHandler: (fn: WalletHandler) => void
}

const AuthModalCtx = createContext<Ctx | null>(null)

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<AuthPanel | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const pendingNavRef = useRef<string | null>(null)
  const pendingWalletRef = useRef<PostAuthWalletTab | null>(null)
  const walletHandlerRef = useRef<WalletHandler>(null)

  const clearPending = useCallback(() => {
    pendingNavRef.current = null
    pendingWalletRef.current = null
  }, [])

  const openAuth = useCallback((p: AuthPanel, opts?: OpenAuthOptions) => {
    if (opts) {
      pendingNavRef.current = opts.navigateTo ?? null
      pendingWalletRef.current = opts.walletTab ?? null
    } else {
      clearPending()
    }
    setPanel(p)
  }, [clearPending])

  const closeAuth = useCallback(() => {
    setPanel(null)
    clearPending()
  }, [clearPending])

  const schedulePostAuthContinuation = useCallback(() => {
    const nav = pendingNavRef.current
    const wt = pendingWalletRef.current
    clearPending()
    setTimeout(() => {
      if (nav) navigate(nav)
      const wh = walletHandlerRef.current
      if (wt && wh) wh(wt)
    }, 0)
  }, [clearPending, navigate])

  const registerPostAuthWalletHandler = useCallback((fn: WalletHandler) => {
    walletHandlerRef.current = fn
  }, [])

  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const a = q.get('auth')
    if (a === 'login' || a === 'register' || a === 'forgot') {
      queueMicrotask(() => setPanel(a as AuthPanel))
      q.delete('auth')
      const next = q.toString()
      navigate(
        { pathname: location.pathname, search: next ? `?${next}` : '' },
        { replace: true },
      )
    }
  }, [location.pathname, location.search, navigate])

  const v = useMemo(
    () => ({
      panel,
      openAuth,
      closeAuth,
      setPanel,
      schedulePostAuthContinuation,
      registerPostAuthWalletHandler,
    }),
    [panel, openAuth, closeAuth, schedulePostAuthContinuation, registerPostAuthWalletHandler],
  )

  return <AuthModalCtx.Provider value={v}>{children}</AuthModalCtx.Provider>
}

export function useAuthModal() {
  const x = useContext(AuthModalCtx)
  if (!x) throw new Error('useAuthModal requires AuthModalProvider')
  return x
}
