# Oddin Bifrost (esports iframe) — operator checklist

This document consolidates what **Oddin requires for iframe (Bifrost) integration** and how this repo wires it. **Oddin’s onboarding pack, Bifrost JS API notes, and integration guides are the source of truth** for payload shapes and dashboard fields; use this file as an internal map to URLs and env vars.

## Official vendor references

- Product overview: [Esports Betting iFrame (Oddin.gg)](https://www.oddin.gg/esports-betting-iframe)
- Integration URLs and credentials (brand token, integration vs production Bifrost host) come from **Oddin after signup** — not from this repo.

## What Oddin typically needs from you

Give Oddin a consistent picture of your public surfaces so they can allowlist origins, configure the Bifrost client, and call your **operator (server-to-server) wallet API**.

| Area | What to provide | Notes |
|------|-----------------|--------|
| **Player site origin(s)** | HTTPS production URL(s); staging if applicable | Must be allowed for cookies/CORS where you use credentialed API calls (`PLAYER_CORS_ORIGINS` on core). |
| **API base URL** | Public URL of this Go API (no trailing slash), e.g. `https://api.example.com` | Used for operator callbacks and player session/token routes. |
| **Operator wallet endpoints** | Base path for Oddin’s server-side calls | **Canonical:** **`POST /v1/oddin/userDetails`**, **`/debitUser`**, **`/creditUser`**. **Alias (same handlers):** **`POST /userDetails`**, **`POST /debitUser`**, **`POST /creditUser`** on the API host root. **`POST` paths with a trailing slash** (`/userDetails/`, `/v1/oddin/userDetails/`, etc.) are registered too — some dashboards append `/` and would otherwise get **404**. |
| **Security** | Optional **`X-API-Key`** and/or **`X-Signature`** (HMAC-SHA256 over raw body) | Matches `ODDIN_API_SECURITY_KEY` and `ODDIN_HASH_SECRET` in `services/core`. Optional IP allowlist: `ODDIN_OPERATOR_IP_ALLOWLIST`. |
| **Bifrost (browser)** | **Brand token**, **Bifrost base URL**, **script URL** (integration vs production) | Player SPA: `VITE_ODDIN_BRAND_TOKEN`, `VITE_ODDIN_BASE_URL`, `VITE_ODDIN_SCRIPT_URL`. Core mirrors public URLs for diagnostics: `ODDIN_PUBLIC_BASE_URL`, `ODDIN_PUBLIC_SCRIPT_URL`. |

Oddin will also specify **which Bifrost host** to use (e.g. `bifrost.integration.oddin.gg` vs `bifrost.oddin.gg`) and **egress IP ranges** for callbacks — align those with `ODDIN_OPERATOR_IP_ALLOWLIST` if you enforce it.

## How this repo embeds Bifrost (iframe)

1. **Feature flag & public config**: **`/casino/sports`** mounts Bifrost when the **merged** public config validates (from **player** `VITE_ODDIN_*` and/or **`GET /v1/sportsbook/oddin/public-config`** when core has `ODDIN_ENABLED` + `ODDIN_BRAND_TOKEN` + `ODDIN_PUBLIC_BASE_URL` + `ODDIN_PUBLIC_SCRIPT_URL`). You can configure Oddin **only on core** (no `VITE_ODDIN_ENABLED`) or **only on the player**, or **both** (Vite values win when set; gaps are filled from the API).
2. **Script load**: `loadOddinScript(scriptUrl)` then `window.oddin.buildBifrost(...)`.
3. **Container**: Config uses `contentElement: '#bifrost'` (host page must render that mount point).
4. **Session token**: Authenticated players obtain an opaque token via **`POST /v1/sportsbook/oddin/session-token`** (requires `ODDIN_ENABLED` on core). The token is passed into Bifrost as `token`; **`brandToken`**, **`baseUrl`**, language, currency, theme, and `darkMode` come from public env (see `readOddinPublicConfig()` / `useOddinBifrost`).
5. **Height / mobile**: The host supplies `height: () => bifrostHeightPx()` so the iframe fills the viewport under your shell headers (`viewport-fit=cover` and layout helpers in `oddin-layout.ts` support notched / mobile shells — align with Oddin’s guidance on full-height embedding).
6. **Events**: The hook handles `LOADED`, `ERROR`, `REQUEST_SIGN_IN`, `REQUEST_REFRESH_BALANCE`, `ROUTE_CHANGE`, `ANALYTICS`, `TOGGLE_FULLSCREEN` and forwards telemetry to **`POST /v1/sportsbook/oddin/client-event`** (optional cookie / CSRF as per player API).

## Operator API (wallet) — current implementation status

| Endpoint | Purpose (typical) | This repo |
|----------|-------------------|-----------|
| `POST /v1/oddin/userDetails` | Authenticate token + return user (id, currency, language, balance) | **Implemented** — looks up `sportsbook_sessions` (token issued by `POST /v1/sportsbook/oddin/session-token`) and returns `{ errorCode: 0, errorMessage: "", userId, currency, language, balance, balanceMinor }`. Failure paths return integer codes `100` invalid token, `101` expired, `102` revoked, `901` operator error (db/etc.). HTTP **200** with `errorCode` in body — Oddin's authenticator parses an **int**. |
| `POST /v1/oddin/debitUser` | Stake / reserve funds | **Stub** — returns `errorCode: 900` ("operator wallet not ready") until the wallet ledger contract is wired. |
| `POST /v1/oddin/creditUser` | Payout / return funds | **Stub** — `errorCode: 900`. |
| `POST /userDetails` | Root alias (Oddin default callback URL) | **Same handler** as `/v1/oddin/userDetails`. |
| `POST /debitUser` | Root alias | **Stub** — `errorCode: 900`. |
| `POST /creditUser` | Root alias | **Stub** — `errorCode: 900`. |
| `POST …/*/` variants | Trailing slash on any of the above paths | **Same handlers** (Oddin dashboards sometimes append `/`). |

The token field in the request body is read in this order: **`token`**, `userToken`, `playerToken`, `accessToken`, `session_token`, `sessionToken` — first non-empty wins. **All operator responses are HTTP 200**; success/failure is signaled by an **integer `errorCode`** (Oddin's authenticator parses an `int`; a string like `"OK"` triggers `unexpected character: \"`). Each response also carries `errorMessage` (and a duplicate `message`) for human context.

**Error code catalog** (defined in `services/core/internal/oddin/handler_operator.go` — keep stable):

| Code | Meaning |
|------|---------|
| `0` | OK |
| `100` | Invalid / unknown token |
| `101` | Token expired |
| `102` | Token revoked / session not active |
| `103` | User not found |
| `104` | User disabled |
| `200` | Insufficient funds (debit) |
| `900` | Operator not ready (debit/credit stubs) |
| `901` | Operator-side error (database unavailable, etc.) |

**Token validation is live**: Oddin's `Authenticator.ParseRequest` resolves a player from a Bifrost session token. Until **debit/credit** are wired to the casino ledger (still stubs returning `errorCode: 900`), bet placement will fail server-side even though sign-in/balance refresh succeed; implement ledger debits/credits per Oddin's contract and replace the stubs in `services/core/internal/oddin/handler_operator.go`.

## Environment variables (quick map)

**Player SPA** (`frontend/player-ui/.env` — see `.env.example`):

- `VITE_ODDIN_ENABLED`, `VITE_ODDIN_BRAND_TOKEN`, `VITE_ODDIN_BASE_URL`, `VITE_ODDIN_SCRIPT_URL`, optional theme/language/currency/dark mode.

**Core API** (`services/core/.env` — see `.env.example`):

- `ODDIN_ENABLED`, `ODDIN_ENV`, `ODDIN_PUBLIC_BASE_URL`, `ODDIN_PUBLIC_SCRIPT_URL`, `ODDIN_BRAND_TOKEN` (diagnostics parity), `ODDIN_API_SECURITY_KEY`, `ODDIN_HASH_SECRET`, `ODDIN_TOKEN_TTL_SECONDS`, `ODDIN_OPERATOR_IP_ALLOWLIST`, **`ODDIN_ESPORTS_NAV_JSON`** (optional E-Sports sidebar; see below).

### Localhost (`npm run dev` / local core)

- **Same Oddin config as deploy:** Either set full **`VITE_ODDIN_*`** in `frontend/player-ui/.env` (uncomment the block in `.env.example`), **or** enable Oddin on **local** core (`services/core/.env`): `ODDIN_ENABLED=1`, `ODDIN_BRAND_TOKEN`, `ODDIN_PUBLIC_BASE_URL`, `ODDIN_PUBLIC_SCRIPT_URL` so `GET /v1/sportsbook/oddin/public-config` returns JSON. If the hosted “development” app works but localhost does not, this is almost always **missing `ODDIN_*` on local core** while Vercel/Render has them.
- **Only local core:** `PLAYER_CORS_ORIGINS` on core must include **`http://localhost:5174`** (and `http://127.0.0.1:5174` if you use that host) **in addition to** your existing Vercel/production origins — the value is one comma-separated list: **append**, do not remove hosted entries.
- **Local player + live Render API (`DEV_API_PROXY`, no `VITE_PLAYER_API_ORIGIN`):** You usually **do not** change `PLAYER_CORS_ORIGINS` — the browser calls same-origin `/v1` on Vite; the dev server proxies to Render. Your Vercel entries stay as they are.
- **Oddin allowlist:** Ask Oddin to allow **`http://localhost:5174`** for the brand/integration if the iframe script loads but stays blank or fires `ERROR`.
- **`vite preview` vs `vite dev`:** `vite build && vite preview` loads **production** env (`.env.production`, `.env.production.local`), not `.env.development`. Copy your **`VITE_ODDIN_*`** vars into `.env.production.local` or the preview build will mount like a “prod” deploy **without** Oddin.

### Split deploy (e.g. Vercel player + Render API)

- **`VITE_PLAYER_API_ORIGIN`** on the player build must point at the public core API (see player `.env.example`). Otherwise `/v1/*` and the Oddin bootstrap request never reach the Go service.
- **`PLAYER_CORS_ORIGINS`** on core must include every player origin (`https://*.vercel.app` for previews plus your production hostname). Required for `GET /v1/sportsbook/oddin/public-config`, `POST .../session-token`, and `POST .../client-event`.
- Prefer **HTTPS** Bifrost URLs in production (`ODDIN_PUBLIC_*` / `VITE_ODDIN_*`): `ODDIN_ENV=production`, `ODDIN_PUBLIC_BASE_URL=https://bifrost.oddin.gg`, `ODDIN_PUBLIC_SCRIPT_URL=https://bifrost.oddin.gg/script.js` (exact URLs from Oddin).
- Give Oddin your **player origin** (`https://…vercel.app` or custom domain) if they allowlist Bifrost hosts per operator.
- Avoid a **restrictive Content-Security-Policy** on the player static host that blocks `script-src` or `frame-src` to `*.oddin.gg` — the default Vercel static deploy does not add CSP; only add one if you explicitly allow Oddin’s script and iframe origins.

### E-Sports sidebar (discipline list + logos)

The player sidebar loads **`GET /v1/sportsbook/oddin/esports-nav`** when Oddin is enabled. If **`ODDIN_ESPORTS_NAV_JSON`** is set on core to a JSON **array** of `{ "id", "label", "page", "logoUrl" }`, those rows (including **`logoUrl` — use HTTPS URLs from Oddin’s integration / brand guidelines**) replace the built-in fallback routes. If unset or empty, the UI shows the same routes with a generic icon until you configure Oddin-provided assets.

## Admin visibility

**Admin Console → Oddin Bifrost** (`OddinIntegrationPage`) calls **`GET /v1/admin/integrations/oddin`** for non-secret health counters (iframe events, operator callback errors in audit). Use it together with Oddin’s dashboard and this checklist when debugging integration.

## Handoff line for Oddin support

You can send something shaped like:

> Player app: `https://<player-host>/esports` (Bifrost).  
> API: `https://<api-host>` — operator callbacks (all **POST**):  
> **Canonical:** `https://<api-host>/v1/oddin/userDetails`, `/v1/oddin/debitUser`, `/v1/oddin/creditUser`.  
> **Root alias (Oddin default shape):** `https://<api-host>/userDetails`, `/debitUser`, `/creditUser` — same handlers; use if Oddin’s integration points at `/userDetails` without `/v1/oddin`.  
> **URLs must use POST** (GET returns **405**). Prefer **no trailing slash** in Oddin’s dashboard (`…/userDetails`), but **`…/userDetails/`** is accepted.  
> Session token for iframe: `POST https://<api-host>/v1/sportsbook/oddin/session-token` (authenticated player).

Replace placeholders and attach the exact auth headers Oddin should send once `ODDIN_API_SECURITY_KEY` / `ODDIN_HASH_SECRET` are set.
