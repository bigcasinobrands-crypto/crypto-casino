package jwtissuer

import (
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strings"
	"time"

	jwt "github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const defaultKID = "default"

// Issuer signs player and staff JWTs using RS256 when RSAKey is set, otherwise HS256 with per-role HMAC secrets.
type Issuer struct {
	PlayerHMAC      []byte
	StaffHMAC       []byte
	RSAKey          *rsa.PrivateKey
	Issuer          string
	PlayerAudience  string
	StaffAudience   string
	PlayerAccessTTL time.Duration
	StaffAccessTTL  time.Duration
}

// PlayerAccessTTLSeconds for JSON token responses.
func (i *Issuer) PlayerAccessTTLSeconds() int64 {
	if i == nil || i.PlayerAccessTTL <= 0 {
		return int64((15 * time.Minute) / time.Second)
	}
	return int64(i.PlayerAccessTTL / time.Second)
}

// StaffAccessTTLSeconds is the staff access JWT lifetime in seconds (for JSON clients).
func (i *Issuer) StaffAccessTTLSeconds() int64 {
	if i == nil || i.StaffAccessTTL <= 0 {
		return int64((15 * time.Minute) / time.Second)
	}
	return int64(i.StaffAccessTTL / time.Second)
}

func (i *Issuer) playerTTL() time.Duration {
	if i != nil && i.PlayerAccessTTL > 0 {
		return i.PlayerAccessTTL
	}
	return 15 * time.Minute
}

func (i *Issuer) staffTTL() time.Duration {
	if i != nil && i.StaffAccessTTL > 0 {
		return i.StaffAccessTTL
	}
	return 15 * time.Minute
}

type playerClaims struct {
	UserID string `json:"uid"`
	jwt.RegisteredClaims
}

type staffClaims struct {
	StaffID string `json:"sid"`
	Role    string `json:"role"`
	jwt.RegisteredClaims
}

func (i *Issuer) playerKeyFunc() jwt.Keyfunc {
	return func(t *jwt.Token) (any, error) {
		switch t.Method.Alg() {
		case jwt.SigningMethodRS256.Alg():
			if i != nil && i.RSAKey != nil {
				return &i.RSAKey.PublicKey, nil
			}
			return nil, fmt.Errorf("rs256 not configured")
		case jwt.SigningMethodHS256.Alg():
			if i != nil && len(i.PlayerHMAC) > 0 {
				return i.PlayerHMAC, nil
			}
			return nil, fmt.Errorf("hs256 player secret not configured")
		default:
			return nil, fmt.Errorf("unexpected signing method %s", t.Header["alg"])
		}
	}
}

func (i *Issuer) staffKeyFunc() jwt.Keyfunc {
	return func(t *jwt.Token) (any, error) {
		switch t.Method.Alg() {
		case jwt.SigningMethodRS256.Alg():
			if i != nil && i.RSAKey != nil {
				return &i.RSAKey.PublicKey, nil
			}
			return nil, fmt.Errorf("rs256 not configured")
		case jwt.SigningMethodHS256.Alg():
			if i != nil && len(i.StaffHMAC) > 0 {
				return i.StaffHMAC, nil
			}
			return nil, fmt.Errorf("hs256 staff secret not configured")
		default:
			return nil, fmt.Errorf("unexpected signing method %s", t.Header["alg"])
		}
	}
}

// SignPlayer returns access token, jti, exp unix.
func (i *Issuer) SignPlayer(userID string) (raw, jti string, expUnix int64, err error) {
	if i == nil {
		return "", "", 0, errors.New("issuer nil")
	}
	now := time.Now()
	exp := now.Add(i.playerTTL())
	jti = uuid.NewString()
	claims := playerClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			ID:        jti,
		},
	}
	if iss := strings.TrimSpace(i.Issuer); iss != "" {
		claims.Issuer = iss
	}
	if aud := strings.TrimSpace(i.PlayerAudience); aud != "" {
		claims.Audience = jwt.ClaimStrings{aud}
	}
	var tok *jwt.Token
	if i.RSAKey != nil {
		tok = jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		tok.Header["kid"] = defaultKID
	} else {
		tok = jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	}
	s, err := tok.SignedString(signingKeyPlayer(i))
	if err != nil {
		return "", "", 0, err
	}
	return s, jti, exp.Unix(), nil
}

func signingKeyPlayer(i *Issuer) any {
	if i.RSAKey != nil {
		return i.RSAKey
	}
	return i.PlayerHMAC
}

func signingKeyStaff(i *Issuer) any {
	if i.RSAKey != nil {
		return i.RSAKey
	}
	return i.StaffHMAC
}

// SignStaff creates a staff access token.
func (i *Issuer) SignStaff(staffID, role string) (raw, jti string, expUnix int64, err error) {
	if i == nil {
		return "", "", 0, errors.New("issuer nil")
	}
	now := time.Now()
	exp := now.Add(i.staffTTL())
	jti = uuid.NewString()
	claims := staffClaims{
		StaffID: staffID,
		Role:    role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   staffID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			ID:        jti,
		},
	}
	if iss := strings.TrimSpace(i.Issuer); iss != "" {
		claims.Issuer = iss
	}
	if aud := strings.TrimSpace(i.StaffAudience); aud != "" {
		claims.Audience = jwt.ClaimStrings{aud}
	}
	var tok *jwt.Token
	if i.RSAKey != nil {
		tok = jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		tok.Header["kid"] = defaultKID
	} else {
		tok = jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	}
	s, err := tok.SignedString(signingKeyStaff(i))
	if err != nil {
		return "", "", 0, err
	}
	return s, jti, exp.Unix(), nil
}

// ParsePlayer validates audience and returns user id and jti.
func (i *Issuer) ParsePlayer(tokenString string) (userID, jti string, err error) {
	if i == nil {
		return "", "", errors.New("issuer nil")
	}
	t, err := jwt.ParseWithClaims(tokenString, &playerClaims{}, i.playerKeyFunc())
	if err != nil {
		return "", "", err
	}
	claims, ok := t.Claims.(*playerClaims)
	if !ok || !t.Valid {
		return "", "", errors.New("invalid token")
	}
	if err := i.verifyAud(claims.Audience, i.PlayerAudience); err != nil {
		return "", "", err
	}
	return claims.UserID, claims.ID, nil
}

// ParseStaff validates audience and returns staff id, role, jti.
func (i *Issuer) ParseStaff(tokenString string) (staffID, role, jti string, err error) {
	if i == nil {
		return "", "", "", errors.New("issuer nil")
	}
	t, err := jwt.ParseWithClaims(tokenString, &staffClaims{}, i.staffKeyFunc())
	if err != nil {
		return "", "", "", err
	}
	claims, ok := t.Claims.(*staffClaims)
	if !ok || !t.Valid {
		return "", "", "", errors.New("invalid token")
	}
	if err := i.verifyAud(claims.Audience, i.StaffAudience); err != nil {
		return "", "", "", err
	}
	return claims.StaffID, claims.Role, claims.ID, nil
}

func (i *Issuer) verifyAud(aud jwt.ClaimStrings, expected string) error {
	expected = strings.TrimSpace(expected)
	if expected == "" {
		return nil
	}
	for _, a := range aud {
		if a == expected {
			return nil
		}
	}
	return fmt.Errorf("invalid audience")
}

// JWKSJSON returns OIDC-style JWKS for RS256 public key (or empty if not RSA).
func (i *Issuer) JWKSJSON() ([]byte, error) {
	if i == nil || i.RSAKey == nil {
		return []byte(`{"keys":[]}`), nil
	}
	n := encodeB64URL(i.RSAKey.PublicKey.N.Bytes())
	e := encodeB64URL(big.NewInt(int64(i.RSAKey.PublicKey.E)).Bytes())
	key := map[string]any{
		"kty": "RSA",
		"kid": defaultKID,
		"use": "sig",
		"alg": "RS256",
		"n":   n,
		"e":   e,
	}
	out := map[string]any{"keys": []any{key}}
	return json.Marshal(out)
}

func encodeB64URL(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

// LoadRSAPrivateKeyFromFile reads a PKCS1 or PKCS8 PEM private key.
func LoadRSAPrivateKeyFromFile(path string) (*rsa.PrivateKey, error) {
	pemData, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParseRSAPrivateKeyPEM(pemData)
}

// ParseRSAPrivateKeyPEM decodes PEM (PKCS1 or PKCS#8) into an RSA private key.
func ParseRSAPrivateKeyPEM(pemData []byte) (*rsa.PrivateKey, error) {
	var lastErr error
	for len(pemData) > 0 {
		var block *pem.Block
		block, pemData = pem.Decode(pemData)
		if block == nil {
			break
		}
		if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
			if rsaKey, ok := k.(*rsa.PrivateKey); ok {
				return rsaKey, nil
			}
		}
		if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
			return k, nil
		}
		lastErr = fmt.Errorf("unsupported pem block type %s", block.Type)
	}
	if pk, err := jwt.ParseRSAPrivateKeyFromPEM(pemData); err == nil {
		return pk, nil
	} else if lastErr != nil {
		return nil, lastErr
	}
	return nil, errors.New("no rsa private key in pem")
}

// JTIHash returns a short redis key fragment for jti (optional; avoids ultra-long keys).
func JTIHash(jti string) string {
	if jti == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(jti))
	return base64.RawURLEncoding.EncodeToString(sum[:16])
}
