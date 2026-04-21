-- +goose Up
-- Seed default category weights for wagering (used by bonus.contributionCategoryWeightPct).
-- Slots count fully; live/table reduced; unknown categories partial. Adjust via admin SQL or future UI.
INSERT INTO game_contribution_profiles (name, weights)
SELECT 'default',
       '{"slots": 100, "live": 15, "table": 10, "crash": 50, "new": 100, "bonus-buys": 100, "other": 25, "default": 100}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM game_contribution_profiles WHERE name = 'default');

-- +goose Down
DELETE FROM game_contribution_profiles WHERE name = 'default';
