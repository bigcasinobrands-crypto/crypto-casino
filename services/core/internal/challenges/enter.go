package challenges

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrChallengeNotEnterable = errors.New("challenge not enterable")
	ErrAlreadyEntered        = errors.New("already entered")
	ErrSelfExcluded          = errors.New("self-excluded")
)

// TryEnter creates challenge_entries after validation (MVP rules).
func TryEnter(ctx context.Context, pool *pgxpool.Pool, userID, challengeID, ip, deviceFingerprint string) error {
	_ = PromoteScheduledChallengeIfDue(ctx, pool, challengeID)

	var status string
	var starts, ends, entryDeadline *time.Time
	var maxPart *int
	err := pool.QueryRow(ctx, `
		SELECT status, starts_at, ends_at, entry_deadline, max_participants
		FROM challenges WHERE id = $1::uuid
	`, challengeID).Scan(&status, &starts, &ends, &entryDeadline, &maxPart)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrChallengeNotEnterable
		}
		return err
	}
	if status != "active" {
		return ErrChallengeNotEnterable
	}
	now := time.Now().UTC()
	if starts != nil && now.Before(*starts) {
		return ErrChallengeNotEnterable
	}
	if ends != nil && !now.Before(*ends) {
		return ErrChallengeNotEnterable
	}
	if entryDeadline != nil && now.After(*entryDeadline) {
		return ErrChallengeNotEnterable
	}

	var selfEx *time.Time
	var createdAt time.Time
	err = pool.QueryRow(ctx, `
		SELECT self_excluded_until, created_at FROM users WHERE id = $1::uuid
	`, userID).Scan(&selfEx, &createdAt)
	if err != nil {
		return err
	}
	if selfEx != nil && selfEx.After(now) {
		return ErrSelfExcluded
	}

	var existing int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM challenge_entries WHERE challenge_id = $1::uuid AND user_id = $2::uuid
	`, challengeID, userID).Scan(&existing)
	if existing > 0 {
		return ErrAlreadyEntered
	}

	if maxPart != nil {
		var cnt int
		_ = pool.QueryRow(ctx, `
			SELECT COUNT(*)::int FROM challenge_entries WHERE challenge_id = $1::uuid
		`, challengeID).Scan(&cnt)
		if cnt >= *maxPart {
			return fmt.Errorf("%w: max participants", ErrChallengeNotEnterable)
		}
	}

	var minAge int
	var minDep int64
	var vipOnly bool
	var vipMin *string
	err = pool.QueryRow(ctx, `
		SELECT min_account_age_days, min_lifetime_deposits_minor, vip_only, vip_tier_minimum
		FROM challenges WHERE id = $1::uuid
	`, challengeID).Scan(&minAge, &minDep, &vipOnly, &vipMin)
	if err != nil {
		return err
	}
	if minAge > 0 {
		days := int(now.Sub(createdAt).Hours() / 24)
		if days < minAge {
			return fmt.Errorf("%w: account too new", ErrChallengeNotEnterable)
		}
	}
	if minDep > 0 {
		var sumDep int64
		_ = pool.QueryRow(ctx, `
			SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM ledger_entries
			WHERE user_id = $1::uuid AND entry_type = 'deposit.credit' AND amount_minor > 0
		`, userID).Scan(&sumDep)
		if sumDep < minDep {
			return fmt.Errorf("%w: insufficient lifetime deposits", ErrChallengeNotEnterable)
		}
	}

	if err := VIPMeetsChallenge(ctx, pool, userID, vipOnly, vipMin); err != nil {
		return err
	}

	var entryID string
	err = pool.QueryRow(ctx, `
		INSERT INTO challenge_entries (challenge_id, user_id, ip_address, device_fingerprint)
		VALUES ($1::uuid, $2::uuid, NULLIF(TRIM($3), ''), NULLIF(TRIM($4), ''))
		RETURNING id::text
	`, challengeID, userID, ip, deviceFingerprint).Scan(&entryID)
	if err != nil {
		return err
	}
	var title, slug string
	_ = pool.QueryRow(ctx, `SELECT title, COALESCE(slug, '') FROM challenges WHERE id = $1::uuid`, challengeID).Scan(&title, &slug)
	idem := fmt.Sprintf("challenge:join:%s", entryID)
	meta := map[string]any{
		"challenge_id":    challengeID,
		"challenge_title": title,
		"challenge_slug":  slug,
		"entry_id":        entryID,
	}
	_, _ = ledger.RecordNonBalanceEvent(ctx, pool, userID, "USDT", "challenge.join", idem, meta)
	return nil
}