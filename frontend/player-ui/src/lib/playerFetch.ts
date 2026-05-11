import { emitPlayerBarrierFromBody } from './playerBarrierSync'
import { playerApiUrl } from './playerApiUrl'

/** Cookie name for double-submit CSRF (must match core `playercookies.CSRFCookieName`). */
export const PLAYER_CSRF_COOKIE = 'cc_player_csrf'

/** When true, send cookies on same-origin / CORS credentialed player API calls (enable with PLAYER_COOKIE_AUTH on core). */
export const playerCredentialsMode =
  import.meta.env.VITE_PLAYER_CREDENTIALS === '1' ||
  import.meta.env.VITE_PLAYER_CREDENTIALS === 'true'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const parts = document.cookie.split(';')
  for (const p of parts) {
    const i = p.indexOf('=')
    if (i === -1) continue
    const k = p.slice(0, i).trim()
    if (k !== name) continue
    return decodeURIComponent(p.slice(i + 1).trim())
  }
  return null
}

function unsafeMethod(method: string | undefined): boolean {
  const m = (method || 'GET').toUpperCase()
  return m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE'
}

/** Attach X-CSRF-Token from the readable cookie for mutating requests (cookie-auth mode). */
export function applyPlayerMutatingCSRF(headers: Headers, method: string | undefined): void {
  if (!playerCredentialsMode || !unsafeMethod(method)) return
  const tok = readCookie(PLAYER_CSRF_COOKIE)
  if (tok) headers.set('X-CSRF-Token', tok)
}

/**
 * Parse `code` from core JSON error bodies. `playerapi.WriteError` uses `{ "error": { "code", "message" } }`.
 */
export function parsePlayerApiErrorCode(bodyText: string): string | undefined {
  try {
    const j = JSON.parse(bodyText) as { code?: string; error?: { code?: string } }
    if (typeof j.code === 'string' && j.code.trim()) return j.code.trim()
    const nested = j.error?.code
    if (typeof nested === 'string' && nested.trim()) return nested.trim()
  } catch {
    /* ignore */
  }
  return undefined
}

/** Browser fetch to the player API with a per-request id (echoed by the server when possible). */
export function playerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  applyPlayerMutatingCSRF(headers, init.method)
  if (!headers.has('X-Request-Id')) {
    headers.set('X-Request-Id', crypto.randomUUID())
  }
  const credentials: RequestCredentials =
    init.credentials ?? (playerCredentialsMode ? 'include' : 'omit')
  return fetch(playerApiUrl(path), { ...init, credentials, headers }).then((res) => {
    if (!res.ok) {
      const ct = (res.headers.get('content-type') || '').toLowerCase()
      if (ct.includes('json')) {
        res
          .clone()
          .text()
          .then((t) => emitPlayerBarrierFromBody(t))
          .catch(() => undefined)
      }
    }
    return res
  })
}
