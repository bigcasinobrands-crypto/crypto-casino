-- +goose Up

-- Promotion versions: scheduling, marketing, dedupe, tie-break
ALTER TABLE promotion_versions
    ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS timezone TEXT,
    ADD COLUMN IF NOT EXISTS weekly_schedule JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS internal_title TEXT,
    ADD COLUMN IF NOT EXISTS player_title TEXT,
    ADD COLUMN IF NOT EXISTS player_description TEXT,
    ADD COLUMN IF NOT EXISTS promo_code TEXT,
    ADD COLUMN IF NOT EXISTS offer_family TEXT,
    ADD COLUMN IF NOT EXISTS eligibility_fingerprint TEXT,
    ADD COLUMN IF NOT EXISTS dedupe_group_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS promotion_versions_promo_code_lower_uidx
    ON promotion_versions (LOWER(TRIM(promo_code)))
    WHERE promo_code IS NOT NULL AND TRIM(promo_code) <> '';

CREATE INDEX IF NOT EXISTS promotion_versions_live_dedupe_idx
    ON promotion_versions (published_at, offer_family, eligibility_fingerprint)
    WHERE published_at IS NOT NULL;

-- Instance rules at grant time (WR / exclusions); backfilled from promotion version rules
ALTER TABLE user_bonus_instances
    ADD COLUMN IF NOT EXISTS rules_snapshot JSONB;

UPDATE user_bonus_instances u
SET rules_snapshot = pv.rules
FROM promotion_versions pv
WHERE u.promotion_version_id = pv.id
  AND (u.rules_snapshot IS NULL OR u.rules_snapshot = 'null'::jsonb);

-- Explicit per-version player targeting
CREATE TABLE IF NOT EXISTS promotion_targets (
    promotion_version_id BIGINT NOT NULL REFERENCES promotion_versions (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (promotion_version_id, user_id)
);

CREATE INDEX IF NOT EXISTS promotion_targets_user_idx ON promotion_targets (user_id);

-- Daily aggregates for admin performance cards
CREATE TABLE IF NOT EXISTS bonus_campaign_daily_stats (
    stat_date DATE NOT NULL,
    promotion_version_id BIGINT NOT NULL REFERENCES promotion_versions (id) ON DELETE CASCADE,
    grants_count INT NOT NULL DEFAULT 0,
    grant_volume_minor BIGINT NOT NULL DEFAULT 0,
    active_instances_end INT NOT NULL DEFAULT 0,
    completed_wr INT NOT NULL DEFAULT 0,
    forfeited INT NOT NULL DEFAULT 0,
    cost_minor BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (stat_date, promotion_version_id)
);

-- VIP (wagering-based)
CREATE TABLE IF NOT EXISTS vip_tiers (
    id SERIAL PRIMARY KEY,
    sort_order INT NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    min_lifetime_wager_minor BIGINT NOT NULL DEFAULT 0,
    perks JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO vip_tiers (sort_order, name, min_lifetime_wager_minor, perks)
SELECT 0, 'Standard', 0, '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM vip_tiers LIMIT 1);

CREATE TABLE IF NOT EXISTS player_vip_state (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    tier_id INT REFERENCES vip_tiers (id),
    points_balance BIGINT NOT NULL DEFAULT 0,
    lifetime_wager_minor BIGINT NOT NULL DEFAULT 0,
    last_accrual_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vip_point_ledger (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    delta BIGINT NOT NULL,
    reason TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vip_point_ledger_user_created_idx ON vip_point_ledger (user_id, created_at DESC);

-- Risk signals stub (admin facts)
CREATE TABLE IF NOT EXISTS player_risk_signals (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    score INT NOT NULL DEFAULT 0,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_risk_signals_user_created_idx ON player_risk_signals (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS player_internal_notes (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    body TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES staff_users (id)
);

CREATE TABLE IF NOT EXISTS player_watchlist (
    user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT true,
    reason TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES staff_users (id)
);

-- Default tunable bonus abuse policy (merged in code with hardcoded fallbacks)
INSERT INTO site_settings (key, value, updated_at)
VALUES (
    'bonus_abuse_policy',
    '{
      "max_grants_per_user_per_24h": 5,
      "max_grants_same_promo_version_per_user_per_24h": 1,
      "min_account_age_seconds": 3600,
      "max_concurrent_active_bonuses": 1,
      "max_lifetime_grant_minor_per_user_per_promo": 5000000,
      "promo_code_verify_cooldown_seconds": 30,
      "promo_code_max_attempts_per_ip_per_hour": 40,
      "manual_review_grant_minor_threshold": 100000,
      "max_csv_targets_per_upload": 50000
    }'::jsonb,
    now()
)
ON CONFLICT (key) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS player_watchlist;
DROP TABLE IF EXISTS player_internal_notes;
DROP TABLE IF EXISTS player_risk_signals;
DROP TABLE IF EXISTS vip_point_ledger;
DROP TABLE IF EXISTS player_vip_state;
DROP TABLE IF EXISTS vip_tiers;
DROP TABLE IF EXISTS bonus_campaign_daily_stats;
DROP TABLE IF EXISTS promotion_targets;

DELETE FROM site_settings WHERE key = 'bonus_abuse_policy';

ALTER TABLE user_bonus_instances DROP COLUMN IF EXISTS rules_snapshot;

DROP INDEX IF EXISTS promotion_versions_live_dedupe_idx;
DROP INDEX IF EXISTS promotion_versions_promo_code_lower_uidx;

ALTER TABLE promotion_versions
    DROP COLUMN IF EXISTS dedupe_group_key,
    DROP COLUMN IF EXISTS eligibility_fingerprint,
    DROP COLUMN IF EXISTS offer_family,
    DROP COLUMN IF EXISTS promo_code,
    DROP COLUMN IF EXISTS player_description,
    DROP COLUMN IF EXISTS player_title,
    DROP COLUMN IF EXISTS internal_title,
    DROP COLUMN IF EXISTS weekly_schedule,
    DROP COLUMN IF EXISTS timezone,
    DROP COLUMN IF EXISTS valid_to,
    DROP COLUMN IF EXISTS valid_from,
    DROP COLUMN IF EXISTS priority;
