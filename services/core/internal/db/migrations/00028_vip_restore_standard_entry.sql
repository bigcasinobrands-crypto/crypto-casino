-- +goose Up
-- Standard is the entry tier again; FISH is the first public ladder rank (min lifetime wager).

UPDATE vip_tiers
SET min_lifetime_wager_minor = 250000
WHERE name = 'FISH';

-- Show Standard on /v1/vip/program alongside the named ladder.
UPDATE vip_tiers
SET perks = COALESCE(perks, '{}'::jsonb) || jsonb_build_object('hide_from_public_page', false)
WHERE name = 'Standard';

-- Players on FISH who have not met the FISH wager floor belong on Standard.
UPDATE player_vip_state AS pvs
SET tier_id = (SELECT id FROM vip_tiers WHERE name = 'Standard' LIMIT 1),
    updated_at = now()
WHERE pvs.tier_id = (SELECT id FROM vip_tiers WHERE name = 'FISH' LIMIT 1)
  AND pvs.lifetime_wager_minor < 250000;

-- +goose Down
UPDATE vip_tiers
SET min_lifetime_wager_minor = 0
WHERE name = 'FISH';

UPDATE vip_tiers
SET perks = COALESCE(perks, '{}'::jsonb) || jsonb_build_object('hide_from_public_page', true)
WHERE name = 'Standard';

-- Cannot safely revert player tier assignments; no-op on player_vip_state.
