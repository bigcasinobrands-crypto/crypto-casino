-- +goose Up
CREATE TABLE IF NOT EXISTS chat_blocked_terms (
    id BIGSERIAL PRIMARY KEY,
    term TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_blocked_terms_term_unique ON chat_blocked_terms (lower(trim(term)));

CREATE INDEX IF NOT EXISTS chat_blocked_terms_enabled_idx ON chat_blocked_terms (enabled) WHERE enabled = true;

-- +goose Down
DROP TABLE IF EXISTS chat_blocked_terms;
