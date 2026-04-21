-- +goose Up
-- Placeholder row for analytics when the sportsbook is launched via BOG id / custom XAPI (no single catalog tile).
INSERT INTO games (
	id,
	title,
	provider,
	category,
	thumbnail_url,
	metadata,
	bog_game_id,
	game_type,
	hidden,
	play_for_fun_supported
) VALUES (
	'__blueocean_sportsbook__',
	'Sportsbook',
	'blueocean',
	'sports',
	NULL,
	'{}'::jsonb,
	NULL,
	'sportsbook',
	true,
	true
) ON CONFLICT (id) DO NOTHING;

-- +goose Down
DELETE FROM games WHERE id = '__blueocean_sportsbook__';
