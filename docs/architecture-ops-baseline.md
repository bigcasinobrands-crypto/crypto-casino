# Architecture & ops baseline (implemented / referenced)

| Item | Location |
|------|----------|
| Health | `GET /health`, `GET /health/ready` (DB + optional Redis) |
| Queue | Redis list `casino:jobs`; `cmd/worker` BRPOP consumer |
| Idempotent ledger | `ledger.ApplyCredit` + unique `idempotency_key` |
| Graceful API shutdown | `cmd/api` SIGTERM handling |
| DLQ | Not yet — add dead-letter list + playbook when moving beyond MVP |
| Env matrix | Local: `docker-compose.yml`; prod: see `docs/platform-security-checklist.md` |
| API prefix | `/v1/...` |
| Money | `amount_minor` BIGINT, no floats |
