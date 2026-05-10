package maintenancenotify

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/sitestatus"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FlushPending sends transactional mail to subscribers who opted in during maintenance, then marks rows sent.
func FlushPending(ctx context.Context, pool *pgxpool.Pool, sender mail.Sender, cfg *config.Config) (int, error) {
	if sender == nil || cfg == nil {
		return 0, nil
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, trim(lower(email)) FROM maintenance_notify_subscribers
		WHERE sent_at IS NULL
		ORDER BY id
		FOR UPDATE SKIP LOCKED
	`)
	if err != nil {
		return 0, err
	}
	type row struct {
		id    int64
		email string
	}
	var list []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.email); err != nil {
			rows.Close()
			return 0, err
		}
		if r.email != "" {
			list = append(list, r)
		}
	}
	rows.Close()

	brand := strings.TrimSpace(cfg.MailBrandSiteName)
	if brand == "" {
		brand = "VybeBet"
	}
	subject := fmt.Sprintf("%s is back online", brand)
	plain := fmt.Sprintf("Good news — %s is live again. Open the site to continue playing.\n\nIf you did not request this email, you can ignore it.", brand)
	html := fmt.Sprintf(`<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>Good news — <strong>%s</strong> is live again.</p>
<p>Open the site to continue playing.</p>
<p style="font-size:12px;color:#666">If you did not request this email, you can ignore it.</p>
</body></html>`, brand)

	seen := map[string]struct{}{}
	sent := 0
	for _, r := range list {
		if _, dup := seen[r.email]; dup {
			_, _ = tx.Exec(ctx, `UPDATE maintenance_notify_subscribers SET sent_at = now() WHERE id = $1`, r.id)
			continue
		}
		seen[r.email] = struct{}{}
		if err := mail.SendTransactional(ctx, sender, r.email, subject, plain, html); err != nil {
			log.Printf("maintenance_notify: send failed id=%d email=%s err=%v", r.id, r.email, err)
			continue
		}
		if _, err := tx.Exec(ctx, `UPDATE maintenance_notify_subscribers SET sent_at = now() WHERE id = $1`, r.id); err != nil {
			return sent, err
		}
		sent++
	}
	if err := tx.Commit(ctx); err != nil {
		return sent, err
	}
	if sent > 0 {
		log.Printf("maintenance_notify: flushed %d subscriber emails", sent)
	}
	return sent, nil
}

type postBody struct {
	Email string `json:"email"`
}

// PostNotifyHandler POST /v1/site/maintenance-notify — registers email while maintenance is active.
func PostNotifyHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		ctx := r.Context()
		if !sitestatus.MaintenanceEffective(ctx, pool, cfg) {
			playerapi.WriteError(w, http.StatusConflict, "maintenance_inactive", "Maintenance notifications are only available while the site is in maintenance.")
			return
		}
		var body postBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_json", "Invalid JSON body.")
			return
		}
		email := strings.TrimSpace(strings.ToLower(body.Email))
		if email == "" || !strings.Contains(email, "@") || len(email) > 254 {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_email", "Enter a valid email address.")
			return
		}

		var exists bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM maintenance_notify_subscribers
				WHERE sent_at IS NULL AND lower(trim(email)) = $1
			)
		`, email).Scan(&exists); err != nil {
			log.Printf("maintenance_notify: check err=%v", err)
			playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "Could not save subscription.")
			return
		}
		if !exists {
			if _, err := pool.Exec(ctx, `INSERT INTO maintenance_notify_subscribers (email) VALUES ($1)`, email); err != nil {
				log.Printf("maintenance_notify: insert err=%v", err)
				playerapi.WriteError(w, http.StatusInternalServerError, "db_error", "Could not save subscription.")
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}
