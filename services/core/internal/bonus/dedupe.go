package bonus

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LivePublishConflictError carries conflicting version for HTTP 409 responses.
type LivePublishConflictError struct {
	ConflictVersionID int64
	PromotionName     string
}

func (e *LivePublishConflictError) Error() string {
	return fmt.Sprintf("bonus: exclusivity conflict with promotion_version %d (%s)", e.ConflictVersionID, e.PromotionName)
}

// CheckExclusivePublishConflict returns an error if another live offer shares the same exclusivity key.
func CheckExclusivePublishConflict(ctx context.Context, pool *pgxpool.Pool, versionID int64, rulesJSON []byte, offerFamily, dedupeGroup *string) error {
	var fam string
	if offerFamily != nil && *offerFamily != "" {
		fam = *offerFamily
	} else {
		r, err := parseRules(rulesJSON)
		if err != nil {
			return err
		}
		fam = OfferFamilyFromRules(r)
	}
	fp, err := EligibilityFingerprintHex(rulesJSON, fam)
	if err != nil {
		return err
	}
	var dg string
	if dedupeGroup != nil {
		dg = *dedupeGroup
	}
	myKey := ExclusivityKey(dg, fam, fp)

	rows, err := pool.Query(ctx, `
		SELECT pv.id, pv.rules, pv.offer_family, pv.eligibility_fingerprint, pv.dedupe_group_key, p.name
		FROM promotion_versions pv
		JOIN promotions p ON p.id = pv.promotion_id
		WHERE pv.published_at IS NOT NULL
		  AND p.status != 'archived'
		  AND COALESCE(p.grants_paused, false) = false
		  AND pv.id != $1
	`, versionID)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var oid int64
		var rj []byte
		var of, efp, dgk *string
		var pname string
		if err := rows.Scan(&oid, &rj, &of, &efp, &dgk, &pname); err != nil {
			continue
		}
		var otherFam string
		if of != nil && *of != "" {
			otherFam = *of
		} else {
			orules, err := parseRules(rj)
			if err != nil {
				continue
			}
			otherFam = OfferFamilyFromRules(orules)
		}
		var otherFP string
		if efp != nil && *efp != "" {
			otherFP = *efp
		} else {
			ofp, err := EligibilityFingerprintHex(rj, otherFam)
			if err != nil {
				continue
			}
			otherFP = ofp
		}
		var odg string
		if dgk != nil {
			odg = *dgk
		}
		otherKey := ExclusivityKey(odg, otherFam, otherFP)
		if otherKey == myKey {
			return &LivePublishConflictError{ConflictVersionID: oid, PromotionName: pname}
		}
	}
	return nil
}
