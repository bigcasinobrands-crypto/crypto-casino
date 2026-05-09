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
	if BOGXAPIRequiresSuperadmin("getGameHistory") {
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
		"getGameList", "createPlayer", "playerExists", "loginPlayer", "getGame", "getGameDirect",
		"addFreeRounds", "logoutPlayer", "getDailyBalances", "getDailyReport", "getGameHistory",
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
