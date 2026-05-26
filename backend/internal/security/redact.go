package security

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const Redacted = "[REDACTED]"

type SecretKind string

const (
	SecretKindSensitiveKey  SecretKind = "sensitive_key"
	SecretKindPassword      SecretKind = "password"
	SecretKindToken         SecretKind = "token"
	SecretKindAPIKey        SecretKind = "api_key"
	SecretKindAccessKey     SecretKind = "access_key"
	SecretKindPrivateKey    SecretKind = "private_key"
	SecretKindCredential    SecretKind = "credential"
	SecretKindCookie        SecretKind = "cookie"
	SecretKindAuthorization SecretKind = "authorization"
	SecretKindWebhookSecret SecretKind = "webhook_secret"
	SecretKindDSN           SecretKind = "dsn_credentials"
	SecretKindProviderKey   SecretKind = "provider_key"
)

type SecretFinding struct {
	Kind     SecretKind `json:"kind"`
	Signal   string     `json:"signal"`
	Location string     `json:"location,omitempty"`
}

var sensitiveKeyPattern = regexp.MustCompile(`(?i)(secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|signature|session|cookie|authorization|client[_-]?secret|refresh[_-]?token|id[_-]?token|jwt|oauth|webhook[_-]?secret|signing[_-]?key|stripe|openai|anthropic|provider[_-]?key|database[_-]?url|dsn)`)

var secretValuePatterns = []struct {
	kind    SecretKind
	signal  string
	pattern *regexp.Regexp
}{
	{SecretKindAuthorization, "bearer_token", regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/\-=]{3,}`)},
	{SecretKindAuthorization, "basic_authorization", regexp.MustCompile(`(?i)\bBasic\s+[A-Za-z0-9+/=]{12,}`)},
	{SecretKindPrivateKey, "pem_private_key", regexp.MustCompile(`(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----`)},
	{SecretKindProviderKey, "openai_key", regexp.MustCompile(`\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "stripe_key", regexp.MustCompile(`\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b`)},
	{SecretKindProviderKey, "slack_token", regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}\b`)},
	{SecretKindAccessKey, "aws_access_key", regexp.MustCompile(`\b(?:AKIA|ASIA)[A-Z0-9]{16}\b`)},
	{SecretKindToken, "github_token", regexp.MustCompile(`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b`)},
	{SecretKindToken, "github_fine_grained_token", regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{20,}\b`)},
	{SecretKindToken, "jwt", regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`)},
}

var assignmentPattern = regexp.MustCompile(`(?i)\b([A-Za-z0-9_.-]*(?:secret|token|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|signature|session|cookie|authorization|client[_-]?secret|refresh[_-]?token|webhook[_-]?secret|signing[_-]?key|database[_-]?url|dsn)[A-Za-z0-9_.-]*)\s*([=:])\s*("[^"]*"|'[^']*'|[^\s,;&]+)`)

type MalwareScanStatus string

const (
	MalwareScanStatusClean       MalwareScanStatus = "clean"
	MalwareScanStatusSuspicious  MalwareScanStatus = "suspicious"
	MalwareScanStatusUnavailable MalwareScanStatus = "unavailable"
	MalwareScanStatusError       MalwareScanStatus = "error"
)

type MalwareScanTarget struct {
	TenantID    string            `json:"tenant_id"`
	ObjectKey   string            `json:"object_key"`
	ContentType string            `json:"content_type"`
	ByteSize    int64             `json:"byte_size"`
	Checksum    string            `json:"checksum,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

type MalwareScanResult struct {
	Status    MalwareScanStatus `json:"status"`
	Provider  string            `json:"provider"`
	Signature string            `json:"signature"`
	Rationale string            `json:"rationale"`
	ScannedAt time.Time         `json:"scanned_at"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

type MalwareScanner interface {
	Scan(ctx context.Context, target MalwareScanTarget) (MalwareScanResult, error)
}

type PlaceholderMalwareScanner struct {
	Provider string
	Now      func() time.Time
}

func (s PlaceholderMalwareScanner) Scan(ctx context.Context, target MalwareScanTarget) (MalwareScanResult, error) {
	if err := ctx.Err(); err != nil {
		return MalwareScanResult{}, err
	}
	status := MalwareScanStatusUnavailable
	rationale := "malware scanning interface is configured but no production scanner is connected"
	if strings.EqualFold(strings.TrimSpace(target.Metadata["stage0_force_malware_status"]), string(MalwareScanStatusSuspicious)) {
		status = MalwareScanStatusSuspicious
		rationale = "deterministic placeholder suspicious result requested by metadata"
	}
	provider := strings.TrimSpace(s.Provider)
	if provider == "" {
		provider = "stage0-placeholder"
	}
	now := time.Now().UTC()
	if s.Now != nil {
		now = s.Now().UTC()
	}
	return MalwareScanResult{
		Status:    status,
		Provider:  provider,
		Signature: "placeholder-v1",
		Rationale: rationale,
		ScannedAt: now,
	}, nil
}

func ClassifyKey(key string) []SecretFinding {
	key = strings.TrimSpace(key)
	if key == "" || !sensitiveKeyPattern.MatchString(key) {
		return nil
	}
	lower := strings.ToLower(key)
	kind := SecretKindSensitiveKey
	switch {
	case strings.Contains(lower, "password") || strings.Contains(lower, "passwd") || strings.Contains(lower, "pwd"):
		kind = SecretKindPassword
	case strings.Contains(lower, "api") && strings.Contains(lower, "key"):
		kind = SecretKindAPIKey
	case strings.Contains(lower, "access") && strings.Contains(lower, "key"):
		kind = SecretKindAccessKey
	case strings.Contains(lower, "private") && strings.Contains(lower, "key"):
		kind = SecretKindPrivateKey
	case strings.Contains(lower, "webhook") || strings.Contains(lower, "signing"):
		kind = SecretKindWebhookSecret
	case strings.Contains(lower, "authorization"):
		kind = SecretKindAuthorization
	case strings.Contains(lower, "cookie"):
		kind = SecretKindCookie
	case strings.Contains(lower, "credential") || strings.Contains(lower, "database") || strings.Contains(lower, "dsn"):
		kind = SecretKindCredential
	case strings.Contains(lower, "token") || strings.Contains(lower, "jwt") || strings.Contains(lower, "oauth") || strings.Contains(lower, "session"):
		kind = SecretKindToken
	case strings.Contains(lower, "openai") || strings.Contains(lower, "anthropic") || strings.Contains(lower, "stripe") || strings.Contains(lower, "provider"):
		kind = SecretKindProviderKey
	}
	return []SecretFinding{{Kind: kind, Signal: "key_name"}}
}

func ClassifyString(value string) []SecretFinding {
	var findings []SecretFinding
	if hasURLCredentials(value) {
		findings = append(findings, SecretFinding{Kind: SecretKindDSN, Signal: "url_credentials"})
	}
	for _, detector := range secretValuePatterns {
		if detector.pattern.MatchString(value) {
			findings = append(findings, SecretFinding{Kind: detector.kind, Signal: detector.signal})
		}
	}
	for _, match := range assignmentPattern.FindAllStringSubmatch(value, -1) {
		for _, keyFinding := range ClassifyKey(match[1]) {
			keyFinding.Signal = "assignment:" + keyFinding.Signal
			findings = append(findings, keyFinding)
		}
	}
	return findings
}

func ClassifyValue(value any) []SecretFinding {
	return classifyValueAt(value, "")
}

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
	return len(ClassifyKey(key)) > 0
}

func RedactString(value string) string {
	value = redactURLCredentials(value)
	value = redactAuthorization(value)
	value = redactKnownSecretValues(value)
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

func redactAuthorization(value string) string {
	return regexp.MustCompile(`(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/\-=]{3,}`).ReplaceAllString(value, "$1 "+Redacted)
}

func redactAssignments(value string) string {
	return assignmentPattern.ReplaceAllStringFunc(value, func(match string) string {
		parts := assignmentPattern.FindStringSubmatch(match)
		if len(parts) < 3 {
			return match
		}
		return fmt.Sprintf("%s%s%s", strings.TrimSpace(parts[1]), parts[2], Redacted)
	})
}

func redactKnownSecretValues(value string) string {
	for _, detector := range secretValuePatterns {
		value = detector.pattern.ReplaceAllString(value, Redacted)
	}
	return value
}

func hasURLCredentials(value string) bool {
	parsed, err := url.Parse(value)
	return err == nil && parsed.User != nil
}

func classifyValueAt(value any, location string) []SecretFinding {
	var findings []SecretFinding
	switch typed := value.(type) {
	case map[string]any:
		for key, val := range typed {
			childLocation := key
			if location != "" {
				childLocation = location + "." + key
			}
			for _, finding := range ClassifyKey(key) {
				finding.Location = childLocation
				findings = append(findings, finding)
			}
			findings = append(findings, classifyValueAt(val, childLocation)...)
		}
	case map[string]string:
		for key, val := range typed {
			childLocation := key
			if location != "" {
				childLocation = location + "." + key
			}
			for _, finding := range ClassifyKey(key) {
				finding.Location = childLocation
				findings = append(findings, finding)
			}
			for _, finding := range ClassifyString(val) {
				finding.Location = childLocation
				findings = append(findings, finding)
			}
		}
	case []any:
		for i, item := range typed {
			childLocation := fmt.Sprintf("%s[%d]", location, i)
			findings = append(findings, classifyValueAt(item, childLocation)...)
		}
	case string:
		for _, finding := range ClassifyString(typed) {
			finding.Location = location
			findings = append(findings, finding)
		}
	}
	return findings
}
