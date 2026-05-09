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

- **Spec:** [Blue Ocean — Seamless integration](https://blueoceangaming.atlassian.net/wiki/spaces/iGPPD/pages/1209172128/Seamless+integration) and linked debit / credit / rollback pages. The game engine calls your **HTTPS** URL with **GET** and query parameters; each request includes `key` where `key = sha1(salt + query_string)` and the query string **excludes** `key` (same as PHP `http_build_query` after `unset($data['key'])`).
- **Our routes:** `GET`/`POST` `/api/blueocean/callback` and, when Blue Ocean stores only the API origin, `GET`/`POST` `/` if the request carries a signed `key` or a JSON/form body (see code). Prefer configuring the **full** callback URL: `{API_PUBLIC_BASE}/api/blueocean/callback`.
- **Response JSON:** integer `status` (200, 403, 404, 500 per BO — insufficient funds use **403** with current balance), and string `balance` as **decimal major units** with two fractional digits (e.g. `300.00`), plus optional `msg`. HTTP response is **200 OK** with this body for wallet outcomes (auth/config failures may still return 4xx HTTP — confirm with your BO contact if their harness requires otherwise).
- **Env:** `BLUEOCEAN_WALLET_SALT` (required in production), and usually `BLUEOCEAN_WALLET_FLOAT_IS_MAJOR=true` when BO sends `amount` as decimal major units (e.g. `0.3` EUR). The value must **match exactly** the seamless / wallet salt shown for your API user in Blue Ocean; a mismatched salt always yields `invalid key`.
- **Players:** `remote_id` must resolve via `blueocean_player_links` or `users.id`. Rollbacks must **not** trust the request `amount`; we refund from ledger debits for `transaction_id` or return JSON `status` **404** with `TRANSACTION_NOT_FOUND` when no debit exists.
- Play eligibility (self-exclusion, closed account, geo, flags) matches launch rules; blocked play returns JSON `status` **403** with current balance.
