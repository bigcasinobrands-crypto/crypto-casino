# Separating the admin panel from the main (player) app

The **staff admin panel** and the **player-facing casino app** are intentionally **two different products** in this repo. They share only **visual tokens** (`@repo/design-tokens`), not runtime code or deploy artifacts.

## What is separate today

| Concern | Admin (`apps/admin`) | Main app (`apps/player`) |
|--------|----------------------|---------------------------|
| **Package** | `@repo/admin` | `@repo/player` |
| **Dev server** | port **5173** | port **5174** |
| **Production host** | e.g. `admin.yourdomain.com` | e.g. `www.yourdomain.com` or `app.…` |
| **Users** | Staff (email/password, roles) | Players (separate auth when you add it) |
| **API surface** | `/v1/admin/*` (staff JWT) | Future `/v1/...` player routes (player JWT/session) |
| **CORS in the API** | Only **`ADMIN_CORS_ORIGINS`** is applied under `/v1/admin` | When you add player routes, mount them with **`PLAYER_CORS_ORIGINS`** (see below) — do not reuse admin origins |

There are **no imports** from `apps/player` into `apps/admin` or the reverse. Each app builds its **own** `dist/` bundle.

## Deploy independently

1. **Build**
   - `npm run build:admin` → upload **`apps/admin/dist`** to the admin static host (S3/CloudFront, Netlify, etc.).
   - `npm run build:player` → upload **`apps/player/dist`** to the player static host.

2. **DNS**
   - Point **admin** and **player** hostnames at their respective CDN/static hosts.

3. **API**
   - One backend (`services/core`) can serve both; keep **route prefixes** clear: staff under **`/v1/admin`**, players under e.g. **`/v1/auth`**, **`/v1/me`**, **`/v1/games`** (when implemented).

4. **Secrets & sessions**
   - Staff tokens must not be accepted on player routes and vice versa (different JWT claims, secrets, or cookie names when you add them).

## Local development

- Run **`npm run dev:admin`** and **`npm run dev:player`** in separate terminals.
- Admin Vite proxies `/v1` and `/health` to the API; configure the same pattern for the player app when player APIs exist.
- Set **`ADMIN_CORS_ORIGINS`** to your admin dev origin (default `http://localhost:5173`).

## Future: player browser CORS

When the player SPA calls the API from the browser (not only via proxy), add a **player-only** route group in the Go server and apply CORS with env var **`PLAYER_CORS_ORIGINS`** (e.g. `https://www.yourdomain.com`). **Do not** add the player origin to `ADMIN_CORS_ORIGINS`.

## Optional: split into two git repos

The monorepo keeps shared **design tokens** and **one API** simple. If you later split repos, extract `packages/design-tokens` as a small published package or submodule; keep the API as the single integration point.
