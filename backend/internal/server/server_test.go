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
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

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
	handler := withRequestID(withRecover(logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("provider key sk-proj-abcdefghijklmnopqrstuvwxyz123456")
	})))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tasks/task_123", nil)
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	line := logs.String()
	if strings.Contains(line, "sk-proj-abcdefghijklmnopqrstuvwxyz123456") {
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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

func TestSecurityHeadersAndCORS(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", rec.Header().Get("X-Content-Type-Options"))
	}
	if rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("X-Frame-Options = %q, want DENY", rec.Header().Get("X-Frame-Options"))
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(noExecDB{}), objects)))
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req.Header.Set("X-Zenart-User-ID", "user_2")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_2")
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
	downloadURL, err := objects.SignGetURL(context.Background(), "tenant_1", stored.Key, time.Minute)
	if err != nil {
		t.Fatalf("SignGetURL() error = %v", err)
	}

	db := &downloadGuardDB{found: true}
	auditRecorder := &fakeAuditRecorder{}
	req := httptest.NewRequest(http.MethodGet, downloadURL, nil)
	req = req.WithContext(stage0.ContextWithService(req.Context(), stage0.NewService(stage0.NewRepository(db), objects)))
	req = req.WithContext(audit.ContextWithRecorder(req.Context(), auditRecorder))
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if rec.Body.String() != "zip-bytes" {
		t.Fatalf("download body = %q, want zip-bytes", rec.Body.String())
	}
	if rec.Header().Get("X-ZenArt-Object-Key") != "" {
		t.Fatalf("object key header should not disclose tenant-scoped key: %q", rec.Header().Get("X-ZenArt-Object-Key"))
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req.Header.Set("X-Zenart-User-ID", "admin_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_superadmin")
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
	req.Header.Set("X-Zenart-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_viewer")
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
	req.Header.Set("X-Zenart-User-ID", "admin_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_superadmin")
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
	req.Header.Set("X-Zenart-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_operator")
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
}

func TestAdminExportRegenerateRequiresReviewer(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/regenerate", bytes.NewBufferString(`{"rationale":"retry after failed export","second_reviewer_id":"admin_reviewer_2","second_reviewer_role":"admin_reviewer","second_review_rationale":"approved retry"}`))
	req.Header.Set("X-Zenart-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_viewer")
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
	req.Header.Set("X-Zenart-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_reviewer")
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
	req.Header.Set("X-Zenart-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_reviewer")
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
	req.Header.Set("X-Zenart-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_reviewer")
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
	req.Header.Set("X-Zenart-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_reviewer")
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

func TestAdminExportCleanupRequiresOperator(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/cleanup", bytes.NewBufferString(`{"rationale":"staging retention validation"}`))
	req.Header.Set("X-Zenart-User-ID", "admin_reviewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_reviewer")
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

func TestAdminObjectStorageRetentionPolicySupportsStagingProbeTokens(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/object-storage/retention-policy", nil)
	req.Header.Set("X-Zenart-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_operator")
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
			req.Header.Set("X-Zenart-User-ID", "admin_operator_1")
			req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
			req.Header.Set("X-Zenart-Roles", "admin_operator")
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
			if recorder.events[0].ActorID != "admin_operator_1" || recorder.events[0].Metadata["rationale"] != "stage0 retention cleanup smoke" {
				t.Fatalf("request audit event = %#v", recorder.events[0])
			}
			if recorder.events[0].Metadata["mode"] != cleanupRouteModeForTest(tc.path) {
				t.Fatalf("request audit mode = %#v, want %s", recorder.events[0].Metadata["mode"], cleanupRouteModeForTest(tc.path))
			}
			if recorder.events[1].Resource != "object_storage_cleanup" || recorder.events[1].Metadata["mode"] == "" {
				t.Fatalf("cleanup audit event = %#v", recorder.events[1])
			}
			if recorder.events[1].Metadata["mode"] != cleanupRouteModeForTest(tc.path) {
				t.Fatalf("cleanup audit mode = %#v, want %s", recorder.events[1].Metadata["mode"], cleanupRouteModeForTest(tc.path))
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
	req.Header.Set("X-Zenart-User-ID", "admin_super_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_superadmin")
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
	req.Header.Set("X-Zenart-User-ID", "admin_super_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_superadmin")
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
	req.Header.Set("X-Zenart-User-ID", "admin_super_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_superadmin")
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
	req.Header.Set("X-Zenart-User-ID", "admin_super_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_superadmin")
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
	req.Header.Set("X-Zenart-User-ID", "admin_super_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_superadmin")
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
	req.Header.Set("X-Zenart-User-ID", "admin_super_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_superadmin")
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
	req.Header.Set("X-Zenart-User-ID", "admin_super_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_superadmin")
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
	req.Header.Set("X-Zenart-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_viewer")
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
	req.Header.Set("X-Zenart-User-ID", "admin_operator_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_operator")
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
	req.Header.Set("X-Zenart-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_viewer")
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
	req.Header.Set("X-Zenart-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_viewer")
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
	req.Header.Set("X-Zenart-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_viewer")
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

func TestAdminAnalyticsEventsRequiresAdminViewer(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Auth.AdminDevIdentityHeaders = true

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/analytics/events", nil)
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req.Header.Set("X-Zenart-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_viewer")
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
	req.Header.Set("X-Zenart-User-ID", "admin_viewer_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("X-Zenart-Roles", "admin_viewer")
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1/../tenant_2")
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("Origin", "http://localhost:3000")
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("X-ZenArt-CSRF", "same-site-origin-check")
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if repo.tenantID != "tenant_1" {
		t.Fatalf("tenantID = %q, want tenant_1", repo.tenantID)
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
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
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
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("X-ZenArt-CSRF", "same-site-origin-check")
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
	if len(f.queryRows) > 0 && len(f.queryRows[0].rows) > 0 {
		row := f.queryRows[0].rows[0]
		f.queryRows = f.queryRows[1:]
		return stage0Row{row: row}
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
