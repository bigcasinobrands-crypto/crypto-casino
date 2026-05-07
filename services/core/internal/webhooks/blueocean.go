package webhooks

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/jobs"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// HandleBlueOcean stores payload and enqueues worker processing.
func HandleBlueOcean(pool *pgxpool.Pool, rdb *redis.Client) http.HandlerFunc {
	secret := strings.TrimSpace(os.Getenv("WEBHOOK_BLUEOCEAN_SECRET"))
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
		// SEC-2: BlueOcean POST webhook must always be HMAC-authenticated.
		// Empty WEBHOOK_BLUEOCEAN_SECRET previously skipped verification entirely, allowing
		// any caller to inject game credit events. Refuse when the secret is unset.
		if secret == "" {
			http.Error(w, "webhook auth not configured", http.StatusUnauthorized)
			return
		}
		sig := r.Header.Get("X-Webhook-Signature")
		if !verifyHMAC(secret, body, sig) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		eventID := strings.TrimSpace(str(payload["event_id"]))
		if eventID == "" {
			eventID = strings.TrimSpace(str(payload["id"]))
		}
		if eventID == "" {
			http.Error(w, "missing event id", http.StatusBadRequest)
			return
		}
		var rowID int64
		err = pool.QueryRow(r.Context(), `
			INSERT INTO blueocean_events (provider_event_id, payload, verified, status)
			VALUES ($1, $2::jsonb, true, 'queued')
			ON CONFLICT (provider_event_id) DO UPDATE
			SET payload = EXCLUDED.payload, status = 'queued'
			RETURNING id
		`, eventID, body).Scan(&rowID)
		if err != nil {
			http.Error(w, "store failed", http.StatusInternalServerError)
			return
		}
		if err := jobs.Enqueue(r.Context(), rdb, jobs.Job{Type: "blueocean_event", ID: rowID}); err != nil {
			_ = ProcessBlueOceanEvent(r.Context(), pool, rowID)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "id": rowID})
	}
}

func str(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatInt(int64(t), 10)
	case json.Number:
		return string(t)
	default:
		return ""
	}
}

func verifyHMAC(secret string, body []byte, sigHex string) bool {
	if sigHex == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(strings.ToLower(sigHex)), []byte(strings.ToLower(expected)))
}

// ProcessBlueOceanEvent applies ledger update when payload includes user_id and credit_minor (demo mapping).
func ProcessBlueOceanEvent(ctx context.Context, pool *pgxpool.Pool, rowID int64) error {
	var payload []byte
	var status, provID string
	err := pool.QueryRow(ctx, `
		SELECT payload::text, status, provider_event_id FROM blueocean_events WHERE id = $1
	`, rowID).Scan(&payload, &status, &provID)
	if err != nil {
		return err
	}
	if status == "applied" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal(payload, &m); err != nil {
		return err
	}
	uid := strings.TrimSpace(str(m["user_id"]))
	if uid == "" {
		_, err = pool.Exec(ctx, `UPDATE blueocean_events SET status = 'skipped' WHERE id = $1`, rowID)
		return err
	}
	var credit float64
	switch v := m["credit_minor"].(type) {
	case float64:
		credit = v
	case json.Number:
		credit, _ = v.Float64()
	}
	amount := int64(credit)
	if amount == 0 {
		amount = 1
	}
	idem := "bo:event:" + provID
	_, err = ledger.ApplyCredit(ctx, pool, uid, "USDT", "game.credit", idem, amount, m)
	if err != nil {
		return err
	}
	_, err = pool.Exec(ctx, `UPDATE blueocean_events SET status = 'applied' WHERE id = $1`, rowID)
	return err
}
