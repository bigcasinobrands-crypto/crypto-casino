-- +goose Up
ALTER TABLE traffic_sessions
    ADD COLUMN IF NOT EXISTS fingerprint_visitor_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS fingerprint_request_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS geo_source TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN traffic_sessions.fingerprint_visitor_id IS 'Fingerprint Pro visitorId — dedupe key for unique visitors';
COMMENT ON COLUMN traffic_sessions.fingerprint_request_id IS 'Last identification requestId (Server API lookup)';
COMMENT ON COLUMN traffic_sessions.geo_source IS 'edge (X-Geo-Country) | fingerprint | empty';

CREATE INDEX IF NOT EXISTS traffic_sessions_fp_visitor_idx ON traffic_sessions (fingerprint_visitor_id)
    WHERE fingerprint_visitor_id IS NOT NULL AND fingerprint_visitor_id <> '';

-- +goose Down
DROP INDEX IF EXISTS traffic_sessions_fp_visitor_idx;
ALTER TABLE traffic_sessions
    DROP COLUMN IF EXISTS geo_source,
    DROP COLUMN IF EXISTS fingerprint_request_id,
    DROP COLUMN IF EXISTS fingerprint_visitor_id;
