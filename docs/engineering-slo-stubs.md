# Engineering SLOs (stubs)

Define targets with your team and plug into Prometheus/Grafana or your APM.

| Area | Suggested signal | Starter target |
|------|------------------|----------------|
| Deposit credit latency | `now - deposit.confirmed received_at` → ledger insert | p95 < 2 min |
| Webhook backlog | `count(*) from fystack_webhook_deliveries where processed = false` | < 100 |
| Seamless wallet | p99 latency on `GET /api/blueocean/callback` | < 300 ms |
| Worker queue | Redis `LLEN casino:jobs` | alert > 5000 |
| Fystack API errors | rate of 5xx/429 from `fystack.Client` | page on sustained burn |

Staging should mirror production: same webhook verification, Fystack sandbox, and Redis-backed workers.
