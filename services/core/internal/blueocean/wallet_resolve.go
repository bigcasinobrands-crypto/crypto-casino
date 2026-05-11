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

	rows, err := pool.Query(ctx, `
		SELECT user_id::text FROM blueocean_player_links
		WHERE remote_player_id = $1
	`, remote)
	if err != nil {
		return "", err
	}
	var exact []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			rows.Close()
			return "", err
		}
		exact = append(exact, uid)
	}
	rows.Close()
	switch len(exact) {
	case 1:
		return exact[0], nil
	case 0:
		// fall through to hyphen-insensitive match
	default:
		return "", fmt.Errorf("blueocean: ambiguous remote_player_id match")
	}

	rows2, err := pool.Query(ctx, `
		SELECT user_id::text FROM blueocean_player_links
		WHERE lower(replace(remote_player_id, '-', '')) = lower(replace($1::text, '-', ''))
	`, remote)
	if err != nil {
		return "", err
	}
	var norm []string
	for rows2.Next() {
		var uid string
		if err := rows2.Scan(&uid); err != nil {
			rows2.Close()
			return "", err
		}
		norm = append(norm, uid)
	}
	rows2.Close()
	switch len(norm) {
	case 1:
		return norm[0], nil
	case 0:
		// fall through
	default:
		return "", fmt.Errorf("blueocean: ambiguous normalized remote_id match")
	}

	var userID string

	if u, perr := uuid.Parse(remote); perr == nil {
		err := pool.QueryRow(ctx, `SELECT id::text FROM users WHERE id = $1`, u).Scan(&userID)
		if err == nil && userID != "" {
			return userID, nil
		}
	}

	return "", fmt.Errorf("blueocean: user not found for remote_id")
}
