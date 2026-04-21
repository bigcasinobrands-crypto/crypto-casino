-- +goose Up
-- Rewards hub: configurable programs, daily claims, hunt progress, rebate period audit.

CREATE TABLE reward_programs (
    id BIGSERIAL PRIMARY KEY,
    program_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('daily_fixed', 'wager_rebate', 'cashback_net_loss', 'daily_hunt')),
    promotion_version_id BIGINT NOT NULL REFERENCES promotion_versions (id) ON DELETE RESTRICT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reward_programs_kind_enabled_idx ON reward_programs (kind, enabled, priority DESC);

COMMENT ON TABLE reward_programs IS 'Operator-configured reward programs; grants use promotion_version_id for WR/terms.';

CREATE TABLE player_reward_claims (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reward_program_id BIGINT NOT NULL REFERENCES reward_programs (id) ON DELETE CASCADE,
    claim_date DATE NOT NULL,
    amount_minor BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, reward_program_id, claim_date)
);

CREATE INDEX player_reward_claims_user_date_idx ON player_reward_claims (user_id, claim_date DESC);

CREATE TABLE player_hunt_progress (
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reward_program_id BIGINT NOT NULL REFERENCES reward_programs (id) ON DELETE CASCADE,
    hunt_date DATE NOT NULL,
    wager_accrued_minor BIGINT NOT NULL DEFAULT 0,
    last_threshold_index INT NOT NULL DEFAULT -1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, reward_program_id, hunt_date)
);

CREATE TABLE reward_rebate_grants (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    reward_program_id BIGINT NOT NULL REFERENCES reward_programs (id) ON DELETE CASCADE,
    period_key TEXT NOT NULL,
    base_minor BIGINT NOT NULL DEFAULT 0,
    grant_amount_minor BIGINT NOT NULL DEFAULT 0,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, reward_program_id, period_key)
);

CREATE INDEX reward_rebate_grants_program_period_idx ON reward_rebate_grants (reward_program_id, period_key);

-- +goose Down
DROP TABLE IF EXISTS reward_rebate_grants;
DROP TABLE IF EXISTS player_hunt_progress;
DROP TABLE IF EXISTS player_reward_claims;
DROP TABLE IF EXISTS reward_programs;
