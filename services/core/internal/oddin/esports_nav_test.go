package oddin

import (
	"strings"
	"testing"

	"github.com/crypto-casino/core/internal/config"
)

func TestParseEsportsNavJSON(t *testing.T) {
	items, err := ParseEsportsNavJSON(`[
	  {"id":"root","label":"Sportsbook","page":""},
	  {"id":"cs2","label":"Counter-Strike 2","page":"/cs2","logoUrl":"https://cdn.example.com/cs2.svg"},
	  {"logoUrl":"http://insecure.example.com/x.svg","id":"nox","label":"No https on logo"}
	]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 {
		t.Fatalf("got %d items want 3", len(items))
	}
	if items[0].ID != "root" || items[0].LogoURL != "" {
		t.Fatalf("root: %+v", items[0])
	}
	if items[1].LogoURL == "" || !strings.HasPrefix(items[1].LogoURL, "https://") {
		t.Fatalf("cs2 logo: %+v", items[1])
	}
	if items[2].ID != "nox" || items[2].LogoURL != "" {
		t.Fatalf("nox should have empty logo: %+v", items[2])
	}
}

func TestEsportsNavConfigured(t *testing.T) {
	if EsportsNavConfigured(nil) {
		t.Fatal("nil cfg")
	}
	if EsportsNavConfigured(&config.Config{OddinEsportsNavJSON: "not json"}) {
		t.Fatal("invalid json")
	}
	if EsportsNavConfigured(&config.Config{OddinEsportsNavJSON: `[]`}) {
		t.Fatal("empty array")
	}
	if !EsportsNavConfigured(&config.Config{OddinEsportsNavJSON: `[{"id":"a","label":"A","page":""}]`}) {
		t.Fatal("want configured")
	}
}
