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
	DatabaseURL       string
	Port              string
	JWTSecret         string
	PlayerJWTSecret   string
	AdminCORSOrigins  []string
	PlayerCORSOrigins []string
	RedisURL          string
	// Player auth baseline
	PublicPlayerURL string
	TurnstileSecret string
	SMTPHost        string
	SMTPPort        string
	SMTPUser        string
	SMTPPassword    string
	SMTPFrom        string
	TermsVersion    string
	PrivacyVersion  string
	// Blue Ocean Gaming XAPI (server-to-server)
	BlueOceanAPIBaseURL    string
	BlueOceanAPILogin      string
	BlueOceanAPIPassword   string
	BlueOceanAgentID       string
	BlueOceanCurrency      string
	BlueOceanMulticurrency bool
	BlueOceanLaunchMode   string // "demo" | "real"
	BlueOceanWalletSalt    string // seamless GET callback key=sha1(salt+query)
	BlueOceanFeaturedIDHashes []string
	BlueOceanLobbyTagsJSON string // optional JSON map pill_id -> [id_hash]
	// Catalog sync: getGameList often returns one page only; use paging to load full staging catalogs.
	BlueOceanCatalogPageSize    int    // 0 = single request (no limit/offset params); default 500
	BlueOceanCatalogPagingStyle string // offset | page | from — query param shape for paging
	BlueOceanImageBaseURL       string // optional origin for relative thumbnail paths from the API
	// Operations
	MaintenanceMode       bool
	DisableGameLaunch     bool
	SupportCRMURLTemplate string // e.g. https://desk.example/ticket?user={user_id}
	// Phase 2 legal stub: ISO 3166-1 alpha-2 codes, comma-separated (empty = no block)
	BlockedCountryCodes []string
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
}

// FystackDepositAssetCanonicalKeys are the standard on-chain deposit combinations we surface in admin UI.
func FystackDepositAssetCanonicalKeys() []string {
	return []string{"USDT_ERC20", "USDT_TRC20", "USDT_BEP20", "USDC_ERC20", "USDC_TRC20", "USDC_BEP20"}
}

func Load() (Config, error) {
	_ = godotenv.Load()
	_ = godotenv.Load("../../.env")

	c := Config{
		DatabaseURL: strings.TrimSpace(os.Getenv("DATABASE_URL")),
		Port:        strings.TrimSpace(os.Getenv("PORT")),
		JWTSecret:   strings.TrimSpace(os.Getenv("JWT_SECRET")),
		RedisURL:    strings.TrimSpace(os.Getenv("REDIS_URL")),
	}
	if c.Port == "" {
		c.Port = "8080"
	}
	c.AdminCORSOrigins = parseOriginsList(os.Getenv("ADMIN_CORS_ORIGINS"), []string{"http://localhost:5173"})
	c.PlayerCORSOrigins = parseOriginsList(os.Getenv("PLAYER_CORS_ORIGINS"), []string{"http://localhost:5174"})
	c.PlayerJWTSecret = strings.TrimSpace(os.Getenv("PLAYER_JWT_SECRET"))
	if c.PlayerJWTSecret == "" {
		c.PlayerJWTSecret = c.JWTSecret
	}
	c.PublicPlayerURL = strings.TrimSpace(os.Getenv("PUBLIC_PLAYER_URL"))
	if c.PublicPlayerURL == "" {
		c.PublicPlayerURL = "http://localhost:5174"
	}
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
	c.BlueOceanWalletSalt = strings.TrimSpace(os.Getenv("BLUEOCEAN_WALLET_SALT"))
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
	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if len(c.JWTSecret) < 32 {
		return c, fmt.Errorf("JWT_SECRET must be at least 32 characters")
	}
	if len(c.PlayerJWTSecret) < 32 {
		return c, fmt.Errorf("PLAYER_JWT_SECRET must be at least 32 characters when set; defaults to JWT_SECRET")
	}
	return c, nil
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
	if c == nil || strings.TrimSpace(c.FystackCheckoutAssets) == "" {
		return []string{"USDC:1", "ETH:1"}
	}
	var out []string
	for _, p := range strings.Split(c.FystackCheckoutAssets, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func parseBoolEnv(s string) bool {
	s = strings.TrimSpace(strings.ToLower(s))
	return s == "1" || s == "true" || s == "yes"
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
