package bonus

import "testing"

func TestHumanizeOfferTitle_e2eSlug(t *testing.T) {
	const slug = "e2e-sim-034e28c8"
	got := HumanizeOfferTitle(42, slug, "", "deposit_match")
	if got != "Deposit match" {
		t.Fatalf("expected Deposit match from bonus_type; got %q", got)
	}

	got = HumanizeOfferTitle(7, slug, "**Welcome**\nextra", "")
	if got != "Welcome" {
		t.Fatalf("expected first line from description; got %q", got)
	}
}

func TestHumanizeOfferTitle_preservesMarketingTitle(t *testing.T) {
	got := HumanizeOfferTitle(1, "Weekend Reload 50%", "x", "reload_deposit")
	if got != "Weekend Reload 50%" {
		t.Fatalf("got %q", got)
	}
}

func TestLooksLikeInternalPromoTitle(t *testing.T) {
	if !looksLikeInternalPromoTitle("e2e-sim-deadbeef") {
		t.Fatal("expected e2e sim slug")
	}
	if looksLikeInternalPromoTitle("Welcome bonus") {
		t.Fatal("expected marketing title untouched")
	}
}
