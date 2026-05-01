package passhash

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

const (
	argon2Time    = 3
	argon2Memory  = 64 * 1024
	argon2Threads = 4
	argon2KeyLen  = 32
	argon2SaltLen = 16
)

// Hash returns a PHC-style Argon2id encoding for new passwords.
func Hash(plain string) (string, error) {
	if plain == "" {
		return "", errors.New("empty password")
	}
	salt := make([]byte, argon2SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(plain), salt, argon2Time, argon2Memory, argon2Threads, argon2KeyLen)
	encSalt := base64.RawStdEncoding.EncodeToString(salt)
	encKey := base64.RawStdEncoding.EncodeToString(key)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", argon2Memory, argon2Time, argon2Threads, encSalt, encKey), nil
}

// Verify checks plain against a stored bcrypt or Argon2id hash.
// rehash is true when the password matched legacy bcrypt and should be upgraded to Argon2id.
func Verify(plain, stored string) (ok bool, rehash bool, err error) {
	stored = strings.TrimSpace(stored)
	if stored == "" || plain == "" {
		return false, false, nil
	}
	if strings.HasPrefix(stored, "$argon2id$") {
		ok, err := verifyArgon2id(plain, stored)
		return ok, false, err
	}
	if strings.HasPrefix(stored, "$2a$") || strings.HasPrefix(stored, "$2b$") || strings.HasPrefix(stored, "$2y$") {
		if err := bcrypt.CompareHashAndPassword([]byte(stored), []byte(plain)); err != nil {
			return false, false, nil
		}
		return true, true, nil
	}
	return false, false, fmt.Errorf("unknown password hash format")
}

func verifyArgon2id(plain, encoded string) (bool, error) {
	// $argon2id$v=19$m=65536,t=3,p=4$salt$key
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, fmt.Errorf("invalid argon2id hash")
	}
	paramParts := strings.Split(parts[3], ",")
	if len(paramParts) != 3 {
		return false, fmt.Errorf("invalid argon2id params")
	}
	var mem uint32
	var timeCost uint32
	var threads uint8
	for _, p := range paramParts {
		kv := strings.SplitN(p, "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "m":
			v, err := strconv.ParseUint(kv[1], 10, 32)
			if err != nil {
				return false, err
			}
			mem = uint32(v)
		case "t":
			v, err := strconv.ParseUint(kv[1], 10, 32)
			if err != nil {
				return false, err
			}
			timeCost = uint32(v)
		case "p":
			v, err := strconv.ParseUint(kv[1], 10, 8)
			if err != nil {
				return false, err
			}
			threads = uint8(v)
		}
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	wantKey, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, err
	}
	nWant := len(wantKey)
	if nWant > 1024 {
		return false, fmt.Errorf("invalid derived key length")
	}
	got := argon2.IDKey([]byte(plain), salt, timeCost, mem, threads, uint32(nWant))
	if len(got) != len(wantKey) {
		return false, nil
	}
	var diff byte
	for i := range got {
		diff |= got[i] ^ wantKey[i]
	}
	return diff == 0, nil
}
