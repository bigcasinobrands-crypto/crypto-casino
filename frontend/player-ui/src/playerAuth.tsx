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

import { apiErrFromResponse, type ApiErr } from './api/errors'
import { applyPlayerMutatingCSRF, playerCredentialsMode, playerFetch } from './lib/playerFetch'
import { playerApiOriginConfigured, playerApiUrl } from './lib/playerApiUrl'

const ACCESS = 'player_access_token'
const REFRESH = 'player_refresh_token'
const EXPIRES = 'player_access_expires_at'

/** Cookie-auth builds: drop any leftover JWTs from localStorage so the session is httpOnly-only. */
function readInitialAccessToken(): string | null {
  if (typeof localStorage === 'undefined') return null
  if (!playerCredentialsMode) {
    return localStorage.getItem(ACCESS)
  }
  try {
    localStorage.removeItem(ACCESS)
    localStorage.removeItem(REFRESH)
    localStorage.removeItem(EXPIRES)
  } catch {
    /* private mode / quota */
  }
  return null
}

export type MeResponse = {
  id: string
  participant_id: string
  email: string
  created_at: string
  email_verified: boolean
  email_verified_at: string | null
  username?: string
  avatar_url?: string
  /** Resolved VIP tier name (from player_vip_state + vip_tiers); updates with periodic profile refresh. */
  vip_tier?: string
  vip_tier_id?: number
}

export type BalanceBreakdown = {
  cashMinor: number
  bonusLockedMinor: number
}

type P = {
  accessToken: string | null
  /** True when JWT is in memory/localStorage or cookie session is established (`me` loaded under credentialed API). */
  isAuthenticated: boolean
  me: MeResponse | null
  balanceMinor: number | null
  balanceBreakdown: BalanceBreakdown | null
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  login: (
    email: string,
    password: string,
    captchaToken?: string,
  ) => Promise<{ ok: true } | { ok: false; error: ApiErr | null }>
  register: (input: {
    email: string
    password: string
    username: string
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
  const [accessToken, setAccess] = useState<string | null>(() => readInitialAccessToken())
  const [me, setMe] = useState<MeResponse | null>(null)
  const [balanceMinor, setBal] = useState<number | null>(null)
  const [balanceBreakdown, setBalanceBreakdown] = useState<BalanceBreakdown | null>(null)
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
    setBalanceBreakdown(null)
  }, [clearRefreshTimer])

  /** After login / register / refresh: store JWTs locally (default) or rely on httpOnly cookies only (credentials mode). */
  const applySessionTokens = useCallback(
    (access: string, refresh: string, expiresAtUnix: number) => {
      clearRefreshTimer()
      if (playerCredentialsMode) {
        localStorage.removeItem(ACCESS)
        localStorage.removeItem(REFRESH)
        localStorage.removeItem(EXPIRES)
        setAccess(null)
      } else {
        localStorage.setItem(ACCESS, access)
        localStorage.setItem(REFRESH, refresh)
        localStorage.setItem(EXPIRES, String(expiresAtUnix))
        setAccess(access)
      }
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
    if (!rt && !playerCredentialsMode) {
      clearSession()
      return false
    }
    const res = await playerFetch('/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rt ? { refresh_token: rt } : {}),
    })
    if (!res.ok) {
      clearSession()
      return false
    }
    const j = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_at: number
    }
    if (!Number.isFinite(j.expires_at)) {
      clearSession()
      return false
    }
    if (!playerCredentialsMode && (!j.access_token?.trim() || !j.refresh_token?.trim())) {
      clearSession()
      return false
    }
    applySessionTokens(j.access_token ?? '', j.refresh_token ?? '', j.expires_at)
    return true
  }, [applySessionTokens, clearSession])

  useEffect(() => {
    refreshInnerRef.current = refreshAccessInner
  }, [refreshAccessInner])

  useEffect(() => () => clearRefreshTimer(), [clearRefreshTimer])

  const apiFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers)
      applyPlayerMutatingCSRF(headers, init.method)
      const t = localStorage.getItem(ACCESS)
      if (t) headers.set('Authorization', `Bearer ${t}`)
      if (!headers.has('X-Request-Id')) {
        headers.set('X-Request-Id', crypto.randomUUID())
      }
      const cred: RequestCredentials = playerCredentialsMode ? 'include' : 'omit'
      let res = await fetch(playerApiUrl(path), { ...init, headers, credentials: cred })
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
          res = await fetch(playerApiUrl(path), { ...init, headers, credentials: cred })
        }
      }
      return res
    },
    [refreshAccessInner],
  )

  const refreshProfile = useCallback(async () => {
    const t = localStorage.getItem(ACCESS)
    if (!t && !playerCredentialsMode) return
    const m = await apiFetch('/v1/auth/me')
    if (m.ok) {
      setMe((await m.json()) as MeResponse)
    } else {
      setMe(null)
    }
    const bal = await apiFetch('/v1/wallet/balance')
    if (bal.ok) {
      const j = (await bal.json()) as {
        balance_minor: number
        cash_minor?: number
        bonus_locked_minor?: number
      }
      setBal(j.balance_minor)
      const cash = typeof j.cash_minor === 'number' ? j.cash_minor : j.balance_minor
      const bonus = typeof j.bonus_locked_minor === 'number' ? j.bonus_locked_minor : 0
      setBalanceBreakdown({ cashMinor: cash, bonusLockedMinor: bonus })
    }
  }, [apiFetch])

  /** Cookie-auth sessions: hydrate `me` when access JWT is only in httpOnly cookies. */
  useEffect(() => {
    if (!playerCredentialsMode) return
    if (localStorage.getItem(ACCESS)) return
    void refreshProfile()
  }, [refreshProfile])

  const isAuthenticated = useMemo(
    () => Boolean(accessToken) || (playerCredentialsMode && me !== null),
    [accessToken, me],
  )

  const login = useCallback(
    async (
      email: string,
      password: string,
      captchaToken?: string,
    ): Promise<{ ok: true } | { ok: false; error: ApiErr | null }> => {
      let res: Response
      try {
        res = await playerFetch('/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            ...(captchaToken ? { captcha_token: captchaToken } : {}),
          }),
        })
      } catch {
        return {
          ok: false,
          error: {
            code: 'network',
            status: 0,
            message:
              import.meta.env.PROD && !playerApiOriginConfigured()
                ? 'Cannot reach API. Set VITE_PLAYER_API_ORIGIN in Vercel to your public core API URL and redeploy.'
                : 'Cannot reach API. Run the core service (e.g. npm run dev:api) and check DEV_API_PROXY / network.',
          },
        }
      }
      if (!res.ok) {
        const missingOrigin =
          import.meta.env.PROD &&
          !playerApiOriginConfigured() &&
          (res.status === 404 || res.status === 405)
        return {
          ok: false,
          error: await apiErrFromResponse(
            res,
            missingOrigin
              ? 'Sign-in hit the player site, not the API. Set VITE_PLAYER_API_ORIGIN in Vercel to your core API https origin and redeploy; add this player URL to PLAYER_CORS_ORIGINS on the API.'
              : undefined,
          ),
        }
      }
      const j = (await res.json()) as {
        access_token?: string
        refresh_token?: string
        expires_at: number
      }
      if (!Number.isFinite(j.expires_at)) {
        return {
          ok: false,
          error: {
            code: 'invalid_session',
            message: 'Incomplete token response',
            status: 0,
          } as ApiErr,
        }
      }
      if (!playerCredentialsMode && (!j.access_token?.trim() || !j.refresh_token?.trim())) {
        return {
          ok: false,
          error: {
            code: 'invalid_session',
            message: 'Incomplete token response',
            status: 0,
          } as ApiErr,
        }
      }
      applySessionTokens(j.access_token ?? '', j.refresh_token ?? '', j.expires_at)
      await refreshProfile()
      return { ok: true }
    },
    [applySessionTokens, refreshProfile],
  )

  const register = useCallback(
    async (input: {
      email: string
      password: string
      username: string
      acceptTerms: boolean
      acceptPrivacy: boolean
      captchaToken?: string
    }): Promise<{ ok: true } | { ok: false; error: ApiErr | null }> => {
      let res: Response
      try {
        res = await playerFetch('/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: input.email,
            password: input.password,
            username: input.username,
            accept_terms: input.acceptTerms,
            accept_privacy: input.acceptPrivacy,
            ...(input.captchaToken ? { captcha_token: input.captchaToken } : {}),
          }),
        })
      } catch {
        return {
          ok: false,
          error: {
            code: 'network',
            status: 0,
            message:
              import.meta.env.PROD && !playerApiOriginConfigured()
                ? 'Cannot reach API. Set VITE_PLAYER_API_ORIGIN in Vercel to your public core API URL and redeploy.'
                : 'Cannot reach API. Run the core service and check your network.',
          },
        }
      }
      if (!res.ok) {
        const missingOrigin =
          import.meta.env.PROD &&
          !playerApiOriginConfigured() &&
          (res.status === 404 || res.status === 405)
        return {
          ok: false,
          error: await apiErrFromResponse(
            res,
            missingOrigin
              ? 'Register hit the player site, not the API. Set VITE_PLAYER_API_ORIGIN in Vercel and redeploy.'
              : undefined,
          ),
        }
      }
      const j = (await res.json()) as {
        access_token?: string
        refresh_token?: string
        expires_at: number
      }
      if (!Number.isFinite(j.expires_at)) {
        return {
          ok: false,
          error: {
            code: 'invalid_session',
            message: 'Incomplete token response',
            status: 0,
          } as ApiErr,
        }
      }
      if (!playerCredentialsMode && (!j.access_token?.trim() || !j.refresh_token?.trim())) {
        return {
          ok: false,
          error: {
            code: 'invalid_session',
            message: 'Incomplete token response',
            status: 0,
          } as ApiErr,
        }
      }
      applySessionTokens(j.access_token ?? '', j.refresh_token ?? '', j.expires_at)
      await refreshProfile()
      return { ok: true }
    },
    [applySessionTokens, refreshProfile],
  )

  const logout = useCallback(async () => {
    const rt = localStorage.getItem(REFRESH)
    const t = localStorage.getItem(ACCESS)
    const cred: RequestCredentials = playerCredentialsMode ? 'include' : 'omit'
    if (rt || playerCredentialsMode) {
      await fetch(playerApiUrl('/v1/auth/logout'), {
        method: 'POST',
        credentials: cred,
        headers: (() => {
          const h = new Headers({
            'Content-Type': 'application/json',
            ...(t ? { Authorization: `Bearer ${t}` } : {}),
          })
          applyPlayerMutatingCSRF(h, 'POST')
          return h
        })(),
        body: JSON.stringify({ refresh_token: rt ?? '' }),
      })
    }
    clearSession()
  }, [clearSession])

  // Live balance: SSE stream for instant updates + 30s poll fallback
  useEffect(() => {
    if (!isAuthenticated) return
    void refreshProfile()
    const t = window.setInterval(() => void refreshProfile(), 30_000)
    return () => window.clearInterval(t)
  }, [isAuthenticated, refreshProfile])

  // SSE balance stream — pushes every balance change within ~2s
  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    const controller = new AbortController()

    async function connectStream() {
      while (!cancelled) {
        try {
          const h = new Headers()
          if (accessToken) h.set('Authorization', `Bearer ${accessToken}`)
          const res = await fetch(playerApiUrl('/v1/wallet/balance/stream'), {
            headers: h,
            credentials: playerCredentialsMode ? 'include' : 'omit',
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
                  const j = JSON.parse(line.slice(6)) as {
                    balance_minor?: number
                    cash_minor?: number
                    bonus_locked_minor?: number
                  }
                  if (typeof j.balance_minor === 'number') {
                    setBal(j.balance_minor)
                  }
                  if (
                    typeof j.cash_minor === 'number' &&
                    typeof j.bonus_locked_minor === 'number'
                  ) {
                    setBalanceBreakdown({
                      cashMinor: j.cash_minor,
                      bonusLockedMinor: j.bonus_locked_minor,
                    })
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
  }, [isAuthenticated, accessToken])

  const refreshAccess = useCallback(async () => refreshAccessInner(), [refreshAccessInner])

  const v = useMemo(
    () => ({
      accessToken,
      isAuthenticated,
      me,
      balanceMinor,
      balanceBreakdown,
      apiFetch,
      login,
      register,
      logout,
      refreshProfile,
      refreshAccess,
    }),
    [
      accessToken,
      isAuthenticated,
      me,
      balanceMinor,
      balanceBreakdown,
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
