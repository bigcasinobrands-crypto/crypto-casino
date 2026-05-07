package finjobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Financial Dead-Letter Queue (E-9).
//
// Multi-step financial workflows can leave partial state when one step fails
// and the caller cannot rebuild the rest. The most common offenders are:
//
//   - PassimPay deposit credited but house clearing leg failed (rare; live
//     today only because payments_passimpay holds a transactional lock).
//   - PassimPay withdrawal LEDGER_SETTLE_FAILED → has its own retry worker.
//   - BlueOcean game.credit posted but bonus wagering apply failed.
//   - Affiliate commission accrual posted to ledger but the grant row
//     update failed mid-transaction.
//
// Rather than swallow the error, the failing site enqueues a row in
// `financial_failed_jobs` with enough context to retry idempotently. A
// worker periodically claims pending rows, dispatches by job_type to a
// registered handler, and either marks the row resolved or bumps the
// attempt_count and pushes next_retry_at out with exponential backoff.
//
// Idempotency: every handler MUST be safe to call multiple times. The
// helper takes care of preventing concurrent worker instances from claiming
// the same row (FOR UPDATE SKIP LOCKED).

// Handler is the function signature for a registered job handler.
type Handler func(ctx context.Context, pool *pgxpool.Pool, payload json.RawMessage) error

// Registry maps job_type → handler. Built by the worker on startup.
type Registry map[string]Handler

// MaxAttempts caps how many times a job is retried before being parked in
// status='failed' for human inspection.
const MaxAttempts = 8

// Enqueue pushes a new financial DLQ row. Caller passes a free-form payload
// and a stable relatedID (e.g. the ledger entry id, withdrawal id) for
// human triage. nextRetryAt = now() — first attempt is immediate.
func Enqueue(ctx context.Context, pool *pgxpool.Pool, jobType, relatedID, errorMessage string, payload any) error {
	if pool == nil {
		return errors.New("finjobs: nil pool")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("finjobs: marshal payload: %w", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO financial_failed_jobs
			(job_type, payload, error_message, attempt_count, next_retry_at, status, related_id)
		VALUES ($1, $2::jsonb, $3, 0, now(), 'pending', NULLIF($4,''))
	`, jobType, body, errorMessage, relatedID); err != nil {
		return fmt.Errorf("finjobs: enqueue: %w", err)
	}
	return nil
}

// EnqueueTx is the transactional variant of Enqueue. Use it when the caller
// needs to atomically commit the failure record alongside other state
// changes (typical pattern: rollback the partial financial work and write
// the DLQ row in the same tx that committed the rollback).
func EnqueueTx(ctx context.Context, tx pgx.Tx, jobType, relatedID, errorMessage string, payload any) error {
	if tx == nil {
		return errors.New("finjobs: nil tx")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("finjobs: marshal payload: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO financial_failed_jobs
			(job_type, payload, error_message, attempt_count, next_retry_at, status, related_id)
		VALUES ($1, $2::jsonb, $3, 0, now(), 'pending', NULLIF($4,''))
	`, jobType, body, errorMessage, relatedID); err != nil {
		return fmt.Errorf("finjobs: enqueue tx: %w", err)
	}
	return nil
}

// ProcessBatch claims up to `limit` ready jobs (status='pending' AND
// next_retry_at <= now()) and dispatches them by job_type. Returns the
// number of jobs successfully resolved this round.
func ProcessBatch(ctx context.Context, pool *pgxpool.Pool, registry Registry, limit int) (int, error) {
	if pool == nil || registry == nil || limit <= 0 {
		return 0, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT id::text, job_type, payload, attempt_count
		FROM financial_failed_jobs
		WHERE status = 'pending' AND COALESCE(next_retry_at, now()) <= now()
		ORDER BY created_at ASC
		LIMIT $1
		FOR UPDATE SKIP LOCKED
	`, limit)
	if err != nil {
		return 0, fmt.Errorf("finjobs: claim: %w", err)
	}
	type job struct {
		id       string
		jobType  string
		payload  json.RawMessage
		attempts int
	}
	var pending []job
	for rows.Next() {
		var j job
		var raw []byte
		if err := rows.Scan(&j.id, &j.jobType, &raw, &j.attempts); err != nil {
			rows.Close()
			return 0, err
		}
		j.payload = raw
		pending = append(pending, j)
	}
	rows.Close()

	if len(pending) == 0 {
		return 0, nil
	}

	// Mark in_progress so a parallel worker doesn't double-pick.
	resolved := 0
	for _, j := range pending {
		if _, err := pool.Exec(ctx, `
			UPDATE financial_failed_jobs
			SET status = 'in_progress', updated_at = now()
			WHERE id = $1::uuid AND status = 'pending'
		`, j.id); err != nil {
			slog.ErrorContext(ctx, "finjobs_claim_update_failed", "id", j.id, "err", err)
			continue
		}

		handler, ok := registry[j.jobType]
		if !ok {
			// Unknown job type — park it for manual review so a future
			// deploy with the missing handler can resolve it.
			markFailed(ctx, pool, j.id, fmt.Sprintf("no handler registered for %q", j.jobType))
			continue
		}

		if err := handler(ctx, pool, j.payload); err != nil {
			bumpRetry(ctx, pool, j.id, j.attempts+1, err)
			continue
		}

		if _, err := pool.Exec(ctx, `
			UPDATE financial_failed_jobs
			SET status = 'resolved', resolved_at = now(), updated_at = now(),
			    error_message = NULL, attempt_count = $2
			WHERE id = $1::uuid
		`, j.id, j.attempts+1); err != nil {
			slog.ErrorContext(ctx, "finjobs_resolve_update_failed", "id", j.id, "err", err)
			continue
		}
		resolved++
	}
	return resolved, nil
}

// bumpRetry increments attempt_count, pushes next_retry_at out by exp(2^n)
// minutes (capped at 12h), and parks the job in 'failed' if it has hit
// MaxAttempts.
func bumpRetry(ctx context.Context, pool *pgxpool.Pool, jobID string, attempt int, err error) {
	if attempt >= MaxAttempts {
		markFailed(ctx, pool, jobID, fmt.Sprintf("exceeded MaxAttempts=%d: %v", MaxAttempts, err))
		return
	}
	backoff := time.Duration(1<<attempt) * time.Minute
	if backoff > 12*time.Hour {
		backoff = 12 * time.Hour
	}
	next := time.Now().UTC().Add(backoff)
	if _, uerr := pool.Exec(ctx, `
		UPDATE financial_failed_jobs
		SET status = 'pending',
		    attempt_count = $2,
		    next_retry_at = $3,
		    error_message = $4,
		    updated_at = now()
		WHERE id = $1::uuid
	`, jobID, attempt, next, truncate(err.Error(), 1024)); uerr != nil {
		slog.ErrorContext(ctx, "finjobs_bump_retry_failed", "id", jobID, "err", uerr)
	}
}

func markFailed(ctx context.Context, pool *pgxpool.Pool, jobID, reason string) {
	if _, err := pool.Exec(ctx, `
		UPDATE financial_failed_jobs
		SET status = 'failed', error_message = $2, updated_at = now()
		WHERE id = $1::uuid
	`, jobID, truncate(reason, 1024)); err != nil {
		slog.ErrorContext(ctx, "finjobs_mark_failed_failed", "id", jobID, "err", err)
	}
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
