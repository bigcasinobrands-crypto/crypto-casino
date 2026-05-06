// Package passimpay integrates https://api.passimpay.io (v2) per official GitBook:
// https://passimpay.gitbook.io/passimpay-api/example-of-a-signature
package passimpay

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// SignBody produces the x-signature hex for an outbound POST body map (platformId must be included in body).
// Canonical JSON matches Postman/GitBook expectation: escaped solidus (\/), stable key order via sorted keys recursively.
func SignBody(platformID int, secret string, body map[string]any) (jsonBody []byte, signature string, err error) {
	jsonBody, err = canonicalJSONMarshal(body)
	if err != nil {
		return nil, "", err
	}
	contract := fmt.Sprintf("%d;%s;%s", platformID, string(jsonBody), secret)
	return jsonBody, hmacSHA256Hex(secret, contract), nil
}

// VerifyInboundBodyMap re-canonicalizes webhook JSON and verifies x-signature
// per PassimPay's platformId;bodyJson;secret HMAC contract.
func VerifyInboundBodyMap(platformID int, secret string, body map[string]any, wantSig string) bool {
	if body == nil {
		return false
	}
	canon, err := canonicalJSONMarshal(body)
	if err != nil {
		return false
	}
	return VerifyInboundSignature(platformID, secret, canon, wantSig)
}

// VerifyInboundSignature verifies x-signature for an inbound JSON webhook using the raw JSON bytes (recommended).
func VerifyInboundSignature(platformID int, secret string, rawJSON []byte, wantSig string) bool {
	wantSig = strings.TrimSpace(strings.ToLower(wantSig))
	if wantSig == "" || secret == "" {
		return false
	}
	escaped := escapeSolidusRaw(string(rawJSON))
	contract := fmt.Sprintf("%d;%s;%s", platformID, escaped, secret)
	got := strings.ToLower(hmacSHA256Hex(secret, contract))
	return hmac.Equal([]byte(got), []byte(wantSig))
}

func hmacSHA256Hex(secret string, msg string) string {
	m := hmac.New(sha256.New, []byte(secret))
	_, _ = m.Write([]byte(msg))
	return fmt.Sprintf("%x", m.Sum(nil))
}

// canonicalJSONMarshal builds compact JSON with keys sorted recursively and / escaped as \/ (GitBook JS / C#).
func canonicalJSONMarshal(v any) ([]byte, error) {
	switch t := v.(type) {
	case map[string]any:
		var keys []string
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var parts []byte
		parts = append(parts, '{')
		for i, k := range keys {
			keyBytes, err := json.Marshal(k)
			if err != nil {
				return nil, err
			}
			sub, err := canonicalJSONMarshal(t[k])
			if err != nil {
				return nil, err
			}
			if i > 0 {
				parts = append(parts, ',')
			}
			parts = append(parts, keyBytes...)
			parts = append(parts, ':')
			parts = append(parts, sub...)
		}
		parts = append(parts, '}')
		out := escapeSolidus(parts)
		return out, nil
	case []any:
		var parts []byte
		parts = append(parts, '[')
		for i, e := range t {
			if i > 0 {
				parts = append(parts, ',')
			}
			sub, err := canonicalJSONMarshal(e)
			if err != nil {
				return nil, err
			}
			parts = append(parts, sub...)
		}
		parts = append(parts, ']')
		return escapeSolidus(parts), nil
	case string:
		s, err := json.Marshal(t)
		if err != nil {
			return nil, err
		}
		return escapeSolidus(s), nil
	case int:
		return []byte(fmt.Sprintf("%d", t)), nil
	case int64:
		return []byte(fmt.Sprintf("%d", t)), nil
	case float64:
		s, err := json.Marshal(numberFromFloat(t))
		if err != nil {
			return nil, err
		}
		return s, nil
	case json.Number:
		s, err := json.Marshal(strings.TrimSpace(t.String()))
		if err != nil {
			return nil, err
		}
		return s, nil
	case bool:
		return json.Marshal(t)
	case nil:
		return []byte("null"), nil
	default:
		return json.Marshal(t)
	}
}

func numberFromFloat(f float64) any {
	return f
}

func escapeSolidus(b []byte) []byte {
	return []byte(strings.ReplaceAll(string(b), "/", `\/`))
}

func escapeSolidusRaw(s string) string {
	return strings.ReplaceAll(s, "/", `\/`)
}
