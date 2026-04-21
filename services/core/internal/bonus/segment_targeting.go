package bonus

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SegmentTargetingMatches applies the same segment / explicit-target rules as player offer
// listing (EligibleForOffer), without schedule or trigger-type checks. Used before granting on
// deposit so geo/VIP/CSV targeting is honored in production and in simulate/preview.
func SegmentTargetingMatches(ctx context.Context, pool *pgxpool.Pool, userID, country string, versionID int64, rulesJSON []byte) bool {
	var wrap struct {
		Segment struct {
			VIPMinTier            int      `json:"vip_min_tier"`
			Tags                  []string `json:"tags"`
			CountryAllow          []string `json:"country_allow"`
			CountryDeny           []string `json:"country_deny"`
			ExplicitTargetingOnly bool     `json:"explicit_targeting_only"`
		} `json:"segment"`
	}
	_ = json.Unmarshal(rulesJSON, &wrap)
	seg := wrap.Segment

	cc := strings.ToUpper(strings.TrimSpace(country))
	if len(seg.CountryDeny) > 0 {
		for _, d := range seg.CountryDeny {
			if strings.ToUpper(strings.TrimSpace(d)) == cc {
				return false
			}
		}
	}
	if len(seg.CountryAllow) > 0 && cc != "" {
		ok := false
		for _, a := range seg.CountryAllow {
			if strings.ToUpper(strings.TrimSpace(a)) == cc {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}

	if seg.VIPMinTier > 0 {
		ord, err := playerVIPSortOrder(ctx, pool, userID)
		if err != nil || ord < seg.VIPMinTier {
			return false
		}
	}

	hasTargets, _ := versionUsesExplicitTargets(ctx, pool, versionID)
	if hasTargets {
		in, err := userInPromotionTargets(ctx, pool, versionID, userID)
		if err != nil || !in {
			return false
		}
	} else if seg.ExplicitTargetingOnly {
		return false
	}

	return true
}
