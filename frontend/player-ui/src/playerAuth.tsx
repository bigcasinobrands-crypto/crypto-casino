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
import { useNavigate } from 'react-router-dom'

import { apiErrFromResponse, type ApiErr } from './api/errors'
import { cachePlayerAvatarUrl, readCachedPlayerAvatarUrl } from './lib/avatarCache'
import { augmentFingerprintRequiredError, getAuthFingerprintPayload } from './lib/authFingerprint'
import { applyPlayerMutatingCSRF, playerCredentialsMode, playerFetch } from './lib/playerFetch'
import { messageCannotReachApi } from './lib/playerNetworkCopy'
import { playerApiOriginConfigured, playerApiUrl } from './lib/playerApiUrl'
import { peekPendingReferralCode, clearPendingReferralCode } from './lib/referralPendingStorage'
import { mergeServerFavouritesOnLogin } from './lib/gameStorage'
import {
  clearPlayerWalletBalanceCache,
  readPlayerWalletBalanceCache,
  writePlayerWalletBalanceCache,
} from './lib/playerWalletBalanceCache'
import {
  PLAYER_CHROME_CLOSE_CHAT_EVENT,
  PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT,
  PLAYER_CHROME_CLOSE_NOTIFICATIONS_EVENT,
  PLAYER_CHROME_CLOSE_REWARDS_EVENT,
  PLAYER_CHROME_CLOSE_WALLET_EVENT,
  PLAYER_CHROME_IMMERSIVE_CASINO_PLAY_EVENT,
  type PlayerChromeImmersiveCasinoPlayDetail,
} from './lib/playerChromeEvents'

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
  email_2fa_enabled?: boolean
  email_2fa_admin_locked?: boolean
  /** Identity verification status for withdrawals (KYCAID / manual): none | pending | approved | rejected */
  kyc_status?: string
  kyc_reject_reason?: string
  /** Internal/compliance hint when a withdrawal gate fired (UX-only). */
  kyc_required_reason?: string
}

export type LoginResult =
  | { kind: 'session' }
  | { kind: 'email_mfa'; mfa_token: string; expires_in_seconds: number }
  | { kind: 'error'; error: ApiErr | null }

export type BalanceBreakdown = {
  cashMinor: number
  bonusLockedMinor: number
  /** Remaining bonus playthrough to stake (minor units, same ledger currency as cash/bonus) */
  wageringRemainingMinor: number
}

function readInitialWalletBalanceState(): {
  balanceMinor: number | null
  balanceBreakdown: BalanceBreakdown | null
  playableBalanceCurrency: string | null
} {
  const likelySession =
    typeof localStorage !== 'undefined' &&
    (!!localStorage.getItem(ACCESS) || playerCredentialsMode)
  if (!likelySession) {
    return { balanceMinor: null, balanceBreakdown: null, playableBalanceCurrency: null }
  }
  const c = readPlayerWalletBalanceCache()
  if (!c) {
    return { balanceMinor: null, balanceBreakdown: null, playableBalanceCurrency: null }
  }
  return {
    balanceMinor: c.balance_minor,
    balanceBreakdown: {
      cashMinor: c.cash_minor,
      bonusLockedMinor: c.bonus_locked_minor,
      wageringRemainingMinor: typeof c.wagering_remaining_minor === 'number' ? c.wagering_remaining_minor : 0,
    },
    playableBalanceCurrency: c.currency,
  }
}

type P = {
  accessToken: string | null
  /** True when JWT is in memory/localStorage or cookie session is established (`me` loaded under credentialed API). */
  isAuthenticated: boolean
  me: MeResponse | null
  /** Incremented when the profile photo URL changes so `<img src>` can bypass stale CDN/browser caches. */
  avatarUrlRevision: number
  balanceMinor: number | null
  balanceBreakdown: BalanceBreakdown | null
  /** Ledger currency for playable balance (BLUEOCEAN_CURRENCY / seamless); may differ from deposit rail symbol in header. */
  playableBalanceCurrency: string | null
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>
  /** Apply a new avatar path immediately after upload (before `/me` poll). Updates cache and revision for display URLs. */
  setAvatarUrl: (avatarPath: string) => void
  login: (
    email: string,
    password: string,
    captchaToken?: string,
  ) => Promise<LoginResult>
  completeLoginEmailMfa: (
    mfaToken: string,
    code: string,
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

function dismissPlayerChromeOverlays() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_WALLET_EVENT))
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_REWARDS_EVENT))
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_NOTIFICATIONS_EVENT))
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_CHAT_EVENT))
  window.dispatchEvent(new CustomEvent(PLAYER_CHROME_CLOSE_MOBILE_MENU_EVENT))
  window.dispatchEvent(
    new CustomEvent<PlayerChromeImmersiveCasinoPlayDetail>(PLAYER_CHROME_IMMERSIVE_CASINO_PLAY_EVENT, {
      detail: { active: false },
    }),
  )
}

export function PlayerAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [accessToken, setAccess] = useState<string | null>(() => readInitialAccessToken())
  const initialBal = readInitialWalletBalanceState()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [avatarUrlRevision, setAvatarUrlRevision] = useState(0)
  const [balanceMinor, setBal] = useState<number | null>(() => initialBal.balanceMinor)
  const [balanceBreakdown, setBalanceBreakdown] = useState<BalanceBreakdown | null>(
    () => initialBal.balanceBreakdown,
  )
  const [playableBalanceCurrency, setPlayableBalanceCurrency] = useState<string | null>(
    () => initialBal.playableBalanceCurrency,
  )
  const meIdRef = useRef<string | null>(null)
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
    setAvatarUrlRevision(0)
    setBal(null)
    setBalanceBreakdown(null)
    setPlayableBalanceCurrency(null)
    clearPlayerWalletBalanceCache()
  }, [clearRefreshTimer])

  const setAvatarUrl = useCallback((avatarPath: string) => {
    const u = avatarPath.trim()
    if (!u) return
    setMe((prev) => {
      if (!prev) return prev
      cachePlayerAvatarUrl(prev.id, u)
      return { ...prev, avatar_url: u }
    })
    setAvatarUrlRevision((n) => n + 1)
  }, [])

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
    const fpRes = await getAuthFingerprintPayload()
    if (!fpRes.ok) {
      clearSession()
      return false
    }
    const base = rt ? { refresh_token: rt } : {}
    const res = await playerFetch('/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, ...fpRes.extra }),
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

  useEffect(() => {
    meIdRef.current = me?.id ?? null
  }, [me?.id])

  useEffect(() => {
    if (!me?.id) return
    const c = readPlayerWalletBalanceCache()
    if (c && c.userId !== me.id) {
      clearPlayerWalletBalanceCache()
      setBal(null)
      setBalanceBreakdown(null)
      setPlayableBalanceCurrency(null)
    }
  }, [me?.id])

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
        !path.includes('/v1/auth/login/email-mfa') &&
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
    try {
      const t = localStorage.getItem(ACCESS)
      if (!t && !playerCredentialsMode) return
      let resolvedUserId: string | null = null
      const m = await apiFetch('/v1/auth/me')
      if (m.ok) {
        const j = (await m.json()) as MeResponse
        resolvedUserId = j.id
        setMe((prev) => {
          const sameUser = prev?.id === j.id
          let avatar = typeof j.avatar_url === 'string' ? j.avatar_url.trim() : ''
          if (!avatar) {
            avatar = sameUser && prev?.avatar_url ? prev.avatar_url.trim() : ''
          }
          if (!avatar) {
            const cached = readCachedPlayerAvatarUrl(j.id)
            if (cached) avatar = cached
          }
          const merged: MeResponse = {
            ...j,
            ...(avatar ? { avatar_url: avatar } : {}),
          }
          if (merged.avatar_url) {
            cachePlayerAvatarUrl(merged.id, merged.avatar_url)
          }
          return merged
        })
      } else if (m.status === 401) {
        setMe(null)
      }
      const bal = await apiFetch('/v1/wallet/balance')
      if (bal.ok) {
        const j = (await bal.json()) as {
          balance_minor: number
          cash_minor?: number
          bonus_locked_minor?: number
          wagering_remaining_minor?: number
          currency?: string
        }
        setBal(j.balance_minor)
        const c = typeof j.currency === 'string' && j.currency.trim() ? j.currency.trim().toUpperCase() : null
        setPlayableBalanceCurrency(c)
        const cash = typeof j.cash_minor === 'number' ? j.cash_minor : j.balance_minor
        const bonus = typeof j.bonus_locked_minor === 'number' ? j.bonus_locked_minor : 0
        const wagerRem = typeof j.wagering_remaining_minor === 'number' ? j.wagering_remaining_minor : 0
        setBalanceBreakdown({ cashMinor: cash, bonusLockedMinor: bonus, wageringRemainingMinor: wagerRem })
        if (resolvedUserId) {
          writePlayerWalletBalanceCache({
            userId: resolvedUserId,
            balance_minor: j.balance_minor,
            cash_minor: cash,
            bonus_locked_minor: bonus,
            wagering_remaining_minor: wagerRem,
            currency: c ?? 'EUR',
          })
        }
      }
    } catch {
      // fetch / json can throw; never leak unhandled rejections (Oddin calls onRefreshBalance with void).
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

  useEffect(() => {
    if (!me?.id) return
    let cancelled = false
    void (async () => {
      await mergeServerFavouritesOnLogin(apiFetch)
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [me?.id, apiFetch])

  const login = useCallback(
    async (email: string, password: string, captchaToken?: string): Promise<LoginResult> => {
      let res: Response
      try {
        const fpRes = await getAuthFingerprintPayload()
        if (!fpRes.ok) {
          return {
            kind: 'error',
            error: {
              code: 'fingerprint_required',
              status: 400,
              message: fpRes.message,
            },
          }
        }
        res = await playerFetch('/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            ...(captchaToken ? { captcha_token: captchaToken } : {}),
            ...fpRes.extra,
          }),
        })
      } catch {
        return {
          kind: 'error',
          error: {
            code: 'network',
            status: 0,
            message: messageCannotReachApi(),
          },
        }
      }
      if (!res.ok) {
        const missingOrigin =
          import.meta.env.PROD &&
          !playerApiOriginConfigured() &&
          (res.status === 404 || res.status === 405)
        return {
          kind: 'error',
          error: augmentFingerprintRequiredError(
            await apiErrFromResponse(
              res,
              missingOrigin
                ? 'Sign-in hit the player site, not the API. Set VITE_PLAYER_API_ORIGIN in Vercel to your core API https origin and redeploy; add this player URL to PLAYER_CORS_ORIGINS on the API.'
                : undefined,
            ),
          ),
        }
      }
      const j = (await res.json()) as {
        email_mfa_required?: boolean
        mfa_token?: string
        expires_in_seconds?: number
        access_token?: string
        refresh_token?: string
        expires_at?: number
      }
      if (j.email_mfa_required && typeof j.mfa_token === 'string' && j.mfa_token.trim()) {
        return {
          kind: 'email_mfa',
          mfa_token: j.mfa_token.trim(),
          expires_in_seconds: typeof j.expires_in_seconds === 'number' ? j.expires_in_seconds : 600,
        }
      }
      if (!Number.isFinite(j.expires_at)) {
        return {
          kind: 'error',
          error: {
            code: 'invalid_session',
            message: 'Incomplete token response',
            status: 0,
          } as ApiErr,
        }
      }
      if (!playerCredentialsMode && (!j.access_token?.trim() || !j.refresh_token?.trim())) {
        return {
          kind: 'error',
          error: {
            code: 'invalid_session',
            message: 'Incomplete token response',
            status: 0,
          } as ApiErr,
        }
      }
      applySessionTokens(j.access_token ?? '', j.refresh_token ?? '', j.expires_at!)
      await refreshProfile()
      return { kind: 'session' }
    },
    [applySessionTokens, refreshProfile],
  )

  const completeLoginEmailMfa = useCallback(
    async (
      mfaToken: string,
      code: string,
      captchaToken?: string,
    ): Promise<{ ok: true } | { ok: false; error: ApiErr | null }> => {
      let res: Response
      try {
        const fpRes = await getAuthFingerprintPayload()
        if (!fpRes.ok) {
          return {
            ok: false,
            error: {
              code: 'fingerprint_required',
              status: 400,
              message: fpRes.message,
            },
          }
        }
        res = await playerFetch('/v1/auth/login/email-mfa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mfa_token: mfaToken,
            code,
            ...(captchaToken ? { captcha_token: captchaToken } : {}),
            ...fpRes.extra,
          }),
        })
      } catch {
        return {
          ok: false,
          error: {
            code: 'network',
            status: 0,
            message: messageCannotReachApi(),
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
          error: augmentFingerprintRequiredError(
            await apiErrFromResponse(
              res,
              missingOrigin
                ? 'Sign-in hit the player site, not the API. Set VITE_PLAYER_API_ORIGIN in Vercel to your core API https origin and redeploy.'
                : undefined,
            ),
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
        const fpRes = await getAuthFingerprintPayload()
        if (!fpRes.ok) {
          return {
            ok: false,
            error: {
              code: 'fingerprint_required',
              status: 400,
              message: fpRes.message,
            },
          }
        }
        const referralCode = peekPendingReferralCode()
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
            ...(referralCode ? { referral_code: referralCode } : {}),
            ...fpRes.extra,
          }),
        })
      } catch {
        return {
          ok: false,
          error: {
            code: 'network',
            status: 0,
            message: messageCannotReachApi(),
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
          error: augmentFingerprintRequiredError(
            await apiErrFromResponse(
              res,
              missingOrigin
                ? 'Register hit the player site, not the API. Set VITE_PLAYER_API_ORIGIN in Vercel and redeploy.'
                : undefined,
            ),
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
      clearPendingReferralCode()
      await refreshProfile()
      return { ok: true }
    },
    [applySessionTokens, refreshProfile],
  )

  const logout = useCallback(async () => {
    const rt = localStorage.getItem(REFRESH)
    const t = localStorage.getItem(ACCESS)
    const cred: RequestCredentials = playerCredentialsMode ? 'include' : 'omit'
    try {
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
    } catch {
      /* still leave client session */
    }
    clearSession()
    dismissPlayerChromeOverlays()
    navigate('/casino/games', { replace: true })
  }, [clearSession, navigate])

  // Live balance: SSE for push updates; infrequent poll only as a safety net if the stream drops.
  useEffect(() => {
    if (!isAuthenticated) return
    void refreshProfile()
    const t = window.setInterval(() => void refreshProfile(), 120_000)
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
                    wagering_remaining_minor?: number
                    currency?: string
                  }
                  if (typeof j.balance_minor === 'number') {
                    setBal(j.balance_minor)
                  }
                  if (typeof j.currency === 'string' && j.currency.trim()) {
                    setPlayableBalanceCurrency(j.currency.trim().toUpperCase())
                  }
                  if (
                    typeof j.cash_minor === 'number' &&
                    typeof j.bonus_locked_minor === 'number'
                  ) {
                    const wagerRem =
                      typeof j.wagering_remaining_minor === 'number' ? j.wagering_remaining_minor : 0
                    setBalanceBreakdown({
                      cashMinor: j.cash_minor,
                      bonusLockedMinor: j.bonus_locked_minor,
                      wageringRemainingMinor: wagerRem,
                    })
                  }
                  const uid = meIdRef.current
                  if (
                    uid &&
                    typeof j.balance_minor === 'number' &&
                    typeof j.cash_minor === 'number' &&
                    typeof j.bonus_locked_minor === 'number'
                  ) {
                    const ccy =
                      typeof j.currency === 'string' && j.currency.trim()
                        ? j.currency.trim().toUpperCase()
                        : 'EUR'
                    const wagerRem =
                      typeof j.wagering_remaining_minor === 'number' ? j.wagering_remaining_minor : 0
                    writePlayerWalletBalanceCache({
                      userId: uid,
                      balance_minor: j.balance_minor,
                      cash_minor: j.cash_minor,
                      bonus_locked_minor: j.bonus_locked_minor,
                      wagering_remaining_minor: wagerRem,
                      currency: ccy,
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
      avatarUrlRevision,
      balanceMinor,
      balanceBreakdown,
      playableBalanceCurrency,
      apiFetch,
      setAvatarUrl,
      login,
      completeLoginEmailMfa,
      register,
      logout,
      refreshProfile,
      refreshAccess,
    }),
    [
      accessToken,
      isAuthenticated,
      me,
      avatarUrlRevision,
      balanceMinor,
      balanceBreakdown,
      playableBalanceCurrency,
      apiFetch,
      setAvatarUrl,
      login,
      completeLoginEmailMfa,
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
