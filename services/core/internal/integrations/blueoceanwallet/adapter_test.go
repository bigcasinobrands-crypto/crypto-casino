package blueoceanwallet

import "testing"

func TestAdapter_ProviderKey(t *testing.T) {
	a := &Adapter{}
	if a.ProviderKey() != "blueocean_v1" {
		t.Fatal(a.ProviderKey())
	}
}
