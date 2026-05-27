package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/audit"
	"github.com/alphane-ai/zenart/backend/internal/auth"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/health"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/readiness"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/task"
)

type Server struct {
	cfg     config.Config
	checker readiness.Checker
	logger  *slog.Logger
	metrics *Metrics
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
		metrics: NewMetrics(),
		mux:     http.NewServeMux(),
	}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return withRequestID(withRecover(s.logger, withAccessLog(s.logger, s.metrics, withSecurityHeaders(s.cfg.Security, withRuntimeSecurity(s.cfg, s.mux)))))
}

func (s *Server) MetricsHandler() http.Handler {
	return s.metrics.Handler()
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
	s.mux.HandleFunc("POST /api/v1/auth/local/session", s.createLocalSession)
	s.mux.HandleFunc("POST /api/admin/v1/auth/local/session", s.createLocalAdminSession)
	s.mux.Handle("GET /api/v1/tasks/{id}", requirePrincipal(http.HandlerFunc(s.taskStatus)))
	s.mux.Handle("POST /api/v1/uploads", requirePrincipal(http.HandlerFunc(s.createUpload)))
	s.mux.Handle("PUT /api/v1/objects/upload", requirePrincipal(http.HandlerFunc(s.putSignedUploadObject)))
	s.mux.HandleFunc("GET /api/v1/objects/download", s.getSignedDownloadObject)
	s.mux.Handle("POST /api/v1/packages/{id}/exports", requirePrincipal(http.HandlerFunc(s.createExport)))
	s.mux.Handle("GET /api/v1/exports/{id}", requirePrincipal(http.HandlerFunc(s.getExport)))
	s.mux.Handle("POST /api/v1/support/tickets", requirePrincipal(http.HandlerFunc(s.createSupportTicket)))
	s.mux.Handle("GET /api/admin/v1/support/tickets", requirePermission(auth.PermissionSupportRead, http.HandlerFunc(s.listSupportTickets)))
	s.mux.Handle("GET /api/admin/v1/exports", requirePermission(auth.PermissionExportRead, http.HandlerFunc(s.listExports)))
	s.mux.Handle("POST /api/admin/v1/exports/{id}/regenerate", requirePermission(auth.PermissionExportOverrideAdmin, http.HandlerFunc(s.regenerateExport)))
	s.mux.Handle("GET /api/admin/v1/crawler/sources", requirePermission(auth.PermissionCrawlerRead, http.HandlerFunc(s.listCrawlerSources)))
	s.mux.Handle("GET /api/admin/v1/crawler/findings", requirePermission(auth.PermissionCrawlerRead, http.HandlerFunc(s.listCrawlerFindings)))
	s.mux.Handle("POST /api/admin/v1/crawler/sources/{id}/runs", requirePermission(auth.PermissionCrawlerImportAdmin, http.HandlerFunc(s.startCrawlerRun)))
	s.mux.Handle("GET /api/admin/v1/safety/rules", requirePermission(auth.PermissionSafetyRead, http.HandlerFunc(s.listSafetyRules)))
	s.mux.Handle("POST /api/admin/v1/safety/decisions", requirePermission(auth.PermissionSafetyRuleAdmin, http.HandlerFunc(s.enforceSafety)))
	s.mux.Handle("GET /api/admin/v1/analytics/events", requirePermission(auth.PermissionAnalyticsRead, http.HandlerFunc(s.listAnalyticsEvents)))
	s.mux.Handle("GET /api/admin/v1/analytics/reports", requirePermission(auth.PermissionAnalyticsRead, http.HandlerFunc(s.listAnalyticsReports)))
	s.mux.Handle("GET /api/admin/v1/audit", requirePermission(auth.PermissionAuditRead, http.HandlerFunc(s.auditSearch)))
}

func (s *Server) createLocalSession(w http.ResponseWriter, r *http.Request) {
	s.createLocalSessionFor(w, r, localSessionOptions{
		CookieName:   s.cfg.Auth.SessionCookieName,
		Secret:       s.cfg.Auth.SessionSecret,
		TTL:          s.cfg.Auth.SessionTTL,
		DefaultEmail: s.cfg.Auth.LocalSeedUserEmail,
		DefaultRoles: []auth.Role{
			auth.RoleUserOwner,
		},
		Admin: false,
	})
}

func (s *Server) createLocalAdminSession(w http.ResponseWriter, r *http.Request) {
	s.createLocalSessionFor(w, r, localSessionOptions{
		CookieName:   s.cfg.Auth.AdminSessionCookieName,
		Secret:       s.cfg.Auth.AdminSessionSecret,
		TTL:          s.cfg.Auth.AdminSessionTTL,
		DefaultEmail: s.cfg.Auth.LocalSeedAdminEmail,
		DefaultRoles: []auth.Role{
			auth.RoleAdminSuperadmin,
		},
		Admin: true,
	})
}

type localSessionOptions struct {
	CookieName   string
	Secret       string
	TTL          time.Duration
	DefaultEmail string
	DefaultRoles []auth.Role
	Admin        bool
}

func (s *Server) createLocalSessionFor(w http.ResponseWriter, r *http.Request, opts localSessionOptions) {
	if s.cfg.Auth.AccessMode != string(auth.AccessModeLocal) {
		writeError(w, r, http.StatusForbidden, "local_auth_disabled", "local session creation is disabled outside local access mode", nil)
		return
	}
	var input struct {
		Email    string   `json:"email"`
		TenantID string   `json:"tenant_id"`
		Roles    []string `json:"roles"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	email := strings.TrimSpace(input.Email)
	if email == "" {
		email = opts.DefaultEmail
	}
	tenantID := strings.TrimSpace(input.TenantID)
	if tenantID == "" {
		tenantID = "tenant_local"
	}
	roles := parseSessionRoles(input.Roles, opts.DefaultRoles)
	if !rolesAllowedForSession(opts.Admin, roles) {
		writeError(w, r, http.StatusForbidden, "invalid_session_roles", "requested roles are not allowed for this session type", map[string]any{
			"admin_session": opts.Admin,
		})
		return
	}
	session, err := (auth.SessionService{Mode: auth.AccessModeLocal}).CreateLocalSession(email, tenantID, roles, opts.TTL)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "session_validation_error", err.Error(), nil)
		return
	}
	cookieValue, err := signSessionCookie(sessionCookiePayload{
		UserID:    session.UserID,
		TenantID:  session.TenantID,
		Roles:     session.Roles,
		ExpiresAt: session.ExpiresAt.Unix(),
	}, opts.Secret)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "session_cookie_error", "session cookie could not be signed", nil)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     opts.CookieName,
		Value:    cookieValue,
		Path:     "/",
		Domain:   strings.TrimSpace(s.cfg.Auth.SessionCookieDomain),
		Expires:  session.ExpiresAt,
		MaxAge:   int(time.Until(session.ExpiresAt).Seconds()),
		HttpOnly: true,
		Secure:   s.cfg.Auth.SessionCookieSecure,
		SameSite: sessionSameSite(s.cfg.Auth.SessionCookieSameSite),
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":         session.ID,
		"user_id":    session.UserID,
		"tenant_id":  session.TenantID,
		"roles":      session.Roles,
		"expires_at": session.ExpiresAt.Format(time.RFC3339),
		"cookie": map[string]any{
			"name":      opts.CookieName,
			"http_only": true,
			"secure":    s.cfg.Auth.SessionCookieSecure,
			"same_site": strings.ToLower(strings.TrimSpace(s.cfg.Auth.SessionCookieSameSite)),
			"path":      "/",
		},
		"csrf": map[string]any{
			"strategy":     "same-site-origin-check",
			"header_name":  s.cfg.Security.CSRFHeaderName,
			"header_value": s.cfg.Security.CSRFHeaderValue,
		},
	})
}

func rolesAllowedForSession(admin bool, roles []auth.Role) bool {
	if len(roles) == 0 {
		return false
	}
	for _, role := range roles {
		if admin {
			if !auth.IsAdminRole(role) {
				return false
			}
			continue
		}
		if auth.IsAdminRole(role) {
			return false
		}
	}
	return true
}

func parseSessionRoles(values []string, fallback []auth.Role) []auth.Role {
	roles := make([]auth.Role, 0, len(values))
	for _, value := range values {
		if role, ok := auth.ParseRole(value); ok {
			roles = append(roles, role)
		}
	}
	if len(roles) == 0 {
		return fallback
	}
	return roles
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
	principal, _ := PrincipalFromContext(r.Context())
	searcher, ok := audit.SearcherFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "audit_search_not_connected", "audit log search storage is not connected yet", nil)
		return
	}
	page, err := searcher.Search(r.Context(), audit.SearchFilters{
		TenantID: principal.TenantID,
		ActorID:  r.URL.Query().Get("actor_id"),
		Action:   r.URL.Query().Get("action"),
		Resource: r.URL.Query().Get("resource"),
		Limit:    pageSize(r),
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "audit_search_error", "audit log search failed", nil)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) createUpload(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	service, ok := stage0.ServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "upload_service_not_connected", "upload storage is not connected yet", nil)
		return
	}
	var input stage0.UploadCreate
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	upload, err := service.CreateUpload(r.Context(), stage0.UploadOptions{
		TenantID:            principal.TenantID,
		UserID:              principal.UserID,
		Bucket:              s.cfg.ObjectStorage.Bucket,
		Input:               input,
		AllowedContentTypes: s.cfg.Security.AllowedUploadTypes,
		MaxBytes:            s.cfg.Security.MaxUploadBytes,
		URLTTL:              s.cfg.Security.UploadURLTTL,
		SignURL:             s.signUploadURL,
		MalwareFailClosed:   s.cfg.Security.MalwareScanFailClosed,
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
	values := make([]string, 0, 3)
	values = append(values, "key="+urlQueryEscape(key))
	values = append(values, "expires="+strconv.FormatInt(expiresAt.Unix(), 10))
	values = append(values, "sig="+s.signUploadObjectKey(tenantID, key, expiresAt.Unix()))
	return "/api/v1/objects/upload?" + strings.Join(values, "&"), expiresAt
}

func (s *Server) putSignedUploadObject(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	service, ok := stage0.ServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "object_store_not_connected", "object storage is not connected yet", nil)
		return
	}
	key, expires, sig, ok := signedObjectParams(r)
	if !ok {
		writeError(w, r, http.StatusBadRequest, "invalid_signed_object_url", "signed object URL is missing key, expires, or signature", nil)
		return
	}
	if time.Now().UTC().Unix() > expires {
		writeError(w, r, http.StatusForbidden, "signed_url_expired", "signed upload URL has expired", nil)
		return
	}
	if !hmac.Equal([]byte(sig), []byte(s.signUploadObjectKey(principal.TenantID, key, expires))) {
		writeError(w, r, http.StatusForbidden, "signed_url_invalid", "signed upload URL is not valid for this tenant", nil)
		return
	}
	if r.ContentLength > s.cfg.Security.MaxUploadBytes {
		writeError(w, r, http.StatusRequestEntityTooLarge, "upload_too_large", "upload body exceeds configured upload limit", nil)
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if !contentTypeAllowed(contentType, s.cfg.Security.AllowedUploadTypes) {
		writeError(w, r, http.StatusBadRequest, "unsupported_content_type", "upload content type is not allowed", map[string]any{
			"content_type": contentType,
		})
		return
	}
	reader := io.Reader(r.Body)
	if s.cfg.Security.MaxUploadBytes > 0 {
		reader = http.MaxBytesReader(w, r.Body, s.cfg.Security.MaxUploadBytes)
	}
	stored, err := service.PutObject(r.Context(), objectstore.Object{
		TenantID:    principal.TenantID,
		Bucket:      s.cfg.ObjectStorage.Bucket,
		Key:         key,
		ContentType: contentType,
	}, reader)
	if err != nil {
		writeObjectStoreError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"tenant_id":    stored.TenantID,
		"bucket":       stored.Bucket,
		"object_key":   stored.Key,
		"content_type": stored.ContentType,
		"byte_size":    stored.ByteSize,
		"checksum":     stored.Checksum,
		"created_at":   stored.CreatedAt.Format(time.RFC3339),
	})
}

func (s *Server) getSignedDownloadObject(w http.ResponseWriter, r *http.Request) {
	service, ok := stage0.ServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "object_store_not_connected", "object storage is not connected yet", nil)
		return
	}
	key, expires, sig, ok := signedObjectParams(r)
	if !ok {
		writeError(w, r, http.StatusBadRequest, "invalid_signed_object_url", "signed object URL is missing key, expires, or signature", nil)
		return
	}
	if time.Now().UTC().Unix() > expires {
		writeError(w, r, http.StatusForbidden, "signed_url_expired", "signed download URL has expired", nil)
		return
	}
	tenantID, err := tenantIDFromScopedObjectKey(key)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_object_key", "signed download object key must be tenant scoped", nil)
		return
	}
	if !hmac.Equal([]byte(sig), []byte(s.signDownloadObjectKey(key, expires))) {
		writeError(w, r, http.StatusForbidden, "signed_url_invalid", "signed download URL is not valid", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "download_audit_not_connected", "signed download audit logging is not connected yet", nil)
		return
	}
	reader, err := service.GetObject(r.Context(), tenantID, key)
	if err != nil {
		writeDownloadObjectError(w, r, err)
		return
	}
	defer reader.Body.Close()
	if err := recorder.Record(r.Context(), audit.Event{
		ID:       newAuditID(tenantID, "signed_download", key),
		TenantID: tenantID,
		ActorID:  signedDownloadActorID(r),
		Action:   "object.download",
		Resource: "objects/" + key,
		Metadata: map[string]any{
			"object_key":    key,
			"bucket":        reader.Object.Bucket,
			"content_type":  reader.Object.ContentType,
			"byte_size":     reader.Object.ByteSize,
			"expires_at":    time.Unix(expires, 0).UTC().Format(time.RFC3339),
			"request_id":    requestIDFrom(r.Context()),
			"remote_addr":   r.RemoteAddr,
			"user_agent":    r.UserAgent(),
			"signed_access": true,
		},
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "download_audit_record_error", "signed download audit log could not be written", nil)
		return
	}
	if reader.Object.ContentType != "" {
		w.Header().Set("Content-Type", reader.Object.ContentType)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Header().Set("Cache-Control", "private, no-store, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Content-Disposition", `attachment; filename="`+downloadFilenameFromKey(reader.Object.Key)+`"`)
	if reader.Object.ByteSize > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(reader.Object.ByteSize, 10))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, reader.Body)
}

func signedDownloadActorID(r *http.Request) string {
	if principal, ok := principalFromRequest(r); ok && strings.TrimSpace(principal.UserID) != "" {
		return principal.UserID
	}
	return "signed-url"
}

func downloadFilenameFromKey(key string) string {
	key = strings.Trim(strings.TrimSpace(key), "/")
	if key == "" {
		return "download.bin"
	}
	parts := strings.Split(key, "/")
	filename := strings.TrimSpace(parts[len(parts)-1])
	if filename == "" || filename == "." || filename == ".." {
		return "download.bin"
	}
	replacer := strings.NewReplacer(`\`, "_", `/`, "_", `"`, "_", "\r", "_", "\n", "_", ";", "_")
	filename = replacer.Replace(filename)
	if filename == "" {
		return "download.bin"
	}
	return filename
}

func signedObjectParams(r *http.Request) (string, int64, string, bool) {
	key := strings.Trim(strings.TrimSpace(r.URL.Query().Get("key")), "/")
	sig := strings.TrimSpace(r.URL.Query().Get("sig"))
	expires, err := strconv.ParseInt(r.URL.Query().Get("expires"), 10, 64)
	if key == "" || sig == "" || err != nil {
		return "", 0, "", false
	}
	return key, expires, sig, true
}

func (s *Server) signUploadObjectKey(tenantID, objectKey string, expires int64) string {
	payload := fmt.Sprintf("%s:%s:%d", tenantID, strings.Trim(strings.TrimSpace(objectKey), "/"), expires)
	mac := hmac.New(sha256.New, []byte(s.cfg.ObjectStorage.SigningKey))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) signDownloadObjectKey(objectKey string, expires int64) string {
	payload := fmt.Sprintf("%s:%d", strings.Trim(strings.TrimSpace(objectKey), "/"), expires)
	mac := hmac.New(sha256.New, []byte(s.cfg.ObjectStorage.SigningKey))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func tenantIDFromScopedObjectKey(key string) (string, error) {
	key = strings.Trim(strings.TrimSpace(key), "/")
	parts := strings.SplitN(key, "/", 3)
	if len(parts) != 3 || parts[0] != "tenants" || parts[1] == "" || parts[2] == "" {
		return "", errors.New("object key is missing tenant scope")
	}
	if strings.ContainsAny(parts[1], `/\`) || parts[1] == "." || parts[1] == ".." {
		return "", errors.New("tenant_id is invalid")
	}
	return parts[1], nil
}

func contentTypeAllowed(contentType string, allowed []string) bool {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	for _, item := range allowed {
		if contentType == strings.ToLower(strings.TrimSpace(item)) {
			return true
		}
	}
	return false
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
	taskStatus, err := service.CreateExport(r.Context(), principal.TenantID, principal.UserID, r.PathValue("id"), input, s.cfg.Tasks.SchemaVersion)
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
	var input struct {
		Rationale             string `json:"rationale"`
		SecondReviewerID      string `json:"second_reviewer_id"`
		SecondReviewerRole    string `json:"second_reviewer_role"`
		SecondReviewRationale string `json:"second_review_rationale"`
	}
	if err := readOptionalJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	rationale := security.RedactString(strings.TrimSpace(input.Rationale))
	if rationale == "" || rationale == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "rationale_required", "admin export regeneration requires a non-secret rationale", map[string]any{
			"field": "rationale",
		})
		return
	}
	secondReviewerID := strings.TrimSpace(input.SecondReviewerID)
	secondReviewRationale := security.RedactString(strings.TrimSpace(input.SecondReviewRationale))
	if secondReviewerID == "" || secondReviewerID == principal.UserID {
		writeError(w, r, http.StatusBadRequest, "second_review_required", "admin export regeneration requires a distinct second reviewer", map[string]any{
			"field": "second_reviewer_id",
		})
		return
	}
	secondReviewerRole, ok := auth.ParseRole(input.SecondReviewerRole)
	if !ok || !auth.Authorize(r.Context(), auth.Principal{
		UserID:   secondReviewerID,
		TenantID: principal.TenantID,
		Roles:    []auth.Role{secondReviewerRole},
	}, auth.Policy{Required: auth.PermissionExportOverrideAdmin}) {
		writeError(w, r, http.StatusBadRequest, "second_review_required", "admin export regeneration requires a second reviewer with export override permission", map[string]any{
			"field":               "second_reviewer_role",
			"required_permission": string(auth.PermissionExportOverrideAdmin),
		})
		return
	}
	if secondReviewRationale == "" || secondReviewRationale == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "second_review_required", "admin export regeneration requires a non-secret second-review rationale", map[string]any{
			"field": "second_review_rationale",
		})
		return
	}
	exportID := r.PathValue("id")
	export, err := repo.RegenerateExport(r.Context(), principal.TenantID, exportID)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	if recorder, ok := audit.RecorderFromContext(r.Context()); ok {
		if err := recorder.Record(r.Context(), audit.Event{
			ID:       newAuditID(principal.TenantID, principal.UserID, "export.regenerate", exportID),
			TenantID: principal.TenantID,
			ActorID:  principal.UserID,
			Action:   "export.regenerate",
			Resource: "exports/" + exportID,
			Metadata: map[string]any{
				"rationale":               rationale,
				"second_reviewer_id":      secondReviewerID,
				"second_reviewer_role":    string(secondReviewerRole),
				"second_review_rationale": secondReviewRationale,
				"export_id":               exportID,
				"package_id":              export.PackageID,
				"format":                  export.Format,
			},
			CreatedAt: time.Now().UTC(),
		}); err != nil {
			writeError(w, r, http.StatusInternalServerError, "audit_record_error", "admin override audit record could not be written", nil)
			return
		}
	}
	writeJSON(w, http.StatusAccepted, export)
}

func (s *Server) listCrawlerSources(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "crawler_service_not_connected", "crawler storage is not connected yet", nil)
		return
	}
	page, err := repo.ListCrawlerSources(r.Context(), principal.TenantID, r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) listCrawlerFindings(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "crawler_service_not_connected", "crawler storage is not connected yet", nil)
		return
	}
	page, err := repo.ListCrawlerFindings(r.Context(), principal.TenantID, r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) startCrawlerRun(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "crawler_service_not_connected", "crawler storage is not connected yet", nil)
		return
	}
	run, err := repo.StartCrawlerRun(r.Context(), principal.TenantID, r.PathValue("id"), stage0.CrawlerPolicy{
		Enabled:          s.cfg.Crawler.Enabled,
		UserAgent:        s.cfg.Crawler.UserAgent,
		GlobalRPS:        s.cfg.Crawler.GlobalRPS,
		SourceRPS:        s.cfg.Crawler.SourceRPS,
		RawRetentionDays: s.cfg.Crawler.RawRetentionDays,
		BlocklistHosts:   s.cfg.Crawler.BlocklistHosts,
	})
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, run)
}

func (s *Server) listSafetyRules(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "safety_service_not_connected", "safety rule storage is not connected yet", nil)
		return
	}
	page, err := repo.ListSafetyRules(r.Context(), principal.TenantID, r.URL.Query().Get("status"), pageSize(r))
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

func (s *Server) listAnalyticsEvents(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "analytics_service_not_connected", "analytics storage is not connected yet", nil)
		return
	}
	page, err := repo.ListAnalyticsEvents(r.Context(), stage0.AnalyticsEventFilters{
		TenantID:    principal.TenantID,
		EventName:   r.URL.Query().Get("event_name"),
		WorkflowID:  r.URL.Query().Get("workflow_id"),
		SubjectType: r.URL.Query().Get("subject_type"),
		SubjectID:   r.URL.Query().Get("subject_id"),
		Limit:       pageSize(r),
	})
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) listAnalyticsReports(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "analytics_service_not_connected", "analytics storage is not connected yet", nil)
		return
	}
	page, err := repo.ListAnalyticsReports(r.Context(), principal.TenantID, pageSize(r), time.Now().UTC())
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
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

func readOptionalJSON(r *http.Request, target any) error {
	if r.Body == nil || r.ContentLength == 0 {
		return nil
	}
	return readJSON(r, target)
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
	case errors.Is(err, stage0.ErrMalwareBlocked):
		writeError(w, r, http.StatusConflict, "malware_blocked", "upload is blocked by malware scan policy", nil)
	case errors.Is(err, stage0.ErrCrawlerBlocked):
		writeError(w, r, http.StatusConflict, "crawler_blocked", "crawler runtime policy blocked the operation", nil)
	default:
		writeError(w, r, http.StatusInternalServerError, "stage0_service_error", "stage0 service operation failed", nil)
	}
}

func writeObjectStoreError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, objectstore.ErrTenantDenied):
		writeError(w, r, http.StatusForbidden, "object_tenant_denied", "object key is not available for this tenant", nil)
	case errors.Is(err, objectstore.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "object_not_found", "object was not found", nil)
	case errors.Is(err, stage0.ErrMissingRepository):
		writeError(w, r, http.StatusNotImplemented, "object_store_not_connected", "object storage is not connected yet", nil)
	default:
		writeError(w, r, http.StatusInternalServerError, "object_store_error", "object storage operation failed", nil)
	}
}

func writeDownloadObjectError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, stage0.ErrValidation), errors.Is(err, stage0.ErrNotFound):
		writeStage0Error(w, r, err)
	default:
		writeObjectStoreError(w, r, err)
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
				logger.Error("request panic",
					"recover", security.RedactString(fmt.Sprint(recovered)),
					"path", security.RedactString(r.URL.Path),
					"request_id", requestIDFrom(r.Context()),
				)
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

func newAuditID(parts ...string) string {
	seed := strings.Join(parts, ":") + ":" + time.Now().UTC().Format(time.RFC3339Nano)
	sum := sha256.Sum256([]byte(seed))
	return "audit_" + hex.EncodeToString(sum[:12])
}
