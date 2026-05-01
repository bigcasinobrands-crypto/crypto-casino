-- +goose Up
-- Append-only bonus domain audit trail (compliance / investigations).
CREATE TABLE bonus_audit_log (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'player', 'admin')),
    actor_id TEXT,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    bonus_instance_id UUID REFERENCES user_bonus_instances (id) ON DELETE SET NULL,
    promotion_version_id BIGINT REFERENCES promotion_versions (id) ON DELETE SET NULL,
    amount_delta_minor BIGINT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bonus_audit_log_user_created_idx ON bonus_audit_log (user_id, created_at DESC);
CREATE INDEX bonus_audit_log_instance_idx ON bonus_audit_log (bonus_instance_id, created_at DESC);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION forbid_bonus_audit_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'bonus_audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER bonus_audit_log_no_update
    BEFORE UPDATE ON bonus_audit_log
    FOR EACH ROW
    EXECUTE PROCEDURE forbid_bonus_audit_mutation();

CREATE TRIGGER bonus_audit_log_no_delete
    BEFORE DELETE ON bonus_audit_log
    FOR EACH ROW
    EXECUTE PROCEDURE forbid_bonus_audit_mutation();

-- Durable queue for post-commit side effects (outbound CRM row + player notifications).
CREATE TABLE bonus_outbox (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE INDEX bonus_outbox_pending_idx ON bonus_outbox (id) WHERE processed_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS bonus_outbox_pending_idx;
DROP TABLE IF EXISTS bonus_outbox;

DROP TRIGGER IF EXISTS bonus_audit_log_no_update ON bonus_audit_log;
DROP TRIGGER IF EXISTS bonus_audit_log_no_delete ON bonus_audit_log;
DROP FUNCTION IF EXISTS forbid_bonus_audit_mutation();

DROP INDEX IF EXISTS bonus_audit_log_instance_idx;
DROP INDEX IF EXISTS bonus_audit_log_user_created_idx;
DROP TABLE IF EXISTS bonus_audit_log;
