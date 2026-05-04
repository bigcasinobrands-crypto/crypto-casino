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

func TestTrafficEnrichment_v4FlatShape(t *testing.T) {
	root := map[string]any{
		"event_id": "e1",
		"browser_details": map[string]any{
			"device": "tablet",
		},
		"identification": map[string]any{
			"visitor_id": "v1",
		},
		"ip_info": map[string]any{
			"v4": map[string]any{
				"geolocation": map[string]any{
					"country_code": "CA",
				},
			},
		},
	}
	cc, dev := TrafficEnrichment(root)
	if cc != "CA" {
		t.Fatalf("country: %q", cc)
	}
	if dev != "tablet" {
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
