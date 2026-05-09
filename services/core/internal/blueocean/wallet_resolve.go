package blueocean

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ResolveWalletRemoteToUserID maps Blue Ocean seamless-wallet remote_id to our users.id (text).
//
// Blue Ocean echoes the XAPI userid from createPlayer (often a canonical UUID, a 32-hex compact UUID
// when BLUEOCEAN_USER_ID_NO_HYPHENS is set, or a provider numeric string). We persist BO’s response id
// in blueocean_player_links.remote_player_id, which may differ in hyphenation/casing from callbacks.
//
// Resolution order:
//  1) blueocean_player_links — exact remote_player_id match, then hyphen-insensitive comparison
//  2) users — id matches when remote_id parses as a UUID (RFC, compact hex, etc.)
func ResolveWalletRemoteToUserID(ctx context.Context, pool *pgxpool.Pool, remote string) (string, error) {
	if pool == nil {
		return "", fmt.Errorf("blueocean: no database pool")
	}
	remote = strings.TrimSpace(remote)
	if remote == "" {
		return "", fmt.Errorf("blueocean: empty remote_id")
	}

	var userID string
	err := pool.QueryRow(ctx, `
		SELECT user_id::text FROM blueocean_player_links
		WHERE remote_player_id = $1
		   OR lower(replace(remote_player_id, '-', '')) = lower(replace($1::text, '-', ''))
		LIMIT 1
	`, remote).Scan(&userID)
	if err == nil && userID != "" {
		return userID, nil
	}

	if u, perr := uuid.Parse(remote); perr == nil {
		err := pool.QueryRow(ctx, `SELECT id::text FROM users WHERE id = $1`, u).Scan(&userID)
		if err == nil && userID != "" {
			return userID, nil
		}
	}

	return "", fmt.Errorf("blueocean: user not found for remote_id")
}
