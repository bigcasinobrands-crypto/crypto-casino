package blueocean

import (
	"testing"

	"github.com/crypto-casino/core/internal/config"
)

func TestXAPIWireUserPasswordSHA1(t *testing.T) {
	cfg := &config.Config{BlueOceanXAPIUserPasswordSHA1: true}
	// echo -n hello | shasum -a 1
	want := "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"
	if got := XAPIWireUserPassword(cfg, "hello"); got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestXAPIWireUserPasswordPrehashedPassthrough(t *testing.T) {
	cfg := &config.Config{BlueOceanXAPIUserPasswordSHA1: true}
	in := "AAf4C61ddCC5E8a2dabede0f3b482cd9aea9434d"
	if got := XAPIWireUserPassword(cfg, in); got != "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d" {
		t.Fatalf("got %q", got)
	}
}

func TestXAPIWireUserPasswordPlainWhenDisabled(t *testing.T) {
	cfg := &config.Config{BlueOceanXAPIUserPasswordSHA1: false}
	if got := XAPIWireUserPassword(cfg, "  secret "); got != "secret" {
		t.Fatalf("got %q", got)
	}
}

func TestStripDeprecatedBOGXAPIUserID(t *testing.T) {
	p := map[string]any{"user_username": "a", "user_id": "999"}
	stripDeprecatedBOGXAPIUserID(p)
	if _, has := p["user_id"]; has {
		t.Fatal("expected user_id removed")
	}
	if p["user_username"] != "a" {
		t.Fatal("preserve user_username")
	}
}

func TestFinalizeBOUserPasswordParam(t *testing.T) {
	cfg := &config.Config{BlueOceanXAPIUserPasswordSHA1: true}
	p := map[string]any{"user_password": "hello"}
	finalizeBOUserPasswordParam(cfg, "loginPlayer", p)
	want := "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"
	if p["user_password"] != want {
		t.Fatalf("got %v", p["user_password"])
	}
	q := map[string]any{"user_password": "hello"}
	finalizeBOUserPasswordParam(cfg, "getGameList", q)
	if q["user_password"] != "hello" {
		t.Fatalf("getGameList should not rewrite password: %v", q["user_password"])
	}
}
