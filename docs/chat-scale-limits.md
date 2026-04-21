# Chat scale (NFR-CHAT)

- **Current architecture**: Single in-process WebSocket hub in `cmd/api` (`chat.Hub`). `OnlineCount` reflects connections to that instance only.
- **Rate limits**: Flood / duplicate trackers in `internal/chat` (in-memory). Optional `chat_settings.slow_mode_seconds` and `min_account_age_seconds` apply when wired from DB into client checks (extend `client.go` to load settings on connect for strict enforcement).
- **Horizontal scaling**: Multiple API replicas require a shared pub/sub layer for chat broadcast; not in scope for single-node deployments.

Recommended: per-IP connection limits at the edge (CDN/WAF) and message rate caps aligned with `slow_mode_seconds`.

## Edge / reverse-proxy rate limits

| Limit | Recommended value | Enforcement point |
|---|---|---|
| WS connections per IP per minute | 10 | Cloudflare / nginx (edge) |
| Messages per connection per minute | 60 | Cloudflare / nginx (edge) |

Configure these at the CDN or reverse-proxy layer **before** traffic reaches the Hub process. This protects against connection floods and message spam regardless of application-level checks.

### Hub-level controls

- **`slow_mode_seconds`** — stored in `chat_settings` (DB-backed, staff-configurable via `PATCH /v1/admin/chat/settings`). When non-zero, the Hub enforces a minimum interval between messages from the same connection.
- **`min_account_age_seconds`** — also in `chat_settings`. Rejects messages from accounts younger than the threshold.

### Concurrency limits

- **Max concurrent WebSocket connections:** bounded by Go runtime goroutine limits and file-descriptor capacity. Practical limit is approximately **~10,000 connections per API instance** with the current single-Hub design.
- Memory budget: each connection holds a write channel and metadata; estimate ~8 KB per connection overhead.

### Horizontal scaling (future work)

- Current Hub is in-process and single-instance. Multiple API replicas each run an independent Hub with no cross-instance fan-out.
- **Planned approach:** Redis Pub/Sub fan-out — each instance subscribes to a shared channel; broadcasts are published to Redis and relayed to local connections.
- Until Redis fan-out is implemented, deploy a single API instance for chat or use sticky sessions at the load balancer.
