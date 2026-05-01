package bonus

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListFreeSpinGrantsForUser returns recent free spin grant rows (R3 tracking).
func ListFreeSpinGrantsForUser(ctx context.Context, pool *pgxpool.Pool, userID string, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := pool.Query(ctx, `
		SELECT id::text, promotion_version_id, status, game_id, bet_minor, rounds_total, rounds_remaining,
			provider, provider_ref, idempotency_key, created_at, updated_at
		FROM free_spin_grants
		WHERE user_id = $1::uuid
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, st, prov, pRef, idem string
		var pvn sql.NullInt64
		var game sql.NullString
		var bet, rTot, rRem int64
		var ct, ut time.Time
		if err := rows.Scan(&id, &pvn, &st, &game, &bet, &rTot, &rRem, &prov, &pRef, &idem, &ct, &ut); err != nil {
			continue
		}
		m := map[string]any{
			"id": id, "status": st, "bet_minor": bet, "rounds_total": rTot, "rounds_remaining": rRem,
			"provider": prov, "provider_ref": pRef, "idempotency_key": idem,
			"created_at": ct.UTC().Format(time.RFC3339), "updated_at": ut.UTC().Format(time.RFC3339),
		}
		if pvn.Valid {
			m["promotion_version_id"] = pvn.Int64
		}
		if game.Valid {
			m["game_id"] = game.String
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListFreeSpinGrantsRecent returns the most recent grants across all users (admin list).
func ListFreeSpinGrantsRecent(ctx context.Context, pool *pgxpool.Pool, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := pool.Query(ctx, `
		SELECT f.id::text, f.user_id::text, f.promotion_version_id, f.status, f.game_id, f.bet_minor,
			f.rounds_total, f.rounds_remaining, f.provider, f.provider_ref, f.idempotency_key, f.created_at, f.updated_at
		FROM free_spin_grants f
		ORDER BY f.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, uID, st, prov, pRef, idem string
		var pvn sql.NullInt64
		var game sql.NullString
		var bet, rTot, rRem int64
		var ct, ut time.Time
		if err := rows.Scan(&id, &uID, &pvn, &st, &game, &bet, &rTot, &rRem, &prov, &pRef, &idem, &ct, &ut); err != nil {
			continue
		}
		m := map[string]any{
			"id": id, "user_id": uID, "status": st, "bet_minor": bet, "rounds_total": rTot, "rounds_remaining": rRem,
			"provider": prov, "provider_ref": pRef, "idempotency_key": idem,
			"created_at": ct.UTC().Format(time.RFC3339), "updated_at": ut.UTC().Format(time.RFC3339),
		}
		if pvn.Valid {
			m["promotion_version_id"] = pvn.Int64
		}
		if game.Valid {
			m["game_id"] = game.String
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertFreeSpinGrant creates a local tracking row (idempotent on idempotency_key).
// inserted is false when the idempotency key already existed.
func InsertFreeSpinGrant(ctx context.Context, pool *pgxpool.Pool, userID string, pvid *int64, idem, gameID string, rounds int, betMinor int64) (id string, inserted bool, err error) {
	if idem == "" {
		return "", false, fmt.Errorf("bonus: idempotency key required for free spin grant")
	}
	var pvn sql.NullInt64
	if pvid != nil {
		pvn = sql.NullInt64{Int64: *pvid, Valid: true}
	}
	var instID string
	err = pool.QueryRow(ctx, `
		INSERT INTO free_spin_grants (
			user_id, promotion_version_id, idempotency_key, status, game_id, bet_minor, rounds_total, rounds_remaining, metadata
		) VALUES (
			$1::uuid, $2, $3, 'pending', NULLIF($4, ''), $5, $6, $6, '{}'::jsonb
		) ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id::text
	`, userID, pvn, idem, gameID, betMinor, rounds).Scan(&instID)
	if err == nil {
		return instID, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}
	if err2 := pool.QueryRow(ctx, `SELECT id::text FROM free_spin_grants WHERE idempotency_key = $1`, idem).Scan(&instID); err2 != nil {
		return "", false, err2
	}
	return instID, false, nil
}

// InsertFreeSpinGrantWithMetadata is like InsertFreeSpinGrant but merges `extra` into metadata (JSON object).
func InsertFreeSpinGrantWithMetadata(ctx context.Context, pool *pgxpool.Pool, userID string, pvid *int64, idem, gameID string, rounds int, betMinor int64, extra map[string]any) (id string, inserted bool, err error) {
	if idem == "" {
		return "", false, fmt.Errorf("bonus: idempotency key required for free spin grant")
	}
	meta := map[string]any{}
	for k, v := range extra {
		meta[k] = v
	}
	metaBytes, jerr := json.Marshal(meta)
	if jerr != nil {
		return "", false, jerr
	}
	var pvn sql.NullInt64
	if pvid != nil {
		pvn = sql.NullInt64{Int64: *pvid, Valid: true}
	}
	var instID string
	err = pool.QueryRow(ctx, `
		INSERT INTO free_spin_grants (
			user_id, promotion_version_id, idempotency_key, status, game_id, bet_minor, rounds_total, rounds_remaining, metadata
		) VALUES (
			$1::uuid, $2, $3, 'pending', NULLIF($4, ''), $5, $6, $6, $7::jsonb
		) ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id::text
	`, userID, pvn, idem, gameID, betMinor, rounds, metaBytes).Scan(&instID)
	if err == nil {
		return instID, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}
	if err2 := pool.QueryRow(ctx, `SELECT id::text FROM free_spin_grants WHERE idempotency_key = $1`, idem).Scan(&instID); err2 != nil {
		return "", false, err2
	}
	return instID, false, nil
}

// ListMissionsForHub is a stub: returns assigned missions with progress.
func ListMissionsForHub(ctx context.Context, pool *pgxpool.Pool, userID string) ([]map[string]any, error) {
	rows, err := pool.Query(ctx, `
		SELECT m.id, m.slug, m.name, m.config, pm.progress_minor, pm.state
		FROM player_missions pm
		JOIN missions m ON m.id = pm.mission_id
		WHERE pm.user_id = $1::uuid AND m.status = 'on' AND pm.state = 'active'
		ORDER BY pm.updated_at DESC
		LIMIT 20
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int64
		var slug, name, state string
		var config []byte
		var prog int64
		if err := rows.Scan(&id, &slug, &name, &config, &prog, &state); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"mission_id": id,
			"slug":       slug,
			"name":       name,
			"progress":   prog,
			"state":      state,
		})
	}
	return out, rows.Err()
}

// ListActiveRaces returns races in active window (stub; empty until ops seeds rows).
func ListActiveRaces(ctx context.Context, pool *pgxpool.Pool) ([]map[string]any, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, slug, name, starts_at, ends_at
		FROM races
		WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
		ORDER BY id ASC
		LIMIT 20
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id int64
		var slug, name string
		var sf, en sql.NullTime
		if err := rows.Scan(&id, &slug, &name, &sf, &en); err != nil {
			continue
		}
		m := map[string]any{
			"id": id, "slug": slug, "name": name,
		}
		if sf.Valid {
			m["starts_at"] = sf.Time.UTC().Format(time.RFC3339)
		}
		if en.Valid {
			m["ends_at"] = en.Time.UTC().Format(time.RFC3339)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListReferralSummaryByUser returns link + event counts (lightweight).
func ListReferralSummaryByUser(ctx context.Context, pool *pgxpool.Pool, userID string) (map[string]any, error) {
	var code, linkID string
	_ = pool.QueryRow(ctx, `SELECT id::text, code FROM referral_links WHERE user_id = $1::uuid LIMIT 1`, userID).Scan(&linkID, &code)
	out := map[string]any{
		"link_code":   code,
		"link_id":     linkID,
		"stages":      map[string]int64{},
		"description": "Referral stages populate when the referral engine is wired; tables are live.",
	}
	if linkID == "" {
		return out, nil
	}
	rows, err := pool.Query(ctx, `SELECT stage, COUNT(*)::bigint FROM referral_events WHERE link_id = $1::uuid GROUP BY stage`, linkID)
	if err == nil {
		defer rows.Close()
		stages := out["stages"].(map[string]int64)
		for rows.Next() {
			var st string
			var n int64
			if err := rows.Scan(&st, &n); err != nil {
				continue
			}
			stages[st] = n
		}
	}
	return out, nil
}
