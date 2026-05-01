package bonus

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"

	"github.com/crypto-casino/core/internal/bonus/bonustypes"
)

var internalPromoTitleHead = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^e2e[-_]sim([-_]|$)`),
	regexp.MustCompile(`(?i)^qa[-_]sim([-_]|$)`),
	regexp.MustCompile(`(?i)^test[-_]sim([-_]|$)`),
	regexp.MustCompile(`(?i)^staging[-_]promo([-_]|$)`),
}

// looksLikeInternalPromoTitle detects operator/test harness slug names that should not show as primary copy.
func looksLikeInternalPromoTitle(title string) bool {
	s := strings.TrimSpace(title)
	if s == "" {
		return false
	}
	sl := strings.ToLower(s)
	for _, re := range internalPromoTitleHead {
		if re.MatchString(sl) {
			return true
		}
	}
	return false
}

func firstLineDescription(desc string) string {
	d := strings.TrimSpace(desc)
	if d == "" {
		return ""
	}
	if i := strings.IndexAny(d, "\n\r"); i >= 0 {
		d = strings.TrimSpace(d[:i])
	}
	for strings.HasPrefix(d, "#") {
		d = strings.TrimSpace(strings.TrimPrefix(d, "#"))
	}
	d = strings.TrimPrefix(d, "**")
	d = strings.TrimSuffix(d, "**")
	d = strings.TrimSpace(d)
	if d == "" {
		return ""
	}
	runes := []rune(d)
	if len(runes) > 140 {
		d = strings.TrimSpace(string(runes[:137])) + "…"
	}
	return d
}

func bonusTypeDisplayLabel(bt string) string {
	bt = strings.TrimSpace(bt)
	if bt == "" {
		return ""
	}
	for _, e := range bonustypes.All() {
		if e.ID == bt {
			return e.Label
		}
	}
	return humanizeLooseSlug(bt)
}

func humanizeLooseSlug(s string) string {
	s = strings.ReplaceAll(s, "_", " ")
	s = strings.ReplaceAll(s, "-", " ")
	fields := strings.Fields(s)
	for i, w := range fields {
		if w == "" {
			continue
		}
		r := []rune(w)
		r[0] = unicode.ToUpper(r[0])
		fields[i] = string(r)
	}
	return strings.Join(fields, " ")
}

// HumanizeOfferTitle hides synthetic promotion slugs (E2E/QA staging names), preferring marketing copy then bonus kind.
func HumanizeOfferTitle(versionID int64, title, desc, bonusType string) string {
	t := strings.TrimSpace(title)
	if t != "" && !looksLikeInternalPromoTitle(t) {
		return t
	}
	if line := firstLineDescription(desc); line != "" {
		return line
	}
	if lbl := bonusTypeDisplayLabel(bonusType); lbl != "" {
		return lbl
	}
	if versionID > 0 {
		return fmt.Sprintf("Bonus offer #%d", versionID)
	}
	return strings.TrimSpace(title)
}
