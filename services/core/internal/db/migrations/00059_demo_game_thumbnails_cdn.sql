-- +goose Up
-- Demo catalog rows: fill thumbnails when still empty (matches pigmo.com Cloudflare Images paths).
UPDATE games SET thumbnail_url = 'https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA/pragmaticexternal:GatesofOlympus1000.webp/public'
  WHERE id = 'demo-slot-1' AND COALESCE(TRIM(thumbnail_url), '') = '';
UPDATE games SET thumbnail_url = 'https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA/thumbs/playtech:RouletteLobby.webp/public'
  WHERE id = 'demo-live-1' AND COALESCE(TRIM(thumbnail_url), '') = '';
UPDATE games SET thumbnail_url = 'https://imagedelivery.net/9WutbSXJqeY8Kc44mJMbvA/thumbs/playtech:BlackjackLobby.webp/public'
  WHERE id = 'demo-table-1' AND COALESCE(TRIM(thumbnail_url), '') = '';

-- +goose Down
UPDATE games SET thumbnail_url = ''
  WHERE id IN ('demo-slot-1', 'demo-live-1', 'demo-table-1');
