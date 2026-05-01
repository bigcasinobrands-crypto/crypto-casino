-- +goose Up
-- Primary bonus slot: at most MaxConcurrentActiveBonuses (default 1) non-exempt instances
-- in active|pending|pending_review. VIP tier benefit grants set exempt_from_primary_slot.
ALTER TABLE user_bonus_instances
	ADD COLUMN IF NOT EXISTS exempt_from_primary_slot BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_bonus_instances.exempt_from_primary_slot IS
	'When true (e.g. VIP tier grant_promotion), instance does not consume the player primary bonus slot.';

CREATE TABLE IF NOT EXISTS player_bonus_deposit_intents (
	user_id UUID NOT NULL PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
	promotion_version_id BIGINT NOT NULL REFERENCES promotion_versions (id) ON DELETE CASCADE,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS player_bonus_deposit_intents_pv_idx
	ON player_bonus_deposit_intents (promotion_version_id);

-- +goose Down
DROP TABLE IF EXISTS player_bonus_deposit_intents;
ALTER TABLE user_bonus_instances DROP COLUMN IF EXISTS exempt_from_primary_slot;
