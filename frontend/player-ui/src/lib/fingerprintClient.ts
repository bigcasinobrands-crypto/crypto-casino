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

/**
 * Returns visitorId + requestId for attaching to sensitive API calls (e.g. withdrawal).
 * Resolves null when Fingerprint is not configured or identification fails.
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
  } catch {
    return null
  }
}
