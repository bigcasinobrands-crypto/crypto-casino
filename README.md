# Crypto Casino — baseline monorepo

Phase 1 baseline: **two separate SPAs** (admin vs player), shared design tokens, **Go** API + **Postgres** + optional **Redis** queue, **staff** and **player** auth, **BlueOcean/Fystack webhook** stubs, **ledger** idempotency, **`cmd/worker`**.

**Admin vs player:** [`docs/separate-admin-and-player.md`](docs/separate-admin-and-player.md).

## Prereqs

- **Node 20+**, **Go 1.22+**, **Docker** (Postgres + Redis via `docker-compose.yml`).

## Quick start

1. `npm run compose:up` — Postgres + Redis (see `docker-compose.yml` for passwords).
2. `copy .env.example services\core\.env` and set `JWT_SECRET` (≥32 chars). Set `REDIS_URL` for worker/async path (see `.env.example`). For **player email** (verify / reset), set `PUBLIC_PLAYER_URL` and either log-only mail (default) or **SMTP** — e.g. start **Mailpit** with `docker compose up -d mailpit`, then `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_FROM=noreply@localhost`. Optional **Turnstile**: `TURNSTILE_SECRET` on API and `VITE_TURNSTILE_SITE_KEY` on the player app.
3. `npm install` then `npm run build:core` (or `cd services/core && go mod tidy && go build ./cmd/...`)
4. From `services/core`: `go run ./cmd/bootstrap <staff-email> <password>`
5. `go run ./cmd/playerbootstrap <player-email> <password>` (optional test user; password **12+ characters**, letters and numbers)
6. Terminal A: `npm run dev:api` (or `cd services/core && go run ./cmd/api`)  
   Terminal B: `npm run dev:worker` (needs `REDIS_URL` in `services/core/.env`)
7. `npm run dev:admin` (5173) and `npm run dev:player` (5174)

### Notable HTTP routes

- **Staff:** `/v1/admin/auth/login|refresh|logout`, `/v1/admin/me`, `/v1/admin/users`, `/v1/admin/ledger`, `/v1/admin/events/blueocean`, `/v1/admin/integrations/fystack/*`
- **Player:** `/v1/auth/register|login|refresh|logout`, `/v1/auth/me`, `/v1/auth/verify-email`, `/v1/auth/verify-email/resend`, `/v1/auth/forgot-password`, `/v1/auth/reset-password`, `/v1/games`, `/v1/games/launch`, `/v1/wallet/balance`, `/v1/wallet/deposit-session`, `/v1/wallet/withdraw` (deposit/withdraw require **verified email**)
- **Webhooks:** `POST /v1/webhooks/blueocean`, `POST /v1/webhooks/fystack`
- **Health:** `/health`, `/health/ready` (DB + Redis when configured)

## Frontends

```bash
npm run dev:admin
npm run dev:player
npm run build:admin
npm run build:player
npm run build:core   # tidy + vet + build api/worker/bootstrap/playerbootstrap
npm run dev:api      # API from repo root (resolves Go on Windows if IDE PATH is thin)
npm run dev:worker   # worker — needs REDIS_URL in services/core/.env
```

## Stack lock (plan `stack-document-lock`)

| Area | Decision |
|------|-----------|
| **Backend** | **Go 1.22+** in `services/core` — `chi`, `pgx`, `goose` (embedded SQL), `redis/go-redis` queue. |
| **Frontends** | **Vite + React + TypeScript**; `react-router-dom`; Tailwind v4 + `@repo/design-tokens`. |
| **DB** | **PostgreSQL 16**; migrations under `services/core/internal/db/migrations/`. |
| **Fystack** | **Stub + webhook + DB rows**; replace handlers with [Fystack REST](https://docs.fystack.io/) or a small Node adapter using `@fystack/sdk` called from Go (private network). Document final choice in PRD. |
| **BlueOcean** | **Stub launch URL** + webhook → `blueocean_events` → worker → `ledger.ApplyCredit` (replace payload mapping with provider spec). |

## Plan / ops docs

| Doc | Purpose |
|-----|---------|
| [`docs/mvp-spec.md`](docs/mvp-spec.md) | MVP scope locks |
| [`docs/ledger-state-machine.md`](docs/ledger-state-machine.md) | Money flow |
| [`docs/threat-model.md`](docs/threat-model.md) | STRIDE-lite |
| [`docs/platform-security-checklist.md`](docs/platform-security-checklist.md) | Prod TLS/WAF/DB |
| [`docs/e2e-phase1-checklist.md`](docs/e2e-phase1-checklist.md) | Manual E2E |
| [`docs/pre-prod-security-review.md`](docs/pre-prod-security-review.md) | Pre-launch gate |
| [`docs/architecture-ops-baseline.md`](docs/architecture-ops-baseline.md) | Ops mapping |
| [`docs/sdlc-branch-protection.md`](docs/sdlc-branch-protection.md) | CI & branches |
| [`docs/post-phase1-scale.md`](docs/post-phase1-scale.md) | Scale playbook stub |

## Compliance

Real-money gambling is regulated. This repo is engineering-only.
