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

import { readApiError, type ApiErr } from './api/errors'

const ACCESS = 'admin_access_token'
const REFRESH = 'admin_refresh_token'
const EXPIRES = 'admin_access_expires_at'

type AuthState = {
  accessToken: string | null
  email: string | null
  role: string | null
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  login: (email: string, password: string) => Promise<{ ok: true } | { ok: false; error: ApiErr | null }>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccess] = useState<string | null>(() => localStorage.getItem(ACCESS))
  const [email, setEmail] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshInnerRef = useRef<() => Promise<boolean>>(async () => false)

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
  }, [])

  const clearSession = useCallback(() => {
    clearRefreshTimer()
    localStorage.removeItem(ACCESS)
    localStorage.removeItem(REFRESH)
    localStorage.removeItem(EXPIRES)
    setAccess(null)
    setEmail(null)
    setRole(null)
  }, [clearRefreshTimer])

  const persistTokens = useCallback(
    (access: string, refresh: string, expiresAtUnix: number) => {
      localStorage.setItem(ACCESS, access)
      localStorage.setItem(REFRESH, refresh)
      localStorage.setItem(EXPIRES, String(expiresAtUnix))
      setAccess(access)
      clearRefreshTimer()
      const ms = expiresAtUnix * 1000 - Date.now() - 60_000
      if (ms > 5_000) {
        refreshTimer.current = setTimeout(() => {
          void refreshInnerRef.current()
        }, ms)
      }
    },
    [clearRefreshTimer],
  )

  const refreshAccessInner = useCallback(async (): Promise<boolean> => {
    const rt = localStorage.getItem(REFRESH)
    if (!rt) {
      clearSession()
      return false
    }
    const res = await fetch('/v1/admin/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    })
    if (!res.ok) {
      clearSession()
      return false
    }
    const j = (await res.json()) as {
      access_token: string
      refresh_token: string
      expires_at: number
    }
    persistTokens(j.access_token, j.refresh_token, j.expires_at)
    return true
  }, [clearSession, persistTokens])

  useEffect(() => {
    refreshInnerRef.current = refreshAccessInner
  }, [refreshAccessInner])

  useEffect(() => () => clearRefreshTimer(), [clearRefreshTimer])

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers)
      const t = localStorage.getItem(ACCESS)
      if (t) headers.set('Authorization', `Bearer ${t}`)
      let res = await fetch(path, { ...init, headers })
      if (
        res.status === 401 &&
        !path.includes('/v1/admin/auth/refresh') &&
        !path.includes('/v1/admin/auth/login')
      ) {
        const ok = await refreshAccessInner()
        if (ok) {
          const t2 = localStorage.getItem(ACCESS)
          if (t2) headers.set('Authorization', `Bearer ${t2}`)
          res = await fetch(path, { ...init, headers })
        }
      }
      return res
    },
    [refreshAccessInner],
  )

  const refreshMe = useCallback(async () => {
    const t = localStorage.getItem(ACCESS)
    if (!t) return
    const res = await apiFetch('/v1/admin/me')
    if (!res.ok) {
      setEmail(null)
      setRole(null)
      return
    }
    const j = (await res.json()) as { email: string; role: string }
    setEmail(j.email)
    setRole(j.role)
  }, [apiFetch])

  const login = useCallback(
    async (
      e: string,
      password: string,
    ): Promise<{ ok: true } | { ok: false; error: ApiErr | null }> => {
      const res = await fetch('/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, password }),
      })
      if (!res.ok) {
        return { ok: false, error: await readApiError(res) }
      }
      const j = (await res.json()) as {
        access_token: string
        refresh_token: string
        expires_at: number
      }
      persistTokens(j.access_token, j.refresh_token, j.expires_at)
      await refreshMe()
      return { ok: true }
    },
    [persistTokens, refreshMe],
  )

  const logout = useCallback(async () => {
    const rt = localStorage.getItem(REFRESH)
    const t = localStorage.getItem(ACCESS)
    if (rt) {
      await fetch('/v1/admin/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
        body: JSON.stringify({ refresh_token: rt }),
      })
    }
    clearSession()
  }, [clearSession])

  const v = useMemo(
    () => ({
      accessToken,
      email,
      role,
      apiFetch,
      login,
      logout,
      refreshMe,
    }),
    [accessToken, email, role, apiFetch, login, logout, refreshMe],
  )

  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}

export function useAdminAuth() {
  const x = useContext(Ctx)
  if (!x) throw new Error('AdminAuthProvider missing')
  return x
}
