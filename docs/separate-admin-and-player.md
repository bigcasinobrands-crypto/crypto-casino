# Separating the admin panel from the main (player) app

The **staff admin console** and the **player-facing casino app** are **two deployable SPAs** under `frontend/`. They share **design tokens** (`@repo/design-tokens`) and a small **integration package** (`@repo/cross-app`) for URLs and optional **postMessage** handshakes — not each other’s React trees or bundles.

## Layout in this repo

| Concern | Admin console (`frontend/admin-console`) | Player UI (`frontend/player-ui`) |
|--------|------------------------------------------|----------------------------------|
| **Package** | `@repo/admin-console` | `@repo/player-ui` |
| **Dev server** | port **5173** (explicit in Vite) | port **5174** |
| **Production host** | e.g. `admin.yourdomain.com` | e.g. `www.yourdomain.com` or `app.…` |
| **Users** | Staff (`staff_users` in Postgres, staff JWT) | Players (separate auth) |
| **API surface** | `/v1/admin/*` | `/v1/auth/*`, `/v1/games`, `/v1/wallet/*`, … |

There are **no imports** from the player app into the admin app or the reverse. **`@repo/cross-app`** is the only shared TypeScript between them: origin resolution, `playerAppHref` / `adminAppHref`, and a typed **ping/pong** bridge for cross-origin tabs.

## Cross-app connection (different origins in production)

1. **Environment**
   - Admin: set **`VITE_PLAYER_APP_ORIGIN`** to the player SPA’s public origin (see `frontend/admin-console/.env.example`).
   - Player: set **`VITE_ADMIN_APP_ORIGIN`** to the admin SPA’s public origin (see `frontend/player-ui/.env.example`).

2. **UI**
   - Admin header: **Player app** link + **Verify bridge** (opens named window, sends `admin.ping`, expects `player.pong`).
   - Player header: **Staff console** link to admin login.

3. **Backend**
   - Both apps still call the **same API** (`/v1/…`) via Vite proxy in dev or via browser CORS in prod. Staff auth remains **`/v1/admin/*`** only.

## Deploy independently

1. **Build**
   - `npm run build:admin` → **`frontend/admin-console/dist`**
   - `npm run build:player` → **`frontend/player-ui/dist`**

2. **DNS** — Point admin and player hostnames at their static hosts; set the `VITE_*_ORIGIN` vars at build time to match.

3. **API** — One backend (`services/core`); staff under **`/v1/admin`**, players under **`/v1/auth`**, etc.

4. **Secrets & sessions** — Staff tokens must not be accepted on player routes and vice versa.

## Local development

- Run **`npm run dev:admin`** and **`npm run dev:player`** in separate terminals.
- Defaults: `http://localhost:5173` (admin) ↔ `http://localhost:5174` (player) if env vars are unset.
- Set **`ADMIN_CORS_ORIGINS`** for the admin origin when the browser talks to the API without the Vite proxy.

## Future: split into two git repos

Extract `packages/design-tokens` and `packages/cross-app` as shared packages (or duplicate `cross-app` protocol constants). The **API** remains the primary integration surface.
