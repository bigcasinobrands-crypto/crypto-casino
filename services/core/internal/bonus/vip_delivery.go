package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	vipGrantMaxAttempts    = 3
	vipGrantRetryBaseDelay = 150 * time.Millisecond
	vipSweeperMaxAttempts  = 10
	staleVIPRunAfter       = 90 * time.Minute
)

// vipDeliveryWindowKey scopes bonus idempotency to the scheduled delivery window (not the run UUID),
// so retries / overlapping ticks cannot grant the same logical bonus twice.
func vipDeliveryWindowKey(windowStart time.Time) string {
	return windowStart.UTC().Truncate(24 * time.Hour).Format(time.RFC3339)
}

func grantFromPromotionVersionRetriable(ctx context.Context, pool *pgxpool.Pool, a GrantArgs) (inserted bool, err error) {
	var lastErr error
	for attempt := 1; attempt <= vipGrantMaxAttempts; attempt++ {
		ins, err := GrantFromPromotionVersion(ctx, pool, a)
		if err == nil {
			return ins, nil
		}
		lastErr = err
		if errors.Is(err, ErrBonusesDisabled) {
			return false, err
		}
		if strings.Contains(err.Error(), "promotion version not publishable") {
			return false, err
		}
		if attempt < vipGrantMaxAttempts {
			delay := time.Duration(attempt) * vipGrantRetryBaseDelay
			select {
			case <-ctx.Done():
				return false, ctx.Err()
			case <-time.After(delay):
			}
		}
	}
	return false, lastErr
}

// recoverStaleVIPDeliveryRuns marks long-running batches as terminal so new ticks can proceed cleanly.
func recoverStaleVIPDeliveryRuns(ctx context.Context, pool *pgxpool.Pool, now time.Time) error {
	cutoff := now.UTC().Add(-staleVIPRunAfter)
	msg := "stale run — worker interrupted; failed grants may be retried by the delivery sweeper"
	_, err := pool.Exec(ctx, `
		UPDATE vip_delivery_runs
		SET status = 'failed',
		    finished_at = $2,
		    error_message = $3
		WHERE status = 'running'
		  AND started_at < $1
	`, cutoff, now.UTC(), msg)
	return err
}

type vipGrantErrDetail struct {
	Error              string `json:"error"`
	PromotionVersionID int64  `json:"promotion_version_id"`
	GrantMinor         int64  `json:"grant_minor"`
	TierID             int    `json:"tier_id,omitempty"`
	Suffix             string `json:"suffix,omitempty"`
	WindowKey          string `json:"window_key,omitempty"`
	SweeperAttempts    int    `json:"sweeper_attempts"`
}

// RetryVIPDeliveryGrantErrors replays persisted grant failures using the same idempotency keys (safe with GrantFromPromotionVersion).
func RetryVIPDeliveryGrantErrors(ctx context.Context, pool *pgxpool.Pool, limit int) error {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := pool.Query(ctx, `
		SELECT id, user_id::text, pipeline, idempotency_key, detail
		FROM vip_delivery_run_items
		WHERE result = 'error'
		  AND detail ? 'promotion_version_id'
		  AND COALESCE((detail->>'sweeper_attempts')::int, 0) < $2
		  AND created_at > now() - interval '14 days'
		ORDER BY created_at ASC
		LIMIT $1
	`, limit, vipSweeperMaxAttempts)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var uid, pipeline, idem string
		var detailRaw []byte
		if err := rows.Scan(&id, &uid, &pipeline, &idem, &detailRaw); err != nil {
			continue
		}
		var d vipGrantErrDetail
		if err := json.Unmarshal(detailRaw, &d); err != nil || d.PromotionVersionID <= 0 || d.GrantMinor <= 0 {
			continue
		}

		nextAttempts := d.SweeperAttempts + 1
		bumpAttempts := func(extra map[string]any) {
			m := map[string]any{"sweeper_attempts": nextAttempts, "last_sweeper_at": time.Now().UTC().Format(time.RFC3339)}
			for k, v := range extra {
				m[k] = v
			}
			b, _ := json.Marshal(m)
			_, _ = pool.Exec(ctx, `
				UPDATE vip_delivery_run_items
				SET detail = COALESCE(detail,'{}'::jsonb) || $2::jsonb
				WHERE id = $1
			`, id, b)
		}

		inserted, gErr := grantFromPromotionVersionRetriable(ctx, pool, GrantArgs{
			UserID:                uid,
			PromotionVersionID:    d.PromotionVersionID,
			IdempotencyKey:        idem,
			GrantAmountMinor:      d.GrantMinor,
			Currency:              "USDT",
			DepositAmountMinor:    0,
			ExemptFromPrimarySlot: true,
		})
		if gErr != nil {
			bumpAttempts(map[string]any{"last_sweeper_error": gErr.Error()})
			continue
		}
		outcome := map[bool]string{true: "granted", false: "skipped"}[inserted]
		rec, _ := json.Marshal(map[string]any{
			"result_recovered": true,
			"recovered_at":     time.Now().UTC().Format(time.RFC3339),
			"sweeper_attempts": nextAttempts,
		})
		_, _ = pool.Exec(ctx, `
			UPDATE vip_delivery_run_items
			SET result = $2,
			    detail = COALESCE(detail,'{}'::jsonb) || $3::jsonb
			WHERE id = $1
		`, id, outcome, rec)
	}
	return rows.Err()
}

// ListVIPDeliveryRuns returns recent automation runs for admin dashboards.
func ListVIPDeliveryRuns(ctx context.Context, pool *pgxpool.Pool, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := pool.Query(ctx, `
		SELECT id::text, pipeline, window_start, window_end, status, stats, trigger_kind,
			started_at, finished_at, error_message
		FROM vip_delivery_runs
		ORDER BY started_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, pipeline, status, trigger string
		var ws, we, started time.Time
		var finished *time.Time
		var stats []byte
		var errMsg *string
		if err := rows.Scan(&id, &pipeline, &ws, &we, &status, &stats, &trigger, &started, &finished, &errMsg); err != nil {
			continue
		}
		m := map[string]any{
			"id": id, "pipeline": pipeline, "status": status, "trigger_kind": trigger,
			"window_start": ws.UTC().Format(time.RFC3339),
			"window_end":   we.UTC().Format(time.RFC3339),
			"started_at":   started.UTC().Format(time.RFC3339),
			"stats":        stats,
		}
		if finished != nil {
			m["finished_at"] = finished.UTC().Format(time.RFC3339)
		}
		if errMsg != nil && *errMsg != "" {
			m["error_message"] = *errMsg
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// RecordVIPDeliveryRun inserts a completed or failed run row (workers / manual triggers).
func RecordVIPDeliveryRun(ctx context.Context, pool *pgxpool.Pool, pipeline string, windowStart, windowEnd time.Time, status string, stats []byte, trigger string, errMsg *string) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO vip_delivery_runs (pipeline, window_start, window_end, status, stats, trigger_kind, started_at, finished_at, error_message)
		VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb), $6, now(), now(), $7)
	`, pipeline, windowStart, windowEnd, status, stats, trigger, errMsg)
	return err
}

type vipDeliveryScheduleConfig struct {
	PromotionVersionID int64 `json:"promotion_version_id"`
	BaseAmountMinor    int64 `json:"base_amount_minor"`
	MinTierSortOrder   *int  `json:"min_tier_sort_order,omitempty"`
	UseTierAttachments bool  `json:"use_tier_attachments,omitempty"`
}

func parseVIPDeliveryScheduleConfig(raw []byte) vipDeliveryScheduleConfig {
	var c vipDeliveryScheduleConfig
	if len(raw) == 0 {
		return c
	}
	_ = json.Unmarshal(raw, &c)
	return c
}

// RunVIPDeliveryPipeline executes one configured schedule and records run/items.
func RunVIPDeliveryPipeline(ctx context.Context, pool *pgxpool.Pool, pipeline string, now time.Time, trigger string) error {
	var enabled bool
	var configRaw []byte
	var nextRunAt *time.Time
	err := pool.QueryRow(ctx, `
		SELECT enabled, config, next_run_at
		FROM vip_delivery_schedules
		WHERE pipeline = $1
	`, pipeline).Scan(&enabled, &configRaw, &nextRunAt)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if !enabled {
		return nil
	}
	plannedEarly, plannedErr := pickDuePlannedRun(configRaw, now.UTC())
	if plannedErr != nil {
		return plannedErr
	}
	// Due planned_runs can fire before the recurring next_run_at anchor.
	if nextRunAt != nil && nextRunAt.After(now.UTC()) && plannedEarly == nil {
		return nil
	}

	cfg := parseVIPDeliveryScheduleConfig(configRaw)
	defaultTierPV := parseTierPromotionVersionsMap(configRaw)
	planned := plannedEarly

	var effectiveTierPV map[int]int64
	consumedPlannedIndex := -1
	if planned != nil {
		consumedPlannedIndex = planned.OriginalArrayIndex
		if len(planned.TierPV) > 0 {
			effectiveTierPV = planned.TierPV
		} else {
			effectiveTierPV = defaultTierPV
		}
	} else {
		effectiveTierPV = defaultTierPV
		consumedPlannedIndex = -1
	}

	useScheduleMap := len(effectiveTierPV) > 0

	windowStart := now.UTC().Truncate(24 * time.Hour)
	windowEnd := windowStart.Add(24 * time.Hour)

	var runID string
	err = pool.QueryRow(ctx, `
		INSERT INTO vip_delivery_runs (pipeline, window_start, window_end, status, stats, trigger_kind, started_at)
		VALUES ($1, $2, $3, 'running', '{}'::jsonb, $4, now())
		RETURNING id::text
	`, pipeline, windowStart, windowEnd, trigger).Scan(&runID)
	if err != nil {
		obs.IncVIPDeliveryRunFailed()
		return err
	}

	type candidate struct {
		UserID     string
		TierID     int
		TierSort   int
		Multiplier float64
	}
	rows, err := pool.Query(ctx, `
		SELECT pvs.user_id::text, pvs.tier_id, COALESCE(vt.sort_order, 0), 1.0
		FROM player_vip_state pvs
		JOIN vip_tiers vt ON vt.id = pvs.tier_id
		WHERE ($1::int IS NULL OR vt.sort_order >= $1)
		  AND CASE $2::text
		    WHEN 'weekly_bonus' THEN (vt.perks @> '{"weekly_bonus_enabled": true}'::jsonb)
		    WHEN 'monthly_bonus' THEN (vt.perks @> '{"monthly_bonus_enabled": true}'::jsonb)
		    ELSE false
		  END
		LIMIT 5000
	`, cfg.MinTierSortOrder, pipeline)
	if err != nil {
		_, _ = pool.Exec(ctx, `UPDATE vip_delivery_runs SET status='failed', error_message=$2, finished_at=now() WHERE id=$1::uuid`, runID, err.Error())
		obs.IncVIPDeliveryRunFailed()
		return err
	}
	defer rows.Close()

	attempted := 0
	granted := 0
	skipped := 0
	failed := 0
	totalMinor := int64(0)
	type tierAttachment struct {
		BenefitID  int64
		PV         int64
		Amount     int64
	}
	attachByTier := map[int][]tierAttachment{}
	if cfg.UseTierAttachments && !useScheduleMap {
		arows, aErr := pool.Query(ctx, `
			SELECT tier_id, id, promotion_version_id, config
			FROM vip_tier_benefits
			WHERE enabled = true
			  AND benefit_type = 'grant_promotion'
			  AND COALESCE(TRIM(config->>'delivery_pipeline'), '') = $1
		`, pipeline)
		if aErr == nil {
			for arows.Next() {
				var tierID int
				var benefitID int64
				var pvID *int64
				var cfgJSON []byte
				if err := arows.Scan(&tierID, &benefitID, &pvID, &cfgJSON); err != nil || pvID == nil || *pvID <= 0 {
					continue
				}
				amt, err := GrantAmountForVIPTierBenefit(ctx, pool, *pvID, cfgJSON)
				if err != nil || amt <= 0 {
					continue
				}
				attachByTier[tierID] = append(attachByTier[tierID], tierAttachment{BenefitID: benefitID, PV: *pvID, Amount: amt})
			}
			arows.Close()
		}
	}

	windowKey := vipDeliveryWindowKey(windowStart)

	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.UserID, &c.TierID, &c.TierSort, &c.Multiplier); err != nil {
			continue
		}
		attempted++
		attachments := attachByTier[c.TierID]

		scheduleSkip := func(reason string) {
			skipped++
			idem := fmt.Sprintf("vip:%s:w:%s:user:%s:skip:%s", pipeline, windowKey, c.UserID, reason)
			_, _ = pool.Exec(ctx, `
				INSERT INTO vip_delivery_run_items (run_id, user_id, pipeline, idempotency_key, amount_minor, result, detail)
				VALUES ($1::uuid, $2::uuid, $3, $4, 0, 'skipped', jsonb_build_object('reason', $5::text))
				ON CONFLICT (idempotency_key) DO NOTHING
			`, runID, c.UserID, pipeline, idem, reason)
		}

		runGrant := func(pvID int64, amt int64, suffix string) {
			if amt <= 0 || pvID <= 0 {
				return
			}
			idem := fmt.Sprintf("vip:%s:w:%s:user:%s:tier:%d:%s", pipeline, windowKey, c.UserID, c.TierID, suffix)
			inserted, gErr := grantFromPromotionVersionRetriable(ctx, pool, GrantArgs{
				UserID:                c.UserID,
				PromotionVersionID:    pvID,
				IdempotencyKey:        idem,
				GrantAmountMinor:      amt,
				Currency:              "USDT",
				DepositAmountMinor:    0,
				ExemptFromPrimarySlot: true,
			})
			if gErr != nil {
				failed++
				detail := vipGrantErrDetail{
					Error:              gErr.Error(),
					PromotionVersionID: pvID,
					GrantMinor:         amt,
					TierID:             c.TierID,
					Suffix:             suffix,
					WindowKey:          windowKey,
				}
				detailBytes, _ := json.Marshal(detail)
				_, _ = pool.Exec(ctx, `
					INSERT INTO vip_delivery_run_items (run_id, user_id, pipeline, idempotency_key, amount_minor, result, detail)
					VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'error', $6::jsonb)
					ON CONFLICT (idempotency_key) DO NOTHING
				`, runID, c.UserID, pipeline, idem, amt, detailBytes)
				return
			}
			if inserted {
				granted++
				totalMinor += amt
			} else {
				skipped++
			}
			_, _ = pool.Exec(ctx, `
				INSERT INTO vip_delivery_run_items (run_id, user_id, pipeline, idempotency_key, amount_minor, result, detail)
				VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, jsonb_build_object('tier_id', $7, 'tier_sort', $8))
				ON CONFLICT (idempotency_key) DO NOTHING
			`, runID, c.UserID, pipeline, idem, amt, map[bool]string{true: "granted", false: "skipped"}[inserted], c.TierID, c.TierSort)
		}

		switch {
		case useScheduleMap:
			pvID, ok := effectiveTierPV[c.TierID]
			if !ok || pvID <= 0 {
				scheduleSkip("no_pv_for_tier")
				continue
			}
			amt, aerr := GrantAmountForVIPTierBenefit(ctx, pool, pvID, nil)
			if aerr != nil || amt <= 0 {
				scheduleSkip("amount_unresolved")
				continue
			}
			runGrant(pvID, amt, fmt.Sprintf("schedule:tier:%d:pv:%d", c.TierID, pvID))
		case len(attachments) > 0:
			for _, a := range attachments {
				runGrant(a.PV, a.Amount, fmt.Sprintf("benefit:%d:pv:%d", a.BenefitID, a.PV))
			}
		case cfg.PromotionVersionID > 0 && cfg.BaseAmountMinor > 0:
			amt := int64(float64(cfg.BaseAmountMinor) * c.Multiplier)
			runGrant(cfg.PromotionVersionID, amt, "default")
		default:
			scheduleSkip("missing_config")
		}
	}
	stats, _ := json.Marshal(map[string]any{
		"attempted":            attempted,
		"granted":              granted,
		"skipped":              skipped,
		"failed":               failed,
		"delivered_cost_minor": totalMinor,
		"used_planned_run":     consumedPlannedIndex >= 0,
	})
	_, _ = pool.Exec(ctx, `
		UPDATE vip_delivery_runs
		SET status = $2, stats = $3::jsonb, finished_at = now()
		WHERE id = $1::uuid
	`, runID, map[bool]string{true: "completed", false: "failed"}[failed == 0], stats)
	if failed == 0 {
		obs.IncVIPDeliveryRunSuccess()
	} else {
		obs.IncVIPDeliveryRunFailed()
	}

	recurringDue := nextRunAt == nil || !nextRunAt.After(now.UTC())
	if recurringDue {
		var next time.Time
		switch pipeline {
		case "weekly_bonus":
			next = windowStart.Add(7 * 24 * time.Hour)
		case "monthly_bonus":
			next = time.Date(windowStart.Year(), windowStart.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		default:
			next = windowStart.Add(24 * time.Hour)
		}
		_, _ = pool.Exec(ctx, `UPDATE vip_delivery_schedules SET next_run_at = $2, updated_at = now() WHERE pipeline = $1`, pipeline, next)
	}

	if consumedPlannedIndex >= 0 {
		newCfg, rerr := removePlannedRunAtIndex(configRaw, consumedPlannedIndex)
		if rerr == nil {
			_, _ = pool.Exec(ctx, `UPDATE vip_delivery_schedules SET config = COALESCE($2::jsonb,'{}'::jsonb), updated_at = now() WHERE pipeline = $1`, pipeline, newCfg)
		}
	}
	return nil
}

// ProcessVIPDeliveryTick is invoked by the worker on an interval. Weekly/monthly batch grants
// insert into vip_delivery_runs / vip_delivery_run_items — wired when schedules are fully configured.
func ProcessVIPDeliveryTick(ctx context.Context, pool *pgxpool.Pool, now time.Time) error {
	if err := recoverStaleVIPDeliveryRuns(ctx, pool, now); err != nil {
		return err
	}
	for _, pipeline := range []string{"weekly_bonus", "monthly_bonus"} {
		if err := RunVIPDeliveryPipeline(ctx, pool, pipeline, now.UTC(), "cron"); err != nil {
			return err
		}
	}
	_ = RetryVIPDeliveryGrantErrors(ctx, pool, 100)
	return nil
}
