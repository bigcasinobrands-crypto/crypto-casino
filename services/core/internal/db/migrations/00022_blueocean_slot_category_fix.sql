-- +goose Up
-- BO getGameList often uses type "slots"; PrimaryLobbyKey previously mapped that to "other",
-- so lobby ?category=slots returned no rows. Fix rows already in DB; new syncs use updated Go.
UPDATE games
SET category = 'slots'
WHERE LOWER(TRIM(COALESCE(provider, ''))) = 'blueocean'
  AND category = 'other'
  AND LOWER(TRIM(COALESCE(game_type, ''))) IN ('slots', 'slot');

UPDATE games
SET category = 'live'
WHERE LOWER(TRIM(COALESCE(provider, ''))) = 'blueocean'
  AND category = 'other'
  AND LOWER(TRIM(COALESCE(game_type, ''))) = 'live';

-- +goose Down
UPDATE games
SET category = 'other'
WHERE LOWER(TRIM(COALESCE(provider, ''))) = 'blueocean'
  AND category = 'slots'
  AND LOWER(TRIM(COALESCE(game_type, ''))) IN ('slots', 'slot');

UPDATE games
SET category = 'other'
WHERE LOWER(TRIM(COALESCE(provider, ''))) = 'blueocean'
  AND category = 'live'
  AND LOWER(TRIM(COALESCE(game_type, ''))) = 'live';
