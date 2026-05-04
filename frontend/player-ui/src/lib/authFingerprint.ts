import {
  FINGERPRINT_AUTH_TIMEOUT_MS,
  getIdentificationWithTimeout,
  isFingerprintEnabled,
} from './fingerprintClient'

export type AuthFingerprintPayloadResult =
  | { ok: true; extra: Record<string, string> }
  | { ok: false; message: string }

/**
 * Fields for login/register/refresh. When the player build has VITE_FINGERPRINT_PUBLIC_KEY,
 * identification must succeed or the result is ok:false (server also enforces when configured).
 */
export async function getAuthFingerprintPayload(): Promise<AuthFingerprintPayloadResult> {
  if (!isFingerprintEnabled()) {
    return { ok: true, extra: {} }
  }
  const fp = await getIdentificationWithTimeout(FINGERPRINT_AUTH_TIMEOUT_MS)
  if (!fp?.requestId) {
    return {
      ok: false,
      message:
        'Browser identification did not complete. Disable ad blockers, allow third-party scripts, or try another browser.',
    }
  }
  const extra: Record<string, string> = { fingerprint_request_id: fp.requestId }
  if (fp.visitorId) extra.fingerprint_visitor_id = fp.visitorId
  return { ok: true, extra }
}
