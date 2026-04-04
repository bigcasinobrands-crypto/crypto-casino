# Blue Ocean catalog limits

## Sync behaviour

- Catalog sync calls remote **getGameList** via the internal Blue Ocean client, then upserts into `games`.
- **Paging (default):** `BLUEOCEAN_CATALOG_PAGE_SIZE` defaults to **500**. Sync sends `limit` + `offset` on each request (offset `0`, `500`, `1000`, …) until a page returns fewer than `PAGE_SIZE` games or an empty page. If the second page repeats the same first game id, sync stops and logs a warning (API may ignore offset — try `BLUEOCEAN_CATALOG_PAGING=page` or `from`, or set `BLUEOCEAN_CATALOG_PAGE_SIZE=0` for one-shot mode).
- **Paging styles** (`BLUEOCEAN_CATALOG_PAGING`):
  - `offset` (default): `limit`, `offset`
  - `page`: `page` (1-based), `per_page`, `limit`
  - `from`: `from`, `to`, `limit`
- Set **`BLUEOCEAN_CATALOG_PAGE_SIZE=0`** to disable paging (single `getGameList` call only — fine for small catalogs; **not** enough for thousands of games).
- Admin list endpoints cap rows (`limit` query, default 200 for games, 100 for launches/disputes) to keep responses bounded.

## Public game list

- `GET /v1/games` accepts optional **`limit=1..2000`** and **`offset`** (for paginated lobby UIs). Omitting `limit` returns the full result set (can be large).
- Player lobby / Blue Ocean / category tabs load the first page from the API and offer **Load more** using `offset`.

## Integration filter

- `GET /v1/games?integration=blueocean` returns only rows with `games.provider = 'blueocean'` (still `hidden = false`). Catalog sync and demo seeds use this provider value. This is separate from `provider=` on the same endpoint, which filters **`provider_system`** (e.g. pragmatic).

## Lobby tags

- Optional env `BLUEOCEAN_LOBBY_TAGS_JSON` can drive `lobby_tags` during sync (implementation in sync layer). Pills in the player UI filter with `pill=` against `lobby_tags`.

## Featured rail

- Set `BLUEOCEAN_FEATURED_ID_HASHES` to a comma-separated list of provider **`id_hash`** values (same strings as in the BOG catalog).
- Public API: `GET /v1/games?featured=1` returns those games in list order, ordered like the env list (`array_position`). If the env list is empty, the response is an empty `games` array.
- Optional: `limit=1..2000` caps the number of rows returned (omitted = no limit).

## Thumbnails

- Parser collects URLs from common fields: `image_square`, `image`, `thumbnail`, `thumbnail_url`, `thumb`, nested `images`, etc.
- **`BLUEOCEAN_IMAGE_BASE_URL`**: if the API returns site-relative paths (e.g. `/cdn/...`), set this to the CDN origin so stored URLs are absolute (avoids broken images on the player domain).
- Protocol-relative URLs (`//cdn/...`) are normalized to `https:` for the player app.

## Roadmap

- Broader product and scaling notes live in [recommendations.md](./recommendations.md) and related docs in this folder.
