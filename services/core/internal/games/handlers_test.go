package games

import "testing"

func TestParseTruthy(t *testing.T) {
	if !parseTruthy("1") || !parseTruthy("true") || !parseTruthy(" YES ") {
		t.Fatal("expected true")
	}
	if parseTruthy("") || parseTruthy("0") || parseTruthy("no") {
		t.Fatal("expected false")
	}
}

func TestParsePublicLimit(t *testing.T) {
	if parsePublicLimit("") != 0 || parsePublicLimit("abc") != 0 || parsePublicLimit("0") != 0 {
		t.Fatal("empty/bad -> 0")
	}
	if parsePublicLimit("1") != 1 || parsePublicLimit("500") != 500 {
		t.Fatal("bounds")
	}
	if parsePublicLimit("2001") != 2000 || parsePublicLimit("99999") != 2000 {
		t.Fatal("cap at 2000")
	}
	if parsePublicOffset("") != 0 || parsePublicOffset("abc") != 0 || parsePublicOffset("-1") != 0 {
		t.Fatal("offset bad")
	}
	if parsePublicOffset("100") != 100 {
		t.Fatal("offset")
	}
}
