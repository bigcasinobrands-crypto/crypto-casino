-- +goose Up
-- Archived challenges stay in admin history but are excluded from normal player lobby flows (same as draft/paused for listing).

ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
ALTER TABLE challenges
  ADD CONSTRAINT challenges_status_check CHECK (
    status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled', 'archived')
  );

-- +goose Down
ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_status_check;
-- Data with status 'archived' would violate the old check; map them to cancelled before re-adding.
UPDATE challenges SET status = 'cancelled' WHERE status = 'archived';
ALTER TABLE challenges
  ADD CONSTRAINT challenges_status_check CHECK (
    status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled')
  );
