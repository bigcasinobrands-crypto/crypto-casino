package adminops

import (
	"context"
	"log/slog"
)

// auditExec inserts a row into admin_audit_log (or any audit/staff side
// table) with proper error visibility. The previous pattern was:
//
//	_, _ = h.Pool.Exec(ctx, `INSERT INTO admin_audit_log ...`, ...)
//
// which silently dropped a failed audit write — so a financial admin action
// could complete with no trace. Use this helper instead. `action` should be
// the action string used inside the SQL (e.g. "withdrawal.approve") so the
// error log is grep-able.
func (h *Handler) auditExec(ctx context.Context, action, sql string, args ...any) {
	if _, err := h.Pool.Exec(ctx, sql, args...); err != nil {
		slog.ErrorContext(ctx, "admin_audit_log_insert_failed",
			"action", action,
			"err", err,
		)
	}
}
