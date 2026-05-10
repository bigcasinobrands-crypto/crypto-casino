package webhooks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/kycaid"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HandleKYCAIDVerification receives KYCAID verification callbacks (POST JSON + x-data-integrity).
func HandleKYCAIDVerification(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if cfg == nil || !cfg.KYCAIDEnabled {
			http.Error(w, "disabled", http.StatusNotFound)
			return
		}
		if !cfg.KYCAIDConfigured() {
			http.Error(w, "unconfigured", http.StatusServiceUnavailable)
			return
		}

		raw, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
		if err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		sig := strings.TrimSpace(r.Header.Get("x-data-integrity"))
		ok := kycaid.VerifyCallbackIntegrity(raw, cfg.KYCAIDAPIToken, sig)
		if !ok && cfg.KYCAIDWebhookFailClosed {
			log.Printf("kycaid webhook: integrity check failed (%d bytes)", len(raw))
			http.Error(w, "invalid integrity", http.StatusUnauthorized)
			return
		}
		if !ok && !cfg.KYCAIDWebhookFailClosed {
			log.Printf("kycaid webhook: WARN integrity failed — processing anyway (fail-open)")
		}

		var m map[string]any
		if err := json.Unmarshal(raw, &m); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		uid, err := resolveKYCAIDUserID(ctx, pool, m)
		if err != nil || uid == "" {
			log.Printf("kycaid webhook: no user mapping type=%v applicant=%v verification=%v err=%v",
				m["type"], m["applicant_id"], m["verification_id"], err)
			w.WriteHeader(http.StatusOK)
			return
		}

		cbType := strings.ToUpper(strings.TrimSpace(fmt.Sprint(m["type"])))
		rid := strings.TrimSpace(fmt.Sprint(m["request_id"]))
		if rid != "" && rid != "<nil>" {
			var exists bool
			_ = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM kycaid_verification_events WHERE request_id = $1)`, rid).Scan(&exists)
			if exists {
				w.WriteHeader(http.StatusOK)
				return
			}
		}

		applicantID := strings.TrimSpace(fmt.Sprint(m["applicant_id"]))
		verificationID := strings.TrimSpace(fmt.Sprint(m["verification_id"]))
		if applicantID == "<nil>" {
			applicantID = ""
		}
		if verificationID == "<nil>" {
			verificationID = ""
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			log.Printf("kycaid webhook: tx begin: %v", err)
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback(ctx)

		payloadJSON, _ := json.Marshal(m)
		_, err = tx.Exec(ctx, `
			INSERT INTO kycaid_verification_events (user_id, request_id, callback_type, applicant_id, verification_id, payload)
			VALUES ($1::uuid, NULLIF($2, ''), $3, NULLIF($4, ''), NULLIF($5, ''), $6::jsonb)
		`, uid, rid, cbType, applicantID, verificationID, payloadJSON)
		if err != nil {
			var pe *pgconn.PgError
			if errors.As(err, &pe) && pe.Code == "23505" {
				_ = tx.Commit(ctx)
				w.WriteHeader(http.StatusOK)
				return
			}
			log.Printf("kycaid webhook: insert audit: %v", err)
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		if err := applyKYCAIDCallbackToUser(ctx, tx, uid, m, cbType); err != nil {
			log.Printf("kycaid webhook: apply user: %v", err)
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(ctx); err != nil {
			log.Printf("kycaid webhook: commit: %v", err)
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}
}

func resolveKYCAIDUserID(ctx context.Context, pool *pgxpool.Pool, m map[string]any) (string, error) {
	ext := strings.TrimSpace(externalApplicantIDFromPayload(m))
	if ext != "" && ext != "<nil>" {
		if _, err := uuid.Parse(ext); err == nil {
			var exists bool
			_ = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1::uuid)`, ext).Scan(&exists)
			if exists {
				return ext, nil
			}
		}
	}
	applicantID := strings.TrimSpace(fmt.Sprint(m["applicant_id"]))
	if applicantID != "" && applicantID != "<nil>" {
		var uid string
		err := pool.QueryRow(ctx, `SELECT id::text FROM users WHERE kycaid_applicant_id = $1`, applicantID).Scan(&uid)
		if err == nil && uid != "" {
			return uid, nil
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	verificationID := strings.TrimSpace(fmt.Sprint(m["verification_id"]))
	if verificationID != "" && verificationID != "<nil>" {
		var uid string
		err := pool.QueryRow(ctx, `SELECT id::text FROM users WHERE kycaid_last_verification_id = $1`, verificationID).Scan(&uid)
		if err == nil && uid != "" {
			return uid, nil
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	return "", nil
}

func externalApplicantIDFromPayload(m map[string]any) string {
	if v := strings.TrimSpace(fmt.Sprint(m["external_applicant_id"])); v != "" && v != "<nil>" {
		return v
	}
	raw, ok := m["applicant"].(map[string]any)
	if !ok {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(raw["external_applicant_id"]))
}

func applyKYCAIDCallbackToUser(ctx context.Context, tx pgx.Tx, userID string, m map[string]any, cbType string) error {
	applicantID := strings.TrimSpace(fmt.Sprint(m["applicant_id"]))
	if applicantID == "<nil>" {
		applicantID = ""
	}
	verificationID := strings.TrimSpace(fmt.Sprint(m["verification_id"]))
	if verificationID == "<nil>" {
		verificationID = ""
	}

	switch cbType {
	case "VERIFICATION_COMPLETED":
		verified := false
		switch v := m["verified"].(type) {
		case bool:
			verified = v
		case string:
			verified = strings.EqualFold(strings.TrimSpace(v), "true")
		}
		if verified {
			_, err := tx.Exec(ctx, `
				UPDATE users SET
					kyc_status = 'approved',
					kyc_reviewed_at = COALESCE(kyc_reviewed_at, now()),
					kyc_reject_reason = NULL,
					kycaid_applicant_id = COALESCE(NULLIF($2, ''), kycaid_applicant_id),
					kycaid_last_verification_id = COALESCE(NULLIF($3, ''), kycaid_last_verification_id),
					kycaid_last_webhook_at = now(),
					updated_at = now()
				WHERE id = $1::uuid
			`, userID, applicantID, verificationID)
			return err
		}
		reason := extractKYCAIDRejectReason(m)
		if reason == "" {
			reason = "Verification did not pass. Please review requirements and resubmit."
		}
		_, err := tx.Exec(ctx, `
			UPDATE users SET
				kyc_status = 'rejected',
				kyc_reviewed_at = COALESCE(kyc_reviewed_at, now()),
				kyc_reject_reason = $2,
				kycaid_applicant_id = COALESCE(NULLIF($3, ''), kycaid_applicant_id),
				kycaid_last_verification_id = COALESCE(NULLIF($4, ''), kycaid_last_verification_id),
				kycaid_last_webhook_at = now(),
				updated_at = now()
			WHERE id = $1::uuid
		`, userID, reason, applicantID, verificationID)
		return err

	case "VERIFICATION_STATUS_CHANGED":
		vs := strings.ToLower(strings.TrimSpace(fmt.Sprint(m["verification_status"])))
		if vs == "<nil>" {
			vs = ""
		}
		next := ""
		switch vs {
		case "pending", "unused":
			next = "pending"
		case "completed":
			next = ""
		default:
			next = ""
		}
		if next != "" {
			_, err := tx.Exec(ctx, `
				UPDATE users SET
					kyc_status = $2,
					kycaid_applicant_id = COALESCE(NULLIF($3, ''), kycaid_applicant_id),
					kycaid_last_verification_id = COALESCE(NULLIF($4, ''), kycaid_last_verification_id),
					kycaid_last_webhook_at = now(),
					updated_at = now()
				WHERE id = $1::uuid AND kyc_status <> 'approved'
			`, userID, next, applicantID, verificationID)
			return err
		}
		_, err := tx.Exec(ctx, `
			UPDATE users SET
				kycaid_applicant_id = COALESCE(NULLIF($2, ''), kycaid_applicant_id),
				kycaid_last_verification_id = COALESCE(NULLIF($3, ''), kycaid_last_verification_id),
				kycaid_last_webhook_at = now(),
				updated_at = now()
			WHERE id = $1::uuid
		`, userID, applicantID, verificationID)
		return err
	default:
		_, err := tx.Exec(ctx, `
			UPDATE users SET
				kycaid_applicant_id = COALESCE(NULLIF($2, ''), kycaid_applicant_id),
				kycaid_last_verification_id = COALESCE(NULLIF($3, ''), kycaid_last_verification_id),
				kycaid_last_webhook_at = now(),
				updated_at = now()
			WHERE id = $1::uuid
		`, userID, applicantID, verificationID)
		return err
	}
}

func extractKYCAIDRejectReason(m map[string]any) string {
	raw, ok := m["verifications"].(map[string]any)
	if !ok {
		return ""
	}
	for _, section := range []string{"document", "profile", "liveness"} {
		sec, ok := raw[section].(map[string]any)
		if !ok {
			continue
		}
		if v, ok := sec["verified"].(bool); ok && v {
			continue
		}
		c := strings.TrimSpace(fmt.Sprint(sec["comment"]))
		if c != "" && c != "<nil>" {
			if len(c) > 500 {
				return c[:500]
			}
			return c
		}
	}
	return ""
}
