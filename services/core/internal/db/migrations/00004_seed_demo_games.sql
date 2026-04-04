-- +goose Up
INSERT INTO games (id, title, provider, category, thumbnail_url) VALUES
  ('demo-slot-1', 'Neon Fruits', 'blueocean', 'slots', ''),
  ('demo-live-1', 'Green Table Live', 'blueocean', 'live', ''),
  ('demo-table-1', 'Blackjack Classic', 'blueocean', 'table', '')
ON CONFLICT (id) DO NOTHING;

-- +goose Down
DELETE FROM games WHERE id IN ('demo-slot-1', 'demo-live-1', 'demo-table-1');
