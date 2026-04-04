package jwtplayer

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const accessTTL = 15 * time.Minute

type AccessClaims struct {
	UserID string `json:"uid"`
	jwt.RegisteredClaims
}

func AccessTTLSeconds() int64 {
	return int64(accessTTL / time.Second)
}

func SignAccess(secret []byte, userID string) (string, int64, error) {
	now := time.Now()
	exp := now.Add(accessTTL)
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, AccessClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(now),
			Subject:   userID,
		},
	})
	s, err := t.SignedString(secret)
	if err != nil {
		return "", 0, err
	}
	return s, exp.Unix(), nil
}

func ParseAccess(secret []byte, tokenString string) (userID string, err error) {
	t, err := jwt.ParseWithClaims(tokenString, &AccessClaims{}, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return secret, nil
	})
	if err != nil {
		return "", err
	}
	claims, ok := t.Claims.(*AccessClaims)
	if !ok || !t.Valid {
		return "", fmt.Errorf("invalid token")
	}
	return claims.UserID, nil
}
