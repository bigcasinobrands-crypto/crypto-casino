# Supabase (Postgres) with this monorepo

The core API is a normal **Go + PostgreSQL** app. [Supabase](https://supabase.com) provides a hosted Postgres instance — you only point `DATABASE_URL` at it; the app does not use the Supabase JS client for the main API.

## 1. Get a connection string

1. Open your project in the **Supabase Dashboard**.
2. Go to **Connect** (or **Settings → Database**).
3. Under **Connection string**, choose **URI**.
4. **Local dev:** **Direct** (`db.<ref>.supabase.co:5432`) is usually fine.
5. **Hosted APIs (e.g. Render, Railway):** prefer the **Session pooler** / **Pooler** URI — same Postgres, but **IPv4-friendly**. The **direct** host often resolves to **IPv6 only**; many clouds cannot reach it and you see errors like `dial tcp ... network is unreachable`.
6. Copy the URI and ensure TLS, e.g. `?sslmode=require` at the end (use `&sslmode=require` if the string already has `?`).

**Security:** the password is the **database user password** from the Database settings, not the `anon` / `service_role` API keys.

## 2. Configure the core service

1. `copy services\core\.env.example services\core\.env` (or copy manually on macOS/Linux).
2. Set:

   `DATABASE_URL=<paste the URI with sslmode=require>`

3. Set a strong `JWT_SECRET` (and other vars you need; see `services/core/.env.example`).

## 3. Run migrations

From the **repository root**:

```bash
npm run migrate:core
```

This runs `go run ./cmd/migrate` in `services/core` and applies the same SQL migrations as the API. Re-run when you pull new migrations.

## 4. Start the API locally against Supabase

```bash
npm run dev:api
```

The API loads `services/core/.env` via `godotenv` (and optionally the repo-root `.env`).

## 5. Point the frontends at your API

- **Admin (Vercel or local build):** set `VITE_ADMIN_API_ORIGIN` to your **core API** public URL (e.g. `https://api.yourdomain.com`), not the Supabase project URL. Supabase hosts the **database**; your **Go service** is still the API the UIs call.
- **Player (Vercel):** set `VITE_PLAYER_API_ORIGIN` to the same **core API** public URL. Without it, the player SPA posts sign-in to its own static origin and requests fail (often shown as HTTP 404 / “network”).
- **CORS:** set `ADMIN_CORS_ORIGINS` and `PLAYER_CORS_ORIGINS` in the core env to your admin/player origins (e.g. Vercel preview URLs).

## 6. Deploy core API on Render (example env file)

Copy placeholders from **[`docs/env/render-core.env.template`](./env/render-core.env.template)** into Render → **Environment** (or download that file from the repo and fill it locally — do not commit secrets).

## 7. Redis and other services

`REDIS_URL` is still used for parts of the stack (queues, some auth flows). Supabase does not replace Redis. For a small cloud setup, a free [Upstash](https://upstash.com) Redis URL is a common choice, or keep using local Redis via Docker when developing.

## Troubleshooting

- **Render / deploy: `network is unreachable` dialing `[ipv6]:5432` to `db.*.supabase.co`:** your host has **no IPv6 route** to Supabase’s direct endpoint. Fix: set **`DATABASE_URL`** to the **Session pooler** connection string from **Connect** (pooler hostname, often `*.pooler.supabase.com`). Alternatively enable Supabase **IPv4 add-on** for the direct connection (paid).
- **“connection refused” / SSL errors:** double-check `sslmode=require` and pooler **username** shape (`postgres` vs `postgres.<project-ref>`) per what Supabase shows for that URI.
- **Migrations through the pooler:** Session pooler is commonly used for app + migrations. If a specific migration fails, check Supabase docs for **transaction** vs **session** pooler; avoid the wrong pooler mode for long DDL if their docs warn about it.
