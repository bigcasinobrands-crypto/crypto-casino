package blueocean

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseCatalogGames_responseArray(t *testing.T) {
	raw := json.RawMessage(`{"response":[{"id":1,"id_hash":"abc","name":"Test Game","type":"slots","system":"pragmatic","image_square":"https://cdn.example/t.png","new":true,"mobile":true}]}`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 {
		t.Fatalf("len=%d", len(games))
	}
	g := games[0]
	if g.BogID != 1 || g.IDHash != "abc" || g.Name != "Test Game" {
		t.Fatalf("%+v", g)
	}
	if g.GameType != "slots" || g.ProviderSystem != "pragmatic" {
		t.Fatalf("type/system %+v", g)
	}
	if !g.IsNew || !g.Mobile {
		t.Fatal("flags")
	}
	if g.ThumbnailURL != "https://cdn.example/t.png" {
		t.Fatal(g.ThumbnailURL)
	}
}

func TestParseCatalogGames_topLevelGames(t *testing.T) {
	raw := json.RawMessage(`{"games":[{"id":42,"id_hash":"x","name":"Live","subcategory":"roulette","system":"evo","image":"https://i.example/l.jpg"}]}`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 || games[0].BogID != 42 {
		t.Fatalf("%+v", games)
	}
}

func TestParseCatalogGames_thumbnailAliases(t *testing.T) {
	raw := json.RawMessage(`{"response":[{"gameid":7,"game_name":"X","type":"video-slots","thumbnail_url":"//cdn.example/t.png"}]}`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil || len(games) != 1 || games[0].ThumbnailURL != "https://cdn.example/t.png" {
		t.Fatalf("err=%v games=%+v", err, games)
	}
}

// BOG getGameList lists image before image_square; standard thumbnail wins over square icon.
func TestParseCatalogGames_docImageFieldPriority(t *testing.T) {
	raw := json.RawMessage(`{"response":[{"id":1,"name":"Doc Order","type":"video-slots","system":"pragmatic","image":"https://cdn.example/standard.jpg","image_square":"https://cdn.example/sq.png"}]}`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil || len(games) != 1 {
		t.Fatalf("err=%v %+v", err, games)
	}
	if games[0].ThumbnailURL != "https://cdn.example/standard.jpg" {
		t.Fatalf("want standard image, got %q", games[0].ThumbnailURL)
	}
}

func TestParseCatalogGames_additionalShowAdditional(t *testing.T) {
	raw := json.RawMessage(`{"response":[{"id":2,"name":"Extra","type":"video-slots","additional":{"image_portrait":"https://cdn.example/p.png"}}]}`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil || len(games) != 1 {
		t.Fatalf("err=%v %+v", err, games)
	}
	if games[0].ThumbnailURL != "https://cdn.example/p.png" {
		t.Fatalf("got %q", games[0].ThumbnailURL)
	}
}

func TestParseCatalogGames_relativeImageBase(t *testing.T) {
	raw := json.RawMessage(`{"games":[{"id":1,"name":"Y","type":"slots","thumb":"/img/a.png"}]}`)
	games, err := ParseCatalogGames(raw, "https://static.example")
	if err != nil || len(games) != 1 || games[0].ThumbnailURL != "https://static.example/img/a.png" {
		t.Fatalf("%+v", games)
	}
}

func TestParseCatalogGames_nestedThumbnailMap(t *testing.T) {
	raw := json.RawMessage(`{"response":[{"id":9001,"name":"Nested Thumb","type":"slots","thumbnail":{"square":"https://cdn.example/n.png"}}]}`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil || len(games) != 1 || games[0].ThumbnailURL != "https://cdn.example/n.png" {
		t.Fatalf("err=%v %+v", err, games)
	}
}

func TestParseCatalogGames_gfxSizesMap(t *testing.T) {
	raw := json.RawMessage(`{"response":[{"id":9002,"name":"Gfx Thumb","type":"slots","gfx":{"325x459":"https://cdn.example/portrait.webp","120x120":"https://cdn.example/icon.webp"}}]}`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil || len(games) != 1 {
		t.Fatalf("%+v", games)
	}
	if games[0].ThumbnailURL == "" || !strings.HasPrefix(games[0].ThumbnailURL, "https://cdn.example/") {
		t.Fatal(games[0].ThumbnailURL)
	}
}

func TestParseCatalogGames_gameListCamel(t *testing.T) {
	raw := json.RawMessage(`{"gameList":[{"gameid":3,"game_name":"Roulette X","system":"evo"}]}`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 || games[0].BogID != 3 || games[0].Name != "Roulette X" {
		t.Fatalf("%+v", games)
	}
}

func TestParseCatalogGames_responseJSONStringEnvelope(t *testing.T) {
	inner := `[{"id":9,"name":"Embedded","system":"qs"}]`
	payload, err := json.Marshal(map[string]string{
		"status":   "ok",
		"response": inner,
	})
	if err != nil {
		t.Fatal(err)
	}
	games, err := ParseCatalogGames(json.RawMessage(payload), "")
	if err != nil || len(games) != 1 || games[0].BogID != 9 {
		t.Fatalf("err=%v games=%+v", err, games)
	}
}

func TestParseCatalogGames_providerErrorEnvelope(t *testing.T) {
	raw := json.RawMessage(`{"success":false,"message":"Invalid agent or currency."}`)
	_, err := ParseCatalogGames(raw, "")
	if err == nil || !strings.Contains(err.Error(), "Invalid agent") {
		t.Fatalf("err=%v", err)
	}
}

func TestParseCatalogGames_providerSkipsAggregatorSlug(t *testing.T) {
	raw := json.RawMessage(`[{"id":99,"name":"Take Book","system":"Betsoft","provider":"blueocean"}]`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 || games[0].ProviderSystem != "Betsoft" {
		t.Fatalf("want Betsoft studio, got %+v", games)
	}
}

func TestParseCatalogGames_providerSlugOnlyBlueOcean(t *testing.T) {
	raw := json.RawMessage(`[{"id":100,"name":"Only BO slug","provider":"blueocean"}]`)
	games, err := ParseCatalogGames(raw, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 || games[0].ProviderSystem != "" {
		t.Fatalf("want empty studio when only aggregator slug present, got %+v", games)
	}
}
