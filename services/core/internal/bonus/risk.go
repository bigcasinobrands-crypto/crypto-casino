package bonus

import (
	"context"
	"encoding/json"
	"time"

	"github.com/crypto-casino/core/internal/obs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RiskDecision captures a pre-grant evaluation result.
type RiskDecision struct {
	Decision  string   // "allowed", "denied", "manual_review"
	RuleCodes []string // which rules fired
	Inputs    map[string]any
}

// PreGrantRiskCheck evaluates policy-driven limits (site_settings bonus_abuse_policy).
// Returns a decision that the caller should persist to bonus_risk_decisions.
func PreGrantRiskCheck(ctx context.Context, pool *pgxpool.Pool, userID string, promoVersionID int64, grantMinor int64) RiskDecision {
	pol := LoadAbusePolicy(ctx, pool)
	inputs := map[string]any{
		"user_id":              userID,
		"promotion_version_id": promoVersionID,
		"grant_amount_minor":   grantMinor,
	}
	var codes []string

	var grants24h int64
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM user_bonus_instances
		WHERE user_id = $1::uuid AND created_at > now() - interval '24 hours'
	`, userID).Scan(&grants24h)
	inputs["grants_24h"] = grants24h
	if int(grants24h) >= pol.MaxGrantsPerUserPer24h {
		codes = append(codes, "velocity_24h_exceeded")
	}

	var promoLifetime int64
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(granted_amount_minor), 0)::bigint FROM user_bonus_instances
		WHERE user_id = $1::uuid AND promotion_version_id = $2 AND status IN ('active', 'completed', 'pending', 'pending_review')
	`, userID, promoVersionID).Scan(&promoLifetime)
	inputs["lifetime_granted_this_promo_minor"] = promoLifetime
	if promoLifetime+grantMinor > pol.MaxLifetimeGrantMinorPerUserPerPromo {
		codes = append(codes, "lifetime_cap_per_promo_exceeded")
	}

	var samePromo24h int64
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM user_bonus_instances
		WHERE user_id = $1::uuid AND promotion_version_id = $2 AND created_at > now() - interval '24 hours'
	`, userID, promoVersionID).Scan(&samePromo24h)
	inputs["same_promo_24h"] = samePromo24h
	if int(samePromo24h) >= pol.MaxGrantsSamePromoVersionPerUserPer24h {
		codes = append(codes, "same_promo_24h_exceeded")
	}

	var createdAt time.Time
	err := pool.QueryRow(ctx, `SELECT created_at FROM users WHERE id = $1::uuid`, userID).Scan(&createdAt)
	if err == nil {
		age := time.Since(createdAt)
		inputs["account_age_seconds"] = int64(age.Seconds())
		if pol.MinAccountAgeSeconds > 0 && age < time.Duration(pol.MinAccountAgeSeconds)*time.Second {
			codes = append(codes, "account_too_new")
		}
	}

	if pol.ManualReviewGrantMinorThreshold > 0 && grantMinor >= pol.ManualReviewGrantMinorThreshold && len(codes) == 0 {
		return RiskDecision{Decision: "manual_review", RuleCodes: []string{"high_value_grant"}, Inputs: inputs}
	}

	if len(codes) == 0 {
		return RiskDecision{Decision: "allowed", RuleCodes: []string{"all_passed"}, Inputs: inputs}
	}
	obs.IncBonusAbuseDenied()
	return RiskDecision{Decision: "denied", RuleCodes: codes, Inputs: inputs}
}

// PersistRiskDecision writes the decision to bonus_risk_decisions for audit.
func PersistRiskDecision(ctx context.Context, pool *pgxpool.Pool, userID string, promoVersionID int64, d RiskDecision) {
	inputsJSON, _ := json.Marshal(d.Inputs)
	_, _ = pool.Exec(ctx, `
		INSERT INTO bonus_risk_decisions (user_id, promotion_version_id, decision, rule_codes, inputs)
		VALUES ($1::uuid, $2, $3, $4::text[], $5::jsonb)
	`, userID, promoVersionID, d.Decision, d.RuleCodes, inputsJSON)
}

// ReviewQueuePending returns the count of unresolved manual_review decisions (for admin dashboard).
func ReviewQueuePending(ctx context.Context, pool *pgxpool.Pool) int64 {
	var n int64
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::bigint FROM bonus_risk_decisions
		WHERE decision = 'manual_review'
	`).Scan(&n)
	return n
}

// ListPendingReviews lists risk decisions awaiting manual review.
func ListPendingReviews(ctx context.Context, pool *pgxpool.Pool, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := pool.Query(ctx, `
		SELECT id, user_id::text, promotion_version_id, decision, rule_codes, inputs, created_at
		FROM bonus_risk_decisions
		WHERE decision = 'manual_review'
		ORDER BY id DESC LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []map[string]any
	for rows.Next() {
		var id int64
		var uid string
		var pvid *int64
		var dec string
		var codes []string
		var inp []byte
		var ct time.Time
		if err := rows.Scan(&id, &uid, &pvid, &dec, &codes, &inp, &ct); err != nil {
			continue
		}
		var inpObj any
		_ = json.Unmarshal(inp, &inpObj)
		item := map[string]any{
			"id": id, "user_id": uid, "decision": dec, "rule_codes": codes,
			"inputs": inpObj, "created_at": ct.UTC().Format(time.RFC3339),
		}
		if pvid != nil {
			item["promotion_version_id"] = *pvid
		}
		list = append(list, item)
	}
	return list, nil
}

// ResolveReview marks a manual_review decision as allowed or denied by staff.
func ResolveReview(ctx context.Context, pool *pgxpool.Pool, decisionID int64, newDecision string) error {
	if newDecision != "allowed" && newDecision != "denied" {
		return pgx.ErrNoRows
	}
	_, err := pool.Exec(ctx, `
		UPDATE bonus_risk_decisions SET decision = $2 WHERE id = $1 AND decision = 'manual_review'
	`, decisionID, newDecision)
	return err
}
