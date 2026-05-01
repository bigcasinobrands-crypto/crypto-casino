-- +goose Up
CREATE TABLE IF NOT EXISTS vip_rakeback_boost_claims (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL,
    tier_id INT NOT NULL REFERENCES vip_tiers (id),
    benefit_id BIGINT NOT NULL REFERENCES vip_tier_benefits (id) ON DELETE CASCADE,
    window_start_at TIMESTAMPTZ NOT NULL,
    claim_deadline_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_until_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vip_rakeback_boost_claims_window_unique UNIQUE (user_id, benefit_id, window_start_at)
);

CREATE INDEX IF NOT EXISTS vip_rakeback_boost_claims_user_benefit_idx
    ON vip_rakeback_boost_claims (user_id, benefit_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS vip_rakeback_boost_claims_active_idx
    ON vip_rakeback_boost_claims (user_id, active_until_at DESC);

-- +goose Down
DROP INDEX IF EXISTS vip_rakeback_boost_claims_active_idx;
DROP INDEX IF EXISTS vip_rakeback_boost_claims_user_benefit_idx;
DROP TABLE IF EXISTS vip_rakeback_boost_claims;
