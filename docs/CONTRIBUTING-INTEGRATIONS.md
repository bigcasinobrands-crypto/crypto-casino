# Contributing integrations (ports-friendly checklist)

This monolith favors **clear boundaries** inside `services/core`: config in `internal/config`, HTTP in small handler packages, and **no** secrets in frontends. Use this when adding a payment provider, game platform, KYC vendor, etc.

## Before you code

1. **Name & scope** — One integration = one bounded context (e.g. “Fystack wallets”, “BlueOcean catalog + wallet callbacks”). Avoid spaghetti in `cmd/api/main.go`; prefer a `Mount*` or constructor that accepts `*pgxpool.Pool`, `*config.Config`, optional Redis.
2. **Secrets** — Add keys only to **`services/core/.env.example`** with comments; document rotation. Never add API keys to `frontend/*` bundles.
3. **Public vs admin** — Player routes under `/v1/...`; staff under `/v1/admin/...`; webhooks on **`POST /v1/webhooks/...`** with signature verification when the vendor supports it.
4. **OpenAPI** — When you add or change stable player routes, update **`docs/openapi.yaml`** (paths + security).

## Implementation checklist

| Step | Done? |
|------|--------|
| `internal/config/config.go` — typed env fields, safe defaults | |
| `services/core/.env.example` — documented vars | |
| Dedicated package `internal/<vendor>/` (client, webhook verify, errors) | |
| Idempotent **webhooks** / callbacks (DB idempotency or provider event id) | |
| Rate limits on sensitive public endpoints (`httprate` patterns in `main.go`) | |
| **`go test ./...`** for packages you touch | |
| If cookies involved — CSRF already global on `/v1`; don’t exempt without review | |

## Reference implementations

- **BlueOcean** — `internal/blueocean/`, `internal/webhooks/` BO handlers, seamless wallet `GET /api/blueocean/callback`.
- **Fystack** — `internal/fystack/`, `POST /v1/webhooks/fystack` (+ `/workspace` alias).

## Fixture / integration tests

- DB-bound behavior: add **`//go:build integration`** tests under the relevant package or `internal/db`, and extend **`.github/workflows/ci.yml`** `go-integration` only if CI needs new infra (extra container, env).

## Vault (optional)

Paths for core live in **`security/vault/policies/`**. When an integration needs dynamic secrets, add a policy stanza there and document the path in the runbook, not in the repo root README.

## API container

See **`docs/container-runtime.md`** for the production image, migration-on-start behavior, and health endpoints.
