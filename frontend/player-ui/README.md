# Player UI (`@repo/player-ui`)

**Player-facing** casino shell under `frontend/player-ui`. This is the **main public app** — not the admin console. Dev server: **5174**.

- Deploy on your **public** domain (e.g. `www` or `app`).
- **Do not** ship staff routes or TailAdmin here.
- **Do not** import the admin console’s source or layout.
- Shared styling: `@repo/design-tokens`. Cross-app links / bridge: `@repo/cross-app`.

See **`docs/separate-admin-and-player.md`**.
