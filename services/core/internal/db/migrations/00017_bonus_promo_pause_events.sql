-- +goose Up
ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS grants_paused BOOLEAN NOT NULL DEFAULT false;

-- CRM / ESP integration hook: append-only outbox-style stream (consumers poll or future webhook).
CREATE TABLE IF NOT EXISTS bonus_outbound_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bonus_outbound_events_type_created_idx ON bonus_outbound_events (event_type, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS bonus_outbound_events;
ALTER TABLE promotions DROP COLUMN IF EXISTS grants_paused;
