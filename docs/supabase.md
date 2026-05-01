# Supabase (Postgres) with this monorepo

The core API is a normal **Go + PostgreSQL** app. [Supabase](https://supabase.com) provides a hosted Postgres instance — you only point `DATABASE_URL` at it; the app does not use the Supabase JS client for the main API.

## 1. Get a connection string

1. Open your project in the **Supabase Dashboard**.
2. Go to **Connect** (or **Settings → Database**).
3. Under **Connection string**, choose **URI** and use the **Direct** / **Session** connection to the database (port **5432** on the `db.<ref>.supabase.co` host is the usual “direct” host).
4. Copy the URI and ensure it includes TLS, e.g. `?sslmode=require` at the end (add it if missing).

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
- **CORS:** set `ADMIN_CORS_ORIGINS` and `PLAYER_CORS_ORIGINS` in the core env to your admin/player origins (e.g. Vercel preview URLs).

## 6. Redis and other services

`REDIS_URL` is still used for parts of the stack (queues, some auth flows). Supabase does not replace Redis. For a small cloud setup, a free [Upstash](https://upstash.com) Redis URL is a common choice, or keep using local Redis via Docker when developing.

## Troubleshooting

- **“connection refused” / SSL errors:** double-check `sslmode=require` and that you are not mixing up pooler port **6543** with direct **5432** without following Supabase’s docs for your driver.
- **Migrations fail through the pooler:** run migrations using the **direct** `5432` connection string; use the pooler for app traffic if you prefer.
- **IPv6:** if your network cannot reach Supabase over IPv6, see Supabase **Database** settings for IPv4 or pooler options.
