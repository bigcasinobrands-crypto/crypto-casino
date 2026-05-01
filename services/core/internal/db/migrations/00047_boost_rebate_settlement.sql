-- +goose Up
ALTER TABLE vip_rakeback_boost_claims
    ADD COLUMN IF NOT EXISTS rebate_settled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS vip_rakeback_boost_claims_settle_pending_idx
    ON vip_rakeback_boost_claims (active_until_at)
    WHERE rebate_settled_at IS NULL;

COMMENT ON COLUMN vip_rakeback_boost_claims.rebate_settled_at IS
    'When timed boost extra rakeback was booked to reward_rebate_grants (pending_wallet).';

-- +goose Down
DROP INDEX IF EXISTS vip_rakeback_boost_claims_settle_pending_idx;
ALTER TABLE vip_rakeback_boost_claims DROP COLUMN IF EXISTS rebate_settled_at;
