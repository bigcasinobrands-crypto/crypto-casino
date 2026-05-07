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
    ? " The API you are calling still enforces fingerprint_request_id (usually REQUIRE_FINGERPRINT_PLAYER_AUTH=true on the host, or an older core build). On the core host: set REQUIRE_FINGERPRINT_PLAYER_AUTH=false, or set DISABLE_FINGERPRINT_PLAYER_AUTH=1, redeploy, and check logs for “fingerprint player auth effective”. Or use DEV_API_PROXY=http://127.0.0.1:9090 with local core (APP_ENV=development). To re-enable legacy FP: VITE_FINGERPRINT_ENABLED=1 plus public key and region."
    : ' Your API host still requires fingerprint_request_id — set REQUIRE_FINGERPRINT_PLAYER_AUTH=false or DISABLE_FINGERPRINT_PLAYER_AUTH=1 on core and redeploy. Legacy player FP: VITE_FINGERPRINT_ENABLED=1, VITE_FINGERPRINT_PUBLIC_KEY, VITE_FINGERPRINT_REGION.'
  const base = err.message?.trim() || 'fingerprint_request_id is required.'
  return { ...err, message: `${base}${hint}` }
}

/**
 * Fields for login/register/refresh. When the player build has legacy FP enabled (VITE_FINGERPRINT_ENABLED + public key),
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
