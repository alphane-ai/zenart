package security

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

const Redacted = "[REDACTED]"

var sensitiveKeyPattern = regexp.MustCompile(`(?i)(secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|signature|session|cookie|authorization)`)

// RedactValue removes common secret-bearing fields from values before they are
// written to logs, errors, audit metadata, support records, or exported traces.
func RedactValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return RedactMap(typed)
	case map[string]string:
		out := make(map[string]string, len(typed))
		for key, val := range typed {
			if IsSensitiveKey(key) {
				out[key] = Redacted
				continue
			}
			out[key] = RedactString(val)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = RedactValue(item)
		}
		return out
	case string:
		return RedactString(typed)
	default:
		return value
	}
}

func RedactMap(input map[string]any) map[string]any {
	out := make(map[string]any, len(input))
	for key, value := range input {
		if IsSensitiveKey(key) {
			out[key] = Redacted
			continue
		}
		out[key] = RedactValue(value)
	}
	return out
}

func IsSensitiveKey(key string) bool {
	return sensitiveKeyPattern.MatchString(strings.TrimSpace(key))
}

func RedactString(value string) string {
	value = redactURLCredentials(value)
	value = redactBearer(value)
	value = redactAssignments(value)
	return value
}

func redactURLCredentials(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.User == nil {
		return value
	}
	parsed.User = url.UserPassword(Redacted, Redacted)
	return parsed.String()
}

func redactBearer(value string) string {
	fields := strings.Fields(value)
	if len(fields) == 2 && strings.EqualFold(fields[0], "bearer") {
		return fields[0] + " " + Redacted
	}
	return value
}

func redactAssignments(value string) string {
	for _, sep := range []string{"=", ":"} {
		parts := strings.Split(value, sep)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		if !IsSensitiveKey(key) {
			continue
		}
		return fmt.Sprintf("%s%s%s", key, sep, Redacted)
	}
	return value
}
