type FingerprintAgent = Awaited<
  ReturnType<(typeof import('@fingerprintjs/fingerprintjs-pro'))['default']['load']>
>

let agent: FingerprintAgent | null = null

/** Must match the workspace region in the Fingerprint dashboard (eu / us / ap). Defaults to us when unset — EU workspaces need `eu` or events never reach the dashboard. */
function regionOption(): 'us' | 'eu' | 'ap' | undefined {
  const r = import.meta.env.VITE_FINGERPRINT_REGION
  if (typeof r !== 'string') return undefined
  const x = r.trim().toLowerCase()
  if (x === 'eu' || x === 'us' || x === 'ap') return x
  return undefined
}

function publicKey(): string | undefined {
  const k = import.meta.env.VITE_FINGERPRINT_PUBLIC_KEY
  return typeof k === 'string' && k.trim() !== '' ? k.trim() : undefined
}

/** True when the player build has a public API key (dashboard → Public). */
export function isFingerprintEnabled(): boolean {
  return publicKey() !== undefined
}

async function getAgent(): Promise<FingerprintAgent | null> {
  const key = publicKey()
  if (!key) return null
  if (!agent) {
    const { default: FingerprintJS } = await import('@fingerprintjs/fingerprintjs-pro')
    const region = regionOption()
    agent = await FingerprintJS.load(region ? { apiKey: key, region } : { apiKey: key })
  }
  return agent
}

/** Default bound for auth flows (login/register/refresh) so identification completes before JSON POST. */
export const FINGERPRINT_AUTH_TIMEOUT_MS = 5000

/** Default bound for traffic analytics beacons (can wait longer for slow EU networks). */
export const FINGERPRINT_TRAFFIC_TIMEOUT_MS = 12_000

/**
 * Full identification; use for user-driven actions (withdraw) where we wait for success or failure.
 * Returns null when Fingerprint is not configured or identification fails.
 */
export async function getFingerprintForAction(): Promise<{
  visitorId: string
  requestId: string
} | null> {
  try {
    const fp = await getAgent()
    if (!fp) return null
    const r = await fp.get()
    const requestId = typeof r.requestId === 'string' ? r.requestId : ''
    const visitorId = typeof r.visitorId === 'string' ? r.visitorId : ''
    if (!requestId) return null
    return { visitorId, requestId }
  } catch (e) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn('[fingerprint] get() failed — check VITE_FINGERPRINT_PUBLIC_KEY, VITE_FINGERPRINT_REGION, ad blockers, and Fingerprint dashboard allowed domains', e)
    }
    return null
  }
}

/**
 * Identification bounded by `timeoutMs` so auth and analytics never stall indefinitely.
 * Same identification contract as {@link getFingerprintForAction}; returns null on timeout.
 */
export async function getIdentificationWithTimeout(
  timeoutMs: number,
): Promise<{ visitorId: string; requestId: string } | null> {
  return Promise.race([
    getFingerprintForAction(),
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ])
}

/**
 * Run one identification on app load so Fingerprint’s “Verify installation” and EU latency see an event
 * even if the traffic analytics effect dedupes or runs late.
 */
export function bootstrapFingerprintIdentification(): void {
  if (!isFingerprintEnabled()) return
  void getFingerprintForAction().catch(() => {
    /* errors logged in getFingerprintForAction in DEV */
  })
}
