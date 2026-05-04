package playerauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/config"
	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/crypto-casino/core/internal/jtiredis"
	"github.com/crypto-casino/core/internal/jwtissuer"
	"github.com/crypto-casino/core/internal/mail"
	"github.com/crypto-casino/core/internal/passhash"
	"github.com/crypto-casino/core/internal/pii"
	"github.com/jackc/pgx/v5/pgxpool"
)

const refreshTTL = 7 * 24 * time.Hour

var ErrInvalidCredentials = errors.New("invalid credentials")
var ErrTermsNotAccepted = errors.New("terms not accepted")
// ErrSessionPersist is returned when DB insert or token signing fails after the user is authenticated (e.g. missing player_sessions columns).
var ErrSessionPersist = errors.New("session persist failed")

// FystackWalletProvisioner creates a custodial wallet after signup (optional).
type FystackWalletProvisioner interface {
	Provision(ctx context.Context, userID string) error
}

// PwnedPasswordChecker optionally rejects passwords present in the HIBP corpus (k-anonymity range API).
type PwnedPasswordChecker interface {
	IsCompromised(ctx context.Context, password string) (bool, error)
}

// Service holds player-auth business logic.
type Service struct {
	Pool            *pgxpool.Pool
	Issuer          *jwtissuer.Issuer
	JTI             *jtiredis.Revoker
	Mail            mail.Sender
	PublicPlayerURL string
	TermsVersion    string
	PrivacyVersion  string
	Fystack         FystackWalletProvisioner
	Pwned           PwnedPasswordChecker
	DataDir         string
	// EmailLookupSecret — when non-empty, writes users.email_hmac on register and backfills on login (PII_EMAIL_LOOKUP_SECRET).
	EmailLookupSecret string
	// Fingerprint + app config for enriching player_sessions (optional).
	Fingerprint *fingerprint.Client
	Cfg         *config.Config
}

func (s *Service) rejectIfPwnedPassword(ctx context.Context, password string) error {
	if s == nil || s.Pwned == nil {
		return nil
	}
	bad, err := s.Pwned.IsCompromised(ctx, password)
	if err != nil {
		return nil // fail-open when the breach API is unavailable
	}
	if bad {
		return ErrPwnedPassword
	}
	return nil
}

func (s *Service) Register(ctx context.Context, email, password, username string, acceptTerms, acceptPrivacy bool, sc *SessionContext) (accessToken, refreshToken string, exp int64, err error) {
	email = strings.ToLower(strings.TrimSpace(email))
	username = strings.TrimSpace(username)
	if email == "" {
		return "", "", 0, ErrInvalidCredentials
	}
	if !acceptTerms || !acceptPrivacy {
		return "", "", 0, ErrTermsNotAccepted
	}
	if err := ValidatePassword(password); err != nil {
		return "", "", 0, err
	}
	if err := s.rejectIfPwnedPassword(ctx, password); err != nil {
		return "", "", 0, err
	}
	if username != "" {
		if err := validateUsername(username); err != nil {
			return "", "", 0, err
		}
	}
	var taken bool
	_ = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE lower(email) = lower($1))`, email).Scan(&taken)
	if taken {
		return "", "", 0, ErrInvalidCredentials
	}
	if username != "" {
		var nameTaken bool
		_ = s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE lower(username) = lower($1))`, username).Scan(&nameTaken)
		if nameTaken {
			return "", "", 0, ErrUsernameTaken
		}
	}
	tv, pv := s.TermsVersion, s.PrivacyVersion
	if tv == "" {
		tv = "1"
	}
	if pv == "" {
		pv = "1"
	}
	hash, err := passhash.Hash(password)
	if err != nil {
		return "", "", 0, err
	}
	var usernameVal *string
	if username != "" {
		usernameVal = &username
	}
	var emailHMAC interface{}
	if b := pii.EmailLookupHMACBytes(s.EmailLookupSecret, email); len(b) > 0 {
		emailHMAC = b
	}
	var id string
	err = s.Pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, username, terms_accepted_at, terms_version, privacy_version, email_hmac)
		VALUES ($1, $2, $3, now(), $4, $5, $6) RETURNING id::text
	`, email, string(hash), usernameVal, tv, pv, emailHMAC).Scan(&id)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	_, _ = s.Pool.Exec(ctx, `
		INSERT INTO player_vip_state (user_id, tier_id, points_balance, lifetime_wager_minor, updated_at)
		VALUES ($1::uuid, NULL, 0, 0, now())
		ON CONFLICT (user_id) DO NOTHING
	`, id)
	accessToken, refreshToken, exp, err = s.issueSession(ctx, id, sc)
	if err != nil {
		return "", "", 0, err
	}
	if s.Mail != nil {
		go func(uid, em string) {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			_ = s.sendVerificationEmail(ctx, uid, em)
		}(id, email)
	}
	if s.Fystack != nil {
		go func(uid string) {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			_ = s.Fystack.Provision(ctx, uid)
		}(id)
	}
	return accessToken, refreshToken, exp, nil
}

func (s *Service) Login(ctx context.Context, emailOrUsername, password string, sc *SessionContext) (accessToken, refreshToken string, exp int64, err error) {
	identifier := strings.TrimSpace(emailOrUsername)
	if identifier == "" {
		return "", "", 0, ErrInvalidCredentials
	}
	var id, phash, emailStored string
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text, password_hash, email FROM users
		WHERE lower(email) = lower($1)
		   OR (username IS NOT NULL AND lower(username) = lower($1))
	`, identifier).Scan(&id, &phash, &emailStored)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	ok, rehash, err := passhash.Verify(password, phash)
	if err != nil || !ok {
		return "", "", 0, ErrInvalidCredentials
	}
	if rehash {
		newH, err := passhash.Hash(password)
		if err == nil {
			_, _ = s.Pool.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2::uuid`, newH, id)
		}
	}
	if b := pii.EmailLookupHMACBytes(s.EmailLookupSecret, emailStored); len(b) > 0 {
		_, _ = s.Pool.Exec(ctx, `UPDATE users SET email_hmac = $1 WHERE id = $2::uuid AND email_hmac IS NULL`, b, id)
	}
	if err := s.assertUserPlayAllowed(ctx, id); err != nil {
		return "", "", 0, err
	}
	if s.Fystack != nil {
		go func(uid string) {
			pctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()
			_ = s.Fystack.Provision(pctx, uid)
		}(id)
	}
	return s.issueSession(ctx, id, sc)
}

func (s *Service) issueSession(ctx context.Context, userID string, sc *SessionContext) (access, refresh string, exp int64, err error) {
	if s.Issuer == nil {
		return "", "", 0, fmt.Errorf("%w: jwt issuer not configured", ErrSessionPersist)
	}
	plain, hashHex, err := newRefreshToken()
	if err != nil {
		return "", "", 0, fmt.Errorf("%w: %w", ErrSessionPersist, err)
	}
	expT := time.Now().UTC().Add(refreshTTL)
	cip, ua, fvid, frid, cc, reg, city, dev, gsrc := s.sessionFields(ctx, sc)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO player_sessions (
			user_id, refresh_token_hash, expires_at, family_id,
			client_ip, user_agent, fingerprint_visitor_id, fingerprint_request_id,
			country_iso2, region, city, device_type, geo_source, last_seen_at
		)
		VALUES ($1::uuid, $2, $3, gen_random_uuid(),
			NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''),
			NULLIF($8,''), NULLIF($9,''), NULLIF($10,''), NULLIF($11,''), NULLIF($12,''), now())
	`, userID, hashHex, expT, cip, ua, fvid, frid, cc, reg, city, dev, gsrc)
	if err != nil {
		log.Printf("playerauth: player_sessions insert failed: %v", err)
		if strings.Contains(err.Error(), "family_id") {
			log.Printf("playerauth: hint — run DB migrations through 00054_session_refresh_family (family_id column)")
		}
		if strings.Contains(strings.ToLower(err.Error()), "column") {
			log.Printf("playerauth: hint — run DB migrations through 00063_player_sessions_client_meta if client_ip / fingerprint columns are missing")
		}
		return "", "", 0, fmt.Errorf("%w: %w", ErrSessionPersist, err)
	}
	access, _, exp, err = s.Issuer.SignPlayer(userID)
	if err != nil {
		return "", "", 0, fmt.Errorf("%w: %w", ErrSessionPersist, err)
	}
	return access, plain, exp, nil
}

func (s *Service) Refresh(ctx context.Context, refreshPlain string, sc *SessionContext) (access, refresh string, exp int64, err error) {
	refreshPlain = strings.TrimSpace(refreshPlain)
	if refreshPlain == "" {
		return "", "", 0, ErrInvalidCredentials
	}
	if s.Issuer == nil {
		return "", "", 0, fmt.Errorf("%w: jwt issuer not configured", ErrSessionPersist)
	}
	h := hashRefresh(refreshPlain)
	var sid, uid, fam string
	var ex time.Time
	err = s.Pool.QueryRow(ctx, `
		SELECT id::text, user_id::text, expires_at, family_id::text FROM player_sessions WHERE refresh_token_hash = $1
	`, h).Scan(&sid, &uid, &ex, &fam)
	if err != nil {
		return "", "", 0, ErrInvalidCredentials
	}
	if time.Now().UTC().After(ex) {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM player_sessions WHERE id = $1::uuid`, sid)
		return "", "", 0, ErrInvalidCredentials
	}
	if err := s.assertUserPlayAllowed(ctx, uid); err != nil {
		return "", "", 0, err
	}
	_, _ = s.Pool.Exec(ctx, `DELETE FROM player_sessions WHERE id = $1::uuid`, sid)
	plain, nh, err := newRefreshToken()
	if err != nil {
		return "", "", 0, fmt.Errorf("%w: %w", ErrSessionPersist, err)
	}
	cip, ua, fvid, frid, cc, reg, city, dev, gsrc := s.sessionFields(ctx, sc)
	_, err = s.Pool.Exec(ctx, `
		INSERT INTO player_sessions (
			user_id, refresh_token_hash, expires_at, family_id,
			client_ip, user_agent, fingerprint_visitor_id, fingerprint_request_id,
			country_iso2, region, city, device_type, geo_source, last_seen_at
		)
		VALUES ($1::uuid, $2, $3, $4::uuid,
			NULLIF($5,''), NULLIF($6,''), NULLIF($7,''), NULLIF($8,''),
			NULLIF($9,''), NULLIF($10,''), NULLIF($11,''), NULLIF($12,''), NULLIF($13,''), now())
	`, uid, nh, time.Now().UTC().Add(refreshTTL), fam, cip, ua, fvid, frid, cc, reg, city, dev, gsrc)
	if err != nil {
		log.Printf("playerauth: player_sessions refresh insert failed: %v", err)
		return "", "", 0, fmt.Errorf("%w: %w", ErrSessionPersist, err)
	}
	access, _, exp, err = s.Issuer.SignPlayer(uid)
	if err != nil {
		return "", "", 0, fmt.Errorf("%w: %w", ErrSessionPersist, err)
	}
	return access, plain, exp, nil
}

// RevokeAccessJTI invalidates the access token in Authorization header (best-effort).
func (s *Service) RevokeAccessJTI(ctx context.Context, authHeader string) {
	s.RevokeAccessRaw(ctx, bearerRawFromHeader(authHeader))
}

// RevokeAccessRaw revokes a raw JWT access token (e.g. from httpOnly cookie on logout).
func (s *Service) RevokeAccessRaw(ctx context.Context, rawJWT string) {
	if s == nil || s.Issuer == nil || s.JTI == nil || s.JTI.Rdb == nil {
		return
	}
	rawJWT = strings.TrimSpace(rawJWT)
	if rawJWT == "" {
		return
	}
	_, jti, err := s.Issuer.ParsePlayer(rawJWT)
	if err != nil || jti == "" {
		return
	}
	_ = s.JTI.Revoke(ctx, jti, 30*time.Minute)
}

func bearerRawFromHeader(authHeader string) string {
	const p = "bearer "
	if len(authHeader) < len(p) || strings.ToLower(authHeader[:len(p)]) != p {
		return ""
	}
	return strings.TrimSpace(authHeader[len(p):])
}

func (s *Service) Logout(ctx context.Context, refreshPlain string) error {
	refreshPlain = strings.TrimSpace(refreshPlain)
	if refreshPlain == "" {
		return ErrInvalidCredentials
	}
	tag, err := s.Pool.Exec(ctx, `DELETE FROM player_sessions WHERE refresh_token_hash = $1`, hashRefresh(refreshPlain))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidCredentials
	}
	return nil
}

// ListSessions returns non-expired refresh-token rows with device/geo metadata for the account owner UI and admin.
func (s *Service) ListSessions(ctx context.Context, userID string) ([]map[string]any, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id::text, family_id::text, created_at, expires_at, last_seen_at,
			client_ip, user_agent, country_iso2, region, city, device_type,
			fingerprint_visitor_id, geo_source,
			CASE WHEN fingerprint_request_id = '' THEN false ELSE true END AS has_fingerprint_request
		FROM player_sessions
		WHERE user_id = $1::uuid AND expires_at > now()
		ORDER BY last_seen_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, fam, cip, ua, cc, reg, city, dev, fvid, gsrc string
		var hasFP bool
		var created, exp, seen time.Time
		if err := rows.Scan(&id, &fam, &created, &exp, &seen, &cip, &ua, &cc, &reg, &city, &dev, &fvid, &gsrc, &hasFP); err != nil {
			return nil, err
		}
		m := map[string]any{
			"id":                      id,
			"family_id":               fam,
			"created_at":              created.UTC().Format(time.RFC3339),
			"expires_at":              exp.UTC().Format(time.RFC3339),
			"last_seen_at":            seen.UTC().Format(time.RFC3339),
			"client_ip":               cip,
			"user_agent":              ua,
			"country_iso2":            cc,
			"region":                  reg,
			"city":                    city,
			"device_type":             dev,
			"fingerprint_visitor_id":  fvid,
			"geo_source":              gsrc,
			"has_fingerprint_request":   hasFP,
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Service) assertUserPlayAllowed(ctx context.Context, userID string) error {
	var closed *time.Time
	var until *time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT account_closed_at, self_excluded_until FROM users WHERE id = $1::uuid
	`, userID).Scan(&closed, &until)
	if err != nil {
		return ErrInvalidCredentials
	}
	if closed != nil {
		return ErrInvalidCredentials
	}
	if until != nil && until.After(time.Now()) {
		return ErrInvalidCredentials
	}
	return nil
}

// sessionFields merges edge geo, client hints, and optional Fingerprint Server API enrichment.
func (s *Service) sessionFields(ctx context.Context, sc *SessionContext) (
	clientIP, userAgent, fpVid, fpRid, country, region, city, device, geoSource string,
) {
	device = "unknown"
	if sc == nil {
		return "", "", "", "", "", "", "", device, ""
	}
	clientIP = truncateStr(sc.IP, 64)
	userAgent = truncateStr(sc.UserAgent, 1024)
	fpVid = truncateStr(sc.FingerprintVisitorID, 128)
	fpRid = truncateStr(sc.FingerprintRequestID, 128)
	country = fingerprint.NormalizeCountryISO2(sc.GeoCountryHeader)
	if country != "" {
		geoSource = "edge"
	}
	if s != nil && s.Fingerprint != nil && s.Cfg != nil && s.Cfg.FingerprintConfigured() && fpRid != "" {
		ctxFP, cancel := context.WithTimeout(ctx, fingerprint.ServerAPIEnrichmentTimeout)
		ev, err := s.Fingerprint.GetEvent(ctxFP, fpRid)
		cancel()
		if err == nil && ev != nil {
			fpCC, fpDev := fingerprint.TrafficEnrichment(ev)
			if country == "" && fpCC != "" {
				country = fpCC
				geoSource = "fingerprint"
			}
			if fpDev != "unknown" {
				device = fpDev
			}
			m := fingerprint.LedgerMetaFromEvent(ev)
			if v, ok := m["geo_region"].(string); ok {
				region = truncateStr(v, 128)
			}
			if v, ok := m["geo_city"].(string); ok {
				city = truncateStr(v, 128)
			}
			if clientIP == "" {
				if v, ok := m["ip_address"].(string); ok && strings.TrimSpace(v) != "" {
					clientIP = truncateStr(v, 64)
				}
			}
		}
	}
	return clientIP, userAgent, fpVid, fpRid, country, region, city, device, geoSource
}

func newRefreshToken() (plain string, hashHex string, err error) {
	var b [32]byte
	if _, err = rand.Read(b[:]); err != nil {
		return "", "", err
	}
	plain = base64.RawURLEncoding.EncodeToString(b[:])
	return plain, hashRefresh(plain), nil
}

func hashRefresh(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}
