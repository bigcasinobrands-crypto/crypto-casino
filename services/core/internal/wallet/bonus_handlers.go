package wallet

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BonusesHandler lists the authenticated player's bonus instances.
func BonusesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		rows, err := pool.Query(r.Context(), `
			SELECT ubi.id::text, ubi.promotion_version_id, ubi.status, ubi.granted_amount_minor, ubi.currency,
				ubi.wr_required_minor, ubi.wr_contributed_minor, COALESCE(ubi.terms_version,''), ubi.created_at,
				COALESCE(pv.player_title, ''), COALESCE(pv.bonus_type, '')
			FROM user_bonus_instances ubi
			LEFT JOIN promotion_versions pv ON pv.id = ubi.promotion_version_id
			WHERE ubi.user_id = $1::uuid ORDER BY ubi.created_at DESC LIMIT 50
		`, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		defer rows.Close()
		cash, _ := ledger.BalanceCash(r.Context(), pool, uid)
		bon, _ := ledger.BalanceBonusLocked(r.Context(), pool, uid)
		var list []map[string]any
		for rows.Next() {
			var id string
			var pvid int64
			var st, ccy, terms, title, btype string
			var g, wr, wc int64
			var ct time.Time
			if err := rows.Scan(&id, &pvid, &st, &g, &ccy, &wr, &wc, &terms, &ct, &title, &btype); err != nil {
				continue
			}
			list = append(list, map[string]any{
				"id": id, "promotion_version_id": pvid, "status": st,
				"granted_amount_minor": g, "currency": ccy,
				"wr_required_minor": wr, "wr_contributed_minor": wc,
				"terms_version": terms,
				"terms_hash":    terms,
				"title":         title,
				"bonus_type":    btype,
				"created_at": ct.UTC().Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"bonuses": list,
			"wallet":  map[string]any{"cash_minor": cash, "bonus_locked_minor": bon},
		})
	}
}

// AvailableBonusesHandler returns strict-eligible published offers for the authenticated player.
func AvailableBonusesHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		cc := strings.TrimSpace(strings.ToUpper(r.Header.Get("X-Geo-Country")))
		offers, err := bonus.ListAvailableOffersForPlayer(r.Context(), pool, uid, cc)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"offers": offers})
	}
}

// PlayerBonusForfeitHandler POST /v1/wallet/bonuses/{bonusID}/forfeit — player forfeits own instance.
func PlayerBonusForfeitHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		id := strings.TrimSpace(chi.URLParam(r, "bonusID"))
		if id == "" {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "bonus id required")
			return
		}
		var body struct {
			Reason string `json:"reason"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		err := bonus.PlayerForfeitInstance(r.Context(), pool, uid, id, strings.TrimSpace(body.Reason))
		if errors.Is(err, bonus.ErrBonusInstanceNotFound) {
			playerapi.WriteError(w, http.StatusNotFound, "not_found", "bonus instance not found")
			return
		}
		if errors.Is(err, bonus.ErrBonusInstanceForbidden) {
			playerapi.WriteError(w, http.StatusForbidden, "forbidden", "not your bonus")
			return
		}
		if err != nil {
			if strings.Contains(err.Error(), "not forfeitable") {
				playerapi.WriteError(w, http.StatusConflict, "conflict", err.Error())
				return
			}
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "forfeit failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}
}

// NotificationsHandler lists in-app notifications for the player.
func NotificationsHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		rows, err := pool.Query(r.Context(), `
			SELECT id, kind, title, body, read_at IS NOT NULL, created_at
			FROM player_notifications WHERE user_id = $1::uuid ORDER BY id DESC LIMIT 50
		`, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		defer rows.Close()
		var list []map[string]any
		for rows.Next() {
			var id int64
			var kind, title, body string
			var read bool
			var ct time.Time
			if err := rows.Scan(&id, &kind, &title, &body, &read, &ct); err != nil {
				continue
			}
			list = append(list, map[string]any{
				"id": id, "kind": kind, "title": title, "body": body, "read": read,
				"created_at": ct.UTC().Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"notifications": list})
	}
}

// PatchNotificationReadHandler marks a notification as read.
func PatchNotificationReadHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		var body struct {
			NotificationID int64 `json:"notification_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.NotificationID <= 0 {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "notification_id required")
			return
		}
		tag, err := pool.Exec(r.Context(), `
			UPDATE player_notifications SET read_at = now()
			WHERE id = $1 AND user_id = $2::uuid AND read_at IS NULL
		`, body.NotificationID, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "update failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"updated": tag.RowsAffected() > 0})
	}
}
