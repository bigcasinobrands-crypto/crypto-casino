package main

import (
	"context"
	"encoding/json"
	"log"
	"os/signal"
	"syscall"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
	"github.com/crypto-casino/core/internal/jobs"
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
			if err := webhooks.ProcessFystackWebhookDelivery(ctx, pool, wrap.DeliveryID); err != nil {
				log.Printf("fystack webhook delivery %d: %v", wrap.DeliveryID, err)
			}
		default:
			log.Printf("unknown job type %q", j.Type)
		}
	}
}
