import { getFingerprintForAction } from './fingerprintClient'

/** Optional fields appended to login/register/refresh JSON when Fingerprint Pro is configured client-side. */
export async function getAuthFingerprintPayload(): Promise<{
  fingerprint_request_id?: string
  fingerprint_visitor_id?: string
}> {
  // Keep this short so login/register are not delayed when the agent is blocked or slow.
  const fp = await Promise.race([
    getFingerprintForAction(),
    new Promise<null>((r) => setTimeout(() => r(null), 2500)),
  ])
  if (!fp?.requestId) return {}
  const out: { fingerprint_request_id?: string; fingerprint_visitor_id?: string } = {
    fingerprint_request_id: fp.requestId,
  }
  if (fp.visitorId) out.fingerprint_visitor_id = fp.visitorId
  return out
}
