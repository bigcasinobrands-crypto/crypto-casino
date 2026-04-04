package webhooks

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/crypto-casino/core/internal/jobs"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// HandleFystack stores webhook payload (call verifyEvent in production per Fystack docs).
func HandleFystack(pool *pgxpool.Pool, rdb *redis.Client) http.HandlerFunc {
	secret := strings.TrimSpace(os.Getenv("WEBHOOK_FYSTACK_SECRET"))
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		if secret != "" {
			sig := r.Header.Get("X-Fystack-Signature")
			if !verifyHMAC(secret, body, sig) {
				http.Error(w, "invalid signature", http.StatusUnauthorized)
				return
			}
		}
		var m map[string]any
		if err := json.Unmarshal(body, &m); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		payID := strings.TrimSpace(str(m["id"]))
		if payID == "" {
			payID = strings.TrimSpace(str(m["payment_id"]))
		}
		if payID == "" {
			payID = "fs-unknown"
		}
		status := strings.TrimSpace(str(m["status"]))
		if status == "" {
			status = "received"
		}
		var uid any
		if u := strings.TrimSpace(str(m["user_id"])); u != "" {
			uid = u
		}
		_, err = pool.Exec(r.Context(), `
			INSERT INTO fystack_payments (id, user_id, status, idempotency_key, raw)
			VALUES ($1, $2::uuid, $3, $4, $5::jsonb)
			ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, raw = EXCLUDED.raw
		`, payID, uid, status, "fystack:pay:"+payID, body)
		if err != nil {
			http.Error(w, "store failed", http.StatusInternalServerError)
			return
		}
		rawID, _ := json.Marshal(map[string]string{"id": payID})
		if err := jobs.Enqueue(r.Context(), rdb, jobs.Job{Type: "fystack_payment", Data: rawID}); err != nil {
			_ = ProcessFystackPayment(r.Context(), pool, payID)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// ProcessFystackPayment credits ledger for completed payment events (stub field mapping).
func ProcessFystackPayment(ctx context.Context, pool *pgxpool.Pool, paymentID string) error {
	var raw []byte
	var userID *string
	var status string
	err := pool.QueryRow(ctx, `SELECT raw::text, user_id::text, status FROM fystack_payments WHERE id = $1`, paymentID).Scan(&raw, &userID, &status)
	if err != nil {
		return err
	}
	if userID == nil || *userID == "" {
		return nil
	}
	st := strings.ToLower(status)
	if st != "completed" && st != "succeeded" && st != "paid" {
		return nil
	}
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	amount := int64(100)
	if v, ok := m["amount_minor"].(float64); ok {
		amount = int64(v)
	}
	_, err = ledger.ApplyCredit(ctx, pool, *userID, "USDT", "deposit.credit", "fystack:pay:"+paymentID, amount, m)
	return err
}
