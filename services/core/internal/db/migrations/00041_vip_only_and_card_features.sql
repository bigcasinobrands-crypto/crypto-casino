-- +goose Up
ALTER TABLE promotions
    ADD COLUMN IF NOT EXISTS vip_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE vip_tier_benefits
    DROP CONSTRAINT IF EXISTS vip_tier_benefits_benefit_type_check;

ALTER TABLE vip_tier_benefits
    ADD CONSTRAINT vip_tier_benefits_benefit_type_check
    CHECK (benefit_type IN ('grant_promotion', 'rebate_percent_add', 'vip_card_feature'));

COMMENT ON COLUMN promotions.vip_only IS 'If true, promotion is VIP-only and hidden from general player offer discovery.';

-- +goose Down
ALTER TABLE vip_tier_benefits
    DROP CONSTRAINT IF EXISTS vip_tier_benefits_benefit_type_check;

ALTER TABLE vip_tier_benefits
    ADD CONSTRAINT vip_tier_benefits_benefit_type_check
    CHECK (benefit_type IN ('grant_promotion', 'rebate_percent_add'));

ALTER TABLE promotions
    DROP COLUMN IF EXISTS vip_only;
