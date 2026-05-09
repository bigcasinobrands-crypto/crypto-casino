package webhooks

import (
	"crypto/sha1"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestVerifyBlueOceanWalletKey_JSONKeyOrder(t *testing.T) {
	salt := "t"
	body := `{"action":"credit","remote_id":"1","amount":10,"key":"dummy"}`
	req, err := http.NewRequest(http.MethodPost, "/callback", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	merged := url.Values{}
	merged.Set("action", "credit")
	merged.Set("remote_id", "1")
	merged.Set("amount", "10")

	signing, ok := blueOceanSigningFromPostJSONBody(req)
	if !ok || signing == "" {
		t.Fatalf("signing=%q ok=%v", signing, ok)
	}
	sum := sha1.Sum([]byte(salt + signing))
	want := fmt.Sprintf("%x", sum)
	merged.Set("key", want)
	if !verifyBlueOceanWalletKey(req, merged, salt, want) {
		t.Fatalf("verify failed signing=%q", signing)
	}
}

func TestVerifyBlueOceanWalletKey_orderedRawQuery(t *testing.T) {
	salt := "s"
	raw := "action=debit&remote_id=2&amount=5"
	ordered := blueOceanSigningFromRawOrdered(raw)
	sum := sha1.Sum([]byte(salt + ordered))
	want := fmt.Sprintf("%x", sum)
	req, err := http.NewRequest(http.MethodGet, "/?"+raw+"&key="+want, nil)
	if err != nil {
		t.Fatal(err)
	}
	merged, err := url.ParseQuery(req.URL.RawQuery)
	if err != nil {
		t.Fatal(err)
	}
	if !verifyBlueOceanWalletKey(req, merged, salt, want) {
		t.Fatalf("ordered raw verify failed signed=%q", ordered)
	}
}
