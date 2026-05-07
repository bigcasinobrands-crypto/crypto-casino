// Package legacy holds documentation for optional integrations that are off by default.
//
// Fingerprint Pro (browser + Server API) — opt-in only:
//   Core: REQUIRE_FINGERPRINT_PLAYER_AUTH=true, FINGERPRINT_SECRET_API_KEY, FINGERPRINT_API_BASE_URL
//         (eu: https://eu.api.fpjs.io). Optionally WITHDRAW_REQUIRE_FINGERPRINT=true.
//   Player: VITE_FINGERPRINT_ENABLED=1, VITE_FINGERPRINT_PUBLIC_KEY, VITE_FINGERPRINT_REGION (eu|us|ap).
//
// Without those, login, withdrawal, and traffic analytics do not require fingerprint_request_id.
//
// If a deploy still enforces fingerprint due to old env, set DISABLE_FINGERPRINT_PLAYER_AUTH=1 on core (overrides REQUIRE_* and WITHDRAW_REQUIRE_FINGERPRINT).
package legacy
