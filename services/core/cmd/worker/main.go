package main

import (
	"context"
	"encoding/json"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
	"github.com/crypto-casino/core/internal/jobs"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/crypto-casino/core/internal/redisx"
	"github.com/crypto-casino/core/internal/webhooks"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
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
		default:
			log.Printf("unknown job type %q", j.Type)
			raw, _ := json.Marshal(j)
			_, _ = pool.Exec(ctx, `
				INSERT INTO worker_failed_jobs (job_type, payload, error_text) VALUES ($1, $2::jsonb, $3)
			`, j.Type, raw, "unknown job type")
		}
	}
}
