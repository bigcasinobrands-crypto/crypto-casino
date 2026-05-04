import type { GetOptions, GetResult } from '@fingerprint/agent'

type GetVisitorDataFn = (options?: GetOptions) => Promise<GetResult>

let getVisitorDataFromProvider: GetVisitorDataFn | null = null

/** Called from {@link FingerprintReactIntegration} so login/withdraw/traffic use the same agent as the React SDK. */
export function bindFingerprintGetVisitorData(fn: GetVisitorDataFn | null) {
  getVisitorDataFromProvider = fn
}

/**
 * Maps @fingerprint/agent get() result → API payload fields.
 * `event_id` is the canonical id for GET /events (Server API; same role as legacy `requestId` in dashboards).
 */
function mapGetResult(r: GetResult): { visitorId: string; requestId: string } | null {
  const ext = r as GetResult & { requestId?: string }
  const requestId =
    (typeof ext.event_id === 'string' && ext.event_id) ||
    (typeof ext.requestId === 'string' && ext.requestId) ||
    ''
  const visitorId = typeof r.visitor_id === 'string' ? r.visitor_id : ''
  if (!requestId) return null
  return { visitorId, requestId }
}

function publicKey(): string | undefined {
  const k = import.meta.env.VITE_FINGERPRINT_PUBLIC_KEY
  return typeof k === 'string' && k.trim() !== '' ? k.trim() : undefined
}

/** True when the player build has a public API key (dashboard → Public). */
export function isFingerprintEnabled(): boolean {
  return publicKey() !== undefined
}

/** Default bound for auth flows (login/register/refresh) so identification completes before JSON POST. */
export const FINGERPRINT_AUTH_TIMEOUT_MS = 10_000

/** Default bound for traffic analytics beacons (can wait longer for slow EU networks). */
export const FINGERPRINT_TRAFFIC_TIMEOUT_MS = 12_000

/**
 * Full identification; use for user-driven actions (withdraw) where we wait for success or failure.
 * Returns null when Fingerprint is not configured, the React provider is not mounted yet, or identification fails.
 */
export async function getFingerprintForAction(
  getOptions?: GetOptions,
): Promise<{
  visitorId: string
  requestId: string
} | null> {
  if (!isFingerprintEnabled() || !getVisitorDataFromProvider) return null
  try {
    const r = await getVisitorDataFromProvider(getOptions)
    return mapGetResult(r)
  } catch (e) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        '[fingerprint] getVisitorData failed — check VITE_FINGERPRINT_PUBLIC_KEY, VITE_FINGERPRINT_REGION, ad blockers, and Fingerprint dashboard allowed domains',
        e,
      )
    }
    return null
  }
}

/**
 * Identification bounded by `timeoutMs` so auth and analytics never stall indefinitely.
 * Same contract as {@link getFingerprintForAction}; returns null on timeout.
 */
export async function getIdentificationWithTimeout(
  timeoutMs: number,
): Promise<{ visitorId: string; requestId: string } | null> {
  return getFingerprintForAction({ timeout: timeoutMs })
}
