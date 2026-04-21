-- +goose Up
-- Entry tier is FISH (public ladder). Standard remains a legacy row for FKs but is not the player-facing default.

UPDATE vip_tiers
SET min_lifetime_wager_minor = 0
WHERE name = 'FISH';

-- Anyone still on Standard or without a tier moves to FISH.
UPDATE player_vip_state AS pvs
SET tier_id = fish.id,
    updated_at = now()
FROM (SELECT id FROM vip_tiers WHERE name = 'FISH' LIMIT 1) AS fish
WHERE fish.id IS NOT NULL
  AND (
    pvs.tier_id IS NULL
    OR pvs.tier_id = (SELECT id FROM vip_tiers WHERE name = 'Standard' LIMIT 1)
  );

-- +goose Down
UPDATE vip_tiers
SET min_lifetime_wager_minor = 250000
WHERE name = 'FISH';

-- Cannot safely revert player rows to Standard without business rules; no-op on player_vip_state.
