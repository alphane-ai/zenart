package security

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
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
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactStringCoversEmbeddedSignedURLsAndRegistryTokens(t *testing.T) {
	input := `download https://s3.local/zenart/export.zip?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE&X-Amz-Signature=abcdef&response-content-type=application%2Fzip npm=npm_abcdefghijklmnopqrstuvwxyz123456`
	got := RedactString(input)
	for _, leaked := range []string{"AKIAIOSFODNN7EXAMPLE", "abcdef", "npm_abcdefghijklmnopqrstuvwxyz123456"} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	for _, fragment := range []string{"X-Amz-Credential=", "X-Amz-Signature=", Redacted} {
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
			Status:   MalwareScanStatusClean,
			Provider: "scanner",
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
		Metadata:    map[string]string{"slot": "reference"},
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if received.TenantID != "tenant_1" || received.ObjectKey != "uploads/file.png" {
		t.Fatalf("received target = %#v", received)
	}
	if result.Status != MalwareScanStatusClean || result.Signature != "http-v1" || !result.ScannedAt.Equal(now) {
		t.Fatalf("result = %#v, want clean defaulted result", result)
	}
	if result.Metadata["api_key"] != Redacted || result.Metadata["engine_version"] != "1" {
		t.Fatalf("metadata = %#v, want redacted api_key and public engine version", result.Metadata)
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
