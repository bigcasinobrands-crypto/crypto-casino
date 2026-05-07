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

/** Off unless explicitly enabled (legacy opt-in — avoids loading the SDK from a stray public key alone). */
export function isFingerprintEnabled(): boolean {
  const on = import.meta.env.VITE_FINGERPRINT_ENABLED
  if (on !== '1' && on !== 'true') return false
  return publicKey() !== undefined
}

/** Default bound for auth flows (login/register/refresh) so identification completes before JSON POST. */
export const FINGERPRINT_AUTH_TIMEOUT_MS = 18_000

/** Default bound for traffic analytics beacons (can wait longer for slow EU networks). */
export const FINGERPRINT_TRAFFIC_TIMEOUT_MS = 12_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wait until {@link bindFingerprintGetVisitorData} has run (FingerprintReactIntegration mounted).
 * Avoids login/register racing the first layout frame when `getVisitorData` was still null.
 */
export async function waitForFingerprintVisitorBinding(maxWaitMs: number): Promise<boolean> {
  if (!isFingerprintEnabled()) return true
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    if (getVisitorDataFromProvider) return true
    await sleep(50)
  }
  return getVisitorDataFromProvider !== null
}

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
    console.warn(
      '[fingerprint] getVisitorData threw — check key, VITE_FINGERPRINT_REGION, Security → allowed domains, ad blockers.',
      e,
    )
    return null
  }
}

type Identified = { visitorId: string; requestId: string }

/**
 * Identification bounded by `timeoutMs` so auth and analytics never stall indefinitely.
 * Waits for the provider binding, retries several times (EU / slow networks / flaky first paint),
 * and hard-caps each attempt with `Promise.race` so a hung SDK cannot block past the budget.
 */
export async function getIdentificationWithTimeout(timeoutMs: number): Promise<Identified | null> {
  if (!isFingerprintEnabled()) return null

  const bindBudget = Math.min(5000, Math.floor(timeoutMs * 0.3))
  const bound = await waitForFingerprintVisitorBinding(bindBudget)
  if (!bound || !getVisitorDataFromProvider) {
    console.warn(
      '[fingerprint] Visitor agent not bound — FingerprintProvider/FingerprintReactIntegration must wrap the app.',
    )
    return null
  }

  const deadline = Date.now() + timeoutMs
  const maxAttempts = 5
  const gapMs = 450

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const remaining = deadline - Date.now()
    if (remaining < 800) break

    const attemptTimeout = Math.min(10_000, Math.max(2000, remaining - (maxAttempts - attempt - 1) * gapMs))

    const result = await Promise.race([
      getFingerprintForAction({ timeout: attemptTimeout }),
      sleep(attemptTimeout + 200).then((): Identified | null => null),
    ])

    if (result?.requestId) return result

    if (attempt < maxAttempts - 1 && Date.now() < deadline) {
      await sleep(gapMs)
    }
  }

  console.warn(
    '[fingerprint] No requestId after retries. Match VITE_FINGERPRINT_PUBLIC_KEY to your Fingerprint app; set VITE_FINGERPRINT_REGION to eu/us/ap per dashboard; add this origin under Security → allowed domains; disable blockers.',
  )
  return null
}
