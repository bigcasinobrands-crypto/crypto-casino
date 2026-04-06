package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/crypto-casino/core/internal/adminops"
	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/captcha"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
	"github.com/crypto-casino/core/internal/fystack"
	"github.com/crypto-casino/core/internal/games"
	"github.com/crypto-casino/core/internal/market"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/crypto-casino/core/internal/playerauth"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/redisx"
	"github.com/crypto-casino/core/internal/staffauth"
	"github.com/crypto-casino/core/internal/wallet"
	"github.com/crypto-casino/core/internal/webhooks"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	ctx := context.Background()
	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		log.Fatalf("migrations: %v", err)
	}
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db pool: %v", err)
	}
	defer pool.Close()

	var rdb *redis.Client
	if cfg.RedisURL != "" {
		var errRedis error
		rdb, errRedis = redisx.New(cfg.RedisURL)
		if errRedis != nil {
			log.Printf("warning: redis unavailable (%v); continuing without Redis (webhooks process inline; start redis or run docker compose up -d)", errRedis)
			rdb = nil
		} else {
			defer rdb.Close()
		}
	}

	jwtStaff := []byte(cfg.JWTSecret)
	jwtPlayer := []byte(cfg.PlayerJWTSecret)
	staffSvc := &staffauth.Service{Pool: pool, Secret: jwtStaff}
	bog := blueocean.NewClient(&cfg)
	gameSrv := games.NewServer(pool, bog, &cfg)
	cmcTickers := market.NewCryptoTickers(cfg.CoinMarketCapAPIKey)

	mailSender := mail.ChooseSender(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom)
	var fsClient *fystack.Client
	if cfg.FystackConfigured() {
		fsClient = fystack.NewClient(cfg.FystackBaseURL, cfg.FystackAPIKey, cfg.FystackAPISecret, cfg.FystackWorkspaceID)
		log.Printf("fystack: connected to %s (workspace %s)", cfg.FystackBaseURL, cfg.FystackWorkspaceID)
	} else {
		log.Printf("WARNING: Fystack not configured — deposit addresses, wallet provisioning, and withdrawals are disabled. Set FYSTACK_BASE_URL, FYSTACK_API_KEY, FYSTACK_API_SECRET, and FYSTACK_WORKSPACE_ID in .env")
	}
	if cfg.FystackDepositAssetID == "" && len(cfg.FystackDepositAssets) == 0 {
		log.Printf("WARNING: No deposit assets configured — set FYSTACK_DEPOSIT_ASSET_ID or FYSTACK_DEPOSIT_ASSETS_JSON in .env")
	}
	adminH := &adminops.Handler{Pool: pool, BOG: bog, Cfg: &cfg, Redis: rdb, Fystack: fsClient}
	staffH := &staffauth.Handler{Svc: staffSvc, Ops: adminH}
	playerSvc := &playerauth.Service{
		Pool:            pool,
		Secret:          jwtPlayer,
		Mail:            mailSender,
		PublicPlayerURL: cfg.PublicPlayerURL,
		TermsVersion:    cfg.TermsVersion,
		PrivacyVersion:  cfg.PrivacyVersion,
	}
	if fsClient != nil {
		playerSvc.Fystack = &fystack.WalletProvisioner{Pool: pool, Client: fsClient}
	}
	playerH := &playerauth.Handler{
		Svc:     playerSvc,
		Captcha: &captcha.Turnstile{Secret: cfg.TurnstileSecret},
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(echoRequestIDHeader)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(securityHeaders)

	adminCORS := cors.New(cors.Options{
		AllowedOrigins:   cfg.AdminCORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"},
		AllowCredentials: false,
		MaxAge:           300,
	})
	playerCORS := cors.New(cors.Options{
		AllowedOrigins:   cfg.PlayerCORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key", "X-Geo-Country"},
		AllowCredentials: false,
		MaxAge:           300,
	})

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	r.Get("/health/ready", readyHandler(pool, rdb))
	r.Get("/health/operational", operationalHandler(pool, &cfg, bog))

	// BOG-registered seamless wallet path (proxy to same handler as needed in prod).
	r.Get("/api/blueocean/callback", webhooks.HandleBlueOceanWallet(pool, &cfg))

	r.Post("/v1/webhooks/blueocean", webhooks.HandleBlueOcean(pool, rdb))
	fystackHMAC := strings.TrimSpace(os.Getenv("WEBHOOK_FYSTACK_SECRET"))
	r.Post("/v1/webhooks/fystack", webhooks.HandleFystackWebhook(pool, rdb, fsClient, fystackHMAC, cfg.FystackWebhookVerificationKey))
	r.Post("/v1/webhooks/fystack/workspace", webhooks.HandleFystackWebhook(pool, rdb, fsClient, fystackHMAC, cfg.FystackWebhookVerificationKey))

	r.Route("/v1/admin", func(r chi.Router) {
		r.Use(adminCORS.Handler)
		r.Use(httprate.LimitByIP(120, time.Minute))
		staffH.Mount(r, jwtStaff)
	})

	r.Route("/v1", func(r chi.Router) {
		r.Use(playerCORS.Handler)
		r.Group(func(r chi.Router) {
			r.Use(httprate.LimitByIP(180, time.Minute))
			r.Get("/games", gameSrv.ListHandler())
			r.Get("/market/crypto-tickers", cmcTickers.ServeHTTP)
			r.Get("/market/crypto-logo-urls", market.CryptoLogoURLsHandler(&cfg))
		})
		r.Route("/auth", func(r chi.Router) {
			r.Use(httprate.LimitByIP(40, time.Minute))
			r.Post("/register", playerH.Register)
			r.Post("/login", playerH.Login)
			r.Post("/refresh", playerH.Refresh)
			r.Post("/logout", playerH.Logout)
			r.Post("/verify-email", playerH.VerifyEmail)
			r.Post("/forgot-password", playerH.ForgotPassword)
			r.Post("/reset-password", playerH.ResetPassword)
			r.Group(func(r chi.Router) {
				r.Use(playerapi.BearerMiddleware(jwtPlayer))
				r.Get("/me", playerH.Me)
				r.Post("/verify-email/resend", playerH.ResendVerification)
			})
		})
		r.Group(func(r chi.Router) {
			r.Use(playerCORS.Handler)
			r.Use(httprate.LimitByIP(180, time.Minute))
			r.Use(playerapi.BearerMiddleware(jwtPlayer))
			r.Post("/games/launch", func(w http.ResponseWriter, r *http.Request) {
				httprate.LimitByIP(45, time.Minute)(http.HandlerFunc(gameSrv.LaunchHandler())).ServeHTTP(w, r)
			})
			r.Get("/games/{gameID}/blueocean-info", gameSrv.BlueOceanGameInfoHandler())
			r.Get("/wallet/balance", wallet.BalanceHandler(pool))
			r.Get("/wallet/balance/stream", wallet.BalanceStreamHandler(pool))
			r.Get("/wallet/transactions", wallet.TransactionsHandler(pool))
			r.Get("/wallet/withdrawals/{id}", wallet.WithdrawalGetHandler(pool))
			r.Post("/wallet/withdraw", wallet.WithdrawHandler(pool, &cfg, fsClient, cmcTickers))
			r.Group(func(r chi.Router) {
				r.Use(httprate.LimitByIP(60, time.Minute))
				r.Get("/wallet/deposit-address", wallet.DepositAddressHandler(pool, &cfg, fsClient))
				r.Post("/wallet/deposit-session", wallet.DepositSessionHandler(pool, &cfg, fsClient))
			})
		})
	})

	addr := ":" + strings.TrimPrefix(cfg.Port, ":")
	srv := &http.Server{Addr: addr, Handler: r}

	go runAdminClientLogPurgeLoop(context.Background(), pool)

	go func() {
		log.Printf("api listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

func operationalHandler(pool *pgxpool.Pool, cfg *config.Config, bog *blueocean.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		lobbyVisible := `hidden = false AND NOT EXISTS (
			SELECT 1 FROM provider_lobby_settings pls
			WHERE pls.provider = games.provider AND pls.lobby_hidden = true
		)`
		var visible, blueoceanVisible int64
		_ = pool.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM games WHERE `+lobbyVisible).Scan(&visible)
		_ = pool.QueryRow(ctx, `
			SELECT COUNT(*)::bigint FROM games
			WHERE `+lobbyVisible+` AND LOWER(TRIM(COALESCE(provider,''))) = 'blueocean'
		`).Scan(&blueoceanVisible)

		var lastSync sql.NullTime
		var lastUpserted sql.NullInt64
		var lastSyncErr sql.NullString
		_ = pool.QueryRow(ctx, `
			SELECT last_sync_at, last_sync_upserted, last_sync_error
			FROM blueocean_integration_state WHERE id = 1
		`).Scan(&lastSync, &lastUpserted, &lastSyncErr)

		syncOK := !lastSyncErr.Valid || strings.TrimSpace(lastSyncErr.String) == ""

		out := map[string]any{
			"maintenance_mode":             cfg.MaintenanceMode,
			"disable_game_launch":          cfg.DisableGameLaunch,
			"blueocean_configured":         bog != nil && bog.Configured(),
			"visible_games_count":          visible,
			"blueocean_visible_games_count": blueoceanVisible,
			"catalog_sync_ok":              syncOK,
			"last_catalog_sync_at":         nil,
		}
		if lastSync.Valid {
			out["last_catalog_sync_at"] = lastSync.Time.UTC().Format(time.RFC3339)
		}
		if lastUpserted.Valid {
			out["last_catalog_upserted"] = lastUpserted.Int64
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	}
}

func readyHandler(pool *pgxpool.Pool, rdb *redis.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			readyFail(w, "db", err.Error())
			return
		}
		if rdb != nil {
			if err := rdb.Ping(ctx).Err(); err != nil {
				readyFail(w, "redis", err.Error())
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready", "db": "ok", "redis": redisStatus(rdb)})
	}
}

func redisStatus(rdb *redis.Client) string {
	if rdb == nil {
		return "skipped"
	}
	return "ok"
}

func readyFail(w http.ResponseWriter, component, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusServiceUnavailable)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", component: msg})
}

// runAdminClientLogPurgeLoop removes admin_client_logs older than 90 days once per day.
// echoRequestIDHeader exposes the request ID on the response for client diagnostics.
func echoRequestIDHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := middleware.GetReqID(r.Context()); id != "" {
			w.Header().Set(middleware.RequestIDHeader, id)
		}
		next.ServeHTTP(w, r)
	})
}

func runAdminClientLogPurgeLoop(ctx context.Context, pool *pgxpool.Pool) {
	go func() {
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		run := func() {
			n, err := adminops.PurgeAdminClientLogs(ctx, pool)
			if err != nil {
				log.Printf("admin_client_logs purge: %v", err)
				return
			}
			if n > 0 {
				log.Printf("admin_client_logs purge: removed %d rows", n)
			}
		}
		run()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				run()
			}
		}
	}()
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}
