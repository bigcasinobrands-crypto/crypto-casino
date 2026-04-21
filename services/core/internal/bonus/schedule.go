package bonus

import (
	"time"
)

// VersionSchedule holds optional DB columns for offer windowing.
type VersionSchedule struct {
	ValidFrom   *time.Time
	ValidTo     *time.Time
	Timezone    string
	WeeklyBits  []byte // raw JSON; v1 treats empty as always-on
}

// OfferScheduleOpen returns true if now is inside [valid_from, valid_to] when set.
func OfferScheduleOpen(now time.Time, vs VersionSchedule) bool {
	if vs.ValidFrom != nil && now.Before(*vs.ValidFrom) {
		return false
	}
	if vs.ValidTo != nil && !now.Before(*vs.ValidTo) {
		return false
	}
	// weekly_schedule JSON parsing deferred — empty means 24/7
	return true
}
