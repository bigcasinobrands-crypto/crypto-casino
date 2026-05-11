/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the player UI SPA (e.g. https://play.example.com or http://localhost:5174). */
  readonly VITE_PLAYER_APP_ORIGIN?: string
  /** Same as `VITE_PLAYER_APP_ORIGIN` — either may be set in Vercel. */
  readonly VITE_PLAYER_UI_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
