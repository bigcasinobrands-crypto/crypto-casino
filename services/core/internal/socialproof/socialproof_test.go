package socialproof

import (
	"testing"
	"time"
)

func TestComputeOnlineDeterministicPerBucket(t *testing.T) {
	cfg := Config{
		Enabled:           true,
		OnlineTarget:      200,
		OnlineVariancePct: 25,
		OnlineBucketSecs:  120,
	}
	t0 := time.Unix(1700000000, 0).UTC()
	a := ComputeOnline(t0, cfg)
	b := ComputeOnline(t0.Add(30*time.Second), cfg)
	if a != b {
		t.Fatalf("same bucket: got %d vs %d", a, b)
	}
	c := ComputeOnline(t0.Add(130*time.Second), cfg)
	if c == a {
		t.Fatalf("expected different value across buckets, both %d", c)
	}
}

func TestDisplayWageredMinor(t *testing.T) {
	cfg := Config{WagerDisplayMultiplier: 1.5}
	if DisplayWageredMinor(1000, cfg) != 1500 {
		t.Fatalf("got %d", DisplayWageredMinor(1000, cfg))
	}
}

func TestMergeJSONDefaults(t *testing.T) {
	cfg := MergeJSON([]byte(`{"enabled":true}`))
	if !cfg.Enabled {
		t.Fatal("enabled")
	}
	if cfg.OnlineTarget != 180 {
		t.Fatalf("target %d", cfg.OnlineTarget)
	}
}

func TestMergeJSONPreservesEnabledDefaultWhenOmitted(t *testing.T) {
	cfg := MergeJSON([]byte(`{"online_target":220}`))
	if !cfg.Enabled {
		t.Fatal("expected default enabled true when omitted")
	}
	if cfg.OnlineTarget != 220 {
		t.Fatalf("target %d", cfg.OnlineTarget)
	}
}

func TestMergeRecentWinsDefaults(t *testing.T) {
	cfg := MergeJSON([]byte(`{"recent_wins_enabled":true,"recent_wins_feed_size":16}`))
	if !cfg.RecentWinsEnabled {
		t.Fatal("recent_wins_enabled")
	}
	if cfg.RecentWinsFeedSize != 16 {
		t.Fatalf("feed %d", cfg.RecentWinsFeedSize)
	}
	def := DefaultConfig()
	if cfg.RecentWinsBaseDurationSec != def.RecentWinsBaseDurationSec {
		t.Fatalf("base dur %v", cfg.RecentWinsBaseDurationSec)
	}
}

func TestMaskPlayerLabel(t *testing.T) {
	if got := MaskPlayerLabel(""); got != "Player***" {
		t.Fatalf("%q", got)
	}
	if got := MaskPlayerLabel("ab"); got != "a***" {
		t.Fatalf("%q", got)
	}
	if got := MaskPlayerLabel("Satoshi"); len(got) < 4 {
		t.Fatalf("%q", got)
	}
}
