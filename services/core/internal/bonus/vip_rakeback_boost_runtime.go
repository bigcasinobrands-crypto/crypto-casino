package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrRakebackBoostNoTier          = errors.New("rakeback_boost: no vip tier")
	ErrRakebackBoostNoConfig        = errors.New("rakeback_boost: no configured boost for tier")
	ErrRakebackBoostNotClaimableNow = errors.New("rakeback_boost: not claimable now")
	ErrRakebackBoostAlreadyActive   = errors.New("rakeback_boost: already active")
	ErrRakebackBoostDailyLimit      = errors.New("rakeback_boost: daily limit reached")
)

type rakebackBoostWindowConfig struct {
	StartUTC            string `json:"start_utc"`
	ClaimWindowMinutes  int    `json:"claim_window_minutes"`
	BoostDurationMinute int    `json:"boost_duration_minutes"`
}

type rakebackBoostScheduleConfig struct {
	RebateProgramKey string                     `json:"rebate_program_key"`
	BoostPercentAdd  float64                    `json:"boost_percent_add"`
	MaxClaimsPerDay  int                        `json:"max_claims_per_day"`
	DisplayToCustomer bool                      `json:"display_to_customer"`
	Windows          []rakebackBoostWindowConfig `json:"windows"`
}

type rakebackBoostWindow struct {
	StartAt      time.Time
	ClaimEndsAt  time.Time
	BoostMinutes int
}

// RakebackBoostSlot is one configured daily window for the tier (player UI: one lightning icon per slot).
type RakebackBoostSlot struct {
	Index           int    `json:"index"`
	StartUTC        string `json:"start_utc"`
	WindowStartAt   string `json:"window_start_at"`
	ClaimEndsAt     string `json:"claim_ends_at"`
	Claimed         bool   `json:"claimed"`
	Claimable       bool   `json:"claimable"`
	Active          bool   `json:"active"`
}

type RakebackBoostStatus struct {
	Enabled            bool       `json:"enabled"`
	BenefitID          int64      `json:"benefit_id,omitempty"`
	TierID             int        `json:"tier_id,omitempty"`
	RebateProgramKey   string     `json:"rebate_program_key,omitempty"`
	BoostPercentAdd    float64    `json:"boost_percent_add,omitempty"`
	MaxClaimsPerDay    int        `json:"max_claims_per_day,omitempty"`
	ClaimsUsedToday    int        `json:"claims_used_today,omitempty"`
	ClaimsRemainingToday int      `json:"claims_remaining_today,omitempty"`
	NowUTC             string     `json:"now_utc,omitempty"`
	ClaimableNow       bool       `json:"claimable_now"`
	ClaimWindowStartAt *string    `json:"claim_window_start_at,omitempty"`
	ClaimWindowEndsAt  *string    `json:"claim_window_ends_at,omitempty"`
	ActiveNow          bool       `json:"active_now"`
	ActiveUntilAt      *string    `json:"active_until_at,omitempty"`
	// BoostActiveStartedAt is claimed_at on the active boost row (UI: progress claim → active_until_at).
	BoostActiveStartedAt *string  `json:"boost_active_started_at,omitempty"`
	NextWindowStartAt  *string    `json:"next_window_start_at,omitempty"`
	Reason             string     `json:"reason,omitempty"`
	Slots              []RakebackBoostSlot `json:"slots,omitempty"`
	// BoostWagerAccruedMinor is cash stake in [claimed_at, now) while boost is active.
	BoostWagerAccruedMinor int64 `json:"boost_wager_accrued_minor,omitempty"`
	// BoostAccruedEstimateMinor is boostAdd% of BoostWagerAccruedMinor (settles to claimable rakeback when boost ends).
	BoostAccruedEstimateMinor int64 `json:"boost_accrued_estimate_minor,omitempty"`
}

func parseRakebackBoostScheduleConfig(raw json.RawMessage) (rakebackBoostScheduleConfig, error) {
	var c rakebackBoostScheduleConfig
	if len(raw) == 0 {
		return c, nil
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		return c, err
	}
	if c.MaxClaimsPerDay <= 0 {
		c.MaxClaimsPerDay = 1
	}
	return c, nil
}

func parseHHMMToUTC(s string) (h int, m int, ok bool) {
	s = strings.TrimSpace(s)
	if len(s) != 5 || s[2] != ':' {
		return 0, 0, false
	}
	_, err := fmt.Sscanf(s, "%02d:%02d", &h, &m)
	if err != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, false
	}
	return h, m, true
}

func buildRakebackBoostWindows(now time.Time, cfg rakebackBoostScheduleConfig) []rakebackBoostWindow {
	baseDay := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	var out []rakebackBoostWindow
	for _, w := range cfg.Windows {
		h, m, ok := parseHHMMToUTC(w.StartUTC)
		if !ok {
			continue
		}
		claimMins := w.ClaimWindowMinutes
		if claimMins <= 0 {
			continue
		}
		boostMins := w.BoostDurationMinute
		if boostMins <= 0 {
			continue
		}
		for _, d := range []int{-1, 0, 1} {
			start := baseDay.AddDate(0, 0, d).Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute)
			out = append(out, rakebackBoostWindow{
				StartAt:      start,
				ClaimEndsAt:  start.Add(time.Duration(claimMins) * time.Minute),
				BoostMinutes: boostMins,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartAt.Before(out[j].StartAt) })
	return out
}

func loadRakebackBoostTierConfig(ctx context.Context, pool *pgxpool.Pool, userID string) (tierID int, benefitID int64, cfg rakebackBoostScheduleConfig, err error) {
	var tid *int
	err = pool.QueryRow(ctx, `SELECT tier_id FROM player_vip_state WHERE user_id = $1::uuid`, userID).Scan(&tid)
	if err == pgx.ErrNoRows || tid == nil || *tid <= 0 {
		return 0, 0, cfg, ErrRakebackBoostNoTier
	}
	if err != nil {
		return 0, 0, cfg, err
	}
	tierID = *tid
	var raw []byte
	err = pool.QueryRow(ctx, `
		SELECT id, config
		FROM vip_tier_benefits
		WHERE tier_id = $1 AND enabled = true AND benefit_type = 'rakeback_boost_schedule'
		ORDER BY sort_order ASC, id ASC
		LIMIT 1
	`, tierID).Scan(&benefitID, &raw)
	if err == pgx.ErrNoRows {
		return tierID, 0, cfg, ErrRakebackBoostNoConfig
	}
	if err != nil {
		return 0, 0, cfg, err
	}
	cfg, err = parseRakebackBoostScheduleConfig(raw)
	if err != nil {
		return 0, 0, cfg, err
	}
	if len(cfg.Windows) == 0 {
		return tierID, benefitID, cfg, ErrRakebackBoostNoConfig
	}
	return tierID, benefitID, cfg, nil
}

// activeRakebackBoostSnapshot returns the claim and expiry for the row with the latest active_until_at still in the future.
func activeRakebackBoostSnapshot(ctx context.Context, pool *pgxpool.Pool, userID string, benefitID int64, now time.Time) (claimedAt *time.Time, activeUntil *time.Time, err error) {
	var ca, au time.Time
	err = pool.QueryRow(ctx, `
		SELECT claimed_at, active_until_at
		FROM vip_rakeback_boost_claims
		WHERE user_id = $1::uuid AND benefit_id = $2 AND active_until_at > $3
		ORDER BY active_until_at DESC
		LIMIT 1
	`, userID, benefitID, now).Scan(&ca, &au)
	if err == pgx.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return &ca, &au, nil
}

func activeRakebackBoostUntil(ctx context.Context, pool *pgxpool.Pool, userID string, benefitID int64, now time.Time) (*time.Time, error) {
	_, au, err := activeRakebackBoostSnapshot(ctx, pool, userID, benefitID, now)
	return au, err
}

func claimsUsedInDay(ctx context.Context, pool *pgxpool.Pool, userID string, benefitID int64, dayStart time.Time) (int, error) {
	dayEnd := dayStart.Add(24 * time.Hour)
	var n int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)::int
		FROM vip_rakeback_boost_claims
		WHERE user_id = $1::uuid AND benefit_id = $2
		  AND window_start_at >= $3 AND window_start_at < $4
	`, userID, benefitID, dayStart, dayEnd).Scan(&n)
	return n, err
}

func boostWindowMinuteKey(t time.Time) string {
	u := t.UTC()
	return fmt.Sprintf("%04d-%02d-%02dT%02d:%02d", u.Year(), u.Month(), u.Day(), u.Hour(), u.Minute())
}

func rakebackBoostTodayClaimKeys(ctx context.Context, pool *pgxpool.Pool, userID string, benefitID int64, dayStart, now time.Time) (claimed map[string]bool, activeWinKey string, err error) {
	dayEnd := dayStart.Add(24 * time.Hour)
	rows, err := pool.Query(ctx, `
		SELECT window_start_at, active_until_at
		FROM vip_rakeback_boost_claims
		WHERE user_id = $1::uuid AND benefit_id = $2
		  AND window_start_at >= $3 AND window_start_at < $4
	`, userID, benefitID, dayStart, dayEnd)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	claimed = make(map[string]bool)
	var bestActiveUntil time.Time
	for rows.Next() {
		var ws, au time.Time
		if err := rows.Scan(&ws, &au); err != nil {
			continue
		}
		claimed[boostWindowMinuteKey(ws)] = true
		if au.After(now) && (activeWinKey == "" || au.After(bestActiveUntil)) {
			activeWinKey = boostWindowMinuteKey(ws)
			bestActiveUntil = au
		}
	}
	return claimed, activeWinKey, rows.Err()
}

func RakebackBoostStatusForUser(ctx context.Context, pool *pgxpool.Pool, userID string, now time.Time) (RakebackBoostStatus, error) {
	st := RakebackBoostStatus{
		Enabled: false, ClaimableNow: false, ActiveNow: false, NowUTC: now.UTC().Format(time.RFC3339),
	}
	tierID, benefitID, cfg, err := loadRakebackBoostTierConfig(ctx, pool, userID)
	if err != nil {
		if errors.Is(err, ErrRakebackBoostNoTier) || errors.Is(err, ErrRakebackBoostNoConfig) {
			st.Reason = "not_configured"
			return st, nil
		}
		return st, err
	}
	st.Enabled = true
	st.BenefitID = benefitID
	st.TierID = tierID
	st.RebateProgramKey = cfg.RebateProgramKey
	st.BoostPercentAdd = cfg.BoostPercentAdd
	st.MaxClaimsPerDay = cfg.MaxClaimsPerDay

	if ca, au, err := activeRakebackBoostSnapshot(ctx, pool, userID, benefitID, now); err == nil && au != nil {
		x := au.UTC().Format(time.RFC3339)
		st.ActiveNow = true
		st.ActiveUntilAt = &x
		if ca != nil {
			y := ca.UTC().Format(time.RFC3339)
			st.BoostActiveStartedAt = &y
		}
	}
	if st.ActiveNow && st.BoostActiveStartedAt != nil {
		t0, perr := time.Parse(time.RFC3339, *st.BoostActiveStartedAt)
		if perr == nil {
			w, werr := sumCashWagerForWindow(ctx, pool, userID, t0.UTC(), now.UTC())
			if werr == nil {
				st.BoostWagerAccruedMinor = w
				if cfg.BoostPercentAdd > 0 {
					st.BoostAccruedEstimateMinor = int64(math.Round(float64(w) * cfg.BoostPercentAdd / 100.0))
				}
			}
		}
	}
	dayStart := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	used, err := claimsUsedInDay(ctx, pool, userID, benefitID, dayStart)
	if err == nil {
		st.ClaimsUsedToday = used
		st.ClaimsRemainingToday = cfg.MaxClaimsPerDay - used
		if st.ClaimsRemainingToday < 0 {
			st.ClaimsRemainingToday = 0
		}
	}
	windows := buildRakebackBoostWindows(now, cfg)
	for _, w := range windows {
		if now.Before(w.StartAt) {
			x := w.StartAt.UTC().Format(time.RFC3339)
			st.NextWindowStartAt = &x
			break
		}
		if (now.Equal(w.StartAt) || now.After(w.StartAt)) && now.Before(w.ClaimEndsAt) {
			s := w.StartAt.UTC().Format(time.RFC3339)
			e := w.ClaimEndsAt.UTC().Format(time.RFC3339)
			st.ClaimWindowStartAt = &s
			st.ClaimWindowEndsAt = &e
			st.ClaimableNow = st.ClaimsRemainingToday > 0
			if st.ActiveNow {
				st.ClaimableNow = false
				st.Reason = "already_active"
			}
			if !st.ClaimableNow && st.Reason == "" && st.ClaimsRemainingToday <= 0 {
				st.Reason = "daily_limit_reached"
			}
			break
		}
	}
	if st.NextWindowStartAt == nil {
		for _, w := range windows {
			if w.StartAt.After(now) {
				x := w.StartAt.UTC().Format(time.RFC3339)
				st.NextWindowStartAt = &x
				break
			}
		}
	}
	// Always expose one slot per configured window for the player UI, even if the claims lookup fails.
	claimedKeys, activeKey, serr := rakebackBoostTodayClaimKeys(ctx, pool, userID, benefitID, dayStart, now)
	if serr != nil || claimedKeys == nil {
		claimedKeys = make(map[string]bool)
		activeKey = ""
	}
	var slots []RakebackBoostSlot
	slotIdx := 0
	for _, wcfg := range cfg.Windows {
		h, m, ok := parseHHMMToUTC(wcfg.StartUTC)
		if !ok || wcfg.ClaimWindowMinutes <= 0 || wcfg.BoostDurationMinute <= 0 {
			continue
		}
		windowStart := dayStart.Add(time.Duration(h)*time.Hour + time.Duration(m)*time.Minute)
		claimEnds := windowStart.Add(time.Duration(wcfg.ClaimWindowMinutes) * time.Minute)
		key := boostWindowMinuteKey(windowStart)
		isClaimed := claimedKeys[key]
		isActive := activeKey != "" && activeKey == key
		inClaimWindow := !now.Before(windowStart) && now.Before(claimEnds)
		claimable := inClaimWindow && !isClaimed && st.ClaimsRemainingToday > 0 && !st.ActiveNow
		slots = append(slots, RakebackBoostSlot{
			Index:           slotIdx,
			StartUTC:        strings.TrimSpace(wcfg.StartUTC),
			WindowStartAt:   windowStart.UTC().Format(time.RFC3339),
			ClaimEndsAt:     claimEnds.UTC().Format(time.RFC3339),
			Claimed:         isClaimed,
			Claimable:       claimable,
			Active:          isActive,
		})
		slotIdx++
	}
	st.Slots = slots
	return st, nil
}

func ClaimRakebackBoostForUser(ctx context.Context, pool *pgxpool.Pool, userID string, now time.Time) (RakebackBoostStatus, error) {
	if _, err := SyncPlayerVIPTierToWager(ctx, pool, userID); err != nil {
		return RakebackBoostStatus{}, err
	}
	tierID, benefitID, cfg, err := loadRakebackBoostTierConfig(ctx, pool, userID)
	if err != nil {
		return RakebackBoostStatus{}, err
	}
	if au, err := activeRakebackBoostUntil(ctx, pool, userID, benefitID, now); err == nil && au != nil {
		return RakebackBoostStatus{}, ErrRakebackBoostAlreadyActive
	}
	dayStart := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	used, err := claimsUsedInDay(ctx, pool, userID, benefitID, dayStart)
	if err != nil {
		return RakebackBoostStatus{}, err
	}
	if used >= cfg.MaxClaimsPerDay {
		return RakebackBoostStatus{}, ErrRakebackBoostDailyLimit
	}
	var claimWindow *rakebackBoostWindow
	for _, w := range buildRakebackBoostWindows(now, cfg) {
		if (now.Equal(w.StartAt) || now.After(w.StartAt)) && now.Before(w.ClaimEndsAt) {
			tmp := w
			claimWindow = &tmp
			break
		}
	}
	if claimWindow == nil {
		return RakebackBoostStatus{}, ErrRakebackBoostNotClaimableNow
	}

	activeUntil := now.Add(time.Duration(claimWindow.BoostMinutes) * time.Minute)
	_, err = pool.Exec(ctx, `
		INSERT INTO vip_rakeback_boost_claims
			(user_id, tier_id, benefit_id, window_start_at, claim_deadline_at, claimed_at, active_until_at)
		VALUES
			($1::uuid, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, benefit_id, window_start_at)
		DO NOTHING
	`, userID, tierID, benefitID, claimWindow.StartAt, claimWindow.ClaimEndsAt, now, activeUntil)
	if err != nil {
		return RakebackBoostStatus{}, err
	}
	return RakebackBoostStatusForUser(ctx, pool, userID, now)
}

// ActiveRakebackBoostPercentAdd reports the timed boost add if one is active now (used for UI / analytics).
// Periodic rebate grants do not include this; boost is settled separately into reward_rebate_grants when the boost ends.
func ActiveRakebackBoostPercentAdd(ctx context.Context, pool *pgxpool.Pool, userID, programKey string, now time.Time) (float64, error) {
	if strings.TrimSpace(programKey) == "" {
		return 0, nil
	}
	tierID, benefitID, cfg, err := loadRakebackBoostTierConfig(ctx, pool, userID)
	if err != nil {
		if errors.Is(err, ErrRakebackBoostNoTier) || errors.Is(err, ErrRakebackBoostNoConfig) {
			return 0, nil
		}
		return 0, err
	}
	if tierID <= 0 || benefitID <= 0 {
		return 0, nil
	}
	if !strings.EqualFold(strings.TrimSpace(cfg.RebateProgramKey), strings.TrimSpace(programKey)) {
		return 0, nil
	}
	au, err := activeRakebackBoostUntil(ctx, pool, userID, benefitID, now)
	if err != nil || au == nil {
		return 0, err
	}
	return roundPercent(cfg.BoostPercentAdd), nil
}
