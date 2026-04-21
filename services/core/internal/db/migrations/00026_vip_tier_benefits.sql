-- +goose Up
-- Structured VIP tier benefits (promotion grants + passive rebate %), audit events, idempotent grant log.
-- Idempotency: vip_tier_grant_log unique (user_id, tier_id, benefit_id) enforces once-per-tier-per-benefit for grant_promotion.

CREATE TABLE IF NOT EXISTS vip_tier_benefits (
    id BIGSERIAL PRIMARY KEY,
    tier_id INT NOT NULL REFERENCES vip_tiers (id) ON DELETE CASCADE,
    sort_order INT NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT true,
    benefit_type TEXT NOT NULL CHECK (benefit_type IN ('grant_promotion', 'rebate_percent_add')),
    promotion_version_id BIGINT REFERENCES promotion_versions (id) ON DELETE SET NULL,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    player_title TEXT,
    player_description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vip_tier_benefits_tier_sort_idx ON vip_tier_benefits (tier_id, sort_order ASC, id ASC);

COMMENT ON TABLE vip_tier_benefits IS 'VIP tier perks: grant_promotion uses promotion_version_id + optional config.grant_amount_minor override; rebate_percent_add uses config.rebate_program_key + config.percent_add (integer points added to base rebate %).';

CREATE TABLE IF NOT EXISTS vip_tier_events (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    from_tier_id INT REFERENCES vip_tiers (id) ON DELETE SET NULL,
    to_tier_id INT REFERENCES vip_tiers (id) ON DELETE SET NULL,
    lifetime_wager_minor BIGINT NOT NULL DEFAULT 0,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vip_tier_events_user_created_idx ON vip_tier_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vip_tier_events_created_idx ON vip_tier_events (created_at DESC);

CREATE TABLE IF NOT EXISTS vip_tier_grant_log (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    tier_id INT NOT NULL REFERENCES vip_tiers (id) ON DELETE CASCADE,
    benefit_id BIGINT NOT NULL REFERENCES vip_tier_benefits (id) ON DELETE CASCADE,
    promotion_version_id BIGINT,
    idempotency_key TEXT NOT NULL UNIQUE,
    result TEXT NOT NULL,
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, tier_id, benefit_id)
);

CREATE INDEX IF NOT EXISTS vip_tier_grant_log_user_idx ON vip_tier_grant_log (user_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS vip_tier_grant_log;
DROP TABLE IF EXISTS vip_tier_events;
DROP TABLE IF EXISTS vip_tier_benefits;
