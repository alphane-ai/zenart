package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/health"
	"github.com/alphane-ai/zenart/backend/internal/readiness"
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
	return withRequestID(withRecover(s.logger, s.mux))
}

func (s *Server) HTTPServer() *http.Server {
	return &http.Server{
		Addr:              s.cfg.HTTP.Addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: s.cfg.HTTP.ReadHeaderTimeout,
	}
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /healthz", s.healthz)
	s.mux.HandleFunc("GET /readyz", s.readyz)
	s.mux.Handle("GET /api/v1/tasks/{id}", requirePrincipal(http.HandlerFunc(s.taskStatus)))
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
	writeJSON(w, http.StatusOK, taskStatus)
}

func (s *Server) auditSearch(w http.ResponseWriter, r *http.Request) {
	writeError(w, r, http.StatusNotImplemented, "audit_search_not_connected", "audit log search storage is not connected yet", nil)
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
