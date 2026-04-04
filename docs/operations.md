# Operations

## Health and readiness

- `GET /health/live` — process is up.
- `GET /health/ready` — database (and Redis when configured) respond to ping.
- `GET /health/operational` — JSON for player + staff-aligned hints: `maintenance_mode`, `disable_game_launch`, `blueocean_configured`, `visible_games_count`, `blueocean_visible_games_count`, `catalog_sync_ok` (false when `last_sync_error` is non-empty; error text is not exposed), optional `last_catalog_upserted`, `last_catalog_sync_at` (RFC3339 or null). The player UI polls this for banners and the catalog status line under each casino heading.

## Public game list

- `GET /v1/games` supports filters documented in `docs/bog-catalog-limits.md` (including `integration=blueocean`, `featured=1` when `BLUEOCEAN_FEATURED_ID_HASHES` is set, and optional `limit` up to 2000 with `offset` for pagination).

## Blue Ocean catalog

- Configure `BLUEOCEAN_API_*` variables on the core API (see `services/core/.env.example`).
- Staff: open **Admin → Integrations → Blue Ocean ops** (`/bog`) and run **Sync catalog** (POST `/v1/admin/integrations/blueocean/sync-catalog`).
- After credential or URL changes, re-sync and confirm `last_sync_at` / `last_sync_error` on the status panel.

## Kill switches

- `MAINTENANCE_MODE=true` — blocks play checks and launch; player UI shows a maintenance banner when operational health is reachable.
- `DISABLE_GAME_LAUNCH=true` — blocks game launch while keeping the rest of the API available.

## Seamless wallet callback

- GET `/api/blueocean/callback` implements stub wallet responses. With `BLUEOCEAN_WALLET_SALT` set, the `key` query parameter is verified as `SHA1(salt + canonical_query_without_key)` (confirm ordering against Blue Ocean’s PHP reference if signatures fail).
- When `remote_id` matches `blueocean_player_links`, the same play eligibility rules as launch (self-exclusion, closed account, geo, flags) are applied; HTTP status remains 200 with JSON `status` / `balance` per provider expectations.
