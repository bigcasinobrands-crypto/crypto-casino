package obs

import "sync/atomic"

// Process-local counters for SLI stubs (scrape via GET /v1/admin/ops/summary "metrics" field).

var bonusGrantsTotal uint64
var bonusEvalErrors uint64
var bonusBetRejects uint64
var jobsProcessedTotal uint64
var jobsFailedTotal uint64
var bonusAbuseDeniedTotal uint64
var bonusOutboxDeliveredTotal uint64
var bonusOutboxDeliveryAttemptFailedTotal uint64
var bonusOutboxDLQTotal uint64
var bonusOutboxRedrivenTotal uint64
var bonusMaxBetViolationForfeitsTotal uint64
var vipTierUpTotal uint64
var vipTierGrantGranted uint64
var vipTierGrantSkipped uint64
var vipTierGrantError uint64
var freeSpinBogGranted uint64
var freeSpinBogError uint64
var vipDeliveryRunSuccessTotal uint64
var vipDeliveryRunFailedTotal uint64

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

func IncBonusOutboxDelivered() {
	atomic.AddUint64(&bonusOutboxDeliveredTotal, 1)
}

func IncBonusOutboxDeliveryAttemptFailed() {
	atomic.AddUint64(&bonusOutboxDeliveryAttemptFailedTotal, 1)
}

func IncBonusOutboxDLQ() {
	atomic.AddUint64(&bonusOutboxDLQTotal, 1)
}

func IncBonusOutboxRedriven() {
	atomic.AddUint64(&bonusOutboxRedrivenTotal, 1)
}

// AddBonusMaxBetViolationForfeits increments successful worker forfeits from max-bet violation policy (batch-safe).
func AddBonusMaxBetViolationForfeits(n uint64) {
	if n == 0 {
		return
	}
	atomic.AddUint64(&bonusMaxBetViolationForfeitsTotal, n)
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

// AddFreeSpinBogGranted counts rows moved pending→granted by the BOG addFreeRounds worker (batched in one call n).
func AddFreeSpinBogGranted(n uint64) {
	if n == 0 {
		return
	}
	atomic.AddUint64(&freeSpinBogGranted, n)
}

// AddFreeSpinBogError counts terminal errors for that worker (per grant).
func AddFreeSpinBogError(n uint64) {
	if n == 0 {
		return
	}
	atomic.AddUint64(&freeSpinBogError, n)
}

func Snapshot() map[string]uint64 {
	return map[string]uint64{
		"bonus_grants_total":                         atomic.LoadUint64(&bonusGrantsTotal),
		"bonus_eval_errors":                          atomic.LoadUint64(&bonusEvalErrors),
		"bonus_bet_rejects":                          atomic.LoadUint64(&bonusBetRejects),
		"bonus_abuse_denied_total":                   atomic.LoadUint64(&bonusAbuseDeniedTotal),
		"bonus_outbox_delivered_total":               atomic.LoadUint64(&bonusOutboxDeliveredTotal),
		"bonus_outbox_delivery_attempt_failed_total": atomic.LoadUint64(&bonusOutboxDeliveryAttemptFailedTotal),
		"bonus_outbox_dlq_total":                     atomic.LoadUint64(&bonusOutboxDLQTotal),
		"bonus_outbox_redriven_total":                atomic.LoadUint64(&bonusOutboxRedrivenTotal),
		"bonus_max_bet_violation_forfeits_total":     atomic.LoadUint64(&bonusMaxBetViolationForfeitsTotal),
		"jobs_processed_total":                       atomic.LoadUint64(&jobsProcessedTotal),
		"jobs_failed_total":                          atomic.LoadUint64(&jobsFailedTotal),
		"vip_tier_up_total":                          atomic.LoadUint64(&vipTierUpTotal),
		"vip_tier_grant_granted":                     atomic.LoadUint64(&vipTierGrantGranted),
		"vip_tier_grant_skipped":                     atomic.LoadUint64(&vipTierGrantSkipped),
		"vip_tier_grant_error":                        atomic.LoadUint64(&vipTierGrantError),
		"free_spin_bog_granted_total":                 atomic.LoadUint64(&freeSpinBogGranted),
		"free_spin_bog_error_total":                  atomic.LoadUint64(&freeSpinBogError),
		"vip_delivery_run_success_total":             atomic.LoadUint64(&vipDeliveryRunSuccessTotal),
		"vip_delivery_run_failed_total":              atomic.LoadUint64(&vipDeliveryRunFailedTotal),
	}
}

func IncVIPDeliveryRunSuccess() {
	atomic.AddUint64(&vipDeliveryRunSuccessTotal, 1)
}

func IncVIPDeliveryRunFailed() {
	atomic.AddUint64(&vipDeliveryRunFailedTotal, 1)
}
