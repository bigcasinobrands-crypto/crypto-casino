-- +goose Up
-- Player gave up a specific hub offer (forfeited instance or cancelled pre-deposit intent);
-- that promotion_version must not reappear in "available" for this user.
CREATE TABLE IF NOT EXISTS player_promotion_relinquishments (
	user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	promotion_version_id BIGINT NOT NULL REFERENCES promotion_versions (id) ON DELETE CASCADE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	source TEXT NOT NULL DEFAULT 'forfeit' CHECK (source IN ('forfeit', 'cancel_intent')),
	PRIMARY KEY (user_id, promotion_version_id)
);

CREATE INDEX IF NOT EXISTS player_promotion_relinquishments_pvid_idx
	ON player_promotion_relinquishments (promotion_version_id);

-- +goose Down
DROP TABLE IF EXISTS player_promotion_relinquishments;
