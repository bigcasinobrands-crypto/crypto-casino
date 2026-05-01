package adminops

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/jackc/pgx/v5"
)

// bonusHubCampaignDailyStats returns rolled-up bonus_campaign_daily_stats (UTC dates).
func (h *Handler) bonusHubCampaignDailyStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vidStr := strings.TrimSpace(r.URL.Query().Get("promotion_version_id"))
	promoIDStr := strings.TrimSpace(r.URL.Query().Get("promotion_id"))
	start, end, all, err := parseAnalyticsWindow(r)
	if err != nil {
		adminapi.WriteError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	windowStart := start
	if all {
		windowStart = time.Time{}
	}
	var rows pgx.Rows
	var qErr error
	if vidStr != "" {
		vid, perr := strconv.ParseInt(vidStr, 10, 64)
		if perr != nil || vid <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid promotion_version_id")
			return
		}
		if all {
			rows, qErr = h.Pool.Query(ctx, `
			SELECT stat_date::text, promotion_version_id, grants_count, grant_volume_minor,
				active_instances_end, completed_wr, forfeited, cost_minor
			FROM bonus_campaign_daily_stats
			WHERE promotion_version_id = $1
			  AND stat_date <= $2::date
			ORDER BY stat_date DESC
			LIMIT 1500
		`, vid, end)
		} else {
			rows, qErr = h.Pool.Query(ctx, `
			SELECT stat_date::text, promotion_version_id, grants_count, grant_volume_minor,
				active_instances_end, completed_wr, forfeited, cost_minor
			FROM bonus_campaign_daily_stats
			WHERE promotion_version_id = $1
			  AND stat_date BETWEEN $2::date AND $3::date
			ORDER BY stat_date DESC
			LIMIT 1500
		`, vid, windowStart, end)
		}
	} else if promoIDStr != "" {
		promoID, perr := strconv.ParseInt(promoIDStr, 10, 64)
		if perr != nil || promoID <= 0 {
			adminapi.WriteError(w, http.StatusBadRequest, "bad_param", "invalid promotion_id")
			return
		}
		if all {
			rows, qErr = h.Pool.Query(ctx, `
			SELECT s.stat_date::text, s.promotion_version_id, s.grants_count, s.grant_volume_minor,
				s.active_instances_end, s.completed_wr, s.forfeited, s.cost_minor
			FROM bonus_campaign_daily_stats s
			JOIN promotion_versions pv ON pv.id = s.promotion_version_id
			WHERE pv.promotion_id = $1
			  AND s.stat_date <= $2::date
			ORDER BY s.stat_date DESC, s.promotion_version_id DESC
			LIMIT 3000
		`, promoID, end)
		} else {
			rows, qErr = h.Pool.Query(ctx, `
			SELECT s.stat_date::text, s.promotion_version_id, s.grants_count, s.grant_volume_minor,
				s.active_instances_end, s.completed_wr, s.forfeited, s.cost_minor
			FROM bonus_campaign_daily_stats s
			JOIN promotion_versions pv ON pv.id = s.promotion_version_id
			WHERE pv.promotion_id = $1
			  AND s.stat_date BETWEEN $2::date AND $3::date
			ORDER BY s.stat_date DESC, s.promotion_version_id DESC
			LIMIT 3000
		`, promoID, windowStart, end)
		}
	} else if all {
		rows, qErr = h.Pool.Query(ctx, `
			SELECT stat_date::text, promotion_version_id, grants_count, grant_volume_minor,
				active_instances_end, completed_wr, forfeited, cost_minor
			FROM bonus_campaign_daily_stats
			WHERE stat_date <= $1::date
			ORDER BY stat_date DESC, promotion_version_id DESC
			LIMIT 3000
		`, end)
	} else {
		rows, qErr = h.Pool.Query(ctx, `
			SELECT stat_date::text, promotion_version_id, grants_count, grant_volume_minor,
				active_instances_end, completed_wr, forfeited, cost_minor
			FROM bonus_campaign_daily_stats
			WHERE stat_date BETWEEN $1::date AND $2::date
			ORDER BY stat_date DESC
			LIMIT 3000
		`, windowStart, end)
	}
	if qErr != nil {
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
