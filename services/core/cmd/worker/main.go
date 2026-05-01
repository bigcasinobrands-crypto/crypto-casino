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
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/jobs"
	"github.com/crypto-casino/core/internal/market"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/crypto-casino/core/internal/redisx"
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
	var fsClient *fystack.Client
	if cfg.FystackConfigured() {
		fsClient = fystack.NewClient(cfg.FystackBaseURL, cfg.FystackAPIKey, cfg.FystackAPISecret, cfg.FystackWorkspaceID)
	}
	cmcTickers := market.NewCryptoTickers(cfg.CoinMarketCapAPIKey)
	bonus.ConfigureCashPayoutRuntime(&cfg, fsClient, cmcTickers)

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
		t := time.NewTicker(3 * time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				n, err := webhooks.ReconcileStaleFystackDeliveries(context.Background(), pool)
				if err != nil {
					log.Printf("fystack reconcile: %v", err)
				} else if n > 0 {
					log.Printf("fystack reconcile: processed %d deliveries", n)
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
		case "fystack_payment":
			var m map[string]string
			_ = json.Unmarshal(j.Data, &m)
			if err := webhooks.ProcessFystackPayment(ctx, pool, m["id"]); err != nil {
				log.Printf("fystack %s: %v", m["id"], err)
			}
		case "fystack_webhook":
			var wrap struct {
				DeliveryID int64 `json:"delivery_id"`
			}
			_ = json.Unmarshal(j.Data, &wrap)
			if wrap.DeliveryID == 0 {
				log.Printf("fystack_webhook: missing delivery_id")
				continue
			}
			settled, err := webhooks.ProcessFystackWebhookDelivery(ctx, pool, wrap.DeliveryID)
			if err != nil {
				log.Printf("fystack webhook delivery %d: %v", wrap.DeliveryID, err)
			} else if settled != nil {
				rawBonus, _ := json.Marshal(settled)
				if err := jobs.Enqueue(ctx, rdb, jobs.Job{Type: "bonus_payment_settled", Data: rawBonus}); err != nil {
					if evErr := bonus.EvaluatePaymentSettled(ctx, pool, *settled); evErr != nil {
						obs.IncBonusEvalError()
						_, _ = pool.Exec(ctx, `
							INSERT INTO worker_failed_jobs (job_type, payload, error_text, attempts)
							VALUES ($1, $2::jsonb, $3, 1)
						`, "bonus_payment_settled", rawBonus, evErr.Error())
					}
				}
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
