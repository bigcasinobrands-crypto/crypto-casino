package fingerprint

import "testing"

func TestTrafficEnrichment_nilRoot(t *testing.T) {
	cc, dev := TrafficEnrichment(nil)
	if cc != "" || dev != "unknown" {
		t.Fatalf("nil root: country=%q device=%q", cc, dev)
	}
}

func TestTrafficEnrichment_geoAndDevice(t *testing.T) {
	root := map[string]any{
		"products": map[string]any{
			"identification": map[string]any{
				"data": map[string]any{
					"visitorId": "v1",
					"requestId": "r1",
					"ipLocation": map[string]any{
						"country": map[string]any{"code": "CA"},
					},
					"browserDetails": map[string]any{
						"device": "smartphone",
					},
				},
			},
		},
	}
	cc, dev := TrafficEnrichment(root)
	if cc != "CA" {
		t.Fatalf("country: %q", cc)
	}
	if dev != "mobile" {
		t.Fatalf("device: %q", dev)
	}
}

func TestDeviceTypeFromEvent_desktopOther(t *testing.T) {
	root := map[string]any{
		"products": map[string]any{
			"identification": map[string]any{
				"data": map[string]any{
					"browserDetails": map[string]any{"device": "Other"},
				},
			},
		},
	}
	if d := DeviceTypeFromEvent(root); d != "desktop" {
		t.Fatalf("got %q", d)
	}
}
