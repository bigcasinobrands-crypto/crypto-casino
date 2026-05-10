-- +goose Up
-- Repair rows inserted before traffic_sessions fingerprint columns were guarded against NULL (NULLIF('', '') in upsert).
UPDATE traffic_sessions SET fingerprint_visitor_id = '' WHERE fingerprint_visitor_id IS NULL;
UPDATE traffic_sessions SET fingerprint_request_id = '' WHERE fingerprint_request_id IS NULL;
UPDATE traffic_sessions SET geo_source = '' WHERE geo_source IS NULL;

-- +goose Down
SELECT 1;
