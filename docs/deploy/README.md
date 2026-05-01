# Deploy (reproducible launch)

Single documented path from a clean clone to a **healthy** API with migrations applied.

## Prerequisites

- Docker (or external Postgres 16 + Redis 7)
- Secrets via environment (or Vault Agent → env file)

## Local / staging (development compose)

```bash
docker compose up -d postgres redis
cp services/core/.env.example services/core/.env
# Set JWT_SECRET (≥32 chars), DATABASE_URL, REDIS_URL
cd services/core && go run ./cmd/api
```

Migrations run automatically on API startup via `db.RunMigrations`.

### Migrate only (no HTTP)

From `services/core` with `DATABASE_URL` set (same env as the API):

```bash
go run ./cmd/migrate
```

Docker image also ships `/app/migrate` (same binary as above) if you need a one-off job before switching traffic.

## Production-shaped stack (Docker)

1. Create `.env.prod` at repo root (never commit):

   - `POSTGRES_PASSWORD`, `REDIS_PASSWORD`
   - `DATABASE_URL=postgres://casino:YOURPASS@postgres:5432/casino`
   - `REDIS_URL=redis://:YOURPASS@redis:6379/0`
   - `JWT_SECRET`, `ADMIN_CORS_ORIGINS`, `PLAYER_CORS_ORIGINS`
   - `APP_ENV=production` (set in compose for `api` service)

2. Build and start:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

3. Wait for `/health/ready` (DB + Redis). The API exits if migrations fail—no half-applied traffic by default.

## Redeploy (hosted API)

The API binary applies **all pending Goose migrations** when the process starts. After pulling the latest application code into your environment:

1. **Deploy / restart** the API service so a new container starts against production `DATABASE_URL` (migrations run before the server listens).
2. If your platform supports **manual migrate jobs**, run `go run ./cmd/migrate` (or `/app/migrate` in the Docker image) with the same env as production, then roll the web service.

If login returned HTTP **500** with `session` / `family_id` errors, the database was usually behind—after this redeploy, `00054_session_refresh_family` and later migrations apply automatically.

## Failure modes

- **Migrations fail:** container exits; fix forward with a new migration, redeploy.
- **Redis down in production:** `ValidateProduction` requires `REDIS_URL`; readiness should fail if Redis is mandatory for your deployment profile.

## CI integration tests

Tests tagged `integration` run against ephemeral Postgres/Redis in GitHub Actions (see `.github/workflows/ci.yml`).
