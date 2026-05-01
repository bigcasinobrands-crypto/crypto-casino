-- +goose Up
INSERT INTO games (id, title, provider, category, thumbnail_url) VALUES
  ('demo-slot-1', 'Neon Fruits', 'blueocean', 'slots', 'https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA/pragmaticexternal:GatesofOlympus1000.webp/public'),
  ('demo-live-1', 'Green Table Live', 'blueocean', 'live', 'https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA/thumbs/playtech:RouletteLobby.webp/public'),
  ('demo-table-1', 'Blackjack Classic', 'blueocean', 'table', 'https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA/thumbs/playtech:BlackjackLobby.webp/public')
ON CONFLICT (id) DO NOTHING;

-- +goose Down
DELETE FROM games WHERE id IN ('demo-slot-1', 'demo-live-1', 'demo-table-1');
