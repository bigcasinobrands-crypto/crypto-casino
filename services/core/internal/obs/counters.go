package obs

import "sync/atomic"

// Process-local counters for SLI stubs (scrape via GET /v1/admin/ops/summary "metrics" field).

var bonusGrantsTotal uint64
var bonusEvalErrors uint64
var bonusBetRejects uint64
var jobsProcessedTotal uint64
var jobsFailedTotal uint64
var bonusAbuseDeniedTotal uint64
var vipTierUpTotal uint64
var vipTierGrantGranted uint64
var vipTierGrantSkipped uint64
var vipTierGrantError uint64

func IncBonusGrant() {
	atomic.AddUint64(&bonusGrantsTotal, 1)
}

func IncBonusEvalError() {
	atomic.AddUint64(&bonusEvalErrors, 1)
}

func IncBonusBetReject() {
	atomic.AddUint64(&bonusBetRejects, 1)
}

func IncJobProcessed() {
	atomic.AddUint64(&jobsProcessedTotal, 1)
}

func IncJobFailed() {
	atomic.AddUint64(&jobsFailedTotal, 1)
}

func IncBonusAbuseDenied() {
	atomic.AddUint64(&bonusAbuseDeniedTotal, 1)
}

func IncVipTierUp() {
	atomic.AddUint64(&vipTierUpTotal, 1)
}

func IncVipTierGrantGranted() {
	atomic.AddUint64(&vipTierGrantGranted, 1)
}

func IncVipTierGrantSkipped() {
	atomic.AddUint64(&vipTierGrantSkipped, 1)
}

func IncVipTierGrantError() {
	atomic.AddUint64(&vipTierGrantError, 1)
}

func Snapshot() map[string]uint64 {
	return map[string]uint64{
		"bonus_grants_total":    atomic.LoadUint64(&bonusGrantsTotal),
		"bonus_eval_errors":     atomic.LoadUint64(&bonusEvalErrors),
		"bonus_bet_rejects":     atomic.LoadUint64(&bonusBetRejects),
		"bonus_abuse_denied_total": atomic.LoadUint64(&bonusAbuseDeniedTotal),
		"jobs_processed_total":  atomic.LoadUint64(&jobsProcessedTotal),
		"jobs_failed_total":     atomic.LoadUint64(&jobsFailedTotal),
		"vip_tier_up_total":         atomic.LoadUint64(&vipTierUpTotal),
		"vip_tier_grant_granted":    atomic.LoadUint64(&vipTierGrantGranted),
		"vip_tier_grant_skipped":    atomic.LoadUint64(&vipTierGrantSkipped),
		"vip_tier_grant_error":      atomic.LoadUint64(&vipTierGrantError),
	}
}
