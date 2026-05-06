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
| **Operator wallet endpoints** | Base path for Oddin’s server-side calls | This codebase exposes **`POST /v1/oddin/userDetails`**, **`POST /v1/oddin/debitUser`**, **`POST /v1/oddin/creditUser`** (paths are fixed here; Oddin must be configured to hit your host + this prefix). |
| **Security** | Optional **`X-API-Key`** and/or **`X-Signature`** (HMAC-SHA256 over raw body) | Matches `ODDIN_API_SECURITY_KEY` and `ODDIN_HASH_SECRET` in `services/core`. Optional IP allowlist: `ODDIN_OPERATOR_IP_ALLOWLIST`. |
| **Bifrost (browser)** | **Brand token**, **Bifrost base URL**, **script URL** (integration vs production) | Player SPA: `VITE_ODDIN_BRAND_TOKEN`, `VITE_ODDIN_BASE_URL`, `VITE_ODDIN_SCRIPT_URL`. Core mirrors public URLs for diagnostics: `ODDIN_PUBLIC_BASE_URL`, `ODDIN_PUBLIC_SCRIPT_URL`. |

Oddin will also specify **which Bifrost host** to use (e.g. `bifrost.integration.oddin.gg` vs `bifrost.oddin.gg`) and **egress IP ranges** for callbacks — align those with `ODDIN_OPERATOR_IP_ALLOWLIST` if you enforce it.

## How this repo embeds Bifrost (iframe)

1. **Feature flag**: Player route **`/casino/sports`** mounts the real iframe only when `VITE_ODDIN_ENABLED=true` or `1` (see `CasinoSportsPage`).
2. **Script load**: `loadOddinScript(VITE_ODDIN_SCRIPT_URL)` then `window.oddin.buildBifrost(...)`.
3. **Container**: Config uses `contentElement: '#bifrost'` (host page must render that mount point).
4. **Session token**: Authenticated players obtain an opaque token via **`POST /v1/sportsbook/oddin/session-token`** (requires `ODDIN_ENABLED` on core). The token is passed into Bifrost as `token`; **`brandToken`**, **`baseUrl`**, language, currency, theme, and `darkMode` come from public env (see `readOddinPublicConfig()` / `useOddinBifrost`).
5. **Height / mobile**: The host supplies `height: () => bifrostHeightPx()` so the iframe fills the viewport under your shell headers (`viewport-fit=cover` and layout helpers in `oddin-layout.ts` support notched / mobile shells — align with Oddin’s guidance on full-height embedding).
6. **Events**: The hook handles `LOADED`, `ERROR`, `REQUEST_SIGN_IN`, `REQUEST_REFRESH_BALANCE`, `ROUTE_CHANGE`, `ANALYTICS`, `TOGGLE_FULLSCREEN` and forwards telemetry to **`POST /v1/sportsbook/oddin/client-event`** (optional cookie / CSRF as per player API).

## Operator API (wallet) — current implementation status

| Endpoint | Purpose (typical) | This repo |
|----------|-------------------|-----------|
| `POST /v1/oddin/userDetails` | Balance / user context for Oddin | **Stub** — responds with `NOT_IMPLEMENTED` (logged to `sportsbook_provider_requests`). |
| `POST /v1/oddin/debitUser` | Stake / reserve funds | **Stub** |
| `POST /v1/oddin/creditUser` | Payout / return funds | **Stub** |

Until these are wired to the **casino ledger**, Oddin cannot complete a real wallet-backed sportsbook flow even if the iframe loads; implement ledger debits/credits per Oddin’s contract and replace the stubs in `services/core/internal/oddin/handler_operator.go`.

## Environment variables (quick map)

**Player SPA** (`frontend/player-ui/.env` — see `.env.example`):

- `VITE_ODDIN_ENABLED`, `VITE_ODDIN_BRAND_TOKEN`, `VITE_ODDIN_BASE_URL`, `VITE_ODDIN_SCRIPT_URL`, optional theme/language/currency/dark mode.

**Core API** (`services/core/.env` — see `.env.example`):

- `ODDIN_ENABLED`, `ODDIN_ENV`, `ODDIN_PUBLIC_BASE_URL`, `ODDIN_PUBLIC_SCRIPT_URL`, `ODDIN_BRAND_TOKEN` (diagnostics parity), `ODDIN_API_SECURITY_KEY`, `ODDIN_HASH_SECRET`, `ODDIN_TOKEN_TTL_SECONDS`, `ODDIN_OPERATOR_IP_ALLOWLIST`, **`ODDIN_ESPORTS_NAV_JSON`** (optional E-Sports sidebar; see below).

### E-Sports sidebar (discipline list + logos)

The player sidebar loads **`GET /v1/sportsbook/oddin/esports-nav`** when Oddin is enabled. If **`ODDIN_ESPORTS_NAV_JSON`** is set on core to a JSON **array** of `{ "id", "label", "page", "logoUrl" }`, those rows (including **`logoUrl` — use HTTPS URLs from Oddin’s integration / brand guidelines**) replace the built-in fallback routes. If unset or empty, the UI shows the same routes with a generic icon until you configure Oddin-provided assets.

## Admin visibility

**Admin Console → Oddin Bifrost** (`OddinIntegrationPage`) calls **`GET /v1/admin/integrations/oddin`** for non-secret health counters (iframe events, operator callback errors in audit). Use it together with Oddin’s dashboard and this checklist when debugging integration.

## Handoff line for Oddin support

You can send something shaped like:

> Player app: `https://<player-host>/casino/sports` (Bifrost).  
> API: `https://<api-host>` — operator callbacks: `https://<api-host>/v1/oddin/userDetails`, `debitUser`, `creditUser` (secured with [API key / HMAC / IP allowlist as configured]).  
> Session token for iframe: `POST https://<api-host>/v1/sportsbook/oddin/session-token` (authenticated player).

Replace placeholders and attach the exact auth headers Oddin should send once `ODDIN_API_SECURITY_KEY` / `ODDIN_HASH_SECRET` are set.
