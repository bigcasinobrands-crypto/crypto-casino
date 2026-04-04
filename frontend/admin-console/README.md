# Admin console (`@repo/admin-console`)

**Staff-only** React app under `frontend/admin-console`. Deploy it **separately** from the player UI (different hostname, different CDN bucket). Dev server: **5173**.

- **API:** `/v1/admin/*` (see root `docs/openapi.yaml`).
- **Theme:** `@repo/design-tokens` — same *look* as the player app, not the same bundle.
- **Player SPA link / bridge:** `@repo/cross-app` — URLs + optional postMessage handshake with the player UI.
- **Do not** import the player app’s source or routes.

See **`docs/separate-admin-and-player.md`**.
