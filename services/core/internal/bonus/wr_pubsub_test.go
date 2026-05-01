package bonus

import "testing"

func TestBuildWageringProgressPayload(t *testing.T) {
	p := buildWageringProgressPayload("u1", "i1", 3000, 350)
	if !p.Active || p.PctComplete != 11.67 {
		t.Fatalf("expected active + ~11.67, got %#v", p)
	}
	p2 := buildWageringProgressPayload("u1", "", 0, 0)
	if p2.Active {
		t.Fatal("expected inactive")
	}
	p3 := buildWageringProgressPayload("u1", "i1", 100, 100)
	if p3.PctComplete != 100 {
		t.Fatalf("expected 100%%, got %v", p3.PctComplete)
	}
}

func TestChannelWageringPlayer(t *testing.T) {
	if got, want := ChannelWageringPlayer("abc-123"), "wagering:player:abc-123"; got != want {
		t.Fatalf("channel: got %q want %q", got, want)
	}
}
