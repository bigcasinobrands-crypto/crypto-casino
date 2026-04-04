# Phase 1 E2E checklist

1. `docker compose up -d` — Postgres + Redis.
2. `services/core/.env` — `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL=redis://:casino-redis-local@localhost:6379/0`.
3. `go run ./cmd/api` + `go run ./cmd/worker` (from `services/core`).
4. Bootstrap staff + player users.
5. **Player:** register/login → lobby lists games → open game (iframe URL from launch) → deposit session + withdraw buttons create rows.
6. **Webhook stub:** `curl -X POST localhost:8080/v1/webhooks/fystack -d '{"id":"p1","user_id":"<uuid>","status":"completed","amount_minor":500}'` → ledger credit after worker (or sync).
7. **Admin:** login → Users / Ledger / Fystack / BlueOcean pages show JSON.
8. **Backup drill:** document manual `pg_dump` restore (quarterly).
