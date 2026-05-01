package compliance

import (
	"context"
	"fmt"

	"github.com/crypto-casino/core/internal/passhash"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service performs GDPR-style player erasure (crypto casino baseline).
type Service struct {
	Pool *pgxpool.Pool
}

// TombstonePlayer anonymizes the account, invalidates credentials, and deletes player sessions.
func (s *Service) TombstonePlayer(ctx context.Context, userID string) error {
	if s == nil || s.Pool == nil {
		return fmt.Errorf("compliance: no pool")
	}
	junkHash, err := passhash.Hash(fmt.Sprintf("erased-%s", userID))
	if err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE users SET
			email = 'erased+' || encode(gen_random_bytes(10), 'hex') || '@erased.invalid',
			username = NULL,
			password_hash = $2,
			preferences = '{}'::jsonb,
			avatar_url = NULL,
			account_closed_at = COALESCE(account_closed_at, now()),
			self_excluded_until = NULL
		WHERE id = $1::uuid
	`, userID, junkHash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}
	_, _ = tx.Exec(ctx, `DELETE FROM player_sessions WHERE user_id = $1::uuid`, userID)
	_, _ = tx.Exec(ctx, `DELETE FROM email_verification_tokens WHERE user_id = $1::uuid`, userID)
	_, _ = tx.Exec(ctx, `DELETE FROM password_reset_tokens WHERE user_id = $1::uuid`, userID)
	_, _ = tx.Exec(ctx, `DELETE FROM promo_redemptions WHERE user_id = $1::uuid`, userID)
	return tx.Commit(ctx)
}

// ProcessErasureJob runs a single queued erasure job by primary key.
func ProcessErasureJob(ctx context.Context, pool *pgxpool.Pool, jobID int64) error {
	if pool == nil {
		return fmt.Errorf("no pool")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var uid string
	err = tx.QueryRow(ctx, `
		SELECT user_id::text FROM compliance_erasure_jobs WHERE id = $1 AND status = 'pending' FOR UPDATE SKIP LOCKED
	`, jobID).Scan(&uid)
	if err != nil {
		if err == pgx.ErrNoRows {
			return tx.Commit(ctx)
		}
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE compliance_erasure_jobs SET status = 'processing', started_at = now() WHERE id = $1`, jobID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	svc := &Service{Pool: pool}
	if err := svc.TombstonePlayer(ctx, uid); err != nil {
		_, _ = pool.Exec(ctx, `
			UPDATE compliance_erasure_jobs SET status = 'failed', error_text = $2, completed_at = now() WHERE id = $1
		`, jobID, truncateErr(err.Error()))
		return err
	}
	_, err = pool.Exec(ctx, `
		UPDATE compliance_erasure_jobs SET status = 'completed', completed_at = now() WHERE id = $1
	`, jobID)
	return err
}

func truncateErr(s string) string {
	if len(s) > 2000 {
		return s[:2000]
	}
	return s
}
