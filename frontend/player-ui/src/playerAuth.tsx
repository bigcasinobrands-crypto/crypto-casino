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
import { playerFetch } from './lib/playerFetch'
import { playerApiUrl } from './lib/playerApiUrl'

const ACCESS = 'player_access_token'
const REFRESH = 'player_refresh_token'
const EXPIRES = 'player_access_expires_at'

export type MeResponse = {
  id: string
  email: string
  created_at: string
  email_verified: boolean
  email_verified_at: string | null
}

type P = {
  accessToken: string | null
  me: MeResponse | null
  balanceMinor: number | null
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  login: (
    email: string,
    password: string,
    captchaToken?: string,
  ) => Promise<{ ok: true } | { ok: false; error: ApiErr | null }>
  register: (input: {
    email: string
    password: string
    acceptTerms: boolean
    acceptPrivacy: boolean
    captchaToken?: string
  }) => Promise<{ ok: true } | { ok: false; error: ApiErr | null }>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
  refreshAccess: () => Promise<boolean>
}

const Ctx = createContext<P | null>(null)

export function PlayerAuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccess] = useState<string | null>(() => localStorage.getItem(ACCESS))
  const [me, setMe] = useState<MeResponse | null>(null)
  const [balanceMinor, setBal] = useState<number | null>(null)
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
    setMe(null)
    setBal(null)
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
    const res = await playerFetch('/v1/auth/refresh', {
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
      if (!headers.has('X-Request-Id')) {
        headers.set('X-Request-Id', crypto.randomUUID())
      }
      let res = await fetch(playerApiUrl(path), { ...init, headers })
      if (
        res.status === 401 &&
        !path.includes('/v1/auth/refresh') &&
        !path.includes('/v1/auth/login') &&
        !path.includes('/v1/auth/register')
      ) {
        const ok = await refreshAccessInner()
        if (ok) {
          const t2 = localStorage.getItem(ACCESS)
          if (t2) headers.set('Authorization', `Bearer ${t2}`)
          res = await fetch(playerApiUrl(path), { ...init, headers })
        }
      }
      return res
    },
    [refreshAccessInner],
  )

  const refreshProfile = useCallback(async () => {
    const t = localStorage.getItem(ACCESS)
    if (!t) return
    const m = await apiFetch('/v1/auth/me')
    if (m.ok) {
      setMe((await m.json()) as MeResponse)
    } else {
      setMe(null)
    }
    const bal = await apiFetch('/v1/wallet/balance')
    if (bal.ok) {
      const j = (await bal.json()) as { balance_minor: number }
      setBal(j.balance_minor)
    }
  }, [apiFetch])

  const login = useCallback(
    async (
      email: string,
      password: string,
      captchaToken?: string,
    ): Promise<{ ok: true } | { ok: false; error: ApiErr | null }> => {
      const res = await playerFetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(captchaToken ? { captcha_token: captchaToken } : {}),
        }),
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
      await refreshProfile()
      return { ok: true }
    },
    [persistTokens, refreshProfile],
  )

  const register = useCallback(
    async (input: {
      email: string
      password: string
      acceptTerms: boolean
      acceptPrivacy: boolean
      captchaToken?: string
    }): Promise<{ ok: true } | { ok: false; error: ApiErr | null }> => {
      const res = await playerFetch('/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          accept_terms: input.acceptTerms,
          accept_privacy: input.acceptPrivacy,
          ...(input.captchaToken ? { captcha_token: input.captchaToken } : {}),
        }),
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
      await refreshProfile()
      return { ok: true }
    },
    [persistTokens, refreshProfile],
  )

  const logout = useCallback(async () => {
    const rt = localStorage.getItem(REFRESH)
    const t = localStorage.getItem(ACCESS)
    if (rt) {
      await fetch(playerApiUrl('/v1/auth/logout'), {
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

  // Live balance: SSE stream for instant updates + 30s poll fallback
  useEffect(() => {
    if (!accessToken) return
    void refreshProfile()
    const t = window.setInterval(() => void refreshProfile(), 30_000)
    return () => window.clearInterval(t)
  }, [accessToken, refreshProfile])

  // SSE balance stream — pushes every balance change within ~2s
  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    const controller = new AbortController()

    async function connectStream() {
      while (!cancelled) {
        try {
          const res = await fetch(playerApiUrl('/v1/wallet/balance/stream'), {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal,
          })
          if (!res.ok || !res.body) return
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          while (!cancelled) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const j = JSON.parse(line.slice(6)) as { balance_minor?: number }
                  if (typeof j.balance_minor === 'number') {
                    setBal(j.balance_minor)
                  }
                } catch { /* malformed SSE line */ }
              }
            }
          }
        } catch {
          if (cancelled) return
        }
        // Reconnect after a short delay on disconnect
        if (!cancelled) await new Promise((r) => setTimeout(r, 3000))
      }
    }

    void connectStream()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [accessToken])

  const refreshAccess = useCallback(async () => refreshAccessInner(), [refreshAccessInner])

  const v = useMemo(
    () => ({
      accessToken,
      me,
      balanceMinor,
      apiFetch,
      login,
      register,
      logout,
      refreshProfile,
      refreshAccess,
    }),
    [
      accessToken,
      me,
      balanceMinor,
      apiFetch,
      login,
      register,
      logout,
      refreshProfile,
      refreshAccess,
    ],
  )

  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}

export function usePlayerAuth() {
  const x = useContext(Ctx)
  if (!x) throw new Error('PlayerAuthProvider')
  return x
}
