-- +goose Up
-- Rebate grants: legacy rows were paid as bonus instances; new rows accrue as pending_wallet until player claims cash.

ALTER TABLE reward_rebate_grants
    ADD COLUMN IF NOT EXISTS payout_status TEXT NOT NULL DEFAULT 'pending_wallet';

UPDATE reward_rebate_grants SET payout_status = 'bonus_locked' WHERE payout_status = 'pending_wallet';

ALTER TABLE reward_rebate_grants DROP CONSTRAINT IF EXISTS reward_rebate_grants_payout_status_check;
ALTER TABLE reward_rebate_grants ADD CONSTRAINT reward_rebate_grants_payout_status_check
    CHECK (payout_status IN ('pending_wallet', 'wallet_paid', 'bonus_locked'));

COMMENT ON COLUMN reward_rebate_grants.payout_status IS
    'pending_wallet: awaiting player claim to cash; wallet_paid: credited via promo.rakeback ledger; bonus_locked: historical grant as bonus instance.';

-- +goose Down
ALTER TABLE reward_rebate_grants DROP CONSTRAINT IF EXISTS reward_rebate_grants_payout_status_check;
ALTER TABLE reward_rebate_grants DROP COLUMN IF EXISTS payout_status;
