import { getFingerprintForAction } from './fingerprintClient'

/** Optional fields appended to login/register/refresh JSON when Fingerprint Pro is configured client-side. */
export async function getAuthFingerprintPayload(): Promise<{
  fingerprint_request_id?: string
  fingerprint_visitor_id?: string
}> {
  const fp = await Promise.race([
    getFingerprintForAction(),
    new Promise<null>((r) => setTimeout(() => r(null), 4000)),
  ])
  if (!fp?.requestId) return {}
  const out: { fingerprint_request_id?: string; fingerprint_visitor_id?: string } = {
    fingerprint_request_id: fp.requestId,
  }
  if (fp.visitorId) out.fingerprint_visitor_id = fp.visitorId
  return out
}
