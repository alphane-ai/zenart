package security

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"reflect"
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
	SecretKindCloudKey      SecretKind = "cloud_key"
	SecretKindSignedURL     SecretKind = "signed_url_secret"
	SecretKindServiceAcct   SecretKind = "service_account"
	SecretKindRegistryAuth  SecretKind = "registry_auth"
	SecretKindEncryptionKey SecretKind = "encryption_key"
)

type SecretFinding struct {
	Kind     SecretKind `json:"kind"`
	Signal   string     `json:"signal"`
	Location string     `json:"location,omitempty"`
}

var sensitiveKeyPattern = regexp.MustCompile(`(?i)(secret|token|password|passwd|pwd|passphrase|api[_-]?key|x[_-]?api[_-]?key|access[_-]?key|private[_-]?key|private[_-]?token|deploy[_-]?key|credential|signature|session|cookie|authorization|proxy[_-]?authorization|client[_-]?secret|client[_-]?token|client[_-]?assertion|refresh[_-]?token|id[_-]?token|personal[_-]?access[_-]?token|pat|jwt|oauth|webhook[_-]?secret|signing[_-]?key|routing[_-]?key|integration[_-]?key|shared[_-]?access[_-]?signature|sas|stripe|openai|anthropic|deepseek|mistral|cohere|gemini|google[_-]?ai|openrouter|perplexity|xai|fireworks|fal|elevenlabs|provider[_-]?key|sentry|datadog|honeycomb|posthog|segment|amplitude|mixpanel|launchdarkly|pagerduty|opsgenie|zendesk|intercom|resend|postmark|mailchimp|clerk|auth0|supabase|firebase|database[_-]?url|dsn|connection[_-]?string|connectionstring|service[_-]?account|storage[_-]?key|account[_-]?key|subscription[_-]?key|tenant[_-]?secret|encryption[_-]?customer[_-]?key|customer[_-]?encryption[_-]?key|sse[_-]?customer[_-]?key|docker[_-]?auth|dockerconfigjson|dockercfg|image[_-]?pull[_-]?secret|registry[_-]?(auth|token|password))`)

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
	{SecretKindCloudKey, "google_api_key", regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{35}\b`)},
	{SecretKindCloudKey, "azure_storage_key", regexp.MustCompile(`(?i)\bDefaultEndpointsProtocol=https?;AccountName=[A-Za-z0-9]+;AccountKey=[A-Za-z0-9+/=]{20,}`)},
	{SecretKindToken, "github_token", regexp.MustCompile(`\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b`)},
	{SecretKindToken, "github_fine_grained_token", regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{20,}\b`)},
	{SecretKindToken, "gitlab_token", regexp.MustCompile(`\b(?:glpat|glrt|glcbt|glimt|glsoat|glagent)-[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindToken, "jwt", regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`)},
	{SecretKindToken, "vercel_token", regexp.MustCompile(`\bvercel_[A-Za-z0-9]{20,}\b`)},
	{SecretKindToken, "npm_token", regexp.MustCompile(`\bnpm_[A-Za-z0-9]{20,}\b`)},
	{SecretKindWebhookSecret, "slack_webhook_url", regexp.MustCompile(`https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}`)},
	{SecretKindWebhookSecret, "discord_webhook_url", regexp.MustCompile(`https://discord(?:app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9._-]{20,}`)},
	{SecretKindProviderKey, "anthropic_key", regexp.MustCompile(`\bsk-ant-[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "linear_key", regexp.MustCompile(`\blin_api_[A-Za-z0-9]{20,}\b`)},
	{SecretKindProviderKey, "huggingface_token", regexp.MustCompile(`\bhf_[A-Za-z0-9]{20,}\b`)},
	{SecretKindProviderKey, "replicate_token", regexp.MustCompile(`\br8_[A-Za-z0-9]{20,}\b`)},
	{SecretKindProviderKey, "stability_key", regexp.MustCompile(`\bsk-[A-Za-z0-9]{32,}\b`)},
	{SecretKindProviderKey, "groq_key", regexp.MustCompile(`\bgsk_[A-Za-z0-9]{20,}\b`)},
	{SecretKindProviderKey, "together_key", regexp.MustCompile(`\btgp_v1_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "pinecone_key", regexp.MustCompile(`\bpcsk_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "openrouter_key", regexp.MustCompile(`\bsk-or-v1-[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "perplexity_key", regexp.MustCompile(`\bpplx-[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "xai_key", regexp.MustCompile(`\bxai-[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "fireworks_key", regexp.MustCompile(`\bfw_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "fal_key", regexp.MustCompile(`\bfal-[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "elevenlabs_key", regexp.MustCompile(`\bsk_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "figma_token", regexp.MustCompile(`\bfigd_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "notion_token", regexp.MustCompile(`\bsecret_[A-Za-z0-9]{20,}\b`)},
	{SecretKindProviderKey, "langsmith_token", regexp.MustCompile(`\blsv2_pt_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindToken, "supabase_jwt", regexp.MustCompile(`\bsb_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindToken, "cloudflare_token", regexp.MustCompile(`\b(?:CFPAT|cfpat)_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindToken, "datadog_key", regexp.MustCompile(`\b(?:dd|datadog)_[A-Za-z0-9]{20,}\b`)},
	{SecretKindToken, "sentry_auth_token", regexp.MustCompile(`\bsntrys_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindToken, "posthog_key", regexp.MustCompile(`\bphx_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindProviderKey, "resend_key", regexp.MustCompile(`\bre_[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindToken, "sendgrid_key", regexp.MustCompile(`\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b`)},
	{SecretKindToken, "mailgun_key", regexp.MustCompile(`\bkey-[A-Za-z0-9]{20,}\b`)},
	{SecretKindWebhookSecret, "stripe_webhook_secret", regexp.MustCompile(`\bwhsec_[A-Za-z0-9]{20,}\b`)},
	{SecretKindToken, "shopify_access_token", regexp.MustCompile(`\bshp(?:at|ca|ss)_[A-Za-z0-9]{20,}\b`)},
	{SecretKindAccessKey, "aws_secret_access_key_assignment", regexp.MustCompile(`(?i)\b(?:aws[_-]?)?secret[_-]?access[_-]?key\s*[=:]\s*("[A-Za-z0-9/+=]{32,}"|'[A-Za-z0-9/+=]{32,}'|[A-Za-z0-9/+=]{32,})`)},
	{SecretKindToken, "twilio_key", regexp.MustCompile(`\bSK[0-9a-fA-F]{32}\b`)},
	{SecretKindToken, "square_token", regexp.MustCompile(`\bEAAA[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindCloudKey, "digitalocean_token", regexp.MustCompile(`\bdop_v1_[0-9a-f]{64}\b`)},
	{SecretKindToken, "netlify_token", regexp.MustCompile(`\bnfp_[A-Za-z0-9]{20,}\b`)},
	{SecretKindToken, "railway_token", regexp.MustCompile(`\brailway_[A-Za-z0-9]{20,}\b`)},
	{SecretKindCloudKey, "google_oauth_token", regexp.MustCompile(`\bya29\.[0-9A-Za-z_-]{20,}\b`)},
	{SecretKindCloudKey, "firebase_server_key", regexp.MustCompile(`\bAAAA[A-Za-z0-9_-]{7,}:APA91b[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindCloudKey, "azure_devops_pat", regexp.MustCompile(`\bazdpat[A-Za-z0-9]{20,}\b`)},
	{SecretKindToken, "grafana_service_account_token", regexp.MustCompile(`\bglsa_[A-Za-z0-9_]{20,}\b`)},
	{SecretKindToken, "pulumi_access_token", regexp.MustCompile(`\bpul-[A-Fa-f0-9]{40}\b`)},
	{SecretKindToken, "databricks_pat", regexp.MustCompile(`\bdapi[a-f0-9]{32}\b`)},
	{SecretKindToken, "fly_token", regexp.MustCompile(`\bFlyV1\s+[A-Za-z0-9+/_=:-]{20,}\b`)},
	{SecretKindRegistryAuth, "docker_auth_token", regexp.MustCompile(`(?i)\b(?:docker|registry|container)[_-]?(?:auth|token|password)\s*[=:]\s*("[A-Za-z0-9+/=._-]{20,}"|'[A-Za-z0-9+/=._-]{20,}'|[A-Za-z0-9+/=._-]{20,})`)},
	{SecretKindRegistryAuth, "dockerconfigjson_auth", regexp.MustCompile(`(?i)"auth"\s*:\s*"[A-Za-z0-9+/=]{20,}"`)},
	{SecretKindPrivateKey, "private_key_block_literal", regexp.MustCompile(`(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----`)},
	{SecretKindPrivateKey, "github_app_private_key", regexp.MustCompile(`(?i)\bgithub[_-]?app[_-]?private[_-]?key\s*[=:]\s*("[A-Za-z0-9+/=\\n-]{20,}"|'[A-Za-z0-9+/=\\n-]{20,}'|[A-Za-z0-9+/=\\n-]{20,})`)},
	{SecretKindToken, "render_api_key", regexp.MustCompile(`\brnd_[A-Za-z0-9]{20,}\b`)},
	{SecretKindToken, "doppler_token", regexp.MustCompile(`\bdp\.pt\.[A-Za-z0-9._-]{20,}\b`)},
	{SecretKindToken, "vault_token", regexp.MustCompile(`\bhvs\.[A-Za-z0-9_-]{20,}\b`)},
	{SecretKindEncryptionKey, "sse_customer_key_assignment", regexp.MustCompile(`(?i)\b(?:x[_-]?amz[_-]?)?(?:server[_-]?side[_-]?encryption[_-]customer[_-]?key|sse[_-]?customer[_-]?key|customer[_-]?provided[_-]?key)\s*[=:]\s*("[A-Za-z0-9+/=]{20,}"|'[A-Za-z0-9+/=]{20,}'|[A-Za-z0-9+/=]{20,})`)},
	{SecretKindRegistryAuth, "kubernetes_pull_secret", regexp.MustCompile(`(?i)\b(?:image[_-]?pull[_-]?secret|dockerconfigjson|dockercfg)\s*[=:]\s*("[A-Za-z0-9+/=._-]{20,}"|'[A-Za-z0-9+/=._-]{20,}'|[A-Za-z0-9+/=._-]{20,})`)},
}

var assignmentPattern = regexp.MustCompile(`(?i)\b([A-Za-z0-9_.-]*(?:secret|token|password|passwd|pwd|passphrase|api[_-]?key|x[_-]?api[_-]?key|access[_-]?key|private[_-]?key|private[_-]?token|deploy[_-]?key|credential|signature|session|cookie|authorization|proxy[_-]?authorization|client[_-]?secret|client[_-]?token|client[_-]?assertion|refresh[_-]?token|personal[_-]?access[_-]?token|webhook[_-]?secret|signing[_-]?key|shared[_-]?access[_-]?signature|database[_-]?url|dsn|connection[_-]?string|connectionstring|service[_-]?account|storage[_-]?key|account[_-]?key|subscription[_-]?key|tenant[_-]?secret|encryption[_-]?customer[_-]?key|customer[_-]?encryption[_-]?key|sse[_-]?customer[_-]?key|dockerconfigjson|dockercfg|image[_-]?pull[_-]?secret)[A-Za-z0-9_.-]*)\s*([=:])\s*("[^"]*"|'[^']*'|[^\s,;&]+)`)
var embeddedURLPattern = regexp.MustCompile(`[A-Za-z][A-Za-z0-9+.-]*://[^\s"'<>]+`)

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

type HTTPMalwareScanner struct {
	Endpoint string
	APIKey   string
	Provider string
	Client   *http.Client
	Timeout  time.Duration
	Now      func() time.Time
}

func (s HTTPMalwareScanner) Scan(ctx context.Context, target MalwareScanTarget) (MalwareScanResult, error) {
	endpoint := strings.TrimSpace(s.Endpoint)
	if endpoint == "" {
		return MalwareScanResult{}, errors.New("malware scan endpoint is required")
	}
	if strings.TrimSpace(target.TenantID) == "" || strings.TrimSpace(target.ObjectKey) == "" {
		return MalwareScanResult{}, errors.New("malware scan tenant_id and object_key are required")
	}
	target.Metadata = RedactStringMap(target.Metadata)
	body, err := json.Marshal(target)
	if err != nil {
		return MalwareScanResult{}, err
	}
	if s.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.Timeout)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return MalwareScanResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if strings.TrimSpace(s.APIKey) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(s.APIKey))
	}
	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return MalwareScanResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		limited, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return MalwareScanResult{}, fmt.Errorf("malware scan endpoint returned %d: %s", resp.StatusCode, RedactString(strings.TrimSpace(string(limited))))
	}
	var result MalwareScanResult
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return MalwareScanResult{}, err
	}
	status, ok := NormalizeMalwareScanStatus(result.Status)
	if !ok {
		return MalwareScanResult{}, fmt.Errorf("malware scan endpoint returned unsupported status %q", result.Status)
	}
	result.Status = status
	result.Provider = RedactString(strings.TrimSpace(result.Provider))
	if result.Provider == "" {
		result.Provider = strings.TrimSpace(s.Provider)
	}
	if result.Provider == "" {
		result.Provider = "http"
	}
	result.Signature = RedactString(strings.TrimSpace(result.Signature))
	if result.Signature == "" {
		result.Signature = "http-v1"
	}
	result.Rationale = RedactString(result.Rationale)
	if result.ScannedAt.IsZero() {
		result.ScannedAt = s.clock()
	}
	result.Metadata = RedactStringMap(result.Metadata)
	return result, nil
}

func NormalizeMalwareScanStatus(status MalwareScanStatus) (MalwareScanStatus, bool) {
	switch MalwareScanStatus(strings.ToLower(strings.TrimSpace(string(status)))) {
	case MalwareScanStatusClean:
		return MalwareScanStatusClean, true
	case MalwareScanStatusSuspicious:
		return MalwareScanStatusSuspicious, true
	case MalwareScanStatusUnavailable, "":
		return MalwareScanStatusUnavailable, true
	case MalwareScanStatusError:
		return MalwareScanStatusError, true
	default:
		return "", false
	}
}

func (s HTTPMalwareScanner) clock() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
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
	normalized := normalizeSecretKey(key)
	if key == "" || (!sensitiveKeyPattern.MatchString(key) && !sensitiveKeyPattern.MatchString(normalized)) {
		return nil
	}
	lower := strings.ToLower(key) + "_" + normalized
	kind := SecretKindSensitiveKey
	switch {
	case strings.Contains(lower, "docker") || strings.Contains(lower, "registry"):
		kind = SecretKindRegistryAuth
	case strings.Contains(lower, "dockercfg") || strings.Contains(lower, "pull_secret"):
		kind = SecretKindRegistryAuth
	case strings.Contains(lower, "password") || strings.Contains(lower, "passwd") || strings.Contains(lower, "pwd"):
		kind = SecretKindPassword
	case strings.Contains(lower, "encryption_customer_key") || strings.Contains(lower, "customer_encryption_key") || strings.Contains(lower, "sse_customer_key"):
		kind = SecretKindEncryptionKey
	case strings.Contains(lower, "private") && (strings.Contains(lower, "key") || strings.Contains(lower, "token")):
		kind = SecretKindPrivateKey
	case strings.Contains(lower, "deploy") && strings.Contains(lower, "key"):
		kind = SecretKindPrivateKey
	case strings.Contains(lower, "api") && strings.Contains(lower, "key"):
		kind = SecretKindAPIKey
	case strings.Contains(lower, "access") && strings.Contains(lower, "key"):
		kind = SecretKindAccessKey
	case strings.Contains(lower, "account") && strings.Contains(lower, "key"):
		kind = SecretKindAccessKey
	case strings.Contains(lower, "subscription") && strings.Contains(lower, "key"):
		kind = SecretKindAccessKey
	case strings.Contains(lower, "webhook") || strings.Contains(lower, "signing"):
		kind = SecretKindWebhookSecret
	case strings.Contains(lower, "authorization"):
		kind = SecretKindAuthorization
	case strings.Contains(lower, "cookie"):
		kind = SecretKindCookie
	case strings.Contains(lower, "service") && strings.Contains(lower, "account"):
		kind = SecretKindServiceAcct
	case strings.Contains(lower, "sentry") || strings.Contains(lower, "datadog") || strings.Contains(lower, "honeycomb") ||
		strings.Contains(lower, "posthog") || strings.Contains(lower, "segment") || strings.Contains(lower, "amplitude") ||
		strings.Contains(lower, "mixpanel") || strings.Contains(lower, "launchdarkly"):
		kind = SecretKindToken
	case strings.Contains(lower, "pagerduty") || strings.Contains(lower, "opsgenie") || strings.Contains(lower, "zendesk") ||
		strings.Contains(lower, "intercom"):
		kind = SecretKindCredential
	case strings.Contains(lower, "resend") || strings.Contains(lower, "postmark") || strings.Contains(lower, "mailchimp"):
		kind = SecretKindProviderKey
	case strings.Contains(lower, "clerk") || strings.Contains(lower, "auth0") || strings.Contains(lower, "supabase") ||
		strings.Contains(lower, "firebase"):
		kind = SecretKindCredential
	case strings.Contains(lower, "client") && (strings.Contains(lower, "secret") || strings.Contains(lower, "token")):
		kind = SecretKindCredential
	case strings.Contains(lower, "client") && strings.Contains(lower, "assertion"):
		kind = SecretKindCredential
	case strings.Contains(lower, "credential") || strings.Contains(lower, "database") || strings.Contains(lower, "dsn") || strings.Contains(lower, "connection"):
		kind = SecretKindCredential
	case strings.Contains(lower, "token") || strings.Contains(lower, "jwt") || strings.Contains(lower, "oauth") || strings.Contains(lower, "session"):
		kind = SecretKindToken
	case strings.Contains(lower, "openai") || strings.Contains(lower, "anthropic") || strings.Contains(lower, "openrouter") ||
		strings.Contains(lower, "deepseek") || strings.Contains(lower, "mistral") || strings.Contains(lower, "cohere") ||
		strings.Contains(lower, "gemini") || strings.Contains(lower, "figma") || strings.Contains(lower, "notion") ||
		strings.Contains(lower, "langsmith") || strings.Contains(lower, "stripe") || strings.Contains(lower, "provider"):
		kind = SecretKindProviderKey
	}
	return []SecretFinding{{Kind: kind, Signal: "key_name"}}
}

func normalizeSecretKey(key string) string {
	var builder strings.Builder
	var previous rune
	for _, current := range strings.TrimSpace(key) {
		if current >= 'A' && current <= 'Z' {
			if builder.Len() > 0 && previous != '_' && previous != '-' && previous != '.' && previous != ' ' {
				builder.WriteByte('_')
			}
			current += 'a' - 'A'
		}
		switch current {
		case '-', '.', ' ', '/', ':':
			if builder.Len() > 0 && previous != '_' {
				builder.WriteByte('_')
				previous = '_'
			}
			continue
		default:
			builder.WriteRune(current)
			previous = current
		}
	}
	return strings.Trim(builder.String(), "_")
}

func ClassifyString(value string) []SecretFinding {
	var findings []SecretFinding
	findings = append(findings, classifyJSONString(value)...)
	if hasURLCredentials(value) {
		findings = append(findings, SecretFinding{Kind: SecretKindDSN, Signal: "url_credentials"})
	}
	if hasSensitiveURLQuery(value) {
		findings = append(findings, SecretFinding{Kind: SecretKindSignedURL, Signal: "url_query_secret"})
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
		return RedactStringMap(typed)
	case http.Header:
		return RedactStringSliceMap(map[string][]string(typed))
	case url.Values:
		return RedactStringSliceMap(map[string][]string(typed))
	case map[string][]string:
		return RedactStringSliceMap(typed)
	case map[string][]any:
		out := make(map[string][]any, len(typed))
		signedURLContext := hasSignedURLContextKeys(mapKeys(typed))
		for key, values := range typed {
			redactedValues := make([]any, len(values))
			if IsSensitiveKey(key) || shouldRedactStructuredSignedURLKey(key, signedURLContext) {
				for i := range values {
					redactedValues[i] = Redacted
				}
				out[key] = redactedValues
				continue
			}
			for i, item := range values {
				redactedValues[i] = RedactValue(item)
			}
			out[key] = redactedValues
		}
		return out
	case json.RawMessage:
		return json.RawMessage(RedactString(string(typed)))
	case []byte:
		return []byte(RedactString(string(typed)))
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = RedactValue(item)
		}
		return out
	case []string:
		out := make([]string, len(typed))
		for i, item := range typed {
			out[i] = RedactString(item)
		}
		return out
	case []map[string]any:
		out := make([]map[string]any, len(typed))
		for i, item := range typed {
			out[i] = RedactMap(item)
		}
		return out
	case []map[string]string:
		out := make([]map[string]string, len(typed))
		for i, item := range typed {
			out[i] = RedactStringMap(item)
		}
		return out
	case []map[string][]string:
		out := make([]map[string][]string, len(typed))
		for i, item := range typed {
			out[i] = RedactStringSliceMap(item)
		}
		return out
	case string:
		return RedactString(typed)
	case error:
		return RedactString(typed.Error())
	case url.URL:
		return RedactString(typed.String())
	case *url.URL:
		if typed == nil {
			return typed
		}
		return RedactString(typed.String())
	case slog.Attr:
		return redactSlogAttr(typed)
	case slog.Value:
		return redactSlogValue("", typed)
	case slog.LogValuer:
		return RedactValue(typed.LogValue())
	case []slog.Attr:
		out := make([]slog.Attr, len(typed))
		for i, attr := range typed {
			out[i] = redactSlogAttr(attr)
		}
		return out
	case fmt.Stringer:
		return RedactString(typed.String())
	default:
		if redacted, ok := redactReflectValue(value); ok {
			return redacted
		}
		return value
	}
}

type RedactingSlogHandler struct {
	next slog.Handler
}

func NewRedactingSlogHandler(next slog.Handler) slog.Handler {
	return RedactingSlogHandler{next: next}
}

func (h RedactingSlogHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.next.Enabled(ctx, level)
}

func (h RedactingSlogHandler) Handle(ctx context.Context, record slog.Record) error {
	redacted := slog.NewRecord(record.Time, record.Level, RedactString(record.Message), record.PC)
	record.Attrs(func(attr slog.Attr) bool {
		redacted.AddAttrs(redactSlogAttr(attr))
		return true
	})
	return h.next.Handle(ctx, redacted)
}

func (h RedactingSlogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	redacted := make([]slog.Attr, len(attrs))
	for i, attr := range attrs {
		redacted[i] = redactSlogAttr(attr)
	}
	return RedactingSlogHandler{next: h.next.WithAttrs(redacted)}
}

func (h RedactingSlogHandler) WithGroup(name string) slog.Handler {
	return RedactingSlogHandler{next: h.next.WithGroup(name)}
}

func redactSlogAttr(attr slog.Attr) slog.Attr {
	attr.Value = redactSlogValue(attr.Key, attr.Value)
	return attr
}

func redactSlogValue(key string, value slog.Value) slog.Value {
	value = value.Resolve()
	if IsSensitiveKey(key) {
		return slog.StringValue(Redacted)
	}
	switch value.Kind() {
	case slog.KindString:
		return slog.StringValue(RedactString(value.String()))
	case slog.KindAny:
		return slog.AnyValue(RedactValue(value.Any()))
	case slog.KindGroup:
		group := value.Group()
		redacted := make([]slog.Attr, len(group))
		for i, attr := range group {
			redacted[i] = redactSlogAttr(attr)
		}
		return slog.GroupValue(redacted...)
	default:
		return value
	}
}

func RedactMap(input map[string]any) map[string]any {
	out := make(map[string]any, len(input))
	signedURLContext := hasSignedURLContextKeys(mapKeys(input))
	for key, value := range input {
		if IsSensitiveKey(key) || shouldRedactStructuredSignedURLKey(key, signedURLContext) {
			out[key] = Redacted
			continue
		}
		out[key] = RedactValue(value)
	}
	return out
}

func RedactStringMap(input map[string]string) map[string]string {
	if input == nil {
		return nil
	}
	out := make(map[string]string, len(input))
	signedURLContext := hasSignedURLContextKeys(mapKeys(input))
	for key, val := range input {
		if IsSensitiveKey(key) || shouldRedactStructuredSignedURLKey(key, signedURLContext) {
			out[key] = Redacted
			continue
		}
		out[key] = RedactString(val)
	}
	return out
}

func RedactStringSliceMap(input map[string][]string) map[string][]string {
	if input == nil {
		return nil
	}
	out := make(map[string][]string, len(input))
	for key, values := range input {
		redactedValues := make([]string, len(values))
		if IsSensitiveKey(key) || isSignedURLQueryKey(key) {
			for i := range values {
				redactedValues[i] = Redacted
			}
			out[key] = redactedValues
			continue
		}
		for i, value := range values {
			redactedValues[i] = RedactString(value)
		}
		out[key] = redactedValues
	}
	return out
}

func IsSensitiveKey(key string) bool {
	return len(ClassifyKey(key)) > 0
}

func RedactString(value string) string {
	value = redactJSONString(value)
	value = redactURLSecrets(value)
	value = redactAuthorization(value)
	value = redactAuthorizationAssignments(value)
	value = redactKnownSecretValues(value)
	value = redactAssignments(value)
	return value
}

func redactJSONString(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || (!strings.HasPrefix(trimmed, "{") && !strings.HasPrefix(trimmed, "[")) {
		return value
	}
	var decoded any
	decoder := json.NewDecoder(strings.NewReader(trimmed))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		return value
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return value
	}
	redacted, err := json.Marshal(RedactValue(decoded))
	if err != nil {
		return value
	}
	if len(value) == len(trimmed) {
		return string(redacted)
	}
	prefixLen := strings.Index(value, trimmed)
	if prefixLen < 0 {
		return string(redacted)
	}
	return value[:prefixLen] + string(redacted) + value[prefixLen+len(trimmed):]
}

func classifyJSONString(value string) []SecretFinding {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || (!strings.HasPrefix(trimmed, "{") && !strings.HasPrefix(trimmed, "[")) {
		return nil
	}
	var decoded any
	decoder := json.NewDecoder(strings.NewReader(trimmed))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		return nil
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return nil
	}
	return classifyValueAt(decoded, "")
}

func redactURLSecrets(value string) string {
	if strings.Contains(value, "://") {
		if isStandaloneURL(value) {
			if redacted, ok := redactSingleURL(value); ok {
				return redacted
			}
		}
		return embeddedURLPattern.ReplaceAllStringFunc(value, func(raw string) string {
			redacted, ok := redactSingleURL(raw)
			if !ok {
				return raw
			}
			return redacted
		})
	}
	return value
}

func isStandaloneURL(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.ContainsAny(trimmed, " \t\r\n") {
		return false
	}
	parsed, err := url.Parse(trimmed)
	return err == nil && parsed.Scheme != "" && parsed.Host != ""
}

func redactSingleURL(value string) (string, bool) {
	parsed, err := url.Parse(value)
	if err != nil || parsed.User == nil {
		if err != nil {
			return value, false
		}
	} else {
		parsed.User = url.UserPassword(Redacted, Redacted)
	}
	query := parsed.Query()
	changedQuery := false
	for key := range query {
		if IsSensitiveKey(key) || isSignedURLQueryKey(key) {
			query.Set(key, Redacted)
			changedQuery = true
		}
	}
	if changedQuery {
		parsed.RawQuery = query.Encode()
	}
	return parsed.String(), parsed.User != nil || changedQuery
}

func redactAuthorization(value string) string {
	return regexp.MustCompile(`(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/\-=]{3,}`).ReplaceAllString(value, "$1 "+Redacted)
}

func redactAuthorizationAssignments(value string) string {
	return regexp.MustCompile(`(?i)\b(Authorization|Proxy-Authorization)\s*:\s*(ApiKey|Token|Digest|Negotiate|AWS4-HMAC-SHA256|SharedKey|SharedKeyLite)\s+[^\s,;&]+`).ReplaceAllString(value, "$1: $2 "+Redacted)
}

func redactAssignments(value string) string {
	return assignmentPattern.ReplaceAllStringFunc(value, func(match string) string {
		parts := assignmentPattern.FindStringSubmatch(match)
		if len(parts) < 3 {
			return match
		}
		if isAuthorizationSchemeAssignment(parts[1], strings.Trim(parts[3], `"'`)) {
			return match
		}
		return fmt.Sprintf("%s%s%s", strings.TrimSpace(parts[1]), parts[2], Redacted)
	})
}

func isAuthorizationSchemeAssignment(key, value string) bool {
	normalizedKey := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(key), "_", "-"))
	if normalizedKey != "authorization" && normalizedKey != "proxy-authorization" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "apikey", "token", "digest", "negotiate", "aws4-hmac-sha256", "sharedkey", "sharedkeylite":
		return true
	default:
		return false
	}
}

func redactKnownSecretValues(value string) string {
	for _, detector := range secretValuePatterns {
		value = detector.pattern.ReplaceAllString(value, Redacted)
	}
	return value
}

func hasURLCredentials(value string) bool {
	parsed, err := url.Parse(value)
	if err == nil && parsed.User != nil {
		return true
	}
	for _, raw := range embeddedURLPattern.FindAllString(value, -1) {
		parsed, err := url.Parse(raw)
		if err == nil && parsed.User != nil {
			return true
		}
	}
	return false
}

func hasSensitiveURLQuery(value string) bool {
	if hasSensitiveQuery(value) {
		return true
	}
	for _, raw := range embeddedURLPattern.FindAllString(value, -1) {
		if hasSensitiveQuery(raw) {
			return true
		}
	}
	return false
}

func hasSensitiveQuery(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	for key := range parsed.Query() {
		if IsSensitiveKey(key) || isSignedURLQueryKey(key) {
			return true
		}
	}
	return false
}

func isSignedURLQueryKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(key), "_", "-"))
	switch normalized {
	case "x-amz-algorithm", "x-amz-credential", "x-amz-signature", "x-amz-security-token",
		"x-amz-date", "x-amz-expires", "x-amz-signedheaders", "x-amz-policy",
		"x-amz-server-side-encryption-customer-key", "x-amz-server-side-encryption-customer-key-md5",
		"x-amz-copy-source-server-side-encryption-customer-key", "x-amz-copy-source-server-side-encryption-customer-key-md5",
		"x-goog-credential", "x-goog-signature", "x-goog-security-token",
		"x-goog-algorithm", "x-goog-date", "x-goog-expires", "x-goog-signedheaders",
		"googleaccessid", "x-oss-signature", "x-oss-security-token", "x-oss-credential",
		"x-oss-date", "x-oss-expires", "x-oss-signature-version", "x-oss-additional-headers",
		"ossaccesskeyid", "security-token",
		"x-cos-signature", "x-cos-security-token", "q-sign-algorithm", "q-ak", "q-sign-time",
		"q-key-time", "q-header-list", "q-url-param-list", "q-signature",
		"x-bz-info-authorization", "x-bz-security-token", "authorization", "accesskeyid",
		"awsaccesskeyid", "signature", "sig", "token", "access-token", "download-token", "oauth-token",
		"expires", "policy", "key-pair-id", "cloudfront-signature", "cloudfront-policy", "cloudfront-key-pair-id",
		"se", "sp", "sip", "spr", "sr", "sv", "si", "ses", "sdd", "saoid", "suoid", "scid",
		"skoid", "sktid", "skt", "ske", "sks", "skv":
		return true
	default:
		return false
	}
}

func shouldRedactStructuredSignedURLKey(key string, signedURLContext bool) bool {
	return isStructuredSignedURLSecretKey(key) || (signedURLContext && isSignedURLQueryKey(key))
}

func hasSignedURLContextKeys(keys []string) bool {
	for _, key := range keys {
		if isSignedURLContextKey(key) {
			return true
		}
	}
	return false
}

func isSignedURLContextKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(key), "_", "-"))
	if strings.HasPrefix(normalized, "x-amz-") ||
		strings.HasPrefix(normalized, "x-goog-") ||
		strings.HasPrefix(normalized, "x-oss-") ||
		strings.HasPrefix(normalized, "x-cos-") ||
		strings.HasPrefix(normalized, "q-") ||
		strings.HasPrefix(normalized, "x-bz-") ||
		strings.HasPrefix(normalized, "cloudfront-") {
		return true
	}
	if isAzureSASKey(normalized) {
		return true
	}
	switch normalized {
	case "awsaccesskeyid", "googleaccessid", "ossaccesskeyid", "signature", "sig", "security-token", "accesskeyid":
		return true
	default:
		return false
	}
}

func isStructuredSignedURLSecretKey(key string) bool {
	normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(key), "_", "-"))
	switch normalized {
	case "x-amz-algorithm", "x-amz-credential", "x-amz-signature", "x-amz-security-token",
		"x-amz-date", "x-amz-expires", "x-amz-signedheaders",
		"x-amz-policy", "x-amz-server-side-encryption-customer-key",
		"x-amz-server-side-encryption-customer-key-md5",
		"x-amz-copy-source-server-side-encryption-customer-key",
		"x-amz-copy-source-server-side-encryption-customer-key-md5",
		"x-goog-algorithm", "x-goog-credential", "x-goog-signature", "x-goog-security-token",
		"x-goog-date", "x-goog-expires", "x-goog-signedheaders",
		"googleaccessid", "x-oss-signature", "x-oss-security-token", "x-oss-credential",
		"x-oss-date", "x-oss-expires", "x-oss-signature-version", "x-oss-additional-headers",
		"ossaccesskeyid", "security-token",
		"x-cos-signature", "x-cos-security-token", "q-sign-algorithm", "q-ak", "q-sign-time",
		"q-key-time", "q-header-list", "q-url-param-list", "q-signature",
		"x-bz-info-authorization", "x-bz-security-token", "authorization", "accesskeyid",
		"awsaccesskeyid", "cloudfront-signature", "cloudfront-policy", "cloudfront-key-pair-id":
		return true
	default:
		return isAzureSASKey(normalized)
	}
}

func isAzureSASKey(normalized string) bool {
	switch normalized {
	case "se", "sp", "sip", "spr", "sr", "sv", "si", "ses", "sdd", "saoid", "suoid", "scid",
		"skoid", "sktid", "skt", "ske", "sks", "skv":
		return true
	default:
		return false
	}
}

func classifyValueAt(value any, location string) []SecretFinding {
	var findings []SecretFinding
	switch typed := value.(type) {
	case map[string]any:
		signedURLContext := hasSignedURLContextKeys(mapKeys(typed))
		for key, val := range typed {
			childLocation := key
			if location != "" {
				childLocation = location + "." + key
			}
			for _, finding := range classifyStructuredKey(key, signedURLContext) {
				finding.Location = childLocation
				findings = append(findings, finding)
			}
			findings = append(findings, classifyValueAt(val, childLocation)...)
		}
	case map[string]string:
		signedURLContext := hasSignedURLContextKeys(mapKeys(typed))
		for key, val := range typed {
			childLocation := key
			if location != "" {
				childLocation = location + "." + key
			}
			for _, finding := range classifyStructuredKey(key, signedURLContext) {
				finding.Location = childLocation
				findings = append(findings, finding)
			}
			for _, finding := range ClassifyString(val) {
				finding.Location = childLocation
				findings = append(findings, finding)
			}
		}
	case http.Header:
		findings = append(findings, classifyStringSliceMapAt(map[string][]string(typed), location)...)
	case url.Values:
		findings = append(findings, classifyStringSliceMapAt(map[string][]string(typed), location)...)
	case map[string][]string:
		findings = append(findings, classifyStringSliceMapAt(typed, location)...)
	case map[string][]any:
		signedURLContext := hasSignedURLContextKeys(mapKeys(typed))
		for key, values := range typed {
			childLocation := key
			if location != "" {
				childLocation = location + "." + key
			}
			for _, finding := range classifyStructuredKey(key, signedURLContext) {
				finding.Location = childLocation
				findings = append(findings, finding)
			}
			for i, item := range values {
				valueLocation := fmt.Sprintf("%s[%d]", childLocation, i)
				if shouldRedactStructuredSignedURLKey(key, signedURLContext) {
					findings = append(findings, SecretFinding{Kind: SecretKindSignedURL, Signal: "url_query_secret", Location: valueLocation})
				}
				findings = append(findings, classifyValueAt(item, valueLocation)...)
			}
		}
	case []any:
		for i, item := range typed {
			childLocation := fmt.Sprintf("%s[%d]", location, i)
			findings = append(findings, classifyValueAt(item, childLocation)...)
		}
	case []string:
		for i, item := range typed {
			childLocation := fmt.Sprintf("%s[%d]", location, i)
			for _, finding := range ClassifyString(item) {
				finding.Location = joinFindingLocation(childLocation, finding.Location)
				findings = append(findings, finding)
			}
		}
	case []map[string]any:
		for i, item := range typed {
			childLocation := fmt.Sprintf("%s[%d]", location, i)
			findings = append(findings, classifyValueAt(item, childLocation)...)
		}
	case []map[string]string:
		for i, item := range typed {
			childLocation := fmt.Sprintf("%s[%d]", location, i)
			findings = append(findings, classifyValueAt(item, childLocation)...)
		}
	case []map[string][]string:
		for i, item := range typed {
			childLocation := fmt.Sprintf("%s[%d]", location, i)
			findings = append(findings, classifyValueAt(item, childLocation)...)
		}
	case json.RawMessage:
		for _, finding := range ClassifyString(string(typed)) {
			finding.Location = joinFindingLocation(location, finding.Location)
			findings = append(findings, finding)
		}
	case []byte:
		for _, finding := range ClassifyString(string(typed)) {
			finding.Location = joinFindingLocation(location, finding.Location)
			findings = append(findings, finding)
		}
	case string:
		for _, finding := range ClassifyString(typed) {
			finding.Location = joinFindingLocation(location, finding.Location)
			findings = append(findings, finding)
		}
	case error:
		for _, finding := range ClassifyString(typed.Error()) {
			finding.Location = joinFindingLocation(location, finding.Location)
			findings = append(findings, finding)
		}
	case url.URL:
		for _, finding := range ClassifyString(typed.String()) {
			finding.Location = joinFindingLocation(location, finding.Location)
			findings = append(findings, finding)
		}
	case *url.URL:
		if typed != nil {
			for _, finding := range ClassifyString(typed.String()) {
				finding.Location = joinFindingLocation(location, finding.Location)
				findings = append(findings, finding)
			}
		}
	case slog.Attr:
		findings = append(findings, classifySlogAttrAt(typed, location)...)
	case slog.Value:
		findings = append(findings, classifySlogValueAt("", typed, location)...)
	case slog.LogValuer:
		findings = append(findings, classifySlogValueAt("", typed.LogValue(), location)...)
	case []slog.Attr:
		for _, attr := range typed {
			findings = append(findings, classifySlogAttrAt(attr, location)...)
		}
	case fmt.Stringer:
		for _, finding := range ClassifyString(typed.String()) {
			finding.Location = joinFindingLocation(location, finding.Location)
			findings = append(findings, finding)
		}
	default:
		findings = append(findings, classifyReflectValueAt(value, location)...)
	}
	return findings
}

func redactReflectValue(value any) (any, bool) {
	redacted, ok := redactReflectValueAt(reflect.ValueOf(value), map[uintptr]struct{}{}, 0)
	return redacted, ok
}

func redactReflectValueAt(value reflect.Value, visited map[uintptr]struct{}, depth int) (any, bool) {
	if depth > 16 || !value.IsValid() {
		return nil, false
	}
	for value.Kind() == reflect.Interface || value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return nil, true
		}
		if value.Kind() == reflect.Pointer {
			ptr := value.Pointer()
			if _, seen := visited[ptr]; seen {
				return Redacted, true
			}
			visited[ptr] = struct{}{}
		}
		value = value.Elem()
	}
	if redacted, ok := redactKnownInterfaceValue(value); ok {
		return redacted, true
	}

	switch value.Kind() {
	case reflect.Map:
		if value.IsNil() {
			return nil, true
		}
		out := make(map[string]any, value.Len())
		signedURLContext := hasReflectSignedURLContextKeys(value)
		iter := value.MapRange()
		for iter.Next() {
			key := stringifyReflectKey(iter.Key())
			if IsSensitiveKey(key) || shouldRedactStructuredSignedURLKey(key, signedURLContext) {
				out[key] = Redacted
				continue
			}
			if redacted, ok := redactReflectValueAt(iter.Value(), visited, depth+1); ok {
				out[key] = redacted
				continue
			}
			out[key] = RedactValue(iter.Value().Interface())
		}
		return out, true
	case reflect.Struct:
		out := make(map[string]any, value.NumField())
		valueType := value.Type()
		for i := 0; i < value.NumField(); i++ {
			field := value.Field(i)
			fieldType := valueType.Field(i)
			if fieldType.PkgPath != "" {
				continue
			}
			key, include := redactedStructFieldName(fieldType)
			if !include {
				continue
			}
			if IsSensitiveKey(key) {
				out[key] = Redacted
				continue
			}
			if redacted, ok := redactReflectValueAt(field, visited, depth+1); ok {
				out[key] = redacted
				continue
			}
			out[key] = RedactValue(field.Interface())
		}
		return out, true
	case reflect.Slice, reflect.Array:
		if value.Kind() == reflect.Slice && value.IsNil() {
			return nil, true
		}
		out := make([]any, value.Len())
		for i := 0; i < value.Len(); i++ {
			if redacted, ok := redactReflectValueAt(value.Index(i), visited, depth+1); ok {
				out[i] = redacted
				continue
			}
			out[i] = RedactValue(value.Index(i).Interface())
		}
		return out, true
	case reflect.String:
		return RedactString(value.String()), true
	default:
		return nil, false
	}
}

func classifyReflectValueAt(value any, location string) []SecretFinding {
	return classifyReflectAt(reflect.ValueOf(value), location, map[uintptr]struct{}{}, 0)
}

func classifyReflectAt(value reflect.Value, location string, visited map[uintptr]struct{}, depth int) []SecretFinding {
	if depth > 16 || !value.IsValid() {
		return nil
	}
	for value.Kind() == reflect.Interface || value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return nil
		}
		if value.Kind() == reflect.Pointer {
			ptr := value.Pointer()
			if _, seen := visited[ptr]; seen {
				return nil
			}
			visited[ptr] = struct{}{}
		}
		value = value.Elem()
	}
	if findings, ok := classifyKnownInterfaceValueAt(value, location); ok {
		return findings
	}

	var findings []SecretFinding
	switch value.Kind() {
	case reflect.Map:
		signedURLContext := hasReflectSignedURLContextKeys(value)
		iter := value.MapRange()
		for iter.Next() {
			key := stringifyReflectKey(iter.Key())
			childLocation := key
			if location != "" {
				childLocation = location + "." + key
			}
			for _, finding := range classifyStructuredKey(key, signedURLContext) {
				finding.Location = childLocation
				findings = append(findings, finding)
			}
			findings = append(findings, classifyReflectAt(iter.Value(), childLocation, visited, depth+1)...)
		}
	case reflect.Struct:
		valueType := value.Type()
		for i := 0; i < value.NumField(); i++ {
			fieldType := valueType.Field(i)
			if fieldType.PkgPath != "" {
				continue
			}
			key, include := redactedStructFieldName(fieldType)
			if !include {
				continue
			}
			childLocation := key
			if location != "" {
				childLocation = location + "." + key
			}
			for _, finding := range ClassifyKey(key) {
				finding.Location = childLocation
				findings = append(findings, finding)
			}
			findings = append(findings, classifyReflectAt(value.Field(i), childLocation, visited, depth+1)...)
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < value.Len(); i++ {
			childLocation := fmt.Sprintf("%s[%d]", location, i)
			findings = append(findings, classifyReflectAt(value.Index(i), childLocation, visited, depth+1)...)
		}
	case reflect.String:
		for _, finding := range ClassifyString(value.String()) {
			finding.Location = joinFindingLocation(location, finding.Location)
			findings = append(findings, finding)
		}
	}
	return findings
}

func redactKnownInterfaceValue(value reflect.Value) (any, bool) {
	if !value.CanInterface() {
		return nil, false
	}
	switch typed := value.Interface().(type) {
	case map[string]any:
		return RedactMap(typed), true
	case map[string]string:
		return RedactStringMap(typed), true
	case http.Header:
		return RedactStringSliceMap(map[string][]string(typed)), true
	case url.Values:
		return RedactStringSliceMap(map[string][]string(typed)), true
	case map[string][]string:
		return RedactStringSliceMap(typed), true
	case map[string][]any:
		out := make(map[string][]any, len(typed))
		signedURLContext := hasSignedURLContextKeys(mapKeys(typed))
		for key, values := range typed {
			redactedValues := make([]any, len(values))
			if IsSensitiveKey(key) || shouldRedactStructuredSignedURLKey(key, signedURLContext) {
				for i := range values {
					redactedValues[i] = Redacted
				}
				out[key] = redactedValues
				continue
			}
			for i, item := range values {
				redactedValues[i] = RedactValue(item)
			}
			out[key] = redactedValues
		}
		return out, true
	case json.RawMessage:
		return json.RawMessage(RedactString(string(typed))), true
	case []byte:
		return []byte(RedactString(string(typed))), true
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = RedactValue(item)
		}
		return out, true
	case []string:
		out := make([]string, len(typed))
		for i, item := range typed {
			out[i] = RedactString(item)
		}
		return out, true
	case []map[string]any:
		out := make([]map[string]any, len(typed))
		for i, item := range typed {
			out[i] = RedactMap(item)
		}
		return out, true
	case []map[string]string:
		out := make([]map[string]string, len(typed))
		for i, item := range typed {
			out[i] = RedactStringMap(item)
		}
		return out, true
	case []map[string][]string:
		out := make([]map[string][]string, len(typed))
		for i, item := range typed {
			out[i] = RedactStringSliceMap(item)
		}
		return out, true
	case string:
		return RedactString(typed), true
	case error:
		return RedactString(typed.Error()), true
	case url.URL:
		return RedactString(typed.String()), true
	case slog.Attr:
		return redactSlogAttr(typed), true
	case slog.Value:
		return redactSlogValue("", typed), true
	case slog.LogValuer:
		return RedactValue(typed.LogValue()), true
	case []slog.Attr:
		out := make([]slog.Attr, len(typed))
		for i, attr := range typed {
			out[i] = redactSlogAttr(attr)
		}
		return out, true
	case fmt.Stringer:
		return RedactString(typed.String()), true
	default:
		return nil, false
	}
}

func classifyKnownInterfaceValueAt(value reflect.Value, location string) ([]SecretFinding, bool) {
	if !value.CanInterface() {
		return nil, false
	}
	switch typed := value.Interface().(type) {
	case map[string]any, map[string]string, http.Header, url.Values, map[string][]string, map[string][]any,
		[]any, []string, []map[string]any, []map[string]string, []map[string][]string,
		json.RawMessage, []byte, string, error, url.URL, slog.Attr, slog.Value, slog.LogValuer, []slog.Attr, fmt.Stringer:
		return classifyValueAt(typed, location), true
	default:
		return nil, false
	}
}

func stringifyReflectKey(value reflect.Value) string {
	if !value.IsValid() {
		return ""
	}
	if value.Kind() == reflect.Interface && !value.IsNil() {
		value = value.Elem()
	}
	if value.Kind() == reflect.String {
		return value.String()
	}
	if value.CanInterface() {
		return fmt.Sprint(value.Interface())
	}
	return fmt.Sprint(value)
}

func redactedStructFieldName(field reflect.StructField) (string, bool) {
	if tag := field.Tag.Get("json"); tag != "" {
		name := strings.Split(tag, ",")[0]
		switch name {
		case "-":
			return "", false
		case "":
		default:
			return name, true
		}
	}
	return field.Name, true
}

func classifySlogAttrAt(attr slog.Attr, location string) []SecretFinding {
	childLocation := attr.Key
	if location != "" {
		childLocation = location + "." + attr.Key
	}
	var findings []SecretFinding
	for _, finding := range ClassifyKey(attr.Key) {
		finding.Location = childLocation
		findings = append(findings, finding)
	}
	findings = append(findings, classifySlogValueAt(attr.Key, attr.Value, childLocation)...)
	return findings
}

func classifySlogValueAt(key string, value slog.Value, location string) []SecretFinding {
	value = value.Resolve()
	if IsSensitiveKey(key) {
		return nil
	}
	switch value.Kind() {
	case slog.KindString:
		var findings []SecretFinding
		for _, finding := range ClassifyString(value.String()) {
			finding.Location = joinFindingLocation(location, finding.Location)
			findings = append(findings, finding)
		}
		return findings
	case slog.KindAny:
		return classifyValueAt(value.Any(), location)
	case slog.KindGroup:
		var findings []SecretFinding
		for _, attr := range value.Group() {
			findings = append(findings, classifySlogAttrAt(attr, location)...)
		}
		return findings
	default:
		return nil
	}
}

func classifyStringSliceMapAt(input map[string][]string, location string) []SecretFinding {
	var findings []SecretFinding
	for key, values := range input {
		childLocation := key
		if location != "" {
			childLocation = location + "." + key
		}
		for _, finding := range ClassifyKey(key) {
			finding.Location = childLocation
			findings = append(findings, finding)
		}
		if isSignedURLQueryKey(key) {
			findings = append(findings, SecretFinding{Kind: SecretKindSignedURL, Signal: "url_query_secret", Location: childLocation})
		}
		for i, value := range values {
			valueLocation := fmt.Sprintf("%s[%d]", childLocation, i)
			if isSignedURLQueryKey(key) {
				findings = append(findings, SecretFinding{Kind: SecretKindSignedURL, Signal: "url_query_secret", Location: valueLocation})
			}
			for _, finding := range ClassifyString(value) {
				finding.Location = joinFindingLocation(valueLocation, finding.Location)
				findings = append(findings, finding)
			}
		}
	}
	return findings
}

func classifyStructuredKey(key string, signedURLContext bool) []SecretFinding {
	findings := ClassifyKey(key)
	if shouldRedactStructuredSignedURLKey(key, signedURLContext) {
		findings = append(findings, SecretFinding{Kind: SecretKindSignedURL, Signal: "url_query_secret"})
	}
	return findings
}

func mapKeys[T any](input map[string]T) []string {
	keys := make([]string, 0, len(input))
	for key := range input {
		keys = append(keys, key)
	}
	return keys
}

func hasReflectSignedURLContextKeys(value reflect.Value) bool {
	iter := value.MapRange()
	for iter.Next() {
		if isSignedURLContextKey(stringifyReflectKey(iter.Key())) {
			return true
		}
	}
	return false
}

func joinFindingLocation(parent, child string) string {
	if parent == "" {
		return child
	}
	if child == "" {
		return parent
	}
	if strings.HasPrefix(child, "[") {
		return parent + child
	}
	return parent + "." + child
}
