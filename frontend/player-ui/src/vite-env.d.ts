/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TURNSTILE_SITE_KEY?: string
  readonly VITE_SUPPORT_URL?: string
  readonly VITE_RG_URL?: string
  /** Base URL of the admin console SPA (for cross-app links from the player UI). */
  readonly VITE_ADMIN_APP_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
