-- +goose Up
-- Player-facing entry tier name: Standard → Tadpole (same row / sort_order).

UPDATE vip_tiers
SET name = 'Tadpole'
WHERE name = 'Standard';

-- +goose Down

UPDATE vip_tiers
SET name = 'Standard'
WHERE name = 'Tadpole';
