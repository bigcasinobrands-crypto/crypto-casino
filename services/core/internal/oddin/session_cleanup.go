package oddin

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CleanupExpiredSessions sweeps sportsbook_sessions and marks rows whose
// expires_at is in the past as REVOKED. Without this, sportsbook_sessions
// grows unbounded and stale tokens linger as ACTIVE — userDetails enforces a
// time check so an expired token is never *accepted* in practice, but the
// status field is the canonical "is this token still alive?" signal used by
// dashboards, support tooling, and the upcoming revocation audit. This worker
// keeps that signal honest.
//
// The function is intentionally cheap and safe to run repeatedly: it only
// updates rows that are still ACTIVE but already past their TTL. Returns the
// number of rows transitioned, primarily for log/metric visibility.
func CleanupExpiredSessions(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	if pool == nil {
		return 0, nil
	}
	tag, err := pool.Exec(ctx, `
		UPDATE sportsbook_sessions
		SET status = 'EXPIRED'
		WHERE provider = 'ODDIN'
		  AND status = 'ACTIVE'
		  AND expires_at IS NOT NULL
		  AND expires_at < now()
	`)
	if err != nil {
		slog.ErrorContext(ctx, "oddin_session_cleanup_failed", "err", err)
		return 0, err
	}
	return tag.RowsAffected(), nil
}
