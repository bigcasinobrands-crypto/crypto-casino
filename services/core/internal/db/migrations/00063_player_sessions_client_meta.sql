-- +goose Up
ALTER TABLE player_sessions
    ADD COLUMN IF NOT EXISTS client_ip TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS user_agent TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS fingerprint_visitor_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS fingerprint_request_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS country_iso2 TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS geo_source TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS player_sessions_fp_visitor_idx ON player_sessions (fingerprint_visitor_id)
    WHERE fingerprint_visitor_id IS NOT NULL AND fingerprint_visitor_id <> '';

COMMENT ON COLUMN player_sessions.geo_source IS 'edge | fingerprint | empty';

-- +goose Down
DROP INDEX IF EXISTS player_sessions_fp_visitor_idx;
ALTER TABLE player_sessions
    DROP COLUMN IF EXISTS last_seen_at,
    DROP COLUMN IF EXISTS geo_source,
    DROP COLUMN IF EXISTS device_type,
    DROP COLUMN IF EXISTS city,
    DROP COLUMN IF EXISTS region,
    DROP COLUMN IF EXISTS country_iso2,
    DROP COLUMN IF EXISTS fingerprint_request_id,
    DROP COLUMN IF EXISTS fingerprint_visitor_id,
    DROP COLUMN IF EXISTS user_agent,
    DROP COLUMN IF EXISTS client_ip;
