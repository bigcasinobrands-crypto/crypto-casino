# Container runtime (API image)

## Build

```bash
docker build -t casino-api -f services/core/Dockerfile services/core
```

## Migrations and startup

`services/core/cmd/api` calls **`db.RunMigrations`** (embedded Goose SQL) **before** binding the HTTP server. A single container or the first pod in a rollout applies migrations against `DATABASE_URL`, then serves traffic.

**Kubernetes / HA:** For zero-doubt ordering, some teams run a **Job** that executes the same binary with a migrate-only mode, or start the Deployment with `maxUnavailable: 0` and `maxSurge: 1` so only one new pod talks to Postgres for the first migration window. The current binary does **not** ship a separate subcommand; migrations are always attempted on process start (idempotent `goose up`).

## Health

- `GET /health` — liveness  
- `GET /health/ready` — DB (+ optional Redis checks)  
- `GET /health/operational` — player-facing snapshot  

Configure probes on `/health` or `/health/ready` as appropriate for your platform.

## Secrets

Inject `DATABASE_URL`, `JWT_SECRET`, provider keys, etc. via the orchestrator secrets manager. Never bake secrets into the image.

## See also

- `security/kong/kong.yaml` — edge routing stub toward this upstream.  
- `docs/platform-security-checklist.md` — production controls.
