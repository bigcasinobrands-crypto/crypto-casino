package blueocean

import (
	"encoding/json"
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

func TestParseCatalogGames_relativeImageBase(t *testing.T) {
	raw := json.RawMessage(`{"games":[{"id":1,"name":"Y","type":"slots","thumb":"/img/a.png"}]}`)
	games, err := ParseCatalogGames(raw, "https://static.example")
	if err != nil || len(games) != 1 || games[0].ThumbnailURL != "https://static.example/img/a.png" {
		t.Fatalf("%+v", games)
	}
}
