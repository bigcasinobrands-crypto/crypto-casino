package chat

import (
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
)

var linkPattern = regexp.MustCompile(`(?i)(https?://|www\.)[^\s]+`)
var mentionRe = regexp.MustCompile(`@(\w{2,20})`)
var htmlTagRe = regexp.MustCompile(`<[^>]*>`)

// profanity word list (lowercase). Extend as needed.
var profanityWords = []string{
	"nigger", "nigga", "faggot", "fag", "retard", "kys",
	"tranny", "chink", "spic", "wetback", "coon",
}

var l33tReplacements = map[rune]rune{
	'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
	'7': 't', '@': 'a', '$': 's', '!': 'i',
}

func normalizeLeet(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(s) {
		if rep, ok := l33tReplacements[r]; ok {
			b.WriteRune(rep)
		} else if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// FilterProfanity replaces profane words with ***.
func FilterProfanity(body string) string {
	normalized := normalizeLeet(body)
	result := body
	for _, word := range profanityWords {
		if strings.Contains(normalized, word) {
			result = replaceCaseInsensitive(result, word)
		}
	}
	return result
}

func replaceCaseInsensitive(text, word string) string {
	lower := strings.ToLower(text)
	wLen := len(word)
	var b strings.Builder
	b.Grow(len(text))
	i := 0
	for i < len(lower) {
		idx := strings.Index(lower[i:], word)
		if idx == -1 {
			b.WriteString(text[i:])
			break
		}
		b.WriteString(text[i : i+idx])
		b.WriteString("***")
		i += idx + wLen
	}
	return b.String()
}

// ContainsLink checks if the message body has a URL.
func ContainsLink(body string) bool {
	return linkPattern.MatchString(body)
}

// FloodTracker detects users sending too many messages too quickly.
type FloodTracker struct {
	mu      sync.Mutex
	windows map[string][]time.Time
}

func NewFloodTracker() *FloodTracker {
	return &FloodTracker{windows: make(map[string][]time.Time)}
}

// Record adds a timestamp for the user and returns true if flood is detected
// (5+ messages in 10 seconds).
func (ft *FloodTracker) Record(userID string) bool {
	ft.mu.Lock()
	defer ft.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-10 * time.Second)

	times := ft.windows[userID]
	filtered := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			filtered = append(filtered, t)
		}
	}
	filtered = append(filtered, now)
	ft.windows[userID] = filtered

	return len(filtered) >= 5
}

// DuplicateTracker rejects identical consecutive messages.
type DuplicateTracker struct {
	mu      sync.Mutex
	history map[string][]string
}

func NewDuplicateTracker() *DuplicateTracker {
	return &DuplicateTracker{history: make(map[string][]string)}
}

// IsDuplicate returns true if body matches any of the user's last 3 messages.
func (dt *DuplicateTracker) IsDuplicate(userID, body string) bool {
	dt.mu.Lock()
	defer dt.mu.Unlock()

	lower := strings.ToLower(strings.TrimSpace(body))
	for _, prev := range dt.history[userID] {
		if prev == lower {
			return true
		}
	}

	h := dt.history[userID]
	h = append(h, lower)
	if len(h) > 3 {
		h = h[len(h)-3:]
	}
	dt.history[userID] = h
	return false
}

// ParseMentions extracts @username tokens from a message body.
func ParseMentions(body string) []string {
	matches := mentionRe.FindAllStringSubmatch(body, 10)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[string]struct{})
	var result []string
	for _, m := range matches {
		name := m[1]
		if _, ok := seen[name]; !ok {
			seen[name] = struct{}{}
			result = append(result, name)
		}
	}
	return result
}

// SanitizeBody trims whitespace, control characters, and HTML tags; enforces max length.
func SanitizeBody(body string, maxLen int) string {
	body = htmlTagRe.ReplaceAllString(body, "")

	var b strings.Builder
	b.Grow(len(body))
	for _, r := range body {
		if r == '\n' || r == '\r' || r == '\t' {
			b.WriteRune(' ')
		} else if unicode.IsControl(r) {
			continue
		} else {
			b.WriteRune(r)
		}
	}
	s := strings.TrimSpace(b.String())
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	return s
}
