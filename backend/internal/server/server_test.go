package server

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
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

func TestAdminAuditDeniesNonAdmin(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/v1/audit", nil)
	req.Header.Set("X-Zenart-User-ID", "user_1")
	req.Header.Set("X-Zenart-Tenant-ID", "tenant_1")
	rec := httptest.NewRecorder()

	New(cfg, nil).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestAdminAuditRequiresSuperadmin(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

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

func TestAdminExportRegenerateRequiresReviewer(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/admin/v1/exports/export_1/regenerate", nil)
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

func (noExecDB) QueryRow(context.Context, string, ...any) store.Row {
	panic("QueryRow must not be called for invalid upload validation")
}
