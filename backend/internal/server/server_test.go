package server

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func (noExecDB) QueryRow(context.Context, string, ...any) store.Row {
	panic("QueryRow must not be called for invalid upload validation")
}
