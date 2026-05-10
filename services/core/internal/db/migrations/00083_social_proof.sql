-- +goose Up
INSERT INTO site_settings (key, value, updated_at)
VALUES (
    'social_proof.config',
    '{"enabled":false,"online_target":180,"online_variance_pct":22,"online_bucket_secs":90,"wager_display_multiplier":1}'::jsonb,
    now()
)
ON CONFLICT (key) DO NOTHING;

-- +goose Down
DELETE FROM site_settings WHERE key = 'social_proof.config';
