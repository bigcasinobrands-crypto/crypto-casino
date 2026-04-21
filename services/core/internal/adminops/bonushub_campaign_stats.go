package adminops

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/jackc/pgx/v5"
)

// bonusHubCampaignDailyStats returns rolled-up bonus_campaign_daily_stats (UTC dates).
func (h *Handler) bonusHubCampaignDailyStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vidStr := strings.TrimSpace(r.URL.Query().Get("promotion_version_id"))
	limitDays := 90
	if v := strings.TrimSpace(r.URL.Query().Get("days")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 366 {
			limitDays = n
		}
	}
	var rows pgx.Rows
	var err error
	if vidStr != "" {
		vid, perr := strconv.ParseInt(vidStr, 10, 64)
		if perr != nil || vid <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid promotion_version_id")
			return
		}
		rows, err = h.Pool.Query(ctx, `
			SELECT stat_date::text, promotion_version_id, grants_count, grant_volume_minor,
				active_instances_end, completed_wr, forfeited, cost_minor
			FROM bonus_campaign_daily_stats
			WHERE promotion_version_id = $1
			ORDER BY stat_date DESC
			LIMIT $2
		`, vid, limitDays)
	} else {
		rows, err = h.Pool.Query(ctx, `
			SELECT stat_date::text, promotion_version_id, grants_count, grant_volume_minor,
				active_instances_end, completed_wr, forfeited, cost_minor
			FROM bonus_campaign_daily_stats
			ORDER BY stat_date DESC, promotion_version_id DESC
			LIMIT $1
		`, limitDays*20)
	}
	if err != nil {
		adminapi.WriteError(w, http.StatusInternalServerError, "db_error", "query failed")
		return
	}
	defer rows.Close()
	list := make([]map[string]any, 0)
	for rows.Next() {
		var sd string
		var pvid int64
		var gc int
		var gvm, aie, cw, ff, cm int64
		if err := rows.Scan(&sd, &pvid, &gc, &gvm, &aie, &cw, &ff, &cm); err != nil {
			continue
		}
		list = append(list, map[string]any{
			"stat_date":              sd,
			"promotion_version_id":   pvid,
			"grants_count":           gc,
			"grant_volume_minor":     gvm,
			"active_instances_end":   aie,
			"completed_wr":           cw,
			"forfeited":              ff,
			"cost_minor":             cm,
		})
	}
	writeJSON(w, map[string]any{"stats": list})
}
