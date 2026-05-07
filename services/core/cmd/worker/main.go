package main

import (
	"context"
	"encoding/json"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/challenges"
	"github.com/crypto-casino/core/internal/compliance"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
	"github.com/crypto-casino/core/internal/jobs"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/crypto-casino/core/internal/affiliate"
	"github.com/crypto-casino/core/internal/finjobs"
	"github.com/crypto-casino/core/internal/oddin"
	"github.com/crypto-casino/core/internal/reconcile"
	"github.com/crypto-casino/core/internal/redisx"
	"github.com/crypto-casino/core/internal/wallet"
	"github.com/crypto-casino/core/internal/webhooks"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if err := cfg.ValidateProduction(); err != nil {
		log.Fatalf("config: %v", err)
	}
	obs.InitLogging(cfg.LogFormat)
	if cfg.RedisURL == "" {
		log.Fatal("REDIS_URL required for worker")
	}
	ctx := context.Background()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()
	rdb, err := redisx.New(cfg.RedisURL)
	if err != nil || rdb == nil {
		log.Fatalf("redis: %v", err)
	}
	defer rdb.Close()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	bog := blueocean.NewClient(&cfg)
	bonus.ConfigureCashPayoutRuntime(&cfg)

	go func() {
		t := time.NewTicker(12 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				bg := context.Background()
				n, err := bonus.ProcessFreeSpinBogGrants(bg, pool, bog, &cfg, 25)
				if err != nil {
					log.Printf("free spin BO: %v", err)
				} else if n > 0 {
					log.Printf("free spin BO: granted %d", n)
				}
			}
		}
	}()

	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				bg := context.Background()
				n, err := bonus.ProcessBonusOutbox(bg, pool, 80)
				if err != nil {
					log.Printf("bonus outbox: %v", err)
				} else if n > 0 {
					log.Printf("bonus outbox: delivered %d", n)
				}
			}
		}
	}()

	go func() {
		t := time.NewTicker(10 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				n, err := bonus.SweepExpiredForfeits(context.Background(), pool)
				if err != nil {
					log.Printf("bonus expiry sweep: %v", err)
				} else if n > 0 {
					log.Printf("bonus expiry sweep: updated %d instances", n)
				}
			}
		}
	}()

	if cfg.BonusMaxBetViolationsAutoForfeit > 0 {
		th := cfg.BonusMaxBetViolationsAutoForfeit
		go func() {
			t := time.NewTicker(12 * time.Minute)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					bg := context.Background()
					n, err := bonus.SweepMaxBetViolationForfeits(bg, pool, th)
					if err != nil {
						log.Printf("bonus max-bet violation forfeit sweep: %v", err)
					} else if n > 0 {
						log.Printf("bonus max-bet violation forfeit sweep: forfeited %d instances", n)
					}
				}
			}
		}()
	}

	go func() {
		t := time.NewTicker(1 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if err := bonus.ProcessVIPDeliveryTick(context.Background(), pool, time.Now().UTC()); err != nil {
					log.Printf("vip delivery tick: %v", err)
				}
			}
		}
	}()

	go func() {
		t := time.NewTicker(2 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				bg := context.Background()
				if n, err := bonus.ProcessRakebackBoostSettlements(bg, pool, time.Now().UTC(), 600); err != nil {
					log.Printf("rakeback boost settle: %v", err)
				} else if n > 0 {
					log.Printf("rakeback boost settle: %d", n)
				}
			}
		}
	}()

	// PassimPay P6: retry LEDGER_SETTLE_FAILED withdrawals on a tight cadence.
	// These are real-money rows where the provider already shipped funds but our
	// ledger settle didn't post — every minute we lose here is a minute the
	// platform liability sheet disagrees with the on-chain reality.
	go func() {
		t := time.NewTicker(1 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				bg := context.Background()
				if n, err := wallet.ProcessLedgerSettleFailed(bg, pool, &cfg, 25); err != nil {
					log.Printf("passimpay settle retry: %v", err)
				} else if n > 0 {
					log.Printf("passimpay settle retry: recovered %d withdrawals", n)
				}
			}
		}
	}()

	// Sportsbook session expiry sweep: every 5 minutes mark expired-but-still-ACTIVE
	// sportsbook_sessions rows as EXPIRED. The seamless wallet handler already
	// rejects expired tokens at request time so this is not a security gate; it
	// keeps the status column honest for support tooling and dashboards, and it
	// allows the partial UNIQUE on (user_id, provider) WHERE status='ACTIVE' to
	// release entries promptly so a player whose token aged out can immediately
	// request a fresh one from the same browser session.
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				bg := context.Background()
				if n, err := oddin.CleanupExpiredSessions(bg, pool); err != nil {
					log.Printf("oddin session cleanup: %v", err)
				} else if n > 0 {
					log.Printf("oddin session cleanup: expired %d sessions", n)
				}
			}
		}
	}()

	// Affiliate commission accrual + payout sweep. Accrual runs once an hour
	// — overkill for a daily window, but the AccrueDailyCommissions helper
	// is idempotent (UNIQUE on (partner_id, accrual_period, currency)) so
	// re-running is cheap and protects us against missed days when the
	// worker was down. Payout runs alongside but only flips pending grants
	// into 'paid' if an operator has marked them payable upstream — for now
	// it just credits all pending grants for active partners.
	go func() {
		t := time.NewTicker(1 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				bg := context.Background()
				if n, err := affiliate.AccrueDailyCommissions(bg, pool); err != nil {
					log.Printf("affiliate accrue: %v", err)
				} else if n > 0 {
					log.Printf("affiliate accrue: processed %d partners", n)
				}
				if n, err := affiliate.PayPendingGrants(bg, pool, 100); err != nil {
					log.Printf("affiliate payout: %v", err)
				} else if n > 0 {
					log.Printf("affiliate payout: paid %d grants", n)
				}
			}
		}
	}()

	// Financial DLQ processor (E-9). Drains pending rows from
	// financial_failed_jobs every 30s. The handler registry is currently
	// empty — sites that enqueue jobs are expected to also register a
	// matching handler before they ship; until then the worker will park
	// unknown job_types in status='failed' for the operator to inspect.
	finRegistry := finjobs.Registry{}
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				bg := context.Background()
				if n, err := finjobs.ProcessBatch(bg, pool, finRegistry, 50); err != nil {
					log.Printf("finjobs: %v", err)
				} else if n > 0 {
					log.Printf("finjobs: resolved %d jobs", n)
				}
			}
		}
	}()

	// Game round reconciliation (E-7). Runs every hour, looks back 24h for
	// orphan wins / orphan rollbacks, and 7d for stuck bets. Alerts are
	// deduped on (kind, reference_type, reference_id) for 7d so the
	// operator inbox doesn't flood when the same round is unmatched across
	// many sweeps.
	go func() {
		t := time.NewTicker(1 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				bg := context.Background()
				if n, err := reconcile.CheckGameRoundReconciliation(bg, pool, 24); err != nil {
					log.Printf("game round recon: %v", err)
				} else if n > 0 {
					log.Printf("game round recon: %d new alerts", n)
				}
			}
		}
	}()

	go func() {
		t := time.NewTicker(15 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				bg := context.Background()
				if n, err := bonus.ProcessRecentVIPAccruals(bg, pool, 2000); err != nil {
					log.Printf("vip accrual: %v", err)
				} else if n > 0 {
					log.Printf("vip accrual: processed %d ledger rows", n)
				}
				y := time.Now().UTC().Add(-24 * time.Hour)
				if err := bonus.RollupBonusCampaignDay(bg, pool, y); err != nil {
					log.Printf("bonus rollup: %v", err)
				}
				if n, err := bonus.ProcessRebateGrants(bg, pool, time.Now().UTC(), 4000); err != nil {
					log.Printf("rebate grants: %v", err)
				} else if n > 0 {
					log.Printf("rebate grants: %d", n)
				}
				if n, err := bonus.ProcessHuntForRecentPlayers(bg, pool, 800); err != nil {
					log.Printf("hunt milestones: %v", err)
				} else if n > 0 {
					log.Printf("hunt milestones: users processed %d", n)
				}
				if drift, err := bonus.RunVIPLedgerReconciliation(bg, pool); err != nil {
					log.Printf("vip reconcile: %v", err)
				} else if drift > 0 {
					log.Printf("vip reconcile drift detected: %d", drift)
				}
			}
		}
	}()

	log.Println("worker consuming casino:jobs")
	for {
		j, err := jobs.Pop(ctx, rdb)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("pop: %v", err)
			continue
		}
		switch j.Type {
		case "blueocean_event":
			if err := webhooks.ProcessBlueOceanEvent(ctx, pool, j.ID); err != nil {
				log.Printf("blueocean %d: %v", j.ID, err)
			}
		case challenges.JobBODebit:
			var p challenges.BODebitPayload
			if err := json.Unmarshal(j.Data, &p); err != nil {
				log.Printf("challenge_bo_debit: bad payload: %v", err)
				continue
			}
			if err := challenges.ProcessDebit(ctx, pool, &cfg, p); err != nil {
				log.Printf("challenge_bo_debit: %v", err)
			}
		case challenges.JobBOCredit:
			var p challenges.BOCreditPayload
			if err := json.Unmarshal(j.Data, &p); err != nil {
				log.Printf("challenge_bo_credit: bad payload: %v", err)
				continue
			}
			if err := challenges.ProcessCredit(ctx, pool, &cfg, p); err != nil {
				log.Printf("challenge_bo_credit: %v", err)
			}
		case "bonus_payment_settled":
			var ev bonus.PaymentSettled
			if err := json.Unmarshal(j.Data, &ev); err != nil {
				log.Printf("bonus_payment_settled: bad payload: %v", err)
				continue
			}
			if err := bonus.EvaluatePaymentSettled(ctx, pool, ev); err != nil {
				obs.IncBonusEvalError()
				log.Printf("bonus_payment_settled: %v", err)
				payload, _ := json.Marshal(ev)
				_, _ = pool.Exec(ctx, `
					INSERT INTO worker_failed_jobs (job_type, payload, error_text, attempts)
					VALUES ($1, $2::jsonb, $3, 1)
				`, "bonus_payment_settled", payload, err.Error())
			}
		case "compliance_erasure":
			var wrap struct {
				JobID int64 `json:"job_id"`
			}
			_ = json.Unmarshal(j.Data, &wrap)
			if wrap.JobID == 0 {
				log.Printf("compliance_erasure: missing job_id")
				continue
			}
			if err := compliance.ProcessErasureJob(ctx, pool, wrap.JobID); err != nil {
				log.Printf("compliance_erasure %d: %v", wrap.JobID, err)
			}
		default:
			log.Printf("unknown job type %q", j.Type)
			raw, _ := json.Marshal(j)
			_, _ = pool.Exec(ctx, `
				INSERT INTO worker_failed_jobs (job_type, payload, error_text) VALUES ($1, $2::jsonb, $3)
			`, j.Type, raw, "unknown job type")
		}
	}
}
