-- +goose Up
-- Ledger pockets: cash vs bonus_locked (playable total = sum of both for BlueOcean balance).
ALTER TABLE ledger_entries
    ADD COLUMN IF NOT EXISTS pocket TEXT NOT NULL DEFAULT 'cash';

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_pocket_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_pocket_check
    CHECK (pocket IN ('cash', 'bonus_locked'));

CREATE INDEX IF NOT EXISTS ledger_entries_user_pocket_idx ON ledger_entries (user_id, pocket);

-- Global bonus flags (singleton with payment_ops_flags).
ALTER TABLE payment_ops_flags
    ADD COLUMN IF NOT EXISTS bonuses_enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS automated_grants_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE promotions (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE promotion_versions (
    id BIGSERIAL PRIMARY KEY,
    promotion_id BIGINT NOT NULL REFERENCES promotions (id) ON DELETE CASCADE,
    version INT NOT NULL,
    rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    terms_text TEXT,
    terms_hash TEXT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (promotion_id, version)
);

CREATE INDEX promotion_versions_promotion_idx ON promotion_versions (promotion_id, version DESC);

CREATE TABLE user_bonus_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    promotion_version_id BIGINT NOT NULL REFERENCES promotion_versions (id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'pending_review', 'active', 'completed', 'expired', 'forfeited', 'cancelled'
    )),
    granted_amount_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USDT',
    wr_required_minor BIGINT NOT NULL DEFAULT 0,
    wr_contributed_minor BIGINT NOT NULL DEFAULT 0,
    max_bet_minor BIGINT,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    terms_version TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    risk_explanation JSONB,
    metadata JSONB,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_bonus_instances_user_idx ON user_bonus_instances (user_id, status, created_at DESC);
CREATE INDEX user_bonus_instances_promo_ver_idx ON user_bonus_instances (promotion_version_id);

CREATE TABLE bonus_automation_rules (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    priority INT NOT NULL DEFAULT 0,
    trigger_type TEXT NOT NULL,
    schedule_cron TEXT,
    segment_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    action JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bonus_risk_decisions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    promotion_version_id BIGINT REFERENCES promotion_versions (id) ON DELETE SET NULL,
    decision TEXT NOT NULL CHECK (decision IN ('allowed', 'denied', 'manual_review')),
    rule_codes TEXT[] NOT NULL DEFAULT '{}',
    inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX bonus_risk_decisions_user_idx ON bonus_risk_decisions (user_id, created_at DESC);

CREATE TABLE worker_failed_jobs (
    id BIGSERIAL PRIMARY KEY,
    job_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    error_text TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX worker_failed_jobs_unresolved_idx ON worker_failed_jobs (created_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE chat_settings (
    id INT PRIMARY KEY DEFAULT 1,
    chat_enabled BOOLEAN NOT NULL DEFAULT true,
    slow_mode_seconds INT NOT NULL DEFAULT 0,
    min_account_age_seconds INT NOT NULL DEFAULT 300,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chat_settings_singleton CHECK (id = 1)
);

INSERT INTO chat_settings (id, chat_enabled, slow_mode_seconds, min_account_age_seconds)
VALUES (1, true, 0, 300)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE player_notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX player_notifications_user_idx ON player_notifications (user_id, created_at DESC);

CREATE TABLE game_contribution_profiles (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    weights JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS game_contribution_profiles;
DROP TABLE IF EXISTS player_notifications;
DROP TABLE IF EXISTS chat_settings;
DROP TABLE IF EXISTS worker_failed_jobs;
DROP TABLE IF EXISTS bonus_risk_decisions;
DROP TABLE IF EXISTS bonus_automation_rules;
DROP TABLE IF EXISTS user_bonus_instances;
DROP TABLE IF EXISTS promotion_versions;
DROP TABLE IF EXISTS promotions;

ALTER TABLE payment_ops_flags DROP COLUMN IF EXISTS automated_grants_enabled;
ALTER TABLE payment_ops_flags DROP COLUMN IF EXISTS bonuses_enabled;

DROP INDEX IF EXISTS ledger_entries_user_pocket_idx;
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_pocket_check;
ALTER TABLE ledger_entries DROP COLUMN IF EXISTS pocket;
