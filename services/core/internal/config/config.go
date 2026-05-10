package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv          string
	DatabaseURL     string
	// MigrateDatabaseURL — optional. When set, goose migrations use this DSN instead of DatabaseURL
	// (avoids Supabase session pooler client limits during deploy while the previous instance still holds pooler slots).
	MigrateDatabaseURL string
	Port               string
	JWTSecret       string
	PlayerJWTSecret string
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
	APIPublicBase   string
	TurnstileSecret string
	SMTPHost        string
	SMTPPort        string
	SMTPUser        string
	SMTPPassword    string
	SMTPFrom        string
	// ResendAPIKey — when set with ResendFrom or SMTP_FROM, core sends transactional mail via Resend (RESEND_API_KEY).
	ResendAPIKey string
	// ResendFrom — optional "from" for Resend; when empty, SMTP_FROM is used with Resend.
	ResendFrom string
	TermsVersion    string
	PrivacyVersion  string
	// Blue Ocean Gaming XAPI (server-to-server)
	BlueOceanAPIBaseURL    string
	BlueOceanAPILogin      string
	BlueOceanAPIPassword   string
	BlueOceanAgentID       string
	BlueOceanCurrency      string
	BlueOceanMulticurrency bool
	BlueOceanLaunchMode    string // "demo" | "real"
	// BlueOceanUserIDNoHyphens — when true, UUID-shaped remote player ids are sent to XAPI without hyphens (some BO sandboxes reject dashed UUIDs).
	BlueOceanUserIDNoHyphens bool
	// BlueOceanUserUsernamePrefix — optional; prepended to createPlayer user_username (often matches BO Api user "Prefix", e.g. 9w7r).
	BlueOceanUserUsernamePrefix string
	// BlueOceanCreatePlayerUserPassword — optional; BO docs recommend a non-real constant user_password on createPlayer; omit when empty.
	BlueOceanCreatePlayerUserPassword string
	// BlueOceanXAPIUserPasswordSHA1 — when true (default), user_password on the wire is SHA1-hex (40 chars) unless the value is already 40 hex chars (BO public XAPI examples). Set false if your operator confirms plaintext on the wire.
	BlueOceanXAPIUserPasswordSHA1 bool
	BlueOceanWalletSalt      string // seamless GET callback key=sha1(salt+query)
	// BlueOceanWalletFloatAmountIsMajorUnits: when true, decimal amount/bet/win (e.g. "0.25") are major units (×100 to minor). When false, decimals are interpreted as minor units (legacy).
	BlueOceanWalletFloatAmountIsMajorUnits bool
	// BlueOceanWalletIntegerAmountIsMajorUnits: when true, integer and decimal amount/bet/win are major units (×100 to ledger minor) — matches Blue Ocean basic S2S wallet tests (amount=10 ⇒ 10.00). Default true when env unset; set BLUEOCEAN_WALLET_INTEGER_MINOR_UNITS=true only if your operator documents whole-number params as minor units (cents).
	BlueOceanWalletIntegerAmountIsMajorUnits bool
	// BlueOceanWalletAllowNegativeBalance — when true, seamless wallet debits may drive playable balance negative (operator / BO tooling stress tests).
	BlueOceanWalletAllowNegativeBalance bool
	// BlueOceanWalletLedgerTxnUsesRound — when true, seamless wallet ledger idempotency keys append "::" + round_id whenever round_id is present. Use when the provider reuses transaction_id across parallel bets (Evolution/easy live). Rollbacks must include the same round_id.
	BlueOceanWalletLedgerTxnUsesRound bool
	// BlueOceanWalletSkipBonusBetGuards — when true, seamless wallet omits active-bonus max-bet and excluded-game checks. Use only for operator certification sandboxes; production should keep this false so promo rules still apply.
	BlueOceanWalletSkipBonusBetGuards bool
	BlueOceanFeaturedIDHashes              []string
	BlueOceanLobbyTagsJSON                 string // optional JSON map pill_id -> [id_hash]
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
	// BlueOceanCreatePlayerExtraParams — optional JSON (BLUEOCEAN_CREATE_PLAYER_EXTRA_JSON) merged into every createPlayer call after currency/agent; per-request extras win.
	BlueOceanCreatePlayerExtraParams map[string]any
	// BlueOceanXAPISessionSync — when true (default), player login/logout calls BO loginPlayer/logoutPlayer. Set false if BO discourages frequent session pings.
	BlueOceanXAPISessionSync bool
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
	// AllowProductionMissingBlueOceanWebhookSecret — production bootstrap only: skip ValidateProduction check
	// for WEBHOOK_BLUEOCEAN_SECRET. POST /v1/webhooks/blueocean still returns 401 until the secret is set; use openssl rand -hex 32 and configure in Render + BlueOcean.
	AllowProductionMissingBlueOceanWebhookSecret bool
	// CoinMarketCap Pro API (server-side only; used for public /v1/market/crypto-tickers)
	CoinMarketCapAPIKey string
	// Logo.dev — crypto/blockchain logos (https://img.logo.dev/crypto/{symbol}?token=pk_…)
	LogoDevPublishableKey string
	// Logo.dev secret (Bearer) for search/describe APIs only — never expose to clients; optional until you use those APIs.
	LogoDevSecretKey string
	// PAYMENT_PROVIDER: empty defaults to passimpay in Load(); use none to disable PassimPay (wallet returns 503 for passimpay routes until configured).
	PaymentProvider               string
	PassimpayEnabled              bool
	PassimpayAPIBaseURL           string // default https://api.passimpay.io
	PassimpayPlatformID           int
	PassimpaySecretKey            string // outbound API signing (never expose to clients)
	PassimpayWebhookSecret        string // verifies inbound webhook x-signature (often same as API key — set explicitly)
	PassimpayCallbackPublicBase   string // public API origin PassimPay will call back (staff configures exact URL in dashboard)
	PassimpayDepositMethod        string // h2h | invoice (invoice link path not wired yet — use h2h)
	PassimpayDefaultInvoiceExpiry int    // minutes; placeholder until invoice endpoints are added
	PassimpayWithdrawalsEnabled   bool
	PassimpayRequestTimeoutMs     int
	PassimpayFailClosed           bool // when true (default prod), webhook without valid signature rejects

	// LedgerHouseUserID — UUID of synthetic house user for clearing_deposit / clearing_withdrawal_out mirror legs (default migration 00069).
	LedgerHouseUserID string

	// Data directory for uploads and other local files
	DataDir string
	// BlueOceanBonusSyncEnabled logs dry-run mapping for promotion sync (no dual-grant without full integration).
	BlueOceanBonusSyncEnabled bool
	// Withdrawal fraud parameters (all in USD cents unless noted)
	WithdrawMaxSingleCents   int64 // max single withdrawal; 0 = no limit
	WithdrawDailyLimitCents  int64 // max total per user per 24h; 0 = no limit
	WithdrawDailyCountLimit  int   // max number of withdrawals per user per 24h; 0 = no limit
	WithdrawMinAccountAgeSec int   // minimum account age in seconds; 0 = no restriction
	// KYCLargeWithdrawalThresholdCents: amount above which a withdrawal is blocked
	// unless users.kyc_status='approved'. 0 disables the gate. Default 100000 ($1000).
	KYCLargeWithdrawalThresholdCents int64
	// KYCLargeDepositThresholdCents: amount above which the deposit webhook
	// raises an `aml_large_deposit` reconciliation_alert (does not block).
	// 0 disables. Default 100000 ($1000).
	KYCLargeDepositThresholdCents int64
	// AMLLargeWithdrawalAlertThresholdCents: amount above which a successful
	// withdrawal raises an `aml_large_withdrawal` reconciliation_alert. This
	// is alerting only; the hard block is WithdrawMaxSingleCents above. 0
	// disables. Default 200000 ($2000).
	AMLLargeWithdrawalAlertThresholdCents int64
	// OperatorDailyPayoutCapCents: hard cap on the SUM of withdrawal amounts
	// (in USD cents) the platform will submit to PassimPay in a rolling 24h
	// window across ALL users. Treasury-drain protection. Once exceeded,
	// further withdrawal requests are queued in REVIEW status until the
	// next day's window opens or an operator approves them. 0 disables.
	OperatorDailyPayoutCapCents int64
	// WalletAddressKEK: 32-byte hex key used for AES-GCM encryption of
	// destination crypto addresses at rest (SEC-7). Production should set
	// this from a secret manager (Vault, AWS KMS, GCP Secret Manager).
	// Empty string disables encryption — withdraws are still recorded but
	// addresses go to the legacy plaintext column.
	WalletAddressKEK string
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
	// Fingerprint Pro Server API (https://docs.fingerprint.com/reference/server-api-get-event) — Auth-API-Key; never exposed to clients.
	FingerprintSecretAPIKey string
	FingerprintAPIBaseURL   string
	// RequireFingerprintPlayerAuth — when true, sign-in / refresh / traffic may require fingerprint_request_id
	// (legacy opt-in: set REQUIRE_FINGERPRINT_PLAYER_AUTH=true). APP_ENV=development never enforces — see PlayerFingerprintAuthRequired().
	RequireFingerprintPlayerAuth bool
	// WithdrawRequireFingerprint — when true, POST /v1/wallet/withdraw must include fingerprint_request_id (enforced before ledger).
	WithdrawRequireFingerprint bool
	// Oddin.gg esports iframe (“Bifrost”) + operator callbacks (secrets server-side only).
	OddinEnabled             bool
	OddinEnv                 string // integration | production (informational)
	OddinPublicBaseURL       string // same logical values as player VITE_ODDIN_BASE_URL (admin/status only)
	OddinPublicScriptURL     string
	OddinBrandTokenPublic    string // optional server-side copy for audits
	OddinAPISecurityKey      string // X-API-Key for /v1/oddin/* operator routes
	OddinHashSecret          string // optional HMAC secret for operator request bodies
	OddinTokenTTLSeconds     int
	OddinOperatorIPAllowlist []string // when non-empty, restrict operator callbacks to these IPs (comma-separated in env)
	// OddinEsportsNavJSON — optional JSON array for E-Sports sidebar (id, label, page, logoUrl); list + Oddin-hosted logo URLs from integration docs.
	OddinEsportsNavJSON string
	// OddinTheme and locale — optional; returned from GET /v1/sportsbook/oddin/public-config when core drives the iframe.
	OddinTheme           string
	OddinDefaultLanguage string
	OddinDefaultCurrency string
	// OddinDefaultCountry — ISO 3166-1 alpha-2 (e.g. GB, MT) used when traffic_sessions has no
	// country and as Oddin iframe fallback; avoids hard-coding US for brands that block it.
	OddinDefaultCountry string
	OddinDarkMode       bool
}

// DepositAssetCanonicalKeys are standard symbol_network combinations surfaced in admin UI (aligned with payment_currencies.symbol/network).
func DepositAssetCanonicalKeys() []string {
	return []string{"USDT_ERC20", "USDT_TRC20", "USDT_BEP20", "USDC_ERC20", "USDC_TRC20", "USDC_BEP20"}
}

func Load() (Config, error) {
	_ = godotenv.Load()
	_ = godotenv.Load("../../.env")

	c := Config{
		AppEnv:             strings.TrimSpace(strings.ToLower(os.Getenv("APP_ENV"))),
		DatabaseURL:        strings.TrimSpace(os.Getenv("DATABASE_URL")),
		MigrateDatabaseURL: strings.TrimSpace(os.Getenv("MIGRATE_DATABASE_URL")),
		Port:               strings.TrimSpace(os.Getenv("PORT")),
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
	c.ResendAPIKey = strings.TrimSpace(os.Getenv("RESEND_API_KEY"))
	c.ResendFrom = strings.TrimSpace(os.Getenv("RESEND_FROM"))
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
	c.BlueOceanUserUsernamePrefix = strings.TrimSpace(os.Getenv("BLUEOCEAN_USER_USERNAME_PREFIX"))
	c.BlueOceanCreatePlayerUserPassword = strings.TrimSpace(os.Getenv("BLUEOCEAN_CREATE_PLAYER_USER_PASSWORD"))
	if raw := strings.TrimSpace(os.Getenv("BLUEOCEAN_XAPI_USER_PASSWORD_SHA1")); raw == "" {
		c.BlueOceanXAPIUserPasswordSHA1 = true
	} else {
		c.BlueOceanXAPIUserPasswordSHA1 = parseBoolEnv(raw)
	}
	c.BlueOceanWalletSalt = strings.TrimSpace(os.Getenv("BLUEOCEAN_WALLET_SALT"))
	c.BlueOceanWalletFloatAmountIsMajorUnits = parseBoolEnv(os.Getenv("BLUEOCEAN_WALLET_FLOAT_AMOUNT_IS_MAJOR"))
	// Seamless wallet: BO stage/prod examples use major-unit amounts (credit 10 = 10.00). Opt out with BLUEOCEAN_WALLET_INTEGER_MINOR_UNITS=true.
	if parseBoolEnv(os.Getenv("BLUEOCEAN_WALLET_INTEGER_MINOR_UNITS")) {
		c.BlueOceanWalletIntegerAmountIsMajorUnits = false
	} else if raw := strings.TrimSpace(os.Getenv("BLUEOCEAN_WALLET_INTEGER_AMOUNT_IS_MAJOR")); raw != "" {
		c.BlueOceanWalletIntegerAmountIsMajorUnits = parseBoolEnv(raw)
	} else {
		c.BlueOceanWalletIntegerAmountIsMajorUnits = true
	}
	c.BlueOceanWalletAllowNegativeBalance = parseBoolEnv(os.Getenv("BLUEOCEAN_WALLET_ALLOW_NEGATIVE_BALANCE"))
	c.BlueOceanWalletLedgerTxnUsesRound = parseBoolEnv(os.Getenv("BLUEOCEAN_WALLET_LEDGER_TXN_USES_ROUND"))
	c.BlueOceanWalletSkipBonusBetGuards = parseBoolEnv(os.Getenv("BLUEOCEAN_WALLET_SKIP_BONUS_BET_GUARDS"))
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
	if raw := strings.TrimSpace(os.Getenv("BLUEOCEAN_CREATE_PLAYER_EXTRA_JSON")); raw != "" {
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err == nil && len(m) > 0 {
			c.BlueOceanCreatePlayerExtraParams = m
		}
	}
	if strings.TrimSpace(os.Getenv("BLUEOCEAN_XAPI_SESSION_SYNC")) == "" {
		c.BlueOceanXAPISessionSync = true
	} else {
		c.BlueOceanXAPISessionSync = parseBoolEnv(os.Getenv("BLUEOCEAN_XAPI_SESSION_SYNC"))
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
	c.AllowProductionMissingBlueOceanWebhookSecret = parseBoolEnv(os.Getenv("ALLOW_PRODUCTION_MISSING_BLUEOCEAN_WEBHOOK_SECRET"))
	c.CoinMarketCapAPIKey = strings.TrimSpace(os.Getenv("COINMARKETCAP_API_KEY"))
	if c.CoinMarketCapAPIKey == "" {
		c.CoinMarketCapAPIKey = strings.TrimSpace(os.Getenv("CMC_API_KEY"))
	}
	c.LogoDevPublishableKey = strings.TrimSpace(os.Getenv("LOGO_DEV_PUBLISHABLE_KEY"))
	c.LogoDevSecretKey = strings.TrimSpace(os.Getenv("LOGO_DEV_SECRET_KEY"))

	c.PaymentProvider = strings.ToLower(strings.TrimSpace(os.Getenv("PAYMENT_PROVIDER")))
	if c.PaymentProvider == "" {
		c.PaymentProvider = "passimpay"
	}

	c.PassimpayEnabled = parseBoolEnv(os.Getenv("PASSIMPAY_ENABLED"))
	if strings.TrimSpace(os.Getenv("PASSIMPAY_ENABLED")) == "" {
		c.PassimpayEnabled = strings.EqualFold(c.PaymentProvider, "passimpay")
	}
	c.PassimpayAPIBaseURL = strings.TrimSuffix(strings.TrimSpace(os.Getenv("PASSIMPAY_API_BASE_URL")), "/")
	if c.PassimpayAPIBaseURL == "" {
		c.PassimpayAPIBaseURL = "https://api.passimpay.io"
	}
	if s := strings.TrimSpace(os.Getenv("PASSIMPAY_PLATFORM_ID")); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			c.PassimpayPlatformID = n
		}
	}
	c.PassimpaySecretKey = strings.TrimSpace(os.Getenv("PASSIMPAY_SECRET_KEY"))
	if c.PassimpaySecretKey == "" {
		c.PassimpaySecretKey = strings.TrimSpace(os.Getenv("PASSIMPAY_API_KEY")) // common alias per dashboard naming
	}
	c.PassimpayWebhookSecret = strings.TrimSpace(os.Getenv("PASSIMPAY_WEBHOOK_SECRET"))
	if c.PassimpayWebhookSecret == "" {
		c.PassimpayWebhookSecret = c.PassimpaySecretKey
	}
	c.PassimpayCallbackPublicBase = strings.TrimSuffix(strings.TrimSpace(os.Getenv("PASSIMPAY_CALLBACK_BASE_URL")), "/")
	c.PassimpayDepositMethod = strings.ToLower(strings.TrimSpace(os.Getenv("PASSIMPAY_DEPOSIT_METHOD")))
	if c.PassimpayDepositMethod == "" {
		c.PassimpayDepositMethod = "h2h"
	}
	c.PassimpayDefaultInvoiceExpiry = 30
	if s := strings.TrimSpace(os.Getenv("PASSIMPAY_DEFAULT_INVOICE_EXPIRY_MINUTES")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			c.PassimpayDefaultInvoiceExpiry = n
		}
	}
	if strings.TrimSpace(os.Getenv("PASSIMPAY_WITHDRAWALS_ENABLED")) != "" {
		c.PassimpayWithdrawalsEnabled = parseBoolEnv(os.Getenv("PASSIMPAY_WITHDRAWALS_ENABLED"))
	} else {
		c.PassimpayWithdrawalsEnabled = true
	}
	c.PassimpayRequestTimeoutMs = int(parseIntEnv(os.Getenv("PASSIMPAY_REQUEST_TIMEOUT_MS"), 15000))
	if strings.TrimSpace(os.Getenv("PASSIMPAY_FAIL_CLOSED")) != "" {
		c.PassimpayFailClosed = parseBoolEnv(os.Getenv("PASSIMPAY_FAIL_CLOSED"))
	} else {
		appPeek := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
		c.PassimpayFailClosed = appPeek == "production"
	}
	c.LedgerHouseUserID = strings.TrimSpace(os.Getenv("LEDGER_HOUSE_USER_ID"))

	c.DataDir = strings.TrimSpace(os.Getenv("DATA_DIR"))
	if c.DataDir == "" {
		c.DataDir = "./data"
	}
	c.WithdrawMaxSingleCents = parseIntEnv(os.Getenv("WITHDRAW_MAX_SINGLE_CENTS"), 0)
	c.WithdrawDailyLimitCents = parseIntEnv(os.Getenv("WITHDRAW_DAILY_LIMIT_CENTS"), 0)
	c.WithdrawDailyCountLimit = int(parseIntEnv(os.Getenv("WITHDRAW_DAILY_COUNT_LIMIT"), 0))
	c.WithdrawMinAccountAgeSec = int(parseIntEnv(os.Getenv("WITHDRAW_MIN_ACCOUNT_AGE_SEC"), 0))
	c.KYCLargeWithdrawalThresholdCents = parseIntEnv(os.Getenv("KYC_LARGE_WITHDRAWAL_THRESHOLD_CENTS"), 100_000)
	c.KYCLargeDepositThresholdCents = parseIntEnv(os.Getenv("KYC_LARGE_DEPOSIT_THRESHOLD_CENTS"), 100_000)
	c.AMLLargeWithdrawalAlertThresholdCents = parseIntEnv(os.Getenv("AML_LARGE_WITHDRAWAL_ALERT_THRESHOLD_CENTS"), 200_000)
	c.OperatorDailyPayoutCapCents = parseIntEnv(os.Getenv("OPERATOR_DAILY_PAYOUT_CAP_CENTS"), 0)
	c.WalletAddressKEK = strings.TrimSpace(os.Getenv("WALLET_ADDRESS_KEK"))
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
	c.FingerprintSecretAPIKey = strings.TrimSpace(os.Getenv("FINGERPRINT_SECRET_API_KEY"))
	c.FingerprintAPIBaseURL = normalizeFingerprintBaseURL(os.Getenv("FINGERPRINT_API_BASE_URL"))
	if c.AppEnv == "" {
		c.AppEnv = "development"
	}
	c.RequireFingerprintPlayerAuth = requireFingerprintPlayerAuthFromEnv(os.Getenv("REQUIRE_FINGERPRINT_PLAYER_AUTH"), c.AppEnv)
	c.WithdrawRequireFingerprint = parseBoolEnv(os.Getenv("WITHDRAW_REQUIRE_FINGERPRINT"))
	// Kill-switch for hosts that still have legacy REQUIRE_* / WITHDRAW_* set: one env turns off all fingerprint_request_id enforcement.
	if parseBoolEnv(os.Getenv("DISABLE_FINGERPRINT_PLAYER_AUTH")) {
		c.RequireFingerprintPlayerAuth = false
		c.WithdrawRequireFingerprint = false
	}
	c.OddinEnabled = parseBoolEnv(os.Getenv("ODDIN_ENABLED"))
	c.OddinEnv = strings.TrimSpace(strings.ToLower(os.Getenv("ODDIN_ENV")))
	if c.OddinEnv == "" {
		c.OddinEnv = "integration"
	}
	c.OddinPublicBaseURL = strings.TrimSuffix(strings.TrimSpace(os.Getenv("ODDIN_PUBLIC_BASE_URL")), "/")
	c.OddinPublicScriptURL = strings.TrimSpace(os.Getenv("ODDIN_PUBLIC_SCRIPT_URL"))
	c.OddinBrandTokenPublic = strings.TrimSpace(os.Getenv("ODDIN_BRAND_TOKEN"))
	c.OddinAPISecurityKey = strings.TrimSpace(os.Getenv("ODDIN_API_SECURITY_KEY"))
	c.OddinHashSecret = strings.TrimSpace(os.Getenv("ODDIN_HASH_SECRET"))
	if raw := strings.TrimSpace(os.Getenv("ODDIN_TOKEN_TTL_SECONDS")); raw != "" {
		if n, err := strconv.ParseInt(raw, 10, 64); err == nil && n > 0 {
			c.OddinTokenTTLSeconds = int(n)
		}
	}
	if raw := strings.TrimSpace(os.Getenv("ODDIN_OPERATOR_IP_ALLOWLIST")); raw != "" {
		for _, p := range strings.Split(raw, ",") {
			p = strings.TrimSpace(p)
			if p != "" {
				c.OddinOperatorIPAllowlist = append(c.OddinOperatorIPAllowlist, p)
			}
		}
	}
	c.OddinEsportsNavJSON = strings.TrimSpace(os.Getenv("ODDIN_ESPORTS_NAV_JSON"))
	c.OddinTheme = strings.TrimSpace(os.Getenv("ODDIN_THEME"))
	c.OddinDefaultLanguage = strings.TrimSpace(os.Getenv("ODDIN_DEFAULT_LANGUAGE"))
	if c.OddinDefaultLanguage == "" {
		c.OddinDefaultLanguage = "en"
	}
	c.OddinDefaultCurrency = strings.TrimSpace(strings.ToUpper(os.Getenv("ODDIN_DEFAULT_CURRENCY")))
	if c.OddinDefaultCurrency == "" {
		c.OddinDefaultCurrency = "USD"
	}
	c.OddinDefaultCountry = strings.TrimSpace(strings.ToUpper(os.Getenv("ODDIN_DEFAULT_COUNTRY")))
	if strings.TrimSpace(os.Getenv("ODDIN_DARK_MODE")) == "" {
		c.OddinDarkMode = true
	} else {
		c.OddinDarkMode = parseBoolEnv(os.Getenv("ODDIN_DARK_MODE"))
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
	return c, nil
}

// DatabaseURLForMigrations returns the DSN for goose and one-off migrate CLIs.
// When MIGRATE_DATABASE_URL is set (e.g. Supabase direct host), migrations bypass the app pooler URL.
func (c *Config) DatabaseURLForMigrations() string {
	if c == nil {
		return ""
	}
	if strings.TrimSpace(c.MigrateDatabaseURL) != "" {
		return c.MigrateDatabaseURL
	}
	return c.DatabaseURL
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
	if c.RequireFingerprintPlayerAuth && !c.FingerprintConfigured() {
		return fmt.Errorf("APP_ENV=production: REQUIRE_FINGERPRINT_PLAYER_AUTH needs FINGERPRINT_SECRET_API_KEY (Fingerprint Server API) for identification enrichment and risk signals")
	}
	if c.UsesPassimpay() && !c.PassimPayConfigured() {
		return fmt.Errorf("APP_ENV=production: PAYMENT_PROVIDER=passimpay requires PASSIMPAY_PLATFORM_ID and PASSIMPAY_SECRET_KEY (or PASSIMPAY_API_KEY); or set PAYMENT_PROVIDER=none to start without crypto cashier")
	}
	// SEC-1: BlueOcean seamless wallet GET callback authenticates via key=sha1(salt+query).
	// An empty salt disables that check entirely — refuse to start in production.
	if strings.TrimSpace(c.BlueOceanWalletSalt) == "" {
		return fmt.Errorf("APP_ENV=production: BLUEOCEAN_WALLET_SALT is required (seamless wallet callback auth would otherwise be bypassed)")
	}
	// SEC-2: BlueOcean POST webhook authenticates via HMAC. Empty secret means HandleBlueOcean
	// returns 401 for every request (safe), but we still require an explicit secret in production
	// so operators do not forget — except ALLOW_PRODUCTION_MISSING_BLUEOCEAN_WEBHOOK_SECRET for bootstrap.
	if strings.TrimSpace(os.Getenv("WEBHOOK_BLUEOCEAN_SECRET")) == "" && !c.AllowProductionMissingBlueOceanWebhookSecret {
		return fmt.Errorf("APP_ENV=production: WEBHOOK_BLUEOCEAN_SECRET is required (HMAC for POST /v1/webhooks/blueocean). On Render: Environment → add WEBHOOK_BLUEOCEAN_SECRET (openssl rand -hex 32) and the same value in BlueOcean. Temporary bootstrap: ALLOW_PRODUCTION_MISSING_BLUEOCEAN_WEBHOOK_SECRET=true (webhook stays 401 until the secret is set)")
	}
	// SEC-3: separate player and staff JWT signing keys. Sharing JWT_SECRET creates a
	// defense-in-depth failure even if other audience/role checks block direct misuse.
	if strings.TrimSpace(c.PlayerJWTSecret) != "" && strings.TrimSpace(c.JWTSecret) != "" && c.PlayerJWTSecret == c.JWTSecret {
		return fmt.Errorf("APP_ENV=production: PLAYER_JWT_SECRET must differ from JWT_SECRET (set both to distinct openssl rand -hex 32 values)")
	}
	if strings.TrimSpace(c.JWTPlayerAudience) == "" {
		return fmt.Errorf("APP_ENV=production: JWT_PLAYER_AUDIENCE is required (audience claim must be enforced for player tokens)")
	}
	if strings.TrimSpace(c.JWTStaffAudience) == "" {
		return fmt.Errorf("APP_ENV=production: JWT_STAFF_AUDIENCE is required (audience claim must be enforced for staff tokens)")
	}
	// P10: PassimPay webhooks must reject invalid signatures in production. When fail-closed
	// is off, spoofed deposit credits are accepted as long as a row exists for the order_id.
	if c.UsesPassimpay() && !c.PassimpayFailClosed {
		return fmt.Errorf("APP_ENV=production: PASSIMPAY_FAIL_CLOSED must be true (set in Render env vars) to reject spoofed PassimPay webhooks")
	}
	// SEC-7: WALLET_ADDRESS_KEK is required so withdrawal destination
	// addresses are encrypted at rest. The cipher is AES-256-GCM; the env
	// var must be exactly 32 bytes hex-encoded.
	if strings.TrimSpace(c.WalletAddressKEK) == "" {
		return fmt.Errorf("APP_ENV=production: WALLET_ADDRESS_KEK is required (32-byte hex; openssl rand -hex 32) to encrypt withdrawal addresses at rest")
	}
	return nil
}

// UsesPassimpay is true when PAYMENT_PROVIDER=passimpay (case-insensitive).
func (c *Config) UsesPassimpay() bool {
	return c != nil && strings.EqualFold(strings.TrimSpace(c.PaymentProvider), "passimpay")
}

// PassimPayConfigured is true when outbound API calls can be authenticated.
func (c *Config) PassimPayConfigured() bool {
	if c == nil {
		return false
	}
	return strings.TrimSpace(c.PassimpaySecretKey) != "" && c.PassimpayPlatformID != 0 && strings.TrimSpace(c.PassimpayAPIBaseURL) != ""
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

// normalizeFingerprintBaseURL defaults to the US Server API and prepends https:// when the scheme is omitted
// (e.g. plain eu.api.fpjs.io from a dashboard copy-paste), so GET /events requests hit a valid URL.
func normalizeFingerprintBaseURL(raw string) string {
	s := strings.TrimSuffix(strings.TrimSpace(raw), "/")
	if s == "" {
		return "https://api.fpjs.io"
	}
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
		return s
	}
	return "https://" + s
}

// FingerprintConfigured is true when Server API secret is set (GET /events/{request_id} enrichment).
func (c *Config) FingerprintConfigured() bool {
	if c == nil {
		return false
	}
	return strings.TrimSpace(c.FingerprintSecretAPIKey) != ""
}

// PlayerFingerprintAuthRequired is true when player auth and aligned routes must receive fingerprint_request_id.
// APP_ENV=development never requires it so local core works without VITE_FINGERPRINT_PUBLIC_KEY; use APP_ENV=staging
// to mirror production fingerprint rules on a local API.
func (c *Config) PlayerFingerprintAuthRequired() bool {
	if c == nil {
		return false
	}
	if strings.TrimSpace(strings.ToLower(c.AppEnv)) == "development" {
		return false
	}
	return c.RequireFingerprintPlayerAuth
}

func parseBoolEnv(s string) bool {
	s = strings.TrimSpace(strings.ToLower(s))
	return s == "1" || s == "true" || s == "yes"
}

// requireFingerprintPlayerAuthFromEnv: Fingerprint on auth/traffic is opt-in (legacy).
// When REQUIRE_FINGERPRINT_PLAYER_AUTH is unset, default false. Set to true/1/yes to re-enable.
func requireFingerprintPlayerAuthFromEnv(raw string, appEnv string) bool {
	s := strings.TrimSpace(strings.ToLower(raw))
	if s != "" {
		return parseBoolEnv(raw)
	}
	_ = appEnv // previously defaulted true in production; kept for signature stability in callers
	return false
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

// OddinIntegrationEnabled mirrors ODDIN_ENABLED (operator iframe token + callbacks).
func (c *Config) OddinIntegrationEnabled() bool {
	return c != nil && c.OddinEnabled
}

// OddinEnvLabel returns integration or production for diagnostics.
func (c *Config) OddinEnvLabel() string {
	if c == nil || strings.TrimSpace(c.OddinEnv) == "" {
		return "integration"
	}
	return strings.TrimSpace(strings.ToLower(c.OddinEnv))
}

// OddinFallbackCountryISO2 returns ODDIN_DEFAULT_COUNTRY when it is a 2-letter code; otherwise "US".
func (c *Config) OddinFallbackCountryISO2() string {
	if c != nil {
		cc := strings.TrimSpace(strings.ToUpper(c.OddinDefaultCountry))
		if len(cc) == 2 {
			return cc
		}
	}
	return "US"
}

// OddinOperatorIPAllowed returns true when IP matches allowlist or allowlist is disabled (empty).
func (c *Config) OddinOperatorIPAllowed(ip string) bool {
	if c == nil || len(c.OddinOperatorIPAllowlist) == 0 {
		return true
	}
	ip = strings.TrimSpace(ip)
	for _, a := range c.OddinOperatorIPAllowlist {
		if strings.TrimSpace(a) == ip {
			return true
		}
	}
	return false
}
