package security

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestRedactMapRemovesNestedSecrets(t *testing.T) {
	redacted := RedactMap(map[string]any{
		"message": "ok",
		"api_key": "secret-value",
		"nested": map[string]any{
			"session_token": "token-value",
			"database_url":  "postgres://user:pass@localhost:5432/db",
		},
	})

	if redacted["message"] != "ok" {
		t.Fatalf("message = %v, want ok", redacted["message"])
	}
	if redacted["api_key"] != Redacted {
		t.Fatalf("api_key = %v, want redacted", redacted["api_key"])
	}
	nested := redacted["nested"].(map[string]any)
	if nested["session_token"] != Redacted {
		t.Fatalf("session_token = %v, want redacted", nested["session_token"])
	}
	if nested["database_url"] != Redacted {
		t.Fatalf("database_url = %v, want redacted", nested["database_url"])
	}
}

func TestRedactStringHandlesBearerAndAssignments(t *testing.T) {
	if got := RedactString("Bearer abc123"); got != "Bearer "+Redacted {
		t.Fatalf("bearer = %q, want redacted", got)
	}
	if got := RedactString("password=hunter2"); got != "password="+Redacted {
		t.Fatalf("assignment = %q, want redacted", got)
	}
}

func TestClassifyValueFindsNestedSecrets(t *testing.T) {
	findings := ClassifyValue(map[string]any{
		"public": "ok",
		"oauth": map[string]any{
			"client_secret": "secret",
			"note":          "Authorization: Bearer abcdefghijklmnop",
		},
		"items": []any{
			map[string]any{"dsn": "postgres://user:pass@localhost:5432/db"},
		},
	})

	if len(findings) < 4 {
		t.Fatalf("findings = %#v, want key and value classifications", findings)
	}
	assertFinding(t, findings, SecretKindSensitiveKey, "oauth.client_secret")
	assertFinding(t, findings, SecretKindAuthorization, "oauth.note")
	assertFinding(t, findings, SecretKindCredential, "items[0].dsn")
	assertFinding(t, findings, SecretKindDSN, "items[0].dsn")
}

func TestRedactStringHandlesProviderKeysAndInlineAssignments(t *testing.T) {
	input := `openai_api_key="sk-proj-abcdefghijklmnopqrstuvwxyz123456" ok stripe=rk_live_abcdefghijklmnop`
	got := RedactString(input)
	if got != `openai_api_key=`+Redacted+` ok stripe=`+Redacted {
		t.Fatalf("RedactString() = %q", got)
	}
}

func TestRedactStringCoversCloudAndProviderTokens(t *testing.T) {
	input := `google=AIza12345678901234567890123456789012345 anthropic=sk-ant-abcdefghijklmnopqrstuvwxyz123456 linear=lin_api_abcdefghijklmnopqrstuvwxyz azure=DefaultEndpointsProtocol=https;AccountName=zenart;AccountKey=abcdefghijklmnopqrstuvwxyz1234567890==`
	got := RedactString(input)
	if got != `google=`+Redacted+` anthropic=`+Redacted+` linear=`+Redacted+` azure=`+Redacted {
		t.Fatalf("RedactString() = %q", got)
	}
	findings := ClassifyString(input)
	assertSignal(t, findings, "google_api_key")
	assertSignal(t, findings, "anthropic_key")
	assertSignal(t, findings, "linear_key")
	assertSignal(t, findings, "azure_storage_key")
}

func TestRedactStringCoversAIStorageAndObservabilityTokens(t *testing.T) {
	input := strings.Join([]string{
		"hf=hf_abcdefghijklmnopqrstuvwxyz123456",
		"replicate=r8_abcdefghijklmnopqrstuvwxyz123456",
		"stability=sk-abcdefghijklmnopqrstuvwxyz1234567890",
		"groq=gsk_abcdefghijklmnopqrstuvwxyz123456",
		"together=tgp_v1_abcdefghijklmnopqrstuvwxyz123456",
		"pinecone=pcsk_abcdefghijklmnopqrstuvwxyz123456",
		"supabase=sb_abcdefghijklmnopqrstuvwxyz123456",
		"cloudflare=CFPAT_abcdefghijklmnopqrstuvwxyz123456",
		"datadog=dd_abcdefghijklmnopqrstuvwxyz123456",
		"sentry=sntrys_abcdefghijklmnopqrstuvwxyz123456",
	}, " ")
	got := RedactString(input)
	for _, leaked := range []string{
		"hf_abcdefghijklmnopqrstuvwxyz123456",
		"r8_abcdefghijklmnopqrstuvwxyz123456",
		"sk-abcdefghijklmnopqrstuvwxyz1234567890",
		"gsk_abcdefghijklmnopqrstuvwxyz123456",
		"tgp_v1_abcdefghijklmnopqrstuvwxyz123456",
		"pcsk_abcdefghijklmnopqrstuvwxyz123456",
		"sb_abcdefghijklmnopqrstuvwxyz123456",
		"CFPAT_abcdefghijklmnopqrstuvwxyz123456",
		"dd_abcdefghijklmnopqrstuvwxyz123456",
		"sntrys_abcdefghijklmnopqrstuvwxyz123456",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	findings := ClassifyString(input)
	for _, signal := range []string{
		"huggingface_token",
		"replicate_token",
		"stability_key",
		"groq_key",
		"together_key",
		"pinecone_key",
		"supabase_jwt",
		"cloudflare_token",
		"datadog_key",
		"sentry_auth_token",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactStringCoversWebhookAndGitLabTokens(t *testing.T) {
	input := strings.Join([]string{
		"gitlab=glpat-abcdefghijklmnopqrstuvwxyz123456",
		"slack=https://hooks.slack.com/services/T00000000/B00000000/abcdefghijklmnopqrstuvwxyz",
		"discord=https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456",
		"Authorization: Bearer abcdefghijklmnop",
	}, " ")
	got := RedactString(input)
	for _, leaked := range []string{
		"glpat-abcdefghijklmnopqrstuvwxyz123456",
		"hooks.slack.com/services/T00000000",
		"discord.com/api/webhooks/123456789012345678",
		"abcdefghijklmnop",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	findings := ClassifyString(input)
	assertSignal(t, findings, "gitlab_token")
	assertSignal(t, findings, "slack_webhook_url")
	assertSignal(t, findings, "discord_webhook_url")
}

func TestRedactStringCoversEmbeddedSignedURLsAndRegistryTokens(t *testing.T) {
	input := `download https://s3.local/zenart/export.zip?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE&X-Amz-Signature=abcdef&X-Goog-Signature=secret-goog&se=2026-05-27&sp=r&sv=2024-01-01&response-content-type=application%2Fzip npm=npm_abcdefghijklmnopqrstuvwxyz123456`
	got := RedactString(input)
	for _, leaked := range []string{"AKIAIOSFODNN7EXAMPLE", "abcdef", "secret-goog", "npm_abcdefghijklmnopqrstuvwxyz123456"} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	for _, fragment := range []string{"X-Amz-Credential=", "X-Amz-Signature=", "X-Goog-Signature=", "se=", "sp=", "sv=", Redacted} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("RedactString() = %q, missing %s", got, fragment)
		}
	}
	findings := ClassifyString(input)
	assertSignal(t, findings, "url_query_secret")
	assertSignal(t, findings, "npm_token")
}

func TestRedactMapCoversExportAndCrawlerMetadataURLs(t *testing.T) {
	redacted := RedactMap(map[string]any{
		"export": map[string]any{
			"download_url": "https://storage.local/tenants/tenant_1/exports/pkg.zip?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=abcdef",
		},
		"crawler": map[string]any{
			"source_url": "https://user:pass@example.com/source?token=secret-token",
		},
	})

	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{"AKIAIOSFODNN7EXAMPLE", "abcdef", "user:pass", "secret-token"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), Redacted) {
		t.Fatalf("redacted metadata = %s, want redaction marker", string(body))
	}
}

func TestRedactValueCoversHeadersAndStringSlices(t *testing.T) {
	header := http.Header{
		"Authorization": []string{"Bearer abcdefghijklmnop"},
		"X-Trace":       []string{"https://storage.local/file.zip?X-Amz-Signature=abcdef"},
	}
	redacted, ok := RedactValue(header).(map[string][]string)
	if !ok {
		t.Fatalf("RedactValue(header) type = %T, want map[string][]string", RedactValue(header))
	}
	if redacted["Authorization"][0] != Redacted {
		t.Fatalf("Authorization = %#v, want redacted", redacted["Authorization"])
	}
	if strings.Contains(redacted["X-Trace"][0], "abcdef") {
		t.Fatalf("X-Trace = %#v, leaked signed URL signature", redacted["X-Trace"])
	}

	value := map[string]any{
		"headers": header,
		"events":  []string{"ok", "token=npm_abcdefghijklmnopqrstuvwxyz123456"},
	}
	body, err := json.Marshal(RedactValue(value))
	if err != nil {
		t.Fatalf("marshal redacted value: %v", err)
	}
	for _, leaked := range []string{"abcdefghijklmnop", "abcdef", "npm_abcdefghijklmnopqrstuvwxyz123456"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted body = %s, leaked %s", string(body), leaked)
		}
	}
}

func TestRedactValueCoversLaunchMetadataContainers(t *testing.T) {
	values := url.Values{
		"X-Amz-Signature": []string{"abcdef"},
		"public":          []string{"ok"},
	}
	redactedValues, ok := RedactValue(values).(map[string][]string)
	if !ok {
		t.Fatalf("RedactValue(url.Values) type = %T, want map[string][]string", RedactValue(values))
	}
	if redactedValues["X-Amz-Signature"][0] != Redacted || redactedValues["public"][0] != "ok" {
		t.Fatalf("redacted url values = %#v", redactedValues)
	}

	metadata := map[string]any{
		"export_events": []map[string]any{
			{
				"download_url": "https://storage.local/export.zip?X-Amz-Signature=abcdef",
				"status":       "ready",
			},
		},
		"support_context": []map[string]string{
			{
				"api_key": "secret",
				"summary": "user reported export failure",
			},
		},
		"audit_headers": []map[string][]string{
			{
				"Authorization": []string{"Bearer abcdefghijklmnop"},
			},
		},
		"crawler_findings": map[string][]any{
			"source_urls": []any{
				"https://user:pass@example.test/path?token=secret-token",
			},
		},
	}
	body, err := json.Marshal(RedactValue(metadata))
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{
		"abcdef",
		`"api_key":"secret"`,
		"abcdefghijklmnop",
		"user:pass",
		"secret-token",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{"ready", "user reported export failure", Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted metadata = %s, missing %s", string(body), fragment)
		}
	}
}

func TestRedactValueCoversErrors(t *testing.T) {
	got := RedactValue(errors.New("provider failed with sk-ant-abcdefghijklmnopqrstuvwxyz123456"))
	asString, ok := got.(string)
	if !ok {
		t.Fatalf("RedactValue(error) type = %T, want string", got)
	}
	if strings.Contains(asString, "sk-ant-abcdefghijklmnopqrstuvwxyz123456") || !strings.Contains(asString, Redacted) {
		t.Fatalf("RedactValue(error) = %q, want redacted error string", asString)
	}
}

func TestRedactValueCoversRawMessagesBytesURLsAndStringers(t *testing.T) {
	raw := json.RawMessage(`{"signed_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","provider_key":"sk-ant-abcdefghijklmnopqrstuvwxyz123456"}`)
	redactedRaw, ok := RedactValue(raw).(json.RawMessage)
	if !ok {
		t.Fatalf("RedactValue(raw) type = %T, want json.RawMessage", RedactValue(raw))
	}
	if strings.Contains(string(redactedRaw), "abcdef") || strings.Contains(string(redactedRaw), "sk-ant-abcdefghijklmnopqrstuvwxyz123456") {
		t.Fatalf("redacted raw = %s, leaked secret", string(redactedRaw))
	}

	redactedBytes, ok := RedactValue([]byte(`{"Authorization":"Bearer abcdefghijklmnop"}`)).([]byte)
	if !ok {
		t.Fatalf("RedactValue(bytes) type = %T, want []byte", RedactValue([]byte{}))
	}
	if strings.Contains(string(redactedBytes), "abcdefghijklmnop") {
		t.Fatalf("redacted bytes = %s, leaked bearer token", string(redactedBytes))
	}

	parsed, err := url.Parse("https://user:pass@example.test/export.zip?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=abcdef")
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}
	redactedURL := RedactValue(parsed)
	asString, ok := redactedURL.(string)
	if !ok {
		t.Fatalf("RedactValue(url) type = %T, want string", redactedURL)
	}
	for _, leaked := range []string{"user:pass", "AKIAIOSFODNN7EXAMPLE", "abcdef"} {
		if strings.Contains(asString, leaked) {
			t.Fatalf("redacted URL = %q, leaked %s", asString, leaked)
		}
	}

	stringer := stringerValue("provider token=npm_abcdefghijklmnopqrstuvwxyz123456")
	redactedStringer, ok := RedactValue(stringer).(string)
	if !ok {
		t.Fatalf("RedactValue(stringer) type = %T, want string", RedactValue(stringer))
	}
	if strings.Contains(redactedStringer, "npm_abcdefghijklmnopqrstuvwxyz123456") {
		t.Fatalf("redacted stringer = %q, leaked token", redactedStringer)
	}
}

func TestClassifyValueCoversRawMessagesBytesURLsErrorsAndStringers(t *testing.T) {
	parsed, err := url.Parse("https://user:pass@example.test/export.zip?X-Amz-Signature=abcdef")
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}
	findings := ClassifyValue(map[string]any{
		"raw":      json.RawMessage(`{"webhook_secret":"whsec_abcdefghijklmnopqrstuvwxyz123456"}`),
		"bytes":    []byte(`{"provider_key":"sk-ant-abcdefghijklmnopqrstuvwxyz123456"}`),
		"url":      parsed,
		"error":    errors.New("failed with Bearer abcdefghijklmnop"),
		"stringer": stringerValue("token=npm_abcdefghijklmnopqrstuvwxyz123456"),
	})

	assertFinding(t, findings, SecretKindWebhookSecret, "raw.webhook_secret")
	assertFinding(t, findings, SecretKindProviderKey, "bytes.provider_key")
	assertFinding(t, findings, SecretKindDSN, "url")
	assertFinding(t, findings, SecretKindSignedURL, "url")
	assertFinding(t, findings, SecretKindAuthorization, "error")
	assertFinding(t, findings, SecretKindToken, "stringer")
}

func TestRedactStringCoversRawJSONPayloads(t *testing.T) {
	input := `{"event":"export_failed","headers":{"Authorization":["Bearer abcdefghijklmnop"]},"provider":{"openai_api_key":"sk-proj-abcdefghijklmnopqrstuvwxyz123456"},"signed_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","items":[{"webhook_secret":"whsec_abcdefghijklmnopqrstuvwxyz123456"}]}`
	got := RedactString(input)

	for _, leaked := range []string{
		"abcdefghijklmnop",
		"sk-proj-abcdefghijklmnopqrstuvwxyz123456",
		"abcdef",
		"whsec_abcdefghijklmnopqrstuvwxyz123456",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	for _, fragment := range []string{`"event":"export_failed"`, Redacted} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("RedactString() = %q, missing %s", got, fragment)
		}
	}

	findings := ClassifyString(input)
	assertFinding(t, findings, SecretKindAuthorization, "headers.Authorization")
	assertFinding(t, findings, SecretKindAPIKey, "provider.openai_api_key")
	assertFinding(t, findings, SecretKindSignedURL, "signed_url")
	assertFinding(t, findings, SecretKindWebhookSecret, "items[0].webhook_secret")
}

func TestRedactStringCoversLaunchProviderAndCommerceTokens(t *testing.T) {
	twilioKey := "SK" + strings.Repeat("0", 32)
	input := strings.Join([]string{
		"sendgrid=SG.abcdefghijklmnopqrstuvwxyz123456.abcdefghijklmnopqrstuvwxyz123456",
		"mailgun=key-abcdefghijklmnopqrstuvwxyz123456",
		"stripe_webhook=whsec_abcdefghijklmnopqrstuvwxyz123456",
		"shopify=shpat_abcdefghijklmnopqrstuvwxyz123456",
		"twilio=" + twilioKey,
		"square=EAAAabcdefghijklmnopqrstuvwxyz123456",
		"aws_secret_access_key=abcdefghijklmnopqrstuvwxyz1234567890/+=",
	}, " ")
	got := RedactString(input)

	for _, leaked := range []string{
		"SG.abcdefghijklmnopqrstuvwxyz123456.abcdefghijklmnopqrstuvwxyz123456",
		"key-abcdefghijklmnopqrstuvwxyz123456",
		"whsec_abcdefghijklmnopqrstuvwxyz123456",
		"shpat_abcdefghijklmnopqrstuvwxyz123456",
		twilioKey,
		"EAAAabcdefghijklmnopqrstuvwxyz123456",
		"abcdefghijklmnopqrstuvwxyz1234567890/+=",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"sendgrid_key",
		"mailgun_key",
		"stripe_webhook_secret",
		"shopify_access_token",
		"twilio_key",
		"square_token",
		"aws_secret_access_key_assignment",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactStringCoversLaunchDeployCloudAndSignedDeliverySecrets(t *testing.T) {
	doToken := "dop_v1_" + strings.Repeat("a", 64)
	input := strings.Join([]string{
		"digitalocean=" + doToken,
		"netlify=nfp_abcdefghijklmnopqrstuvwxyz123456",
		"railway=railway_abcdefghijklmnopqrstuvwxyz123456",
		"google_oauth=ya29.abcdefghijklmnopqrstuvwxyz123456",
		"firebase=AAAAabc1234:APA91babcdefghijklmnopqrstuvwxyz123456",
		"fly=FlyV1 fm2_lJPECAAAAAAACfEjR0Q1JKSkZFSFlYWTM0NTY3ODkw",
		"postgresql://db_user:db_pass@db.example.com:5432/zenart",
		"https://cdn.example.com/export.zip?Expires=1770000000&Policy=abcdef&Key-Pair-Id=K1234567890",
		"https://storage.googleapis.com/zenart/export.zip?GoogleAccessId=service@example.iam.gserviceaccount.com&X-Goog-Signature=abcdef",
		"service_account_json={\"private_key\":\"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\"}",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		doToken,
		"nfp_abcdefghijklmnopqrstuvwxyz123456",
		"railway_abcdefghijklmnopqrstuvwxyz123456",
		"ya29.abcdefghijklmnopqrstuvwxyz123456",
		"AAAAabc1234:APA91babcdefghijklmnopqrstuvwxyz123456",
		"FlyV1 fm2_lJPECAAAAAAACfEjR0Q1JKSkZFSFlYWTM0NTY3ODkw",
		"db_user:db_pass",
		"1770000000",
		"service@example.iam.gserviceaccount.com",
		"-----BEGIN PRIVATE KEY-----",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"digitalocean_token",
		"netlify_token",
		"railway_token",
		"google_oauth_token",
		"firebase_server_key",
		"fly_token",
		"url_credentials",
		"url_query_secret",
		"assignment:key_name",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactStringCoversLaunchRegistryAndSecretManagerTokens(t *testing.T) {
	renderToken := "rnd_abcdefghijklmnopqrstuvwxyz123456"
	dopplerToken := "dp.pt.abcdefghijklmnopqrstuvwxyz123456"
	vaultToken := "hvs.abcdefghijklmnopqrstuvwxyz123456"
	input := strings.Join([]string{
		"docker_auth=dXNlcjpwYXNzd29yZC1zdXBlci1zZWNyZXQ=",
		`{"auths":{"registry.example.com":{"auth":"dXNlcjpwYXNzd29yZC1zdXBlci1zZWNyZXQ="}}}`,
		"github_app_private_key=LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tYWJjZGVmZ2hpams=",
		"render=" + renderToken,
		"doppler=" + dopplerToken,
		"vault=" + vaultToken,
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"dXNlcjpwYXNzd29yZC1zdXBlci1zZWNyZXQ=",
		"LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tYWJjZGVmZ2hpams=",
		renderToken,
		dopplerToken,
		vaultToken,
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"docker_auth_token",
		"dockerconfigjson_auth",
		"github_app_private_key",
		"render_api_key",
		"doppler_token",
		"vault_token",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestClassifyKeyCoversLaunchSecretNames(t *testing.T) {
	cases := []struct {
		key  string
		kind SecretKind
	}{
		{key: "x_api_key", kind: SecretKindAPIKey},
		{key: "private_token", kind: SecretKindPrivateKey},
		{key: "deploy_key", kind: SecretKindPrivateKey},
		{key: "proxy_authorization", kind: SecretKindAuthorization},
		{key: "service_account_json", kind: SecretKindServiceAcct},
		{key: "CONNECTION_STRING", kind: SecretKindCredential},
		{key: "personal_access_token", kind: SecretKindToken},
		{key: "dockerconfigjson", kind: SecretKindRegistryAuth},
		{key: "registry_password", kind: SecretKindRegistryAuth},
	}

	for _, tt := range cases {
		findings := ClassifyKey(tt.key)
		if len(findings) == 0 {
			t.Fatalf("ClassifyKey(%q) returned no findings", tt.key)
		}
		if findings[0].Kind != tt.kind {
			t.Fatalf("ClassifyKey(%q) kind = %s, want %s", tt.key, findings[0].Kind, tt.kind)
		}
	}
}

func TestRedactingSlogHandlerRedactsMessagesAttrsGroupsAndContextAttrs(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(NewRedactingSlogHandler(slog.NewJSONHandler(&logs, nil))).With(
		"startup_api_key", "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
	)
	logger.Error(
		"provider failed with hf_abcdefghijklmnopqrstuvwxyz123456",
		"error", errors.New("Authorization: Bearer abcdefghijklmnop"),
		"headers", http.Header{"X-Download": []string{"https://storage.local/file.zip?X-Amz-Signature=abcdef"}},
		slog.Group("provider", "api_key", "secret", "public", "ok"),
	)

	line := logs.String()
	for _, leaked := range []string{
		"sk-proj-abcdefghijklmnopqrstuvwxyz123456",
		"hf_abcdefghijklmnopqrstuvwxyz123456",
		"abcdefghijklmnop",
		"abcdef",
		`"api_key":"secret"`,
	} {
		if strings.Contains(line, leaked) {
			t.Fatalf("redacted slog line = %s, leaked %s", line, leaked)
		}
	}
	for _, fragment := range []string{Redacted, `"provider":{"api_key":"[REDACTED]","public":"ok"}`} {
		if !strings.Contains(line, fragment) {
			t.Fatalf("redacted slog line = %s, missing %s", line, fragment)
		}
	}
}

func TestRedactingSlogHandlerRedactsLogValuerAttrs(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(NewRedactingSlogHandler(slog.NewJSONHandler(&logs, nil)))
	logger.Warn(
		"audit event",
		"event", secretLogValuer{},
		"attrs", []slog.Attr{
			slog.String("signed_url", "https://storage.local/export.zip?X-Amz-Signature=abcdef"),
		},
	)

	line := logs.String()
	for _, leaked := range []string{
		"sk-ant-abcdefghijklmnopqrstuvwxyz123456",
		"abcdefghijklmnop",
		"abcdef",
	} {
		if strings.Contains(line, leaked) {
			t.Fatalf("redacted slog line = %s, leaked %s", line, leaked)
		}
	}
	for _, fragment := range []string{Redacted, `"public":"ok"`} {
		if !strings.Contains(line, fragment) {
			t.Fatalf("redacted slog line = %s, missing %s", line, fragment)
		}
	}
}

func TestClassifyValueCoversLaunchMetadataContainers(t *testing.T) {
	findings := ClassifyValue(map[string]any{
		"query": url.Values{
			"X-Goog-Signature": []string{"abcdef"},
		},
		"export_events": []map[string]any{
			{"download_url": "https://storage.local/export.zip?X-Amz-Signature=abcdef"},
		},
		"support_context": []map[string]string{
			{"api_key": "secret"},
		},
		"audit_headers": []map[string][]string{
			{"Authorization": []string{"Bearer abcdefghijklmnop"}},
		},
		"crawler_findings": map[string][]any{
			"source_urls": []any{"https://user:pass@example.test/source"},
		},
		"log_value": secretLogValuer{},
	})

	assertFinding(t, findings, SecretKindSignedURL, "query.X-Goog-Signature")
	assertFinding(t, findings, SecretKindSignedURL, "query.X-Goog-Signature[0]")
	assertFinding(t, findings, SecretKindSignedURL, "export_events[0].download_url")
	assertFinding(t, findings, SecretKindAPIKey, "support_context[0].api_key")
	assertFinding(t, findings, SecretKindAuthorization, "audit_headers[0].Authorization")
	assertFinding(t, findings, SecretKindDSN, "crawler_findings.source_urls[0]")
	assertFinding(t, findings, SecretKindProviderKey, "log_value.provider.provider_key")
	assertFinding(t, findings, SecretKindAuthorization, "log_value.provider.error")
}

func TestClassifyValueCoversHeadersAndStringSlices(t *testing.T) {
	findings := ClassifyValue(map[string]any{
		"headers": http.Header{
			"Authorization": []string{"Bearer abcdefghijklmnop"},
		},
		"events": []string{"token=npm_abcdefghijklmnopqrstuvwxyz123456"},
	})

	assertFinding(t, findings, SecretKindAuthorization, "headers.Authorization")
	assertFinding(t, findings, SecretKindAuthorization, "headers.Authorization[0]")
	assertFinding(t, findings, SecretKindToken, "events[0]")
}

func TestPlaceholderMalwareScannerReportsUnavailableAndForcedSuspicious(t *testing.T) {
	now := time.Date(2026, 5, 26, 1, 2, 3, 0, time.UTC)
	scanner := PlaceholderMalwareScanner{Now: func() time.Time { return now }}

	result, err := scanner.Scan(context.Background(), MalwareScanTarget{
		TenantID:    "tenant_1",
		ObjectKey:   "tenants/tenant_1/uploads/file.png",
		ContentType: "image/png",
		ByteSize:    123,
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if result.Status != MalwareScanStatusUnavailable || result.Provider != "stage0-placeholder" || !result.ScannedAt.Equal(now) {
		t.Fatalf("Scan() = %#v, want unavailable placeholder result", result)
	}

	result, err = scanner.Scan(context.Background(), MalwareScanTarget{
		TenantID:  "tenant_1",
		ObjectKey: "tenants/tenant_1/uploads/file.png",
		Metadata:  map[string]string{"stage0_force_malware_status": "suspicious"},
	})
	if err != nil {
		t.Fatalf("forced Scan() error = %v", err)
	}
	if result.Status != MalwareScanStatusSuspicious {
		t.Fatalf("forced Scan() status = %s, want suspicious", result.Status)
	}
}

func TestHTTPMalwareScannerPostsTargetAndRedactsMetadata(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	var received MalwareScanTarget
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer scan-secret" {
			t.Fatalf("Authorization = %q, want bearer API key", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(MalwareScanResult{
			Status:    " CLEAN ",
			Provider:  "scanner sk-ant-abcdefghijklmnopqrstuvwxyz123456",
			Rationale: "checked with Bearer abcdefghijklmnop",
			Metadata: map[string]string{
				"engine_version": "1",
				"api_key":        "secret",
			},
		})
	}))
	defer server.Close()

	result, err := (HTTPMalwareScanner{
		Endpoint: server.URL,
		APIKey:   "scan-secret",
		Timeout:  time.Second,
		Now:      func() time.Time { return now },
	}).Scan(context.Background(), MalwareScanTarget{
		TenantID:    "tenant_1",
		ObjectKey:   "uploads/file.png",
		ContentType: "image/png",
		ByteSize:    12,
		Metadata:    map[string]string{"slot": "reference", "api_key": "secret"},
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if received.TenantID != "tenant_1" || received.ObjectKey != "uploads/file.png" {
		t.Fatalf("received target = %#v", received)
	}
	if received.Metadata["api_key"] != Redacted {
		t.Fatalf("received metadata = %#v, want redacted before external scan", received.Metadata)
	}
	if result.Status != MalwareScanStatusClean || result.Signature != "http-v1" || !result.ScannedAt.Equal(now) {
		t.Fatalf("result = %#v, want clean defaulted result", result)
	}
	if strings.Contains(result.Provider, "sk-ant") || strings.Contains(result.Rationale, "abcdefghijklmnop") {
		t.Fatalf("result = %#v, want redacted provider/rationale", result)
	}
	if result.Metadata["api_key"] != Redacted || result.Metadata["engine_version"] != "1" {
		t.Fatalf("metadata = %#v, want redacted api_key and public engine version", result.Metadata)
	}
}

func TestHTTPMalwareScannerRejectsUnsupportedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(MalwareScanResult{Status: "infected"})
	}))
	defer server.Close()

	_, err := (HTTPMalwareScanner{
		Endpoint: server.URL,
		Timeout:  time.Second,
	}).Scan(context.Background(), MalwareScanTarget{
		TenantID:  "tenant_1",
		ObjectKey: "uploads/file.png",
	})
	if err == nil {
		t.Fatal("Scan() error = nil, want unsupported status error")
	}
}

func TestHTTPMalwareScannerRedactsNon2xxResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`scanner failed with Authorization: Bearer abcdefghijklmnop and sk-ant-abcdefghijklmnopqrstuvwxyz123456`))
	}))
	defer server.Close()

	_, err := (HTTPMalwareScanner{
		Endpoint: server.URL,
		Timeout:  time.Second,
	}).Scan(context.Background(), MalwareScanTarget{
		TenantID:  "tenant_1",
		ObjectKey: "uploads/file.png",
	})
	if err == nil {
		t.Fatal("Scan() error = nil, want HTTP status error")
	}
	for _, leaked := range []string{"abcdefghijklmnop", "sk-ant-abcdefghijklmnopqrstuvwxyz123456"} {
		if strings.Contains(err.Error(), leaked) {
			t.Fatalf("Scan() error = %q, leaked %s", err.Error(), leaked)
		}
	}
	if !strings.Contains(err.Error(), Redacted) {
		t.Fatalf("Scan() error = %q, want redaction marker", err.Error())
	}
}

func assertFinding(t *testing.T, findings []SecretFinding, kind SecretKind, location string) {
	t.Helper()
	for _, finding := range findings {
		if finding.Kind == kind && finding.Location == location {
			return
		}
	}
	t.Fatalf("missing finding kind=%s location=%s in %#v", kind, location, findings)
}

func assertSignal(t *testing.T, findings []SecretFinding, signal string) {
	t.Helper()
	for _, finding := range findings {
		if finding.Signal == signal {
			return
		}
	}
	t.Fatalf("missing finding signal=%s in %#v", signal, findings)
}

type stringerValue string

func (s stringerValue) String() string {
	return string(s)
}

type secretLogValuer struct{}

func (secretLogValuer) LogValue() slog.Value {
	return slog.GroupValue(
		slog.Group("provider",
			"provider_key", "sk-ant-abcdefghijklmnopqrstuvwxyz123456",
			"error", "Authorization: Bearer abcdefghijklmnop",
			"public", "ok",
		),
	)
}
