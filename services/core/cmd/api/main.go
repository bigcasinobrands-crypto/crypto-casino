package main

import (
	"context"
	"crypto/rsa"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/crypto-casino/core/internal/adminapi"
	"github.com/crypto-casino/core/internal/adminops"
	"github.com/crypto-casino/core/internal/blueocean"
	"github.com/crypto-casino/core/internal/bonus"
	"github.com/crypto-casino/core/internal/captcha"
	"github.com/crypto-casino/core/internal/challenges"
	"github.com/crypto-casino/core/internal/chat"
	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/db"
	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/games"
	"github.com/crypto-casino/core/internal/jtiredis"
	"github.com/crypto-casino/core/internal/jwtissuer"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/crypto-casino/core/internal/market"
	"github.com/crypto-casino/core/internal/obs"
	"github.com/crypto-casino/core/internal/oddin"
	"github.com/crypto-casino/core/internal/pii"
	"github.com/crypto-casino/core/internal/paymentflags"
	"github.com/crypto-casino/core/internal/playerapi"
	"github.com/crypto-casino/core/internal/playerauth"
	"github.com/crypto-casino/core/internal/playercookies"
	"github.com/crypto-casino/core/internal/pwnedpasswords"
	"github.com/crypto-casino/core/internal/redisx"
	"github.com/crypto-casino/core/internal/securityheaders"
	"github.com/crypto-casino/core/internal/staffauth"
	"github.com/crypto-casino/core/internal/wallet"
	"github.com/crypto-casino/core/internal/webhooks"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func main() {
	fmt.Fprintf(os.Stderr, "crypto-casino core api: starting\n")
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL config load: %v\n", err)
		log.Fatalf("config: %v", err)
	}
	log.Printf("startup: APP_ENV=%q PORT=%q", cfg.AppEnv, cfg.Port)
	log.Printf("startup: fingerprint player auth effective=%v (REQUIRE_FINGERPRINT_PLAYER_AUTH) withdraw_fp=%v (WITHDRAW_REQUIRE_FINGERPRINT) — set DISABLE_FINGERPRINT_PLAYER_AUTH=1 to force both off",
		cfg.RequireFingerprintPlayerAuth, cfg.WithdrawRequireFingerprint)
	if err := cfg.ValidateProduction(); err != nil {
		fmt.Fprintf(os.Stderr, "FATAL production validation: %v\n", err)
		log.Fatalf("config: %v", err)
	}
	if cfg.AppEnv == "production" && strings.TrimSpace(os.Getenv("WEBHOOK_BLUEOCEAN_SECRET")) == "" && cfg.AllowProductionMissingBlueOceanWebhookSecret {
		log.Printf("WARNING: WEBHOOK_BLUEOCEAN_SECRET unset with ALLOW_PRODUCTION_MISSING_BLUEOCEAN_WEBHOOK_SECRET — POST /v1/webhooks/blueocean returns 401 until you configure the secret on Render and in BlueOcean")
	}
	obs.InitLogging(cfg.LogFormat)
	if cfg.VaultAddress != "" && cfg.VaultToken != "" && cfg.VaultTransitKeyName != "" {
		pii.SetDefaultTransit(pii.NewTransit(cfg.VaultAddress, cfg.VaultToken, cfg.VaultTransitMount, cfg.VaultTransitKeyName))
		log.Printf("vault: transit configured (mount=%s key=%s)", cfg.VaultTransitMount, cfg.VaultTransitKeyName)
	}
	ctx := context.Background()
	skipRaw := strings.TrimSpace(os.Getenv("SKIP_DB_MIGRATIONS_ON_START"))
	skipMig := skipRaw == "1" || strings.EqualFold(skipRaw, "true")
	if skipMig {
		log.Printf("WARNING: SKIP_DB_MIGRATIONS_ON_START set — migrations skipped (run npm run migrate:core or ./migrate separately)")
	} else {
		if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
			fmt.Fprintf(os.Stderr, "FATAL migrations: %v\n", err)
			log.Fatalf("migrations: %v", err)
		}
	}
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL db pool: %v\n", err)
		log.Fatalf("db pool: %v", err)
	}
	defer pool.Close()

	if err := db.ValidateCoreAuthSchema(ctx, pool); err != nil {
		fmt.Fprintf(os.Stderr, "FATAL database schema: %v\n", err)
		log.Fatalf("database schema: %v", err)
	}
	if err := validateDurabilityReadiness(ctx, pool, &cfg, skipMig); err != nil {
		fmt.Fprintf(os.Stderr, "FATAL durability readiness: %v\n", err)
		log.Fatalf("durability readiness: %v", err)
	}

	if cfg.BlueOceanCatalogSnapshotOnStartup && strings.TrimSpace(cfg.BlueOceanCatalogSnapshotPath) != "" {
		n, snapErr := blueocean.SyncCatalog(ctx, pool, nil, &cfg)
		if snapErr != nil {
			log.Printf("blueocean: catalog snapshot on startup failed: %v", snapErr)
		} else {
			log.Printf("blueocean: catalog snapshot on startup upserted %d row(s)", n)
		}
	}

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

	var jtiRev *jtiredis.Revoker
	if rdb != nil {
		jtiRev = &jtiredis.Revoker{Rdb: rdb}
	}

	var rsaKeyErr error
	var rsaKey *rsa.PrivateKey
	if p := strings.TrimSpace(cfg.JWTRSAKeyFile); p != "" {
		rsaKey, rsaKeyErr = jwtissuer.LoadRSAPrivateKeyFromFile(p)
		if rsaKeyErr != nil {
			fmt.Fprintf(os.Stderr, "FATAL jwt rsa key: %v\n", rsaKeyErr)
			log.Fatalf("jwt rsa key: %v", rsaKeyErr)
		}
	}
	jwtIss := &jwtissuer.Issuer{
		PlayerHMAC:     []byte(cfg.PlayerJWTSecret),
		StaffHMAC:      []byte(cfg.JWTSecret),
		RSAKey:         rsaKey,
		Issuer:         cfg.JWTIssuer,
		PlayerAudience: cfg.JWTPlayerAudience,
		StaffAudience:  cfg.JWTStaffAudience,
	}
	staffSvc := &staffauth.Service{Pool: pool, Issuer: jwtIss, JTI: jtiRev, Redis: rdb}
	var wa *webauthn.WebAuthn
	if cfg.WebAuthnRPID != "" && len(cfg.WebAuthnRPOrigins) > 0 {
		wac, err := webauthn.New(&webauthn.Config{
			RPDisplayName: cfg.WebAuthnRPDisplayName,
			RPID:          cfg.WebAuthnRPID,
			RPOrigins:     cfg.WebAuthnRPOrigins,
		})
		if err != nil {
			log.Fatalf("webauthn: %v", err)
		}
		wa = wac
		log.Printf("webauthn: RP ID %q (%d origins)", cfg.WebAuthnRPID, len(cfg.WebAuthnRPOrigins))
	}
	bog := blueocean.NewClient(&cfg)
	if bog != nil && bog.Configured() {
		log.Printf("blueocean: XAPI client enabled (api_login set; password length=%d)", len(cfg.BlueOceanAPIPassword))
		if strings.TrimSpace(cfg.BlueOceanAgentID) == "" {
			log.Printf("WARNING: BLUEOCEAN_AGENT_ID is empty — many Blue Ocean sandboxes require agentid/associateid; game launches may fail")
		}
		if cfg.BlueOceanUserIDNoHyphens {
			log.Printf("blueocean: XAPI userid format: compact UUID (no hyphens) — unset BLUEOCEAN_USERID_NO_HYPHENS or set true")
		} else {
			log.Printf("blueocean: XAPI userid format: canonical UUID with hyphens (BLUEOCEAN_USERID_NO_HYPHENS=false)")
		}
	} else if strings.TrimSpace(cfg.BlueOceanAPIBaseURL) != "" || strings.TrimSpace(cfg.BlueOceanAPILogin) != "" {
		log.Printf("WARNING: Blue Ocean XAPI incomplete — set BLUEOCEAN_API_BASE_URL, BLUEOCEAN_API_LOGIN, and BLUEOCEAN_API_PASSWORD (Api Access password, not Backoffice)")
	}
	gameSrv := games.NewServer(pool, bog, &cfg)
	cmcTickers := market.NewCryptoTickers(cfg.CoinMarketCapAPIKey)

	mailSender := mail.ChooseSender(cfg.SMTPHost, cfg.SMTPPort, cfg.SMTPUser, cfg.SMTPPassword, cfg.SMTPFrom)
	if cfg.UsesPassimpay() {
		log.Printf("payments: PassimPay rail active")
	} else {
		log.Printf("WARNING: PAYMENT_PROVIDER=%q — wallet deposits/withdrawals expect passimpay", strings.TrimSpace(cfg.PaymentProvider))
	}
	var fpClient *fingerprint.Client
	if cfg.FingerprintConfigured() {
		fpClient = fingerprint.NewClient(cfg.FingerprintAPIBaseURL, cfg.FingerprintSecretAPIKey)
		log.Printf("fingerprint: Server API configured (base=%s)", cfg.FingerprintAPIBaseURL)
	} else {
		log.Printf("fingerprint: FINGERPRINT_SECRET_API_KEY not set — withdrawal ledger metadata will omit Server API enrichment")
	}
	bonus.ConfigureCashPayoutRuntime(&cfg)
	chatHub := chat.NewHub(pool)
	go chatHub.Run()

	adminH := &adminops.Handler{Pool: pool, BOG: bog, Cfg: &cfg, Redis: rdb, Fingerprint: fpClient, ChatHub: chatHub}
	oddinH := &oddin.Handler{Pool: pool, Cfg: &cfg}
	oddinOp := &oddin.OperatorHandler{Pool: pool, Cfg: &cfg}
	staffH := &staffauth.Handler{Svc: staffSvc, Ops: adminH, WA: wa}
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "data"
	}
	if abs, err := filepath.Abs(dataDir); err == nil {
		dataDir = abs
	}
	log.Printf("DATA_DIR: %s", dataDir)
	playerSvc := &playerauth.Service{
		Pool:              pool,
		Issuer:            jwtIss,
		JTI:               jtiRev,
		Mail:              mailSender,
		PublicPlayerURL:   cfg.PublicPlayerURL,
		TermsVersion:      cfg.TermsVersion,
		PrivacyVersion:    cfg.PrivacyVersion,
		DataDir:           dataDir,
		EmailLookupSecret: cfg.PIIEmailLookupSecret,
		Fingerprint:       fpClient,
		Cfg:               &cfg,
	}
	if cfg.HIBPCheckPasswords {
		playerSvc.Pwned = pwnedpasswords.NewChecker()
		log.Printf("hibp: rejecting passwords found in Have I Been Pwned corpus (k-anonymity API; fails open on API errors)")
	}
	playerH := &playerauth.Handler{
		Svc:       playerSvc,
		Captcha:   &captcha.Turnstile{Secret: cfg.TurnstileSecret},
		CookieCfg: &cfg,
	}

	playerAccessCookie := ""
	if cfg.PlayerCookieAuth {
		playerAccessCookie = playercookies.AccessCookieName
	}

	adminCORS := cors.New(cors.Options{
		AllowedOrigins:   cfg.AdminCORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key", "X-WebAuthn-Session-Key", "X-MFA-Token"},
		AllowCredentials: false,
		MaxAge:           300,
	})
	playerCORS := cors.New(cors.Options{
		AllowedOrigins:   cfg.PlayerCORSOrigins,
		AllowedMethods:   []string{"GET", "POST", "PATCH", "OPTIONS", "PUT", "DELETE"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID", "Idempotency-Key", "X-Geo-Country", "X-CSRF-Token"},
		AllowCredentials: cfg.PlayerCookieAuth,
		MaxAge:           300,
	})

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(echoRequestIDHeader)
	r.Use(middleware.RealIP)
	if strings.ToLower(strings.TrimSpace(cfg.LogFormat)) == "json" {
		r.Use(obs.ChiLogger)
	} else {
		r.Use(middleware.Logger)
	}
	r.Use(middleware.Recoverer)
	r.Use(securityheaders.Middleware(&cfg))

	// Long-lived connections (WebSocket, SSE) bypass the 60s Timeout middleware.
	r.Group(func(r chi.Router) {
		r.Use(playerCORS.Handler)
		r.Get("/v1/chat/ws", chat.HandleWebSocket(chatHub, pool, jwtIss, jtiRev, rdb))
	})

	// Staff admin API must not use the global 60s chi Timeout — Blue Ocean catalog sync (getGameList)
	// routinely exceeds that; middleware.Timeout also attaches a 60s deadline to r.Context().
	r.Route("/v1/admin", func(r chi.Router) {
		r.Use(adminCORS.Handler)
		if len(cfg.AdminIPAllowlist) > 0 {
			r.Use(adminapi.IPAllowlistMiddleware(cfg.AdminIPAllowlist))
		}
		r.Use(httprate.LimitByIP(120, time.Minute))
		staffH.Mount(r, jwtIss, jtiRev)
	})

	// All other routes get a 60s context deadline.
	r.Group(func(r chi.Router) {
		r.Use(middleware.Timeout(60 * time.Second))
		// Player SPA calls GET /health/operational cross-origin; without this, only /v1/* had CORS and the browser shows CORS errors while /v1/games succeeds.
		r.Use(playerCORS.Handler)

		// Browsers often open the service root; the API has no SPA here — avoid a bare chi 404.
		r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{
				"service": "core-api",
				"health":  "/health",
			})
		})
		r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		})
		r.Get("/.well-known/jwks.json", func(w http.ResponseWriter, _ *http.Request) {
			b, err := jwtIss.JWKSJSON()
			if err != nil {
				http.Error(w, "jwks error", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(b)
		})
		r.Get("/health/ready", readyHandler(pool, rdb))
		r.Get("/health/operational", operationalHandler(pool, &cfg, bog))

		r.Get("/api/blueocean/callback", webhooks.HandleBlueOceanWallet(pool, &cfg, rdb))

		r.Post("/v1/webhooks/blueocean", webhooks.HandleBlueOcean(pool, rdb))
		if cfg.UsesPassimpay() {
			r.Post("/v1/webhooks/passimpay", webhooks.HandlePassimpayWebhook(pool, &cfg, rdb))
		}

		// Oddin operator wallet (S2S): canonical routes are POST /v1/oddin/*. Oddin often configures
		// callback base as API origin + /userDetails (no /v1/oddin prefix) — alias root paths to avoid 404.
		// Register with and without trailing slash: some dashboards append "/" and chi otherwise returns 404.
		r.Group(func(r chi.Router) {
			r.Use(oddin.OperatorSecurityMiddleware(&cfg))
			r.Post("/userDetails", oddinOp.UserDetails)
			r.Post("/userDetails/", oddinOp.UserDetails)
			r.Post("/debitUser", oddinOp.DebitUser)
			r.Post("/debitUser/", oddinOp.DebitUser)
			r.Post("/creditUser", oddinOp.CreditUser)
			r.Post("/creditUser/", oddinOp.CreditUser)
			r.Post("/rollbackUser", oddinOp.RollbackUser)
			r.Post("/rollbackUser/", oddinOp.RollbackUser)
		})

		r.Route("/v1", func(r chi.Router) {
			r.Use(playerCORS.Handler)
			r.Use(playerapi.PlayerCookieCSRFMiddleware(&cfg))
			r.Group(func(r chi.Router) {
				r.Use(httprate.LimitByIP(120, time.Minute))
				adminH.MountPublicRoutes(r)
				challenges.MountPlayer(r, pool, jwtIss, jtiRev, cfg.BlueOceanImageBaseURL, playerAccessCookie)
				r.With(httprate.LimitByIP(180, time.Minute), playerapi.OptionalBearerMiddleware(jwtIss, jtiRev, playerAccessCookie)).
					Post("/analytics/session", adminH.IngestTrafficSession)
				r.With(httprate.LimitByIP(120, time.Minute), playerapi.OptionalBearerMiddleware(jwtIss, jtiRev, playerAccessCookie)).
					Post("/sportsbook/oddin/client-event", oddinH.ClientEvent)
				r.Get("/vip/program", wallet.VIPProgramHandler(pool))
				r.Get("/uploads/*", adminH.ServeUploadedContent)
			})
			r.Group(func(r chi.Router) {
				r.Use(httprate.LimitByIP(180, time.Minute))
				r.Get("/games", gameSrv.ListHandler())
				r.Get("/sportsbook/context", gameSrv.SportsbookContextHandler())
				r.Get("/sportsbook/oddin/public-config", oddinH.PublicConfig)
				r.Get("/sportsbook/oddin/esports-nav", oddinH.EsportsNav)
				r.Get("/market/crypto-tickers", cmcTickers.ServeHTTP)
				r.Get("/market/crypto-logo-urls", market.CryptoLogoURLsHandler(&cfg))
				avatarRoot := filepath.Join(dataDir, "avatars")
				_ = os.MkdirAll(avatarRoot, 0o755) // #nosec G703 -- trusted DATA_DIR from env; avatar paths validated in handler
				r.Get("/avatars/*", playerauth.AvatarGatewayHandler(pool, avatarRoot))
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
					r.Use(playerapi.BearerMiddleware(jwtIss, jtiRev, playerAccessCookie))
					r.Get("/me", playerH.Me)
					r.Patch("/profile", playerH.UpdateProfile)
					r.Post("/profile/avatar", playerH.UploadAvatar)
					r.Post("/profile/change-password", playerH.ChangePassword)
					r.Get("/profile/preferences", playerH.GetPreferences)
					r.Patch("/profile/preferences", playerH.UpdatePreferences)
					r.Post("/profile/redeem-promo", playerH.RedeemPromo)
					r.Post("/verify-email/resend", playerH.ResendVerification)
					r.Get("/sessions", playerH.ListSessions)
					r.Delete("/sessions/{sessionID}", playerH.RevokeSession)
				})
			})
			r.Group(func(r chi.Router) {
				r.Use(httprate.LimitByIP(180, time.Minute))
				r.Use(playerapi.BearerMiddleware(jwtIss, jtiRev, playerAccessCookie))
				r.Post("/games/launch", func(w http.ResponseWriter, r *http.Request) {
					httprate.LimitByIP(45, time.Minute)(http.HandlerFunc(gameSrv.LaunchHandler())).ServeHTTP(w, r)
				})
				r.Post("/sportsbook/launch", func(w http.ResponseWriter, r *http.Request) {
					httprate.LimitByIP(45, time.Minute)(http.HandlerFunc(gameSrv.SportsbookLaunchHandler())).ServeHTTP(w, r)
				})
				r.Get("/games/{gameID}/blueocean-info", gameSrv.BlueOceanGameInfoHandler())
				r.Get("/wallet/balance", wallet.BalanceHandler(pool))
				r.Get("/wallet/balances", wallet.BalancesHandler(pool))
				r.Get("/wallet/balance/stream", wallet.BalanceStreamHandler(pool))
				r.Get("/wallet/wagering/stream", wallet.WageringStreamHandler(pool))
				r.Get("/wallet/bonuses", wallet.BonusesHandler(pool))
				r.With(httprate.LimitByIP(20, time.Minute)).Post("/wallet/bonuses/{bonusID}/forfeit", wallet.PlayerBonusForfeitHandler(pool))
				r.With(httprate.LimitByIP(30, time.Minute)).Get("/bonuses/available", wallet.AvailableBonusesHandler(pool))
				r.With(httprate.LimitByIP(40, time.Minute)).Post("/bonuses/deposit-intent", wallet.DepositBonusIntentHandler(pool))
				r.With(httprate.LimitByIP(40, time.Minute)).Post("/bonuses/cancel-deposit-intent", wallet.CancelDepositIntentHandler(pool))
				r.With(httprate.LimitByIP(40, time.Minute)).Post("/bonuses/claim-offer", wallet.ClaimOfferHandler(pool))
				r.With(httprate.LimitByIP(40, time.Minute)).Post("/bonuses/redeem", playerH.RedeemPromo)
				r.Get("/vip/status", wallet.VIPStatusHandler(pool))
				r.With(httprate.LimitByIP(40, time.Minute)).Post("/vip/rakeback-boost/claim", wallet.VIPRakebackBoostClaimHandler(pool))
				r.Get("/rewards/hub", wallet.RewardsHubHandler(pool))
				r.Get("/rewards/calendar", wallet.RewardsCalendarHandler(pool))
				r.With(httprate.LimitByIP(40, time.Minute)).Post("/rewards/daily/claim", wallet.RewardsDailyClaimHandler(pool))
				r.With(httprate.LimitByIP(40, time.Minute)).Post("/rewards/rakeback/claim", wallet.RewardsRakebackClaimHandler(pool))
				r.Get("/notifications", wallet.NotificationsHandler(pool))
				r.Post("/notifications/read", wallet.PatchNotificationReadHandler(pool))
				r.Get("/wallet/transactions", wallet.TransactionsHandler(pool))
				r.Get("/wallet/game-history", wallet.GameHistoryHandler(pool))
				r.Get("/wallet/stats", wallet.PlayerStatsHandler(pool))
				r.Get("/wallet/withdrawals/{id}", wallet.WithdrawalGetHandler(pool))
				// Per-user rate limit (5 attempts / 10 min) prevents a single user from
				// hammering the withdraw endpoint regardless of IP rotation. The IP-based
				// limit on the surrounding group still throttles bursts from any one IP.
				r.With(playerapi.LimitByUserID(5, 10*time.Minute)).
					Post("/wallet/withdraw", wallet.WithdrawHandler(pool, &cfg, cmcTickers, fpClient))
				r.With(httprate.LimitByIP(30, time.Minute)).Post("/sportsbook/oddin/session-token", oddinH.SessionToken)
				r.Group(func(r chi.Router) {
					r.Use(httprate.LimitByIP(60, time.Minute))
					r.Get("/wallet/payment-currencies", wallet.PaymentCurrenciesHandler(pool, &cfg))
					// Per-user limit (10 deposit-address fetches / hour) on top of the
					// IP-based limit, to prevent a single user from sweeping the address
					// generator endlessly even from changing IPs.
					r.With(playerapi.LimitByUserID(10, time.Hour)).
						Get("/wallet/deposit-address", wallet.DepositAddressHandler(pool, &cfg))
					r.Post("/wallet/deposit-session", wallet.DepositSessionHandler(pool, &cfg))
				})
			})
			r.Group(func(r chi.Router) {
				r.Use(playerapi.BearerMiddleware(jwtIss, jtiRev, playerAccessCookie))
				r.Get("/chat/history", chat.HandleHistory(pool))
				if rdb != nil {
					r.With(httprate.LimitByIP(60, time.Minute)).Post("/chat/ws-ticket", chat.IssueWSTicketHandler(rdb))
				}
			})
			r.Route("/oddin", func(r chi.Router) {
				r.Use(oddin.OperatorSecurityMiddleware(&cfg))
				r.Post("/userDetails", oddinOp.UserDetails)
				r.Post("/userDetails/", oddinOp.UserDetails)
				r.Post("/debitUser", oddinOp.DebitUser)
				r.Post("/debitUser/", oddinOp.DebitUser)
				r.Post("/creditUser", oddinOp.CreditUser)
				r.Post("/creditUser/", oddinOp.CreditUser)
				r.Post("/rollbackUser", oddinOp.RollbackUser)
				r.Post("/rollbackUser/", oddinOp.RollbackUser)
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

func validateDurabilityReadiness(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, skipMigrations bool) error {
	isProd := strings.EqualFold(strings.TrimSpace(cfg.AppEnv), "production")
	if isProd && skipMigrations {
		return fmt.Errorf("SKIP_DB_MIGRATIONS_ON_START cannot be enabled in production")
	}

	requiredTables := []string{
		"users",
		"staff_users",
		"site_content",
		"site_settings",
		"cms_uploaded_assets",
	}
	for _, tableName := range requiredTables {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, "public."+tableName).Scan(&exists); err != nil {
			return fmt.Errorf("cannot verify table %s: %w", tableName, err)
		}
		if !exists {
			return fmt.Errorf("required table missing: %s (run migrations)", tableName)
		}
	}

	return nil
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
		// Stale integration errors are common after a failed sync attempt while the DB still
		// holds playable titles. Players should not get a blocking warning when the lobby works.
		if !syncOK && blueoceanVisible > 0 {
			syncOK = true
		}

		var realPlayEnabled bool
		if pf, err := paymentflags.Load(ctx, pool); err == nil {
			realPlayEnabled = pf.RealPlayEnabled
		}

		out := map[string]any{
			"maintenance_mode":                  cfg.MaintenanceMode,
			"disable_game_launch":               cfg.DisableGameLaunch,
			"blueocean_configured":              bog != nil && bog.Configured(),
			"blueocean_launch_mode":             strings.TrimSpace(strings.ToLower(cfg.BlueOceanLaunchMode)),
			"real_play_enabled":                 realPlayEnabled,
			"visible_games_count":               visible,
			"blueocean_visible_games_count":     blueoceanVisible,
			"catalog_sync_ok":                   syncOK,
			"last_catalog_sync_at":              nil,
			"fingerprint_server_api_configured": cfg.FingerprintConfigured(),
			"fingerprint_api_base_url":          strings.TrimSpace(cfg.FingerprintAPIBaseURL),
		}
		if base := strings.TrimSpace(cfg.APIPublicBase); base != "" {
			out["api_public_base"] = base
			out["blueocean_seamless_wallet_callback_url"] = base + "/api/blueocean/callback"
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
