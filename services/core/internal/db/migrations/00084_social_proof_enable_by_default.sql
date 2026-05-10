-- +goose Up
-- Show sidebar social-proof stats for players unless operators explicitly disable in CMS.
UPDATE site_settings
SET value = jsonb_set(value, '{enabled}', 'true', true),
    updated_at = now()
WHERE key = 'social_proof.config';

-- +goose Down
UPDATE site_settings
SET value = jsonb_set(value, '{enabled}', 'false', true),
    updated_at = now()
WHERE key = 'social_proof.config';
