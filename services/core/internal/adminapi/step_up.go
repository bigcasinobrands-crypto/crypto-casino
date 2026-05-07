package adminapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Step-up MFA for high-value admin actions (SEC-6).
//
// Some admin actions are too dangerous to leave behind a single session:
// deposit reversal, force-rejecting a withdrawal mid-flight, granting cash
// bonuses, approving KYC for large players, posting provider-fee invoices.
// For those routes the staff user must have completed a fresh MFA assertion
// (typically WebAuthn) within the last `MaxAge`. This middleware reads the
// most recent unconsumed row from `staff_step_up_assertions` and rejects the
// request if none is found within the window.
//
// The middleware does NOT consume the assertion — that is the route handler's
// job, so the audit row records both the action and the assertion id. Most
// callers will use ConsumeStepUpForAction below right before performing the
// privileged write.
//
// Default lifetime is 5 minutes; routes can override with shorter windows
// (e.g. 60s for deposit reversal of $10k+).

// DefaultStepUpMaxAge is the default window during which a fresh assertion
// satisfies the middleware. Tuned to be long enough for a UI form fill but
// short enough that a stolen JWT can't ride one assertion for hours.
const DefaultStepUpMaxAge = 5 * time.Minute

// RequireStepUp returns a chi middleware that rejects a request unless the
// authenticated staff user has at least one unconsumed step-up assertion
// younger than maxAge. If maxAge is zero the default is used. When the
// middleware passes, the assertion id is placed on the request context for
// the route handler to consume.
func RequireStepUp(pool *pgxpool.Pool, maxAge time.Duration) func(http.Handler) http.Handler {
	if maxAge <= 0 {
		maxAge = DefaultStepUpMaxAge
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			staff, _ := StaffIDFromContext(r.Context())
			staff = strings.TrimSpace(staff)
			if staff == "" {
				WriteError(w, http.StatusUnauthorized, "unauthenticated", "no staff identity")
				return
			}
			id, ok := lookupFreshAssertion(r.Context(), pool, staff, maxAge)
			if !ok {
				WriteError(w, http.StatusForbidden, "step_up_required",
					"this action requires a fresh MFA assertion (POST /v1/admin/auth/step-up first)")
				return
			}
			ctx := context.WithValue(r.Context(), stepUpAssertionIDKey, id)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// lookupFreshAssertion returns the most recent unconsumed assertion id for
// the staff user that's still within the freshness window. ok=false when
// nothing matches.
func lookupFreshAssertion(ctx context.Context, pool *pgxpool.Pool, staffID string, maxAge time.Duration) (string, bool) {
	if pool == nil {
		return "", false
	}
	cutoff := time.Now().UTC().Add(-maxAge)
	var id string
	err := pool.QueryRow(ctx, `
		SELECT id::text FROM staff_step_up_assertions
		WHERE staff_user_id = $1::uuid
		  AND consumed_at IS NULL
		  AND expires_at > now()
		  AND asserted_at >= $2
		ORDER BY asserted_at DESC
		LIMIT 1
	`, staffID, cutoff).Scan(&id)
	if err != nil || id == "" {
		return "", false
	}
	return id, true
}

// ConsumeStepUpForAction marks the assertion on the request context as
// consumed and records the action label in the row. Should be called by the
// route handler immediately before (or in the same transaction as) the
// privileged write so the audit trail captures which action used which
// assertion.
//
// Returns nil if there is no assertion id on the context (caller did not go
// through RequireStepUp) so handlers that use the helper defensively still
// compile cleanly when the middleware is absent.
func ConsumeStepUpForAction(ctx context.Context, pool *pgxpool.Pool, action string) error {
	id, ok := ctx.Value(stepUpAssertionIDKey).(string)
	if !ok || id == "" || pool == nil {
		return nil
	}
	_, err := pool.Exec(ctx, `
		UPDATE staff_step_up_assertions
		SET consumed_at = now(), consumed_action = $2
		WHERE id = $1::uuid AND consumed_at IS NULL
	`, id, strings.TrimSpace(action))
	return err
}

type ctxStepUpKey int

const stepUpAssertionIDKey ctxStepUpKey = 1
