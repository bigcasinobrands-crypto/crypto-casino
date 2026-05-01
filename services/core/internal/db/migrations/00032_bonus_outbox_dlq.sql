-- +goose Up
ALTER TABLE bonus_outbox
    ADD COLUMN IF NOT EXISTS dlq_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bonus_outbox_dlq_idx ON bonus_outbox (dlq_at) WHERE dlq_at IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS bonus_outbox_dlq_idx;
ALTER TABLE bonus_outbox DROP COLUMN IF EXISTS dlq_at;
