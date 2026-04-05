package config

import (
	"fmt"
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
