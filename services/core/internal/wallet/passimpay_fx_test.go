package wallet

import "testing"

func TestCryptoMinorToInternalMinor(t *testing.T) {
	fx := PassimSettlementFX{Num: 92, Den: 1_000_000, CryptoSymbol: "USDT", InternalCCY: "EUR"}
	got, err := CryptoMinorToInternalMinor(1_000_000, fx)
	if err != nil {
		t.Fatal(err)
	}
	if got != 92 {
		t.Fatalf("got %d want 92", got)
	}
}

func TestInternalMinorToCryptoMinor(t *testing.T) {
	fx := PassimSettlementFX{Num: 92, Den: 1_000_000}
	got, err := InternalMinorToCryptoMinor(92, fx)
	if err != nil {
		t.Fatal(err)
	}
	if got != 1_000_000 {
		t.Fatalf("got %d want 1e6", got)
	}
}

func TestCryptoMinorInternalRoundTripExact(t *testing.T) {
	fx := PassimSettlementFX{Num: 3, Den: 7}
	crypto := int64(7000)
	internal, err := CryptoMinorToInternalMinor(crypto, fx)
	if err != nil {
		t.Fatal(err)
	}
	back, err := InternalMinorToCryptoMinor(internal, fx)
	if err != nil {
		t.Fatal(err)
	}
	if back != crypto {
		t.Fatalf("round trip: crypto %d -> internal %d -> crypto %d", crypto, internal, back)
	}
}
