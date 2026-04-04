package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/crypto-casino/core/internal/captcha"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
	"github.com/crypto-casino/core/internal/games"
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
			log.Fatalf("redis: %v", errRedis)
		}
		defer rdb.Close()
	}

	jwtStaff := []byte(cfg.JWTSecret)
	jwtPlayer := []byte(cfg.PlayerJWTSecret)
	staffSvc := &staffauth.Service{Pool: pool, Secret: jwtStaff}
	staffH := &staffauth.Handler{Svc: staffSvc}
	mailSender := mail.ChooseSender(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom)
	playerSvc := &playerauth.Service{
		Pool:            pool,
		Secret:          jwtPlayer,
		Mail:            mailSender,
		PublicPlayerURL: cfg.PublicPlayerURL,
		TermsVersion:    cfg.TermsVersion,
		PrivacyVersion:  cfg.PrivacyVersion,
	}
	playerH := &playerauth.Handler{
		Svc:     playerSvc,
		Captcha: &captcha.Turnstile{Secret: cfg.TurnstileSecret},
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(securityHeaders)

	adminCORS := cors.New(cors.Options{
		AllowedOrigins:   cfg.AdminCORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"},
		AllowCredentials: false,
		MaxAge:           300,
	})
	playerCORS := cors.New(cors.Options{
		AllowedOrigins:   cfg.PlayerCORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key"},
		AllowCredentials: false,
		MaxAge:           300,
	})

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	r.Get("/health/ready", readyHandler(pool, rdb))

	r.Post("/v1/webhooks/blueocean", webhooks.HandleBlueOcean(pool, rdb))
	r.Post("/v1/webhooks/fystack", webhooks.HandleFystack(pool, rdb))

	r.Route("/v1/admin", func(r chi.Router) {
		r.Use(adminCORS.Handler)
		r.Use(httprate.LimitByIP(120, time.Minute))
		staffH.Mount(r, jwtStaff)
	})

	r.Route("/v1", func(r chi.Router) {
		r.Use(playerCORS.Handler)
		r.Group(func(r chi.Router) {
			r.Use(httprate.LimitByIP(180, time.Minute))
			r.Get("/games", games.ListHandler(pool))
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
			r.Use(httprate.LimitByIP(180, time.Minute))
			r.Use(playerapi.BearerMiddleware(jwtPlayer))
			r.Post("/games/launch", games.LaunchHandler(games.LaunchBaseFromEnv()))
			r.Get("/wallet/balance", wallet.BalanceHandler(pool))
			r.Post("/wallet/deposit-session", wallet.DepositSessionHandler(pool))
			r.Post("/wallet/withdraw", wallet.WithdrawHandler(pool))
		})
	})

	addr := ":" + strings.TrimPrefix(cfg.Port, ":")
	srv := &http.Server{Addr: addr, Handler: r}

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

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}
