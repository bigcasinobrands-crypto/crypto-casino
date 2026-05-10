/** Mirrors backend `affiliate.NormalizeReferralCode` for client-side stash keys. */
export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase()
}

const STORAGE_KEY = 'cc_player_pending_referral_v1'
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_LEN = 48

type Stored = { code: string; ts: number }

function parseStored(raw: string | null): Stored | null {
  if (!raw) return null
  try {
    const j = JSON.parse(raw) as Partial<Stored>
    if (typeof j.code !== 'string' || typeof j.ts !== 'number') return null
    const code = normalizeReferralCode(j.code).slice(0, MAX_LEN)
    if (!code) return null
    if (Date.now() - j.ts > TTL_MS) return null
    return { code, ts: j.ts }
  } catch {
    return null
  }
}

/** Persist referral from `?ref=` until registration succeeds (JWT mode cannot rely on cross-origin HttpOnly cookies). */
export function stashPendingReferralFromUrl(raw: string): void {
  const code = normalizeReferralCode(raw).slice(0, MAX_LEN)
  if (!code || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ code, ts: Date.now() } satisfies Stored))
  } catch {
    /* quota / private mode */
  }
}

/** Code to send on `POST /v1/auth/register` (does not clear — clear after successful register). */
export function peekPendingReferralCode(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const v = parseStored(window.localStorage.getItem(STORAGE_KEY))
    return v?.code
  } catch {
    return undefined
  }
}

export function clearPendingReferralCode(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
