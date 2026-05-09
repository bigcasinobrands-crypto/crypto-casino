package blueocean

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/crypto-casino/core/internal/fingerprint"
	"github.com/jackc/pgx/v5/pgxpool"
)

// createPlayerUserSnapshot is DB-backed context for a createPlayer XAPI call.
type createPlayerUserSnapshot struct {
	Username, Email string
	Birthday        string // YYYY-MM-DD
	FirstName       string
	LastName        string
	Phone           string
	Gender          string
	Language        string
	CountryISO2     string
	City            string
	Region          string
}

func (s createPlayerUserSnapshot) toCreatePlayerRequest(userID string) CreatePlayerRequest {
	req := CreatePlayerRequest{
		UserID:      strings.TrimSpace(userID),
		Username:    s.Username,
		Email:       s.Email,
		FirstName:   s.FirstName,
		LastName:    s.LastName,
		CountryISO2: s.CountryISO2,
		City:        s.City,
		Region:      s.Region,
		Phone:       s.Phone,
		Gender:      s.Gender,
		Language:    s.Language,
		Birthday:    s.Birthday,
	}
	if strings.TrimSpace(s.Username) != "" {
		req.Nickname = strings.TrimSpace(s.Username)
	}
	return req
}

// loadCreatePlayerUserSnapshot reads user row, latest player_sessions geo, and preference-backed profile fields.
func loadCreatePlayerUserSnapshot(ctx context.Context, pool *pgxpool.Pool, userID string) (createPlayerUserSnapshot, error) {
	var snap createPlayerUserSnapshot
	var username, email, dobTxt, country, region, city, prefsJSON sqlStringOrBytes
	err := pool.QueryRow(ctx, `
		SELECT u.username,
			u.email,
			u.date_of_birth::text,
			COALESCE(u.preferences, '{}'::jsonb)::text,
			NULLIF(trim(ps.country_iso2), ''),
			NULLIF(trim(ps.region), ''),
			NULLIF(trim(ps.city), '')
		FROM users u
		LEFT JOIN LATERAL (
			SELECT country_iso2, region, city
			FROM player_sessions
			WHERE user_id = u.id
			ORDER BY last_seen_at DESC
			LIMIT 1
		) ps ON true
		WHERE u.id = $1::uuid
	`, strings.TrimSpace(userID)).Scan(&username, &email, &dobTxt, &prefsJSON, &country, &region, &city)
	if err != nil {
		return snap, err
	}
	if s := username.String(); s != "" {
		snap.Username = s
	}
	if s := email.String(); s != "" {
		snap.Email = s
	}
	if s := strings.TrimSpace(dobTxt.String()); s != "" && s != "0001-01-01" {
		snap.Birthday = s
	}

	first, last, phone, gender, lang := boCustomerFromPreferencesJSON(prefsJSON.Bytes())
	snap.FirstName = first
	snap.LastName = last
	snap.Phone = phone
	snap.Gender = gender
	snap.Language = lang

	if s := country.String(); s != "" {
		if cc := fingerprint.NormalizeCountryISO2(s); len(cc) == 2 {
			snap.CountryISO2 = cc
		}
	}
	if s := region.String(); s != "" {
		snap.Region = s
	}
	if s := city.String(); s != "" {
		snap.City = s
	}
	return snap, nil
}

// sqlStringOrBytes maps pgx TEXT/NULL scans for simple snapshot loading.
type sqlStringOrBytes struct {
	s *string
}

func (v *sqlStringOrBytes) Scan(src any) error {
	v.s = nil
	if src == nil {
		return nil
	}
	switch t := src.(type) {
	case string:
		if t != "" {
			v.s = &t
		}
	case []byte:
		if len(t) > 0 {
			str := string(t)
			v.s = &str
		}
	default:
		s := coerceScanString(src)
		if s != "" {
			v.s = &s
		}
	}
	return nil
}

func coerceScanString(src any) string {
	if src == nil {
		return ""
	}
	switch t := src.(type) {
	case string:
		return strings.TrimSpace(t)
	case []byte:
		return strings.TrimSpace(string(t))
	default:
		return strings.TrimSpace(fmt.Sprint(t))
	}
}

func (v sqlStringOrBytes) String() string {
	if v.s == nil {
		return ""
	}
	return strings.TrimSpace(*v.s)
}

func (v sqlStringOrBytes) Bytes() []byte {
	if v.s == nil || *v.s == "" {
		return nil
	}
	return []byte(*v.s)
}

func boCustomerFromPreferencesJSON(prefs []byte) (firstName, lastName, phone, gender, language string) {
	if len(prefs) == 0 {
		return
	}
	var m map[string]any
	if json.Unmarshal(prefs, &m) != nil || len(m) == 0 {
		return
	}
	firstName = prefStr(m,
		"first_name", "firstname", "given_name", "givenName", "firstName",
	)
	lastName = prefStr(m,
		"last_name", "lastname", "family_name", "familyName", "surname", "lastName",
	)
	phone = prefStr(m, "phone", "mobile", "msisdn", "phone_number", "phoneNumber")
	gender = prefStr(m, "gender", "sex")
	language = normalizeLanguageTag(prefStr(m, "language", "locale", "lang"))
	return firstName, lastName, phone, gender, language
}

func prefStr(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			if s := scalarToTrimmedString(v); s != "" {
				return s
			}
		}
	}
	return ""
}

func scalarToTrimmedString(v any) string {
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strings.TrimSpace(strconv.FormatFloat(t, 'f', -1, 64))
	case json.Number:
		return strings.TrimSpace(t.String())
	case bool:
		if t {
			return "1"
		}
		return "0"
	default:
		return strings.TrimSpace(coerceScanString(v))
	}
}

func normalizeLanguageTag(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return ""
	}
	if i := strings.IndexByte(s, '-'); i > 0 {
		s = strings.TrimSpace(s[:i])
	}
	if len(s) > 8 {
		return ""
	}
	return s
}

// mergeCreatePlayerCustomerDetails adds optional profile keys for BO createPlayer.
// Names follow common GameHub / BO operator form conventions; confirm against your API test form.
// Env BLUEOCEAN_CREATE_PLAYER_EXTRA_JSON still merges later and can override or supply aliases.
func mergeCreatePlayerCustomerDetails(params map[string]any, req CreatePlayerRequest) {
	if params == nil {
		return
	}
	if fn := strings.TrimSpace(req.FirstName); fn != "" {
		params["firstname"] = fn
	}
	if ln := strings.TrimSpace(req.LastName); ln != "" {
		params["lastname"] = ln
	}
	if nk := strings.TrimSpace(req.Nickname); nk != "" {
		params["nickname"] = nk
	}
	if cc := strings.TrimSpace(req.CountryISO2); cc != "" {
		if x := fingerprint.NormalizeCountryISO2(cc); len(x) == 2 {
			params["country"] = x
		}
	}
	if c := strings.TrimSpace(req.City); c != "" {
		params["city"] = c
	}
	if r := strings.TrimSpace(req.Region); r != "" {
		params["region"] = r
	}
	if p := strings.TrimSpace(req.Phone); p != "" {
		params["phone"] = p
	}
	if g := strings.TrimSpace(req.Gender); g != "" {
		params["gender"] = strings.ToLower(g)
	}
	if lang := strings.TrimSpace(req.Language); lang != "" {
		params["language"] = lang
	}
	if b := strings.TrimSpace(req.Birthday); b != "" {
		params["birthday"] = b
	}
}
