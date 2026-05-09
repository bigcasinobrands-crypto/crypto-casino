package webhooks

import (
	"crypto/sha1"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func TestQueryValsGetCI(t *testing.T) {
	q := url.Values{}
	q.Add("KEY", "abc123")
	if got := queryValsGetCI(q, "key"); got != "abc123" {
		t.Fatalf("got %q", got)
	}
}

func TestVerifyBlueOceanQueryKeyCaseInsensitiveKeyName(t *testing.T) {
	salt := "testsalt"
	q := url.Values{}
	q.Set("action", "balance")
	q.Set("remote_id", "42")
	without := url.Values{}
	for k, vals := range q {
		for _, v := range vals {
			without.Add(k, v)
		}
	}
	sum := sha1.Sum([]byte(salt + without.Encode()))
	wantKey := fmt.Sprintf("%x", sum)
	q.Set("Key", wantKey)
	if !verifyBlueOceanQueryKey(q, salt, queryValsGetCI(q, "key")) {
		t.Fatal("expected signature ok")
	}
}

func TestMergeBlueOceanParamsPOSTJSON(t *testing.T) {
	body := `{"action":"debit","remote_id":"1","amount":10,"key":"x"}`
	req := httptestNewJSONPost("/", body)
	q, err := mergeBlueOceanParams(req)
	if err != nil {
		t.Fatal(err)
	}
	if queryValsGetCI(q, "action") != "debit" {
		t.Fatalf("action=%q", queryValsGetCI(q, "action"))
	}
	if queryValsGetCI(q, "amount") != "10" {
		t.Fatalf("amount=%q", queryValsGetCI(q, "amount"))
	}
}

func httptestNewJSONPost(path, body string) *http.Request {
	req := httptestNewRequest(http.MethodPost, path, body)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	return req
}

func httptestNewRequest(method, path, body string) *http.Request {
	req, err := http.NewRequest(method, path, strings.NewReader(body))
	if err != nil {
		panic(err)
	}
	return req
}

func TestMergeBlueOceanParamsJSONNoContentType(t *testing.T) {
	req, err := http.NewRequest(http.MethodPost, "/", strings.NewReader(`{"action":"balance","remote_id":"9"}`))
	if err != nil {
		t.Fatal(err)
	}
	q, err := mergeBlueOceanParams(req)
	if err != nil {
		t.Fatal(err)
	}
	if queryValsGetCI(q, "remote_id") != "9" {
		t.Fatalf("remote_id=%q", queryValsGetCI(q, "remote_id"))
	}
}

func TestParseBOAmountCI_DecimalStringUsesIntMajorScaling(t *testing.T) {
	q := url.Values{}
	q.Set("amount", "10.00")
	n, ok := parseBOAmountCI(q, false, true)
	if !ok || n != 1000 {
		t.Fatalf("got %d ok=%v want 1000 minor", n, ok)
	}
}

func TestParseBOAmountCI_IntegerStaysMinorByDefault(t *testing.T) {
	q := url.Values{}
	q.Set("amount", "10")
	n, ok := parseBOAmountCI(q, false, false)
	if !ok || n != 10 {
		t.Fatalf("got %d ok=%v", n, ok)
	}
}

func TestParseBOAmountCI_IntegerMajorForBOBasicS2S(t *testing.T) {
	q := url.Values{}
	q.Set("amount", "10")
	n, ok := parseBOAmountCI(q, false, true)
	if !ok || n != 1000 {
		t.Fatalf("got %d ok=%v want 1000 minor", n, ok)
	}
}

func TestParseBOAmountCI_FloatMajorUnchangedWithIntMajor(t *testing.T) {
	q := url.Values{}
	q.Set("amount", "0.25")
	n, ok := parseBOAmountCI(q, true, true)
	if !ok || n != 25 {
		t.Fatalf("got %d ok=%v", n, ok)
	}
}

func TestFormatBOBalanceMinor(t *testing.T) {
	if got := formatBOBalanceMinor(30000); got != "300.00" {
		t.Fatalf("got %q", got)
	}
	if got := formatBOBalanceMinor(0); got != "0.00" {
		t.Fatalf("got %q", got)
	}
	if got := formatBOBalanceMinor(-105); got != "-1.05" {
		t.Fatalf("got %q", got)
	}
}
