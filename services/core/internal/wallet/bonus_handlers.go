package wallet

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/ledger"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/sitestatus"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BonusesHandler lists the authenticated player's bonus instances.
func BonusesHandler(pool *pgxpool.Pool, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		ccy, multi := seamlessPlayerWalletSettings(cfg)
		rows, err := pool.Query(r.Context(), `
			SELECT ubi.id::text, ubi.promotion_version_id, ubi.status, ubi.granted_amount_minor, ubi.currency,
				ubi.wr_required_minor, ubi.wr_contributed_minor, COALESCE(ubi.terms_version,''), ubi.created_at,
				COALESCE(pv.player_title, ''), COALESCE(NULLIF(TRIM(pv.player_description), ''), ''),
				COALESCE(pv.bonus_type, ''),
				pv.published_at, pv.valid_from, pv.valid_to,
				COALESCE(ubi.snapshot, '{}'::jsonb)
			FROM user_bonus_instances ubi
			LEFT JOIN promotion_versions pv ON pv.id = ubi.promotion_version_id
			WHERE ubi.user_id = $1::uuid ORDER BY ubi.created_at DESC LIMIT 50
		`, uid)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		defer rows.Close()
		cash, _ := ledger.BalanceCashSeamless(r.Context(), pool, uid, ccy, multi)
		bon, _ := ledger.BalanceBonusLockedSeamless(r.Context(), pool, uid, ccy, multi)
		var list []map[string]any
		for rows.Next() {
			var id string
			var pvid int64
			var st, ccy, terms, title, desc, btype string
			var g, wr, wc int64
			var ct time.Time
			var snap []byte
			var pubAt, vf, vt sql.NullTime
			if err := rows.Scan(&id, &pvid, &st, &g, &ccy, &wr, &wc, &terms, &ct, &title, &desc, &btype, &pubAt, &vf, &vt, &snap); err != nil {
				continue
			}
			item := map[string]any{
				"id": id, "promotion_version_id": pvid, "status": st,
				"granted_amount_minor": g, "currency": ccy,
				"wr_required_minor": wr, "wr_contributed_minor": wc,
				"terms_version": terms,
				"terms_hash":    terms,
				"title":         bonus.HumanizeOfferTitle(pvid, title, desc, btype),
				"bonus_type": btype,
				"created_at": ct.UTC().Format(time.RFC3339),
			}
			d := bonus.PlayerSnapshotDetails(snap)
			bonus.MergePlayerDetailsSchedule(d, pubAt, vf, vt)
			if len(d) > 0 {
				item["details"] = d
			}
			list = append(list, item)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"bonuses": list,
			"wallet": map[string]any{
				"cash_minor": cash, "bonus_locked_minor": bon,
				"currency": ccy,
			},
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
		cc := sitestatus.GeoCountryISO2FromRequest(r)
		offers, err := bonus.ListAvailableOffersForPlayer(r.Context(), pool, uid, cc)
		if err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "query failed")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"offers": offers})
	}
}

// ClaimOfferHandler POST /v1/bonuses/claim-offer — instant grant when rules allow, else same as deposit-intent.
func ClaimOfferHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		var body struct {
			PromotionVersionID int64 `json:"promotion_version_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PromotionVersionID <= 0 {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "promotion_version_id required")
			return
		}
		cc := sitestatus.GeoCountryISO2FromRequest(r)
		res, err := bonus.ClaimPlayerOffer(r.Context(), pool, uid, cc, body.PromotionVersionID)
		if err != nil {
			switch {
			case errors.Is(err, bonus.ErrClaimOfferNotEligible), errors.Is(err, bonus.ErrDepositIntentNotEligible):
				playerapi.WriteError(w, http.StatusConflict, "not_eligible", "this offer is not available for you right now")
			case errors.Is(err, bonus.ErrClaimOfferBlocked):
				playerapi.WriteError(w, http.StatusConflict, "grant_blocked", "could not activate this offer — try again later or contact support")
			default:
				playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "claim failed")
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	}
}

// DepositBonusIntentHandler POST /v1/bonuses/deposit-intent — remember chosen promo for the next deposit grant evaluation.
func DepositBonusIntentHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		var body struct {
			PromotionVersionID int64 `json:"promotion_version_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.PromotionVersionID <= 0 {
			playerapi.WriteError(w, http.StatusBadRequest, "invalid_request", "promotion_version_id required")
			return
		}
		cc := sitestatus.GeoCountryISO2FromRequest(r)
		if err := bonus.UpsertPlayerDepositIntent(r.Context(), pool, uid, cc, body.PromotionVersionID); err != nil {
			if errors.Is(err, bonus.ErrDepositIntentNotEligible) {
				playerapi.WriteError(w, http.StatusConflict, "not_eligible", "this offer is not available for you right now")
				return
			}
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not save intent")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	}
}

// CancelDepositIntentHandler POST /v1/bonuses/cancel-deposit-intent — revoke hub “Get bonus” choice before a qualifying deposit credits the match.
func CancelDepositIntentHandler(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid, ok := playerapi.UserIDFromContext(r.Context())
		if !ok {
			playerapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "missing user")
			return
		}
		if err := bonus.CancelPlayerDepositIntentWithRelinquishment(r.Context(), pool, uid); err != nil {
			playerapi.WriteError(w, http.StatusInternalServerError, "server_error", "could not cancel offer")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
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
