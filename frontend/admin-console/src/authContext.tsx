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

import type {
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import { apiErrFromBody, readApiError, type ApiErr } from './api/errors'
import { adminApiOriginConfigured, adminApiUrl } from './lib/adminApiUrl'

/** Shown when fetch() rejects (HTTP 0) — CORS and misconfigured API URL are the usual causes in production. */
function adminLoginNetworkMessage(): string {
  if (import.meta.env.DEV) {
    return 'Cannot reach API. From the repo root run npm run dev:api and keep Postgres up (npm run compose:up).'
  }
  if (!adminApiOriginConfigured()) {
    return 'Cannot reach API. Set VITE_ADMIN_API_ORIGIN on this admin project in Vercel to your core API origin (e.g. https://crypto-casino-1938.onrender.com), save for Production + Preview, then redeploy—old builds ignore new env vars.'
  }
  return 'Cannot reach API. If VITE_ADMIN_API_ORIGIN is set, the browser often blocks the request until Render allows this site: set ADMIN_CORS_ORIGINS on the core API to your exact admin URL (same as the address bar, no trailing slash). Include preview URLs if you test on Vercel preview hosts. Redeploy the API after changing env. Free Render can take 50s+ to wake.'
}

const ACCESS = 'admin_access_token'
const REFRESH = 'admin_refresh_token'
const EXPIRES = 'admin_access_expires_at'

/** Staff password step completed; WebAuthn assertion still required. */
export type LoginMfaPending = { status: 'mfa_pending'; mfaToken: string }

export type LoginResult =
  | { status: 'authed' }
  | LoginMfaPending
  | { status: 'error'; error: ApiErr }

type AuthState = {
  accessToken: string | null
  email: string | null
  role: string | null
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  login: (email: string, password: string) => Promise<LoginResult>
  /** Complete WebAuthn MFA after `login` returned `mfa_pending`. */
  finishMfaWebAuthn: (mfaToken: string) => Promise<LoginResult>
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
    const res = await fetch(adminApiUrl('/v1/admin/auth/refresh'), {
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
      const url = adminApiUrl(path)
      const headers = new Headers(init.headers)
      const t = localStorage.getItem(ACCESS)
      if (t) headers.set('Authorization', `Bearer ${t}`)
      if (!headers.has('X-Request-Id')) {
        headers.set('X-Request-Id', crypto.randomUUID())
      }
      let res = await fetch(url, { ...init, headers })
      if (
        res.status === 401 &&
        !path.includes('/v1/admin/auth/refresh') &&
        !path.includes('/v1/admin/auth/login') &&
        !path.includes('/v1/admin/auth/mfa/webauthn')
      ) {
        const ok = await refreshAccessInner()
        if (ok) {
          const t2 = localStorage.getItem(ACCESS)
          if (t2) headers.set('Authorization', `Bearer ${t2}`)
          res = await fetch(url, { ...init, headers })
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

  const persistTokenResponse = useCallback(
    async (j: { access_token: string; refresh_token: string; expires_at: number }) => {
      persistTokens(j.access_token, j.refresh_token, j.expires_at)
      await refreshMe()
    },
    [persistTokens, refreshMe],
  )

  const login = useCallback(
    async (e: string, password: string): Promise<LoginResult> => {
      try {
        const res = await fetch(adminApiUrl('/v1/admin/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: e, password }),
        })
        let raw: Record<string, unknown> = {}
        try {
          raw = (await res.json()) as Record<string, unknown>
        } catch {
          /* non-JSON body */
        }
        if (res.ok) {
          if (raw.mfa_required === true && typeof raw.mfa_token === 'string') {
            return { status: 'mfa_pending', mfaToken: raw.mfa_token }
          }
          const access = raw.access_token
          const refresh = raw.refresh_token
          const expRaw = raw.expires_at
          const exp =
            typeof expRaw === 'number'
              ? expRaw
              : typeof expRaw === 'string'
                ? Number.parseInt(expRaw, 10)
                : NaN
          if (
            typeof access === 'string' &&
            typeof refresh === 'string' &&
            Number.isFinite(exp)
          ) {
            await persistTokenResponse({ access_token: access, refresh_token: refresh, expires_at: exp })
            return { status: 'authed' }
          }
          return {
            status: 'error',
            error: {
              code: 'invalid_response',
              status: res.status,
              message: 'Unexpected sign-in response from server.',
            },
          }
        }
        const parsed = apiErrFromBody(raw, res.status)
        if (parsed) return { status: 'error', error: parsed }
        const unreachable =
          res.status === 502 || res.status === 503 || res.status === 504
        const missingOrigin404 =
          res.status === 404 && !adminApiOriginConfigured()
        return {
          status: 'error',
          error: {
            code: 'upstream_error',
            status: res.status,
            message: missingOrigin404
              ? 'Sign-in hit the admin host instead of the core API (HTTP 404). Set VITE_ADMIN_API_ORIGIN to your public API base URL in Vercel (Environment Variables), redeploy, and ensure CORS allows this origin.'
              : unreachable
                ? 'Backend unreachable. From the repo root run npm run dev:api and ensure Postgres is running (e.g. npm run compose:up).'
                : `Sign-in failed (HTTP ${res.status}).`,
          },
        }
      } catch {
        return {
          status: 'error',
          error: {
            code: 'network',
            status: 0,
            message: adminLoginNetworkMessage(),
          },
        }
      }
    },
    [persistTokenResponse],
  )

  const finishMfaWebAuthn = useCallback(
    async (mfaToken: string): Promise<LoginResult> => {
      try {
        const { startAuthentication } = await import('@simplewebauthn/browser')
        const beginRes = await fetch(adminApiUrl('/v1/admin/auth/mfa/webauthn/begin'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mfa_token: mfaToken }),
        })
        if (!beginRes.ok) {
          const parsed = await readApiError(beginRes.clone())
          if (parsed) return { status: 'error', error: parsed }
          const missingOrigin404 =
            beginRes.status === 404 && !adminApiOriginConfigured()
          return {
            status: 'error',
            error: {
              code: 'mfa_begin_failed',
              status: beginRes.status,
              message: missingOrigin404
                ? 'MFA request hit the admin host instead of the core API (HTTP 404). Set VITE_ADMIN_API_ORIGIN in Vercel and redeploy.'
                : `MFA step failed (HTTP ${beginRes.status}).`,
            },
          }
        }
        let beginJson: {
          session_key?: string
          options?: Record<string, unknown>
        } = {}
        try {
          beginJson = (await beginRes.json()) as {
            session_key?: string
            options?: Record<string, unknown>
          }
        } catch {
          return {
            status: 'error',
            error: {
              code: 'invalid_response',
              status: 500,
              message: 'Invalid MFA begin response.',
            },
          }
        }
        if (!beginJson.session_key || !beginJson.options) {
          return {
            status: 'error',
            error: {
              code: 'invalid_response',
              status: 500,
              message: 'Missing session_key or options from MFA begin.',
            },
          }
        }
        let credentialJSON: unknown
        try {
          credentialJSON = await startAuthentication({
            optionsJSON: beginJson.options as unknown as PublicKeyCredentialRequestOptionsJSON,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Security key step was cancelled or failed.'
          return {
            status: 'error',
            error: { code: 'webauthn_error', status: 0, message: msg },
          }
        }
        const finishRes = await fetch(adminApiUrl('/v1/admin/auth/mfa/webauthn/finish'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-WebAuthn-Session-Key': beginJson.session_key,
            'X-MFA-Token': mfaToken,
          },
          body: JSON.stringify(credentialJSON),
        })
        let raw: Record<string, unknown> = {}
        try {
          raw = (await finishRes.json()) as Record<string, unknown>
        } catch {
          /* non-JSON */
        }
        if (!finishRes.ok) {
          const parsed = apiErrFromBody(raw, finishRes.status)
          if (parsed) return { status: 'error', error: parsed }
          return {
            status: 'error',
            error: {
              code: 'mfa_finish_failed',
              status: finishRes.status,
              message: `MFA verification failed (HTTP ${finishRes.status}).`,
            },
          }
        }
        const access = raw.access_token
        const refresh = raw.refresh_token
        const expRaw = raw.expires_at
        const exp =
          typeof expRaw === 'number'
            ? expRaw
            : typeof expRaw === 'string'
              ? Number.parseInt(expRaw, 10)
              : NaN
        if (
          typeof access !== 'string' ||
          typeof refresh !== 'string' ||
          !Number.isFinite(exp)
        ) {
          return {
            status: 'error',
            error: {
              code: 'invalid_response',
              status: finishRes.status,
              message: 'Unexpected MFA finish response.',
            },
          }
        }
        await persistTokenResponse({ access_token: access, refresh_token: refresh, expires_at: exp })
        return { status: 'authed' }
      } catch {
        return {
          status: 'error',
          error: {
            code: 'network',
            status: 0,
            message: 'Cannot complete MFA. Check network and try again.',
          },
        }
      }
    },
    [persistTokenResponse],
  )

  const logout = useCallback(async () => {
    const rt = localStorage.getItem(REFRESH)
    const t = localStorage.getItem(ACCESS)
    if (rt) {
      await fetch(adminApiUrl('/v1/admin/auth/logout'), {
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
      finishMfaWebAuthn,
      logout,
      refreshMe,
    }),
    [accessToken, email, role, apiFetch, login, finishMfaWebAuthn, logout, refreshMe],
  )

  return <Ctx.Provider value={v}>{children}</Ctx.Provider>
}

export function useAdminAuth() {
  const x = useContext(Ctx)
  if (!x) throw new Error('AdminAuthProvider missing')
  return x
}
