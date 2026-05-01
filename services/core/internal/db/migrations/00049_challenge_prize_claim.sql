-- +goose Up
-- When true, cash prizes are not auto-credited on completion; player must POST /v1/challenges/{id}/claim.
-- Default false keeps existing challenges on auto-payout; admin UI defaults new challenges to claim flow.
ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS require_claim_for_prize BOOLEAN NOT NULL DEFAULT false;

-- +goose Down
ALTER TABLE challenges DROP COLUMN IF EXISTS require_claim_for_prize;
