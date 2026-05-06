import type { ApiErr } from '../api/errors'
import {
  FINGERPRINT_AUTH_TIMEOUT_MS,
  getIdentificationWithTimeout,
  isFingerprintEnabled,
} from './fingerprintClient'

export type AuthFingerprintPayloadResult =
  | { ok: true; extra: Record<string, string> }
  | { ok: false; message: string }

/**
 * When the API requires Fingerprint but this build has no public key, the server returns
 * fingerprint_required with an empty body field — add context for local / misconfigured clients.
 */
export function augmentFingerprintRequiredError(err: ApiErr): ApiErr {
  if (err.code !== 'fingerprint_required') return err
  if (isFingerprintEnabled()) return err
  const hint = import.meta.env.DEV
    ? " Local dev: your API expects browser identification. Either set VITE_FINGERPRINT_PUBLIC_KEY (and VITE_FINGERPRINT_REGION) in .env.development, or point DEV_API_PROXY at http://127.0.0.1:9090 and run core with APP_ENV=development / REQUIRE_FINGERPRINT_PLAYER_AUTH unset."
    : ' Configure VITE_FINGERPRINT_PUBLIC_KEY and VITE_FINGERPRINT_REGION for this deploy; allow this origin in the Fingerprint dashboard.'
  const base = err.message?.trim() || 'fingerprint_request_id is required.'
  return { ...err, message: `${base}${hint}` }
}

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
        'Browser identification did not complete. In Vercel, set VITE_FINGERPRINT_PUBLIC_KEY and VITE_FINGERPRINT_REGION (eu/us/ap) to match your Fingerprint app. In the Fingerprint dashboard: Security → allowed domains must include this site. Disable ad blockers and try again.',
    }
  }
  const extra: Record<string, string> = { fingerprint_request_id: fp.requestId }
  if (fp.visitorId) extra.fingerprint_visitor_id = fp.visitorId
  return { ok: true, extra }
}
