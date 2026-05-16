package socialproof

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/crypto-casino/core/internal/ledger"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RecentWinEntry is one tile in the lobby “recent wins” strip.
type RecentWinEntry struct {
	GameID       string `json:"game_id"`
	GameTitle    string `json:"game_title"`
	ThumbnailURL string `json:"thumbnail_url"`
	PlayerLabel  string `json:"player_label"`
	AmountMinor  int64  `json:"amount_minor"`
	Currency     string `json:"currency"`
	Source       string `json:"source"` // "real" | "bot"
}

// RecentWinPayload is returned by GET /v1/recent-wins.
type RecentWinPayload struct {
	Enabled            bool             `json:"enabled"`
	Wins               []RecentWinEntry `json:"wins"`
	MarqueeDurationSec float64          `json:"marquee_duration_sec"`
	OnlineCount        int              `json:"online_count"`
	RefreshAfterSecs   int              `json:"refresh_after_secs"`
}

// MaskPlayerLabel obscures usernames for the public feed.
func MaskPlayerLabel(username string) string {
	s := strings.TrimSpace(username)
	if s == "" {
		return "Player***"
	}
	runes := []rune(s)
	if len(runes) <= 2 {
		return string(runes[:1]) + "***"
	}
	if len(runes) <= 6 {
		return string(runes[:2]) + "***"
	}
	return string(runes[:4]) + "…"
}

var botAliases = []string{
	"Satoshi", "DiamondHands", "LuckySpin", "MoonShot", "HighRoller", "GreenChip",
	"VelvetFox", "RiskyBiz", "JackPotts", "SilverAce", "NightOwl", "TurboSpin",
	"LamboLuke", "Stacks", "RiverQueen", "FoldKing", "ChipWhisper", "NeonWhale",
	"moonboy", "floor_it", "Jan_m_f", "n0thing42", "CryptoKat", "StakeRunner",
	"VegasVibes", "ROI_or_Bust", "BlazeMint", "GoldenTicket", "SpinDoctor",
}

type marqueeGame struct {
	ID    string
	Title string
	Thumb string
}

// BuildRecentWinPayload loads real ledger wins, synthesizes bots, mixes, and computes marquee timing from online count.
func BuildRecentWinPayload(ctx context.Context, pool *pgxpool.Pool, cfg Config, now time.Time) (*RecentWinPayload, error) {
	if !cfg.RecentWinsEnabled {
		return &RecentWinPayload{Enabled: false, Wins: []RecentWinEntry{}}, nil
	}

	online := ComputeOnline(now, cfg)
	baseDur := cfg.RecentWinsBaseDurationSec
	if baseDur <= 0 {
		baseDur = 42
	}
	ref := float64(cfg.OnlineTarget)
	if ref < 1 {
		ref = 180
	}
	ratio := ref / math.Max(float64(online), 1)
	dur := clampFloat(baseDur*ratio, 10, 200)

	feed := cfg.RecentWinsFeedSize
	if feed < 8 {
		feed = 28
	}

	realCap := cfg.RecentWinsRealCap
	if realCap < 0 {
		realCap = 0
	}

	reals, err := loadRealRecentWins(ctx, pool, cfg, realCap)
	if err != nil {
		return nil, err
	}
	games, err := loadMarqueeGames(ctx, pool, 140)
	if err != nil {
		return nil, err
	}

	bucket := now.Unix() / int64(max(cfg.OnlineBucketSecs, 30))
	realsTrim := reals
	needBots := feed - len(realsTrim)
	if needBots < 0 {
		realsTrim = realsTrim[:feed]
		needBots = 0
	}
	bots := synthesizeBotWins(bucket, needBots, games, cfg)

	wReal := cfg.RecentWinsRealWeight
	if wReal < 1 {
		wReal = 1
	}
	if wReal > 10 {
		wReal = 10
	}

	merged := mergeWinFeeds(realsTrim, bots, wReal, bucket, feed)
	shuffleRecentWins(merged, bucket)

	refresh := cfg.OnlineBucketSecs
	if refresh < 30 {
		refresh = 30
	}
	if refresh > 120 {
		refresh = 120
	}

	return &RecentWinPayload{
		Enabled:            true,
		Wins:               merged,
		MarqueeDurationSec: dur,
		OnlineCount:        online,
		RefreshAfterSecs:   refresh,
	}, nil
}

func loadRealRecentWins(ctx context.Context, pool *pgxpool.Pool, cfg Config, limit int) ([]RecentWinEntry, error) {
	if limit == 0 {
		return nil, nil
	}
	minMinor := cfg.RecentWinsMinRealMinor
	if minMinor < 0 {
		minMinor = 0
	}

	q := `
SELECT le.amount_minor, le.currency,
       COALESCE(NULLIF(trim(le.metadata->>'game_id'), ''), '') AS gid,
       COALESCE(NULLIF(trim(u.username), ''), 'Player') AS uname,
       COALESCE(NULLIF(trim(g.title), ''), 'Casino') AS gtitle,
       COALESCE(NULLIF(trim(g.thumbnail_url_override), ''), NULLIF(trim(g.thumbnail_url), ''), '') AS gthumb
FROM ledger_entries le
JOIN users u ON u.id = le.user_id
LEFT JOIN games g ON g.id = (le.metadata->>'game_id')
WHERE le.entry_type IN ('game.credit', 'game.win')
  AND le.amount_minor >= $1
  AND ` + ledger.NGRReportingFilterSQL("le") + `
ORDER BY le.created_at DESC
LIMIT $2`

	rows, err := pool.Query(ctx, q, minMinor, limit)
	if err != nil {
		return nil, fmt.Errorf("recent wins query: %w", err)
	}
	defer rows.Close()

	var out []RecentWinEntry
	for rows.Next() {
		var amount int64
		var ccy, gid, uname, gtitle, gthumb string
		if err := rows.Scan(&amount, &ccy, &gid, &uname, &gtitle, &gthumb); err != nil {
			continue
		}
		ccy = strings.ToUpper(strings.TrimSpace(ccy))
		if ccy == "" {
			ccy = "USD"
		}
		out = append(out, RecentWinEntry{
			GameID:       gid,
			GameTitle:    gtitle,
			ThumbnailURL: gthumb,
			PlayerLabel:  MaskPlayerLabel(uname),
			AmountMinor:  amount,
			Currency:     ccy,
			Source:       "real",
		})
	}
	return out, rows.Err()
}

func loadMarqueeGames(ctx context.Context, pool *pgxpool.Pool, limit int) ([]marqueeGame, error) {
	q := `
SELECT id,
       COALESCE(NULLIF(trim(title), ''), 'Game') AS title,
       COALESCE(NULLIF(trim(thumbnail_url_override), ''), NULLIF(trim(thumbnail_url), ''), '') AS thumb
FROM games
WHERE hidden = false
  AND COALESCE(NULLIF(trim(thumbnail_url_override), ''), NULLIF(trim(thumbnail_url), ''), '') <> ''
ORDER BY updated_at DESC
LIMIT $1`

	rows, err := pool.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("marquee games: %w", err)
	}
	defer rows.Close()

	var out []marqueeGame
	for rows.Next() {
		var id, title, thumb string
		if err := rows.Scan(&id, &title, &thumb); err != nil {
			continue
		}
		out = append(out, marqueeGame{ID: id, Title: title, Thumb: thumb})
	}
	return out, rows.Err()
}

func synthesizeBotWins(bucket int64, n int, games []marqueeGame, cfg Config) []RecentWinEntry {
	if n <= 0 || len(games) == 0 {
		return nil
	}
	lo := cfg.RecentWinsBotMinMinor
	hi := cfg.RecentWinsBotMaxMinor
	if lo < 1 {
		lo = 1
	}
	if hi < lo {
		hi = lo
	}

	out := make([]RecentWinEntry, 0, n)
	for i := 0; i < n; i++ {
		h := mix64(uint64(bucket)^uint64(i)*0x85ebca6b2bd5b329 + uint64(len(games)))
		gi := int(h % uint64(len(games)))
		g := games[gi]

		h2 := mix64(h ^ 0xcafebabe + uint64(i))
		u := float64(h2%1_000_000) / 1_000_000.0
		span := float64(hi - lo)
		amt := int64(math.Round(float64(lo) + u*u*span)) // bias toward tastier amounts
		if amt < lo {
			amt = lo
		}
		if amt > hi {
			amt = hi
		}

		ni := int(h2 % uint64(len(botAliases)))
		name := botAliases[ni]

		out = append(out, RecentWinEntry{
			GameID:       g.ID,
			GameTitle:    g.Title,
			ThumbnailURL: g.Thumb,
			PlayerLabel:  name,
			AmountMinor:  amt,
			Currency:     "USD",
			Source:       "bot",
		})
	}
	return out
}

func mergeWinFeeds(reals, bots []RecentWinEntry, realWeight int, bucket int64, feed int) []RecentWinEntry {
	out := make([]RecentWinEntry, 0, feed)
	ri, bi := 0, 0
	mod := uint64(realWeight + 1)
	if mod < 2 {
		mod = 2
	}
	for len(out) < feed {
		h := mix64(uint64(len(out)) + uint64(bucket)<<20 + uint64(ri)<<10 + uint64(bi))
		wantReal := ri < len(reals) && (bi >= len(bots) || int(h%mod) < realWeight)
		if wantReal {
			out = append(out, reals[ri])
			ri++
			continue
		}
		if bi < len(bots) {
			out = append(out, bots[bi])
			bi++
			continue
		}
		if ri < len(reals) {
			out = append(out, reals[ri])
			ri++
			continue
		}
		break
	}
	return out
}

func shuffleRecentWins(w []RecentWinEntry, bucket int64) {
	type keyed struct {
		k uint64
		e RecentWinEntry
	}
	kk := make([]keyed, len(w))
	for i := range w {
		kk[i] = keyed{
			k: mix64(uint64(i)*0x9e3779b9 + uint64(bucket)<<33 + uint64(w[i].AmountMinor)),
			e: w[i],
		}
	}
	sort.Slice(kk, func(i, j int) bool { return kk[i].k < kk[j].k })
	for i := range w {
		w[i] = kk[i].e
	}
}
