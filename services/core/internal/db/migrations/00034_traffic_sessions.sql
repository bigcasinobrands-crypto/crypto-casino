-- +goose Up
-- Anonymous / signed-in browser sessions for demographics & traffic admin views.
CREATE TABLE traffic_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_key TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    country_iso2 TEXT,
    device_type TEXT NOT NULL DEFAULT 'unknown',
    referrer_host TEXT NOT NULL DEFAULT '',
    landing_path TEXT NOT NULL DEFAULT '',
    last_path TEXT NOT NULL DEFAULT '',
    utm_source TEXT NOT NULL DEFAULT '',
    utm_medium TEXT NOT NULL DEFAULT '',
    utm_campaign TEXT NOT NULL DEFAULT '',
    utm_content TEXT NOT NULL DEFAULT '',
    utm_term TEXT NOT NULL DEFAULT '',
    page_views INT NOT NULL DEFAULT 1,
    CONSTRAINT traffic_sessions_session_key_unique UNIQUE (session_key)
);

CREATE INDEX traffic_sessions_started_at_idx ON traffic_sessions (started_at DESC);
CREATE INDEX traffic_sessions_last_at_idx ON traffic_sessions (last_at DESC);
CREATE INDEX traffic_sessions_user_id_idx ON traffic_sessions (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX traffic_sessions_country_iso2_idx ON traffic_sessions (country_iso2) WHERE country_iso2 IS NOT NULL AND country_iso2 <> '';

-- +goose Down
DROP TABLE IF EXISTS traffic_sessions;
