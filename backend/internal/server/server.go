package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/health"
	"github.com/alphane-ai/zenart/backend/internal/readiness"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/task"
)

type Server struct {
	cfg     config.Config
	checker readiness.Checker
	logger  *slog.Logger
	mux     *http.ServeMux
}

func New(cfg config.Config, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{
		cfg:     cfg,
		checker: readiness.New(health.Checks(cfg)...),
		logger:  logger,
		mux:     http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return withRequestID(withRecover(s.logger, withSecurityHeaders(s.cfg.Security, s.mux)))
}

func (s *Server) HTTPServer() *http.Server {
	return NewHTTPServer(s.cfg, s.Handler())
}

func NewHTTPServer(cfg config.Config, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              cfg.HTTP.Addr,
		Handler:           handler,
		ReadHeaderTimeout: cfg.HTTP.ReadHeaderTimeout,
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.healthz)
	s.mux.HandleFunc("GET /readyz", s.readyz)
	s.mux.Handle("GET /api/v1/tasks/{id}", requirePrincipal(http.HandlerFunc(s.taskStatus)))
	s.mux.Handle("POST /api/v1/uploads", requirePrincipal(http.HandlerFunc(s.createUpload)))
	s.mux.Handle("POST /api/v1/packages/{id}/exports", requirePrincipal(http.HandlerFunc(s.createExport)))
	s.mux.Handle("GET /api/v1/exports/{id}", requirePrincipal(http.HandlerFunc(s.getExport)))
	s.mux.Handle("POST /api/v1/support/tickets", requirePrincipal(http.HandlerFunc(s.createSupportTicket)))
	s.mux.Handle("GET /api/admin/v1/support/tickets", requireAdmin(http.HandlerFunc(s.listSupportTickets)))
	s.mux.Handle("GET /api/admin/v1/exports", requireAdmin(http.HandlerFunc(s.listExports)))
	s.mux.Handle("POST /api/admin/v1/exports/{id}/regenerate", requireAdmin(http.HandlerFunc(s.regenerateExport)))
	s.mux.Handle("GET /api/admin/v1/crawler/sources", requireAdmin(http.HandlerFunc(s.listCrawlerSources)))
	s.mux.Handle("GET /api/admin/v1/crawler/findings", requireAdmin(http.HandlerFunc(s.listCrawlerFindings)))
	s.mux.Handle("GET /api/admin/v1/safety/rules", requireAdmin(http.HandlerFunc(s.listSafetyRules)))
	s.mux.Handle("POST /api/admin/v1/safety/decisions", requireAdmin(http.HandlerFunc(s.enforceSafety)))
	s.mux.Handle("GET /api/admin/v1/audit", requireAdmin(http.HandlerFunc(s.auditSearch)))
}

func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"service":     s.cfg.App.ServiceName,
		"environment": s.cfg.App.Environment,
		"request_id":  requestIDFrom(r.Context()),
	})
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	report := s.checker.Run(r.Context())
	status := http.StatusOK
	if report.Status != readiness.StatusOK {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, map[string]any{
		"status":     report.Status,
		"checks":     report.Checks,
		"request_id": requestIDFrom(r.Context()),
	})
}

func (s *Server) taskStatus(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	taskID := r.PathValue("id")
	repo, ok := task.RepositoryFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "task_status_not_connected", "task status storage is not connected yet", map[string]any{
			"task_id":        taskID,
			"tenant_id":      principal.TenantID,
			"schema_version": s.cfg.Tasks.SchemaVersion,
		})
		return
	}
	taskStatus, err := repo.Get(r.Context(), principal.TenantID, taskID)
	if errors.Is(err, task.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "task_not_found", "task was not found for this tenant", map[string]any{"task_id": taskID})
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "task_status_error", "task status lookup failed", nil)
		return
	}
	if err := task.CheckSchemaCompatibility(taskStatus.SchemaVersion, s.cfg.Tasks.SchemaVersion); err != nil {
		var unsupported task.UnsupportedSchemaError
		if errors.As(err, &unsupported) {
			writeError(w, r, http.StatusConflict, "unsupported_task_schema", "task schema version is not supported by this API/worker version", map[string]any{
				"task_id":             taskID,
				"task_schema_version": unsupported.TaskSchemaVersion,
				"max_schema_version":  unsupported.MaxSchemaVersion,
				"action":              "wait_for_deploy_or_retry_after_worker_upgrade",
			})
			return
		}
		writeError(w, r, http.StatusInternalServerError, "task_schema_contract_error", "task schema compatibility check failed", map[string]any{
			"task_id":             taskID,
			"task_schema_version": taskStatus.SchemaVersion,
			"max_schema_version":  s.cfg.Tasks.SchemaVersion,
		})
		return
	}
	writeJSON(w, http.StatusOK, taskStatus)
}

func (s *Server) auditSearch(w http.ResponseWriter, r *http.Request) {
	writeError(w, r, http.StatusNotImplemented, "audit_search_not_connected", "audit log search storage is not connected yet", nil)
}

func (s *Server) createUpload(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "upload_service_not_connected", "upload storage is not connected yet", nil)
		return
	}
	var input stage0.UploadCreate
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	upload, err := repo.CreateUpload(r.Context(), stage0.UploadOptions{
		TenantID:            principal.TenantID,
		UserID:              principal.UserID,
		Bucket:              s.cfg.ObjectStorage.Bucket,
		Input:               input,
		AllowedContentTypes: s.cfg.Security.AllowedUploadTypes,
		MaxBytes:            s.cfg.Security.MaxUploadBytes,
		URLTTL:              s.cfg.Security.UploadURLTTL,
		SignURL:             s.signUploadURL,
	})
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, upload)
}

func (s *Server) signUploadURL(tenantID, objectKey string, ttl time.Duration) (string, time.Time) {
	expiresAt := time.Now().UTC().Add(ttl)
	key := strings.Trim(strings.TrimSpace(objectKey), "/")
	payload := fmt.Sprintf("%s:%s:%d", tenantID, key, expiresAt.Unix())
	mac := hmac.New(sha256.New, []byte(s.cfg.ObjectStorage.SigningKey))
	_, _ = mac.Write([]byte(payload))
	values := make([]string, 0, 3)
	values = append(values, "key="+urlQueryEscape(key))
	values = append(values, "expires="+strconv.FormatInt(expiresAt.Unix(), 10))
	values = append(values, "sig="+hex.EncodeToString(mac.Sum(nil)))
	return "/api/v1/objects/upload?" + strings.Join(values, "&"), expiresAt
}

func (s *Server) createExport(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	service, ok := stage0.ServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "export_service_not_connected", "export service is not connected yet", nil)
		return
	}
	var input stage0.ExportCreate
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	taskStatus, err := service.CreateExport(r.Context(), principal.TenantID, r.PathValue("id"), input, s.cfg.Tasks.SchemaVersion)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, taskStatus)
}

func (s *Server) getExport(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	service, ok := stage0.ServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "export_service_not_connected", "export service is not connected yet", nil)
		return
	}
	export, err := service.GetExport(r.Context(), principal.TenantID, r.PathValue("id"))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, export)
}

func (s *Server) createSupportTicket(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "support_service_not_connected", "support ticket storage is not connected yet", nil)
		return
	}
	var input stage0.SupportTicketCreate
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	ticket, err := repo.CreateSupportTicket(r.Context(), principal.TenantID, principal.UserID, input)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, ticket)
}

func (s *Server) listSupportTickets(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "support_service_not_connected", "support ticket storage is not connected yet", nil)
		return
	}
	page, err := repo.ListSupportTickets(r.Context(), principal.TenantID, r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) listExports(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "export_service_not_connected", "export storage is not connected yet", nil)
		return
	}
	page, err := repo.ListExports(r.Context(), principal.TenantID, r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) regenerateExport(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "export_service_not_connected", "export storage is not connected yet", nil)
		return
	}
	export, err := repo.RegenerateExport(r.Context(), principal.TenantID, r.PathValue("id"))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, export)
}

func (s *Server) listCrawlerSources(w http.ResponseWriter, r *http.Request) {
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "crawler_service_not_connected", "crawler storage is not connected yet", nil)
		return
	}
	page, err := repo.ListCrawlerSources(r.Context(), r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) listCrawlerFindings(w http.ResponseWriter, r *http.Request) {
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "crawler_service_not_connected", "crawler storage is not connected yet", nil)
		return
	}
	page, err := repo.ListCrawlerFindings(r.Context(), r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) listSafetyRules(w http.ResponseWriter, r *http.Request) {
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "safety_service_not_connected", "safety rule storage is not connected yet", nil)
		return
	}
	page, err := repo.ListSafetyRules(r.Context(), r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) enforceSafety(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "safety_service_not_connected", "safety decision storage is not connected yet", nil)
		return
	}
	var input struct {
		SubjectType      string `json:"subject_type"`
		SubjectID        string `json:"subject_id"`
		EnforcementPoint string `json:"enforcement_point"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	decision, err := repo.EnforceSafety(r.Context(), principal.TenantID, input.SubjectType, input.SubjectID, input.EnforcementPoint)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, decision)
}

func stage0RepoFrom(r *http.Request) (stage0.Repository, bool) {
	service, ok := stage0.ServiceFromContext(r.Context())
	if !ok {
		return stage0.Repository{}, false
	}
	return service.Repository(), true
}

func readJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func pageSize(r *http.Request) int {
	size, err := strconv.Atoi(r.URL.Query().Get("page_size"))
	if err != nil || size <= 0 {
		return 50
	}
	if size > 100 {
		return 100
	}
	return size
}

func writeStage0Error(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, stage0.ErrValidation):
		writeError(w, r, http.StatusBadRequest, "validation_error", err.Error(), nil)
	case errors.Is(err, stage0.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "not_found", "requested record was not found for this tenant", nil)
	case errors.Is(err, stage0.ErrSafetyBlocked):
		writeError(w, r, http.StatusConflict, "safety_blocked", "operation is blocked by safety or QA policy", nil)
	default:
		writeError(w, r, http.StatusInternalServerError, "stage0_service_error", "stage0 service operation failed", nil)
	}
}

func urlQueryEscape(value string) string {
	return url.QueryEscape(value)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(payload)
}

func withRecover(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				logger.Error("request panic", "recover", recovered, "path", r.URL.Path)
				writeJSON(w, http.StatusInternalServerError, map[string]any{
					"code":         "internal_error",
					"message":      "internal server error",
					"request_id":   requestIDFrom(r.Context()),
					"details":      map[string]any{},
					"field_errors": []any{},
				})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = time.Now().UTC().Format("20060102150405.000000000")
		}
		w.Header().Set("X-Request-ID", requestID)
		ctx := context.WithValue(r.Context(), requestIDKey{}, requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type requestIDKey struct{}

func requestIDFrom(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey{}).(string)
	return value
}
