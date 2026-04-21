-- +goose Up
-- Marketing VIP ladder + hide default "Standard" from public /v1/vip/program.

UPDATE vip_tiers
SET perks = COALESCE(perks, '{}'::jsonb) || jsonb_build_object('hide_from_public_page', true)
WHERE name = 'Standard'
  AND COALESCE(perks->>'hide_from_public_page', '') <> 'true';

INSERT INTO vip_tiers (sort_order, name, min_lifetime_wager_minor, perks)
SELECT 1, 'FISH', 250000,
       '{"hide_from_public_page":false,"display":{"header_color":"#898b8a","character_image_url":"https://storage.googleapis.com/banani-generated-images/generated-images/ef83d3d0-a445-4d27-8cd3-33ddbd1e7ab4.jpg","rank_label":"Rank 1"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM vip_tiers WHERE name = 'FISH');

INSERT INTO vip_tiers (sort_order, name, min_lifetime_wager_minor, perks)
SELECT 5, 'SEAL', 2500000,
       '{"hide_from_public_page":false,"display":{"header_color":"#b5b318","character_image_url":"https://storage.googleapis.com/banani-generated-images/generated-images/f71961e7-d1fe-4fed-baab-ddf1721a127d.jpg","rank_label":"Rank 5"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM vip_tiers WHERE name = 'SEAL');

INSERT INTO vip_tiers (sort_order, name, min_lifetime_wager_minor, perks)
SELECT 10, 'PIRANHA', 10000000,
       '{"hide_from_public_page":false,"display":{"header_color":"#0188ef","character_image_url":"https://storage.googleapis.com/banani-generated-images/generated-images/d48069ca-7344-40dc-9496-71fac363005c.jpg","rank_label":"Rank 10"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM vip_tiers WHERE name = 'PIRANHA');

INSERT INTO vip_tiers (sort_order, name, min_lifetime_wager_minor, perks)
SELECT 15, 'SHARK', 25000000,
       '{"hide_from_public_page":false,"display":{"header_color":"#f16422","character_image_url":"https://storage.googleapis.com/banani-generated-images/generated-images/632cae50-02f1-4b30-b233-d3095377e376.jpg","rank_label":"Rank 15"}}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM vip_tiers WHERE name = 'SHARK');

-- +goose Down
DELETE FROM vip_tiers WHERE name IN ('FISH', 'SEAL', 'PIRANHA', 'SHARK');

UPDATE vip_tiers
SET perks = perks - 'hide_from_public_page'
WHERE name = 'Standard';
