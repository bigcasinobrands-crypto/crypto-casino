/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Core API origin when the player app is not served behind the same host (e.g. https://api.example.com) */
  readonly VITE_PLAYER_API_ORIGIN?: string
  readonly VITE_TURNSTILE_SITE_KEY?: string
  readonly VITE_SUPPORT_URL?: string
  readonly VITE_RG_URL?: string
  /** Base URL of the admin console SPA (for cross-app links from the player UI). */
  readonly VITE_ADMIN_APP_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
