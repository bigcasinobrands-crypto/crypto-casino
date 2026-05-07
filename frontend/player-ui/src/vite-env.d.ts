/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Core API origin when the player app is not served behind the same host (e.g. https://api.example.com) */
  readonly VITE_PLAYER_API_ORIGIN?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
  readonly VITE_SUPPORT_URL?: string
  readonly VITE_RG_URL?: string
  /** Base URL of the admin console SPA (for cross-app links from the player UI). */
  readonly VITE_ADMIN_APP_ORIGIN?: string
  /** Set to 1/true when core has PLAYER_COOKIE_AUTH — sends credentialed fetches (httpOnly cookies). */
  readonly VITE_PLAYER_CREDENTIALS?: string
  /** Set to 1/true only when re-enabling Fingerprint Pro (legacy). Requires VITE_FINGERPRINT_PUBLIC_KEY. */
  readonly VITE_FINGERPRINT_ENABLED?: string
  /** Fingerprint Pro public key (Dashboard → API keys → Public) — never the server secret. */
  readonly VITE_FINGERPRINT_PUBLIC_KEY?: string
  /** Fingerprint region: `eu`, `us`, or `ap` — must match dashboard workspace (required for EU). */
  readonly VITE_FINGERPRINT_REGION?: string
  /** Oddin Bifrost esports iframe at `/casino/sports` when enabled (public values only; never API secrets). */
  readonly VITE_ODDIN_ENABLED?: string
  readonly VITE_ODDIN_ENV?: string
  readonly VITE_ODDIN_BRAND_TOKEN?: string
  readonly VITE_ODDIN_BASE_URL?: string
  readonly VITE_ODDIN_SCRIPT_URL?: string
  readonly VITE_ODDIN_THEME?: string
  readonly VITE_ODDIN_DEFAULT_LANGUAGE?: string
  readonly VITE_ODDIN_DEFAULT_CURRENCY?: string
  readonly VITE_ODDIN_DARK_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
