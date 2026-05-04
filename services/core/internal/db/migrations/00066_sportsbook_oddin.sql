-- +goose Up
-- Oddin Bifrost iframe tokens, iframe analytics client logs, operator callback audit.

CREATE TABLE IF NOT EXISTS sportsbook_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'ODDIN',
    token_hash TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    language TEXT NOT NULL DEFAULT 'en',
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sportsbook_sessions_token_hash_idx ON sportsbook_sessions (token_hash);
CREATE INDEX IF NOT EXISTS sportsbook_sessions_user_provider_idx ON sportsbook_sessions (user_id, provider) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS sportsbook_iframe_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    session_id TEXT,
    provider TEXT NOT NULL DEFAULT 'ODDIN',
    event_type TEXT NOT NULL,
    action TEXT,
    route TEXT,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sportsbook_iframe_events_type_idx ON sportsbook_iframe_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS sportsbook_iframe_events_user_idx ON sportsbook_iframe_events (user_id, created_at DESC) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sportsbook_provider_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'ODDIN',
    endpoint TEXT NOT NULL,
    provider_transaction_id TEXT,
    ticket_id TEXT,
    user_id UUID REFERENCES users (id) ON DELETE SET NULL,
    request_body JSONB NOT NULL DEFAULT '{}',
    response_body JSONB,
    status TEXT NOT NULL,
    error_code INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sportsbook_provider_tx_unique
    ON sportsbook_provider_requests (provider, provider_transaction_id)
    WHERE provider_transaction_id IS NOT NULL AND provider_transaction_id <> '';

CREATE INDEX IF NOT EXISTS sportsbook_provider_requests_created_idx ON sportsbook_provider_requests (created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS sportsbook_provider_requests;
DROP TABLE IF EXISTS sportsbook_iframe_events;
DROP TABLE IF EXISTS sportsbook_sessions;
