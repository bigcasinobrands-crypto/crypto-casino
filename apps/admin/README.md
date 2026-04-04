# Admin panel (`@repo/admin`)

**Staff-only** React app. Deploy it **separately** from the player app (different hostname, different CDN bucket).

- **API:** `/v1/admin/*` (see root `docs/openapi.yaml`).
- **Theme:** `@repo/design-tokens` — same *look* as the player app, not the same bundle.
- **Do not** import code from `apps/player`.

See **`docs/separate-admin-and-player.md`** for the full separation model.
