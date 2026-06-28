package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/audit"
	"github.com/alphane-ai/zenart/backend/internal/auth"
	"github.com/alphane-ai/zenart/backend/internal/billing"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/provider"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
	"github.com/alphane-ai/zenart/backend/internal/team"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const serverStripeSecretFixture = "sk_test_" + "abcdefghijklmnopqrstuvwxyz123456"
const serverProviderSecretFixture = "sk-proj-" + "abcdefghijklmnopqrstuvwxyz123456"

func TestHealthz(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("X-Request-ID", "test-request")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("status body = %v, want ok", body["status"])
	}
	if body["request_id"] != "test-request" {
		t.Fatalf("request_id = %v, want test-request", body["request_id"])
	}
}

func TestAccessLogIncludesRequestContext(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("X-Request-ID", "log-request")
	rec := httptest.NewRecorder()

	New(cfg, logger).Handler().ServeHTTP(rec, req)

	line := logs.String()
	for _, fragment := range []string{
		`"msg":"http request"`,
		`"request_id":"log-request"`,
		`"method":"GET"`,
		`"route":"/healthz"`,
		`"status":200`,
		`"latency_ms"`,
		`"tenant_id"`,
		`"user_id"`,
	} {
		if !strings.Contains(line, fragment) {
			t.Fatalf("access log = %s, missing %s", line, fragment)
		}
	}
}

func TestAccessLogIncludesCookiePrincipal(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	login := httptest.NewRequest(http.MethodPost, "/api/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"tenant_cookie"}`))
	setSameSiteCSRFHeaders(login)
	loginRec := httptest.NewRecorder()
	New(cfg, nil).Handler().ServeHTTP(loginRec, login)
	cookie := findCookie(loginRec.Result().Cookies(), cfg.Auth.SessionCookieName)
	if cookie == nil {
		t.Fatal("session cookie was not set")
	}

	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()

	New(cfg, logger).Handler().ServeHTTP(rec, req)

	line := logs.String()
	for _, fragment := range []string{
		`"msg":"http request"`,
		`"tenant_id":"tenant_cookie"`,
		`"user_id":"local_local.user_example.com"`,
	} {
		if !strings.Contains(line, fragment) {
			t.Fatalf("access log = %s, missing %s", line, fragment)
		}
	}
}

func TestAccessLogRedactsSecretBearingFields(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	req := httptest.NewRequest(http.MethodGet, "/healthz?token=npm_abcdefghijklmnopqrstuvwxyz123456", nil)
	req.Header.Set("User-Agent", "client Authorization: Bearer abcdefghijklmnop")
	rec := httptest.NewRecorder()

	New(cfg, logger).Handler().ServeHTTP(rec, req)

	line := logs.String()
	for _, leaked := range []string{"npm_abcdefghijklmnopqrstuvwxyz123456", "abcdefghijklmnop"} {
		if strings.Contains(line, leaked) {
			t.Fatalf("access log = %s, leaked %s", line, leaked)
		}
	}
	if !strings.Contains(line, security.Redacted) {
		t.Fatalf("access log = %s, want redaction marker", line)
	}
}

func TestRecoverLogRedactsPanicPayload(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	providerKey := "sk-proj-" + "abcdefghijklmnopqrstuvwxyz123456"
	handler := withRequestID(withRecover(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("provider key " + providerKey)
	})))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	line := logs.String()
	if strings.Contains(line, providerKey) {
		t.Fatalf("panic log = %s, leaked provider key", line)
	}
	if !strings.Contains(line, security.Redacted) {
		t.Fatalf("panic log = %s, want redaction marker", line)
	}
}

func TestMetricsHandlerExposesHTTPCounters(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	srv := New(cfg, nil)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)

	metricsReq := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	metricsRec := httptest.NewRecorder()
	srv.MetricsHandler().ServeHTTP(metricsRec, metricsReq)

	body := metricsRec.Body.String()
	for _, fragment := range []string{
		"backend_http_requests_total 1",
		`backend_http_requests_by_status_total{status="200"} 1`,
		`backend_http_requests_by_route_total{route="GET /healthz"} 1`,
		"backend_process_uptime_seconds",
	} {
		if !strings.Contains(body, fragment) {
			t.Fatalf("metrics body = %s, missing %s", body, fragment)
		}
	}
}

func TestTaskStatusStubUsesErrorEnvelope(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotImplemented)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "task_status_not_connected" {
		t.Fatalf("code = %v, want task_status_not_connected", body["code"])
	}
	if _, ok := body["field_errors"].([]any); !ok {
		t.Fatalf("field_errors missing or wrong type: %T", body["field_errors"])
	}
	taxonomy, ok := body["taxonomy"].(map[string]any)
	if !ok {
		t.Fatalf("taxonomy missing or wrong type: %T", body["taxonomy"])
	}
	if taxonomy["category"] != "internal" || taxonomy["retryable"] != false || taxonomy["blocked"] != false {
		t.Fatalf("taxonomy = %#v, want stable internal non-retryable classification", taxonomy)
	}
	details, ok := body["details"].(map[string]any)
	if !ok {
		t.Fatalf("details missing or wrong type: %T", body["details"])
	}
	if _, ok := details["taxonomy"].(map[string]any); !ok {
		t.Fatalf("details.taxonomy missing or wrong type: %T", details["taxonomy"])
	}
}

func TestTaskStatusRequiresAuth(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestWriteErrorAddsStage1Taxonomy(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/project_1/batch-generations", nil)
	req = req.WithContext(context.WithValue(req.Context(), requestIDKey{}, "req_taxonomy_1"))

	cases := []struct {
		name     string
		status   int
		code     string
		category string
		retry    bool
		blocked  bool
	}{
		{name: "quota", status: http.StatusPaymentRequired, code: "batch_quota_insufficient", category: "quota_insufficient", retry: false, blocked: true},
		{name: "provider", status: http.StatusBadGateway, code: "provider_unavailable", category: "provider_unavailable", retry: true, blocked: false},
		{name: "review", status: http.StatusConflict, code: "safety_review_required", category: "review_required", retry: false, blocked: true},
		{name: "retryable", status: http.StatusTooManyRequests, code: "rate_limit_exceeded", category: "retryable", retry: true, blocked: false},
		{name: "blocked", status: http.StatusConflict, code: "safety_blocked", category: "blocked", retry: false, blocked: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			writeError(rec, req, tc.status, tc.code, "classified error", nil)
			var body map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("response JSON error = %v", err)
			}
			taxonomy, ok := body["taxonomy"].(map[string]any)
			if !ok {
				t.Fatalf("taxonomy missing or wrong type: %T", body["taxonomy"])
			}
			if taxonomy["category"] != tc.category || taxonomy["retryable"] != tc.retry || taxonomy["blocked"] != tc.blocked {
				t.Fatalf("taxonomy = %#v, want category=%s retry=%v blocked=%v", taxonomy, tc.category, tc.retry, tc.blocked)
			}
			if body["retryable"] != tc.retry || body["blocked"] != tc.blocked {
				t.Fatalf("top-level retryable/blocked = %v/%v", body["retryable"], body["blocked"])
			}
		})
	}
}

func TestSecurityHeadersAndCORS(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "http://localhost:26080")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", rec.Header().Get("X-Content-Type-Options"))
	}
	if rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("X-Frame-Options = %q, want DENY", rec.Header().Get("X-Frame-Options"))
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:26080" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want localhost web origin", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestUploadCreateRejectsUnsupportedContentType(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	body := bytes.NewBufferString(`{"filename":"bad.exe","content_type":"application/octet-stream","byte_size":100}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads", body)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), nil)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want validation error: %s", rec.Code, rec.Body.String())
	}
	var bodyJSON map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &bodyJSON); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if bodyJSON["code"] != "validation_error" {
		t.Fatalf("code = %v, want validation_error", bodyJSON["code"])
	}
}

func TestUploadCreateIgnoresUserSuppliedPlaceholderMalwareOverride(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	db := &fakeStage0DB{}
	body := bytes.NewBufferString(`{"filename":"logo.png","content_type":"image/png","byte_size":100,"metadata":{"stage0_force_malware_status":"suspicious"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads", body)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil, security.PlaceholderMalwareScanner{Provider: "stage0-test"})))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want created because user metadata cannot force scanner result: %s", rec.Code, rec.Body.String())
	}
	var bodyJSON map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &bodyJSON); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if bodyJSON["status"] != "pending" {
		t.Fatalf("status body = %v, want pending upload", bodyJSON["status"])
	}
	objectMetadataJSON, ok := db.execs[1].args[12].([]byte)
	if !ok {
		t.Fatalf("object metadata arg type = %T, want []byte", db.execs[1].args[12])
	}
	if strings.Contains(string(objectMetadataJSON), "stage0_force_malware_status") || !strings.Contains(string(objectMetadataJSON), `"status":"unavailable"`) {
		t.Fatalf("object metadata JSON = %s, want unavailable scan without user override key", string(objectMetadataJSON))
	}
}

func TestUploadCreateUsesConfiguredMalwareScanner(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Security.MalwareScanFailClosed = false
	db := &fakeStage0DB{}
	scanner := &serverCaptureScanner{
		result: security.MalwareScanResult{
			Status:    security.MalwareScanStatusClean,
			Provider:  "configured-http-scanner",
			Signature: "scanner-v1",
			ScannedAt: time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC),
		},
	}
	body := bytes.NewBufferString(`{"filename":"logo.png","content_type":"image/png","byte_size":100,"metadata":{"api_key":"secret","slot":"reference"}}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads", body)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil, WithMalwareScanner(scanner)).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want created: %s", rec.Code, rec.Body.String())
	}
	if scanner.calls != 1 {
		t.Fatalf("scanner calls = %d, want 1", scanner.calls)
	}
	if scanner.target.TenantID != "tenant_1" || scanner.target.ObjectKey == "" || scanner.target.ContentType != "image/png" || scanner.target.ByteSize != 100 {
		t.Fatalf("scanner target = %#v, want tenant/object/content metadata", scanner.target)
	}
	if scanner.target.Metadata["slot"] != "reference" {
		t.Fatalf("scanner metadata = %#v, want allowlisted slot context", scanner.target.Metadata)
	}
	if _, ok := scanner.target.Metadata["api_key"]; ok {
		t.Fatalf("scanner metadata = %#v, want secret-bearing api_key removed", scanner.target.Metadata)
	}
	if len(db.execs) != 3 {
		t.Fatalf("exec count = %d, want upload/object metadata/analytics rows", len(db.execs))
	}
	objectMetadataJSON, ok := db.execs[1].args[12].([]byte)
	if !ok {
		t.Fatalf("object metadata arg type = %T, want []byte", db.execs[1].args[12])
	}
	if !strings.Contains(string(objectMetadataJSON), "configured-http-scanner") || strings.Contains(string(objectMetadataJSON), "secret") {
		t.Fatalf("object metadata JSON = %s, want configured scanner result without secret leak", string(objectMetadataJSON))
	}
}

func TestUploadCreateConfiguredMalwareScannerFailClosedBlocks(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Security.MalwareScanFailClosed = true
	db := &fakeStage0DB{}
	scanner := &serverCaptureScanner{
		result: security.MalwareScanResult{
			Status:    security.MalwareScanStatusUnavailable,
			Provider:  "configured-http-scanner",
			Signature: "scanner-v1",
		},
	}
	body := bytes.NewBufferString(`{"filename":"logo.png","content_type":"image/png","byte_size":100}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads", body)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil, WithMalwareScanner(scanner)).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want malware conflict: %s", rec.Code, rec.Body.String())
	}
	if scanner.calls != 1 {
		t.Fatalf("scanner calls = %d, want 1", scanner.calls)
	}
	if len(db.execs) != 0 {
		t.Fatalf("fail-closed upload should not persist rows: %#v", db.execs)
	}
	var bodyJSON map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &bodyJSON); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if bodyJSON["code"] != "malware_blocked" {
		t.Fatalf("code = %v, want malware_blocked", bodyJSON["code"])
	}
}

func TestSignedUploadEndpointStoresTenantScopedObject(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-upload-test"
	cfg.ObjectStorage.SigningKey = "signed-upload-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	srv := New(cfg, nil)
	uploadURL, _ := srv.signUploadURL("tenant_1", "uploads/upload_1/logo.png", time.Minute)

	req := httptest.NewRequest(http.MethodPut, uploadURL, strings.NewReader("png-bytes"))
	db := &fakeStage0DB{execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 1")}}
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), objects)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("Content-Type", "image/png")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	reader, err := objects.Get(context.Background(), "tenant_1", "uploads/upload_1/logo.png")
	if err != nil {
		t.Fatalf("stored object Get() error = %v", err)
	}
	defer reader.Body.Close()
	if reader.Object.Key != "tenants/tenant_1/uploads/upload_1/logo.png" {
		t.Fatalf("stored key = %q, want tenant-scoped key", reader.Object.Key)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["object_key"] != "tenants/tenant_1/uploads/upload_1/logo.png" {
		t.Fatalf("object_key = %v, want tenant-scoped key", body["object_key"])
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "UPDATE object_metadata") {
		t.Fatalf("scan evidence update = %#v, want object metadata update", db.execs)
	}
}

func TestSignedUploadEndpointScansStoredObjectAndRedactsResult(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-upload-test"
	cfg.ObjectStorage.SigningKey = "signed-upload-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	hfToken := "hf_" + "abcdefghijklmnopqrstuvwxyz123456"
	anthropicToken := "sk-ant-" + "abcdefghijklmnopqrstuvwxyz123456"
	bearerToken := "abcdefghijkl" + "mnop"
	signedURLToken := "abc" + "def"
	scanner := &serverCaptureScanner{result: security.MalwareScanResult{
		Status:    security.MalwareScanStatusClean,
		Provider:  "scanner " + hfToken,
		Signature: "sig " + anthropicToken,
		Rationale: "clean via Bearer " + bearerToken,
		Metadata: map[string]string{
			"note": "https://storage.local/file.zip?X-Amz-Signature=" + signedURLToken,
		},
	}}
	srv := New(cfg, nil, WithMalwareScanner(scanner))
	uploadURL, _ := srv.signUploadURL("tenant_1", "uploads/upload_1/logo.png", time.Minute)

	req := httptest.NewRequest(http.MethodPut, uploadURL, strings.NewReader("png-bytes"))
	db := &fakeStage0DB{execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 1")}}
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), objects, scanner)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("Content-Type", "image/png")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if scanner.calls != 1 {
		t.Fatalf("scanner calls = %d, want 1", scanner.calls)
	}
	if scanner.target.Checksum == "" || scanner.target.ByteSize != int64(len("png-bytes")) {
		t.Fatalf("scanner target = %#v, want stored checksum and byte size", scanner.target)
	}
	if scanner.target.Metadata["source"] != "signed_upload_put" {
		t.Fatalf("scanner target metadata = %#v, want signed upload source", scanner.target.Metadata)
	}
	body := rec.Body.String()
	for _, leaked := range []string{hfToken, anthropicToken, bearerToken, signedURLToken} {
		if strings.Contains(body, leaked) {
			t.Fatalf("response body leaked scanner secret %q: %s", leaked, body)
		}
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	scan, ok := response["malware_scan"].(map[string]any)
	if !ok || scan["status"] != string(security.MalwareScanStatusClean) {
		t.Fatalf("response body = %s, want clean malware_scan metadata", body)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "UPDATE object_metadata") {
		t.Fatalf("scan evidence update = %#v, want object metadata update", db.execs)
	}
	metadataPatch, ok := db.execs[0].args[6].([]byte)
	if !ok {
		t.Fatalf("metadata patch arg type = %T, want []byte", db.execs[0].args[6])
	}
	for _, leaked := range []string{hfToken, anthropicToken, bearerToken, signedURLToken} {
		if strings.Contains(string(metadataPatch), leaked) {
			t.Fatalf("metadata patch leaked scanner secret %q: %s", leaked, string(metadataPatch))
		}
	}
}

func TestSignedUploadEndpointDeletesSuspiciousStoredObject(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-upload-test"
	cfg.ObjectStorage.SigningKey = "signed-upload-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	scanner := &serverCaptureScanner{result: security.MalwareScanResult{
		Status:    security.MalwareScanStatusSuspicious,
		Provider:  "stage0-test",
		Signature: "scanner-v1",
	}}
	srv := New(cfg, nil, WithMalwareScanner(scanner))
	uploadURL, _ := srv.signUploadURL("tenant_1", "uploads/upload_1/logo.png", time.Minute)

	req := httptest.NewRequest(http.MethodPut, uploadURL, strings.NewReader("png-bytes"))
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), objects, scanner)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("Content-Type", "image/png")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want malware conflict: %s", rec.Code, rec.Body.String())
	}
	if _, err := objects.Get(context.Background(), "tenant_1", "uploads/upload_1/logo.png"); !errors.Is(err, objectstore.ErrNotFound) {
		t.Fatalf("stored object Get() error = %v, want deleted object not found", err)
	}
}

func TestSignedUploadEndpointRejectsCrossTenantSignature(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-upload-test"
	cfg.ObjectStorage.SigningKey = "signed-upload-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	srv := New(cfg, nil)
	uploadURL, _ := srv.signUploadURL("tenant_1", "uploads/upload_1/logo.png", time.Minute)

	req := httptest.NewRequest(http.MethodPut, uploadURL, strings.NewReader("png-bytes"))
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), objects)))
	req.Header.Set("X-Zenari-User-ID", "user_2")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_2")
	req.Header.Set("Content-Type", "image/png")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "signed_url_invalid" {
		t.Fatalf("code = %v, want signed_url_invalid", body["code"])
	}
}

func TestSignedUploadEndpointRejectsDuplicateSignedParams(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-upload-test"
	cfg.ObjectStorage.SigningKey = "signed-upload-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	srv := New(cfg, nil)
	uploadURL, _ := srv.signUploadURL("tenant_1", "uploads/upload_1/logo.png", time.Minute)

	for _, duplicate := range []string{"key", "expires", "sig"} {
		req := httptest.NewRequest(http.MethodPut, uploadURL+"&"+duplicate+"=tampered", strings.NewReader("png-bytes"))
		req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), objects)))
		req.Header.Set("X-Zenari-User-ID", "user_1")
		req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
		req.Header.Set("Content-Type", "image/png")
		setSameSiteCSRFHeaders(req)
		rec := httptest.NewRecorder()

		srv.Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("duplicate %s status = %d, want %d: %s", duplicate, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("duplicate %s response JSON error = %v", duplicate, err)
		}
		if body["code"] != "invalid_signed_object_url" {
			t.Fatalf("duplicate %s code = %v, want invalid_signed_object_url", duplicate, body["code"])
		}
		if _, err := objects.Get(context.Background(), "tenant_1", "uploads/upload_1/logo.png"); !errors.Is(err, objectstore.ErrNotFound) {
			t.Fatalf("duplicate %s stored object Get() error = %v, want not found", duplicate, err)
		}
	}
}

func TestSignedDownloadEndpointServesTenantScopedLocalObject(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-download-test"
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	stored, err := objects.Put(context.Background(), objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "exports/export_1.zip",
		ContentType: "application/zip",
	}, strings.NewReader("zip-bytes"))
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	srv := New(cfg, nil)
	downloadURL, err := srv.SignDownloadURL(context.Background(), "tenant_1", stored.Key, time.Minute)
	if err != nil {
		t.Fatalf("SignDownloadURL() error = %v", err)
	}

	db := &downloadGuardDB{found: true}
	auditRecorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodGet, downloadURL, nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), objects)))
	req = req.WithContext(audit.ContextWithRecorder(req.Context(), auditRecorder))
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if rec.Body.String() != "zip-bytes" {
		t.Fatalf("download body = %q, want zip-bytes", rec.Body.String())
	}
	if rec.Header().Get("X-Zenari-Object-Key") != "" {
		t.Fatalf("object key header should not disclose tenant-scoped key: %q", rec.Header().Get("X-Zenari-Object-Key"))
	}
	if rec.Header().Get("Cache-Control") != "private, no-store, max-age=0" {
		t.Fatalf("Cache-Control = %q, want private no-store", rec.Header().Get("Cache-Control"))
	}
	if rec.Header().Get("Pragma") != "no-cache" {
		t.Fatalf("Pragma = %q, want no-cache", rec.Header().Get("Pragma"))
	}
	if rec.Header().Get("Content-Disposition") != `attachment; filename="export_1.zip"` {
		t.Fatalf("Content-Disposition = %q", rec.Header().Get("Content-Disposition"))
	}
	if db.query.sql == "" || !strings.Contains(db.query.sql, "retention_state = 'active'") {
		t.Fatalf("download guard query = %s, want active retention guard", db.query.sql)
	}
	if len(auditRecorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(auditRecorder.events))
	}
	event := auditRecorder.events[0]
	if event.TenantID != "tenant_1" || event.Action != "object.download" || event.Resource != "objects/"+stored.Key {
		t.Fatalf("audit event = %#v, want tenant-scoped object download", event)
	}
	if event.ActorID != "signed-url" {
		t.Fatalf("audit actor = %q, want signed-url", event.ActorID)
	}
	if event.Metadata["object_key"] != stored.Key || event.Metadata["signed_access"] != true {
		t.Fatalf("audit metadata = %#v, want signed object key/access", event.Metadata)
	}
	if event.Metadata["object_metadata_id"] != "object_1" || event.Metadata["project_id"] != "project_1" || event.Metadata["owner_id"] != "user_1" || event.Metadata["asset_type"] != "export" {
		t.Fatalf("audit metadata = %#v, want object metadata/project/owner context", event.Metadata)
	}
	if strings.Contains(mustJSON(t, event.Metadata), downloadURL) {
		t.Fatalf("audit metadata leaked signed URL: %#v", event.Metadata)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO analytics_events") {
		t.Fatalf("analytics event not recorded: %#v", db.execs)
	}
	if db.execs[0].args[2] != "user_1" || db.execs[0].args[3] != "project_1" {
		t.Fatalf("analytics args = %#v, want object owner/project context", db.execs[0].args)
	}
	if db.execs[0].args[5] != "object_downloaded" || db.execs[0].args[6] != "object_metadata" || db.execs[0].args[7] != "object_1" {
		t.Fatalf("analytics args = %#v, want object_downloaded for object metadata id", db.execs[0].args)
	}
	if strings.Contains(mustJSON(t, db.execs[0].args), downloadURL) {
		t.Fatalf("analytics event leaked signed URL: %#v", db.execs[0].args)
	}
}

func TestSignedDownloadEndpointRequiresAuditRecorder(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-download-test"
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	stored, err := objects.Put(context.Background(), objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "exports/export_1.zip",
		ContentType: "application/zip",
	}, strings.NewReader("zip-bytes"))
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	downloadURL, err := objects.SignGetURL(context.Background(), "tenant_1", stored.Key, time.Minute)
	if err != nil {
		t.Fatalf("SignGetURL() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, downloadURL, nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(&downloadGuardDB{found: true}), objects)))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotImplemented, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "download_audit_not_connected" {
		t.Fatalf("code = %v, want download_audit_not_connected", body["code"])
	}
}

func TestSignedDownloadEndpointRejectsDuplicateSignedParamsBeforeAuditOrStorage(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-download-test"
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	stored, err := objects.Put(context.Background(), objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "exports/export_1.zip",
		ContentType: "application/zip",
	}, strings.NewReader("zip-bytes"))
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	downloadURL, err := objects.SignGetURL(context.Background(), "tenant_1", stored.Key, time.Minute)
	if err != nil {
		t.Fatalf("SignGetURL() error = %v", err)
	}

	for _, duplicate := range []string{"key", "expires", "sig"} {
		db := &downloadGuardDB{found: true}
		auditRecorder := &fakeAuditRecorder{}
		req := httptest.NewRequest(http.MethodGet, downloadURL+"&"+duplicate+"=tampered", nil)
		req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), objects)))
		req = req.WithContext(audit.ContextWithRecorder(req.Context(), auditRecorder))
		rec := httptest.NewRecorder()

		New(cfg, nil).Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("duplicate %s status = %d, want %d: %s", duplicate, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("duplicate %s response JSON error = %v", duplicate, err)
		}
		if body["code"] != "invalid_signed_object_url" {
			t.Fatalf("duplicate %s code = %v, want invalid_signed_object_url", duplicate, body["code"])
		}
		if db.query.sql != "" || len(auditRecorder.events) != 0 {
			t.Fatalf("duplicate %s reached storage/audit: query=%s events=%d", duplicate, db.query.sql, len(auditRecorder.events))
		}
	}
}

func TestDownloadFilenameFromKeySanitizesHeaderValue(t *testing.T) {
	cases := map[string]string{
		`tenants/tenant_1/exports/pack.zip`:                "pack.zip",
		`tenants/tenant_1/exports/bad";name.zip`:           "bad__name.zip",
		"tenants/tenant_1/exports/bad\r\nname.zip":         "bad__name.zip",
		`tenants/tenant_1/exports/nested\windows-name.zip`: "nested_windows-name.zip",
		"": "download.bin",
	}
	for input, want := range cases {
		if got := downloadFilenameFromKey(input); got != want {
			t.Fatalf("downloadFilenameFromKey(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSignedDownloadEndpointRejectsExpiredObjectMetadata(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-download-test"
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	stored, err := objects.Put(context.Background(), objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "exports/export_1.zip",
		ContentType: "application/zip",
	}, strings.NewReader("zip-bytes"))
	if err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	downloadURL, err := objects.SignGetURL(context.Background(), "tenant_1", stored.Key, time.Minute)
	if err != nil {
		t.Fatalf("SignGetURL() error = %v", err)
	}
	db := &downloadGuardDB{}

	req := httptest.NewRequest(http.MethodGet, downloadURL, nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), objects)))
	req = req.WithContext(audit.ContextWithRecorder(req.Context(), &fakeAuditRecorder{}))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "not_found" {
		t.Fatalf("code = %v, want not_found", body["code"])
	}
	if db.query.sql == "" || !strings.Contains(db.query.sql, "retention_state = 'active'") || !strings.Contains(db.query.sql, "retention_until > $3") {
		t.Fatalf("download guard query = %s, want active retention guard", db.query.sql)
	}
	if db.query.args[1] != "tenants/tenant_1/exports/export_1.zip" {
		t.Fatalf("download guard object key arg = %#v", db.query.args[1])
	}
}

func TestSignedDownloadEndpointRejectsTamperedTenantKey(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.LocalRoot = t.TempDir()
	cfg.ObjectStorage.Bucket = "signed-download-test"
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	downloadURL, err := objects.SignGetURL(context.Background(), "tenant_1", "exports/export_1.zip", time.Minute)
	if err != nil {
		t.Fatalf("SignGetURL() error = %v", err)
	}
	parsed, err := url.Parse(downloadURL)
	if err != nil {
		t.Fatalf("parse download URL: %v", err)
	}
	query := parsed.Query()
	query.Set("key", "tenants/tenant_2/exports/export_1.zip")
	parsed.RawQuery = query.Encode()

	req := httptest.NewRequest(http.MethodGet, parsed.String(), nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), objects)))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "signed_url_invalid" {
		t.Fatalf("code = %v, want signed_url_invalid", body["code"])
	}
}

func TestSignedDownloadEndpointRejectsInvalidTenantScopeBeforeStorage(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	srv := New(cfg, nil)
	expires := time.Now().UTC().Add(time.Minute).Unix()
	key := "tenants/tenant 1/exports/export_1.zip"
	sig := srv.signDownloadObjectKey(key, expires)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/objects/download?key="+url.QueryEscape(key)+"&expires="+strconv.FormatInt(expires, 10)+"&sig="+sig, nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), nil)))
	req = req.WithContext(audit.ContextWithRecorder(req.Context(), &fakeAuditRecorder{}))
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "invalid_object_key" {
		t.Fatalf("code = %v, want invalid_object_key", body["code"])
	}
}

func TestSignedDownloadEndpointRejectsUnsafeObjectKeyBeforeStorage(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	srv := New(cfg, nil)
	expires := time.Now().UTC().Add(time.Minute).Unix()
	key := "tenants/tenant_1/exports/../export_1.zip"
	sig := srv.signDownloadObjectKey(key, expires)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/objects/download?key="+url.QueryEscape(key)+"&expires="+strconv.FormatInt(expires, 10)+"&sig="+sig, nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), nil)))
	req = req.WithContext(audit.ContextWithRecorder(req.Context(), &fakeAuditRecorder{}))
	rec := httptest.NewRecorder()

	srv.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "invalid_object_key" {
		t.Fatalf("code = %v, want invalid_object_key", body["code"])
	}
}

func TestServerSignDownloadURLBuildsBackendMediatedTenantScopedURL(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	srv := New(cfg, nil)

	signed, err := srv.SignDownloadURL(context.Background(), "tenant_1", "exports/export_1.zip", time.Minute)
	if err != nil {
		t.Fatalf("SignDownloadURL() error = %v", err)
	}
	parsed, err := url.Parse(signed)
	if err != nil {
		t.Fatalf("signed URL parse error = %v", err)
	}
	if parsed.Scheme != "" || parsed.Host != "" || parsed.Path != "/api/v1/objects/download" {
		t.Fatalf("signed URL = %q, want backend-mediated relative download path", signed)
	}
	query := parsed.Query()
	if query.Get("key") != "tenants/tenant_1/exports/export_1.zip" {
		t.Fatalf("signed key = %q, want tenant-scoped key", query.Get("key"))
	}
	if query.Get("expires") == "" || query.Get("sig") == "" {
		t.Fatalf("signed URL missing expires or sig: %q", signed)
	}
	expires, err := strconv.ParseInt(query.Get("expires"), 10, 64)
	if err != nil {
		t.Fatalf("expires parse error = %v", err)
	}
	if got := srv.signDownloadObjectKey(query.Get("key"), expires); got != query.Get("sig") {
		t.Fatalf("signature mismatch: got %q want %q", query.Get("sig"), got)
	}
}

func TestServerSignDownloadURLRejectsUnsafeObjectKey(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	srv := New(cfg, nil)

	if _, err := srv.SignDownloadURL(context.Background(), "tenant_1", "exports/../export_1.zip", time.Minute); err == nil {
		t.Fatal("SignDownloadURL() error = nil, want unsafe object key error")
	}
}

func TestServerSignDownloadURLRejectsCrossTenantScopedObjectKey(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.SigningKey = "signed-download-test-secret"
	srv := New(cfg, nil)

	if _, err := srv.SignDownloadURL(context.Background(), "tenant_1", "tenants/tenant_2/exports/export_1.zip", time.Minute); err == nil {
		t.Fatal("SignDownloadURL() error = nil, want cross-tenant scoped key error")
	}
}

func TestAdminAuditDeniesNonAdmin(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/audit", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestAdminRouteRejectsDevIdentityHeadersByDefault(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/audit", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_superadmin")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestAdminAuditRequiresOperator(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/audit", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_viewer")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	details := body["details"].(map[string]any)
	if details["required_permission"] != "audit:read" {
		t.Fatalf("required_permission = %v, want audit:read", details["required_permission"])
	}
}

func TestAdminAuditSearchUsesPrincipalTenantAndFilters(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	searcher := &fakeAuditSearcher{page: audit.Page{Items: []audit.Event{{
		ID:        "audit_1",
		TenantID:  "tenant_1",
		ActorID:   "admin_1",
		Action:    "export.regenerate",
		Resource:  "exports/export_1",
		Metadata:  map[string]any{"reason": "retry"},
		CreatedAt: time.Date(2026, 5, 26, 1, 2, 3, 0, time.UTC),
	}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/audit?tenant_id=tenant_2&actor_id=admin_1&action=export.regenerate&resource=exports/export_1&page_size=25", nil)
	req = req.WithContext(audit.ContextWithSearcher(req.Context(), searcher))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_superadmin")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if searcher.filters.TenantID != "tenant_1" {
		t.Fatalf("tenant filter = %q, want principal tenant tenant_1", searcher.filters.TenantID)
	}
	if searcher.filters.ActorID != "admin_1" || searcher.filters.Action != "export.regenerate" || searcher.filters.Resource != "exports/export_1" || searcher.filters.Limit != 25 {
		t.Fatalf("filters = %#v, want requested actor/action/resource/page size", searcher.filters)
	}
	var body struct {
		Items []audit.Event `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if len(body.Items) != 1 || body.Items[0].ID != "audit_1" {
		t.Fatalf("items = %#v, want audit_1", body.Items)
	}
	if body.Items[0].AuditRef != "audit_1" {
		t.Fatalf("audit_ref = %q, want audit_1", body.Items[0].AuditRef)
	}
}

func TestAdminAuditSearchAcceptsSubjectAliasForObjectStorageProbe(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	searcher := &fakeAuditSearcher{page: audit.Page{Items: []audit.Event{{
		ID:        "audit_1",
		TenantID:  "tenant_1",
		ActorID:   "admin_operator_1",
		Action:    "export.cleanup",
		Resource:  "object_storage_cleanup",
		Metadata:  map[string]any{"scope": "object_storage_cleanup"},
		CreatedAt: time.Date(2026, 5, 26, 1, 2, 3, 0, time.UTC),
	}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/audit?subject=object_storage_cleanup&page_size=20", nil)
	req = req.WithContext(audit.ContextWithSearcher(req.Context(), searcher))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_operator")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if searcher.filters.Resource != "object_storage_cleanup" || searcher.filters.Limit != 20 {
		t.Fatalf("filters = %#v, want subject alias mapped to resource", searcher.filters)
	}
	body := strings.ToLower(rec.Body.String())
	for _, token := range []string{"audit", "object_storage_cleanup", "admin_operator_1", "tenant_1"} {
		if !strings.Contains(body, strings.ToLower(token)) {
			t.Fatalf("audit response missing %q: %s", token, rec.Body.String())
		}
	}
	var parsed struct {
		Items []audit.Event `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if len(parsed.Items) != 1 || parsed.Items[0].AuditRef != "audit_1" {
		t.Fatalf("audit_ref projection = %#v, want audit_1", parsed.Items)
	}
}

func TestAdminExportRegenerateRequiresReviewer(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/regenerate", bytes.NewBufferString(`{"rationale":"retry after failed export","second_reviewer_id":"admin_reviewer_2","second_reviewer_role":"admin_reviewer","second_review_rationale":"approved retry"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_viewer")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	details := body["details"].(map[string]any)
	if details["required_permission"] != "export_override:admin" {
		t.Fatalf("required_permission = %v, want export_override:admin", details["required_permission"])
	}
}

func TestAdminExportRegenerateRequiresRationale(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/regenerate", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_reviewer")
	req.Header.Set("Idempotency-Key", "regenerate-export-rationale-required")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "rationale_required" {
		t.Fatalf("code = %v, want rationale_required", body["code"])
	}
}

func TestAdminExportRegenerateRequiresSecondReview(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/regenerate", bytes.NewBufferString(`{"rationale":"retry after failed export","second_reviewer_id":"admin_reviewer_1","second_reviewer_role":"admin_reviewer","second_review_rationale":"approved retry"}`))
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_reviewer")
	req.Header.Set("Idempotency-Key", "regenerate-export-second-review-required")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "second_review_required" {
		t.Fatalf("code = %v, want second_review_required", body["code"])
	}
}

func TestAdminExportRegenerateRequiresSecondReviewerRole(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/regenerate", bytes.NewBufferString(`{"rationale":"retry after failed export","second_reviewer_id":"admin_viewer_2","second_reviewer_role":"admin_viewer","second_review_rationale":"approved retry"}`))
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_reviewer")
	req.Header.Set("Idempotency-Key", "regenerate-export-second-review-role-required")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "second_review_required" {
		t.Fatalf("code = %v, want second_review_required", body["code"])
	}
	details := body["details"].(map[string]any)
	if details["field"] != "second_reviewer_role" || details["required_permission"] != "export_override:admin" {
		t.Fatalf("details = %#v, want second reviewer role permission evidence", details)
	}
}

func TestAdminExportRegenerateRecordsAuditWithRationaleAndSecondReview(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{queryRows: []stage0RowSet{{
		rows: [][]any{{
			"export_1",
			"tenant_1",
			"package_1",
			"project_1",
			nil,
			"zip",
			"failed",
			"failed",
			nil,
			[]byte(`{"workflow_id":"workflow_1"}`),
			[]byte(`{}`),
			[]byte(`{"message":"failed"}`),
			now,
			now,
			[]byte(`{}`),
		}},
	}, {}, {}, {}}}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/regenerate", bytes.NewBufferString(`{"rationale":"retry after QA fix with token=npm_abcdefghijklmnopqrstuvwxyz123456","second_reviewer_id":"admin_reviewer_2","second_reviewer_role":"admin_reviewer","second_review_rationale":"approved retry after Bearer abcdefghijklmnop"}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_reviewer")
	req.Header.Set("Idempotency-Key", "regenerate-export-records-audit")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusAccepted, rec.Body.String())
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.TenantID != "tenant_1" || event.ActorID != "admin_reviewer_1" || event.Action != "export.regenerate" || event.Resource != "exports/export_1" {
		t.Fatalf("audit event = %#v", event)
	}
	if event.Metadata["rationale"] != "retry after QA fix with token="+security.Redacted {
		t.Fatalf("audit rationale = %#v, want redacted token", event.Metadata["rationale"])
	}
	if event.Metadata["second_reviewer_id"] != "admin_reviewer_2" {
		t.Fatalf("second reviewer = %#v, want admin_reviewer_2", event.Metadata["second_reviewer_id"])
	}
	if event.Metadata["second_reviewer_role"] != "admin_reviewer" {
		t.Fatalf("second reviewer role = %#v, want admin_reviewer", event.Metadata["second_reviewer_role"])
	}
	if event.Metadata["second_review_rationale"] != "approved retry after Bearer "+security.Redacted {
		t.Fatalf("second review rationale = %#v, want redacted bearer", event.Metadata["second_review_rationale"])
	}
	if event.Metadata["package_id"] != "package_1" || event.Metadata["format"] != "zip" {
		t.Fatalf("audit metadata = %#v, want package and format", event.Metadata)
	}
}

func TestAdminExportRegenerateRequiresIdempotencyBeforeStorage(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/regenerate", bytes.NewBufferString(`{"rationale":"retry after QA fix","second_reviewer_id":"admin_reviewer_2","second_reviewer_role":"admin_reviewer","second_review_rationale":"approved retry"}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_reviewer")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "idempotency_key_required") {
		t.Fatalf("body = %s, want idempotency_key_required", rec.Body.String())
	}
	if len(db.queries) != 0 || len(db.execs) != 0 || len(recorder.events) != 0 {
		t.Fatalf("missing idempotency reached storage/audit: queries=%#v execs=%#v events=%#v", db.queries, db.execs, recorder.events)
	}
}

func TestAdminExportOverrideRecordsAuditAndRedacts(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 22, 13, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{queryRows: []stage0RowSet{
		{rows: nil},
		{rows: [][]any{{
			"export_1",
			"tenant_1",
			"package_1",
			"project_1",
			nil,
			"zip",
			"failed",
			"failed",
			nil,
			[]byte(`{"trace_id":"trace_1"}`),
			[]byte(`{"retention_until":"2026-07-01T00:00:00Z"}`),
			[]byte(`{"message":"failed"}`),
			now,
			now,
			[]byte(`{}`),
		}}},
	}}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/override", bytes.NewBufferString(`{"source_type":"qa_result","source_id":"qa_1","trace_id":"trace_1","decision":"approved","rationale":"approved after support review with Bearer abcdefghijklmnop","metadata":{"ticket_id":"sup_1","api_key":"`+serverStripeSecretFixture+`"}}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_reviewer")
	req.Header.Set("Idempotency-Key", "export-override-1")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Action != "export.override" || event.Resource != "exports/export_1" || event.Metadata["download_enabled"] != false {
		t.Fatalf("event = %#v, want export override audit with fail-closed download", event)
	}
	if event.Metadata["rationale"] != "approved after support review with Bearer "+security.Redacted {
		t.Fatalf("audit rationale = %#v, want redacted bearer", event.Metadata["rationale"])
	}
	metadata := event.Metadata["metadata"].(map[string]any)
	if metadata["api_key"] != security.Redacted {
		t.Fatalf("audit metadata = %#v, want redacted api_key", metadata)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO export_override_decisions") {
		t.Fatalf("execs = %#v, want export override insert", db.execs)
	}
	if db.queries[1].args[0] != "tenant_1" || db.queries[1].args[1] != "export_1" {
		t.Fatalf("export lookup args = %#v, want tenant-scoped export", db.queries[1].args)
	}
	insertMetadata := string(db.execs[0].args[16].([]byte))
	if strings.Contains(insertMetadata, "sk_test_") || !strings.Contains(insertMetadata, security.Redacted) {
		t.Fatalf("insert metadata = %s, want redacted secret", insertMetadata)
	}
	if !strings.Contains(rec.Body.String(), `"final_export_allowed": false`) || !strings.Contains(rec.Body.String(), `"source_gate_resolved": true`) {
		t.Fatalf("body = %s, want source resolved but final export still fail-closed", rec.Body.String())
	}
}

func TestAdminExportOverrideAuditFailureDoesNotRecord(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{}
	recorder := &fakeAuditRecorder{err: errors.New("audit unavailable")}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/override", bytes.NewBufferString(`{"source_type":"qa_result","source_id":"qa_1","trace_id":"trace_1","decision":"denied","denial_reason":"missing_approval_audit","rationale":"audit missing"}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_reviewer")
	req.Header.Set("Idempotency-Key", "export-override-audit-failure")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "export_override_audit_record_error") {
		t.Fatalf("body = %s, want export_override_audit_record_error", rec.Body.String())
	}
	if len(db.queries) != 0 || len(db.execs) != 0 {
		t.Fatalf("audit failure reached export override storage: queries=%#v execs=%#v", db.queries, db.execs)
	}
}

func TestAdminExportCleanupRequiresOperator(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging retention validation"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_reviewer")
	req.Header.Set("Idempotency-Key", "export-cleanup-forbidden")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	details := body["details"].(map[string]any)
	if details["required_permission"] != "object_retention_cleanup:admin" {
		t.Fatalf("required_permission = %v, want object_retention_cleanup:admin", details["required_permission"])
	}
}

func TestAdminExportCleanupRequiresIdempotencyBeforeStorage(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging retention cleanup","limit":25,"dry_run":true}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_operator")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "idempotency_key_required") {
		t.Fatalf("body = %s, want idempotency_key_required", rec.Body.String())
	}
	if len(db.queries) != 0 || len(db.execs) != 0 || len(recorder.events) != 0 {
		t.Fatalf("missing idempotency reached storage/audit: queries=%#v execs=%#v events=%#v", db.queries, db.execs, recorder.events)
	}
}

func TestAdminObjectStorageRetentionPolicySupportsStagingProbeTokens(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/object-storage/retention-policy", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_operator")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	body := strings.ToLower(rec.Body.String())
	for _, token := range []string{"retention policy", "versioning", "retention_until", "tenant_1"} {
		if !strings.Contains(body, strings.ToLower(token)) {
			t.Fatalf("retention policy response missing %q: %s", token, rec.Body.String())
		}
	}
}

func TestAdminObjectStorageCleanupProbeRoutesAllowOperatorSmokeMode(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	for _, tc := range []struct {
		name string
		path string
		want string
	}{
		{name: "expired exports", path: "/api/admin/v1/object-storage/cleanup/expired-exports", want: "expired export cleanup"},
		{name: "orphans", path: "/api/admin/v1/object-storage/cleanup/orphans", want: "orphan cleanup"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := &fakeStage0DB{execTags: []pgconn.CommandTag{
				pgconn.NewCommandTag("UPDATE 1"),
				pgconn.NewCommandTag("UPDATE 1"),
				pgconn.NewCommandTag("SELECT 1"),
			}}
			recorder := &fakeAuditRecorder{}
			req := httptest.NewRequest(http.MethodPost, tc.path, bytes.NewBufferString(`{"mode":"stage0_retention_cleanup_smoke","second_reviewer_id":"admin_super_2","second_reviewer_role":"admin_superadmin","second_review_rationale":"approved retention cleanup smoke"}`))
			req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
			req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
			req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
			req.Header.Set("X-Zenari-Roles", "admin_operator")
			req.Header.Set("X-Request-ID", "stage0-object-retention-cleanup-"+cleanupRouteModeForTest(tc.path))
			req.Header.Set("Idempotency-Key", "stage0-object-retention-cleanup-"+cleanupRouteModeForTest(tc.path))
			setSameSiteCSRFHeaders(req)
			rec := httptest.NewRecorder()

			New(cfg, nil).Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusAccepted {
				t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusAccepted, rec.Body.String())
			}
			body := strings.ToLower(rec.Body.String())
			for _, token := range []string{tc.want, "deleted", "retained", "audit"} {
				if !strings.Contains(body, token) {
					t.Fatalf("cleanup response missing %q: %s", token, rec.Body.String())
				}
			}
			if len(recorder.events) != 2 {
				t.Fatalf("audit events = %d, want request and result audits", len(recorder.events))
			}
			var parsed struct {
				AuditRefs []string `json:"audit_refs"`
				AuditRef  string   `json:"audit_ref"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
				t.Fatalf("response JSON error = %v", err)
			}
			if parsed.AuditRef != recorder.events[1].ID {
				t.Fatalf("audit_ref = %q, want completion audit %q", parsed.AuditRef, recorder.events[1].ID)
			}
			if len(parsed.AuditRefs) != 2 || parsed.AuditRefs[0] != recorder.events[0].ID || parsed.AuditRefs[1] != recorder.events[1].ID {
				t.Fatalf("audit_refs = %#v, want request/completion audit IDs %#v", parsed.AuditRefs, []string{recorder.events[0].ID, recorder.events[1].ID})
			}
			if recorder.events[0].ActorID != "admin_operator_1" || recorder.events[0].Metadata["rationale"] != "stage0 retention cleanup smoke" {
				t.Fatalf("request audit event = %#v", recorder.events[0])
			}
			if recorder.events[0].Metadata["mode"] != cleanupRouteModeForTest(tc.path) {
				t.Fatalf("request audit mode = %#v, want %s", recorder.events[0].Metadata["mode"], cleanupRouteModeForTest(tc.path))
			}
			if recorder.events[0].Metadata["request_id"] != "stage0-object-retention-cleanup-"+cleanupRouteModeForTest(tc.path) {
				t.Fatalf("request audit request_id = %#v", recorder.events[0].Metadata["request_id"])
			}
			if recorder.events[1].Resource != "object_storage_cleanup" || recorder.events[1].Metadata["mode"] == "" {
				t.Fatalf("cleanup audit event = %#v", recorder.events[1])
			}
			if recorder.events[1].Metadata["mode"] != cleanupRouteModeForTest(tc.path) {
				t.Fatalf("cleanup audit mode = %#v, want %s", recorder.events[1].Metadata["mode"], cleanupRouteModeForTest(tc.path))
			}
			if recorder.events[1].Metadata["request_id"] != "stage0-object-retention-cleanup-"+cleanupRouteModeForTest(tc.path) {
				t.Fatalf("cleanup audit request_id = %#v", recorder.events[1].Metadata["request_id"])
			}
		})
	}
}

func TestAdminObjectStorageCleanupRoutesRequireIdempotencyBeforeStorage(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	for _, path := range []string{
		"/api/admin/v1/object-storage/cleanup/expired-exports",
		"/api/admin/v1/object-storage/cleanup/orphans",
	} {
		t.Run(path, func(t *testing.T) {
			db := &fakeStage0DB{}
			recorder := &fakeAuditRecorder{}
			req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{"rationale":"stage0 retention cleanup smoke","limit":25,"dry_run":true}`))
			req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
			req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
			req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
			req.Header.Set("X-Zenari-Roles", "admin_operator")
			setSameSiteCSRFHeaders(req)
			rec := httptest.NewRecorder()

			New(cfg, nil).Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "idempotency_key_required") {
				t.Fatalf("body = %s, want idempotency_key_required", rec.Body.String())
			}
			if len(db.queries) != 0 || len(db.execs) != 0 || len(recorder.events) != 0 {
				t.Fatalf("missing idempotency reached storage/audit: queries=%#v execs=%#v events=%#v", db.queries, db.execs, recorder.events)
			}
		})
	}
}

func cleanupRouteModeForTest(path string) string {
	switch path {
	case "/api/admin/v1/object-storage/cleanup/expired-exports":
		return "expired_export_cleanup"
	case "/api/admin/v1/object-storage/cleanup/orphans":
		return "orphan_cleanup"
	default:
		return ""
	}
}

func TestAdminExportCleanupRunsServiceAndRecordsAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{execTags: []pgconn.CommandTag{
		pgconn.NewCommandTag("UPDATE 2"),
		pgconn.NewCommandTag("UPDATE 1"),
		pgconn.NewCommandTag("SELECT 1"),
	}}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging retention cleanup token=npm_abcdefghijklmnopqrstuvwxyz123456","limit":999,"second_reviewer_id":"admin_operator_2","second_reviewer_role":"admin_operator","second_review_rationale":"approved object retention cleanup after review"}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_super_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_superadmin")
	req.Header.Set("Idempotency-Key", "export-cleanup-run")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusAccepted, rec.Body.String())
	}
	var result stage0.CleanupResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if result.ExpiredExports != 2 || result.OrphanedObjects != 1 || result.DeletedObjects != 0 {
		t.Fatalf("cleanup result = %#v, want 2/1/0", result)
	}
	if len(db.execs) != 3 {
		t.Fatalf("exec count = %d, want cleanup lifecycle update and analytics", len(db.execs))
	}
	for i, call := range db.execs {
		if call.args[len(call.args)-1] != "tenant_1" {
			t.Fatalf("exec[%d] args = %#v, want admin cleanup scoped to tenant_1", i, call.args)
		}
	}
	if len(recorder.events) != 2 {
		t.Fatalf("audit events = %d, want request and result audits", len(recorder.events))
	}
	requestEvent := recorder.events[0]
	if requestEvent.Action != "export.cleanup.requested" || requestEvent.Resource != "object_storage_cleanup" {
		t.Fatalf("request audit event = %#v, want cleanup request action", requestEvent)
	}
	if requestEvent.Metadata["rationale"] != "staging retention cleanup token="+security.Redacted || requestEvent.Metadata["limit"] != 500 || requestEvent.Metadata["dry_run"] != false {
		t.Fatalf("request audit metadata = %#v, want redacted rationale and capped limit", requestEvent.Metadata)
	}
	if requestEvent.Metadata["second_reviewer_id"] != "admin_operator_2" || requestEvent.Metadata["second_reviewer_role"] != "admin_operator" || requestEvent.Metadata["second_review_rationale"] != "approved object retention cleanup after review" {
		t.Fatalf("request audit second review metadata = %#v", requestEvent.Metadata)
	}
	event := recorder.events[1]
	if event.TenantID != "tenant_1" || event.ActorID != "admin_super_1" || event.Action != "export.cleanup" || event.Resource != "object_storage_cleanup" {
		t.Fatalf("audit event = %#v", event)
	}
	if event.Metadata["rationale"] != "staging retention cleanup token="+security.Redacted {
		t.Fatalf("audit rationale = %#v, want redacted token", event.Metadata["rationale"])
	}
	if event.Metadata["limit"] != 500 || event.Metadata["expired_exports"] != 2 || event.Metadata["orphaned_objects"] != 1 || event.Metadata["deleted_objects"] != 0 {
		t.Fatalf("audit metadata = %#v, want capped limit and cleanup counts", event.Metadata)
	}
	if event.Metadata["failed_objects"] != 0 || event.Metadata["cleanup_status"] != "completed" {
		t.Fatalf("audit cleanup status metadata = %#v, want completed with no failed objects", event.Metadata)
	}
	if event.Metadata["high_risk"] != true || event.Metadata["second_review_required"] != true || event.Metadata["second_reviewer_id"] != "admin_operator_2" {
		t.Fatalf("audit second review metadata = %#v", event.Metadata)
	}
}

func TestAdminExportCleanupRequiresSecondReviewForDestructiveRun(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{execTags: []pgconn.CommandTag{
		pgconn.NewCommandTag("UPDATE 2"),
		pgconn.NewCommandTag("UPDATE 1"),
	}}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging retention cleanup","limit":25}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_super_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_superadmin")
	req.Header.Set("Idempotency-Key", "export-cleanup-second-review-missing")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "second_review_required" {
		t.Fatalf("code = %v, want second_review_required", body["code"])
	}
	details := body["details"].(map[string]any)
	if details["field"] != "second_reviewer_id" {
		t.Fatalf("details = %#v, want second_reviewer_id", details)
	}
	if len(db.execs) != 0 || len(recorder.events) != 0 {
		t.Fatalf("cleanup mutated or audited without second review: execs=%#v events=%#v", db.execs, recorder.events)
	}
}

func TestAdminExportCleanupRequiresSecondReviewerCleanupPermission(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{execTags: []pgconn.CommandTag{
		pgconn.NewCommandTag("UPDATE 2"),
		pgconn.NewCommandTag("UPDATE 1"),
	}}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging retention cleanup","limit":25,"second_reviewer_id":"admin_viewer_2","second_reviewer_role":"admin_viewer","second_review_rationale":"approved cleanup"}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_super_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_superadmin")
	req.Header.Set("Idempotency-Key", "export-cleanup-second-review-role")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "second_review_required" {
		t.Fatalf("code = %v, want second_review_required", body["code"])
	}
	details := body["details"].(map[string]any)
	if details["field"] != "second_reviewer_role" || details["required_permission"] != "object_retention_cleanup:admin" {
		t.Fatalf("details = %#v, want second reviewer cleanup permission evidence", details)
	}
	if len(db.execs) != 0 || len(recorder.events) != 0 {
		t.Fatalf("cleanup mutated or audited without eligible second reviewer: execs=%#v events=%#v", db.execs, recorder.events)
	}
}

func TestAdminExportCleanupDryRunPreviewsAndAuditsWithoutMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{queryRows: []stage0RowSet{
		{rows: [][]any{{1, 2}}},
		{rows: [][]any{{
			"object_1",
			"tenant_1",
			"tenants/tenant_1/exports/export_1.zip",
		}, {
			"object_2",
			"tenant_1",
			"tenants/tenant_1/thumbnails/export_1.zip.svg",
		}}},
	}}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging retention dry run","limit":25,"dry_run":true}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_super_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_superadmin")
	req.Header.Set("Idempotency-Key", "export-cleanup-dry-run")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusAccepted, rec.Body.String())
	}
	var result stage0.CleanupResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if !result.DryRun || result.Status != "preview" || result.ExpiredExports != 1 || result.OrphanedObjects != 2 || result.PreviewObjects != 2 || result.DeletedObjects != 0 {
		t.Fatalf("cleanup dry-run result = %#v, want preview of 2 objects without deletes", result)
	}
	if len(db.execs) != 0 {
		t.Fatalf("dry-run cleanup should not mutate DB: %#v", db.execs)
	}
	if len(db.queries) != 2 {
		t.Fatalf("dry-run cleanup queries = %d, want counts and object preview queries", len(db.queries))
	}
	if db.queries[0].args[1] != "tenant_1" || !strings.Contains(db.queries[0].sql, "expired_exports") {
		t.Fatalf("dry-run cleanup counts query = %#v / %s, want tenant-scoped counts", db.queries[0].args, db.queries[0].sql)
	}
	if db.queries[1].args[2] != "tenant_1" || !strings.Contains(db.queries[1].sql, "cleanup_candidates") {
		t.Fatalf("dry-run cleanup preview query = %#v / %s, want tenant-scoped preview", db.queries[1].args, db.queries[1].sql)
	}
	if len(recorder.events) != 2 {
		t.Fatalf("audit events = %d, want request and preview audits", len(recorder.events))
	}
	requestEvent := recorder.events[0]
	if requestEvent.Action != "export.cleanup.preview.requested" || requestEvent.Resource != "object_storage_cleanup" {
		t.Fatalf("request audit event = %#v, want cleanup preview request action", requestEvent)
	}
	if requestEvent.Metadata["dry_run"] != true || requestEvent.Metadata["limit"] != 25 || requestEvent.Metadata["rationale"] != "staging retention dry run" {
		t.Fatalf("request audit metadata = %#v, want dry-run request metadata", requestEvent.Metadata)
	}
	event := recorder.events[1]
	if event.Action != "export.cleanup.preview" || event.Resource != "object_storage_cleanup" {
		t.Fatalf("audit event = %#v, want cleanup preview action", event)
	}
	if event.Metadata["dry_run"] != true || event.Metadata["preview_objects"] != 2 || event.Metadata["expired_exports"] != 1 || event.Metadata["orphaned_objects"] != 2 || event.Metadata["deleted_objects"] != 0 {
		t.Fatalf("audit metadata = %#v, want dry-run preview counts", event.Metadata)
	}
}

func TestAdminExportCleanupFailsClosedWithoutAuditRecorder(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{execTags: []pgconn.CommandTag{
		pgconn.NewCommandTag("UPDATE 2"),
		pgconn.NewCommandTag("UPDATE 1"),
	}}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging retention cleanup","limit":25,"second_reviewer_id":"admin_operator_2","second_reviewer_role":"admin_operator","second_review_rationale":"approved cleanup"}`))
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_super_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_superadmin")
	req.Header.Set("Idempotency-Key", "export-cleanup-no-audit")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotImplemented, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "cleanup_audit_not_connected" {
		t.Fatalf("code = %v, want cleanup_audit_not_connected", body["code"])
	}
	if len(db.execs) != 0 {
		t.Fatalf("cleanup ran without audit recorder: %#v", db.execs)
	}
}

func TestAdminExportCleanupFailsClosedWhenRequestAuditCannotRecord(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{execTags: []pgconn.CommandTag{
		pgconn.NewCommandTag("UPDATE 2"),
		pgconn.NewCommandTag("UPDATE 1"),
	}}
	recorder := &fakeAuditRecorder{err: errors.New("audit unavailable")}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging retention cleanup","limit":25,"second_reviewer_id":"admin_operator_2","second_reviewer_role":"admin_operator","second_review_rationale":"approved cleanup"}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_super_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_superadmin")
	req.Header.Set("Idempotency-Key", "export-cleanup-request-audit-fails")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "audit_record_error" {
		t.Fatalf("code = %v, want audit_record_error", body["code"])
	}
	if len(db.execs) != 0 {
		t.Fatalf("cleanup ran after request audit failure: %#v", db.execs)
	}
}

func TestAdminExportCleanupAuditsFailureResult(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []stage0RowSet{{
			rows: [][]any{{
				"object_1",
				"tenant_1",
				"tenants/tenant_1/exports/missing.zip",
			}},
		}},
	}
	recorder := &fakeAuditRecorder{}
	objects := &serverObjectStore{deleteErr: objectstore.ErrTenantDenied}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging cleanup token=npm_abcdefghijklmnopqrstuvwxyz123456","limit":25,"second_reviewer_id":"admin_operator_2","second_reviewer_role":"admin_operator","second_review_rationale":"approved cleanup after Bearer abcdefghijklmnop"}`))
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), objects)), recorder))
	req.Header.Set("X-Zenari-User-ID", "admin_super_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_superadmin")
	req.Header.Set("Idempotency-Key", "export-cleanup-failure-audit")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	if len(recorder.events) != 2 {
		t.Fatalf("audit events = %d, want request and failed result audits", len(recorder.events))
	}
	if recorder.events[0].Action != "export.cleanup.requested" {
		t.Fatalf("request audit action = %q", recorder.events[0].Action)
	}
	failed := recorder.events[1]
	if failed.Action != "export.cleanup.failed" || failed.Metadata["failed_objects"] != 1 || failed.Metadata["cleanup_status"] != "partial_failed" {
		t.Fatalf("failed audit event = %#v, want partial failure metadata", failed)
	}
	if failed.Metadata["rationale"] != "staging cleanup token="+security.Redacted {
		t.Fatalf("failed audit rationale = %#v, want redacted token", failed.Metadata["rationale"])
	}
	if failed.Metadata["second_review_rationale"] != "approved cleanup after Bearer "+security.Redacted {
		t.Fatalf("failed audit second review rationale = %#v, want redacted bearer", failed.Metadata["second_review_rationale"])
	}
	if errorMessage, _ := failed.Metadata["error"].(string); errorMessage == "" || strings.Contains(errorMessage, "npm_abcdefghijklmnopqrstuvwxyz123456") {
		t.Fatalf("failed audit error = %#v, want redacted non-empty error", failed.Metadata["error"])
	}
}

func TestAdminCrawlerStartRunRequiresOperator(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/crawler/sources/crawler_source_1/runs", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_viewer")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	details := body["details"].(map[string]any)
	if details["required_permission"] != "crawler_import:admin" {
		t.Fatalf("required_permission = %v, want crawler_import:admin", details["required_permission"])
	}
}

func TestAdminCrawlerStartRunReturnsPolicyBlock(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	cfg.Crawler.Enabled = false

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/crawler/sources/crawler_source_1/runs", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_operator")
	req.Header.Set("Idempotency-Key", "crawler-start-policy-block")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want crawler policy conflict: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "crawler_blocked" {
		t.Fatalf("code = %v, want crawler_blocked", body["code"])
	}
}

func TestAdminCrawlerStartRunRequiresIdempotencyBeforeStorage(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/crawler/sources/crawler_source_1/runs", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_operator")
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "idempotency_key_required") {
		t.Fatalf("body = %s, want idempotency_key_required", rec.Body.String())
	}
	if len(db.queries) != 0 || len(db.execs) != 0 {
		t.Fatalf("missing idempotency reached storage: queries=%#v execs=%#v", db.queries, db.execs)
	}
}

func TestAdminCrawlerSourcesUsesPrincipalTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	tenantID := "tenant_1"
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"crawler_source_1",
		&tenantID,
		"Tenant Source",
		"https://example.com/docs",
		"approved",
		[]byte(`{"license":"permissive","owner":"Example"}`),
		[]byte(`{"robots":"allowed"}`),
		now,
		now,
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/crawler/sources?tenant_id=tenant_2&status=approved&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_viewer")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" || query.args[1] != 25 || query.args[2] != "approved" {
		t.Fatalf("query args = %#v, want principal tenant tenant_1, limit 25, status approved", query.args)
	}
}

func TestAdminCrawlerFindingsUsesPrincipalTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	tenantID := "tenant_1"
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"crawler_finding_1",
		&tenantID,
		"crawler_doc_1",
		"layout_pattern",
		"pending_review",
		[]byte(`{"kind":"grid"}`),
		[]byte(`{"source_url":"https://example.com/docs"}`),
		now,
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/crawler/findings?tenant_id=tenant_2&status=pending_review&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_viewer")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" || query.args[1] != 25 || query.args[2] != "pending_review" {
		t.Fatalf("query args = %#v, want principal tenant tenant_1, limit 25, status pending_review", query.args)
	}
}

func TestAdminSafetyRulesUsesPrincipalTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	tenantID := "tenant_1"
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"safety_rule_1",
		&tenantID,
		"export_block",
		"1",
		"exports",
		"critical",
		"block",
		[]byte(`["export"]`),
		"active",
		now,
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/safety/rules?tenant_id=tenant_2&status=active&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_viewer")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" || query.args[1] != 25 || query.args[2] != "active" {
		t.Fatalf("query args = %#v, want principal tenant tenant_1, limit 25, status active", query.args)
	}
}

func TestAdminSafetyReviewsUsesPrincipalTenantAndSafeProjection(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	ruleID := "safety_rule_1"
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"safety_decision_1",
		"tenant_1",
		ruleID,
		"export",
		"export_1",
		"export",
		"require_admin_review",
		"active safety rule matched enforcement point",
		"financial-claim-review:v1",
		"v1",
		"medium",
		"pending",
		"",
		"",
		"",
		"",
		now,
		nil,
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/safety/reviews?tenant_id=tenant_2&status=pending&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminViewer))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" || query.args[1] != 25 || query.args[2] != "pending" {
		t.Fatalf("query args = %#v, want principal tenant/status scope", query.args)
	}
	body := rec.Body.String()
	for _, want := range []string{`"safety_decision_id": "safety_decision_1"`, `"raw_prompt_persisted": false`, `"raw_provider_payload_persisted": false`, `"admin_only": true`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body = %s, missing %s", body, want)
		}
	}
}

func TestAdminSafetyReviewDecisionRecordsAuditAndRedacts(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{queryRows: []stage0RowSet{
		{rows: nil},
		{rows: [][]any{{"safety_decision_1"}}},
	}}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/safety/reviews/safety_decision_1/decision", bytes.NewBufferString(`{"decision":"approved","rationale":"reviewed masked financial warning after Bearer abcdefghijklmnop","metadata":{"ticket_id":"sup_1","api_key":"`+serverStripeSecretFixture+`"}}`))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminReviewer))
	req.Header.Set("Idempotency-Key", "safety-review-1")
	req.Header.Set("X-Zenari-CSRF", "same-site-origin-check")
	req.Header.Set("Origin", "http://localhost:26081")
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Action != "safety.review" || event.Resource != "safety_decisions/safety_decision_1" {
		t.Fatalf("event = %#v, want safety.review audit", event)
	}
	if event.Metadata["rationale"] != "reviewed masked financial warning after Bearer "+security.Redacted {
		t.Fatalf("audit rationale = %#v, want redacted bearer", event.Metadata["rationale"])
	}
	metadata := event.Metadata["metadata"].(map[string]any)
	if metadata["api_key"] != security.Redacted {
		t.Fatalf("audit nested metadata = %#v, want redacted api_key", metadata)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO safety_review_decisions") {
		t.Fatalf("execs = %#v, want safety review insert", db.execs)
	}
	insertMetadata := string(db.execs[0].args[8].([]byte))
	if strings.Contains(insertMetadata, "sk_test_") || !strings.Contains(insertMetadata, security.Redacted) {
		t.Fatalf("insert metadata = %s, want redacted secret", insertMetadata)
	}
	if db.execs[0].args[1] != "tenant_1" || db.execs[0].args[2] != "safety_decision_1" || db.execs[0].args[3] != "admin_reviewer_1" {
		t.Fatalf("insert args = %#v, want tenant decision reviewer", db.execs[0].args)
	}
}

func TestAdminSafetyReviewDecisionRequiresIdempotencyBeforeAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{}
	recorder := &fakeAuditRecorder{}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/safety/reviews/safety_decision_1/decision", bytes.NewBufferString(`{"decision":"approved","rationale":"reviewed warning"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminReviewer))
	req.Header.Set("X-Zenari-CSRF", "same-site-origin-check")
	req.Header.Set("Origin", "http://localhost:26081")
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if len(recorder.events) != 0 || len(db.execs) != 0 {
		t.Fatalf("idempotency failure reached audit/db: events=%#v execs=%#v", recorder.events, db.execs)
	}
}

func TestAdminSafetyReviewDecisionAuditFailureDoesNotRecord(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{}
	recorder := &fakeAuditRecorder{err: errors.New("audit unavailable")}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/safety/reviews/safety_decision_1/decision", bytes.NewBufferString(`{"decision":"approved","rationale":"reviewed warning"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminReviewer))
	req.Header.Set("Idempotency-Key", "safety-review-audit-failure")
	req.Header.Set("X-Zenari-CSRF", "same-site-origin-check")
	req.Header.Set("Origin", "http://localhost:26081")
	req = req.WithContext(audit.ContextWithRecorder(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "safety_review_audit_record_error") {
		t.Fatalf("body = %s, want safety_review_audit_record_error", rec.Body.String())
	}
	if len(db.execs) != 0 || len(db.queries) != 0 {
		t.Fatalf("audit failure reached safety review storage: queries=%#v execs=%#v", db.queries, db.execs)
	}
	if len(recorder.events) != 0 {
		t.Fatalf("failed audit recorder stored events = %#v, want none", recorder.events)
	}
}

func TestAdminSkillReleaseRoutesRequireReviewerPermission(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/skills", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminViewer))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	details := body["details"].(map[string]any)
	if details["required_permission"] != "skill_release:admin" {
		t.Fatalf("required_permission = %v, want skill_release:admin", details["required_permission"])
	}
}

func TestAdminSkillsUsesPrincipalTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	tenantID := "tenant_1"
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"skill_1",
		&tenantID,
		"Tenant Skill",
		"design",
		"platform",
		"medium",
		"active",
		"1.0.0",
		now,
		now,
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/skills?tenant_id=tenant_2&status=active&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminReviewer))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" || query.args[1] != 25 || query.args[2] != "active" {
		t.Fatalf("query args = %#v, want principal tenant, limit, status", query.args)
	}
}

func TestAdminSkillVersionsUsesPrincipalTenantAndProjectsReleaseGate(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	evalSuiteID := "eval_suite_1"
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"skillver_1",
		"skill_1",
		"1.0.0",
		"active",
		&evalSuiteID,
		"eval_result_1",
		"pass",
		true,
		true,
		true,
		0,
		"Release notes",
		nil,
		now,
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/skills/skill_1/versions?tenant_id=tenant_2&page_size=25", nil)
	req.SetPathValue("skill_id", "skill_1")
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminReviewer))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" || query.args[1] != "skill_1" || query.args[2] != 25 {
		t.Fatalf("query args = %#v, want tenant skill limit", query.args)
	}
	if !strings.Contains(rec.Body.String(), `"eligible_for_active": true`) || !strings.Contains(rec.Body.String(), `"last_eval_result_id": "eval_result_1"`) {
		t.Fatalf("body = %s, want release gate eval evidence", rec.Body.String())
	}
}

func TestAdminEvalResultsUsesPrincipalTenantAndSafeProjection(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"eval_result_1",
		"tenant_1",
		"eval_suite_1",
		"skill_version",
		"skillver_1",
		"1.0.0",
		"blocked",
		[]byte(`{"summary":{"total_fixtures":1,"trace_complete":true},"fixture_results":[{"fixture_id":"fx_1","api_key":"secret"}],"runner_contract":{"runner_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"storage_contract":{"table":"eval_results"}}`),
		"scripts/run_stage0_eval.py",
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		now,
		now,
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/eval/results?tenant_id=tenant_2&eval_suite_id=eval_suite_1&status=blocked&subject_type=skill_version&subject_id=skillver_1&subject_version=1.0.0&latest_only=true&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminReviewer))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" || query.args[1] != 25 {
		t.Fatalf("query args = %#v, want principal tenant and limit", query.args)
	}
	body := rec.Body.String()
	if strings.Contains(body, `"api_key":"secret"`) || !strings.Contains(body, security.Redacted) || !strings.Contains(body, `"read_without_eval_rerun": true`) {
		t.Fatalf("body = %s, want redacted stored projection without rerun", body)
	}
}

func TestAdminEvalResultArtifactUsesPrincipalTenantAndSafeAdminURL(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"eval_result_1",
		"tenant_1",
		"eval_suite_1",
		"skill_version",
		"skillver_1",
		"1.0.0",
		"pass",
		[]byte(`{"summary":{"total_fixtures":1,"trace_complete":true},"fixture_results":[{"fixture_id":"fx_1"}],"runner_contract":{"runner_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"storage_contract":{"table":"eval_results"}}`),
		"scripts/run_stage0_eval.py",
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		now,
		now,
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/eval/results/eval_result_1/artifact?tenant_id=tenant_2", nil)
	req.SetPathValue("result_id", "eval_result_1")
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminReviewer))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" || query.args[1] != "eval_result_1" {
		t.Fatalf("query args = %#v, want principal tenant and result id", query.args)
	}
	body := rec.Body.String()
	for _, want := range []string{`"direct_object_access_allowed": false`, `"audit_required": true`, `"object_key": "tenants/tenant_1/eval-results/eval_result_1.json"`, `"download_url": "/api/admin/v1/eval/results/eval_result_1/artifact`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body = %s, missing %s", body, want)
		}
	}
	if strings.Contains(body, "X-Amz-Signature") || strings.Contains(body, "secret") {
		t.Fatalf("body = %s, leaked signed object secret material", body)
	}
}

func TestAdminAnalyticsEventsRequiresAdminViewer(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/analytics/events", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	details := body["details"].(map[string]any)
	if details["required_permission"] != "analytics:read" {
		t.Fatalf("required_permission = %v, want analytics:read", details["required_permission"])
	}
}

func TestAdminAnalyticsEventsUsesPrincipalTenantAndFilters(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"analytics_1",
		"tenant_1",
		"user_1",
		"project_1",
		"workflow_1",
		"export_completed",
		"export",
		"export_1",
		[]byte(`{"format":"zip","api_key":"secret"}`),
		now,
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/analytics/events?tenant_id=tenant_2&event_name=export_completed&workflow_id=workflow_1&subject_type=export&subject_id=export_1&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_viewer")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" {
		t.Fatalf("tenant arg = %#v, want principal tenant tenant_1", query.args[0])
	}
	var body struct {
		Items []stage0.AnalyticsEvent `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if len(body.Items) != 1 || body.Items[0].ID != "analytics_1" {
		t.Fatalf("items = %#v, want analytics_1", body.Items)
	}
	if body.Items[0].Properties["api_key"] != security.Redacted {
		t.Fatalf("properties = %#v, want api_key redacted", body.Items[0].Properties)
	}
}

func TestAdminAnalyticsEventsRejectsUnsupportedFiltersBeforeQuery(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/analytics/events?event_name=tenant_2_secret_probe&workflow_id=workflow_1&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_viewer")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if len(db.queries) != 0 {
		t.Fatalf("unsupported analytics filter should fail before storage query: %#v", db.queries)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "validation_error" {
		t.Fatalf("code = %v, want validation_error", body["code"])
	}
}

func TestAdminAnalyticsReportsUsesPrincipalTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{{
		"export_completion_rate",
		[]string{"export_started", "export_completed", "export_failed"},
		[]string{"tenant_id", "workflow_id", "format"},
		true,
		"weekly",
		float64(1),
		[]byte(`{"started":1,"completed":1}`),
	}}}}}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/analytics/reports?tenant_id=tenant_2&page_size=5", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", "admin_viewer")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	query := db.queries[0]
	if query.args[0] != "tenant_1" || query.args[2] != 5 {
		t.Fatalf("query args = %#v, want principal tenant tenant_1 and limit 5", query.args)
	}
	var body struct {
		Items []stage0.AnalyticsReport `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if len(body.Items) != 1 || body.Items[0].MetricName != "export_completion_rate" {
		t.Fatalf("items = %#v, want export_completion_rate", body.Items)
	}
}

func TestLocalSessionSetsSecureHttpOnlySameSiteCookie(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"tenant_1"}`))
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	cookie := findCookie(rec.Result().Cookies(), cfg.Auth.SessionCookieName)
	if cookie == nil {
		t.Fatalf("session cookie %q was not set", cfg.Auth.SessionCookieName)
	}
	if !cookie.HttpOnly {
		t.Fatal("session cookie must be HttpOnly")
	}
	if !cookie.Secure {
		t.Fatal("session cookie must be Secure")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("SameSite = %v, want lax", cookie.SameSite)
	}
	if cookie.Path != "/" {
		t.Fatalf("Path = %q, want /", cookie.Path)
	}
	if cookie.Domain != "" {
		t.Fatalf("Domain = %q, want empty for __Host- cookie", cookie.Domain)
	}
}

func TestCreateBillingCheckoutUsesAuthenticatedPrincipal(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	provider := &fakeBillingProvider{
		session: billing.CheckoutSession{
			ID:          "cs_test_001",
			Provider:    "stripe",
			RedirectURL: "https://checkout.stripe.test/cs_test_001",
			CreatedAt:   time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC),
		},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/checkout", bytes.NewBufferString(`{"plan_id":"plan_pro"}`))
	setSameSiteCSRFHeaders(req)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(ContextWithBillingProvider(req.Context(), provider))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if provider.tenantID != "tenant_1" || provider.userID != "user_1" || provider.planID != "plan_pro" {
		t.Fatalf("provider call = tenant:%q user:%q plan:%q", provider.tenantID, provider.userID, provider.planID)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["redirect_url"] != "https://checkout.stripe.test/cs_test_001" || body["provider"] != "stripe" {
		t.Fatalf("checkout body = %#v", body)
	}
}

func TestCreateBillingCheckoutRequiresPlanID(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/checkout", bytes.NewBufferString(`{"plan_id":""}`))
	setSameSiteCSRFHeaders(req)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(ContextWithBillingProvider(req.Context(), &fakeBillingProvider{}))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestGetQuotaUsesAuthenticatedPrincipal(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	reader := &fakeBillingAccountReader{
		quota: billing.QuotaState{
			Buckets: []billing.QuotaBucketProjection{{
				ID:            "quota_1",
				LimitUnits:    100,
				UsedUnits:     25,
				ReservedUnits: 5,
				ResetsAt:      now.Add(24 * time.Hour),
			}},
			Transactions: []billing.QuotaTransactionProjection{{
				ID:        "txn_1",
				Kind:      "commit",
				Units:     4,
				Status:    "committed",
				CreatedAt: now,
			}},
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/quota", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(ContextWithBillingAccountReader(req.Context(), reader))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if reader.tenantID != "tenant_1" || reader.userID != "user_1" {
		t.Fatalf("reader principal = tenant:%q user:%q", reader.tenantID, reader.userID)
	}
	var body billing.QuotaState
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if len(body.Buckets) != 1 || body.Buckets[0].ID != "quota_1" || len(body.Transactions) != 1 || body.Transactions[0].Kind != "commit" {
		t.Fatalf("quota body = %#v", body)
	}
}

func TestGetBillingSubscriptionUsesAuthenticatedPrincipal(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	reader := &fakeBillingAccountReader{
		subscription: billing.UserSubscriptionProjection{
			ID:                 "sub_1",
			PlanID:             "plan_pro",
			Status:             billing.SubscriptionActive,
			CurrentPeriodStart: start,
			CurrentPeriodEnd:   &end,
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/subscription", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(ContextWithBillingAccountReader(req.Context(), reader))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if reader.tenantID != "tenant_1" || reader.userID != "user_1" {
		t.Fatalf("reader principal = tenant:%q user:%q", reader.tenantID, reader.userID)
	}
	var body billing.UserSubscriptionProjection
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body.ID != "sub_1" || body.PlanID != "plan_pro" || body.Status != billing.SubscriptionActive || body.CurrentPeriodEnd == nil {
		t.Fatalf("subscription body = %#v", body)
	}
}

func TestBillingReadEndpointsReturnNotImplementedWithoutReader(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	for _, path := range []string{"/api/v1/quota", "/api/v1/billing/subscription"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("X-Zenari-User-ID", "user_1")
		req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
		rec := httptest.NewRecorder()

		New(cfg, nil).Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("%s status = %d, want %d: %s", path, rec.Code, http.StatusNotImplemented, rec.Body.String())
		}
	}
}

func TestCreateBillingPortalUsesStoredCustomerReference(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	provider := &fakeBillingProvider{
		portal: billing.BillingPortalSession{
			ID:          "bps_test_001",
			Provider:    "stripe",
			RedirectURL: "https://billing.stripe.test/session/bps_test_001",
			CreatedAt:   time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC),
		},
	}
	reader := &fakeBillingAccountReader{
		subscription: billing.UserSubscriptionProjection{
			ID:                 "stripe:sub_test_001",
			Provider:           "stripe",
			ProviderRef:        "sub_test_001",
			ProviderCustomerID: "cus_test_001",
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/portal", nil)
	setSameSiteCSRFHeaders(req)
	req.Header.Set("Idempotency-Key", "portal_1")
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(ContextWithBillingProvider(ContextWithBillingAccountReader(req.Context(), reader), provider))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if provider.portalTenantID != "tenant_1" || provider.portalUserID != "user_1" || provider.portalCustomerID != "cus_test_001" {
		t.Fatalf("portal call = tenant:%q user:%q customer:%q", provider.portalTenantID, provider.portalUserID, provider.portalCustomerID)
	}
	var body billing.BillingPortalSession
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body.RedirectURL != "https://billing.stripe.test/session/bps_test_001" || body.Provider != "stripe" {
		t.Fatalf("portal body = %#v", body)
	}
}

func TestCancelBillingSubscriptionUsesStoredProviderReference(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	provider := &fakeBillingProvider{
		cancelled: billing.SubscriptionCancellation{
			ID:                "sub_test_001",
			Provider:          "stripe",
			Status:            billing.SubscriptionActive,
			CancelAtPeriodEnd: true,
			UpdatedAt:         time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC),
		},
	}
	reader := &fakeBillingAccountReader{
		subscription: billing.UserSubscriptionProjection{
			ID:          "stripe:sub_test_001",
			Provider:    "stripe",
			ProviderRef: "sub_test_001",
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/subscription/cancel", nil)
	setSameSiteCSRFHeaders(req)
	req.Header.Set("Idempotency-Key", "cancel_1")
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(ContextWithBillingProvider(ContextWithBillingAccountReader(req.Context(), reader), provider))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if provider.cancelSubscriptionID != "sub_test_001" {
		t.Fatalf("cancel subscription id = %q", provider.cancelSubscriptionID)
	}
	var body billing.SubscriptionCancellation
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body.ID != "sub_test_001" || !body.CancelAtPeriodEnd {
		t.Fatalf("cancel body = %#v", body)
	}
}

func TestListBillingInvoicesUsesStoredProviderReference(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	provider := &fakeBillingProvider{
		invoices: billing.BillingInvoicePage{Items: []billing.BillingInvoice{{
			ID:              "in_test_001",
			Provider:        "stripe",
			Status:          "paid",
			Currency:        "USD",
			AmountPaidCents: 2900,
			InvoiceURL:      "https://invoice.stripe.test/in_test_001",
			ReceiptURL:      "https://invoice.stripe.test/in_test_001.pdf",
			CreatedAt:       time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC),
		}}},
	}
	reader := &fakeBillingAccountReader{
		subscription: billing.UserSubscriptionProjection{
			ID:          "stripe:sub_test_001",
			Provider:    "stripe",
			ProviderRef: "sub_test_001",
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/invoices", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(ContextWithBillingProvider(ContextWithBillingAccountReader(req.Context(), reader), provider))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if provider.invoiceSubscriptionID != "sub_test_001" {
		t.Fatalf("invoice subscription id = %q", provider.invoiceSubscriptionID)
	}
	var body billing.BillingInvoicePage
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if len(body.Items) != 1 || body.Items[0].ID != "in_test_001" || body.Items[0].InvoiceURL == "" || body.Items[0].ReceiptURL == "" {
		t.Fatalf("invoice body = %#v", body)
	}
}

func TestBillingWebhookBypassesBrowserCSRFAndUsesSignatureProvider(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	provider := &fakeBillingProvider{}
	payload := `{"id":"evt_test_001"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/webhook", bytes.NewBufferString(payload))
	req.Header.Set("Stripe-Signature", "t=1782036000,v1=abc123")
	req = req.WithContext(ContextWithBillingProvider(req.Context(), provider))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if string(provider.webhookPayload) != payload || provider.webhookSignature != "t=1782036000,v1=abc123" {
		t.Fatalf("webhook provider call payload=%q signature=%q", string(provider.webhookPayload), provider.webhookSignature)
	}
}

func TestBillingWebhookRejectsProviderError(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/billing/webhook", bytes.NewBufferString(`{"id":"evt_bad"}`))
	req.Header.Set("Stripe-Signature", "bad")
	req = req.WithContext(ContextWithBillingProvider(req.Context(), &fakeBillingProvider{webhookErr: errors.New("signature failed")}))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestTeamSeatUsageUsesPrincipalTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	service := &fakeTeamService{
		usage: team.SeatUsage{
			TeamID:         "team_1",
			TenantID:       "tenant_1",
			PlanID:         "pro",
			SeatLimit:      3,
			ActiveSeats:    1,
			InvitedSeats:   1,
			BillableSeats:  2,
			AvailableSeats: 1,
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/teams/team_1/seat-usage", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(ContextWithTeamService(req.Context(), service))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !service.getSeatCalled || service.getSeatTenantID != "tenant_1" || service.getSeatTeamID != "team_1" {
		t.Fatalf("seat usage call tenant=%q team=%q called=%v", service.getSeatTenantID, service.getSeatTeamID, service.getSeatCalled)
	}
	var body team.SeatUsage
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body.BillableSeats != 2 || body.AvailableSeats != 1 {
		t.Fatalf("seat usage body = %#v", body)
	}
}

func TestTeamSeatEntitlementParsesAdditionalSeats(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	service := &fakeTeamService{
		decision: team.EntitlementDecision{
			Allowed: true,
			Reason:  "ok",
			Usage: team.SeatUsage{
				TeamID:         "team_1",
				TenantID:       "tenant_1",
				SeatLimit:      5,
				BillableSeats:  2,
				AvailableSeats: 3,
			},
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/teams/team_1/seat-entitlement?additional_seats=2", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(ContextWithTeamService(req.Context(), service))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !service.entitlementCalled || service.entitlementTenantID != "tenant_1" || service.entitlementTeamID != "team_1" || service.additionalSeats != 2 {
		t.Fatalf("entitlement call tenant=%q team=%q seats=%d called=%v", service.entitlementTenantID, service.entitlementTeamID, service.additionalSeats, service.entitlementCalled)
	}
	var body team.EntitlementDecision
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if !body.Allowed || body.Reason != "ok" {
		t.Fatalf("entitlement body = %#v", body)
	}
}

func TestAcceptTeamInviteCallsServiceWithPrincipalTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	service := &fakeTeamService{
		acceptResult: team.Member{
			ID:       "team_member:team_1:user_2",
			TeamID:   "team_1",
			TenantID: "tenant_1",
			UserID:   "user_2",
			Email:    "member@example.com",
			Role:     team.RoleMember,
			Status:   team.MemberActive,
		},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/teams/team_1/invites/invite_1/accept", nil)
	req.Header.Set("X-Zenari-User-ID", "user_2")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("Idempotency-Key", "accept-invite-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithTeamService(req.Context(), service))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !service.acceptCalled ||
		service.acceptTenantID != "tenant_1" ||
		service.acceptTeamID != "team_1" ||
		service.acceptInviteID != "invite_1" ||
		service.acceptUserID != "user_2" {
		t.Fatalf("accept invite call = tenant=%q team=%q invite=%q user=%q called=%v", service.acceptTenantID, service.acceptTeamID, service.acceptInviteID, service.acceptUserID, service.acceptCalled)
	}
}

func TestAcceptTeamInviteRequiresIdempotencyBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	service := &fakeTeamService{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/teams/team_1/invites/invite_1/accept", nil)
	req.Header.Set("X-Zenari-User-ID", "user_2")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithTeamService(req.Context(), service))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if service.called() {
		t.Fatal("team service was called without idempotency key")
	}
	if !strings.Contains(rec.Body.String(), "idempotency_key_required") {
		t.Fatalf("body = %s, want idempotency_key_required", rec.Body.String())
	}
}

func TestAcceptTeamInviteSyncsSeatBillingWhenSyncerConnected(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	service := &fakeTeamService{
		acceptResult: team.Member{
			ID:       "team_member:team_1:user_2",
			TeamID:   "team_1",
			TenantID: "tenant_1",
			UserID:   "user_2",
			Email:    "member@example.com",
			Role:     team.RoleMember,
			Status:   team.MemberActive,
		},
		usage: team.SeatUsage{
			TeamID:         "team_1",
			TenantID:       "tenant_1",
			PlanID:         "pro",
			SeatLimit:      4,
			ActiveSeats:    3,
			InvitedSeats:   0,
			BillableSeats:  3,
			AvailableSeats: 1,
		},
	}
	syncer := &fakeTeamSeatBillingSyncer{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/teams/team_1/invites/invite_1/accept", nil)
	req.Header.Set("X-Zenari-User-ID", "user_2")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("Idempotency-Key", "accept-invite-seat-sync-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithTeamSeatBillingSyncer(ContextWithTeamService(req.Context(), service), syncer))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !syncer.called ||
		syncer.input.Operation != "team.invite.accept" ||
		syncer.input.IdempotencyKey != "accept-invite-seat-sync-1" ||
		syncer.input.Usage.BillableSeats != 3 {
		t.Fatalf("sync input = %#v called=%v", syncer.input, syncer.called)
	}
}

func TestAdminTeamCreateRecordsAuditAndCallsService(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	service := &fakeTeamService{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/teams", bytes.NewBufferString(`{"id":"team_1","name":"Design Ops","plan_id":"pro","seat_limit":4,"owner_user_id":"owner_1","owner_email":"owner@example.com","rationale":"create paid team for launch pilot","metadata":{"ticket_id":"ticket_1"}}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-create-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithTeamService(audit.ContextWithRecorder(req.Context(), recorder), service))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !service.createCalled || service.createTeam.TenantID != "tenant_1" || service.createTeam.ID != "team_1" || service.createTeam.SeatLimit != 4 {
		t.Fatalf("create team input = %#v called=%v", service.createTeam, service.createCalled)
	}
	if service.createOwner.UserID != "owner_1" || service.createOwner.Email != "owner@example.com" {
		t.Fatalf("create owner input = %#v", service.createOwner)
	}
	if len(recorder.events) != 2 {
		t.Fatalf("audit events = %d, want request and completion", len(recorder.events))
	}
	if recorder.events[0].Action != "team.create.requested" || recorder.events[1].Action != "team.create" {
		t.Fatalf("audit actions = %q/%q", recorder.events[0].Action, recorder.events[1].Action)
	}
	seatLimit := recorder.events[0].Metadata["seat_limit"]
	if recorder.events[0].Resource != "teams/team_1" || (seatLimit != float64(4) && seatLimit != 4) {
		t.Fatalf("request audit event = %#v", recorder.events[0])
	}
}

func TestAdminTeamInviteRecordsAuditAndNormalizesPayload(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	service := &fakeTeamService{
		usage: team.SeatUsage{
			TeamID:         "team_1",
			TenantID:       "tenant_1",
			PlanID:         "pro",
			SeatLimit:      4,
			ActiveSeats:    1,
			InvitedSeats:   1,
			BillableSeats:  2,
			AvailableSeats: 2,
		},
	}
	syncer := &fakeTeamSeatBillingSyncer{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/teams/team_1/invites", bytes.NewBufferString(`{"email":" Member@Example.COM ","role":"member","rationale":"reserve a billable launch seat"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-invite-1")
	setSameSiteCSRFHeaders(req)
	ctx := audit.ContextWithRecorder(req.Context(), recorder)
	ctx = ContextWithTeamService(ctx, service)
	ctx = ContextWithTeamSeatBillingSyncer(ctx, syncer)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !service.inviteCalled ||
		service.invite.TenantID != "tenant_1" ||
		service.invite.TeamID != "team_1" ||
		service.invite.Email != "member@example.com" ||
		service.invite.IdempotencyKey != "team-invite-1" ||
		service.invite.InvitedBy != "admin_operator_1" {
		t.Fatalf("invite input = %#v called=%v", service.invite, service.inviteCalled)
	}
	if len(recorder.events) != 2 || recorder.events[0].Action != "team.invite.requested" || recorder.events[1].Action != "team.invite" {
		t.Fatalf("audit events = %#v", recorder.events)
	}
}

func TestAdminTeamInviteSyncsStripeSeatQuantityAfterMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	service := &fakeTeamService{
		usage: team.SeatUsage{
			TeamID:         "team_1",
			TenantID:       "tenant_1",
			PlanID:         "pro",
			SeatLimit:      5,
			ActiveSeats:    2,
			InvitedSeats:   1,
			BillableSeats:  3,
			AvailableSeats: 2,
		},
	}
	syncer := &fakeTeamSeatBillingSyncer{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/teams/team_1/invites", bytes.NewBufferString(`{"email":"member@example.com","role":"member","rationale":"reserve a Stripe billed launch seat"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-invite-seat-sync-1")
	setSameSiteCSRFHeaders(req)
	ctx := audit.ContextWithRecorder(req.Context(), recorder)
	ctx = ContextWithTeamService(ctx, service)
	ctx = ContextWithTeamSeatBillingSyncer(ctx, syncer)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !syncer.called || syncer.input.TenantID != "tenant_1" || syncer.input.TeamID != "team_1" || syncer.input.Operation != "team.invite" || syncer.input.Usage.BillableSeats != 3 {
		t.Fatalf("sync input = %#v called=%v", syncer.input, syncer.called)
	}
	if !service.getSeatCalled {
		t.Fatal("seat usage was not loaded after team mutation")
	}
	if len(recorder.events) != 2 || recorder.events[1].Metadata["seat_billing_status"] != "synced" {
		t.Fatalf("audit events = %#v", recorder.events)
	}
}

func TestAdminTeamInviteSeatSyncFailureReturnsBadGatewayAndRecordsFailureAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	service := &fakeTeamService{
		usage: team.SeatUsage{
			TeamID:         "team_1",
			TenantID:       "tenant_1",
			PlanID:         "pro",
			SeatLimit:      5,
			ActiveSeats:    2,
			InvitedSeats:   1,
			BillableSeats:  3,
			AvailableSeats: 2,
		},
	}
	syncer := &fakeTeamSeatBillingSyncer{err: errors.New("stripe key " + serverStripeSecretFixture + " rejected")}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/teams/team_1/invites", bytes.NewBufferString(`{"email":"member@example.com","role":"member","rationale":"reserve a Stripe billed launch seat"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-invite-seat-sync-2")
	setSameSiteCSRFHeaders(req)
	ctx := audit.ContextWithRecorder(req.Context(), recorder)
	ctx = ContextWithTeamService(ctx, service)
	ctx = ContextWithTeamSeatBillingSyncer(ctx, syncer)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadGateway, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "team_seat_billing_sync_failed") {
		t.Fatalf("body = %s, want seat sync error", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), serverStripeSecretFixture) {
		t.Fatalf("response leaked raw secret: %s", rec.Body.String())
	}
	if len(recorder.events) != 2 || recorder.events[1].Action != "team.invite.failed" {
		t.Fatalf("audit events = %#v", recorder.events)
	}
}

func TestAdminTeamRemoveMapsDeniedAndRecordsFailureAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	service := &fakeTeamService{removeErr: team.ErrMemberRemovalDenied}
	syncer := &fakeTeamSeatBillingSyncer{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/teams/team_1/members/member_owner/remove", bytes.NewBufferString(`{"rationale":"remove stale owner seat"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-remove-1")
	setSameSiteCSRFHeaders(req)
	ctx := audit.ContextWithRecorder(req.Context(), recorder)
	ctx = ContextWithTeamService(ctx, service)
	ctx = ContextWithTeamSeatBillingSyncer(ctx, syncer)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusConflict, rec.Body.String())
	}
	if !service.removeCalled || service.removeTenantID != "tenant_1" || service.removeTeamID != "team_1" || service.removeMemberID != "member_owner" {
		t.Fatalf("remove input tenant=%q team=%q member=%q called=%v", service.removeTenantID, service.removeTeamID, service.removeMemberID, service.removeCalled)
	}
	if len(recorder.events) != 2 || recorder.events[0].Action != "team.member.remove.requested" || recorder.events[1].Action != "team.member.remove.failed" {
		t.Fatalf("audit events = %#v", recorder.events)
	}
}

func TestAdminTeamSeatMutationsRequireBillingSyncBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	service := &fakeTeamService{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/teams/team_1/members/member_1/remove", bytes.NewBufferString(`{"rationale":"remove stale paid seat"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-remove-requires-sync-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithTeamService(audit.ContextWithRecorder(req.Context(), recorder), service))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotImplemented, rec.Body.String())
	}
	if service.called() || len(recorder.events) != 0 {
		t.Fatalf("service/audit reached unexpectedly: called=%v audit=%d", service.called(), len(recorder.events))
	}
	if !strings.Contains(rec.Body.String(), "team_seat_billing_sync_not_connected") {
		t.Fatalf("body = %s, want sync connection error", rec.Body.String())
	}
}

func TestAdminTeamOpsRequireAuditBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	service := &fakeTeamService{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/teams", bytes.NewBufferString(`{"id":"team_1","name":"Design Ops","plan_id":"pro","seat_limit":4,"owner_user_id":"owner_1","owner_email":"owner@example.com","rationale":"create paid team"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-create-2")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithTeamService(req.Context(), service))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotImplemented, rec.Body.String())
	}
	if service.called() {
		t.Fatal("team service was called without audit recorder")
	}
}

func TestAdminTeamOpsRejectInsufficientRoleBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	service := &fakeTeamService{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/teams", bytes.NewBufferString(`{"id":"team_1","name":"Design Ops","plan_id":"pro","seat_limit":4,"owner_user_id":"owner_1","owner_email":"owner@example.com","rationale":"create paid team"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminViewer))
	req.Header.Set("Idempotency-Key", "team-create-3")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithTeamService(audit.ContextWithRecorder(req.Context(), recorder), service))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	if service.called() || len(recorder.events) != 0 {
		t.Fatalf("service/audit reached unexpectedly: called=%v audit=%d", service.called(), len(recorder.events))
	}
}

func TestAdminTeamSeatUsageUsesAdminTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	service := &fakeTeamService{
		usage: team.SeatUsage{
			TeamID:         "team_1",
			TenantID:       "tenant_1",
			PlanID:         "pro",
			SeatLimit:      5,
			ActiveSeats:    2,
			InvitedSeats:   1,
			BillableSeats:  3,
			AvailableSeats: 2,
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/team-seat-ops/team_1/seat-usage", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req = req.WithContext(ContextWithTeamService(req.Context(), service))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !service.getSeatCalled || service.getSeatTenantID != "tenant_1" || service.getSeatTeamID != "team_1" {
		t.Fatalf("admin seat usage call tenant=%q team=%q called=%v", service.getSeatTenantID, service.getSeatTeamID, service.getSeatCalled)
	}
}

func TestAdminTeamBillingLinkReadUsesAdminTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	manager := &fakeTeamSeatBillingManager{
		link: billing.TeamBillingLink{
			TenantID:                   "tenant_1",
			TeamID:                     "team_1",
			Provider:                   "stripe",
			ProviderSubscriptionID:     "sub_test_001",
			ProviderSubscriptionItemID: "si_test_team_seats",
			PriceID:                    "price_team_seat",
			ProrationBehavior:          "always_invoice",
			Status:                     "active",
			Metadata:                   map[string]any{"ticket_id": "ticket_1"},
			CreatedAt:                  time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC),
			UpdatedAt:                  time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC),
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/team-seat-ops/team_1/billing-link", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req = req.WithContext(ContextWithTeamSeatBillingManager(req.Context(), manager))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !manager.getLinkCalled || manager.getLinkTenantID != "tenant_1" || manager.getLinkTeamID != "team_1" {
		t.Fatalf("get link tenant=%q team=%q called=%v", manager.getLinkTenantID, manager.getLinkTeamID, manager.getLinkCalled)
	}
	var body billing.TeamBillingLink
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body.ProviderSubscriptionItemID != "si_test_team_seats" || body.ProrationBehavior != "always_invoice" {
		t.Fatalf("body = %#v", body)
	}
}

func TestAdminTeamBillingLinkUpsertRequiresAuditBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	manager := &fakeTeamSeatBillingManager{}
	req := httptest.NewRequest(http.MethodPut, "/api/admin/v1/team-seat-ops/team_1/billing-link", bytes.NewBufferString(`{"provider_subscription_id":"sub_test_001","provider_subscription_item_id":"si_test_team_seats","rationale":"bind team seats to Stripe item"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-billing-link-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithTeamSeatBillingManager(req.Context(), manager))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotImplemented, rec.Body.String())
	}
	if manager.upsertCalled {
		t.Fatal("billing link manager was called without audit recorder")
	}
}

func TestAdminTeamBillingLinkUpsertRecordsAuditAndRedactsSecrets(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	manager := &fakeTeamSeatBillingManager{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPut, "/api/admin/v1/team-seat-ops/team_1/billing-link", bytes.NewBufferString(`{"provider":"stripe","provider_subscription_id":"sub_test_001","provider_subscription_item_id":"si_test_team_seats","price_id":"price_team_seat","proration_behavior":"always_invoice","status":"active","rationale":"bind team seats to Stripe item","metadata":{"ticket_id":"ticket_1","stripe_key":"`+serverStripeSecretFixture+`"}}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-billing-link-2")
	setSameSiteCSRFHeaders(req)
	ctx := audit.ContextWithRecorder(req.Context(), recorder)
	ctx = ContextWithTeamSeatBillingManager(ctx, manager)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !manager.upsertCalled ||
		manager.upsertInput.TenantID != "tenant_1" ||
		manager.upsertInput.TeamID != "team_1" ||
		manager.upsertInput.ActorID != "admin_operator_1" ||
		manager.upsertInput.IdempotencyKey != "team-billing-link-2" ||
		manager.upsertInput.ProrationBehavior != "always_invoice" {
		t.Fatalf("upsert input = %#v called=%v", manager.upsertInput, manager.upsertCalled)
	}
	if len(recorder.events) != 2 || recorder.events[0].Action != "team.billing_link.requested" || recorder.events[1].Action != "team.billing_link" {
		t.Fatalf("audit events = %#v", recorder.events)
	}
	for _, event := range recorder.events {
		data, _ := json.Marshal(event.Metadata)
		if strings.Contains(string(data), serverStripeSecretFixture) {
			t.Fatalf("audit leaked raw secret: %s", string(data))
		}
	}
}

func TestAdminTeamBillingLinkUpsertFailureRecordsFailureAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	manager := &fakeTeamSeatBillingManager{upsertErr: errors.New("stripe key " + serverStripeSecretFixture + " rejected")}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPut, "/api/admin/v1/team-seat-ops/team_1/billing-link", bytes.NewBufferString(`{"provider_subscription_id":"sub_test_001","provider_subscription_item_id":"si_test_team_seats","rationale":"bind team seats to Stripe item"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "team-billing-link-3")
	setSameSiteCSRFHeaders(req)
	ctx := audit.ContextWithRecorder(req.Context(), recorder)
	ctx = ContextWithTeamSeatBillingManager(ctx, manager)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), serverStripeSecretFixture) {
		t.Fatalf("response leaked raw secret: %s", rec.Body.String())
	}
	if len(recorder.events) != 2 || recorder.events[1].Action != "team.billing_link.failed" {
		t.Fatalf("audit events = %#v", recorder.events)
	}
}

func TestAdminTeamSeatBillingSyncsListsHistory(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	manager := &fakeTeamSeatBillingManager{
		syncPage: billing.TeamSeatSyncPage{Items: []billing.TeamSeatSyncResult{{
			ID:                         "team_seat_sync_1",
			TenantID:                   "tenant_1",
			TeamID:                     "team_1",
			Provider:                   "stripe",
			ProviderSubscriptionID:     "sub_test_001",
			ProviderSubscriptionItemID: "si_test_team_seats",
			RequestedQuantity:          3,
			SyncedQuantity:             3,
			ProrationBehavior:          "create_prorations",
			Status:                     "synced",
			Operation:                  "team.invite",
			IdempotencyKey:             "team-invite-1",
			CreatedAt:                  time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC),
		}}},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/team-seat-ops/team_1/seat-syncs?page_size=5", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req = req.WithContext(ContextWithTeamSeatBillingManager(req.Context(), manager))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !manager.listSyncsCalled || manager.listSyncsTenantID != "tenant_1" || manager.listSyncsTeamID != "team_1" || manager.listSyncsLimit != 5 {
		t.Fatalf("list syncs tenant=%q team=%q limit=%d called=%v", manager.listSyncsTenantID, manager.listSyncsTeamID, manager.listSyncsLimit, manager.listSyncsCalled)
	}
	var body billing.TeamSeatSyncPage
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if len(body.Items) != 1 || body.Items[0].ID != "team_seat_sync_1" {
		t.Fatalf("body = %#v", body)
	}
}

func TestAdminBillingManualCreditRecordsAuditAndCallsOperator(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	operator := &fakeAdminBillingOperator{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/billing/manual-credit", bytes.NewBufferString(`{"target_user_id":"user_1","bucket_id":"bucket_1","units":75,"rationale":"restore quota after failed Stripe adjustment","metadata":{"ticket_id":"ticket_1","stripe_token":"`+serverStripeSecretFixture+`"}}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "manual-credit-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithBillingAdminOperator(audit.ContextWithRecorder(req.Context(), recorder), operator))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !operator.manualCreditCalled {
		t.Fatal("manual credit operator was not called")
	}
	if operator.manualCreditInput.TenantID != "tenant_1" ||
		operator.manualCreditInput.ActorID != "admin_operator_1" ||
		operator.manualCreditInput.TargetUserID != "user_1" ||
		operator.manualCreditInput.BucketID != "bucket_1" ||
		operator.manualCreditInput.Units != 75 ||
		operator.manualCreditInput.IdempotencyKey != "manual-credit-1" {
		t.Fatalf("manual credit input = %#v", operator.manualCreditInput)
	}
	if len(recorder.events) != 2 {
		t.Fatalf("audit events = %d, want request and completion", len(recorder.events))
	}
	if recorder.events[0].Action != "billing.manual_credit.requested" || recorder.events[1].Action != "billing.manual_credit" {
		t.Fatalf("audit actions = %q/%q", recorder.events[0].Action, recorder.events[1].Action)
	}
	if recorder.events[0].TenantID != "tenant_1" || recorder.events[0].ActorID != "admin_operator_1" || recorder.events[0].Resource != "billing/user_1" {
		t.Fatalf("request audit event = %#v", recorder.events[0])
	}
	if recorder.events[0].Metadata["stripe_token"] != security.Redacted {
		t.Fatalf("audit metadata = %#v, want redacted metadata token", recorder.events[0].Metadata)
	}
	if strings.Contains(rec.Body.String(), serverStripeSecretFixture) {
		t.Fatalf("response leaked raw secret: %s", rec.Body.String())
	}
}

func TestAdminBillingOpsRequireIdempotencyBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	operator := &fakeAdminBillingOperator{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/billing/manual-credit", bytes.NewBufferString(`{"target_user_id":"user_1","bucket_id":"bucket_1","units":75,"rationale":"restore quota"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithBillingAdminOperator(audit.ContextWithRecorder(req.Context(), recorder), operator))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if operator.called() || len(recorder.events) != 0 {
		t.Fatalf("operator/audit reached unexpectedly: called=%v audit=%d", operator.called(), len(recorder.events))
	}
	if !strings.Contains(rec.Body.String(), "idempotency_key_required") {
		t.Fatalf("body = %s, want idempotency_key_required", rec.Body.String())
	}
}

func TestAdminBillingOpsRejectInsufficientRoleBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	operator := &fakeAdminBillingOperator{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/billing/manual-credit", bytes.NewBufferString(`{"target_user_id":"user_1","bucket_id":"bucket_1","units":75,"rationale":"restore quota"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminViewer))
	req.Header.Set("Idempotency-Key", "manual-credit-2")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithBillingAdminOperator(audit.ContextWithRecorder(req.Context(), recorder), operator))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	if operator.called() || len(recorder.events) != 0 {
		t.Fatalf("operator/audit reached unexpectedly: called=%v audit=%d", operator.called(), len(recorder.events))
	}
}

func TestAdminBillingOpsRequireAuditBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	operator := &fakeAdminBillingOperator{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/billing/manual-credit", bytes.NewBufferString(`{"target_user_id":"user_1","bucket_id":"bucket_1","units":75,"rationale":"restore quota"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req.Header.Set("Idempotency-Key", "manual-credit-3")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(ContextWithBillingAdminOperator(req.Context(), operator))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotImplemented, rec.Body.String())
	}
	if operator.called() {
		t.Fatal("operator was called without audit recorder")
	}
}

func TestAdminBillingControlPlaneRoutesCallExpectedOperator(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	cases := []struct {
		name      string
		path      string
		body      string
		wantCall  string
		wantAudit string
	}{
		{
			name:      "refund note",
			path:      "/api/admin/v1/billing/refund-note",
			body:      `{"target_user_id":"user_1","subscription_id":"sub_1","provider":"stripe","provider_ref":"sub_test_001","note":"refund reviewed in Stripe dashboard","rationale":"customer support refund review"}`,
			wantCall:  "refund",
			wantAudit: "billing.refund_note",
		},
		{
			name:      "subscription sync",
			path:      "/api/admin/v1/billing/subscription-sync",
			body:      `{"target_user_id":"user_1","subscription_id":"sub_1","provider":"stripe","provider_ref":"sub_test_001","rationale":"reconcile webhook replay"}`,
			wantCall:  "sync",
			wantAudit: "billing.subscription_sync",
		},
		{
			name:      "account lock",
			path:      "/api/admin/v1/billing/account-lock",
			body:      `{"target_user_id":"user_1","locked":true,"rationale":"billing abuse investigation"}`,
			wantCall:  "lock",
			wantAudit: "billing.account_lock",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			operator := &fakeAdminBillingOperator{}
			recorder := &fakeAuditRecorder{}
			req := httptest.NewRequest(http.MethodPost, tc.path, bytes.NewBufferString(tc.body))
			req.Header.Set("X-Zenari-User-ID", "admin_operator_1")
			req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
			req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
			req.Header.Set("Idempotency-Key", tc.wantCall+"-1")
			setSameSiteCSRFHeaders(req)
			req = req.WithContext(ContextWithBillingAdminOperator(audit.ContextWithRecorder(req.Context(), recorder), operator))
			rec := httptest.NewRecorder()

			New(cfg, nil).Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusCreated {
				t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
			}
			if operator.lastCall != tc.wantCall {
				t.Fatalf("operator call = %q, want %q", operator.lastCall, tc.wantCall)
			}
			if len(recorder.events) != 2 || recorder.events[0].Action != tc.wantAudit+".requested" || recorder.events[1].Action != tc.wantAudit {
				t.Fatalf("audit events = %#v", recorder.events)
			}
		})
	}
}

func TestAdminProviderRegistryListsRegistryWithoutRawSecrets(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	reader := fakeProviderRegistryReader{page: provider.RegistryPage{
		Items: []provider.AdminRegistryProjection{{
			ProviderID:  "zenari-image-sandbox",
			DisplayName: "Zenari image sandbox",
			Mode:        provider.RegistryModeSandbox,
			Status:      provider.RegistryStatusEnabled,
			SecretRef:   "secrets/provider/zenari-image-sandbox",
			Capabilities: []provider.Capability{{
				ProviderID:     "zenari-image-sandbox",
				ModelID:        "image-fast-v1",
				Endpoints:      []string{"image.generate"},
				InputTypes:     []string{"prompt"},
				OutputTypes:    []string{"image"},
				MaxCostUnits:   8,
				SupportsBatch:  true,
				MaxBatchSize:   20,
				SupportsSeed:   true,
				SupportsCancel: true,
			}},
			Routing: provider.RoutingPolicy{
				Weight:         100,
				MaxConcurrency: 4,
			},
			Health: provider.HealthSnapshot{
				Available:     true,
				LatencyMS:     420,
				LastCheckedAt: now,
			},
			SecretPresent: true,
			UpdatedAt:     now,
		}},
		TotalCount: 1,
	}}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/providers/registry?page_size=200", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req = req.WithContext(provider.ContextWithRegistryReader(req.Context(), &reader))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if reader.limit != 100 {
		t.Fatalf("reader limit = %d, want page size clamp to 100", reader.limit)
	}
	var body struct {
		Items []struct {
			ProviderID    string `json:"provider_id"`
			SecretRef     string `json:"secret_ref"`
			SecretPresent bool   `json:"secret_present"`
		} `json:"items"`
		TotalCount int `json:"total_count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body.TotalCount != 1 || len(body.Items) != 1 {
		t.Fatalf("body = %#v, want one provider", body)
	}
	if body.Items[0].ProviderID != "zenari-image-sandbox" || body.Items[0].SecretRef != "secrets/provider/zenari-image-sandbox" || !body.Items[0].SecretPresent {
		t.Fatalf("provider body = %#v, want safe secret ref projection", body.Items[0])
	}
	if strings.Contains(rec.Body.String(), "sk-proj-") {
		t.Fatalf("registry response leaked raw secret: %s", rec.Body.String())
	}
}

func TestAdminProviderRegistryRejectsInsufficientRoleBeforeReader(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/providers/registry", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_viewer")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminViewer))
	req = req.WithContext(provider.ContextWithRegistryReader(req.Context(), &reader))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	if reader.called {
		t.Fatal("provider registry reader was called before RBAC rejection")
	}
}

func TestAdminProviderRegistryRejectsRawSecretProjection(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{page: provider.RegistryPage{
		Items: []provider.AdminRegistryProjection{{
			ProviderID:  "unsafe-provider",
			DisplayName: "Unsafe provider",
			Mode:        provider.RegistryModeSandbox,
			Status:      provider.RegistryStatusEnabled,
			SecretRef:   serverProviderSecretFixture,
			Capabilities: []provider.Capability{{
				ProviderID:   "unsafe-provider",
				ModelID:      "unsafe-v1",
				Endpoints:    []string{"image.generate"},
				InputTypes:   []string{"prompt"},
				OutputTypes:  []string{"image"},
				MaxCostUnits: 1,
			}},
			SecretPresent: true,
		}},
		TotalCount: 1,
	}}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/providers/registry", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req = req.WithContext(provider.ContextWithRegistryReader(req.Context(), &reader))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusInternalServerError, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), serverProviderSecretFixture) {
		t.Fatalf("error response leaked raw secret: %s", rec.Body.String())
	}
}

func TestAdminProviderStrategyGroupsListAndCreate(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	group := provider.StrategyGroup{
		GroupID:             "image-generation-default",
		DisplayName:         "Image generation default",
		ToolType:            "generate",
		Status:              provider.RegistryStatusEnabled,
		SelectionPolicy:     provider.StrategySelectionWeighted,
		FallbackProviderIDs: []string{"dev"},
		Members: []provider.StrategyGroupMember{{
			ProviderID:     "zenari-image-sandbox",
			Weight:         90,
			CanaryPercent:  10,
			MaxConcurrency: 4,
			FallbackRank:   0,
			Enabled:        true,
		}},
		Metadata:  map[string]string{"routing_surface": "batch_generation"},
		CreatedAt: now,
		UpdatedAt: now,
	}
	reader := fakeProviderRegistryReader{
		strategyGroupPage: provider.StrategyGroupPage{Items: []provider.StrategyGroup{group}, TotalCount: 1},
		strategyCreateResult: provider.StrategyGroupCreateResult{
			Created: group,
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/providers/strategy-groups?page_size=200", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req = req.WithContext(provider.ContextWithRegistryReader(req.Context(), &reader))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if reader.strategyLimit != 100 {
		t.Fatalf("strategy limit = %d, want clamp to 100", reader.strategyLimit)
	}
	if strings.Contains(rec.Body.String(), "sk-proj-") || !strings.Contains(rec.Body.String(), "image-generation-default") {
		t.Fatalf("strategy group list response = %s", rec.Body.String())
	}

	recorder := &fakeAuditRecorder{}
	body := `{
		"group_id":"image-generation-default",
		"display_name":"Image generation default",
		"tool_type":"generate",
		"status":"enabled",
		"selection_policy":"weighted",
		"fallback_provider_ids":["dev"],
		"members":[{
			"provider_id":"zenari-image-sandbox",
			"weight":90,
			"canary_percent":10,
			"max_concurrency":4,
			"fallback_rank":0,
			"enabled":true
		}],
		"metadata":{"routing_surface":"batch_generation"},
		"rationale":"create default image generation strategy group"
	}`
	req = httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/strategy-groups", bytes.NewBufferString(body))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-strategy-group-create-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec = httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !reader.strategyCreateCalled || reader.strategyCreate.GroupID != "image-generation-default" || len(reader.strategyCreate.Members) != 1 {
		t.Fatalf("strategy create = %#v called=%v", reader.strategyCreate, reader.strategyCreateCalled)
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Action != "provider.strategy_group.create" || event.Resource != "provider-strategy-groups/image-generation-default" || event.ActorID != "admin_1" {
		t.Fatalf("audit event = %#v", event)
	}
	if event.Metadata["rationale"] != "create default image generation strategy group" || event.Metadata["member_count"] != 1 {
		t.Fatalf("audit metadata = %#v", event.Metadata)
	}
}

func TestAdminProviderStrategyGroupUpdateRequiresIdempotencyAndRationale(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/strategy-groups/image-generation-default", bytes.NewBufferString(`{"status":"kill_switch","selection_policy":"failover","tool_type":"generate","members":[{"provider_id":"dev","weight":100,"enabled":true}],"rationale":""}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing idempotency status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.strategyUpdateCalled || len(recorder.events) != 0 {
		t.Fatalf("update/audit reached unexpectedly: update=%v audit=%d", reader.strategyUpdateCalled, len(recorder.events))
	}

	req = httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/strategy-groups/image-generation-default", bytes.NewBufferString(`{"status":"kill_switch","selection_policy":"failover","tool_type":"generate","members":[{"provider_id":"dev","weight":100,"enabled":true}],"rationale":""}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-strategy-group-update-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec = httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing rationale status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.strategyUpdateCalled || len(recorder.events) != 0 {
		t.Fatalf("update/audit reached unexpectedly after missing rationale: update=%v audit=%d", reader.strategyUpdateCalled, len(recorder.events))
	}
}

func TestAdminProviderStrategyGroupUpdateRecordsAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	before := provider.StrategyGroup{
		GroupID:         "image-generation-default",
		DisplayName:     "Image generation default",
		ToolType:        "generate",
		Status:          provider.RegistryStatusEnabled,
		SelectionPolicy: provider.StrategySelectionWeighted,
		Members: []provider.StrategyGroupMember{{
			ProviderID:     "zenari-image-sandbox",
			Weight:         90,
			MaxConcurrency: 4,
			Enabled:        true,
		}},
		CreatedAt: now,
		UpdatedAt: now,
	}
	after := before
	after.Status = provider.RegistryStatusKillSwitch
	after.SelectionPolicy = provider.StrategySelectionFailover
	after.KillSwitch = true
	after.FallbackProviderIDs = []string{"dev"}
	after.Members = []provider.StrategyGroupMember{{
		ProviderID:     "dev",
		Weight:         100,
		MaxConcurrency: 2,
		FallbackRank:   0,
		Enabled:        true,
	}}
	reader := fakeProviderRegistryReader{strategyUpdateResult: provider.StrategyGroupUpdateResult{Before: before, After: after}}
	recorder := &fakeAuditRecorder{}
	body := `{
		"display_name":"Image generation default",
		"tool_type":"generate",
		"status":"kill_switch",
		"selection_policy":"failover",
		"fallback_provider_ids":["dev"],
		"kill_switch":true,
		"members":[{"provider_id":"dev","weight":100,"canary_percent":0,"max_concurrency":2,"fallback_rank":0,"enabled":true}],
		"rationale":"route image generation to deterministic fallback while sandbox is unavailable"
	}`
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/strategy-groups/image-generation-default", bytes.NewBufferString(body))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-strategy-group-update-2")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !reader.strategyUpdateCalled || reader.strategyUpdate.GroupID != "image-generation-default" || !reader.strategyUpdate.KillSwitch {
		t.Fatalf("strategy update = %#v called=%v", reader.strategyUpdate, reader.strategyUpdateCalled)
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Action != "provider.strategy_group.update" || event.Resource != "provider-strategy-groups/image-generation-default" {
		t.Fatalf("audit event = %#v", event)
	}
	if event.Metadata["before_status"] != "enabled" || event.Metadata["after_status"] != "kill_switch" || event.Metadata["after_kill_switch"] != true {
		t.Fatalf("audit metadata = %#v", event.Metadata)
	}
}

func TestAdminProviderRegistryCreateRecordsAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	created := provider.AdminRegistryProjection{
		ProviderID:  "zenari-video-sandbox",
		DisplayName: "Zenari video sandbox",
		Mode:        provider.RegistryModeSandbox,
		Status:      provider.RegistryStatusEnabled,
		SecretRef:   "secrets/provider/zenari-video-sandbox",
		Capabilities: []provider.Capability{{
			ProviderID:         "zenari-video-sandbox",
			ModelID:            "video-fast-v1",
			Endpoints:          []string{"video.generate"},
			InputTypes:         []string{"prompt"},
			OutputTypes:        []string{"video"},
			ToolTypes:          []string{"generate"},
			EstimatedCostCents: 42,
			SupportsBatch:      true,
			MaxBatchSize:       8,
		}},
		Routing: provider.RoutingPolicy{
			Weight:         25,
			MaxConcurrency: 2,
		},
		Health: provider.HealthSnapshot{
			Available:     true,
			LatencyMS:     620,
			LastCheckedAt: now,
		},
		SecretPresent: true,
		UpdatedAt:     now,
	}
	reader := fakeProviderRegistryReader{createResult: provider.RegistryCreateResult{Created: created}}
	recorder := &fakeAuditRecorder{}
	body := `{
		"provider_id":"zenari-video-sandbox",
		"display_name":"Zenari video sandbox",
		"mode":"sandbox",
		"status":"enabled",
		"secret_ref":"secrets/provider/zenari-video-sandbox",
		"routing":{"weight":25,"canary_percent":0,"max_concurrency":2,"fallback_provider_ids":[],"kill_switch":false},
		"health":{"available":true,"latency_ms":620,"error_rate_percent":0,"last_checked_at":"2026-06-21T10:00:00Z"},
		"capabilities":[{
			"model_id":"video-fast-v1",
			"endpoints":["video.generate"],
			"input_types":["prompt"],
			"output_types":["video"],
			"tool_types":["generate"],
			"estimated_cost_cents":42,
			"supports_batch":true,
			"max_batch_size":8
		}],
		"rationale":"add sandbox video provider for batch testing"
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry", bytes.NewBufferString(body))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-registry-create-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !reader.createCalled {
		t.Fatal("provider registry create was not called")
	}
	if reader.create.ProviderID != "zenari-video-sandbox" || reader.create.Capabilities[0].ModelID != "video-fast-v1" || reader.create.SecretRef != "secrets/provider/zenari-video-sandbox" {
		t.Fatalf("create = %#v, want video sandbox create input", reader.create)
	}
	if strings.Contains(rec.Body.String(), "sk-proj-") {
		t.Fatalf("response leaked raw secret: %s", rec.Body.String())
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Action != "provider.registry.create" || event.Resource != "providers/zenari-video-sandbox" || event.ActorID != "admin_1" {
		t.Fatalf("audit event = %#v", event)
	}
	if event.Metadata["rationale"] != "add sandbox video provider for batch testing" || event.Metadata["capability_count"] != 1 || event.Metadata["estimated_cost_cents"] != int64(42) {
		t.Fatalf("audit metadata = %#v, want create summary", event.Metadata)
	}
}

func TestAdminProviderRegistryCreateRejectsRawSecretBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry", bytes.NewBufferString(`{"provider_id":"unsafe","display_name":"Unsafe","mode":"sandbox","status":"enabled","secret_ref":"`+serverProviderSecretFixture+`","routing":{"weight":10,"canary_percent":0,"max_concurrency":1},"health":{"available":true},"capabilities":[{"model_id":"unsafe-v1","endpoints":["image.generate"],"input_types":["prompt"],"output_types":["image"]}],"rationale":"add unsafe provider"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-registry-create-2")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.createCalled || len(recorder.events) != 0 {
		t.Fatalf("mutation/audit reached unexpectedly: create=%v audit=%d", reader.createCalled, len(recorder.events))
	}
	if strings.Contains(rec.Body.String(), serverProviderSecretFixture) {
		t.Fatalf("error response leaked raw secret: %s", rec.Body.String())
	}
}

func TestAdminProviderRegistryUpdateRecordsAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	before := provider.AdminRegistryProjection{
		ProviderID:  "zenari-image-sandbox",
		DisplayName: "Zenari image sandbox",
		Mode:        provider.RegistryModeSandbox,
		Status:      provider.RegistryStatusEnabled,
		SecretRef:   "secrets/provider/zenari-image-sandbox",
		Capabilities: []provider.Capability{{
			ProviderID:    "zenari-image-sandbox",
			ModelID:       "image-fast-v1",
			Endpoints:     []string{"image.generate"},
			InputTypes:    []string{"prompt"},
			OutputTypes:   []string{"image"},
			SupportsBatch: true,
			MaxBatchSize:  20,
		}},
		Routing: provider.RoutingPolicy{
			Weight:         100,
			MaxConcurrency: 4,
		},
		Health: provider.HealthSnapshot{
			Available:     true,
			LatencyMS:     420,
			LastCheckedAt: now,
		},
		SecretPresent: true,
		UpdatedAt:     now,
	}
	after := before
	after.Status = provider.RegistryStatusKillSwitch
	after.Routing = provider.RoutingPolicy{
		FallbackProviderIDs: []string{"dev"},
		KillSwitch:          true,
	}
	reader := fakeProviderRegistryReader{updateResult: provider.RegistryUpdateResult{Before: before, After: after}}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(`{"status":"kill_switch","routing":{"weight":0,"canary_percent":0,"max_concurrency":0,"fallback_provider_ids":["dev"],"kill_switch":true},"rationale":"sandbox provider auth failures"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-registry-update-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !reader.updateCalled {
		t.Fatal("provider registry update was not called")
	}
	if reader.update.ProviderID != "zenari-image-sandbox" || reader.update.Status != provider.RegistryStatusKillSwitch || !reader.update.Routing.KillSwitch {
		t.Fatalf("update = %#v, want kill switch update", reader.update)
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Action != "provider.registry.update" || event.Resource != "providers/zenari-image-sandbox" || event.ActorID != "admin_1" || event.TenantID != "tenant_1" {
		t.Fatalf("audit event = %#v", event)
	}
	if event.Metadata["rationale"] != "sandbox provider auth failures" || event.Metadata["before_status"] != "enabled" || event.Metadata["after_status"] != "kill_switch" {
		t.Fatalf("audit metadata = %#v, want rationale and status transition", event.Metadata)
	}
	var body provider.RegistryUpdateResult
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body.Before.Status != provider.RegistryStatusEnabled || body.After.Status != provider.RegistryStatusKillSwitch {
		t.Fatalf("response = %#v, want before/after transition", body)
	}
}

func TestAdminProviderRegistryUpdateAcceptsSecretRefCapabilitiesAndCosts(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	before := provider.AdminRegistryProjection{
		ProviderID:  "zenari-image-sandbox",
		DisplayName: "Zenari image sandbox",
		Mode:        provider.RegistryModeSandbox,
		Status:      provider.RegistryStatusEnabled,
		SecretRef:   "secrets/provider/zenari-image-sandbox",
		Capabilities: []provider.Capability{{
			ProviderID:            "zenari-image-sandbox",
			ModelID:               "image-fast-v1",
			Endpoints:             []string{"image.generate"},
			InputTypes:            []string{"prompt"},
			OutputTypes:           []string{"image"},
			ToolTypes:             []string{"generate"},
			MaxCostUnits:          8,
			CostCurrency:          "USD",
			EstimatedCostCents:    12,
			SupportsBatch:         true,
			MaxBatchSize:          20,
			SupportsSeed:          true,
			SupportsCancel:        true,
			SupportedQualities:    []string{"draft"},
			SupportedAspectRatios: []string{"1:1"},
		}},
		Routing: provider.RoutingPolicy{
			Weight:         100,
			MaxConcurrency: 4,
		},
		Health: provider.HealthSnapshot{
			Available:     true,
			LatencyMS:     420,
			LastCheckedAt: now,
		},
		SecretPresent: true,
		UpdatedAt:     now,
	}
	after := before
	after.SecretRef = "vault/providers/zenari-image-sandbox"
	after.Capabilities = []provider.Capability{{
		ProviderID:            "zenari-image-sandbox",
		ModelID:               "image-quality-v2",
		Endpoints:             []string{"image.generate"},
		InputTypes:            []string{"prompt"},
		OutputTypes:           []string{"image"},
		ToolTypes:             []string{"generate"},
		MaxCostUnits:          15,
		CostCurrency:          "USD",
		EstimatedCostCents:    24,
		SupportsBatch:         true,
		MaxBatchSize:          12,
		SupportsSeed:          true,
		SupportsCancel:        true,
		SupportedAspectRatios: []string{"1:1", "4:5"},
		SupportedQualities:    []string{"standard", "high"},
	}}
	reader := fakeProviderRegistryReader{updateResult: provider.RegistryUpdateResult{Before: before, After: after}}
	recorder := &fakeAuditRecorder{}
	body := `{
		"status":"enabled",
		"secret_ref":"vault/providers/zenari-image-sandbox",
		"routing":{"weight":100,"canary_percent":0,"max_concurrency":4,"fallback_provider_ids":[],"kill_switch":false},
		"capabilities":[{
			"model_id":"image-quality-v2",
			"endpoints":["image.generate"],
			"input_types":["prompt"],
			"output_types":["image"],
			"tool_types":["generate"],
			"max_cost_units":15,
			"cost_currency":"USD",
			"estimated_cost_cents":24,
			"supports_batch":true,
			"max_batch_size":12,
			"supports_seed":true,
			"supports_cancel":true,
			"supported_aspect_ratios":["1:1","4:5"],
			"supported_qualities":["standard","high"]
		}],
		"rationale":"rotate sandbox secret reference and raise quality model cost"
	}`
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(body))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-registry-update-capability-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !reader.updateCalled {
		t.Fatal("provider registry update was not called")
	}
	if reader.update.SecretRef == nil || *reader.update.SecretRef != "vault/providers/zenari-image-sandbox" || !reader.update.SetCapability {
		t.Fatalf("update = %#v, want secret ref and capability update", reader.update)
	}
	if len(reader.update.Capabilities) != 1 || reader.update.Capabilities[0].ModelID != "image-quality-v2" || reader.update.Capabilities[0].EstimatedCostCents != 24 {
		t.Fatalf("capabilities = %#v, want updated model and cost", reader.update.Capabilities)
	}
	if strings.Contains(rec.Body.String(), "sk-proj-") {
		t.Fatalf("response leaked raw secret: %s", rec.Body.String())
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Metadata["reference_changed"] != true || event.Metadata["capabilities_changed"] != true {
		t.Fatalf("audit metadata = %#v, want secret/capability change summary", event.Metadata)
	}
	if event.Metadata["before_estimated_cost_cents"] != int64(12) || event.Metadata["after_estimated_cost_cents"] != int64(24) {
		t.Fatalf("audit cost metadata = %#v, want before/after cost totals", event.Metadata)
	}
}

func TestAdminProviderRegistryUpdateRejectsMissingRationaleBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(`{"status":"disabled","routing":{"weight":0,"canary_percent":0,"max_concurrency":0},"rationale":""}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-registry-update-2")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.updateCalled || len(recorder.events) != 0 {
		t.Fatalf("mutation/audit reached unexpectedly: update=%v audit=%d", reader.updateCalled, len(recorder.events))
	}
}

func TestAdminProviderRegistryUpdateRequiresAuditBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(`{"status":"disabled","routing":{"weight":0,"canary_percent":0,"max_concurrency":0},"rationale":"disable sandbox"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-registry-update-3")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(provider.ContextWithRegistryReader(req.Context(), &reader))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusNotImplemented, rec.Body.String())
	}
	if reader.updateCalled {
		t.Fatal("provider registry update was called without audit recorder")
	}
}

func TestAdminProviderRegistryUpdateRejectsInsufficientRoleBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(`{"status":"disabled","routing":{"weight":0,"canary_percent":0,"max_concurrency":0},"rationale":"disable sandbox"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminViewer))
	req.Header.Set("Idempotency-Key", "provider-registry-update-4")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	if reader.updateCalled || len(recorder.events) != 0 {
		t.Fatalf("mutation/audit reached unexpectedly: update=%v audit=%d", reader.updateCalled, len(recorder.events))
	}
}

func TestAdminProviderRegistryUpdateRequiresIdempotencyKey(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(`{"status":"disabled","routing":{"weight":0,"canary_percent":0,"max_concurrency":0},"rationale":"disable sandbox"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.updateCalled || len(recorder.events) != 0 {
		t.Fatalf("mutation/audit reached unexpectedly: update=%v audit=%d", reader.updateCalled, len(recorder.events))
	}
}

func TestAdminProviderRegistryUpdateMapsValidationError(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{updateErr: errors.New("canary_percent must be between 0 and 100")}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPatch, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(`{"status":"enabled","routing":{"weight":100,"canary_percent":101,"max_concurrency":4},"rationale":"bad canary test"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-registry-update-5")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if len(recorder.events) != 0 {
		t.Fatalf("audit events = %d, want none for failed update", len(recorder.events))
	}
}

func TestAdminProviderRegistryDeleteRecordsAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	deleted := provider.AdminRegistryProjection{
		ProviderID:  "zenari-image-sandbox",
		DisplayName: "Zenari image sandbox",
		Mode:        provider.RegistryModeSandbox,
		Status:      provider.RegistryStatusDisabled,
		SecretRef:   "secrets/provider/zenari-image-sandbox",
		Capabilities: []provider.Capability{{
			ProviderID:         "zenari-image-sandbox",
			ModelID:            "image-fast-v1",
			Endpoints:          []string{"image.generate"},
			InputTypes:         []string{"prompt"},
			OutputTypes:        []string{"image"},
			ToolTypes:          []string{"generate"},
			EstimatedCostCents: 12,
		}},
		Routing: provider.RoutingPolicy{
			Weight:         0,
			MaxConcurrency: 0,
		},
		Health: provider.HealthSnapshot{
			LatencyMS:     420,
			LastCheckedAt: now,
		},
		SecretPresent: true,
		UpdatedAt:     now,
	}
	reader := fakeProviderRegistryReader{deleteResult: provider.RegistryDeleteResult{Deleted: deleted}}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodDelete, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(`{"rationale":"remove disabled sandbox provider after migration"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-registry-delete-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !reader.deleteCalled || reader.delete.ProviderID != "zenari-image-sandbox" {
		t.Fatalf("delete = %#v called=%v, want provider delete", reader.delete, reader.deleteCalled)
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Action != "provider.registry.delete" || event.Resource != "providers/zenari-image-sandbox" || event.ActorID != "admin_1" {
		t.Fatalf("audit event = %#v", event)
	}
	if event.Metadata["rationale"] != "remove disabled sandbox provider after migration" || event.Metadata["deleted_capability_count"] != 1 || event.Metadata["deleted_estimated_cost_cents"] != int64(12) {
		t.Fatalf("audit metadata = %#v, want delete summary", event.Metadata)
	}
}

func TestAdminProviderRegistryDeleteRequiresIdempotencyKey(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodDelete, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(`{"rationale":"remove disabled sandbox"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.deleteCalled || len(recorder.events) != 0 {
		t.Fatalf("mutation/audit reached unexpectedly: delete=%v audit=%d", reader.deleteCalled, len(recorder.events))
	}
}

func TestAdminProviderRegistryDeleteRejectsMissingRationaleBeforeMutation(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodDelete, "/api/admin/v1/providers/registry/zenari-image-sandbox", bytes.NewBufferString(`{"rationale":""}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-registry-delete-2")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.deleteCalled || len(recorder.events) != 0 {
		t.Fatalf("mutation/audit reached unexpectedly: delete=%v audit=%d", reader.deleteCalled, len(recorder.events))
	}
}

func TestAdminProviderRegistryHealthProbeRecordsAudit(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 21, 11, 0, 0, 0, time.UTC)
	before := provider.AdminRegistryProjection{
		ProviderID:  "zenari-image-sandbox",
		DisplayName: "Zenari image sandbox",
		Mode:        provider.RegistryModeSandbox,
		Status:      provider.RegistryStatusEnabled,
		SecretRef:   "secrets/provider/zenari-image-sandbox",
		Capabilities: []provider.Capability{{
			ProviderID:  "zenari-image-sandbox",
			ModelID:     "image-fast-v1",
			Endpoints:   []string{"image.generate"},
			InputTypes:  []string{"prompt"},
			OutputTypes: []string{"image"},
		}},
		Routing: provider.RoutingPolicy{
			Weight:         100,
			MaxConcurrency: 4,
		},
		Health: provider.HealthSnapshot{
			Available:     false,
			LatencyMS:     900,
			LastCheckedAt: now.Add(-time.Hour),
		},
		SecretPresent: true,
		UpdatedAt:     now,
	}
	after := before
	after.Health = provider.HealthSnapshot{
		Available:        true,
		LatencyMS:        77,
		ErrorRatePercent: 0,
		LastCheckedAt:    now,
		Message:          "openai-compatible health probe passed",
	}
	reader := fakeProviderRegistryReader{healthProbeResult: provider.RegistryHealthProbeResult{Before: before, After: after}}
	recorder := &fakeAuditRecorder{}
	resolver := provider.ClientMap{
		"zenari-image-sandbox": fakeProviderStatusClient{status: provider.Status{
			ProviderID: "zenari-image-sandbox",
			Available:  true,
			LatencyMS:  77,
			CheckedAt:  now,
			Message:    "openai-compatible health probe passed",
		}},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry/zenari-image-sandbox/health-probe", bytes.NewBufferString(`{"rationale":"refresh provider health before canary"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-health-probe-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithClientResolver(provider.ContextWithRegistryReader(req.Context(), &reader), resolver), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if !reader.healthProbeCalled || reader.healthProbe.ProviderID != "zenari-image-sandbox" || !reader.healthProbe.Status.Available || reader.healthProbe.Status.LatencyMS != 77 {
		t.Fatalf("health probe = %#v called=%v, want status from resolver", reader.healthProbe, reader.healthProbeCalled)
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Action != "provider.registry.health_probe" || event.Resource != "providers/zenari-image-sandbox" || event.ActorID != "admin_1" {
		t.Fatalf("audit event = %#v", event)
	}
	if event.Metadata["rationale"] != "refresh provider health before canary" || event.Metadata["before_available"] != false || event.Metadata["after_available"] != true || event.Metadata["client_configured"] != true {
		t.Fatalf("audit metadata = %#v, want health transition summary", event.Metadata)
	}
	if strings.Contains(rec.Body.String(), "sk-proj-") {
		t.Fatalf("response leaked raw secret: %s", rec.Body.String())
	}
}

func TestAdminProviderRegistryHealthProbeRequiresIdempotencyKey(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry/zenari-image-sandbox/health-probe", bytes.NewBufferString(`{"rationale":"refresh provider health"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithClientResolver(provider.ContextWithRegistryReader(req.Context(), &reader), provider.ClientMap{}), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.healthProbeCalled || len(recorder.events) != 0 {
		t.Fatalf("probe/audit reached unexpectedly: probe=%v audit=%d", reader.healthProbeCalled, len(recorder.events))
	}
}

func TestAdminProviderRegistryHealthProbeRequiresRationaleBeforeClient(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry/zenari-image-sandbox/health-probe", bytes.NewBufferString(`{"rationale":""}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-health-probe-2")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithClientResolver(provider.ContextWithRegistryReader(req.Context(), &reader), provider.ClientMap{
		"zenari-image-sandbox": fakeProviderStatusClient{status: provider.Status{ProviderID: "zenari-image-sandbox", Available: true}},
	}), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.healthProbeCalled || len(recorder.events) != 0 {
		t.Fatalf("probe/audit reached unexpectedly: probe=%v audit=%d", reader.healthProbeCalled, len(recorder.events))
	}
}

func TestAdminProviderSandboxTestCallRecordsAuditWithoutUserAsset(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	result := provider.SandboxTestCallResult{
		ID:             "provider-test-001",
		ProviderID:     "zenari-image-sandbox",
		ModelID:        "image-fast-v1",
		ToolType:       "generate",
		Status:         "succeeded",
		Mode:           provider.RegistryModeSandbox,
		SecretRef:      "secrets/provider/zenari-image-sandbox",
		SecretPresent:  true,
		AssetPersisted: false,
		UserVisible:    false,
		TraceID:        "trace_provider_test_001",
		LatencyMS:      420,
		Capability: provider.Capability{
			ProviderID:    "zenari-image-sandbox",
			ModelID:       "image-fast-v1",
			Endpoints:     []string{"image.generate"},
			InputTypes:    []string{"prompt"},
			OutputTypes:   []string{"image"},
			ToolTypes:     []string{"generate"},
			MaxCostUnits:  8,
			SupportsBatch: true,
			MaxBatchSize:  20,
		},
		OutputPreview: map[string]string{
			"kind":        "sandbox_preview",
			"prompt_hash": "abc123",
		},
		CreatedAt: now,
	}
	reader := fakeProviderRegistryReader{testCallResult: result}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry/zenari-image-sandbox/test-call", bytes.NewBufferString(`{"model_id":"image-fast-v1","tool_type":"generate","prompt":"sandbox smoke","rationale":"verify sandbox provider before canary"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-test-call-1")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if !reader.testCallCalled {
		t.Fatal("provider sandbox test call was not invoked")
	}
	if reader.testCall.ProviderID != "zenari-image-sandbox" || reader.testCall.ModelID != "image-fast-v1" || reader.testCall.ToolType != "generate" {
		t.Fatalf("test call input = %#v", reader.testCall)
	}
	if strings.Contains(rec.Body.String(), "sandbox smoke") || strings.Contains(rec.Body.String(), "sk-proj-") {
		t.Fatalf("test call response leaked prompt or secret: %s", rec.Body.String())
	}
	var body provider.SandboxTestCallResult
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body.AssetPersisted || body.UserVisible || body.SecretRef != "secrets/provider/zenari-image-sandbox" {
		t.Fatalf("body = %#v, want admin-only result with secret ref only", body)
	}
	if len(recorder.events) != 1 {
		t.Fatalf("audit events = %d, want 1", len(recorder.events))
	}
	event := recorder.events[0]
	if event.Action != "provider.sandbox_test_call" || event.Resource != "providers/zenari-image-sandbox" || event.ActorID != "admin_1" {
		t.Fatalf("audit event = %#v", event)
	}
	if event.Metadata["rationale"] != "verify sandbox provider before canary" || event.Metadata["asset_persisted"] != false || event.Metadata["user_visible"] != false {
		t.Fatalf("audit metadata = %#v, want rationale and non-user asset flags", event.Metadata)
	}
}

func TestAdminProviderSandboxTestCallRejectsSecretPromptBeforeReader(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry/zenari-image-sandbox/test-call", bytes.NewBufferString(`{"model_id":"image-fast-v1","tool_type":"generate","prompt":"use `+serverProviderSecretFixture+`","rationale":"verify sandbox provider"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-test-call-2")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.testCallCalled || len(recorder.events) != 0 {
		t.Fatalf("test call/audit reached unexpectedly: testCall=%v audit=%d", reader.testCallCalled, len(recorder.events))
	}
	if strings.Contains(rec.Body.String(), serverProviderSecretFixture) {
		t.Fatalf("error response leaked raw secret: %s", rec.Body.String())
	}
}

func TestAdminProviderSandboxTestCallProjectsProviderQuotaError(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{testCallErr: &provider.Error{
		ProviderID:   "zenari-image-sandbox",
		Code:         "provider_quota_unavailable",
		HTTPStatus:   http.StatusTooManyRequests,
		ProviderCode: "1113",
		Message:      "Insufficient balance or no resource package. Authorization: Bearer " + strings.Repeat("a", 32) + "." + strings.Repeat("b", 16),
		Retryable:    false,
	}}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry/zenari-image-sandbox/test-call", bytes.NewBufferString(`{"model_id":"image-fast-v1","tool_type":"generate","prompt":"sandbox smoke","rationale":"verify sandbox provider before canary"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	req.Header.Set("Idempotency-Key", "provider-test-call-quota")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusConflict, rec.Body.String())
	}
	if !reader.testCallCalled {
		t.Fatal("provider sandbox test call should reach reader")
	}
	if len(recorder.events) != 0 {
		t.Fatalf("audit events = %d, want no success audit on provider failure", len(recorder.events))
	}
	if strings.Contains(rec.Body.String(), "Bearer") || strings.Contains(rec.Body.String(), strings.Repeat("a", 32)+"."+strings.Repeat("b", 16)) || strings.Contains(strings.ToLower(rec.Body.String()), "authorization") {
		t.Fatalf("error response leaked provider secret details: %s", rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "provider_quota_unavailable" || body["retryable"] != false || body["blocked"] != true {
		t.Fatalf("error envelope = %#v, want provider quota unavailable taxonomy", body)
	}
	taxonomy, ok := body["taxonomy"].(map[string]any)
	if !ok || taxonomy["category"] != "quota_insufficient" || taxonomy["blocked"] != true || taxonomy["user_actionable"] != true {
		t.Fatalf("taxonomy = %#v, want user-actionable quota classification", body["taxonomy"])
	}
	details, ok := body["details"].(map[string]any)
	if !ok {
		t.Fatalf("details missing: %#v", body)
	}
	if details["provider_error_code"] != "provider_quota_unavailable" || details["provider_http_status"] != float64(http.StatusTooManyRequests) || details["provider_code"] != "1113" {
		t.Fatalf("details = %#v, want sanitized provider diagnostics", details)
	}
}

func TestAdminProviderSandboxTestCallRejectsInsufficientRoleBeforeReader(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry/zenari-image-sandbox/test-call", bytes.NewBufferString(`{"model_id":"image-fast-v1","tool_type":"generate","prompt":"sandbox smoke","rationale":"verify sandbox provider"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_viewer")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminViewer))
	req.Header.Set("Idempotency-Key", "provider-test-call-3")
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	if reader.testCallCalled || len(recorder.events) != 0 {
		t.Fatalf("test call/audit reached unexpectedly: testCall=%v audit=%d", reader.testCallCalled, len(recorder.events))
	}
}

func TestAdminProviderSandboxTestCallRequiresIdempotencyKey(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	reader := fakeProviderRegistryReader{}
	recorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/providers/registry/zenari-image-sandbox/test-call", bytes.NewBufferString(`{"model_id":"image-fast-v1","tool_type":"generate","prompt":"sandbox smoke","rationale":"verify sandbox provider"}`))
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminSuperadmin))
	setSameSiteCSRFHeaders(req)
	req = req.WithContext(audit.ContextWithRecorder(provider.ContextWithRegistryReader(req.Context(), &reader), recorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if reader.testCallCalled || len(recorder.events) != 0 {
		t.Fatalf("test call/audit reached unexpectedly: testCall=%v audit=%d", reader.testCallCalled, len(recorder.events))
	}
}

func TestLocalAdminSessionSetsSecureHttpOnlySameSiteCookie(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"tenant_admin"}`))
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	cookie := findCookie(rec.Result().Cookies(), cfg.Auth.AdminSessionCookieName)
	if cookie == nil {
		t.Fatalf("admin session cookie %q was not set", cfg.Auth.AdminSessionCookieName)
	}
	if !cookie.HttpOnly {
		t.Fatal("admin session cookie must be HttpOnly")
	}
	if !cookie.Secure {
		t.Fatal("admin session cookie must be Secure")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("SameSite = %v, want lax", cookie.SameSite)
	}
	if cookie.Path != "/" {
		t.Fatalf("Path = %q, want /", cookie.Path)
	}
	if cookie.Domain != "" {
		t.Fatalf("Domain = %q, want empty for __Host- cookie", cookie.Domain)
	}
}

func TestLocalUserSessionRejectsAdminRoles(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"tenant_1","roles":["admin_superadmin"]}`))
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want forbidden: %s", rec.Code, rec.Body.String())
	}
	if findCookie(rec.Result().Cookies(), cfg.Auth.SessionCookieName) != nil {
		t.Fatal("user session cookie must not be set for admin roles")
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "invalid_session_roles" {
		t.Fatalf("code = %v, want invalid_session_roles", body["code"])
	}
}

func TestLocalAdminSessionRejectsUserRoles(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"tenant_admin","roles":["user_owner"]}`))
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want forbidden: %s", rec.Code, rec.Body.String())
	}
	if findCookie(rec.Result().Cookies(), cfg.Auth.AdminSessionCookieName) != nil {
		t.Fatal("admin session cookie must not be set for user roles")
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "invalid_session_roles" {
		t.Fatalf("code = %v, want invalid_session_roles", body["code"])
	}
}

func TestLocalSessionRejectsUnsafeTenantID(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"tenant_1/../tenant_2"}`))
	setSameSiteCSRFHeaders(req)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want bad request: %s", rec.Code, rec.Body.String())
	}
	if findCookie(rec.Result().Cookies(), cfg.Auth.SessionCookieName) != nil {
		t.Fatal("session cookie must not be set for unsafe tenant id")
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "session_validation_error" {
		t.Fatalf("code = %v, want session_validation_error", body["code"])
	}
}

func TestSessionCookieAuthenticatesRequest(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	login := httptest.NewRequest(http.MethodPost, "/api/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"tenant_cookie"}`))
	setSameSiteCSRFHeaders(login)
	loginRec := httptest.NewRecorder()
	New(cfg, nil).Handler().ServeHTTP(loginRec, login)
	cookie := findCookie(loginRec.Result().Cookies(), cfg.Auth.SessionCookieName)
	if cookie == nil {
		t.Fatal("session cookie was not set")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want authenticated stub response: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	details := body["details"].(map[string]any)
	if details["tenant_id"] != "tenant_cookie" {
		t.Fatalf("tenant_id = %v, want tenant_cookie", details["tenant_id"])
	}
}

func TestAdminRouteUsesAdminCookieWhenUserCookieAlsoPresent(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	userLogin := httptest.NewRequest(http.MethodPost, "/api/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"tenant_cookie"}`))
	setSameSiteCSRFHeaders(userLogin)
	userRec := httptest.NewRecorder()
	New(cfg, nil).Handler().ServeHTTP(userRec, userLogin)
	userCookie := findCookie(userRec.Result().Cookies(), cfg.Auth.SessionCookieName)
	if userCookie == nil {
		t.Fatal("user session cookie was not set")
	}

	adminLogin := httptest.NewRequest(http.MethodPost, "/api/admin/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"admin_tenant"}`))
	setSameSiteCSRFHeaders(adminLogin)
	adminRec := httptest.NewRecorder()
	New(cfg, nil).Handler().ServeHTTP(adminRec, adminLogin)
	adminCookie := findCookie(adminRec.Result().Cookies(), cfg.Auth.AdminSessionCookieName)
	if adminCookie == nil {
		t.Fatal("admin session cookie was not set")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/audit", nil)
	req.AddCookie(userCookie)
	req.AddCookie(adminCookie)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want admin cookie to authorize audit stub: %s", rec.Code, rec.Body.String())
	}
}

func TestUserRouteRejectsAdminCookieOnly(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	adminLogin := httptest.NewRequest(http.MethodPost, "/api/admin/v1/auth/local/session", bytes.NewBufferString(`{"tenant_id":"admin_tenant"}`))
	setSameSiteCSRFHeaders(adminLogin)
	adminRec := httptest.NewRecorder()
	New(cfg, nil).Handler().ServeHTTP(adminRec, adminLogin)
	adminCookie := findCookie(adminRec.Result().Cookies(), cfg.Auth.AdminSessionCookieName)
	if adminCookie == nil {
		t.Fatal("admin session cookie was not set")
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req.AddCookie(adminCookie)
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want user route to reject admin cookie: %s", rec.Code, rec.Body.String())
	}
}

func TestUserRouteRejectsUserCookieWithAdminRoles(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	expiresAt := time.Now().UTC().Add(time.Hour)
	cookieValue, err := signSessionCookie(sessionCookiePayload{
		UserID:    "user_cookie",
		TenantID:  "tenant_cookie",
		Roles:     []auth.Role{auth.RoleAdminSuperadmin},
		ExpiresAt: expiresAt.Unix(),
	}, cfg.Auth.SessionSecret)
	if err != nil {
		t.Fatalf("signSessionCookie() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req.AddCookie(&http.Cookie{Name: cfg.Auth.SessionCookieName, Value: cookieValue})
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want unauthorized for admin role in user cookie: %s", rec.Code, rec.Body.String())
	}
}

func TestAdminRouteRejectsAdminCookieWithUserRoles(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	expiresAt := time.Now().UTC().Add(time.Hour)
	cookieValue, err := signSessionCookie(sessionCookiePayload{
		UserID:    "admin_cookie",
		TenantID:  "tenant_cookie",
		Roles:     []auth.Role{auth.RoleUserOwner},
		ExpiresAt: expiresAt.Unix(),
	}, cfg.Auth.AdminSessionSecret)
	if err != nil {
		t.Fatalf("signSessionCookie() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/audit", nil)
	req.AddCookie(&http.Cookie{Name: cfg.Auth.AdminSessionCookieName, Value: cookieValue})
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want unauthorized for user role in admin cookie: %s", rec.Code, rec.Body.String())
	}
}

func TestNonLocalRuntimeRejectsDevIdentityHeaders(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AccessMode = "invite-only"
	cfg.Auth.DevIdentityHeaders = false

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d when header identity is disabled: %s", rec.Code, http.StatusUnauthorized, rec.Body.String())
	}
}

func TestDevIdentityHeadersRejectUnsafeTenantID(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.DevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1/../tenant_2")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want unauthorized for unsafe header tenant id: %s", rec.Code, rec.Body.String())
	}
}

func TestNonLocalRuntimeAcceptsSignedSessionCookie(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AccessMode = "invite-only"
	cfg.Auth.DevIdentityHeaders = false
	expiresAt := time.Now().UTC().Add(time.Hour)
	cookieValue, err := signSessionCookie(sessionCookiePayload{
		UserID:    "user_cookie",
		TenantID:  "tenant_cookie",
		Roles:     []auth.Role{auth.RoleUserOwner},
		ExpiresAt: expiresAt.Unix(),
	}, cfg.Auth.SessionSecret)
	if err != nil {
		t.Fatalf("signSessionCookie() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req.AddCookie(&http.Cookie{
		Name:    cfg.Auth.SessionCookieName,
		Value:   cookieValue,
		Path:    "/",
		Expires: expiresAt,
	})
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want signed cookie to authenticate stub response: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	details := body["details"].(map[string]any)
	if details["tenant_id"] != "tenant_cookie" {
		t.Fatalf("tenant_id = %v, want tenant_cookie", details["tenant_id"])
	}
}

func TestSignedSessionCookieRejectsUnsafeTenantID(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AccessMode = "invite-only"
	cfg.Auth.DevIdentityHeaders = false
	expiresAt := time.Now().UTC().Add(time.Hour)
	cookieValue, err := signSessionCookie(sessionCookiePayload{
		UserID:    "user_cookie",
		TenantID:  "tenant_1/../tenant_2",
		Roles:     []auth.Role{auth.RoleUserOwner},
		ExpiresAt: expiresAt.Unix(),
	}, cfg.Auth.SessionSecret)
	if err != nil {
		t.Fatalf("signSessionCookie() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req.AddCookie(&http.Cookie{
		Name:    cfg.Auth.SessionCookieName,
		Value:   cookieValue,
		Path:    "/",
		Expires: expiresAt,
	})
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want unauthorized for unsafe cookie tenant id: %s", rec.Code, rec.Body.String())
	}
}

func TestStateChangingAPIRequiresSameSiteCSRFHeader(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads", bytes.NewBufferString(`{"filename":"asset.png","content_type":"image/png","byte_size":100}`))
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), nil)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("Origin", "http://localhost:26080")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "csrf_required" {
		t.Fatalf("code = %v, want csrf_required", body["code"])
	}
}

func TestStateChangingAPIRejectsCrossSiteOrigin(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/uploads", bytes.NewBufferString(`{"filename":"asset.png","content_type":"image/png","byte_size":100}`))
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), nil)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("X-Zenari-CSRF", "same-site-origin-check")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
	if !strings.Contains(rec.Body.String(), "csrf_origin_denied") {
		t.Fatalf("body = %s, want csrf_origin_denied", rec.Body.String())
	}
}

func TestTaskStatusUsesPrincipalTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	now := time.Now().UTC()
	repo := &fakeTaskReader{task: task.Task{
		ID:            "task_123",
		TenantID:      "tenant_1",
		Type:          "candidate_set_builder",
		SchemaVersion: 1,
		Status:        task.StatusRunning,
		UserStatus:    "running",
		Progress:      25,
		RetryCount:    1,
		UserMessage:   "Generating candidate directions",
		AppVersion:    "stage0-test",
		WorkerVersion: "stage0-test",
		CreatedAt:     now,
		UpdatedAt:     now,
	}}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	req = req.WithContext(task.ContextWithRepository(req.Context(), repo))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if repo.tenantID != "tenant_1" {
		t.Fatalf("tenantID = %q, want tenant_1", repo.tenantID)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	for _, key := range []string{"progress", "retry_count", "timeout_at", "user_message", "app_version", "worker_version"} {
		if _, ok := body[key]; !ok {
			t.Fatalf("task status response missing %s", key)
		}
	}
}

func TestTaskStatusDoesNotUseRequestedTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	repo := &fakeTaskReader{
		task:        task.Task{ID: "task_123", TenantID: "tenant_2"},
		requireSame: true,
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123?tenant_id=tenant_2", nil)
	req = req.WithContext(task.ContextWithRepository(req.Context(), repo))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if repo.tenantID != "tenant_1" {
		t.Fatalf("tenantID = %q, want tenant_1", repo.tenantID)
	}
}

func TestAssetLibraryUsesPrincipalTenantProjectAndSafeProjection(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{
		queryRows: []stage0RowSet{{
			rows: [][]any{{
				"library_entry_1",
				[]byte(`{"id":"asset_1","asset_type":"generated_image","status":"active","object_metadata":{"id":"object_1","bucket":"zenari-stage1-results","object_key":"tenants/tenant_1/assets/result.png","content_type":"image/png","byte_size":100,"checksum":"sha256:abc","created_at":"2026-06-22T10:00:00Z"},"storage_ref":{"bucket":"zenari-stage1-results","object_key":"tenants/tenant_1/assets/result.png","content_type":"image/png","byte_size":100,"checksum":"sha256:abc"},"lineage":{"source":{"kind":"batch_child_provider_result","trace_id":"trace_1"},"object_metadata_id":"object_1","raw_payload_persisted":false},"provenance":{"api_key":"secret-value"},"created_at":"2026-06-22T10:00:00Z"}`),
				"tenant",
				true,
				false,
				true,
				[]string{"project_1", "project_2"},
				[]string{"approved"},
				now,
				now,
			}},
		}},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/assets/library?tenant_id=tenant_2&project_id=project_1&status=active&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(db.queries) != 1 {
		t.Fatalf("query count = %d, want 1", len(db.queries))
	}
	query := db.queries[0]
	if !strings.Contains(query.sql, "FROM asset_library_entries") || !strings.Contains(query.sql, "WHERE l.tenant_id = $1") {
		t.Fatalf("asset library SQL missing tenant-scoped table predicates: %s", query.sql)
	}
	if len(query.args) != 4 || query.args[0] != "tenant_1" || query.args[1] != "project_1" || query.args[2] != 25 || query.args[3] != "active" {
		t.Fatalf("query args = %#v, want principal tenant, project, page size, status", query.args)
	}
	bodyText := rec.Body.String()
	if strings.Contains(bodyText, "tenant_2") || strings.Contains(bodyText, "secret-value") {
		t.Fatalf("asset library response leaked requested tenant or secret material: %s", bodyText)
	}
	if !strings.Contains(bodyText, security.Redacted) {
		t.Fatalf("asset library response = %s, want redaction marker", bodyText)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	items := body["items"].([]any)
	if got := items[0].(map[string]any)["visibility"]; got != "tenant" {
		t.Fatalf("visibility = %v, want tenant", got)
	}
}

func TestPackagesUsePrincipalTenantPathProjectAndSafeProjection(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{
		queryRows: []stage0RowSet{
			{rows: [][]any{{
				"package_1",
				"tenant_1",
				"project_1",
				"draft",
				[]byte(`{"download_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","qa_report":{"status":"pass"},"provenance":{"api_key":"secret-value"}}`),
				now,
				now,
			}}},
			{rows: [][]any{{
				"package_item_1",
				"asset_1",
				nil,
				"asset",
				0,
				[]byte(`{"source":"local","secret":"secret-value"}`),
				now,
			}}},
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/project_1/packages?tenant_id=tenant_2&status=draft&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(db.queries) != 2 {
		t.Fatalf("query count = %d, want package and item queries", len(db.queries))
	}
	query := db.queries[0]
	if !strings.Contains(query.sql, "FROM packages") || !strings.Contains(query.sql, "WHERE tenant_id = $1 AND project_id = $2") {
		t.Fatalf("package SQL missing tenant/project predicates: %s", query.sql)
	}
	if len(query.args) != 4 || query.args[0] != "tenant_1" || query.args[1] != "project_1" || query.args[2] != 25 || query.args[3] != "draft" {
		t.Fatalf("query args = %#v, want principal tenant, path project, page size, status", query.args)
	}
	bodyText := rec.Body.String()
	if strings.Contains(bodyText, "tenant_2") || strings.Contains(bodyText, "secret-value") || strings.Contains(bodyText, "X-Amz-Signature=abcdef") {
		t.Fatalf("package response leaked requested tenant or secret material: %s", bodyText)
	}
	if !strings.Contains(bodyText, security.Redacted) {
		t.Fatalf("package response = %s, want redaction marker", bodyText)
	}
}

func TestCreatePackageUsesPrincipalTenantUserAndPathProject(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	db := &fakeStage0DB{
		queryRows: []stage0RowSet{{rows: [][]any{{"ecommerce_growth_pack"}}}},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/project_1/packages?tenant_id=tenant_2", bytes.NewBufferString(`{"manifest":{"download_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef"},"items":[{"sourceId":"candidate_1","title":"Hero option","type":"candidate","provenance":{"api_key":"secret-value"}}]}`))
	setSameSiteCSRFHeaders(req)
	req.Header.Set("Idempotency-Key", "package-create-1")
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if len(db.queries) != 1 || !strings.Contains(db.queries[0].sql, "FROM projects") {
		t.Fatalf("project tenant query not recorded: %#v", db.queries)
	}
	if db.queries[0].args[0] != "tenant_1" || db.queries[0].args[1] != "project_1" {
		t.Fatalf("project query args = %#v, want principal tenant and path project", db.queries[0].args)
	}
	if len(db.execs) != 2 {
		t.Fatalf("exec count = %d, want package and item inserts", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO packages") || db.execs[0].args[1] != "tenant_1" || db.execs[0].args[3] != "user_1" {
		t.Fatalf("package insert = %#v, want principal tenant/user", db.execs[0])
	}
	if !strings.Contains(db.execs[1].sql, "INSERT INTO package_items") || db.execs[1].args[1] != "tenant_1" || db.execs[1].args[5] != "candidate" {
		t.Fatalf("package item insert = %#v, want tenant candidate item", db.execs[1])
	}
	bodyText := rec.Body.String()
	if strings.Contains(bodyText, "tenant_2") || strings.Contains(bodyText, "secret-value") || strings.Contains(bodyText, "X-Amz-Signature=abcdef") {
		t.Fatalf("package create response leaked requested tenant or secret: %s", bodyText)
	}
	if !strings.Contains(bodyText, security.Redacted) {
		t.Fatalf("package create response = %s, want redaction marker", bodyText)
	}
}

func TestBrandKitsUsesPrincipalTenantProjectAndSafeProjection(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{brandKitStage0Row(now)}}}}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/brand-kits?tenant_id=tenant_2&project_id=project_1&status=active&page_size=25", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(db.queries) != 1 {
		t.Fatalf("query count = %d, want 1", len(db.queries))
	}
	query := db.queries[0]
	if !strings.Contains(query.sql, "FROM brand_kits") || !strings.Contains(query.sql, "WHERE tenant_id = $1") || !strings.Contains(query.sql, "project_bindings @> jsonb_build_array") {
		t.Fatalf("brand kit SQL missing tenant/project predicates: %s", query.sql)
	}
	if len(query.args) != 4 || query.args[0] != "tenant_1" || query.args[1] != "project_1" || query.args[2] != 25 || query.args[3] != "active" {
		t.Fatalf("query args = %#v, want principal tenant, project, page size, status", query.args)
	}
	bodyText := rec.Body.String()
	if strings.Contains(bodyText, "tenant_2") || strings.Contains(bodyText, "secret-value") {
		t.Fatalf("brand kit response leaked requested tenant or secret material: %s", bodyText)
	}
	if !strings.Contains(bodyText, security.Redacted) {
		t.Fatalf("brand kit response = %s, want redaction marker", bodyText)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	items := body["items"].([]any)
	if got := items[0].(map[string]any)["id"]; got != "brand_kit_1" {
		t.Fatalf("brand kit id = %v, want brand_kit_1", got)
	}
}

func TestProjectDefaultBrandKitUsesPrincipalTenantAndPathProject(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{queryRows: []stage0RowSet{{rows: [][]any{brandKitStage0Row(now)}}}}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/projects/project_1/brand-kit-default?tenant_id=tenant_2", nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(db.queries) != 1 {
		t.Fatalf("query count = %d, want 1", len(db.queries))
	}
	query := db.queries[0]
	if !strings.Contains(query.sql, "WHERE tenant_id = $1") || !strings.Contains(query.sql, "status = 'active'") || !strings.Contains(query.sql, "'default', true") {
		t.Fatalf("default brand kit SQL missing active default project predicates: %s", query.sql)
	}
	if len(query.args) != 2 || query.args[0] != "tenant_1" || query.args[1] != "project_1" {
		t.Fatalf("query args = %#v, want principal tenant and path project", query.args)
	}
	bodyText := rec.Body.String()
	if strings.Contains(bodyText, "tenant_2") || strings.Contains(bodyText, "secret-value") {
		t.Fatalf("default brand kit response leaked requested tenant or secret material: %s", bodyText)
	}
	if !strings.Contains(bodyText, security.Redacted) {
		t.Fatalf("default brand kit response = %s, want redaction marker", bodyText)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["id"] != "brand_kit_1" || body["status"] != "active" {
		t.Fatalf("brand kit response = %#v, want active brand_kit_1", body)
	}
}

func TestCreateAssetLibraryEntryUsesPrincipalTenantAndIdempotency(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{
		execTags: []pgconn.CommandTag{pgconn.NewCommandTag("INSERT 0 1")},
		queryRows: []stage0RowSet{{rows: [][]any{{
			"library_entry_created_1",
			[]byte(`{"id":"asset_1","asset_type":"generated_image","status":"active","storage_ref":{"object_key":"tenants/tenant_1/assets/result.png"},"lineage":{"source":{"kind":"batch_child_provider_result","trace_id":"trace_1"}},"created_at":"2026-06-22T10:00:00Z"}`),
			"tenant",
			true,
			false,
			true,
			[]string{"project_1"},
			[]string{"hero"},
			now,
			now,
		}}}},
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/assets/library?tenant_id=tenant_2", bytes.NewBufferString(`{"asset_id":"asset_1","project_id":"project_1","visibility":"tenant","favorite":true,"reusable":true,"allowed_projects":["project_1"],"tags":["hero"]}`))
	setSameSiteCSRFHeaders(req)
	req.Header.Set("Idempotency-Key", "asset-library-create-1")
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO asset_library_entries") {
		t.Fatalf("execs = %#v, want asset library insert", db.execs)
	}
	if db.execs[0].args[1] != "tenant_1" || db.execs[0].args[8] != "user_1" {
		t.Fatalf("exec args = %#v, want principal tenant/user", db.execs[0].args)
	}
	bodyText := rec.Body.String()
	if strings.Contains(bodyText, "tenant_2") || strings.Contains(bodyText, "secret-value") {
		t.Fatalf("asset library create response leaked request tenant or secret: %s", bodyText)
	}
}

func TestUpdateAssetLibraryEntryRequiresIdempotencyBeforeStorage(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	db := &fakeStage0DB{}
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/assets/library/library_entry_1", bytes.NewBufferString(`{"favorite":false,"archived":true}`))
	setSameSiteCSRFHeaders(req)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "idempotency_key_required") {
		t.Fatalf("body = %s, want idempotency_key_required", rec.Body.String())
	}
	if len(db.queries) != 0 || len(db.execs) != 0 {
		t.Fatalf("idempotency failure reached storage: queries=%#v execs=%#v", db.queries, db.execs)
	}
}

func TestCreateBrandKitRejectsSecretLikeGuidelinesBeforeStorage(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	db := &fakeStage0DB{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/brand-kits", bytes.NewBufferString(`{"name":"Launch Brand","status":"active","logos":[{"asset_id":"asset_logo_1"}],"palette":[{"name":"Ink","hex":"#111827"}],"guidelines":[{"id":"g1","title":"Key","body":"use `+serverProviderSecretFixture+`"}]}`))
	setSameSiteCSRFHeaders(req)
	req.Header.Set("Idempotency-Key", "brand-kit-create-secret-1")
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "brand kit contains secret-like material") {
		t.Fatalf("body = %s, want secret-like validation", rec.Body.String())
	}
	if len(db.queries) != 0 || len(db.execs) != 0 {
		t.Fatalf("secret-like brand kit reached storage: queries=%#v execs=%#v", db.queries, db.execs)
	}
}

func TestSetProjectDefaultBrandKitUsesPrincipalTenantAndPathProject(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeStage0DB{
		queryRows: []stage0RowSet{
			{rows: [][]any{brandKitStage0Row(now)}},
			{rows: [][]any{brandKitStage0Row(now)}},
		},
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("UPDATE 1"),
		},
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/projects/project_1/brand-kit-default?tenant_id=tenant_2", bytes.NewBufferString(`{"brand_kit_id":"brand_kit_1"}`))
	setSameSiteCSRFHeaders(req)
	req.Header.Set("Idempotency-Key", "brand-kit-default-1")
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), nil)))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(db.execs) != 2 {
		t.Fatalf("exec count = %d, want 2 default binding updates", len(db.execs))
	}
	for _, exec := range db.execs {
		if exec.args[0] != "tenant_1" || exec.args[1] != "project_1" {
			t.Fatalf("exec args = %#v, want principal tenant and path project", exec.args)
		}
		if !strings.Contains(exec.sql, "project_bindings") || !strings.Contains(exec.sql, "WHERE tenant_id = $1") {
			t.Fatalf("default brand kit SQL missing tenant/project binding predicates: %s", exec.sql)
		}
	}
	if strings.Contains(rec.Body.String(), "tenant_2") || strings.Contains(rec.Body.String(), "secret-value") {
		t.Fatalf("default brand kit response leaked requested tenant or secret material: %s", rec.Body.String())
	}
}

func TestTaskStatusRejectsUnsupportedSchemaVersion(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Tasks.SchemaVersion = 1

	repo := &fakeTaskReader{task: task.Task{
		ID:            "task_future",
		TenantID:      "tenant_1",
		Type:          "candidate_set_builder",
		SchemaVersion: 2,
		Status:        task.StatusPending,
		UserStatus:    "pending",
		AppVersion:    "stage0-test",
		WorkerVersion: "stage0-test",
	}}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_future", nil)
	req = req.WithContext(task.ContextWithRepository(req.Context(), repo))
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusConflict, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
	if body["code"] != "unsupported_task_schema" {
		t.Fatalf("code = %v, want unsupported_task_schema", body["code"])
	}
	details, ok := body["details"].(map[string]any)
	if !ok {
		t.Fatalf("details type = %T, want object", body["details"])
	}
	if details["task_schema_version"] != float64(2) {
		t.Fatalf("task_schema_version = %v, want 2", details["task_schema_version"])
	}
	if details["max_schema_version"] != float64(1) {
		t.Fatalf("max_schema_version = %v, want 1", details["max_schema_version"])
	}
}

func TestCreateBatchGenerationRequiresIdempotencyKey(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/project_1/batch-generations", bytes.NewBufferString(`{"workspace_id":"workspace_1","prompt_context":{"text":"Create variants"},"requested_count":2}`))
	setSameSiteCSRFHeaders(req)
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(task.ContextWithBatchStore(req.Context(), &fakeBatchStore{}))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "idempotency_key_required") {
		t.Fatalf("body = %s, want idempotency_key_required", rec.Body.String())
	}
}

func TestCreateBatchGenerationUsesPrincipalScopeAndProjectPath(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	store := &fakeBatchStore{batch: validServerBatch()}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/projects/project_1/batch-generations", bytes.NewBufferString(`{"workspace_id":"workspace_1","prompt_context":{"text":"Create variants","model_hints":["image-fast-v1"],"tool_hint":"image.generate"},"requested_count":2,"allowed_models":["image-fast-v1"]}`))
	setSameSiteCSRFHeaders(req)
	req.Header.Set("Idempotency-Key", "idem_create_batch")
	req.Header.Set("X-Zenari-User-ID", "user_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req = req.WithContext(task.ContextWithBatchStore(req.Context(), store))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if store.createInput.TenantID != "tenant_1" || store.createInput.UserID != "user_1" || store.createInput.ProjectID != "project_1" {
		t.Fatalf("create scope = %#v", store.createInput)
	}
	if store.createInput.IdempotencyKey != "idem_create_batch" {
		t.Fatalf("idempotency = %q", store.createInput.IdempotencyKey)
	}
}

func TestBatchGenerationReadEndpointsUsePrincipalTenant(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	store := &fakeBatchStore{batch: validServerBatch()}

	for _, tc := range []struct {
		name string
		path string
		want string
	}{
		{name: "get batch", path: "/api/v1/batch-generations/batch_1?tenant_id=tenant_2", want: `"id": "batch_1"`},
		{name: "children", path: "/api/v1/batch-generations/batch_1/children?tenant_id=tenant_2", want: `"items"`},
		{name: "progress", path: "/api/v1/batch-generations/batch_1/progress?tenant_id=tenant_2", want: `"retryable"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			req.Header.Set("X-Zenari-User-ID", "user_1")
			req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
			req = req.WithContext(task.ContextWithBatchStore(req.Context(), store))
			rec := httptest.NewRecorder()

			New(cfg, nil).Handler().ServeHTTP(rec, req)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.want) {
				t.Fatalf("body = %s, want %s", rec.Body.String(), tc.want)
			}
			if store.tenantID != "tenant_1" {
				t.Fatalf("tenantID = %q, want tenant_1", store.tenantID)
			}
		})
	}
}

func TestCancelBatchGenerationAndRetryChildRequireIdempotency(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	for _, path := range []string{
		"/api/v1/batch-generations/batch_1/cancel",
		"/api/v1/batch-generation-children/child_1/retry",
	} {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		setSameSiteCSRFHeaders(req)
		req.Header.Set("X-Zenari-User-ID", "user_1")
		req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
		req = req.WithContext(task.ContextWithBatchStore(req.Context(), &fakeBatchStore{batch: validServerBatch()}))
		rec := httptest.NewRecorder()

		New(cfg, nil).Handler().ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s status = %d, want %d: %s", path, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
	}
}

func TestCancelBatchGenerationAndRetryChildCallStore(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	store := &fakeBatchStore{batch: validServerBatch()}
	cancelReq := httptest.NewRequest(http.MethodPost, "/api/v1/batch-generations/batch_1/cancel", nil)
	setSameSiteCSRFHeaders(cancelReq)
	cancelReq.Header.Set("Idempotency-Key", "idem_cancel")
	cancelReq.Header.Set("X-Zenari-User-ID", "user_1")
	cancelReq.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	cancelReq = cancelReq.WithContext(task.ContextWithBatchStore(cancelReq.Context(), store))
	cancelRec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(cancelRec, cancelReq)

	if cancelRec.Code != http.StatusOK {
		t.Fatalf("cancel status = %d, want %d: %s", cancelRec.Code, http.StatusOK, cancelRec.Body.String())
	}
	if store.cancelBatchID != "batch_1" || store.tenantID != "tenant_1" {
		t.Fatalf("cancel call = tenant %q batch %q", store.tenantID, store.cancelBatchID)
	}

	retryReq := httptest.NewRequest(http.MethodPost, "/api/v1/batch-generation-children/child_1/retry", nil)
	setSameSiteCSRFHeaders(retryReq)
	retryReq.Header.Set("Idempotency-Key", "idem_retry")
	retryReq.Header.Set("X-Zenari-User-ID", "user_1")
	retryReq.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	retryReq = retryReq.WithContext(task.ContextWithBatchStore(retryReq.Context(), store))
	retryRec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(retryRec, retryReq)

	if retryRec.Code != http.StatusOK {
		t.Fatalf("retry status = %d, want %d: %s", retryRec.Code, http.StatusOK, retryRec.Body.String())
	}
	if store.retryChildID != "child_1" || store.tenantID != "tenant_1" {
		t.Fatalf("retry call = tenant %q child %q", store.tenantID, store.retryChildID)
	}
}

func TestAdminBatchQueueRuntimeListsSafeProjection(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	store := &fakeAdminBatchQueueStore{
		queueRuntime: []task.AdminBatchQueueRuntime{{
			ID:                       "admin-batch-runtime-batch_1",
			BatchID:                  "batch_1",
			TenantID:                 "tenant_1",
			ProjectID:                "project_1",
			WorkspaceID:              "workspace_1",
			Status:                   task.BatchStatusRunning,
			RequestedCount:           4,
			Running:                  1,
			Retryable:                1,
			WorkerID:                 "worker_stage1_local_1",
			ClaimTimeoutSeconds:      900,
			ProviderID:               "zenari-image-sandbox",
			ModelID:                  "image-fast-v1",
			ToolType:                 "image.generate",
			ProviderStrategyGroupID:  "image-generation-default",
			ProviderSelectionPolicy:  "weighted",
			ProviderConcurrency:      "1/4 provider slots used",
			ProviderModelConcurrency: "1/4 provider-model slots used",
			ClaimLeasePolicy:         "Expired running children with zero committed/refunded quota are requeued before the next claim.",
			DrainPolicy:              "BatchRunner.Drain stops new claims during worker shutdown while already claimed children finish or expire by claim lease.",
			QuotaPolicy:              "Reserve estimate on create, commit actual provider usage on success, and refund remainder on failure, cancel, or safety block.",
			DeadLetterPolicy:         "Retryable failures requeue until max retry count; exhausted or non-retryable failures dead-letter and refund remaining reserved quota.",
			IdempotencyScope:         "batch_child:<child_id>:retry:<retry_count> provider requests plus retry-attempt quota idempotency.",
			NextOperatorAction:       "Inspect failed child retry budget, provider health, and quota ledger before manually retrying.",
			AuditRef:                 "audit:batch_1",
			EvidenceRefs:             []string{"backend/internal/task/batch_repository.go"},
		}},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/batch-generations/queue-runtime?tenant_id=tenant_2&page_size=25", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req = req.WithContext(task.ContextWithBatchStore(req.Context(), store))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if store.queueTenantID != "tenant_1" || store.queueLimit != 25 {
		t.Fatalf("queue call = tenant %q limit %d", store.queueTenantID, store.queueLimit)
	}
	body := rec.Body.String()
	for _, want := range []string{`"batch_id": "batch_1"`, `"provider_strategy_group_id": "image-generation-default"`, `"claim_timeout_seconds": 900`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body = %s, want %s", body, want)
		}
	}
	for _, forbidden := range []string{"prompt_context", "Create variants", "raw_provider_payload"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("admin batch queue leaked %q: %s", forbidden, body)
		}
	}
}

func TestAdminBatchChildrenListsSafeProjection(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	store := &fakeAdminBatchQueueStore{
		children: []task.AdminBatchChildTask{{
			ID:                  "child_1",
			BatchID:             "batch_1",
			TenantID:            "tenant_1",
			Status:              task.ChildStatusFailed,
			ProviderID:          "zenari-image-sandbox",
			ModelID:             "image-fast-v1",
			ToolType:            "image.generate",
			RetryCount:          1,
			MaxRetries:          2,
			WorkerID:            "worker_stage1_local_1",
			ClaimAttempt:        2,
			ClaimExpiresAt:      "2026-06-21T12:30:00Z",
			FanoutStage:         "provider_execution_failed",
			FailureCode:         "provider_unavailable",
			ReviewReason:        "none",
			QuotaEstimateUnits:  4,
			QuotaCommittedUnits: 0,
			QuotaRefundedUnits:  0,
			RetryState:          "retry_available",
			DeadLetterState:     "not_dead_lettered",
			ResultAssetID:       "none",
			CanvasObjectID:      "none",
			VisibleTraceRef:     "trace_projection_child_1",
			ProviderUsageRef:    "provider_usage_child_1_failed",
			IdempotencyKey:      "batch_child:child_1:retry:1",
			OperatorAction:      "Retry is available after provider health and strategy group capacity are checked.",
			AuditRef:            "audit:child_1",
			EvidenceRefs:        []string{"backend/internal/task/batch_repository.go"},
		}},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/batch-generation-children?page_size=25", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminOperator))
	req = req.WithContext(task.ContextWithBatchStore(req.Context(), store))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if store.childTenantID != "tenant_1" || store.childLimit != 25 {
		t.Fatalf("child call = tenant %q limit %d", store.childTenantID, store.childLimit)
	}
	body := rec.Body.String()
	for _, want := range []string{`"id": "child_1"`, `"provider_usage_ref": "provider_usage_child_1_failed"`, `"idempotency_key": "batch_child:child_1:retry:1"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("body = %s, want %s", body, want)
		}
	}
	for _, forbidden := range []string{"prompt_context", "failure_message", "hidden prompt", "raw_provider_payload"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("admin child projection leaked %q: %s", forbidden, body)
		}
	}
}

func TestAdminBatchQueueRejectsInsufficientRoleBeforeReader(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true
	store := &fakeAdminBatchQueueStore{}
	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/batch-generations/queue-runtime?page_size=25", nil)
	req.Header.Set("X-Zenari-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenari-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenari-Roles", string(auth.RoleAdminViewer))
	req = req.WithContext(task.ContextWithBatchStore(req.Context(), store))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusForbidden, rec.Body.String())
	}
	if store.queueCalls != 0 || store.childCalls != 0 {
		t.Fatalf("reader was called before authorization: queue=%d child=%d", store.queueCalls, store.childCalls)
	}
	if !strings.Contains(rec.Body.String(), string(auth.PermissionAuditRead)) {
		t.Fatalf("body = %s, want required audit permission", rec.Body.String())
	}
}

type fakeTaskReader struct {
	task        task.Task
	tenantID    string
	requireSame bool
}

func (f *fakeTaskReader) Get(_ context.Context, tenantID, taskID string) (task.Task, error) {
	f.tenantID = tenantID
	if taskID != f.task.ID {
		return task.Task{}, task.ErrNotFound
	}
	if f.requireSame && tenantID != f.task.TenantID {
		return task.Task{}, task.ErrNotFound
	}
	return f.task, nil
}

type fakeAuditSearcher struct {
	filters audit.SearchFilters
	page    audit.Page
	err     error
}

func (f *fakeAuditSearcher) Search(_ context.Context, filters audit.SearchFilters) (audit.Page, error) {
	f.filters = filters
	if f.err != nil {
		return audit.Page{}, f.err
	}
	return f.page, nil
}

type fakeAuditRecorder struct {
	events []audit.Event
	err    error
}

func (f *fakeAuditRecorder) Record(_ context.Context, event audit.Event) error {
	if f.err != nil {
		return f.err
	}
	event.Metadata = security.RedactMap(event.Metadata)
	f.events = append(f.events, event)
	return nil
}

type serverObjectStore struct {
	deleteErr error
}

type fakeBillingProvider struct {
	session               billing.CheckoutSession
	checkoutErr           error
	tenantID              string
	userID                string
	planID                string
	portal                billing.BillingPortalSession
	portalErr             error
	portalTenantID        string
	portalUserID          string
	portalCustomerID      string
	cancelled             billing.SubscriptionCancellation
	cancelErr             error
	cancelSubscriptionID  string
	invoices              billing.BillingInvoicePage
	invoicesErr           error
	invoiceSubscriptionID string
	webhookPayload        []byte
	webhookSignature      string
	webhookErr            error
	seatSync              billing.TeamSeatSyncResult
	seatSyncErr           error
	seatSyncRequest       billing.TeamSeatProviderRequest
	seatSyncCalled        bool
}

func (p *fakeBillingProvider) CreateCheckout(_ context.Context, tenantID, userID, planID string) (billing.CheckoutSession, error) {
	p.tenantID = tenantID
	p.userID = userID
	p.planID = planID
	if p.checkoutErr != nil {
		return billing.CheckoutSession{}, p.checkoutErr
	}
	session := p.session
	session.TenantID = tenantID
	session.UserID = userID
	return session, nil
}

func (p *fakeBillingProvider) CreatePortalSession(_ context.Context, tenantID, userID, customerID, returnURL string) (billing.BillingPortalSession, error) {
	p.portalTenantID = tenantID
	p.portalUserID = userID
	p.portalCustomerID = customerID
	if p.portalErr != nil {
		return billing.BillingPortalSession{}, p.portalErr
	}
	session := p.portal
	session.TenantID = tenantID
	session.UserID = userID
	if session.RedirectURL == "" {
		session.RedirectURL = returnURL
	}
	return session, nil
}

func (p *fakeBillingProvider) CancelSubscription(_ context.Context, subscriptionID string) (billing.SubscriptionCancellation, error) {
	p.cancelSubscriptionID = subscriptionID
	if p.cancelErr != nil {
		return billing.SubscriptionCancellation{}, p.cancelErr
	}
	return p.cancelled, nil
}

func (p *fakeBillingProvider) ListInvoices(_ context.Context, subscriptionID string) (billing.BillingInvoicePage, error) {
	p.invoiceSubscriptionID = subscriptionID
	if p.invoicesErr != nil {
		return billing.BillingInvoicePage{}, p.invoicesErr
	}
	return p.invoices, nil
}

func (p *fakeBillingProvider) SyncTeamSeatQuantity(_ context.Context, request billing.TeamSeatProviderRequest) (billing.TeamSeatSyncResult, error) {
	p.seatSyncCalled = true
	p.seatSyncRequest = request
	if p.seatSyncErr != nil {
		return billing.TeamSeatSyncResult{}, p.seatSyncErr
	}
	if p.seatSync.ID != "" {
		return p.seatSync, nil
	}
	return billing.TeamSeatSyncResult{
		ID:                         "team_seat_sync_1",
		TenantID:                   request.TenantID,
		TeamID:                     request.TeamID,
		Provider:                   "stripe",
		ProviderSubscriptionID:     request.ProviderSubscriptionID,
		ProviderSubscriptionItemID: request.ProviderSubscriptionItemID,
		PriceID:                    request.PriceID,
		RequestedQuantity:          request.Quantity,
		SyncedQuantity:             request.Quantity,
		ProrationBehavior:          request.ProrationBehavior,
		Status:                     "synced",
		Operation:                  request.Operation,
		IdempotencyKey:             request.IdempotencyKey,
		CreatedAt:                  request.RequestedAt,
	}, nil
}

func (p *fakeBillingProvider) HandleWebhook(_ context.Context, payload []byte, signature string) error {
	p.webhookPayload = append([]byte(nil), payload...)
	p.webhookSignature = signature
	return p.webhookErr
}

type fakeTeamService struct {
	createCalled bool
	createTeam   team.Team
	createOwner  team.Member
	createResult team.Team
	createErr    error

	inviteCalled bool
	invite       team.Invite
	inviteResult team.Invite
	inviteErr    error

	acceptCalled   bool
	acceptTenantID string
	acceptTeamID   string
	acceptInviteID string
	acceptUserID   string
	acceptResult   team.Member
	acceptErr      error

	removeCalled   bool
	removeTenantID string
	removeTeamID   string
	removeMemberID string
	removeBy       string
	removeErr      error

	getSeatCalled   bool
	getSeatTenantID string
	getSeatTeamID   string
	usage           team.SeatUsage
	usageErr        error

	entitlementCalled   bool
	entitlementTenantID string
	entitlementTeamID   string
	additionalSeats     int
	decision            team.EntitlementDecision
	decisionErr         error
}

func (s *fakeTeamService) CreateTeam(_ context.Context, input team.Team, owner team.Member) (team.Team, error) {
	s.createCalled = true
	s.createTeam = input
	s.createOwner = owner
	if s.createErr != nil {
		return team.Team{}, s.createErr
	}
	if s.createResult.ID != "" {
		return s.createResult, nil
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	input.CreatedAt = now
	return input, nil
}

func (s *fakeTeamService) InviteMember(_ context.Context, invite team.Invite) (team.Invite, error) {
	s.inviteCalled = true
	s.invite = invite
	if s.inviteErr != nil {
		return team.Invite{}, s.inviteErr
	}
	if s.inviteResult.ID != "" {
		return s.inviteResult, nil
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	invite.ID = "team_invite_1"
	invite.CreatedAt = now
	if invite.ExpiresAt.IsZero() {
		invite.ExpiresAt = now.Add(7 * 24 * time.Hour)
	}
	return invite, nil
}

func (s *fakeTeamService) AcceptInvite(_ context.Context, tenantID, teamID, inviteID, userID string, _ time.Time) (team.Member, error) {
	s.acceptCalled = true
	s.acceptTenantID = tenantID
	s.acceptTeamID = teamID
	s.acceptInviteID = inviteID
	s.acceptUserID = userID
	if s.acceptErr != nil {
		return team.Member{}, s.acceptErr
	}
	if s.acceptResult.ID != "" {
		return s.acceptResult, nil
	}
	return team.Member{
		ID:       "team_member:" + teamID + ":" + userID,
		TeamID:   teamID,
		TenantID: tenantID,
		UserID:   userID,
		Role:     team.RoleMember,
		Status:   team.MemberActive,
	}, nil
}

func (s *fakeTeamService) RemoveMember(_ context.Context, tenantID, teamID, memberID, removedBy string, _ time.Time) error {
	s.removeCalled = true
	s.removeTenantID = tenantID
	s.removeTeamID = teamID
	s.removeMemberID = memberID
	s.removeBy = removedBy
	return s.removeErr
}

func (s *fakeTeamService) GetSeatUsage(_ context.Context, tenantID, teamID string) (team.SeatUsage, error) {
	s.getSeatCalled = true
	s.getSeatTenantID = tenantID
	s.getSeatTeamID = teamID
	if s.usageErr != nil {
		return team.SeatUsage{}, s.usageErr
	}
	return s.usage, nil
}

func (s *fakeTeamService) CheckSeatEntitlement(_ context.Context, tenantID, teamID string, additionalSeats int) (team.EntitlementDecision, error) {
	s.entitlementCalled = true
	s.entitlementTenantID = tenantID
	s.entitlementTeamID = teamID
	s.additionalSeats = additionalSeats
	if s.decisionErr != nil {
		return team.EntitlementDecision{}, s.decisionErr
	}
	return s.decision, nil
}

func (s *fakeTeamService) called() bool {
	return s.createCalled || s.inviteCalled || s.acceptCalled || s.removeCalled || s.getSeatCalled || s.entitlementCalled
}

type fakeTeamSeatBillingSyncer struct {
	called bool
	input  billing.TeamSeatSyncInput
	result billing.TeamSeatSyncResult
	err    error
}

func (s *fakeTeamSeatBillingSyncer) SyncTeamSeatQuantity(_ context.Context, input billing.TeamSeatSyncInput) (billing.TeamSeatSyncResult, error) {
	s.called = true
	s.input = input
	if s.err != nil {
		return billing.TeamSeatSyncResult{}, s.err
	}
	if s.result.ID != "" {
		return s.result, nil
	}
	return billing.TeamSeatSyncResult{
		ID:                "team_seat_sync_1",
		TenantID:          input.TenantID,
		TeamID:            input.TeamID,
		Provider:          "stripe",
		RequestedQuantity: input.Usage.BillableSeats,
		SyncedQuantity:    input.Usage.BillableSeats,
		ProrationBehavior: "create_prorations",
		Status:            "synced",
		Operation:         input.Operation,
		IdempotencyKey:    input.IdempotencyKey,
		CreatedAt:         input.RequestedAt,
	}, nil
}

type fakeTeamSeatBillingManager struct {
	fakeTeamSeatBillingSyncer

	getLinkCalled   bool
	getLinkTenantID string
	getLinkTeamID   string
	link            billing.TeamBillingLink
	getLinkErr      error

	upsertCalled bool
	upsertInput  billing.TeamBillingLinkInput
	upsertErr    error

	listSyncsCalled   bool
	listSyncsTenantID string
	listSyncsTeamID   string
	listSyncsLimit    int
	syncPage          billing.TeamSeatSyncPage
	listSyncsErr      error
}

func (m *fakeTeamSeatBillingManager) GetTeamBillingLink(_ context.Context, tenantID, teamID string) (billing.TeamBillingLink, error) {
	m.getLinkCalled = true
	m.getLinkTenantID = tenantID
	m.getLinkTeamID = teamID
	if m.getLinkErr != nil {
		return billing.TeamBillingLink{}, m.getLinkErr
	}
	if m.link.TeamID != "" {
		return m.link, nil
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	return billing.TeamBillingLink{
		TenantID:                   tenantID,
		TeamID:                     teamID,
		Provider:                   "stripe",
		ProviderSubscriptionID:     "sub_test_001",
		ProviderSubscriptionItemID: "si_test_team_seats",
		PriceID:                    "price_team_seat",
		ProrationBehavior:          "create_prorations",
		Status:                     "active",
		Metadata:                   map[string]any{},
		CreatedAt:                  now,
		UpdatedAt:                  now,
	}, nil
}

func (m *fakeTeamSeatBillingManager) UpsertTeamBillingLink(_ context.Context, input billing.TeamBillingLinkInput) (billing.TeamBillingLink, error) {
	m.upsertCalled = true
	m.upsertInput = input
	if m.upsertErr != nil {
		return billing.TeamBillingLink{}, m.upsertErr
	}
	now := input.RequestedAt
	if now.IsZero() {
		now = time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	}
	return billing.TeamBillingLink{
		TenantID:                   input.TenantID,
		TeamID:                     input.TeamID,
		Provider:                   firstNonEmpty(input.Provider, "stripe"),
		ProviderSubscriptionID:     input.ProviderSubscriptionID,
		ProviderSubscriptionItemID: input.ProviderSubscriptionItemID,
		PriceID:                    input.PriceID,
		ProrationBehavior:          firstNonEmpty(input.ProrationBehavior, "create_prorations"),
		Status:                     firstNonEmpty(input.Status, "active"),
		Metadata:                   security.RedactMap(input.Metadata),
		CreatedAt:                  now,
		UpdatedAt:                  now,
	}, nil
}

func (m *fakeTeamSeatBillingManager) ListTeamSeatBillingSyncs(_ context.Context, tenantID, teamID string, limit int) (billing.TeamSeatSyncPage, error) {
	m.listSyncsCalled = true
	m.listSyncsTenantID = tenantID
	m.listSyncsTeamID = teamID
	m.listSyncsLimit = limit
	if m.listSyncsErr != nil {
		return billing.TeamSeatSyncPage{}, m.listSyncsErr
	}
	return m.syncPage, nil
}

type fakeBillingAccountReader struct {
	quota           billing.QuotaState
	quotaErr        error
	subscription    billing.UserSubscriptionProjection
	subscriptionErr error
	tenantID        string
	userID          string
}

func (r *fakeBillingAccountReader) GetQuotaState(_ context.Context, tenantID, userID string) (billing.QuotaState, error) {
	r.tenantID = tenantID
	r.userID = userID
	if r.quotaErr != nil {
		return billing.QuotaState{}, r.quotaErr
	}
	return r.quota, nil
}

func (r *fakeBillingAccountReader) GetSubscription(_ context.Context, tenantID, userID string) (billing.UserSubscriptionProjection, error) {
	r.tenantID = tenantID
	r.userID = userID
	if r.subscriptionErr != nil {
		return billing.UserSubscriptionProjection{}, r.subscriptionErr
	}
	return r.subscription, nil
}

type fakeAdminBillingOperator struct {
	lastCall               string
	manualCreditCalled     bool
	refundNoteCalled       bool
	syncSubscriptionCalled bool
	lockAccountCalled      bool
	manualCreditInput      billing.AdminBillingOperationInput
	refundNoteInput        billing.AdminBillingOperationInput
	syncInput              billing.AdminBillingOperationInput
	lockInput              billing.AdminBillingOperationInput
	result                 billing.AdminBillingOperationResult
	err                    error
}

func (o *fakeAdminBillingOperator) ManualCredit(_ context.Context, input billing.AdminBillingOperationInput) (billing.AdminBillingOperationResult, error) {
	o.lastCall = "manual_credit"
	o.manualCreditCalled = true
	o.manualCreditInput = input
	return o.resultFor(input, "succeeded")
}

func (o *fakeAdminBillingOperator) RecordRefundNote(_ context.Context, input billing.AdminBillingOperationInput) (billing.AdminBillingOperationResult, error) {
	o.lastCall = "refund"
	o.refundNoteCalled = true
	o.refundNoteInput = input
	return o.resultFor(input, "recorded")
}

func (o *fakeAdminBillingOperator) SyncSubscription(_ context.Context, input billing.AdminBillingOperationInput) (billing.AdminBillingOperationResult, error) {
	o.lastCall = "sync"
	o.syncSubscriptionCalled = true
	o.syncInput = input
	return o.resultFor(input, "recorded")
}

func (o *fakeAdminBillingOperator) LockAccount(_ context.Context, input billing.AdminBillingOperationInput) (billing.AdminBillingOperationResult, error) {
	o.lastCall = "lock"
	o.lockAccountCalled = true
	o.lockInput = input
	return o.resultFor(input, "recorded")
}

func (o *fakeAdminBillingOperator) called() bool {
	return o.manualCreditCalled || o.refundNoteCalled || o.syncSubscriptionCalled || o.lockAccountCalled
}

func (o *fakeAdminBillingOperator) resultFor(input billing.AdminBillingOperationInput, status string) (billing.AdminBillingOperationResult, error) {
	if o.err != nil {
		return billing.AdminBillingOperationResult{}, o.err
	}
	if o.result.ID != "" {
		return o.result, nil
	}
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	return billing.AdminBillingOperationResult{
		ID:             "billing_admin_result_1",
		TenantID:       input.TenantID,
		ActorID:        input.ActorID,
		TargetUserID:   input.TargetUserID,
		Operation:      input.Operation,
		IdempotencyKey: input.IdempotencyKey,
		Status:         status,
		Units:          input.Units,
		BucketID:       input.BucketID,
		SubscriptionID: input.SubscriptionID,
		Provider:       input.Provider,
		ProviderRef:    input.ProviderRef,
		Rationale:      input.Rationale,
		Note:           input.Note,
		Locked:         input.Locked,
		Metadata:       security.RedactMap(input.Metadata),
		CreatedAt:      now,
		UpdatedAt:      now,
	}, nil
}

type fakeProviderRegistryReader struct {
	page                 provider.RegistryPage
	err                  error
	called               bool
	limit                int
	create               provider.RegistryCreate
	createResult         provider.RegistryCreateResult
	createErr            error
	createCalled         bool
	update               provider.RegistryUpdate
	updateResult         provider.RegistryUpdateResult
	updateErr            error
	updateCalled         bool
	delete               provider.RegistryDelete
	deleteResult         provider.RegistryDeleteResult
	deleteErr            error
	deleteCalled         bool
	healthProbe          provider.RegistryHealthProbe
	healthProbeResult    provider.RegistryHealthProbeResult
	healthProbeErr       error
	healthProbeCalled    bool
	testCall             provider.SandboxTestCallInput
	testCallResult       provider.SandboxTestCallResult
	testCallErr          error
	testCallCalled       bool
	strategyGroupPage    provider.StrategyGroupPage
	strategyErr          error
	strategyLimit        int
	strategyCalled       bool
	strategyCreate       provider.StrategyGroupCreate
	strategyCreateResult provider.StrategyGroupCreateResult
	strategyCreateErr    error
	strategyCreateCalled bool
	strategyUpdate       provider.StrategyGroupUpdate
	strategyUpdateResult provider.StrategyGroupUpdateResult
	strategyUpdateErr    error
	strategyUpdateCalled bool
}

func (r *fakeProviderRegistryReader) ListAdminRegistry(_ context.Context, limit int) (provider.RegistryPage, error) {
	r.called = true
	r.limit = limit
	if r.err != nil {
		return provider.RegistryPage{}, r.err
	}
	return r.page, nil
}

func (r *fakeProviderRegistryReader) CreateAdminRegistry(_ context.Context, create provider.RegistryCreate) (provider.RegistryCreateResult, error) {
	r.createCalled = true
	r.create = create
	if r.createErr != nil {
		return provider.RegistryCreateResult{}, r.createErr
	}
	return r.createResult, nil
}

func (r *fakeProviderRegistryReader) UpdateAdminRegistry(_ context.Context, update provider.RegistryUpdate) (provider.RegistryUpdateResult, error) {
	r.updateCalled = true
	r.update = update
	if r.updateErr != nil {
		return provider.RegistryUpdateResult{}, r.updateErr
	}
	return r.updateResult, nil
}

func (r *fakeProviderRegistryReader) DeleteAdminRegistry(_ context.Context, delete provider.RegistryDelete) (provider.RegistryDeleteResult, error) {
	r.deleteCalled = true
	r.delete = delete
	if r.deleteErr != nil {
		return provider.RegistryDeleteResult{}, r.deleteErr
	}
	return r.deleteResult, nil
}

func (r *fakeProviderRegistryReader) ProbeAdminRegistryHealth(_ context.Context, probe provider.RegistryHealthProbe) (provider.RegistryHealthProbeResult, error) {
	r.healthProbeCalled = true
	r.healthProbe = probe
	if r.healthProbeErr != nil {
		return provider.RegistryHealthProbeResult{}, r.healthProbeErr
	}
	return r.healthProbeResult, nil
}

func (r *fakeProviderRegistryReader) RunSandboxTestCall(_ context.Context, input provider.SandboxTestCallInput) (provider.SandboxTestCallResult, error) {
	r.testCallCalled = true
	r.testCall = input
	if r.testCallErr != nil {
		return provider.SandboxTestCallResult{}, r.testCallErr
	}
	return r.testCallResult, nil
}

func (r *fakeProviderRegistryReader) ListStrategyGroups(_ context.Context, limit int) (provider.StrategyGroupPage, error) {
	r.strategyCalled = true
	r.strategyLimit = limit
	if r.strategyErr != nil {
		return provider.StrategyGroupPage{}, r.strategyErr
	}
	return r.strategyGroupPage, nil
}

func (r *fakeProviderRegistryReader) CreateStrategyGroup(_ context.Context, create provider.StrategyGroupCreate) (provider.StrategyGroupCreateResult, error) {
	r.strategyCreateCalled = true
	r.strategyCreate = create
	if r.strategyCreateErr != nil {
		return provider.StrategyGroupCreateResult{}, r.strategyCreateErr
	}
	return r.strategyCreateResult, nil
}

func (r *fakeProviderRegistryReader) UpdateStrategyGroup(_ context.Context, update provider.StrategyGroupUpdate) (provider.StrategyGroupUpdateResult, error) {
	r.strategyUpdateCalled = true
	r.strategyUpdate = update
	if r.strategyUpdateErr != nil {
		return provider.StrategyGroupUpdateResult{}, r.strategyUpdateErr
	}
	return r.strategyUpdateResult, nil
}

type fakeProviderStatusClient struct {
	status provider.Status
}

func (c fakeProviderStatusClient) Invoke(context.Context, provider.Request) (provider.Response, error) {
	return provider.Response{}, errors.New("fake provider status client does not invoke")
}

func (c fakeProviderStatusClient) Status(context.Context) provider.Status {
	return c.status
}

func (c fakeProviderStatusClient) Capabilities() []provider.Capability {
	return nil
}

type fakeBatchStore struct {
	batch         task.BatchGenerationRequest
	createInput   task.BatchCreateInput
	tenantID      string
	batchID       string
	cancelBatchID string
	retryChildID  string
	err           error
}

type fakeAdminBatchQueueStore struct {
	fakeBatchStore
	queueRuntime  []task.AdminBatchQueueRuntime
	children      []task.AdminBatchChildTask
	queueTenantID string
	childTenantID string
	queueLimit    int
	childLimit    int
	queueCalls    int
	childCalls    int
}

func (s *fakeAdminBatchQueueStore) ListAdminBatchQueueRuntime(_ context.Context, tenantID string, limit int) ([]task.AdminBatchQueueRuntime, error) {
	s.queueCalls++
	s.queueTenantID = tenantID
	s.queueLimit = limit
	if s.err != nil {
		return nil, s.err
	}
	return s.queueRuntime, nil
}

func (s *fakeAdminBatchQueueStore) ListAdminBatchChildTasks(_ context.Context, tenantID string, limit int) ([]task.AdminBatchChildTask, error) {
	s.childCalls++
	s.childTenantID = tenantID
	s.childLimit = limit
	if s.err != nil {
		return nil, s.err
	}
	return s.children, nil
}

func (s *fakeBatchStore) CreateBatch(_ context.Context, input task.BatchCreateInput) (task.BatchGenerationRequest, error) {
	s.createInput = input
	if s.err != nil {
		return task.BatchGenerationRequest{}, s.err
	}
	batch := s.batch
	batch.TenantID = input.TenantID
	batch.UserID = input.UserID
	batch.ProjectID = input.ProjectID
	batch.WorkspaceID = input.WorkspaceID
	batch.PromptContext = input.PromptContext
	batch.RequestedCount = input.RequestedCount
	batch.AllowedModels = input.AllowedModels
	return batch, nil
}

func (s *fakeBatchStore) GetBatch(_ context.Context, tenantID, batchID string) (task.BatchGenerationRequest, error) {
	s.tenantID = tenantID
	s.batchID = batchID
	if s.err != nil {
		return task.BatchGenerationRequest{}, s.err
	}
	if s.batch.ID != batchID {
		return task.BatchGenerationRequest{}, task.ErrNotFound
	}
	return s.batch, nil
}

func (s *fakeBatchStore) ListBatchChildren(_ context.Context, tenantID, batchID string) ([]task.GenerationChildTask, error) {
	s.tenantID = tenantID
	s.batchID = batchID
	if s.err != nil {
		return nil, s.err
	}
	if s.batch.ID != batchID {
		return nil, task.ErrNotFound
	}
	return s.batch.Children, nil
}

func (s *fakeBatchStore) GetBatchProgress(_ context.Context, tenantID, batchID string) (task.BatchProgress, error) {
	s.tenantID = tenantID
	s.batchID = batchID
	if s.err != nil {
		return task.BatchProgress{}, s.err
	}
	if s.batch.ID != batchID {
		return task.BatchProgress{}, task.ErrNotFound
	}
	return task.BuildBatchProgress(s.batch), nil
}

func (s *fakeBatchStore) CancelBatch(_ context.Context, tenantID, batchID string) (task.BatchGenerationRequest, error) {
	s.tenantID = tenantID
	s.cancelBatchID = batchID
	if s.err != nil {
		return task.BatchGenerationRequest{}, s.err
	}
	batch := s.batch
	batch.Status = task.BatchStatusCancelled
	return batch, nil
}

func (s *fakeBatchStore) RetryChild(_ context.Context, tenantID, childID string) (task.GenerationChildTask, error) {
	s.tenantID = tenantID
	s.retryChildID = childID
	if s.err != nil {
		return task.GenerationChildTask{}, s.err
	}
	for _, child := range s.batch.Children {
		if child.ID == childID {
			child.Status = task.ChildStatusQueued
			child.RetryCount++
			child.FailureCode = ""
			child.FailureMessage = ""
			return child, nil
		}
	}
	return task.GenerationChildTask{}, task.ErrNotFound
}

func (s *fakeBatchStore) MarkChildRetryScheduled(_ context.Context, input task.CompleteChildFailureInput) (task.GenerationChildTask, error) {
	s.tenantID = input.TenantID
	s.retryChildID = input.ChildID
	if s.err != nil {
		return task.GenerationChildTask{}, s.err
	}
	for _, child := range s.batch.Children {
		if child.ID == input.ChildID {
			child.Status = task.ChildStatusQueued
			child.RetryCount++
			child.FailureCode = input.FailureCode
			child.FailureMessage = input.FailureMessage
			return child, nil
		}
	}
	return task.GenerationChildTask{}, task.ErrNotFound
}

func (s *fakeBatchStore) BlockChildForReview(_ context.Context, input task.BlockChildForReviewInput) (task.GenerationChildTask, error) {
	s.tenantID = input.TenantID
	if s.err != nil {
		return task.GenerationChildTask{}, s.err
	}
	for _, child := range s.batch.Children {
		if child.ID == input.ChildID {
			child.Status = task.ChildStatusBlocked
			child.ReviewReason = input.ReviewReason
			child.FailureCode = ""
			child.FailureMessage = ""
			child.QuotaRefundedUnits += input.QuotaRefundedUnits
			return child, nil
		}
	}
	return task.GenerationChildTask{}, task.ErrNotFound
}

func (s *fakeBatchStore) ClaimRunnableChildren(_ context.Context, policy task.BatchSchedulePolicy) (task.BatchScheduleClaim, error) {
	if s.err != nil {
		return task.BatchScheduleClaim{}, s.err
	}
	return task.BatchScheduleClaim{
		Children:      nil,
		TenantRunning: 0,
	}, nil
}

func validServerBatch() task.BatchGenerationRequest {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	return task.BatchGenerationRequest{
		ID:          "batch_1",
		TenantID:    "tenant_1",
		UserID:      "user_1",
		ProjectID:   "project_1",
		WorkspaceID: "workspace_1",
		PromptContext: task.PromptContext{
			Text:       "Create variants",
			ModelHints: []string{"image-fast-v1"},
			ToolHint:   "image.generate",
		},
		RequestedCount:      2,
		AllowedModels:       []string{"image-fast-v1"},
		QuotaReservationID:  "quota_reservation_1",
		QuotaEstimatedUnits: 8,
		TraceID:             "trace_batch_1",
		Status:              task.BatchStatusRunning,
		Children: []task.GenerationChildTask{
			{
				ID:                 "child_1",
				BatchID:            "batch_1",
				TenantID:           "tenant_1",
				Status:             task.ChildStatusFailed,
				ProviderID:         "zenari-image-sandbox",
				ModelID:            "image-fast-v1",
				ToolType:           "image.generate",
				RetryCount:         0,
				MaxRetries:         2,
				QuotaEstimateUnits: 4,
				QuotaRefundedUnits: 4,
				TraceID:            "trace_child_1",
				VisibleTraceRef:    "trace_projection_1",
				FailureCode:        "provider_unavailable",
				CreatedAt:          now,
				UpdatedAt:          now,
			},
			{
				ID:                 "child_2",
				BatchID:            "batch_1",
				TenantID:           "tenant_1",
				Status:             task.ChildStatusRunning,
				ProviderID:         "zenari-image-sandbox",
				ModelID:            "image-fast-v1",
				ToolType:           "image.generate",
				MaxRetries:         2,
				QuotaEstimateUnits: 4,
				TraceID:            "trace_child_2",
				VisibleTraceRef:    "trace_projection_2",
				CreatedAt:          now,
				UpdatedAt:          now,
			},
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func (s *serverObjectStore) Put(_ context.Context, object objectstore.Object, _ io.Reader) (objectstore.Object, error) {
	return object, nil
}

func (s *serverObjectStore) Get(_ context.Context, _ string, _ string) (objectstore.Reader, error) {
	return objectstore.Reader{}, objectstore.ErrNotFound
}

func (s *serverObjectStore) SignGetURL(_ context.Context, _ string, _ string, _ time.Duration) (string, error) {
	return "", nil
}

func (s *serverObjectStore) Delete(_ context.Context, _ string, _ string) error {
	return s.deleteErr
}

func (s *serverObjectStore) CleanupExpired(_ context.Context, _ time.Time) (int, error) {
	return 0, nil
}

func (s *serverObjectStore) CleanupExpiredForTenant(_ context.Context, _ string, _ time.Time) (int, error) {
	return 0, nil
}

type serverCaptureScanner struct {
	calls  int
	target security.MalwareScanTarget
	result security.MalwareScanResult
	err    error
}

func (s *serverCaptureScanner) Scan(_ context.Context, target security.MalwareScanTarget) (security.MalwareScanResult, error) {
	s.calls++
	s.target = target
	if s.err != nil {
		return security.MalwareScanResult{}, s.err
	}
	return s.result, nil
}

type noExecDB struct{}

func (noExecDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	panic("Exec must not be called for invalid upload validation")
}

func (noExecDB) Query(context.Context, string, ...any) (store.Rows, error) {
	panic("Query must not be called for invalid upload validation")
}

func setSameSiteCSRFHeaders(req *http.Request) {
	req.Header.Set("Origin", "http://localhost:26080")
	req.Header.Set("X-Zenari-CSRF", "same-site-origin-check")
}

func findCookie(cookies []*http.Cookie, name string) *http.Cookie {
	for _, cookie := range cookies {
		if cookie.Name == name {
			return cookie
		}
	}
	return nil
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal JSON: %v", err)
	}
	return string(data)
}

func (noExecDB) QueryRow(context.Context, string, ...any) store.Row {
	panic("QueryRow must not be called for invalid upload validation")
}

type downloadGuardDB struct {
	query stage0QueryCall
	execs []stage0QueryCall
	found bool
}

func (d *downloadGuardDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	d.execs = append(d.execs, stage0QueryCall{sql: sql, args: args})
	return pgconn.CommandTag{}, nil
}

func (downloadGuardDB) Query(context.Context, string, ...any) (store.Rows, error) {
	panic("Query must not be called for signed download guard")
}

func (d *downloadGuardDB) QueryRow(_ context.Context, sql string, args ...any) store.Row {
	d.query = stage0QueryCall{sql: sql, args: args}
	if d.found {
		return downloadGuardRow{row: []any{
			"object_1",
			"tenant_1",
			"project_1",
			"user_1",
			"export",
			"signed-download-test",
			"tenants/tenant_1/exports/export_1.zip",
			"application/zip",
			int64(9),
			"sha256:test",
			"local",
			"active",
			nil,
			nil,
			[]byte(`{"download_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","public":"ok"}`),
			time.Date(2026, 5, 27, 0, 0, 0, 0, time.UTC),
		}}
	}
	return downloadGuardRow{err: pgx.ErrNoRows}
}

type downloadGuardRow struct {
	err error
	row []any
}

func (r downloadGuardRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i := range dest {
		assignScan(dest[i], r.row[i])
	}
	return nil
}

type fakeStage0DB struct {
	queryRows []stage0RowSet
	queries   []stage0QueryCall
	execs     []stage0QueryCall
	execTags  []pgconn.CommandTag
}

type stage0RowSet struct {
	rows [][]any
}

type stage0QueryCall struct {
	sql  string
	args []any
}

func (f *fakeStage0DB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execs = append(f.execs, stage0QueryCall{sql: sql, args: args})
	if len(f.execTags) == 0 {
		return pgconn.CommandTag{}, nil
	}
	tag := f.execTags[0]
	f.execTags = f.execTags[1:]
	return tag, nil
}

func (f *fakeStage0DB) Query(_ context.Context, sql string, args ...any) (store.Rows, error) {
	f.queries = append(f.queries, stage0QueryCall{sql: sql, args: args})
	if len(f.queryRows) == 0 {
		return &stage0Rows{}, nil
	}
	rows := f.queryRows[0]
	f.queryRows = f.queryRows[1:]
	return &stage0Rows{rows: rows.rows}, nil
}

func (f *fakeStage0DB) QueryRow(_ context.Context, sql string, args ...any) store.Row {
	f.queries = append(f.queries, stage0QueryCall{sql: sql, args: args})
	if len(f.queryRows) > 0 {
		rows := f.queryRows[0]
		f.queryRows = f.queryRows[1:]
		if len(rows.rows) > 0 {
			return stage0Row{row: rows.rows[0]}
		}
	}
	return stage0Row{err: pgx.ErrNoRows}
}

type stage0Rows struct {
	rows  [][]any
	index int
}

func (r *stage0Rows) Close() {}

func (r *stage0Rows) Err() error {
	return nil
}

func (r *stage0Rows) Next() bool {
	if r.index >= len(r.rows) {
		return false
	}
	r.index++
	return true
}

func (r *stage0Rows) Scan(dest ...any) error {
	row := r.rows[r.index-1]
	for i := range dest {
		assignScan(dest[i], row[i])
	}
	return nil
}

type stage0Row struct {
	err error
	row []any
}

func (r stage0Row) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i := range dest {
		assignScan(dest[i], r.row[i])
	}
	return nil
}

func assignScan(dest any, value any) {
	switch ptr := dest.(type) {
	case *string:
		*ptr = value.(string)
	case **string:
		if value == nil {
			*ptr = nil
			return
		}
		switch v := value.(type) {
		case string:
			*ptr = &v
		case *string:
			*ptr = v
		default:
			panic("unsupported nullable string scan value")
		}
	case *[]byte:
		if value == nil {
			*ptr = nil
			return
		}
		*ptr = value.([]byte)
	case *int:
		*ptr = value.(int)
	case *int64:
		*ptr = value.(int64)
	case *[]string:
		*ptr = value.([]string)
	case *bool:
		*ptr = value.(bool)
	case *float64:
		*ptr = value.(float64)
	case *time.Time:
		*ptr = value.(time.Time)
	case **time.Time:
		if value == nil {
			*ptr = nil
			return
		}
		switch v := value.(type) {
		case time.Time:
			*ptr = &v
		case *time.Time:
			*ptr = v
		default:
			panic("unsupported nullable time scan value")
		}
	default:
		panic("unsupported scan destination")
	}
}

func brandKitStage0Row(now time.Time) []any {
	return []any{
		"brand_kit_1",
		"Aurora Retail",
		"active",
		[]byte(`[{"asset_id":"asset_logo_1","object_metadata_id":"object_logo_1","usage":"primary"}]`),
		[]byte(`[{"name":"Ink","hex":"#111827","role":"primary"}]`),
		[]byte(`[{"family":"Inter","asset_id":"asset_font_1","role":"body"}]`),
		[]byte(`[{"id":"guideline_1","title":"Logo","body":"Keep the logo clear. api_key=secret-value","severity":"required"}]`),
		[]byte(`[{"kind":"asset_library","asset_id":"asset_logo_1","trace_id":"trace_1"}]`),
		[]byte(`[{"project_id":"project_1","default":true}]`),
		now,
		now,
	}
}
