package bonus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
)

// DeriveOfferFamily parses rules JSON and returns coarse offer_family.
func DeriveOfferFamily(rulesJSON []byte) (string, error) {
	r, err := parseRules(rulesJSON)
	if err != nil {
		return "", err
	}
	return OfferFamilyFromRules(r), nil
}

// OfferFamilyFromRules derives a coarse family when DB column is empty.
func OfferFamilyFromRules(r promoRules) string {
	shape := rewardShape(r)
	t := strings.ToLower(strings.TrimSpace(r.Trigger.Type))
	switch {
	case shape == "freespins" || strings.Contains(shape, "spin"):
		return "freespins"
	case shape == "cashback":
		return "cashback"
	case t == "deposit" && (shape == "percent_match" || r.Reward.Percent > 0):
		return "percent_match"
	case shape == "fixed":
		return "fixed_cash"
	default:
		if shape != "" && shape != "other" {
			return shape
		}
		return "other"
	}
}

func rewardShape(r promoRules) string {
	rt := strings.ToLower(strings.TrimSpace(r.Reward.Type))
	switch rt {
	case "percent_match", "percent", "":
		if r.Reward.Percent > 0 || rt == "percent_match" || rt == "percent" {
			return "percent_match"
		}
	case "fixed", "fixed_amount":
		return "fixed"
	case "freespins", "free_spins":
		return "freespins"
	case "cashback":
		return "cashback"
	}
	if r.Reward.Percent > 0 {
		return "percent_match"
	}
	if r.Reward.FixedMinor > 0 {
		return "fixed"
	}
	return "other"
}

type segmentRules struct {
	VIPMinTier              int      `json:"vip_min_tier"`
	Tags                    []string `json:"tags"`
	CountryAllow            []string `json:"country_allow"`
	CountryDeny             []string `json:"country_deny"`
	ExplicitTargetingOnly   bool     `json:"explicit_targeting_only"`
}

// EligibilityFingerprintHex returns SHA-256 hex of canonical JSON per product spec.
func EligibilityFingerprintHex(rulesJSON []byte, offerFamily string) (string, error) {
	r, err := parseRules(rulesJSON)
	if err != nil {
		return "", err
	}
	var wrap struct {
		Segment segmentRules `json:"segment"`
	}
	_ = json.Unmarshal(rulesJSON, &wrap)
	seg := wrap.Segment

	ch := append([]string(nil), r.Trigger.Channels...)
	sort.Strings(ch)
	for i := range ch {
		ch[i] = strings.ToLower(strings.TrimSpace(ch[i]))
	}
	tags := append([]string(nil), seg.Tags...)
	sort.Strings(tags)
	ca := append([]string(nil), seg.CountryAllow...)
	sort.Strings(ca)
	for i := range ca {
		ca[i] = strings.ToUpper(strings.TrimSpace(ca[i]))
	}
	cd := append([]string(nil), seg.CountryDeny...)
	sort.Strings(cd)
	for i := range cd {
		cd[i] = strings.ToUpper(strings.TrimSpace(cd[i]))
	}

	fam := strings.TrimSpace(offerFamily)
	if fam == "" {
		fam = OfferFamilyFromRules(r)
	}

	canonical := map[string]any{
		"offer_family": fam,
		"reward": map[string]any{
			"shape": rewardShape(r),
		},
		"trigger": map[string]any{
			"type":                 strings.ToLower(strings.TrimSpace(r.Trigger.Type)),
			"first_deposit_only":   r.Trigger.FirstDepositOnly,
			"nth_deposit":          r.Trigger.NthDeposit,
			"channels":             ch,
		},
		"segment": map[string]any{
			"vip_min_tier":             seg.VIPMinTier,
			"tags":                     tags,
			"country_allow":            ca,
			"country_deny":             cd,
			"explicit_targeting_only":  seg.ExplicitTargetingOnly,
		},
	}
	b, err := json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}

// ExclusivityKey returns bucket for dedupe: dedupe_group_key if set, else family|fingerprint.
func ExclusivityKey(dedupeGroup, offerFamily, fingerprint string) string {
	g := strings.TrimSpace(dedupeGroup)
	if g != "" {
		return "g:" + g
	}
	return "f:" + strings.TrimSpace(offerFamily) + "|" + strings.TrimSpace(fingerprint)
}
