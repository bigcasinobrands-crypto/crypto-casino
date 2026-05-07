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

## Cursor MCP (this repo)

Workspace file: **`.cursor/mcp.json`**. Restart Cursor after editing.

| Server | Purpose | One-time setup |
|--------|---------|----------------|
| **supabase** | Schema, read-only SQL, project tools | Set OS/user env **`SUPABASE_MCP_PROJECT_REF`** to your Supabase **Project ID** (Dashboard → *Project Settings* → *General* → *Reference ID*, e.g. the segment in `db.<ref>.supabase.co`). Then **Settings → Tools & MCP → supabase** → **Sign in** (OAuth). The URL uses `read_only=true` for safer assistants. |
| **render** | Services, logs, metrics, env vars (API) | Create an API key: [Dashboard → Account → API keys](https://dashboard.render.com/settings#api-keys). Set **`RENDER_API_KEY`** on your user/OS environment (same session that launches Cursor). **Do not** commit the key. |
| **vercel** | Projects, deployments, logs | **Settings → Tools & MCP → vercel** → **Sign in with Vercel** (OAuth). No repo secret. |

**Oddin / Bifrost** is not an MCP product—verify **`ODDIN_*`** and **`PLAYER_CORS_ORIGINS`** on your Render service (env + logs) or in the dashboard. See **`docs/oddin-iframe-integration.md`**.

### Oddin operator routes (verify after API deploy)

Oddin’s servers call your **core API** (e.g. Render), not Vercel. Same handlers, two URL shapes (both **POST**, same `ODDIN_API_SECURITY_KEY` / HMAC / IP allowlist as configured):

| Path | Notes |
|------|--------|
| `POST /v1/oddin/userDetails` | **Canonical** — prefer this in new Oddin dashboard config. |
| `POST /v1/oddin/debitUser` | |
| `POST /v1/oddin/creditUser` | |
| `POST /userDetails` | **Alias** — use if Oddin is configured with `https://<api-host>/userDetails` (avoids 404). |
| `POST /debitUser` | **Alias** at API root. |
| `POST /creditUser` | **Alias** at API root. |

**Using MCP:** With **Render** connected, redeploy the API service after pull; then ask an agent to confirm deploy health or hit `GET https://<api-host>/health`. An Oddin `userDetails` **404** usually means the running image is **before** the alias commit or the method is not **POST**.

If your Cursor build does not expand `${env:SUPABASE_MCP_PROJECT_REF}` in the URL, replace it in `.cursor/mcp.json` with your literal reference ID (keep the value out of git if the file is shared publicly—or keep using the env var only on your machine).

**Tips:** After connecting **render**, set your Render workspace in chat when prompted, then list services (approve tool calls). Render MCP can update env vars but does not trigger deploys by itself—see [Render MCP](https://docs.render.com/docs/mcp-server). **vercel** capabilities: [Vercel MCP + Cursor](https://vercel.com/docs/mcp/vercel-mcp#cursor).
