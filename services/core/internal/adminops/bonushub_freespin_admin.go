package adminops

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/bonus"
)

// bonusHubListFreeSpinGrants GET /bonushub/free-spin-grants?user_id=…&limit=…
// With user_id: that user's rows; without: recent across all users.
func (h *Handler) bonusHubListFreeSpinGrants(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "no_db", "database not configured")
		return
	}
	uid := strings.TrimSpace(r.URL.Query().Get("user_id"))
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	var (
		rows []map[string]any
		err  error
	)
	if uid != "" {
		rows, err = bonus.ListFreeSpinGrantsForUser(r.Context(), h.Pool, uid, limit)
	} else {
		rows, err = bonus.ListFreeSpinGrantsRecent(r.Context(), h.Pool, limit)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "query_failed", err.Error())
		return
	}
	writeJSON(w, map[string]any{"grants": rows})
}

type createFreeSpinGrantBody struct {
	UserID             string `json:"user_id"`
	PromotionVersionID *int64 `json:"promotion_version_id"`
	IdempotencyKey     string `json:"idempotency_key"`
	GameID             string `json:"game_id"`
	Rounds             int    `json:"rounds"`
	BetMinor           int64  `json:"bet_minor"`
}

// bonusHubCreateFreeSpinGrant POST /bonushub/free-spin-grants
func (h *Handler) bonusHubCreateFreeSpinGrant(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		adminapi.WriteError(w, http.StatusServiceUnavailable, "no_db", "database not configured")
		return
	}
	var body createFreeSpinGrantBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_json", "invalid body")
		return
	}
	uid := strings.TrimSpace(body.UserID)
	if uid == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "user_id required")
		return
	}
	idem := strings.TrimSpace(body.IdempotencyKey)
	if idem == "" {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "idempotency_key required")
		return
	}
	if body.Rounds <= 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "rounds must be > 0")
		return
	}
	if body.BetMinor < 0 {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", "bet_minor invalid")
		return
	}
	id, _, err := bonus.InsertFreeSpinGrant(r.Context(), h.Pool, uid, body.PromotionVersionID, idem, strings.TrimSpace(body.GameID), body.Rounds, body.BetMinor)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "insert_failed", err.Error())
		return
	}
	writeJSON(w, map[string]any{"id": id, "ok": true})
}
