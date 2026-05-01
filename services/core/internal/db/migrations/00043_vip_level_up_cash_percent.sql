-- +goose Up
ALTER TABLE vip_tier_benefits
    DROP CONSTRAINT IF EXISTS vip_tier_benefits_benefit_type_check;

ALTER TABLE vip_tier_benefits
    ADD CONSTRAINT vip_tier_benefits_benefit_type_check
    CHECK (benefit_type IN ('grant_promotion', 'rebate_percent_add', 'vip_card_feature', 'level_up_cash_percent'));

-- +goose Down
ALTER TABLE vip_tier_benefits
    DROP CONSTRAINT IF EXISTS vip_tier_benefits_benefit_type_check;

ALTER TABLE vip_tier_benefits
    ADD CONSTRAINT vip_tier_benefits_benefit_type_check
    CHECK (benefit_type IN ('grant_promotion', 'rebate_percent_add', 'vip_card_feature'));
