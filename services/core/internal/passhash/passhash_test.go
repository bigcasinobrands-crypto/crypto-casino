package passhash

import "testing"

func TestHashVerify_roundTrip(t *testing.T) {
	h, err := Hash("correct-horse-battery-staple-99")
	if err != nil {
		t.Fatal(err)
	}
	ok, rehash, err := Verify("correct-horse-battery-staple-99", h)
	if err != nil || !ok || rehash {
		t.Fatalf("got ok=%v rehash=%v err=%v", ok, rehash, err)
	}
	ok, _, _ = Verify("wrong", h)
	if ok {
		t.Fatal("expected mismatch")
	}
}
