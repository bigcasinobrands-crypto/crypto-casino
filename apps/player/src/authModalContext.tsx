import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export type AuthPanel = 'login' | 'register' | 'forgot'

type Ctx = {
  panel: AuthPanel | null
  openAuth: (p: AuthPanel) => void
  closeAuth: () => void
  setPanel: (p: AuthPanel | null) => void
}

const AuthModalCtx = createContext<Ctx | null>(null)

export function AuthModalProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<AuthPanel | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const openAuth = useCallback((p: AuthPanel) => setPanel(p), [])
  const closeAuth = useCallback(() => setPanel(null), [])

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
    () => ({ panel, openAuth, closeAuth, setPanel }),
    [panel, openAuth, closeAuth],
  )

  return <AuthModalCtx.Provider value={v}>{children}</AuthModalCtx.Provider>
}

export function useAuthModal() {
  const x = useContext(AuthModalCtx)
  if (!x) throw new Error('useAuthModal requires AuthModalProvider')
  return x
}
