-- +goose Up
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS prize_payout_asset_key TEXT;

COMMENT ON COLUMN challenges.prize_payout_asset_key IS 'Fystack deposit asset key (e.g. USDT_ERC20) for ops/display; ledger credit still uses prize_currency.';

-- +goose Down
ALTER TABLE challenges DROP COLUMN IF EXISTS prize_payout_asset_key;
