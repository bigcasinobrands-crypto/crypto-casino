package adminops

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
)

// Step-up MFA assertion endpoint (SEC-6).
//
// Records a row in staff_step_up_assertions after the staff user has just
// completed a strong-auth challenge. The actual challenge handshake (a
// WebAuthn assertion or TOTP code verification) is expected to have already
// been validated by the caller's auth flow — this endpoint is the
// "remember the proof" leg.
//
// Today the endpoint accepts {method, ip_at_assertion, user_agent, purpose}
// from the client. In the next iteration a server-driven WebAuthn challenge
// would be exchanged here; the table schema is stable for that upgrade.

type stepUpReq struct {
	Method  string `json:"method"`  // 'webauthn' | 'totp' | 'recovery'
	Purpose string `json:"purpose"` // free-form note: 'reverse_deposit', 'kyc_approve', etc.
}

type stepUpResp struct {
	AssertionID string    `json:"assertion_id"`
	ExpiresAt   time.Time `json:"expires_at"`
	Method      string    `json:"method"`
}

// PostStepUpAssertion records a fresh step-up assertion for the calling staff
// user. The TTL is fixed at 5 minutes; clients should request a new
// assertion right before each privileged action.
func (h *Handler) PostStepUpAssertion(w http.ResponseWriter, r *http.Request) {
	staff, _ := adminapi.StaffIDFromContext(r.Context())
	staff = strings.TrimSpace(staff)
	if staff == "" {
		adminapi.WriteError(w, http.StatusUnauthorized, "no_staff", "missing staff identity")
		return
	}
	var req stepUpReq
	_ = json.NewDecoder(r.Body).Decode(&req)
	method := strings.ToLower(strings.TrimSpace(req.Method))
	if method == "" {
		method = "webauthn"
	}
	if method != "webauthn" && method != "totp" && method != "recovery" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_method", "method must be webauthn|totp|recovery")
		return
	}

	expires := time.Now().UTC().Add(adminapi.DefaultStepUpMaxAge)
	purpose := strings.TrimSpace(req.Purpose)

	// IP + user-agent are captured for the audit trail; the IP is also a
	// future binding signal so a stolen session can't ride one assertion
	// from a different machine.
	clientIP := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}
	if idx := strings.Index(clientIP, ","); idx > 0 {
		clientIP = strings.TrimSpace(clientIP[:idx])
	}
	if idx := strings.LastIndex(clientIP, ":"); idx > 0 && strings.Count(clientIP, ":") == 1 {
		clientIP = clientIP[:idx]
	}

	var id string
	err := h.Pool.QueryRow(r.Context(), `
		INSERT INTO staff_step_up_assertions
			(staff_user_id, ip_at_assertion, user_agent, method, asserted_at, expires_at, purpose)
		VALUES (
			$1::uuid,
			NULLIF($2,'')::inet,
			NULLIF($3,''),
			$4,
			now(),
			$5,
			$6
		)
		RETURNING id::text
	`, staff, clientIP, r.UserAgent(), method, expires, purpose).Scan(&id)
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "step_up_insert_failed", err.Error())
		return
	}

	h.auditExec(r.Context(), "step_up.assert", `
		INSERT INTO admin_audit_log (staff_user_id, action, target_type, target_id, payload)
		VALUES (NULLIF($1,'')::uuid, 'step_up.assert', 'staff_step_up_assertions', $2, jsonb_build_object('method', $3::text, 'purpose', $4::text))
	`, staff, id, method, purpose)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(stepUpResp{AssertionID: id, ExpiresAt: expires, Method: method})
}
