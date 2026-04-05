package fystack

import (
	"encoding/json"
	"sort"
)

// CanonicalJSON sorts object keys recursively for webhook signature verification.
func CanonicalJSON(v any) (string, error) {
	norm := sortJSONValue(v)
	b, err := json.Marshal(norm)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func sortJSONValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make(map[string]any, len(t))
		for _, k := range keys {
			out[k] = sortJSONValue(t[k])
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i := range t {
			out[i] = sortJSONValue(t[i])
		}
		return out
	default:
		return v
	}
}
