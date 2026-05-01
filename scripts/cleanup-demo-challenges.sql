-- Remove challenges inserted by the old scripts/seed-dummy-challenges.sql.
-- Re-run safe. Does not delete challenges you created with other slugs (e.g. King of Sweets).
-- Children (entries, bet_events) remove via ON DELETE CASCADE.

DELETE FROM challenges
WHERE slug IN (
  'demo-high-roller-50x',
  'demo-wager-500',
  'demo-weekly-race',
  'demo-draft-fs',
  'demo-scheduled-kickoff'
);
