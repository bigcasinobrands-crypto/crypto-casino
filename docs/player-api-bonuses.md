# Player API — bonuses & VIP (JSON)

Authenticated with player Bearer JWT (same as wallet routes).

## `GET /v1/bonuses/available`

Strict eligibility: published offers the player passes segment/targeting/schedule gates for. Header `X-Geo-Country` (ISO2) optional for country rules.

Response: `{ "offers": [ { "promotion_version_id", "title", "description", "kind", "schedule_summary", "trigger_type" } ] }`

Rate limit: 30 req/min per IP (tune in `cmd/api/main.go`).

## `GET /v1/vip/status`

Response: `{ "tier", "points", "next_tier"?, "progress": { "lifetime_wager_minor", ... } }`

## `GET /v1/rewards/hub`

Optional query: `calendar_days` (1–31, default 7).

Response includes `calendar`, `hunt`, `vip`, `bonus_instances` (with `title`, `bonus_type`), `available_offers`, `aggregates` (`bonus_locked_minor`, `wagering_remaining_minor`, `lifetime_promo_minor`).

## `GET /v1/rewards/calendar`

Query: `days` (1–31). Response: `{ "calendar": [ { "date", "state", "amount_minor", "unlock_at"? } ] }`.

## `POST /v1/rewards/daily/claim`

Body: `{ "date": "YYYY-MM-DD" }` (UTC). Idempotent when already claimed.

## Enriched list endpoints

- `GET /v1/wallet/bonuses` — each bonus may include `title`, `bonus_type` from the promotion version.
- `GET /v1/bonuses/available` — each offer may include `bonus_type`, `valid_from`, `valid_to` (RFC3339).
