-- +goose Up
-- Tier-configurable player referral program + partner extensions.

CREATE TABLE IF NOT EXISTS referral_program_tiers (
    id                          SERIAL PRIMARY KEY,
    name                        TEXT NOT NULL,
    sort_order                  INT NOT NULL DEFAULT 0,
    active                      BOOLEAN NOT NULL DEFAULT true,
    -- Earning knobs (NULL = disabled for that component)
    ngr_revshare_bps            INT NULL
        CHECK (ngr_revshare_bps IS NULL OR (ngr_revshare_bps >= 0 AND ngr_revshare_bps <= 5000)),
    first_deposit_cpa_minor     BIGINT NULL
        CHECK (first_deposit_cpa_minor IS NULL OR first_deposit_cpa_minor >= 0),
    deposit_revshare_bps        INT NULL
        CHECK (deposit_revshare_bps IS NULL OR (deposit_revshare_bps >= 0 AND deposit_revshare_bps <= 5000)),
    -- Auto tier promotion thresholds (NULL = no requirement for that metric)
    min_referred_signups        INT NULL
        CHECK (min_referred_signups IS NULL OR min_referred_signups >= 0),
    min_referred_depositors     INT NULL
        CHECK (min_referred_depositors IS NULL OR min_referred_depositors >= 0),
    min_referred_deposit_volume_minor BIGINT NULL
        CHECK (min_referred_deposit_volume_minor IS NULL OR min_referred_deposit_volume_minor >= 0),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_program_tiers_active_sort_idx
    ON referral_program_tiers (active, sort_order ASC, id ASC);

ALTER TABLE affiliate_partners
    ADD COLUMN IF NOT EXISTS tier_id INT REFERENCES referral_program_tiers (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS tier_locked BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS affiliate_partners_tier_idx ON affiliate_partners (tier_id);

-- Seed default tier 1 (5% NGR) when empty — matches UI baseline Tier 1 (5%).
INSERT INTO referral_program_tiers (
    name, sort_order, active,
    ngr_revshare_bps, first_deposit_cpa_minor, deposit_revshare_bps,
    min_referred_signups, min_referred_depositors, min_referred_deposit_volume_minor
)
SELECT 'Tier 1', 10, true, 500, NULL, NULL, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM referral_program_tiers LIMIT 1);

INSERT INTO referral_program_tiers (
    name, sort_order, active,
    ngr_revshare_bps, first_deposit_cpa_minor, deposit_revshare_bps,
    min_referred_signups, min_referred_depositors, min_referred_deposit_volume_minor
)
SELECT 'Tier 2', 20, true, 550, NULL, NULL, 0, 3, 0
WHERE NOT EXISTS (SELECT 1 FROM referral_program_tiers WHERE sort_order = 20);

-- Backfill partners without tier to Tier 1 (lowest sort_order active tier).
UPDATE affiliate_partners p
SET tier_id = (SELECT id FROM referral_program_tiers WHERE active ORDER BY sort_order ASC, id ASC LIMIT 1)
WHERE p.tier_id IS NULL;

-- +goose Down
ALTER TABLE affiliate_partners DROP COLUMN IF EXISTS tier_locked;
ALTER TABLE affiliate_partners DROP COLUMN IF EXISTS tier_id;
DROP TABLE IF EXISTS referral_program_tiers;
