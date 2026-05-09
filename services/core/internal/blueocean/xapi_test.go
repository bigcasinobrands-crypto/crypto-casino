package blueocean

import (
	"context"
	"strings"
	"testing"

	"github.com/crypto-casino/core/internal/config"
)

func TestMergeBOGXAPIParamsFillsAgentWhenOmitted(t *testing.T) {
	cfg := &config.Config{
		BlueOceanCurrency:      "EUR",
		BlueOceanAgentID:       "42",
		BlueOceanMulticurrency: true,
	}
	out := MergeBOGXAPIParams(cfg, map[string]any{"userid": "x"})
	if out["currency"] != "EUR" {
		t.Fatalf("currency: %v", out["currency"])
	}
	if out["agentid"].(int64) != 42 {
		t.Fatalf("agentid: %v", out["agentid"])
	}
	if out["multicurrency"] != 1 {
		t.Fatalf("multicurrency: %v", out["multicurrency"])
	}
}

func TestBOGXAPIRequiresSuperadmin(t *testing.T) {
	if !BOGXAPIRequiresSuperadmin("removeFreeRounds") {
		t.Fatal("expected superadmin")
	}
	if !BOGXAPIRequiresSuperadmin("setSystemPassword") {
		t.Fatal("expected superadmin")
	}
	if BOGXAPIRequiresSuperadmin("getPlayerBalance") {
		t.Fatal("getPlayerBalance is read-only")
	}
	if BOGXAPIRequiresSuperadmin("getGameHistory") {
		t.Fatal("expected read method")
	}
	if BOGXAPIRequiresSuperadmin("getPaymentTransactions") {
		t.Fatal("expected read method")
	}
}

func TestListAllowedXAPIMethodNamesSorted(t *testing.T) {
	names := ListAllowedXAPIMethodNames()
	for i := 1; i < len(names); i++ {
		if names[i] < names[i-1] {
			t.Fatalf("not sorted: %v", names)
		}
	}
}

func TestAllowedBOGXAPIMethodsDropdownParity(t *testing.T) {
	dropdown := []string{
		"getGameList", "createPlayer", "playerExists", "loginPlayer", "getPlayerBalance", "getGame", "getGameDirect",
		"addFreeRounds", "logoutPlayer", "getDailyBalances", "getDailyReport", "getGameHistory", "getPaymentTransactions",
		"getSystemUsername", "setSystemUsername", "setSystemPassword", "removeFreeRounds", "getGameDemo",
	}
	for _, m := range dropdown {
		if _, ok := AllowedBOGXAPIMethods[m]; !ok {
			t.Fatalf("missing %s", m)
		}
	}
}

func TestMergeOptionalStringParamsSkipsBlankStrings(t *testing.T) {
	dst := map[string]any{"userid": "1"}
	mergeOptionalStringParams(dst, map[string]any{"session_id": "  ", "gameid": 9})
	if _, has := dst["session_id"]; has {
		t.Fatal("expected blank session skipped")
	}
	if dst["gameid"] != 9 {
		t.Fatalf("gameid: %v", dst["gameid"])
	}
}

func TestLoginPlayerUnconfiguredClient(t *testing.T) {
	c := &Client{}
	res := c.LoginPlayer(context.Background(), nil, "ab", nil)
	if !strings.Contains(res.ErrorMessage, "not configured") {
		t.Fatalf("got %q", res.ErrorMessage)
	}
}

func TestNormalizePlayerExistsParams(t *testing.T) {
	p := map[string]any{"userid": "domendomen2"}
	NormalizePlayerExistsParams(p)
	if p["user_username"] != "domendomen2" {
		t.Fatalf("user_username: %v", p["user_username"])
	}
	if _, has := p["userid"]; has {
		t.Fatal("expected legacy userid removed")
	}
	p2 := map[string]any{"user_username": "keep"}
	NormalizePlayerExistsParams(p2)
	if p2["user_username"] != "keep" {
		t.Fatal("unchanged")
	}
}

func TestNormalizeLoginPlayerParams(t *testing.T) {
	p := map[string]any{"userid": "domendomen2"}
	NormalizeLoginPlayerParams(p)
	if p["user_username"] != "domendomen2" {
		t.Fatalf("user_username: %v", p["user_username"])
	}
	if _, has := p["userid"]; has {
		t.Fatal("expected legacy userid removed")
	}
	p2 := map[string]any{"user_username": "already"}
	NormalizeLoginPlayerParams(p2)
	if p2["user_username"] != "already" {
		t.Fatal("unchanged")
	}
}

func TestMergeBOUserPasswordIfConfigured(t *testing.T) {
	cfg := &config.Config{BlueOceanCreatePlayerUserPassword: "d87ee8d"}
	p := map[string]any{"user_username": "u"}
	mergeBOUserPasswordIfConfigured(cfg, p)
	if p["user_password"] != "d87ee8d" {
		t.Fatalf("user_password: %v", p["user_password"])
	}
	mergeBOUserPasswordIfConfigured(&config.Config{}, map[string]any{})
	// no panic; empty cfg should not set key
	p2 := map[string]any{"user_username": "x"}
	mergeBOUserPasswordIfConfigured(&config.Config{}, p2)
	if _, has := p2["user_password"]; has {
		t.Fatal("expected no password when unset")
	}
}

func TestNormalizeLogoutPlayerParams(t *testing.T) {
	p := map[string]any{"userid": "dom3"}
	NormalizeLogoutPlayerParams(p)
	if p["user_username"] != "dom3" {
		t.Fatalf("user_username: %v", p["user_username"])
	}
	if _, has := p["userid"]; has {
		t.Fatal("expected legacy userid removed")
	}
}

func TestNormalizeGetDailyReportParams(t *testing.T) {
	p := map[string]any{
		"date_start":  "2012-08-09 00:00:00",
		"date_end":    "2012-08-10",
		"status":      "x",
		"associateId": int64(7),
	}
	NormalizeGetDailyReportParams(p)
	if p["date"] != "2012-08-09" {
		t.Fatalf("date: %v", p["date"])
	}
	if _, has := p["date_start"]; has {
		t.Fatal("expected date_start removed")
	}
	if _, has := p["date_end"]; has {
		t.Fatal("expected date_end removed")
	}
	if _, has := p["status"]; has {
		t.Fatal("expected status removed (not in BO getDailyReport)")
	}
	if p["associateid"] != int64(7) {
		t.Fatalf("associateid: %v", p["associateid"])
	}
}

func TestNormalizeGetGameHistoryParams(t *testing.T) {
	p := map[string]any{
		"game_id":  "2159",
		"provider": "pq",
		"userid":   "999",
	}
	NormalizeGetGameHistoryParams(p)
	if p["gameid"] != "2159" {
		t.Fatalf("gameid: %v", p["gameid"])
	}
	if _, has := p["game_id"]; has {
		t.Fatal("expected game_id removed")
	}
	if p["vendor"] != "pq" {
		t.Fatalf("vendor: %v", p["vendor"])
	}
	if _, has := p["userid"]; has {
		t.Fatal("expected userid stripped for getGameHistory")
	}
}
