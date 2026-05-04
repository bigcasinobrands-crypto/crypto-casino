package config

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv            string
	DatabaseURL       string
	Port              string
	JWTSecret         string
	PlayerJWTSecret   string
	// JWTRSAKeyFile — optional PEM path for RS256 + JWKS; when unset, HS256 only.
	JWTRSAKeyFile     string
	JWTIssuer         string
	JWTPlayerAudience string
	JWTStaffAudience  string
	AdminCORSOrigins  []string
	PlayerCORSOrigins []string
	RedisURL          string
	// Player auth baseline
	PublicPlayerURL string
	// APIPublicBase — optional public origin for this API (no trailing slash). Used for absolute URLs (bonus uploads, docs).
	APIPublicBase string
	TurnstileSecret string
	SMTPHost        string
	SMTPPort        string
	SMTPUser        string
	SMTPPassword    string
	SMTPFrom        string
	TermsVersion    string
	PrivacyVersion  string
	// Blue Ocean Gaming XAPI (server-to-server)
	BlueOceanAPIBaseURL       string
	BlueOceanAPILogin         string
	BlueOceanAPIPassword      string
	BlueOceanAgentID          string
	BlueOceanCurrency         string
	BlueOceanMulticurrency    bool
	BlueOceanLaunchMode       string // "demo" | "real"
	// BlueOceanUserIDNoHyphens — when true, UUID-shaped remote player ids are sent to XAPI without hyphens (some BO sandboxes reject dashed UUIDs).
	BlueOceanUserIDNoHyphens bool
	BlueOceanWalletSalt       string // seamless GET callback key=sha1(salt+query)
	// BlueOceanWalletFloatAmountIsMajorUnits: seamless wallet sends amount/bet/win as decimal major units (e.g. 0.25); multiply by 100 to minor. Integer params are still interpreted as minor units.
	BlueOceanWalletFloatAmountIsMajorUnits bool
	BlueOceanFeaturedIDHashes []string
	BlueOceanLobbyTagsJSON    string // optional JSON map pill_id -> [id_hash]
	// Catalog sync: getGameList often returns one page only; use paging to load full staging catalogs.
	BlueOceanCatalogPageSize    int    // 0 = single request (no limit/offset params); default 500
	BlueOceanCatalogPagingStyle string // offset | page | from — query param shape for paging
	BlueOceanImageBaseURL       string // optional origin for relative thumbnail paths from the API
	// BlueOceanCatalogSnapshotPath — JSON file (raw getGameList-style body). When set, SyncCatalog reads this instead of calling Blue Ocean (no outbound API / IP allowlist).
	BlueOceanCatalogSnapshotPath string
	// BlueOceanCatalogSnapshotOnStartup — if true and snapshot path is set, apply snapshot once when the API process starts.
	BlueOceanCatalogSnapshotOnStartup bool
	// Full sportsbook (distinct BO product id / XAPI method — see BLUEOCEAN_SPORTSBOOK_* envs in .env.example)
	BlueOceanSportsbookBOGID           int64
	BlueOceanSportsbookCatalogGameID   string // optional internal games.id for the main sportsbook tile
	BlueOceanSportsbookXAPIMethod      string // optional: non-empty → Call(method, params) instead of getGame/getGameDemo
	BlueOceanSportsbookXAPIExtraParams map[string]any
	// Operations
	MaintenanceMode       bool
	DisableGameLaunch     bool
	SupportCRMURLTemplate string // e.g. https://desk.example/ticket?user={user_id}
	// Phase 2 legal stub: ISO 3166-1 alpha-2 codes, comma-separated (empty = no block)
	BlockedCountryCodes []string
	// AdminIPAllowlist — optional CIDRs or IPs for /v1/admin (e.g. VPN egress only).
	AdminIPAllowlist []string
	// PlayerCookieAuth — set httpOnly access/refresh cookies on login/refresh; Bearer middleware also reads access cookie.
	PlayerCookieAuth bool
	// PlayerCookieSameSite: lax | strict | none (none forces Secure cookies — use with cross-site HTTPS).
	PlayerCookieSameSite string
	// PlayerCookieOmitJSONTokens — when true (with PlayerCookieAuth), login/register/refresh JSON omits access_token and refresh_token (cookies only). Default false for API clients that read tokens from the body.
	PlayerCookieOmitJSONTokens bool
	// HIBPCheckPasswords — when true, register/change/reset password rejects passwords found in Have I Been Pwned (k-anonymity API; fails open on API errors).
	HIBPCheckPasswords bool
	// AllowJWTHS256InProduction — escape hatch: allow HS256 player/staff JWTs when JWT_RSA_PRIVATE_KEY_FILE is unset (not recommended).
	AllowJWTHS256InProduction bool
	// CoinMarketCap Pro API (server-side only; used for public /v1/market/crypto-tickers)
	CoinMarketCapAPIKey string
	// Logo.dev — crypto/blockchain logos (https://img.logo.dev/crypto/{symbol}?token=pk_…)
	LogoDevPublishableKey string
	// Logo.dev secret (Bearer) for search/describe APIs only — never expose to clients; optional until you use those APIs.
	LogoDevSecretKey string
	// Fystack (MPC wallets, checkout, withdrawals) — HMAC auth per docs.fystack.io/authentication
	FystackBaseURL     string
	FystackAPIKey      string
	FystackAPISecret   string
	FystackWorkspaceID string
	// Ed25519 public key hex for the configured workspace (sandbox vs prod each has its own); when set, webhook verify skips API key fetch.
	FystackWebhookVerificationKey string
	// Outbound withdrawals (treasury wallet on Fystack)
	FystackTreasuryWalletID      string
	FystackWithdrawAssetID       string
	FystackWithdrawAssetDecimals int // default 6
	// Hosted checkout (USD-priced)
	FystackCheckoutSuccessURL string
	FystackCheckoutCancelURL  string
	FystackCheckoutAssets     string // comma-separated e.g. USDC:1,ETH:1
	FystackDepositAssetID     string // optional: default deposit address asset
	// FystackDepositAssets maps keys like USDT_ERC20 → Fystack asset UUID (from FYSTACK_DEPOSIT_ASSETS_JSON).
	FystackDepositAssets map[string]string
	// Data directory for uploads and other local files
	DataDir string
	// BlueOceanBonusSyncEnabled logs dry-run mapping for promotion sync (no dual-grant without full integration).
	BlueOceanBonusSyncEnabled bool
	// Withdrawal fraud parameters (all in USD cents unless noted)
	WithdrawMaxSingleCents   int64 // max single withdrawal; 0 = no limit
	WithdrawDailyLimitCents  int64 // max total per user per 24h; 0 = no limit
	WithdrawDailyCountLimit  int   // max number of withdrawals per user per 24h; 0 = no limit
	WithdrawMinAccountAgeSec int   // minimum account age in seconds; 0 = no restriction
	// BonusMaxBetViolationsAutoForfeit forfeits active instances when max_bet_violations_count >= this value; 0 = disabled.
	BonusMaxBetViolationsAutoForfeit int
	// Challenges: when true, worker skips challenge_bo_* jobs (emergency kill-switch).
	ChallengeIngestDisabled bool
	// SecurityCSPMode: off | report | enforce — Content-Security-Policy on API responses. Empty defaults to report in production, off in dev.
	SecurityCSPMode string
	// LogFormat: text | json — json enables slog JSON on stderr for log aggregators (Datadog, ELK, etc.).
	LogFormat string
	// VaultAddress — optional Vault API base (e.g. https://vault.example:8200). When set with VaultToken + VaultTransitKeyName, PII helpers use Transit.
	VaultAddress        string
	VaultToken          string
	VaultTransitMount   string
	VaultTransitKeyName string
	// PIIEmailLookupSecret — optional HMAC key for users.email_hmac (see internal/pii.EmailLookupHMACBytes). When set, register/login backfill store deterministic lookup bytes.
	PIIEmailLookupSecret string
	// WebAuthnRPID — e.g. localhost or admin.example.com (no scheme). With WebAuthnRPOrigins enables staff WebAuthn.
	WebAuthnRPID          string
	WebAuthnRPDisplayName string
	WebAuthnRPOrigins     []string
}

// FystackDepositAssetCanonicalKeys are the standard on-chain deposit combinations we surface in admin UI.
func FystackDepositAssetCanonicalKeys() []string {
	return []string{"USDT_ERC20", "USDT_TRC20", "USDT_BEP20", "USDC_ERC20", "USDC_TRC20", "USDC_BEP20"}
}

func Load() (Config, error) {
	_ = godotenv.Load()
	_ = godotenv.Load("../../.env")

	c := Config{
		AppEnv:      strings.TrimSpace(strings.ToLower(os.Getenv("APP_ENV"))),
		DatabaseURL: strings.TrimSpace(os.Getenv("DATABASE_URL")),
		Port:        strings.TrimSpace(os.Getenv("PORT")),
		JWTSecret:   strings.TrimSpace(os.Getenv("JWT_SECRET")),
		RedisURL:    strings.TrimSpace(os.Getenv("REDIS_URL")),
	}
	if c.Port == "" {
		c.Port = "9090"
	}
	c.AdminCORSOrigins = parseOriginsList(os.Getenv("ADMIN_CORS_ORIGINS"), []string{"http://localhost:5173"})
	c.PlayerCORSOrigins = parseOriginsList(os.Getenv("PLAYER_CORS_ORIGINS"), []string{"http://localhost:5174"})
	c.PlayerJWTSecret = strings.TrimSpace(os.Getenv("PLAYER_JWT_SECRET"))
	if c.PlayerJWTSecret == "" {
		c.PlayerJWTSecret = c.JWTSecret
	}
	c.JWTRSAKeyFile = strings.TrimSpace(os.Getenv("JWT_RSA_PRIVATE_KEY_FILE"))
	c.JWTIssuer = strings.TrimSpace(os.Getenv("JWT_ISSUER"))
	c.JWTPlayerAudience = strings.TrimSpace(os.Getenv("JWT_PLAYER_AUDIENCE"))
	c.JWTStaffAudience = strings.TrimSpace(os.Getenv("JWT_STAFF_AUDIENCE"))
	c.PublicPlayerURL = strings.TrimSpace(os.Getenv("PUBLIC_PLAYER_URL"))
	if c.PublicPlayerURL == "" {
		c.PublicPlayerURL = "http://localhost:5174"
	}
	c.APIPublicBase = strings.TrimSuffix(strings.TrimSpace(os.Getenv("API_PUBLIC_BASE")), "/")
	c.TurnstileSecret = strings.TrimSpace(os.Getenv("TURNSTILE_SECRET"))
	c.SMTPHost = strings.TrimSpace(os.Getenv("SMTP_HOST"))
	c.SMTPPort = strings.TrimSpace(os.Getenv("SMTP_PORT"))
	c.SMTPUser = strings.TrimSpace(os.Getenv("SMTP_USER"))
	c.SMTPPassword = strings.TrimSpace(os.Getenv("SMTP_PASSWORD"))
	c.SMTPFrom = strings.TrimSpace(os.Getenv("SMTP_FROM"))
	c.TermsVersion = strings.TrimSpace(os.Getenv("TERMS_VERSION"))
	if c.TermsVersion == "" {
		c.TermsVersion = "1"
	}
	c.PrivacyVersion = strings.TrimSpace(os.Getenv("PRIVACY_VERSION"))
	if c.PrivacyVersion == "" {
		c.PrivacyVersion = "1"
	}
	c.BlueOceanAPIBaseURL = strings.TrimSpace(os.Getenv("BLUEOCEAN_API_BASE_URL"))
	c.BlueOceanAPILogin = strings.TrimSpace(os.Getenv("BLUEOCEAN_API_LOGIN"))
	c.BlueOceanAPIPassword = strings.TrimSpace(os.Getenv("BLUEOCEAN_API_PASSWORD"))
	c.BlueOceanAgentID = strings.TrimSpace(os.Getenv("BLUEOCEAN_AGENT_ID"))
	c.BlueOceanCurrency = strings.TrimSpace(os.Getenv("BLUEOCEAN_CURRENCY"))
	if c.BlueOceanCurrency == "" {
		c.BlueOceanCurrency = "EUR"
	}
	c.BlueOceanMulticurrency = parseBoolEnv(os.Getenv("BLUEOCEAN_MULTICURRENCY"))
	c.BlueOceanLaunchMode = strings.TrimSpace(strings.ToLower(os.Getenv("BLUEOCEAN_LAUNCH_MODE")))
	if c.BlueOceanLaunchMode == "" {
		c.BlueOceanLaunchMode = "demo"
	}
	// Default true: many BO staging XAPI integrations reject dashed UUIDs in userid (unset env → compact ids).
	if strings.TrimSpace(os.Getenv("BLUEOCEAN_USERID_NO_HYPHENS")) == "" {
		c.BlueOceanUserIDNoHyphens = true
	} else {
		c.BlueOceanUserIDNoHyphens = parseBoolEnv(os.Getenv("BLUEOCEAN_USERID_NO_HYPHENS"))
	}
	c.BlueOceanWalletSalt = strings.TrimSpace(os.Getenv("BLUEOCEAN_WALLET_SALT"))
	c.BlueOceanWalletFloatAmountIsMajorUnits = parseBoolEnv(os.Getenv("BLUEOCEAN_WALLET_FLOAT_AMOUNT_IS_MAJOR"))
	if s := strings.TrimSpace(os.Getenv("BLUEOCEAN_FEATURED_ID_HASHES")); s != "" {
		for _, p := range strings.Split(s, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				c.BlueOceanFeaturedIDHashes = append(c.BlueOceanFeaturedIDHashes, p)
			}
		}
	}
	c.BlueOceanLobbyTagsJSON = strings.TrimSpace(os.Getenv("BLUEOCEAN_LOBBY_TAGS_JSON"))
	c.BlueOceanCatalogPageSize = 500
	if s := strings.TrimSpace(os.Getenv("BLUEOCEAN_CATALOG_PAGE_SIZE")); s != "" {
		if s == "0" {
			c.BlueOceanCatalogPageSize = 0
		} else if n, err := strconv.Atoi(s); err == nil && n > 0 {
			if n > 5000 {
				n = 5000
			}
			c.BlueOceanCatalogPageSize = n
		}
	}
	c.BlueOceanCatalogPagingStyle = strings.ToLower(strings.TrimSpace(os.Getenv("BLUEOCEAN_CATALOG_PAGING")))
	if c.BlueOceanCatalogPagingStyle == "" {
		c.BlueOceanCatalogPagingStyle = "offset"
	}
	c.BlueOceanImageBaseURL = strings.TrimSuffix(strings.TrimSpace(os.Getenv("BLUEOCEAN_IMAGE_BASE_URL")), "/")
	c.BlueOceanCatalogSnapshotPath = strings.TrimSpace(os.Getenv("BLUEOCEAN_CATALOG_SNAPSHOT_PATH"))
	c.BlueOceanCatalogSnapshotOnStartup = parseBoolEnv(os.Getenv("BLUEOCEAN_CATALOG_SNAPSHOT_ON_START"))
	if s := strings.TrimSpace(os.Getenv("BLUEOCEAN_SPORTSBOOK_BOG_GAME_ID")); s != "" {
		if n, err := strconv.ParseInt(s, 10, 64); err == nil && n > 0 {
			c.BlueOceanSportsbookBOGID = n
		}
	}
	c.BlueOceanSportsbookCatalogGameID = strings.TrimSpace(os.Getenv("BLUEOCEAN_SPORTSBOOK_GAME_ID"))
	c.BlueOceanSportsbookXAPIMethod = strings.TrimSpace(os.Getenv("BLUEOCEAN_SPORTSBOOK_XAPI_METHOD"))
	if raw := strings.TrimSpace(os.Getenv("BLUEOCEAN_SPORTSBOOK_XAPI_EXTRA_JSON")); raw != "" {
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err == nil && len(m) > 0 {
			c.BlueOceanSportsbookXAPIExtraParams = m
		}
	}
	c.BlueOceanBonusSyncEnabled = parseBoolEnv(os.Getenv("BLUEOCEAN_BONUS_SYNC_ENABLED"))
	c.MaintenanceMode = parseBoolEnv(os.Getenv("MAINTENANCE_MODE"))
	c.DisableGameLaunch = parseBoolEnv(os.Getenv("DISABLE_GAME_LAUNCH"))
	c.SupportCRMURLTemplate = strings.TrimSpace(os.Getenv("SUPPORT_CRM_URL_TEMPLATE"))
	if raw := strings.TrimSpace(os.Getenv("BLOCKED_COUNTRY_CODES")); raw != "" {
		for _, p := range strings.Split(raw, ",") {
			p = strings.TrimSpace(strings.ToUpper(p))
			if len(p) == 2 {
				c.BlockedCountryCodes = append(c.BlockedCountryCodes, p)
			}
		}
	}
	if raw := strings.TrimSpace(os.Getenv("ADMIN_IP_ALLOWLIST")); raw != "" {
		for _, p := range strings.Split(raw, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				c.AdminIPAllowlist = append(c.AdminIPAllowlist, p)
			}
		}
	}
	c.PlayerCookieAuth = parseBoolEnv(os.Getenv("PLAYER_COOKIE_AUTH"))
	c.PlayerCookieSameSite = strings.TrimSpace(strings.ToLower(os.Getenv("PLAYER_COOKIE_SAMESITE")))
	if c.PlayerCookieSameSite == "" {
		c.PlayerCookieSameSite = "lax"
	}
	switch c.PlayerCookieSameSite {
	case "lax", "strict", "none":
	default:
		c.PlayerCookieSameSite = "lax"
	}
	c.PlayerCookieOmitJSONTokens = parseBoolEnv(os.Getenv("PLAYER_COOKIE_OMIT_JSON_TOKENS"))
	c.HIBPCheckPasswords = parseBoolEnv(os.Getenv("HIBP_CHECK_PASSWORDS"))
	c.AllowJWTHS256InProduction = parseBoolEnv(os.Getenv("ALLOW_JWT_HS256_IN_PRODUCTION"))
	c.CoinMarketCapAPIKey = strings.TrimSpace(os.Getenv("COINMARKETCAP_API_KEY"))
	if c.CoinMarketCapAPIKey == "" {
		c.CoinMarketCapAPIKey = strings.TrimSpace(os.Getenv("CMC_API_KEY"))
	}
	c.LogoDevPublishableKey = strings.TrimSpace(os.Getenv("LOGO_DEV_PUBLISHABLE_KEY"))
	c.LogoDevSecretKey = strings.TrimSpace(os.Getenv("LOGO_DEV_SECRET_KEY"))
	c.FystackBaseURL = strings.TrimSuffix(strings.TrimSpace(os.Getenv("FYSTACK_BASE_URL")), "/")
	c.FystackAPIKey = strings.TrimSpace(os.Getenv("FYSTACK_API_KEY"))
	c.FystackAPISecret = strings.TrimSpace(os.Getenv("FYSTACK_API_SECRET"))
	c.FystackWorkspaceID = strings.TrimSpace(os.Getenv("FYSTACK_WORKSPACE_ID"))
	c.FystackWebhookVerificationKey = strings.TrimSpace(os.Getenv("FYSTACK_WEBHOOK_VERIFICATION_KEY"))
	c.FystackTreasuryWalletID = strings.TrimSpace(os.Getenv("FYSTACK_TREASURY_WALLET_ID"))
	c.FystackWithdrawAssetID = strings.TrimSpace(os.Getenv("FYSTACK_WITHDRAW_ASSET_ID"))
	c.FystackWithdrawAssetDecimals = 6
	if s := strings.TrimSpace(os.Getenv("FYSTACK_WITHDRAW_ASSET_DECIMALS")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 0 && n <= 18 {
			c.FystackWithdrawAssetDecimals = n
		}
	}
	c.FystackCheckoutSuccessURL = strings.TrimSpace(os.Getenv("FYSTACK_CHECKOUT_SUCCESS_URL"))
	if c.FystackCheckoutSuccessURL == "" {
		c.FystackCheckoutSuccessURL = strings.TrimSuffix(c.PublicPlayerURL, "/") + "/wallet/deposit/submitted?checkout=success"
	}
	c.FystackCheckoutCancelURL = strings.TrimSpace(os.Getenv("FYSTACK_CHECKOUT_CANCEL_URL"))
	if c.FystackCheckoutCancelURL == "" {
		c.FystackCheckoutCancelURL = strings.TrimSuffix(c.PublicPlayerURL, "/") + "/wallet/deposit?checkout=cancel"
	}
	c.FystackCheckoutAssets = strings.TrimSpace(os.Getenv("FYSTACK_CHECKOUT_SUPPORTED_ASSETS"))
	if c.FystackCheckoutAssets == "" {
		c.FystackCheckoutAssets = "USDC:1,ETH:1,ETH:8453"
	}
	c.FystackDepositAssetID = strings.TrimSpace(os.Getenv("FYSTACK_DEPOSIT_ASSET_ID"))
	if raw := strings.TrimSpace(os.Getenv("FYSTACK_DEPOSIT_ASSETS_JSON")); raw != "" {
		var m map[string]string
		if err := json.Unmarshal([]byte(raw), &m); err == nil && len(m) > 0 {
			c.FystackDepositAssets = make(map[string]string, len(m))
			for k, v := range m {
				k = strings.ToUpper(strings.TrimSpace(k))
				v = strings.TrimSpace(v)
				if k != "" && v != "" {
					c.FystackDepositAssets[k] = v
				}
			}
		}
	}
	c.DataDir = strings.TrimSpace(os.Getenv("DATA_DIR"))
	if c.DataDir == "" {
		c.DataDir = "./data"
	}
	c.WithdrawMaxSingleCents = parseIntEnv(os.Getenv("WITHDRAW_MAX_SINGLE_CENTS"), 0)
	c.WithdrawDailyLimitCents = parseIntEnv(os.Getenv("WITHDRAW_DAILY_LIMIT_CENTS"), 0)
	c.WithdrawDailyCountLimit = int(parseIntEnv(os.Getenv("WITHDRAW_DAILY_COUNT_LIMIT"), 0))
	c.WithdrawMinAccountAgeSec = int(parseIntEnv(os.Getenv("WITHDRAW_MIN_ACCOUNT_AGE_SEC"), 0))
	v := int(parseIntEnv(os.Getenv("BONUS_MAX_BET_VIOLATIONS_AUTO_FORFEIT"), 0))
	if v < 0 {
		v = 0
	}
	if v > 100000 {
		v = 100000
	}
	c.BonusMaxBetViolationsAutoForfeit = v
	c.ChallengeIngestDisabled = parseBoolEnv(os.Getenv("CHALLENGE_INGEST_DISABLED"))
	c.SecurityCSPMode = strings.TrimSpace(strings.ToLower(os.Getenv("SECURITY_CSP_MODE")))
	c.LogFormat = strings.TrimSpace(strings.ToLower(os.Getenv("LOG_FORMAT")))
	c.VaultAddress = strings.TrimSuffix(strings.TrimSpace(os.Getenv("VAULT_ADDR")), "/")
	c.VaultToken = strings.TrimSpace(os.Getenv("VAULT_TOKEN"))
	c.VaultTransitMount = strings.TrimSpace(os.Getenv("VAULT_TRANSIT_MOUNT"))
	if c.VaultTransitMount == "" {
		c.VaultTransitMount = "transit"
	}
	c.VaultTransitKeyName = strings.TrimSpace(os.Getenv("VAULT_TRANSIT_KEY_NAME"))
	c.PIIEmailLookupSecret = strings.TrimSpace(os.Getenv("PII_EMAIL_LOOKUP_SECRET"))
	c.WebAuthnRPID = strings.TrimSpace(os.Getenv("WEBAUTHN_RP_ID"))
	c.WebAuthnRPDisplayName = strings.TrimSpace(os.Getenv("WEBAUTHN_RP_DISPLAY_NAME"))
	if c.WebAuthnRPDisplayName == "" {
		c.WebAuthnRPDisplayName = "Crypto Casino Admin"
	}
	if raw := strings.TrimSpace(os.Getenv("WEBAUTHN_RP_ORIGINS")); raw != "" {
		for _, o := range strings.Split(raw, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				c.WebAuthnRPOrigins = append(c.WebAuthnRPOrigins, o)
			}
		}
	}
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required — copy services/core/.env.example to services/core/.env, start Postgres (e.g. `docker compose up -d postgres redis`), then retry (or run `npm run dev:casino` from the repo root)")
	}
	if len(c.JWTSecret) < 32 {
		return c, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}
	if len(c.PlayerJWTSecret) < 32 {
		return c, fmt.Errorf("PLAYER_JWT_SECRET must be at least 32 characters when set; defaults to JWT_SECRET")
	}
	if c.PlayerCookieOmitJSONTokens && !c.PlayerCookieAuth {
		return c, fmt.Errorf("PLAYER_COOKIE_OMIT_JSON_TOKENS requires PLAYER_COOKIE_AUTH")
	}
	if c.AppEnv == "" {
		c.AppEnv = "development"
	}
	return c, nil
}

// ValidateProduction enforces fail-fast rules when APP_ENV=production.
func (c *Config) ValidateProduction() error {
	if c == nil {
		return fmt.Errorf("config is nil")
	}
	if c.AppEnv != "production" {
		return nil
	}
	jwtUpper := strings.ToUpper(c.JWTSecret)
	dbUpper := strings.ToUpper(c.DatabaseURL)
	redisUpper := strings.ToUpper(c.RedisURL)
	if strings.Contains(jwtUpper, "CHANGE_ME") {
		return fmt.Errorf("APP_ENV=production: JWT_SECRET still looks like a template (contains CHANGE_ME) — generate a real secret (e.g. openssl rand -hex 32)")
	}
	if strings.Contains(dbUpper, "CHANGE_ME") {
		return fmt.Errorf("APP_ENV=production: DATABASE_URL still looks like a template (contains CHANGE_ME) — paste your full Supabase Postgres URI")
	}
	if strings.Contains(redisUpper, "CHANGE_ME") {
		return fmt.Errorf("APP_ENV=production: REDIS_URL still looks like a template (contains CHANGE_ME) — paste your Redis URL (e.g. Upstash rediss://)")
	}
	if strings.Contains(strings.ToLower(c.JWTSecret), "dev-only") || strings.Contains(strings.ToLower(c.JWTSecret), "change-me") {
		return fmt.Errorf("APP_ENV=production: JWT_SECRET must not contain dev placeholder strings")
	}
	if strings.TrimSpace(c.RedisURL) == "" {
		return fmt.Errorf("APP_ENV=production: REDIS_URL is required for queue and security features")
	}
	if strings.TrimSpace(c.JWTRSAKeyFile) == "" && !c.AllowJWTHS256InProduction {
		return fmt.Errorf("APP_ENV=production: JWT_RSA_PRIVATE_KEY_FILE is required (HS256-only production is blocked; set ALLOW_JWT_HS256_IN_PRODUCTION=true only as a temporary migration escape hatch)")
	}
	return nil
}

// SecurityCSPEffectiveMode returns off, report, or enforce for API Content-Security-Policy headers.
func (c *Config) SecurityCSPEffectiveMode() string {
	if c == nil {
		return "off"
	}
	switch c.SecurityCSPMode {
	case "off", "report", "enforce":
		return c.SecurityCSPMode
	case "":
		if c.AppEnv == "production" {
			return "report"
		}
		return "off"
	default:
		if c.AppEnv == "production" {
			return "report"
		}
		return "off"
	}
}

// FystackConfigured is true when base URL, API key, secret, and workspace id are set (server-side Fystack calls).
func (c *Config) FystackConfigured() bool {
	if c == nil {
		return false
	}
	return c.FystackBaseURL != "" && c.FystackAPIKey != "" && c.FystackAPISecret != "" && c.FystackWorkspaceID != ""
}

// FystackWithdrawConfigured is true when treasury + asset are set for on-chain payouts.
func (c *Config) FystackWithdrawConfigured() bool {
	if c == nil || !c.FystackConfigured() {
		return false
	}
	return c.FystackTreasuryWalletID != "" && c.FystackWithdrawAssetID != ""
}

// FystackCheckoutAssetList parses FYSTACK_CHECKOUT_SUPPORTED_ASSETS into tokens like USDC:1.
func (c *Config) FystackCheckoutAssetList() []string {
	def := []string{"USDC:1", "ETH:1", "ETH:8453"}
	if c == nil || strings.TrimSpace(c.FystackCheckoutAssets) == "" {
		return def
	}
	var out []string
	for _, p := range strings.Split(c.FystackCheckoutAssets, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return def
	}
	return out
}

func parseBoolEnv(s string) bool {
	s = strings.TrimSpace(strings.ToLower(s))
	return s == "1" || s == "true" || s == "yes"
}

func parseIntEnv(s string, defaultVal int64) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return defaultVal
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return defaultVal
	}
	return n
}

func parseOriginsList(raw string, defaultOrigins []string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		out := make([]string, len(defaultOrigins))
		copy(out, defaultOrigins)
		return out
	}
	var list []string
	for _, o := range strings.Split(raw, ",") {
		o = strings.TrimSpace(o)
		o = strings.TrimSuffix(o, "/")
		if o != "" {
			list = append(list, o)
		}
	}
	return list
}

// NormalizeDepositNetwork maps common aliases to ERC20, TRC20, or BEP20 (BNB Smart Chain).
func NormalizeDepositNetwork(s string) string {
	s = strings.ToUpper(strings.TrimSpace(s))
	switch s {
	case "ERC20", "ETH", "ETHEREUM", "EVM":
		return "ERC20"
	case "TRC20", "TRX", "TRON":
		return "TRC20"
	case "BEP20", "BSC", "BSC20", "BNB", "BNB SMART CHAIN":
		return "BEP20"
	default:
		return s
	}
}

// DepositAssetKeyConfigured is true when FYSTACK_DEPOSIT_ASSETS_JSON contains a non-empty UUID for the canonical key.
func (c *Config) DepositAssetKeyConfigured(key string) bool {
	if c == nil || c.FystackDepositAssets == nil {
		return false
	}
	return strings.TrimSpace(c.FystackDepositAssets[strings.ToUpper(strings.TrimSpace(key))]) != ""
}

// IsTrustedFystackHTTPSURL rejects open redirects from checkout responses (https only, Fystack-hosted hosts).
func (c *Config) IsTrustedFystackHTTPSURL(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Host)
	if strings.HasSuffix(host, ".fystack.io") || host == "fystack.io" {
		return true
	}
	if c != nil && c.FystackBaseURL != "" {
		if bu, err := url.Parse(c.FystackBaseURL); err == nil && bu.Host != "" {
			if strings.EqualFold(host, bu.Host) {
				return true
			}
		}
	}
	return false
}
