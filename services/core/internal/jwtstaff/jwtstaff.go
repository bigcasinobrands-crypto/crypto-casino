package jwtstaff

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const accessTTL = 15 * time.Minute

// AccessTTLSeconds is the access JWT lifetime in seconds (for JSON clients).
func AccessTTLSeconds() int64 {
	return int64(accessTTL / time.Second)
}

type AccessClaims struct {
	StaffID string `json:"sid"`
	Role    string `json:"role"`
	jwt.RegisteredClaims
}

func SignAccess(secret []byte, staffID, role string) (string, int64, error) {
	now := time.Now()
	exp := now.Add(accessTTL)
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, AccessClaims{
		StaffID: staffID,
		Role:    role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(now),
			Subject:   staffID,
		},
	})
	s, err := t.SignedString(secret)
	if err != nil {
		return "", 0, err
	}
	return s, exp.Unix(), nil
}

func ParseAccess(secret []byte, tokenString string) (staffID, role string, err error) {
	t, err := jwt.ParseWithClaims(tokenString, &AccessClaims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return secret, nil
	})
	if err != nil {
		return "", "", err
	}
	claims, ok := t.Claims.(*AccessClaims)
	if !ok || !t.Valid {
		return "", "", fmt.Errorf("invalid token")
	}
	return claims.StaffID, claims.Role, nil
}
