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
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/audit"
	"github.com/alphane-ai/zenart/backend/internal/auth"
	"github.com/alphane-ai/zenart/backend/internal/billing"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/health"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/provider"
	"github.com/alphane-ai/zenart/backend/internal/ratelimit"
	"github.com/alphane-ai/zenart/backend/internal/readiness"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/task"
	"github.com/alphane-ai/zenart/backend/internal/team"
)

var scopedObjectTenantIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

type Server struct {
	cfg            config.Config
	checker        readiness.Checker
	logger         *slog.Logger
	metrics        *Metrics
	mux            *http.ServeMux
	malwareScanner security.MalwareScanner
	rateLimiter    ratelimit.Enforcer
}

type Option func(*Server)

func WithMalwareScanner(scanner security.MalwareScanner) Option {
	return func(s *Server) {
		s.malwareScanner = scanner
	}
}

func WithRateLimiter(enforcer ratelimit.Enforcer) Option {
	return func(s *Server) {
		s.rateLimiter = enforcer
	}
}

func New(cfg config.Config, logger *slog.Logger, opts ...Option) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	s := &Server{
		cfg:     cfg,
		checker: readiness.New(health.Checks(cfg)...),
		logger:  logger,
		metrics: NewMetrics(),
		mux:     http.NewServeMux(),
		rateLimiter: ratelimit.NewEnforcer(ratelimit.NewMemoryStore(), ratelimit.Policy{
			Enabled:                     cfg.RateLimit.Enabled,
			UserRequestsPerMinute:       int64(cfg.RateLimit.UserRequestsPerMinute),
			TenantRequestsPerMinute:     int64(cfg.RateLimit.TenantRequestsPerMinute),
			ProviderRequestsPerMinute:   int64(cfg.RateLimit.ProviderRequestsPerMinute),
			AdminActionsPerMinute:       int64(cfg.RateLimit.AdminActionsPerMinute),
			ProviderDailySpendCapCents:  cfg.RateLimit.ProviderDailySpendCapCents,
			ProviderEmergencyKillSwitch: cfg.RateLimit.ProviderEmergencyKillSwitch,
		}),
	}
	for _, opt := range opts {
		if opt != nil {
			opt(s)
		}
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
	s.mux.Handle("GET /api/v1/tasks/{task_id}", requirePrincipal(http.HandlerFunc(s.taskStatus)))
	s.mux.Handle("POST /api/v1/projects/{project_id}/batch-generations", requirePrincipal(withRateLimit(s.rateLimiter, rateLimitRoute{
		Scope:               ratelimit.ScopeUser,
		Action:              "batch_generation.create",
		AuditDeniedAction:   "rate_limit.denied",
		AuditDeniedResource: "batch_generation.create",
	})(http.HandlerFunc(s.createBatchGeneration))))
	s.mux.Handle("GET /api/v1/batch-generations/{batch_id}", requirePrincipal(http.HandlerFunc(s.getBatchGeneration)))
	s.mux.Handle("GET /api/v1/batch-generations/{batch_id}/children", requirePrincipal(http.HandlerFunc(s.listBatchGenerationChildren)))
	s.mux.Handle("GET /api/v1/batch-generations/{batch_id}/progress", requirePrincipal(http.HandlerFunc(s.getBatchGenerationProgress)))
	s.mux.Handle("POST /api/v1/batch-generations/{batch_id}/cancel", requirePrincipal(http.HandlerFunc(s.cancelBatchGeneration)))
	s.mux.Handle("POST /api/v1/batch-generation-children/{child_id}/retry", requirePrincipal(http.HandlerFunc(s.retryBatchGenerationChild)))
	s.mux.Handle("GET /api/v1/quota", requirePrincipal(http.HandlerFunc(s.getQuota)))
	s.mux.Handle("GET /api/v1/billing/subscription", requirePrincipal(http.HandlerFunc(s.getBillingSubscription)))
	s.mux.Handle("POST /api/v1/billing/checkout", requirePrincipal(http.HandlerFunc(s.createBillingCheckout)))
	s.mux.Handle("POST /api/v1/billing/portal", requirePrincipal(http.HandlerFunc(s.createBillingPortal)))
	s.mux.Handle("POST /api/v1/billing/subscription/cancel", requirePrincipal(http.HandlerFunc(s.cancelBillingSubscription)))
	s.mux.Handle("GET /api/v1/billing/invoices", requirePrincipal(http.HandlerFunc(s.listBillingInvoices)))
	s.mux.HandleFunc("POST /api/v1/billing/webhook", s.handleBillingWebhook)
	s.mux.Handle("GET /api/v1/teams/{team_id}/seat-usage", requirePrincipal(http.HandlerFunc(s.getTeamSeatUsage)))
	s.mux.Handle("GET /api/v1/teams/{team_id}/seat-entitlement", requirePrincipal(http.HandlerFunc(s.checkTeamSeatEntitlement)))
	s.mux.Handle("POST /api/v1/teams/{team_id}/invites/{invite_id}/accept", requirePrincipal(http.HandlerFunc(s.acceptTeamInvite)))
	s.mux.Handle("POST /api/v1/uploads", requirePrincipal(http.HandlerFunc(s.createUpload)))
	s.mux.Handle("GET /api/v1/assets/library", requirePrincipal(http.HandlerFunc(s.listAssetLibrary)))
	s.mux.Handle("POST /api/v1/assets/library", requirePrincipal(http.HandlerFunc(s.createAssetLibraryEntry)))
	s.mux.Handle("PATCH /api/v1/assets/library/{entry_id}", requirePrincipal(http.HandlerFunc(s.updateAssetLibraryEntry)))
	s.mux.Handle("GET /api/v1/brand-kits", requirePrincipal(http.HandlerFunc(s.listBrandKits)))
	s.mux.Handle("POST /api/v1/brand-kits", requirePrincipal(http.HandlerFunc(s.createBrandKit)))
	s.mux.Handle("PATCH /api/v1/brand-kits/{brand_kit_id}", requirePrincipal(http.HandlerFunc(s.updateBrandKit)))
	s.mux.Handle("GET /api/v1/projects/{project_id}/brand-kit-default", requirePrincipal(http.HandlerFunc(s.getProjectDefaultBrandKit)))
	s.mux.Handle("PUT /api/v1/projects/{project_id}/brand-kit-default", requirePrincipal(http.HandlerFunc(s.setProjectDefaultBrandKit)))
	s.mux.Handle("PUT /api/v1/objects/upload", requirePrincipal(http.HandlerFunc(s.putSignedUploadObject)))
	s.mux.HandleFunc("GET /api/v1/objects/download", s.getSignedDownloadObject)
	s.mux.Handle("GET /api/v1/projects/{project_id}/packages", requirePrincipal(http.HandlerFunc(s.listPackages)))
	s.mux.Handle("POST /api/v1/projects/{project_id}/packages", requirePrincipal(http.HandlerFunc(s.createPackage)))
	s.mux.Handle("POST /api/v1/packages/{package_id}/exports", requirePrincipal(withRateLimit(s.rateLimiter, rateLimitRoute{
		Scope:               ratelimit.ScopeTenant,
		Action:              "export.create",
		AuditDeniedAction:   "rate_limit.denied",
		AuditDeniedResource: "export.create",
	})(http.HandlerFunc(s.createExport))))
	s.mux.Handle("GET /api/v1/exports/{export_id}", requirePrincipal(http.HandlerFunc(s.getExport)))
	s.mux.Handle("POST /api/v1/support/tickets", requirePrincipal(http.HandlerFunc(s.createSupportTicket)))
	s.mux.Handle("GET /api/admin/v1/support/tickets", requirePermission(auth.PermissionSupportRead, http.HandlerFunc(s.listSupportTickets)))
	s.mux.Handle("GET /api/admin/v1/exports", requirePermission(auth.PermissionExportRead, http.HandlerFunc(s.listExports)))
	s.mux.Handle("POST /api/admin/v1/exports/cleanup", requirePermission(auth.PermissionObjectCleanupAdmin, http.HandlerFunc(s.cleanupExports)))
	s.mux.Handle("GET /api/admin/v1/object-storage/retention-policy", requirePermission(auth.PermissionObjectCleanupAdmin, http.HandlerFunc(s.objectStorageRetentionPolicy)))
	s.mux.Handle("POST /api/admin/v1/object-storage/cleanup/expired-exports", requirePermission(auth.PermissionObjectCleanupAdmin, http.HandlerFunc(s.cleanupObjectStorageExpiredExports)))
	s.mux.Handle("POST /api/admin/v1/object-storage/cleanup/orphans", requirePermission(auth.PermissionObjectCleanupAdmin, http.HandlerFunc(s.cleanupObjectStorageOrphans)))
	s.mux.Handle("POST /api/admin/v1/exports/{export_id}/regenerate", requirePermission(auth.PermissionExportOverrideAdmin, http.HandlerFunc(s.regenerateExport)))
	s.mux.Handle("POST /api/admin/v1/exports/{export_id}/override", requirePermission(auth.PermissionExportOverrideAdmin, http.HandlerFunc(s.createExportOverride)))
	s.mux.Handle("GET /api/admin/v1/crawler/sources", requirePermission(auth.PermissionCrawlerRead, http.HandlerFunc(s.listCrawlerSources)))
	s.mux.Handle("GET /api/admin/v1/crawler/findings", requirePermission(auth.PermissionCrawlerRead, http.HandlerFunc(s.listCrawlerFindings)))
	s.mux.Handle("POST /api/admin/v1/crawler/sources/{source_id}/runs", requirePermission(auth.PermissionCrawlerImportAdmin, http.HandlerFunc(s.startCrawlerRun)))
	s.mux.Handle("GET /api/admin/v1/providers/registry", requirePermission(auth.PermissionProviderRoutingAdmin, http.HandlerFunc(s.listProviderRegistry)))
	s.mux.Handle("POST /api/admin/v1/providers/registry", requirePermission(auth.PermissionProviderRoutingAdmin, http.HandlerFunc(s.createProviderRegistry)))
	s.mux.Handle("GET /api/admin/v1/providers/strategy-groups", requirePermission(auth.PermissionProviderRoutingAdmin, http.HandlerFunc(s.listProviderStrategyGroups)))
	s.mux.Handle("POST /api/admin/v1/providers/strategy-groups", requirePermission(auth.PermissionProviderRoutingAdmin, http.HandlerFunc(s.createProviderStrategyGroup)))
	s.mux.Handle("PATCH /api/admin/v1/providers/strategy-groups/{group_id}", requirePermission(auth.PermissionProviderRoutingAdmin, http.HandlerFunc(s.updateProviderStrategyGroup)))
	s.mux.Handle("PATCH /api/admin/v1/providers/registry/{provider_id}", requirePermission(auth.PermissionProviderRoutingAdmin, http.HandlerFunc(s.updateProviderRegistry)))
	s.mux.Handle("DELETE /api/admin/v1/providers/registry/{provider_id}", requirePermission(auth.PermissionProviderRoutingAdmin, http.HandlerFunc(s.deleteProviderRegistry)))
	s.mux.Handle("POST /api/admin/v1/providers/registry/{provider_id}/health-probe", requirePermission(auth.PermissionProviderRoutingAdmin, withRateLimit(s.rateLimiter, rateLimitRoute{
		Scope:               ratelimit.ScopeAdminAction,
		Action:              "provider.registry.health_probe",
		ProviderPathParam:   "provider_id",
		ProviderSpendCents:  1,
		AuditDeniedAction:   "rate_limit.denied",
		AuditDeniedResource: "provider.registry.health_probe",
	})(http.HandlerFunc(s.probeProviderRegistryHealth))))
	s.mux.Handle("POST /api/admin/v1/providers/registry/{provider_id}/test-call", requirePermission(auth.PermissionProviderRoutingAdmin, withRateLimit(s.rateLimiter, rateLimitRoute{
		Scope:               ratelimit.ScopeProvider,
		Action:              "provider.sandbox_test_call",
		ProviderPathParam:   "provider_id",
		ProviderSpendCents:  1,
		AuditDeniedAction:   "rate_limit.denied",
		AuditDeniedResource: "provider.sandbox_test_call",
	})(http.HandlerFunc(s.runProviderSandboxTestCall))))
	s.mux.Handle("GET /api/admin/v1/skills", requirePermission(auth.PermissionSkillReleaseAdmin, http.HandlerFunc(s.listSkills)))
	s.mux.Handle("GET /api/admin/v1/skills/{skill_id}/versions", requirePermission(auth.PermissionSkillReleaseAdmin, http.HandlerFunc(s.listSkillVersions)))
	s.mux.Handle("GET /api/admin/v1/eval/results", requirePermission(auth.PermissionSkillReleaseAdmin, http.HandlerFunc(s.listEvalResults)))
	s.mux.Handle("GET /api/admin/v1/eval/results/{result_id}/artifact", requirePermission(auth.PermissionSkillReleaseAdmin, http.HandlerFunc(s.getEvalResultArtifact)))
	s.mux.Handle("GET /api/admin/v1/batch-generations/queue-runtime", requirePermission(auth.PermissionAuditRead, http.HandlerFunc(s.listAdminBatchQueueRuntime)))
	s.mux.Handle("GET /api/admin/v1/batch-generation-children", requirePermission(auth.PermissionAuditRead, http.HandlerFunc(s.listAdminBatchGenerationChildren)))
	s.mux.Handle("POST /api/admin/v1/billing/manual-credit", requirePermission(auth.PermissionAdminQuotaEdit, withRateLimit(s.rateLimiter, adminActionRateLimit("admin.billing.manual_credit"))(http.HandlerFunc(s.createAdminBillingManualCredit))))
	s.mux.Handle("POST /api/admin/v1/billing/refund-note", requirePermission(auth.PermissionAdminQuotaEdit, withRateLimit(s.rateLimiter, adminActionRateLimit("admin.billing.refund_note"))(http.HandlerFunc(s.createAdminBillingRefundNote))))
	s.mux.Handle("POST /api/admin/v1/billing/subscription-sync", requirePermission(auth.PermissionAdminQuotaEdit, withRateLimit(s.rateLimiter, adminActionRateLimit("admin.billing.subscription_sync"))(http.HandlerFunc(s.createAdminBillingSubscriptionSync))))
	s.mux.Handle("POST /api/admin/v1/billing/account-lock", requirePermission(auth.PermissionAdminQuotaEdit, withRateLimit(s.rateLimiter, adminActionRateLimit("admin.billing.account_lock"))(http.HandlerFunc(s.createAdminBillingAccountLock))))
	s.mux.Handle("POST /api/admin/v1/teams", requirePermission(auth.PermissionAdminQuotaEdit, http.HandlerFunc(s.createAdminTeam)))
	s.mux.Handle("POST /api/admin/v1/teams/{team_id}/invites", requirePermission(auth.PermissionAdminQuotaEdit, http.HandlerFunc(s.createAdminTeamInvite)))
	s.mux.Handle("POST /api/admin/v1/teams/{team_id}/members/{member_id}/remove", requirePermission(auth.PermissionAdminQuotaEdit, http.HandlerFunc(s.removeAdminTeamMember)))
	s.mux.Handle("GET /api/admin/v1/team-seat-ops/{team_id}/seat-usage", requirePermission(auth.PermissionAdminQuotaEdit, http.HandlerFunc(s.getAdminTeamSeatUsage)))
	s.mux.Handle("GET /api/admin/v1/team-seat-ops/{team_id}/billing-link", requirePermission(auth.PermissionAdminQuotaEdit, http.HandlerFunc(s.getAdminTeamBillingLink)))
	s.mux.Handle("PUT /api/admin/v1/team-seat-ops/{team_id}/billing-link", requirePermission(auth.PermissionAdminQuotaEdit, http.HandlerFunc(s.upsertAdminTeamBillingLink)))
	s.mux.Handle("GET /api/admin/v1/team-seat-ops/{team_id}/seat-syncs", requirePermission(auth.PermissionAdminQuotaEdit, http.HandlerFunc(s.listAdminTeamSeatBillingSyncs)))
	s.mux.Handle("GET /api/admin/v1/safety/rules", requirePermission(auth.PermissionSafetyRead, http.HandlerFunc(s.listSafetyRules)))
	s.mux.Handle("POST /api/admin/v1/safety/decisions", requirePermission(auth.PermissionSafetyRuleAdmin, http.HandlerFunc(s.enforceSafety)))
	s.mux.Handle("GET /api/admin/v1/safety/reviews", requirePermission(auth.PermissionSafetyRead, http.HandlerFunc(s.listSafetyReviews)))
	s.mux.Handle("POST /api/admin/v1/safety/reviews/{decision_id}/decision", requirePermission(auth.PermissionSafetyRuleAdmin, http.HandlerFunc(s.recordSafetyReviewDecision)))
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

func (s *Server) getQuota(w http.ResponseWriter, r *http.Request) {
	reader, ok := billingAccountReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_account_reader_not_connected", "billing account storage is not connected yet", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	state, err := reader.GetQuotaState(r.Context(), principal.TenantID, principal.UserID)
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "quota_lookup_failed", "quota state could not be loaded", nil)
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (s *Server) getBillingSubscription(w http.ResponseWriter, r *http.Request) {
	reader, ok := billingAccountReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_account_reader_not_connected", "billing account storage is not connected yet", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	subscription, err := reader.GetSubscription(r.Context(), principal.TenantID, principal.UserID)
	if errors.Is(err, billing.ErrSubscriptionNotFound) {
		writeError(w, r, http.StatusNotFound, "subscription_not_found", "subscription was not found for this account", nil)
		return
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "subscription_lookup_failed", "subscription state could not be loaded", nil)
		return
	}
	writeJSON(w, http.StatusOK, subscription)
}

func (s *Server) createBillingCheckout(w http.ResponseWriter, r *http.Request) {
	provider, ok := billingProviderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_provider_not_connected", "billing provider is not connected yet", nil)
		return
	}
	principal, ok := PrincipalFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusUnauthorized, "unauthorized", "authentication is required", nil)
		return
	}
	var input struct {
		PlanID string `json:"plan_id"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	planID := strings.TrimSpace(input.PlanID)
	if planID == "" {
		writeError(w, r, http.StatusBadRequest, "validation_error", "plan_id is required", nil)
		return
	}
	session, err := provider.CreateCheckout(r.Context(), principal.TenantID, principal.UserID, planID)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "billing_checkout_failed", "billing checkout session could not be created", map[string]any{
			"provider": "stripe",
			"reason":   err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":           session.ID,
		"tenant_id":    session.TenantID,
		"user_id":      session.UserID,
		"provider":     session.Provider,
		"redirect_url": session.RedirectURL,
		"created_at":   session.CreatedAt.Format(time.RFC3339),
	})
}

func (s *Server) createBillingPortal(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	provider, ok := billingProviderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_provider_not_connected", "billing provider is not connected yet", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	subscription, ok := s.currentBillingSubscription(w, r)
	if !ok {
		return
	}
	if strings.TrimSpace(subscription.ProviderCustomerID) == "" {
		writeError(w, r, http.StatusConflict, "billing_customer_missing", "billing customer is not available for this subscription yet", nil)
		return
	}
	session, err := provider.CreatePortalSession(r.Context(), principal.TenantID, principal.UserID, subscription.ProviderCustomerID, s.cfg.Billing.StripePortalReturnURL)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "billing_portal_failed", "billing portal session could not be created", map[string]any{
			"provider": subscription.Provider,
			"reason":   err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

func (s *Server) cancelBillingSubscription(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	provider, ok := billingProviderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_provider_not_connected", "billing provider is not connected yet", nil)
		return
	}
	subscription, ok := s.currentBillingSubscription(w, r)
	if !ok {
		return
	}
	if strings.TrimSpace(subscription.ProviderRef) == "" {
		writeError(w, r, http.StatusConflict, "billing_subscription_provider_ref_missing", "billing subscription provider reference is not available yet", nil)
		return
	}
	cancelled, err := provider.CancelSubscription(r.Context(), subscription.ProviderRef)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "billing_cancel_failed", "billing subscription could not be scheduled for cancellation", map[string]any{
			"provider": subscription.Provider,
			"reason":   err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, cancelled)
}

func (s *Server) listBillingInvoices(w http.ResponseWriter, r *http.Request) {
	provider, ok := billingProviderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_provider_not_connected", "billing provider is not connected yet", nil)
		return
	}
	subscription, ok := s.currentBillingSubscription(w, r)
	if !ok {
		return
	}
	if strings.TrimSpace(subscription.ProviderRef) == "" {
		writeError(w, r, http.StatusConflict, "billing_subscription_provider_ref_missing", "billing subscription provider reference is not available yet", nil)
		return
	}
	page, err := provider.ListInvoices(r.Context(), subscription.ProviderRef)
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "billing_invoice_lookup_failed", "billing invoices could not be loaded", map[string]any{
			"provider": subscription.Provider,
			"reason":   err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) currentBillingSubscription(w http.ResponseWriter, r *http.Request) (billing.UserSubscriptionProjection, bool) {
	reader, ok := billingAccountReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_account_reader_not_connected", "billing account storage is not connected yet", nil)
		return billing.UserSubscriptionProjection{}, false
	}
	principal, _ := PrincipalFromContext(r.Context())
	subscription, err := reader.GetSubscription(r.Context(), principal.TenantID, principal.UserID)
	if errors.Is(err, billing.ErrSubscriptionNotFound) {
		writeError(w, r, http.StatusNotFound, "subscription_not_found", "subscription was not found for this account", nil)
		return billing.UserSubscriptionProjection{}, false
	}
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "subscription_lookup_failed", "subscription state could not be loaded", nil)
		return billing.UserSubscriptionProjection{}, false
	}
	return subscription, true
}

func (s *Server) handleBillingWebhook(w http.ResponseWriter, r *http.Request) {
	provider, ok := billingProviderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_provider_not_connected", "billing provider is not connected yet", nil)
		return
	}
	defer r.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_webhook_payload", "billing webhook payload could not be read", nil)
		return
	}
	if err := provider.HandleWebhook(r.Context(), payload, r.Header.Get("Stripe-Signature")); err != nil {
		writeError(w, r, http.StatusBadRequest, "billing_webhook_rejected", "billing webhook could not be verified or processed", map[string]any{
			"reason": err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"received": true,
	})
}

func (s *Server) getTeamSeatUsage(w http.ResponseWriter, r *http.Request) {
	service, ok := teamServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_service_not_connected", "team seat storage is not connected yet", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	usage, err := service.GetSeatUsage(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("team_id")))
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, usage)
}

func (s *Server) checkTeamSeatEntitlement(w http.ResponseWriter, r *http.Request) {
	service, ok := teamServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_service_not_connected", "team seat storage is not connected yet", nil)
		return
	}
	additionalSeats, err := parseAdditionalSeats(r.URL.Query().Get("additional_seats"))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "team_seat_entitlement_validation_error", err.Error(), map[string]any{"field": "additional_seats"})
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	decision, err := service.CheckSeatEntitlement(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("team_id")), additionalSeats)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, decision)
}

func (s *Server) acceptTeamInvite(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	service, ok := teamServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_service_not_connected", "team seat storage is not connected yet", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	member, err := service.AcceptInvite(
		r.Context(),
		principal.TenantID,
		strings.TrimSpace(r.PathValue("team_id")),
		strings.TrimSpace(r.PathValue("invite_id")),
		principal.UserID,
		time.Now().UTC(),
	)
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	if syncer, ok := teamSeatBillingSyncerFromContext(r.Context()); ok {
		usage, err := service.GetSeatUsage(r.Context(), principal.TenantID, member.TeamID)
		if err != nil {
			writeTeamError(w, r, err)
			return
		}
		if _, err := syncer.SyncTeamSeatQuantity(r.Context(), billing.TeamSeatSyncInput{
			TenantID:       principal.TenantID,
			TeamID:         member.TeamID,
			ActorID:        principal.UserID,
			Operation:      "team.invite.accept",
			IdempotencyKey: strings.TrimSpace(r.Header.Get("Idempotency-Key")),
			Rationale:      "accepted team invite",
			Usage: billing.TeamSeatUsageSnapshot{
				PlanID:         usage.PlanID,
				SeatLimit:      usage.SeatLimit,
				ActiveSeats:    usage.ActiveSeats,
				InvitedSeats:   usage.InvitedSeats,
				BillableSeats:  usage.BillableSeats,
				AvailableSeats: usage.AvailableSeats,
			},
			RequestedAt: time.Now().UTC(),
		}); err != nil {
			writeError(w, r, http.StatusBadGateway, "team_seat_billing_sync_failed", "team invite acceptance could not be synchronized to billing provider", map[string]any{
				"reason": security.RedactString(err.Error()),
			})
			return
		}
	}
	writeJSON(w, http.StatusOK, member)
}

func (s *Server) createAdminTeam(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID          string         `json:"id"`
		Name        string         `json:"name"`
		PlanID      string         `json:"plan_id"`
		SeatLimit   int            `json:"seat_limit"`
		OwnerUserID string         `json:"owner_user_id"`
		OwnerEmail  string         `json:"owner_email"`
		Rationale   string         `json:"rationale"`
		Metadata    map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	result, ok := s.runAdminTeamOperation(w, r, adminTeamOperationInput{
		Action:    "team.create",
		TeamID:    strings.TrimSpace(input.ID),
		Rationale: strings.TrimSpace(input.Rationale),
		Metadata:  input.Metadata,
		Call: func(ctx context.Context, service TeamService) (any, error) {
			return service.CreateTeam(ctx, team.Team{
				ID:        strings.TrimSpace(input.ID),
				TenantID:  principal.TenantID,
				Name:      strings.TrimSpace(input.Name),
				PlanID:    strings.TrimSpace(input.PlanID),
				SeatLimit: input.SeatLimit,
			}, team.Member{
				UserID: strings.TrimSpace(input.OwnerUserID),
				Email:  strings.TrimSpace(input.OwnerEmail),
			})
		},
	}, adminTeamAuditMetadata{
		"team_name":     strings.TrimSpace(input.Name),
		"plan_id":       strings.TrimSpace(input.PlanID),
		"seat_limit":    input.SeatLimit,
		"owner_user_id": strings.TrimSpace(input.OwnerUserID),
		"owner_email":   strings.TrimSpace(input.OwnerEmail),
	})
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) createAdminTeamInvite(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email     string         `json:"email"`
		Role      string         `json:"role"`
		ExpiresAt string         `json:"expires_at"`
		Rationale string         `json:"rationale"`
		Metadata  map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	expiresAt, err := parseOptionalRFC3339(input.ExpiresAt)
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "team_invite_validation_error", "expires_at must be RFC3339 when provided", map[string]any{"field": "expires_at"})
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	teamID := strings.TrimSpace(r.PathValue("team_id"))
	result, ok := s.runAdminTeamOperation(w, r, adminTeamOperationInput{
		Action:          "team.invite",
		TeamID:          teamID,
		Rationale:       strings.TrimSpace(input.Rationale),
		Metadata:        input.Metadata,
		SyncSeatBilling: true,
		Call: func(ctx context.Context, service TeamService) (any, error) {
			return service.InviteMember(ctx, team.Invite{
				TeamID:         teamID,
				TenantID:       principal.TenantID,
				Email:          strings.TrimSpace(strings.ToLower(input.Email)),
				Role:           team.Role(strings.TrimSpace(input.Role)),
				IdempotencyKey: strings.TrimSpace(r.Header.Get("Idempotency-Key")),
				InvitedBy:      principal.UserID,
				ExpiresAt:      expiresAt,
			})
		},
	}, adminTeamAuditMetadata{
		"email": strings.TrimSpace(strings.ToLower(input.Email)),
		"role":  strings.TrimSpace(input.Role),
	})
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) removeAdminTeamMember(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Rationale string         `json:"rationale"`
		Metadata  map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	teamID := strings.TrimSpace(r.PathValue("team_id"))
	memberID := strings.TrimSpace(r.PathValue("member_id"))
	result, ok := s.runAdminTeamOperation(w, r, adminTeamOperationInput{
		Action:          "team.member.remove",
		TeamID:          teamID,
		Rationale:       strings.TrimSpace(input.Rationale),
		Metadata:        input.Metadata,
		SyncSeatBilling: true,
		Call: func(ctx context.Context, service TeamService) (any, error) {
			if err := service.RemoveMember(ctx, principal.TenantID, teamID, memberID, principal.UserID, time.Now().UTC()); err != nil {
				return nil, err
			}
			return map[string]any{
				"team_id":    teamID,
				"tenant_id":  principal.TenantID,
				"member_id":  memberID,
				"removed_by": principal.UserID,
				"removed":    true,
			}, nil
		},
	}, adminTeamAuditMetadata{
		"member_id": memberID,
	})
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) getAdminTeamSeatUsage(w http.ResponseWriter, r *http.Request) {
	service, ok := teamServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_service_not_connected", "team seat storage is not connected yet", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	usage, err := service.GetSeatUsage(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("team_id")))
	if err != nil {
		writeTeamError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, usage)
}

func (s *Server) getAdminTeamBillingLink(w http.ResponseWriter, r *http.Request) {
	manager, ok := teamSeatBillingManagerFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_seat_billing_manager_not_connected", "team seat billing link storage is not connected yet", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	link, err := manager.GetTeamBillingLink(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("team_id")))
	if err != nil {
		writeTeamSeatBillingManagerError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, link)
}

func (s *Server) upsertAdminTeamBillingLink(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	manager, ok := teamSeatBillingManagerFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_seat_billing_manager_not_connected", "team seat billing link storage is not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_billing_link_audit_not_connected", "team billing link audit logging is not connected yet", nil)
		return
	}
	var input struct {
		Provider                   string         `json:"provider"`
		ProviderSubscriptionID     string         `json:"provider_subscription_id"`
		ProviderSubscriptionItemID string         `json:"provider_subscription_item_id"`
		PriceID                    string         `json:"price_id"`
		ProrationBehavior          string         `json:"proration_behavior"`
		Status                     string         `json:"status"`
		Rationale                  string         `json:"rationale"`
		Metadata                   map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	billingInput := billing.TeamBillingLinkInput{
		TenantID:                   principal.TenantID,
		TeamID:                     strings.TrimSpace(r.PathValue("team_id")),
		ActorID:                    principal.UserID,
		Provider:                   strings.TrimSpace(input.Provider),
		ProviderSubscriptionID:     strings.TrimSpace(input.ProviderSubscriptionID),
		ProviderSubscriptionItemID: strings.TrimSpace(input.ProviderSubscriptionItemID),
		PriceID:                    strings.TrimSpace(input.PriceID),
		ProrationBehavior:          strings.TrimSpace(input.ProrationBehavior),
		Status:                     strings.TrimSpace(input.Status),
		Rationale:                  strings.TrimSpace(security.RedactString(input.Rationale)),
		IdempotencyKey:             strings.TrimSpace(r.Header.Get("Idempotency-Key")),
		Metadata:                   security.RedactMap(input.Metadata),
		RequestedAt:                time.Now().UTC(),
	}
	if billingInput.Rationale == "" || billingInput.Rationale == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "team_billing_link_rationale_required", "team billing link updates require a non-secret rationale", map[string]any{"field": "rationale"})
		return
	}
	requestID := requestIDFrom(r.Context())
	if err := recorder.Record(r.Context(), team.AuditEvent(principal.TenantID, principal.UserID, "team.billing_link.requested", billingInput.TeamID, teamBillingLinkAuditMetadata(billingInput, requestID), time.Now().UTC())); err != nil {
		writeError(w, r, http.StatusInternalServerError, "team_billing_link_audit_record_error", "team billing link request audit could not be written", nil)
		return
	}
	link, err := manager.UpsertTeamBillingLink(r.Context(), billingInput)
	if err != nil {
		_ = recorder.Record(r.Context(), team.AuditEvent(principal.TenantID, principal.UserID, "team.billing_link.failed", billingInput.TeamID, teamBillingLinkAuditMetadataWithError(billingInput, requestID, err), time.Now().UTC()))
		writeTeamSeatBillingManagerError(w, r, err)
		return
	}
	if err := recorder.Record(r.Context(), team.AuditEvent(principal.TenantID, principal.UserID, "team.billing_link", billingInput.TeamID, teamBillingLinkResultAuditMetadata(link, billingInput, requestID), time.Now().UTC())); err != nil {
		writeError(w, r, http.StatusInternalServerError, "team_billing_link_audit_record_error", "team billing link completion audit could not be written", nil)
		return
	}
	writeJSON(w, http.StatusOK, link)
}

func (s *Server) listAdminTeamSeatBillingSyncs(w http.ResponseWriter, r *http.Request) {
	manager, ok := teamSeatBillingManagerFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_seat_billing_manager_not_connected", "team seat billing sync storage is not connected yet", nil)
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	page, err := manager.ListTeamSeatBillingSyncs(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("team_id")), pageSize(r))
	if err != nil {
		writeTeamSeatBillingManagerError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

type adminTeamAuditMetadata map[string]any

type adminTeamOperationInput struct {
	Action          string
	TeamID          string
	Rationale       string
	Metadata        map[string]any
	SyncSeatBilling bool
	Call            func(context.Context, TeamService) (any, error)
}

func (s *Server) runAdminTeamOperation(w http.ResponseWriter, r *http.Request, input adminTeamOperationInput, metadata adminTeamAuditMetadata) (any, bool) {
	if !requireIdempotencyKey(w, r) {
		return nil, false
	}
	principal, _ := PrincipalFromContext(r.Context())
	service, ok := teamServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_service_not_connected", "team seat storage is not connected yet", nil)
		return nil, false
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "team_audit_not_connected", "team operation audit logging is not connected yet", nil)
		return nil, false
	}
	input.TeamID = strings.TrimSpace(input.TeamID)
	input.Rationale = strings.TrimSpace(security.RedactString(input.Rationale))
	input.Metadata = security.RedactMap(input.Metadata)
	if input.TeamID == "" {
		writeError(w, r, http.StatusBadRequest, "team_id_required", "team operation requires team_id", map[string]any{"field": "team_id"})
		return nil, false
	}
	if input.Rationale == "" || input.Rationale == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "team_rationale_required", "team operations require a non-secret rationale", map[string]any{"field": "rationale"})
		return nil, false
	}
	if input.Call == nil {
		writeError(w, r, http.StatusInternalServerError, "team_operation_not_configured", "team operation is not configured", nil)
		return nil, false
	}
	var seatBillingSyncer billing.TeamSeatBillingSyncer
	if input.SyncSeatBilling {
		var ok bool
		seatBillingSyncer, ok = teamSeatBillingSyncerFromContext(r.Context())
		if !ok {
			writeError(w, r, http.StatusNotImplemented, "team_seat_billing_sync_not_connected", "team seat billing sync is not connected yet", nil)
			return nil, false
		}
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	requestID := requestIDFrom(r.Context())
	if err := recorder.Record(r.Context(), team.AuditEvent(principal.TenantID, principal.UserID, input.Action+".requested", input.TeamID, teamAuditMetadata(input, metadata, idempotencyKey, requestID), time.Now().UTC())); err != nil {
		writeError(w, r, http.StatusInternalServerError, "team_audit_record_error", "team operation audit request record could not be written", nil)
		return nil, false
	}
	result, err := input.Call(r.Context(), service)
	if err != nil {
		_ = recorder.Record(r.Context(), team.AuditEvent(principal.TenantID, principal.UserID, input.Action+".failed", input.TeamID, teamAuditMetadataWithError(input, metadata, idempotencyKey, requestID, err), time.Now().UTC()))
		writeTeamError(w, r, err)
		return nil, false
	}
	completionMetadata := teamAuditMetadata(input, metadata, idempotencyKey, requestID)
	if input.SyncSeatBilling {
		syncResult, ok := s.syncTeamSeatBillingAfterMutation(w, r, service, seatBillingSyncer, input, idempotencyKey)
		if !ok {
			_ = recorder.Record(r.Context(), team.AuditEvent(principal.TenantID, principal.UserID, input.Action+".failed", input.TeamID, teamAuditMetadataWithError(input, metadata, idempotencyKey, requestID, errors.New("team seat billing sync failed")), time.Now().UTC()))
			return nil, false
		}
		completionMetadata["seat_billing_sync_id"] = syncResult.ID
		completionMetadata["seat_billing_status"] = syncResult.Status
		completionMetadata["seat_billing_provider"] = syncResult.Provider
		completionMetadata["seat_billing_quantity"] = syncResult.SyncedQuantity
	}
	if err := recorder.Record(r.Context(), team.AuditEvent(principal.TenantID, principal.UserID, input.Action, input.TeamID, completionMetadata, time.Now().UTC())); err != nil {
		writeError(w, r, http.StatusInternalServerError, "team_audit_record_error", "team operation audit completion record could not be written", nil)
		return nil, false
	}
	return result, true
}

func (s *Server) syncTeamSeatBillingAfterMutation(w http.ResponseWriter, r *http.Request, service TeamService, syncer billing.TeamSeatBillingSyncer, input adminTeamOperationInput, idempotencyKey string) (billing.TeamSeatSyncResult, bool) {
	principal, _ := PrincipalFromContext(r.Context())
	usage, err := service.GetSeatUsage(r.Context(), principal.TenantID, input.TeamID)
	if err != nil {
		writeTeamError(w, r, err)
		return billing.TeamSeatSyncResult{}, false
	}
	result, err := syncer.SyncTeamSeatQuantity(r.Context(), billing.TeamSeatSyncInput{
		TenantID:       principal.TenantID,
		TeamID:         input.TeamID,
		ActorID:        principal.UserID,
		Operation:      input.Action,
		IdempotencyKey: idempotencyKey,
		Rationale:      input.Rationale,
		Usage: billing.TeamSeatUsageSnapshot{
			PlanID:         usage.PlanID,
			SeatLimit:      usage.SeatLimit,
			ActiveSeats:    usage.ActiveSeats,
			InvitedSeats:   usage.InvitedSeats,
			BillableSeats:  usage.BillableSeats,
			AvailableSeats: usage.AvailableSeats,
		},
		RequestedAt: time.Now().UTC(),
	})
	if err != nil {
		writeError(w, r, http.StatusBadGateway, "team_seat_billing_sync_failed", "team seat change could not be synchronized to billing provider", map[string]any{
			"reason": security.RedactString(err.Error()),
		})
		return billing.TeamSeatSyncResult{}, false
	}
	return result, true
}

func teamAuditMetadata(input adminTeamOperationInput, metadata adminTeamAuditMetadata, idempotencyKey, requestID string) map[string]any {
	result := map[string]any{
		"rationale":       input.Rationale,
		"idempotency_key": idempotencyKey,
		"request_id":      requestID,
	}
	for key, value := range input.Metadata {
		if _, exists := result[key]; !exists {
			result[key] = value
		}
	}
	for key, value := range metadata {
		if _, exists := result[key]; !exists {
			result[key] = value
		}
	}
	return security.RedactMap(result)
}

func teamAuditMetadataWithError(input adminTeamOperationInput, metadata adminTeamAuditMetadata, idempotencyKey, requestID string, err error) map[string]any {
	result := teamAuditMetadata(input, metadata, idempotencyKey, requestID)
	result["error"] = security.RedactString(err.Error())
	return result
}

func parseAdditionalSeats(value string) (int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 1, nil
	}
	additionalSeats, err := strconv.Atoi(value)
	if err != nil || additionalSeats < 0 {
		return 0, errors.New("additional_seats must be a non-negative integer")
	}
	return additionalSeats, nil
}

func parseOptionalRFC3339(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339, value)
}

func writeTeamError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, team.ErrInviteNotFound):
		writeError(w, r, http.StatusNotFound, "team_invite_not_found", "team invite was not found or is no longer pending", nil)
	case errors.Is(err, team.ErrSeatLimitExceeded):
		writeError(w, r, http.StatusPaymentRequired, "team_seat_limit_exceeded", "team has no available billable seats", nil)
	case errors.Is(err, team.ErrMemberRemovalDenied):
		writeError(w, r, http.StatusConflict, "team_member_removal_denied", "team member cannot be removed", nil)
	case strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "must"):
		writeError(w, r, http.StatusBadRequest, "team_validation_error", err.Error(), nil)
	default:
		writeError(w, r, http.StatusInternalServerError, "team_operation_error", "team operation failed", nil)
	}
}

func writeTeamSeatBillingManagerError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		writeError(w, r, http.StatusNotFound, "team_billing_link_not_found", "team billing link was not found for this tenant team", nil)
	case errors.Is(err, billing.ErrTeamSeatBillingValidation):
		writeError(w, r, http.StatusBadRequest, "team_billing_link_validation_error", "team billing link validation failed", nil)
	default:
		writeError(w, r, http.StatusInternalServerError, "team_billing_link_operation_error", "team billing link operation failed", nil)
	}
}

func teamBillingLinkAuditMetadata(input billing.TeamBillingLinkInput, requestID string) map[string]any {
	metadata := map[string]any{
		"provider":                      input.Provider,
		"provider_subscription_id":      input.ProviderSubscriptionID,
		"provider_subscription_item_id": input.ProviderSubscriptionItemID,
		"price_id":                      input.PriceID,
		"proration_behavior":            input.ProrationBehavior,
		"status":                        input.Status,
		"rationale":                     input.Rationale,
		"idempotency_key":               input.IdempotencyKey,
		"request_id":                    requestID,
	}
	for key, value := range input.Metadata {
		if _, exists := metadata[key]; !exists {
			metadata[key] = value
		}
	}
	return security.RedactMap(metadata)
}

func teamBillingLinkAuditMetadataWithError(input billing.TeamBillingLinkInput, requestID string, err error) map[string]any {
	metadata := teamBillingLinkAuditMetadata(input, requestID)
	metadata["error"] = security.RedactString(err.Error())
	return metadata
}

func teamBillingLinkResultAuditMetadata(link billing.TeamBillingLink, input billing.TeamBillingLinkInput, requestID string) map[string]any {
	metadata := map[string]any{
		"provider":                      link.Provider,
		"provider_subscription_id":      link.ProviderSubscriptionID,
		"provider_subscription_item_id": link.ProviderSubscriptionItemID,
		"price_id":                      link.PriceID,
		"proration_behavior":            link.ProrationBehavior,
		"status":                        link.Status,
		"rationale":                     input.Rationale,
		"idempotency_key":               input.IdempotencyKey,
		"request_id":                    requestID,
	}
	for key, value := range link.Metadata {
		if _, exists := metadata[key]; !exists {
			metadata[key] = value
		}
	}
	return security.RedactMap(metadata)
}

func (s *Server) taskStatus(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	taskID := r.PathValue("task_id")
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

func (s *Server) createBatchGeneration(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	store, ok := task.BatchStoreFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "batch_generation_not_connected", "batch generation storage is not connected yet", nil)
		return
	}
	var input struct {
		WorkspaceID    string             `json:"workspace_id"`
		PromptContext  task.PromptContext `json:"prompt_context"`
		RequestedCount int                `json:"requested_count"`
		AllowedModels  []string           `json:"allowed_models"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	batch, err := store.CreateBatch(r.Context(), task.BatchCreateInput{
		TenantID:       principal.TenantID,
		UserID:         principal.UserID,
		ProjectID:      strings.TrimSpace(r.PathValue("project_id")),
		WorkspaceID:    input.WorkspaceID,
		PromptContext:  input.PromptContext,
		RequestedCount: input.RequestedCount,
		AllowedModels:  input.AllowedModels,
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		writeBatchGenerationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, batch)
}

func (s *Server) getBatchGeneration(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	store, ok := task.BatchStoreFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "batch_generation_not_connected", "batch generation storage is not connected yet", nil)
		return
	}
	batch, err := store.GetBatch(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("batch_id")))
	if err != nil {
		writeBatchGenerationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, batch)
}

func (s *Server) listBatchGenerationChildren(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	store, ok := task.BatchStoreFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "batch_generation_not_connected", "batch generation storage is not connected yet", nil)
		return
	}
	children, err := store.ListBatchChildren(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("batch_id")))
	if err != nil {
		writeBatchGenerationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": children,
	})
}

func (s *Server) getBatchGenerationProgress(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	store, ok := task.BatchStoreFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "batch_generation_not_connected", "batch generation storage is not connected yet", nil)
		return
	}
	progress, err := store.GetBatchProgress(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("batch_id")))
	if err != nil {
		writeBatchGenerationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, progress)
}

func (s *Server) cancelBatchGeneration(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	store, ok := task.BatchStoreFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "batch_generation_not_connected", "batch generation storage is not connected yet", nil)
		return
	}
	batch, err := store.CancelBatch(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("batch_id")))
	if err != nil {
		writeBatchGenerationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, batch)
}

func (s *Server) retryBatchGenerationChild(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	store, ok := task.BatchStoreFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "batch_generation_not_connected", "batch generation storage is not connected yet", nil)
		return
	}
	child, err := store.RetryChild(r.Context(), principal.TenantID, strings.TrimSpace(r.PathValue("child_id")))
	if err != nil {
		writeBatchGenerationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, child)
}

func (s *Server) listAdminBatchQueueRuntime(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	reader, ok := adminBatchQueueReaderFromRequest(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "admin_batch_queue_not_connected", "admin batch queue reader is not connected yet", nil)
		return
	}
	items, err := reader.ListAdminBatchQueueRuntime(r.Context(), principal.TenantID, pageSize(r))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "admin_batch_queue_error", "admin batch queue lookup failed", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":           items,
		"next_page_token": "",
		"total_count":     len(items),
	})
}

func (s *Server) listAdminBatchGenerationChildren(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	reader, ok := adminBatchQueueReaderFromRequest(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "admin_batch_queue_not_connected", "admin batch queue reader is not connected yet", nil)
		return
	}
	items, err := reader.ListAdminBatchChildTasks(r.Context(), principal.TenantID, pageSize(r))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "admin_batch_children_error", "admin batch child task lookup failed", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":           items,
		"next_page_token": "",
		"total_count":     len(items),
	})
}

func adminBatchQueueReaderFromRequest(r *http.Request) (task.AdminBatchQueueReader, bool) {
	store, ok := task.BatchStoreFromContext(r.Context())
	if !ok {
		return nil, false
	}
	reader, ok := store.(task.AdminBatchQueueReader)
	return reader, ok
}

func writeBatchGenerationError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, task.ErrNotFound):
		writeError(w, r, http.StatusNotFound, "batch_generation_not_found", "batch generation record was not found for this tenant", nil)
	case errors.Is(err, task.ErrBatchQuotaInsufficient):
		writeError(w, r, http.StatusPaymentRequired, "batch_quota_insufficient", "batch generation quota is insufficient", nil)
	case errors.Is(err, task.ErrBatchQuotaUnavailable):
		writeError(w, r, http.StatusConflict, "batch_quota_unavailable", "reserved batch quota is unavailable", nil)
	case errors.Is(err, task.ErrBatchConflict):
		writeError(w, r, http.StatusConflict, "batch_generation_conflict", err.Error(), nil)
	case errors.Is(err, task.ErrBatchValidation):
		writeError(w, r, http.StatusBadRequest, "batch_generation_validation_error", err.Error(), nil)
	default:
		writeError(w, r, http.StatusInternalServerError, "batch_generation_error", "batch generation operation failed", nil)
	}
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
		Resource: firstNonEmpty(r.URL.Query().Get("resource"), r.URL.Query().Get("subject")),
		Limit:    pageSize(r),
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "audit_search_error", "audit log search failed", nil)
		return
	}
	for idx := range page.Items {
		if page.Items[idx].AuditRef == "" {
			page.Items[idx].AuditRef = page.Items[idx].ID
		}
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) listProviderRegistry(w http.ResponseWriter, r *http.Request) {
	reader, ok := provider.RegistryReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_not_connected", "provider registry storage is not connected yet", nil)
		return
	}
	page, err := reader.ListAdminRegistry(r.Context(), pageSize(r))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_registry_error", "provider registry lookup failed", nil)
		return
	}
	for _, item := range page.Items {
		if err := provider.ValidateAdminProjection(item); err != nil {
			writeError(w, r, http.StatusInternalServerError, "provider_registry_projection_error", "provider registry projection failed safety validation", map[string]any{
				"provider_id": item.ProviderID,
			})
			return
		}
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) createProviderRegistry(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	reader, ok := provider.RegistryReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_not_connected", "provider registry storage is not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_audit_not_connected", "provider registry audit logging is not connected yet", nil)
		return
	}
	var input struct {
		ProviderID   string                  `json:"provider_id"`
		DisplayName  string                  `json:"display_name"`
		Mode         provider.RegistryMode   `json:"mode"`
		Status       provider.RegistryStatus `json:"status"`
		SecretRef    string                  `json:"secret_ref"`
		Routing      provider.RoutingPolicy  `json:"routing"`
		Health       provider.HealthSnapshot `json:"health"`
		Capabilities []provider.Capability   `json:"capabilities"`
		Metadata     map[string]string       `json:"metadata"`
		Rationale    string                  `json:"rationale"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	rationale := providerRegistryRationale(input.Rationale)
	if rationale == "" {
		writeError(w, r, http.StatusBadRequest, "provider_registry_rationale_required", "provider registry creates require a non-secret rationale", map[string]any{
			"field": "rationale",
		})
		return
	}
	secretRef := strings.TrimSpace(input.SecretRef)
	if providerRegistrySecretRefInvalid(secretRef) {
		writeError(w, r, http.StatusBadRequest, "provider_registry_secret_ref_invalid", "provider registry secret_ref must be a secret manager reference, not a raw secret value", map[string]any{
			"field": "secret_ref",
		})
		return
	}
	create := provider.RegistryCreate{
		ProviderID:   strings.TrimSpace(input.ProviderID),
		DisplayName:  strings.TrimSpace(input.DisplayName),
		Mode:         input.Mode,
		Status:       input.Status,
		SecretRef:    secretRef,
		Routing:      input.Routing,
		Health:       input.Health,
		Capabilities: input.Capabilities,
		Metadata:     input.Metadata,
	}
	result, err := reader.CreateAdminRegistry(r.Context(), create)
	if err != nil {
		writeProviderRegistryMutationError(w, r, err, "create")
		return
	}
	if !validateProviderRegistryProjection(w, r, result.Created, "created") {
		return
	}
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        newAuditID(principal.TenantID, principal.UserID, "provider.registry.create", result.Created.ProviderID),
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    "provider.registry.create",
		Resource:  "providers/" + result.Created.ProviderID,
		CreatedAt: time.Now().UTC(),
		Metadata: map[string]any{
			"rationale":            rationale,
			"provider_id":          result.Created.ProviderID,
			"mode":                 string(result.Created.Mode),
			"status":               string(result.Created.Status),
			"routing":              result.Created.Routing,
			"secret_present":       result.Created.SecretPresent,
			"capability_count":     len(result.Created.Capabilities),
			"estimated_cost_cents": providerCapabilityCost(result.Created.Capabilities),
			"request_id":           requestIDFrom(r.Context()),
		},
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_registry_audit_record_error", "provider registry create audit record could not be written", nil)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) listProviderStrategyGroups(w http.ResponseWriter, r *http.Request) {
	reader, ok := provider.RegistryReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_strategy_groups_not_connected", "provider strategy group storage is not connected yet", nil)
		return
	}
	page, err := reader.ListStrategyGroups(r.Context(), pageSize(r))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_strategy_groups_error", "provider strategy group lookup failed", nil)
		return
	}
	for _, item := range page.Items {
		if err := provider.ValidateStrategyGroup(item); err != nil {
			writeError(w, r, http.StatusInternalServerError, "provider_strategy_group_projection_error", "provider strategy group projection failed safety validation", map[string]any{
				"group_id": item.GroupID,
			})
			return
		}
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) createProviderStrategyGroup(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	reader, ok := provider.RegistryReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_strategy_groups_not_connected", "provider strategy group storage is not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_strategy_group_audit_not_connected", "provider strategy group audit logging is not connected yet", nil)
		return
	}
	var input struct {
		GroupID             string                           `json:"group_id"`
		DisplayName         string                           `json:"display_name"`
		ToolType            string                           `json:"tool_type"`
		Status              provider.RegistryStatus          `json:"status"`
		SelectionPolicy     provider.StrategySelectionPolicy `json:"selection_policy"`
		FallbackProviderIDs []string                         `json:"fallback_provider_ids"`
		KillSwitch          bool                             `json:"kill_switch"`
		Members             []provider.StrategyGroupMember   `json:"members"`
		Metadata            map[string]string                `json:"metadata"`
		Rationale           string                           `json:"rationale"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	rationale := providerRegistryRationale(input.Rationale)
	if rationale == "" {
		writeError(w, r, http.StatusBadRequest, "provider_strategy_group_rationale_required", "provider strategy group creates require a non-secret rationale", map[string]any{
			"field": "rationale",
		})
		return
	}
	result, err := reader.CreateStrategyGroup(r.Context(), provider.StrategyGroupCreate{
		GroupID:             input.GroupID,
		DisplayName:         input.DisplayName,
		ToolType:            input.ToolType,
		Status:              input.Status,
		SelectionPolicy:     input.SelectionPolicy,
		FallbackProviderIDs: input.FallbackProviderIDs,
		KillSwitch:          input.KillSwitch,
		Members:             input.Members,
		Metadata:            input.Metadata,
	})
	if err != nil {
		writeProviderRegistryMutationError(w, r, err, "strategy_group_create")
		return
	}
	if !validateProviderStrategyGroupProjection(w, r, result.Created, "created") {
		return
	}
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        newAuditID(principal.TenantID, principal.UserID, "provider.strategy_group.create", result.Created.GroupID),
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    "provider.strategy_group.create",
		Resource:  "provider-strategy-groups/" + result.Created.GroupID,
		CreatedAt: time.Now().UTC(),
		Metadata:  providerStrategyGroupAuditMetadata(result.Created, rationale, requestIDFrom(r.Context())),
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_strategy_group_audit_record_error", "provider strategy group create audit record could not be written", nil)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) updateProviderStrategyGroup(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	reader, ok := provider.RegistryReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_strategy_groups_not_connected", "provider strategy group storage is not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_strategy_group_audit_not_connected", "provider strategy group audit logging is not connected yet", nil)
		return
	}
	var input struct {
		DisplayName         string                           `json:"display_name"`
		ToolType            string                           `json:"tool_type"`
		Status              provider.RegistryStatus          `json:"status"`
		SelectionPolicy     provider.StrategySelectionPolicy `json:"selection_policy"`
		FallbackProviderIDs []string                         `json:"fallback_provider_ids"`
		KillSwitch          bool                             `json:"kill_switch"`
		Members             []provider.StrategyGroupMember   `json:"members"`
		Metadata            map[string]string                `json:"metadata"`
		Rationale           string                           `json:"rationale"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	rationale := providerRegistryRationale(input.Rationale)
	if rationale == "" {
		writeError(w, r, http.StatusBadRequest, "provider_strategy_group_rationale_required", "provider strategy group updates require a non-secret rationale", map[string]any{
			"field": "rationale",
		})
		return
	}
	groupID := strings.TrimSpace(r.PathValue("group_id"))
	result, err := reader.UpdateStrategyGroup(r.Context(), provider.StrategyGroupUpdate{
		GroupID:             groupID,
		DisplayName:         input.DisplayName,
		ToolType:            input.ToolType,
		Status:              input.Status,
		SelectionPolicy:     input.SelectionPolicy,
		FallbackProviderIDs: input.FallbackProviderIDs,
		KillSwitch:          input.KillSwitch,
		Members:             input.Members,
		Metadata:            input.Metadata,
	})
	if err != nil {
		writeProviderRegistryMutationError(w, r, err, "strategy_group_update")
		return
	}
	if !validateProviderStrategyGroupProjection(w, r, result.Before, "before") {
		return
	}
	if !validateProviderStrategyGroupProjection(w, r, result.After, "after") {
		return
	}
	metadata := providerStrategyGroupAuditMetadata(result.After, rationale, requestIDFrom(r.Context()))
	metadata["before_status"] = string(result.Before.Status)
	metadata["after_status"] = string(result.After.Status)
	metadata["before_member_count"] = len(result.Before.Members)
	metadata["after_member_count"] = len(result.After.Members)
	metadata["before_kill_switch"] = result.Before.KillSwitch
	metadata["after_kill_switch"] = result.After.KillSwitch
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        newAuditID(principal.TenantID, principal.UserID, "provider.strategy_group.update", result.After.GroupID),
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    "provider.strategy_group.update",
		Resource:  "provider-strategy-groups/" + result.After.GroupID,
		CreatedAt: time.Now().UTC(),
		Metadata:  metadata,
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_strategy_group_audit_record_error", "provider strategy group update audit record could not be written", nil)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) updateProviderRegistry(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	reader, ok := provider.RegistryReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_not_connected", "provider registry storage is not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_audit_not_connected", "provider registry audit logging is not connected yet", nil)
		return
	}
	var input struct {
		Status       provider.RegistryStatus `json:"status"`
		SecretRef    *string                 `json:"secret_ref"`
		Routing      provider.RoutingPolicy  `json:"routing"`
		Capabilities []provider.Capability   `json:"capabilities"`
		Rationale    string                  `json:"rationale"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	setCapabilities := input.Capabilities != nil
	rationale := providerRegistryRationale(input.Rationale)
	if rationale == "" {
		writeError(w, r, http.StatusBadRequest, "provider_registry_rationale_required", "provider registry updates require a non-secret rationale", map[string]any{
			"field": "rationale",
		})
		return
	}
	if input.SecretRef != nil {
		secretRef := strings.TrimSpace(*input.SecretRef)
		if providerRegistrySecretRefInvalid(secretRef) {
			writeError(w, r, http.StatusBadRequest, "provider_registry_secret_ref_invalid", "provider registry secret_ref must be a secret manager reference, not a raw secret value", map[string]any{
				"field": "secret_ref",
			})
			return
		}
		input.SecretRef = &secretRef
	}
	update := provider.RegistryUpdate{
		ProviderID:    strings.TrimSpace(r.PathValue("provider_id")),
		Status:        input.Status,
		SecretRef:     input.SecretRef,
		Routing:       input.Routing,
		Capabilities:  input.Capabilities,
		SetCapability: setCapabilities,
	}
	result, err := reader.UpdateAdminRegistry(r.Context(), update)
	if err != nil {
		writeProviderRegistryMutationError(w, r, err, "update")
		return
	}
	if !validateProviderRegistryProjection(w, r, result.Before, "before") {
		return
	}
	if !validateProviderRegistryProjection(w, r, result.After, "after") {
		return
	}
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        newAuditID(principal.TenantID, principal.UserID, "provider.registry.update", update.ProviderID),
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    "provider.registry.update",
		Resource:  "providers/" + update.ProviderID,
		CreatedAt: time.Now().UTC(),
		Metadata: map[string]any{
			"rationale":                   rationale,
			"provider_id":                 update.ProviderID,
			"before_status":               string(result.Before.Status),
			"after_status":                string(result.After.Status),
			"before_routing":              result.Before.Routing,
			"after_routing":               result.After.Routing,
			"reference_changed":           strings.TrimSpace(result.Before.SecretRef) != strings.TrimSpace(result.After.SecretRef),
			"capabilities_changed":        setCapabilities,
			"before_capability_count":     len(result.Before.Capabilities),
			"after_capability_count":      len(result.After.Capabilities),
			"before_estimated_cost_cents": providerCapabilityCost(result.Before.Capabilities),
			"after_estimated_cost_cents":  providerCapabilityCost(result.After.Capabilities),
			"request_id":                  requestIDFrom(r.Context()),
		},
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_registry_audit_record_error", "provider registry update audit record could not be written", nil)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) deleteProviderRegistry(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	reader, ok := provider.RegistryReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_not_connected", "provider registry storage is not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_audit_not_connected", "provider registry audit logging is not connected yet", nil)
		return
	}
	var input struct {
		Rationale string `json:"rationale"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	rationale := providerRegistryRationale(input.Rationale)
	if rationale == "" {
		writeError(w, r, http.StatusBadRequest, "provider_registry_rationale_required", "provider registry deletes require a non-secret rationale", map[string]any{
			"field": "rationale",
		})
		return
	}
	deleteInput := provider.RegistryDelete{ProviderID: strings.TrimSpace(r.PathValue("provider_id"))}
	result, err := reader.DeleteAdminRegistry(r.Context(), deleteInput)
	if err != nil {
		writeProviderRegistryMutationError(w, r, err, "delete")
		return
	}
	if !validateProviderRegistryProjection(w, r, result.Deleted, "deleted") {
		return
	}
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        newAuditID(principal.TenantID, principal.UserID, "provider.registry.delete", result.Deleted.ProviderID),
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    "provider.registry.delete",
		Resource:  "providers/" + result.Deleted.ProviderID,
		CreatedAt: time.Now().UTC(),
		Metadata: map[string]any{
			"rationale":                    rationale,
			"provider_id":                  result.Deleted.ProviderID,
			"mode":                         string(result.Deleted.Mode),
			"status":                       string(result.Deleted.Status),
			"routing":                      result.Deleted.Routing,
			"secret_present":               result.Deleted.SecretPresent,
			"deleted_capability_count":     len(result.Deleted.Capabilities),
			"deleted_estimated_cost_cents": providerCapabilityCost(result.Deleted.Capabilities),
			"request_id":                   requestIDFrom(r.Context()),
		},
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_registry_audit_record_error", "provider registry delete audit record could not be written", nil)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) probeProviderRegistryHealth(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	reader, ok := provider.RegistryReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_not_connected", "provider registry storage is not connected yet", nil)
		return
	}
	resolver, ok := provider.ClientResolverFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_health_probe_not_connected", "provider health probe clients are not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_audit_not_connected", "provider registry audit logging is not connected yet", nil)
		return
	}
	var input struct {
		Rationale string `json:"rationale"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	rationale := providerRegistryRationale(input.Rationale)
	if rationale == "" {
		writeError(w, r, http.StatusBadRequest, "provider_health_probe_rationale_required", "provider health probes require a non-secret rationale", map[string]any{
			"field": "rationale",
		})
		return
	}
	providerID := strings.TrimSpace(r.PathValue("provider_id"))
	client, ok := resolver.ResolveProviderClient(providerID)
	status := provider.Status{
		ProviderID: providerID,
		Available:  false,
		CheckedAt:  time.Now().UTC(),
		Message:    "provider health client not configured",
	}
	if ok && client != nil {
		status = client.Status(r.Context())
		if strings.TrimSpace(status.ProviderID) == "" {
			status.ProviderID = providerID
		}
		if status.CheckedAt.IsZero() {
			status.CheckedAt = time.Now().UTC()
		}
	}
	result, err := reader.ProbeAdminRegistryHealth(r.Context(), provider.RegistryHealthProbe{
		ProviderID: providerID,
		Status:     status,
	})
	if err != nil {
		writeProviderRegistryMutationError(w, r, err, "health_probe")
		return
	}
	if !validateProviderRegistryProjection(w, r, result.Before, "before") {
		return
	}
	if !validateProviderRegistryProjection(w, r, result.After, "after") {
		return
	}
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        newAuditID(principal.TenantID, principal.UserID, "provider.registry.health_probe", result.After.ProviderID),
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    "provider.registry.health_probe",
		Resource:  "providers/" + result.After.ProviderID,
		CreatedAt: time.Now().UTC(),
		Metadata: map[string]any{
			"rationale":                rationale,
			"provider_id":              result.After.ProviderID,
			"before_available":         result.Before.Health.Available,
			"after_available":          result.After.Health.Available,
			"before_latency_ms":        result.Before.Health.LatencyMS,
			"after_latency_ms":         result.After.Health.LatencyMS,
			"after_error_rate_percent": result.After.Health.ErrorRatePercent,
			"client_configured":        ok && client != nil,
			"request_id":               requestIDFrom(r.Context()),
		},
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_registry_audit_record_error", "provider health probe audit record could not be written", nil)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func providerRegistryRationale(value string) string {
	rationale := strings.TrimSpace(security.RedactString(value))
	if rationale == security.Redacted || strings.Contains(rationale, security.Redacted) {
		return ""
	}
	return rationale
}

func providerRegistrySecretRefInvalid(value string) bool {
	return strings.Contains(security.RedactString(value), security.Redacted)
}

func validateProviderRegistryProjection(w http.ResponseWriter, r *http.Request, projection provider.AdminRegistryProjection, label string) bool {
	if err := provider.ValidateAdminProjection(projection); err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_registry_projection_error", "provider registry "+label+" projection failed safety validation", map[string]any{
			"provider_id": projection.ProviderID,
		})
		return false
	}
	return true
}

func validateProviderStrategyGroupProjection(w http.ResponseWriter, r *http.Request, group provider.StrategyGroup, label string) bool {
	if err := provider.ValidateStrategyGroup(group); err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_strategy_group_projection_error", "provider strategy group "+label+" projection failed safety validation", map[string]any{
			"group_id": group.GroupID,
		})
		return false
	}
	return true
}

func providerStrategyGroupAuditMetadata(group provider.StrategyGroup, rationale, requestID string) map[string]any {
	return security.RedactMap(map[string]any{
		"rationale":             rationale,
		"group_id":              group.GroupID,
		"tool_type":             group.ToolType,
		"status":                string(group.Status),
		"selection_policy":      string(group.SelectionPolicy),
		"fallback_provider_ids": group.FallbackProviderIDs,
		"kill_switch":           group.KillSwitch,
		"member_count":          len(group.Members),
		"member_provider_ids":   strategyGroupMemberProviderIDs(group.Members),
		"request_id":            requestID,
	})
}

func strategyGroupMemberProviderIDs(members []provider.StrategyGroupMember) []string {
	providerIDs := make([]string, 0, len(members))
	for _, member := range members {
		providerIDs = append(providerIDs, member.ProviderID)
	}
	return providerIDs
}

func providerCapabilityCost(capabilities []provider.Capability) int64 {
	var total int64
	for _, capability := range capabilities {
		total += capability.EstimatedCostCents
	}
	return total
}

func (s *Server) runProviderSandboxTestCall(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	reader, ok := provider.RegistryReaderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_registry_not_connected", "provider registry storage is not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "provider_test_call_audit_not_connected", "provider sandbox test-call audit logging is not connected yet", nil)
		return
	}
	var input struct {
		ModelID   string `json:"model_id"`
		ToolType  string `json:"tool_type"`
		Prompt    string `json:"prompt"`
		Rationale string `json:"rationale"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	rationale := strings.TrimSpace(security.RedactString(input.Rationale))
	if rationale == "" || rationale == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "provider_test_call_rationale_required", "provider sandbox test calls require a non-secret rationale", map[string]any{
			"field": "rationale",
		})
		return
	}
	testInput := provider.SandboxTestCallInput{
		ProviderID: strings.TrimSpace(r.PathValue("provider_id")),
		ModelID:    strings.TrimSpace(input.ModelID),
		ToolType:   strings.TrimSpace(input.ToolType),
		Prompt:     strings.TrimSpace(input.Prompt),
		Rationale:  rationale,
	}
	if err := provider.ValidateSandboxTestCallInput(testInput); err != nil {
		writeProviderSandboxTestCallError(w, r, err)
		return
	}
	result, err := reader.RunSandboxTestCall(r.Context(), testInput)
	if err != nil {
		writeProviderSandboxTestCallError(w, r, err)
		return
	}
	if result.UserVisible || result.AssetPersisted || strings.Contains(security.RedactString(result.SecretRef), security.Redacted) {
		writeError(w, r, http.StatusInternalServerError, "provider_test_call_projection_error", "provider sandbox test-call projection failed safety validation", map[string]any{
			"provider_id": result.ProviderID,
		})
		return
	}
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        newAuditID(principal.TenantID, principal.UserID, "provider.sandbox_test_call", result.ProviderID, result.ID),
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    "provider.sandbox_test_call",
		Resource:  "providers/" + result.ProviderID,
		CreatedAt: time.Now().UTC(),
		Metadata: map[string]any{
			"rationale":       rationale,
			"provider_id":     result.ProviderID,
			"model_id":        result.ModelID,
			"tool_type":       result.ToolType,
			"mode":            string(result.Mode),
			"status":          result.Status,
			"asset_persisted": result.AssetPersisted,
			"user_visible":    result.UserVisible,
			"trace_id":        result.TraceID,
			"request_id":      requestIDFrom(r.Context()),
		},
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "provider_test_call_audit_record_error", "provider sandbox test-call audit record could not be written", nil)
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) createAdminBillingManualCredit(w http.ResponseWriter, r *http.Request) {
	var input struct {
		TargetUserID string         `json:"target_user_id"`
		BucketID     string         `json:"bucket_id"`
		Units        int64          `json:"units"`
		Rationale    string         `json:"rationale"`
		Metadata     map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	result, ok := s.runAdminBillingOperation(w, r, billing.AdminBillingOperationInput{
		Operation:    billing.AdminBillingOperationManualCredit,
		TargetUserID: strings.TrimSpace(input.TargetUserID),
		BucketID:     strings.TrimSpace(input.BucketID),
		Units:        input.Units,
		Rationale:    strings.TrimSpace(input.Rationale),
		Metadata:     input.Metadata,
	}, "billing.manual_credit")
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) createAdminBillingRefundNote(w http.ResponseWriter, r *http.Request) {
	var input struct {
		TargetUserID   string         `json:"target_user_id"`
		SubscriptionID string         `json:"subscription_id"`
		Provider       string         `json:"provider"`
		ProviderRef    string         `json:"provider_ref"`
		Note           string         `json:"note"`
		Rationale      string         `json:"rationale"`
		Metadata       map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	result, ok := s.runAdminBillingOperation(w, r, billing.AdminBillingOperationInput{
		Operation:      billing.AdminBillingOperationRefundNote,
		TargetUserID:   strings.TrimSpace(input.TargetUserID),
		SubscriptionID: strings.TrimSpace(input.SubscriptionID),
		Provider:       strings.TrimSpace(input.Provider),
		ProviderRef:    strings.TrimSpace(input.ProviderRef),
		Note:           strings.TrimSpace(security.RedactString(input.Note)),
		Rationale:      strings.TrimSpace(input.Rationale),
		Metadata:       input.Metadata,
	}, "billing.refund_note")
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) createAdminBillingSubscriptionSync(w http.ResponseWriter, r *http.Request) {
	var input struct {
		TargetUserID   string         `json:"target_user_id"`
		SubscriptionID string         `json:"subscription_id"`
		Provider       string         `json:"provider"`
		ProviderRef    string         `json:"provider_ref"`
		Rationale      string         `json:"rationale"`
		Metadata       map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	result, ok := s.runAdminBillingOperation(w, r, billing.AdminBillingOperationInput{
		Operation:      billing.AdminBillingOperationSyncSubscription,
		TargetUserID:   strings.TrimSpace(input.TargetUserID),
		SubscriptionID: strings.TrimSpace(input.SubscriptionID),
		Provider:       strings.TrimSpace(input.Provider),
		ProviderRef:    strings.TrimSpace(input.ProviderRef),
		Rationale:      strings.TrimSpace(input.Rationale),
		Metadata:       input.Metadata,
	}, "billing.subscription_sync")
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) createAdminBillingAccountLock(w http.ResponseWriter, r *http.Request) {
	var input struct {
		TargetUserID string         `json:"target_user_id"`
		Locked       *bool          `json:"locked"`
		Rationale    string         `json:"rationale"`
		Metadata     map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	result, ok := s.runAdminBillingOperation(w, r, billing.AdminBillingOperationInput{
		Operation:    billing.AdminBillingOperationAccountLock,
		TargetUserID: strings.TrimSpace(input.TargetUserID),
		Locked:       input.Locked,
		Rationale:    strings.TrimSpace(input.Rationale),
		Metadata:     input.Metadata,
	}, "billing.account_lock")
	if !ok {
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) runAdminBillingOperation(w http.ResponseWriter, r *http.Request, input billing.AdminBillingOperationInput, auditAction string) (billing.AdminBillingOperationResult, bool) {
	if !requireIdempotencyKey(w, r) {
		return billing.AdminBillingOperationResult{}, false
	}
	principal, _ := PrincipalFromContext(r.Context())
	operator, ok := billingAdminOperatorFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_admin_ops_not_connected", "admin billing operations storage is not connected yet", nil)
		return billing.AdminBillingOperationResult{}, false
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "billing_admin_audit_not_connected", "admin billing operation audit logging is not connected yet", nil)
		return billing.AdminBillingOperationResult{}, false
	}
	input.TenantID = principal.TenantID
	input.ActorID = principal.UserID
	input.IdempotencyKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	input.Rationale = strings.TrimSpace(security.RedactString(input.Rationale))
	input.Metadata = security.RedactMap(input.Metadata)
	if input.TargetUserID == "" {
		writeError(w, r, http.StatusBadRequest, "billing_admin_target_user_required", "admin billing operation requires target_user_id", map[string]any{"field": "target_user_id"})
		return billing.AdminBillingOperationResult{}, false
	}
	if input.Rationale == "" || input.Rationale == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "billing_admin_rationale_required", "admin billing operations require a non-secret rationale", map[string]any{"field": "rationale"})
		return billing.AdminBillingOperationResult{}, false
	}
	if input.Note == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "billing_admin_note_invalid", "admin billing note must not contain raw secret material", map[string]any{"field": "note"})
		return billing.AdminBillingOperationResult{}, false
	}
	if input.Operation == billing.AdminBillingOperationManualCredit && (input.Units <= 0 || input.BucketID == "") {
		writeError(w, r, http.StatusBadRequest, "billing_admin_manual_credit_invalid", "manual credit requires bucket_id and positive units", map[string]any{
			"bucket_id_required": true,
			"units_positive":     true,
		})
		return billing.AdminBillingOperationResult{}, false
	}
	if input.Operation == billing.AdminBillingOperationRefundNote && input.Note == "" {
		writeError(w, r, http.StatusBadRequest, "billing_admin_refund_note_required", "refund note requires a non-secret note", map[string]any{"field": "note"})
		return billing.AdminBillingOperationResult{}, false
	}
	requestID := requestIDFrom(r.Context())
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        newAuditID(principal.TenantID, principal.UserID, auditAction, input.TargetUserID, input.IdempotencyKey),
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    auditAction + ".requested",
		Resource:  "billing/" + input.TargetUserID,
		CreatedAt: time.Now().UTC(),
		Metadata:  adminBillingAuditMetadata(input, requestID),
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "billing_admin_audit_record_error", "admin billing operation audit request record could not be written", nil)
		return billing.AdminBillingOperationResult{}, false
	}

	result, err := callAdminBillingOperator(r.Context(), operator, input)
	if err != nil {
		_ = recorder.Record(r.Context(), audit.Event{
			ID:        newAuditID(principal.TenantID, principal.UserID, auditAction, input.TargetUserID, input.IdempotencyKey, "failed"),
			TenantID:  principal.TenantID,
			ActorID:   principal.UserID,
			Action:    auditAction + ".failed",
			Resource:  "billing/" + input.TargetUserID,
			CreatedAt: time.Now().UTC(),
			Metadata:  adminBillingAuditMetadataWithError(input, requestID, err),
		})
		writeAdminBillingOperationError(w, r, err)
		return billing.AdminBillingOperationResult{}, false
	}
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        newAuditID(principal.TenantID, principal.UserID, auditAction, result.ID),
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    auditAction,
		Resource:  "billing/" + result.TargetUserID,
		CreatedAt: time.Now().UTC(),
		Metadata:  adminBillingResultAuditMetadata(result, requestID),
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "billing_admin_audit_record_error", "admin billing operation audit completion record could not be written", nil)
		return billing.AdminBillingOperationResult{}, false
	}
	return result, true
}

func callAdminBillingOperator(ctx context.Context, operator billing.AdminBillingOperator, input billing.AdminBillingOperationInput) (billing.AdminBillingOperationResult, error) {
	switch input.Operation {
	case billing.AdminBillingOperationManualCredit:
		return operator.ManualCredit(ctx, input)
	case billing.AdminBillingOperationRefundNote:
		return operator.RecordRefundNote(ctx, input)
	case billing.AdminBillingOperationSyncSubscription:
		return operator.SyncSubscription(ctx, input)
	case billing.AdminBillingOperationAccountLock:
		return operator.LockAccount(ctx, input)
	default:
		return billing.AdminBillingOperationResult{}, billing.ErrAdminBillingValidation
	}
}

func writeAdminBillingOperationError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, billing.ErrAdminBillingValidation) {
		writeError(w, r, http.StatusBadRequest, "billing_admin_validation_error", "admin billing operation validation failed", nil)
		return
	}
	writeError(w, r, http.StatusInternalServerError, "billing_admin_operation_error", "admin billing operation failed", nil)
}

func adminBillingAuditMetadata(input billing.AdminBillingOperationInput, requestID string) map[string]any {
	metadata := map[string]any{
		"operation":       string(input.Operation),
		"target_user_id":  input.TargetUserID,
		"rationale":       input.Rationale,
		"idempotency_key": input.IdempotencyKey,
		"units":           input.Units,
		"bucket_id":       input.BucketID,
		"subscription_id": input.SubscriptionID,
		"provider":        input.Provider,
		"provider_ref":    input.ProviderRef,
		"note":            input.Note,
		"request_id":      requestID,
	}
	if input.Locked != nil {
		metadata["locked"] = *input.Locked
	}
	for key, value := range input.Metadata {
		if _, exists := metadata[key]; !exists {
			metadata[key] = value
		}
	}
	return security.RedactMap(metadata)
}

func adminBillingAuditMetadataWithError(input billing.AdminBillingOperationInput, requestID string, err error) map[string]any {
	metadata := adminBillingAuditMetadata(input, requestID)
	metadata["error"] = security.RedactString(err.Error())
	return metadata
}

func adminBillingResultAuditMetadata(result billing.AdminBillingOperationResult, requestID string) map[string]any {
	metadata := map[string]any{
		"operation_id":    result.ID,
		"operation":       string(result.Operation),
		"target_user_id":  result.TargetUserID,
		"status":          result.Status,
		"rationale":       result.Rationale,
		"idempotency_key": result.IdempotencyKey,
		"units":           result.Units,
		"bucket_id":       result.BucketID,
		"subscription_id": result.SubscriptionID,
		"provider":        result.Provider,
		"provider_ref":    result.ProviderRef,
		"note":            result.Note,
		"request_id":      requestID,
	}
	if result.Locked != nil {
		metadata["locked"] = *result.Locked
	}
	for key, value := range result.Metadata {
		if _, exists := metadata[key]; !exists {
			metadata[key] = value
		}
	}
	return security.RedactMap(metadata)
}

func writeProviderRegistryMutationError(w http.ResponseWriter, r *http.Request, err error, mutation string) {
	switch {
	case errors.Is(err, provider.ErrRegistryNotFound):
		writeError(w, r, http.StatusNotFound, "provider_registry_not_found", "provider registry entry was not found", nil)
	case strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "unsupported") || strings.Contains(err.Error(), "must") || strings.Contains(err.Error(), "between"):
		writeError(w, r, http.StatusBadRequest, "provider_registry_validation_error", err.Error(), nil)
	default:
		writeError(w, r, http.StatusInternalServerError, "provider_registry_"+mutation+"_error", "provider registry "+mutation+" failed", nil)
	}
}

func writeProviderSandboxTestCallError(w http.ResponseWriter, r *http.Request, err error) {
	if providerErr, ok := provider.ErrorDetails(err); ok {
		writeProviderSandboxProviderError(w, r, providerErr)
		return
	}
	switch {
	case errors.Is(err, provider.ErrRegistryNotFound):
		writeError(w, r, http.StatusNotFound, "provider_registry_not_found", "provider registry entry was not found", nil)
	case strings.Contains(err.Error(), "required") || strings.Contains(err.Error(), "unsupported") || strings.Contains(err.Error(), "must") || strings.Contains(err.Error(), "between") || strings.Contains(err.Error(), "does not support") || strings.Contains(err.Error(), "not enabled") || strings.Contains(err.Error(), "must not contain secrets"):
		writeError(w, r, http.StatusBadRequest, "provider_test_call_validation_error", err.Error(), nil)
	default:
		writeError(w, r, http.StatusInternalServerError, "provider_test_call_error", "provider sandbox test call failed", nil)
	}
}

func writeProviderSandboxProviderError(w http.ResponseWriter, r *http.Request, err *provider.Error) {
	details := map[string]any{
		"provider_error_code": strings.TrimSpace(err.Code),
		"retryable":           err.Retryable,
	}
	if err.HTTPStatus > 0 {
		details["provider_http_status"] = err.HTTPStatus
	}
	if providerCode := strings.TrimSpace(security.RedactString(err.ProviderCode)); providerCode != "" && providerCode != security.Redacted {
		details["provider_code"] = providerCode
	}
	if retryAfter := strings.TrimSpace(security.RedactString(err.RetryAfter)); retryAfter != "" && retryAfter != security.Redacted {
		details["retry_after"] = retryAfter
	}
	switch strings.TrimSpace(err.Code) {
	case "provider_quota_unavailable":
		writeError(w, r, http.StatusConflict, "provider_quota_unavailable", "provider sandbox test call could not run because provider quota or billing resources are unavailable", details)
	case "provider_retryable_http_error":
		writeError(w, r, http.StatusBadGateway, "provider_unavailable", "provider sandbox test call hit a retryable provider error", details)
	default:
		status := http.StatusBadGateway
		if err.Retryable {
			status = http.StatusServiceUnavailable
		}
		writeError(w, r, status, "provider_unavailable", "provider sandbox test call failed at the provider boundary", details)
	}
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
		MalwareScanner:      s.malwareScanner,
		MalwareFailClosed:   s.cfg.Security.MalwareScanFailClosed,
	})
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, upload)
}

func (s *Server) listAssetLibrary(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "asset_library_not_connected", "asset library storage is not connected yet", nil)
		return
	}
	page, err := repo.ListAssetLibrary(r.Context(), principal.TenantID, r.URL.Query().Get("project_id"), r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) createAssetLibraryEntry(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "asset_library_not_connected", "asset library storage is not connected yet", nil)
		return
	}
	var input stage0.AssetLibraryEntryCreate
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	entry, err := repo.CreateAssetLibraryEntry(r.Context(), principal.TenantID, principal.UserID, input)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, entry)
}

func (s *Server) updateAssetLibraryEntry(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	entryID := strings.TrimSpace(r.PathValue("entry_id"))
	if entryID == "" {
		writeError(w, r, http.StatusBadRequest, "asset_library_entry_id_required", "asset library entry id is required", nil)
		return
	}
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "asset_library_not_connected", "asset library storage is not connected yet", nil)
		return
	}
	var input stage0.AssetLibraryEntryUpdate
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	entry, err := repo.UpdateAssetLibraryEntry(r.Context(), principal.TenantID, principal.UserID, entryID, input)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, entry)
}

func (s *Server) listBrandKits(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "brand_kits_not_connected", "brand kit storage is not connected yet", nil)
		return
	}
	page, err := repo.ListBrandKits(r.Context(), principal.TenantID, r.URL.Query().Get("project_id"), r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) createBrandKit(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "brand_kits_not_connected", "brand kit storage is not connected yet", nil)
		return
	}
	var input stage0.BrandKitCreate
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	kit, err := repo.CreateBrandKit(r.Context(), principal.TenantID, principal.UserID, input)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, kit)
}

func (s *Server) updateBrandKit(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	kitID := strings.TrimSpace(r.PathValue("brand_kit_id"))
	if kitID == "" {
		writeError(w, r, http.StatusBadRequest, "brand_kit_id_required", "brand kit id is required", nil)
		return
	}
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "brand_kits_not_connected", "brand kit storage is not connected yet", nil)
		return
	}
	var input stage0.BrandKitUpdate
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	kit, err := repo.UpdateBrandKit(r.Context(), principal.TenantID, principal.UserID, kitID, input)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, kit)
}

func (s *Server) getProjectDefaultBrandKit(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	projectID := strings.TrimSpace(r.PathValue("project_id"))
	if projectID == "" {
		writeError(w, r, http.StatusBadRequest, "project_id_required", "project_id is required", nil)
		return
	}
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "brand_kits_not_connected", "brand kit storage is not connected yet", nil)
		return
	}
	kit, err := repo.GetProjectDefaultBrandKit(r.Context(), principal.TenantID, projectID)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, kit)
}

func (s *Server) setProjectDefaultBrandKit(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	projectID := strings.TrimSpace(r.PathValue("project_id"))
	if projectID == "" {
		writeError(w, r, http.StatusBadRequest, "project_id_required", "project_id is required", nil)
		return
	}
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "brand_kits_not_connected", "brand kit storage is not connected yet", nil)
		return
	}
	var input stage0.ProjectDefaultBrandKitSet
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	kit, err := repo.SetProjectDefaultBrandKit(r.Context(), principal.TenantID, principal.UserID, projectID, input)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, kit)
}

func (s *Server) listPackages(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	projectID := strings.TrimSpace(r.PathValue("project_id"))
	if projectID == "" {
		writeError(w, r, http.StatusBadRequest, "project_id_required", "project_id is required", nil)
		return
	}
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "package_service_not_connected", "package storage is not connected yet", nil)
		return
	}
	page, err := repo.ListPackages(r.Context(), principal.TenantID, projectID, r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) createPackage(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	projectID := strings.TrimSpace(r.PathValue("project_id"))
	if projectID == "" {
		writeError(w, r, http.StatusBadRequest, "project_id_required", "project_id is required", nil)
		return
	}
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "package_service_not_connected", "package storage is not connected yet", nil)
		return
	}
	var input stage0.PackageCreate
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	pkg, err := repo.CreatePackage(r.Context(), principal.TenantID, principal.UserID, projectID, input)
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, pkg)
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
	stored, scanResult, err := service.PutUploadedObject(r.Context(), objectstore.Object{
		TenantID:    principal.TenantID,
		Bucket:      s.cfg.ObjectStorage.Bucket,
		Key:         key,
		ContentType: contentType,
	}, reader, s.cfg.Security.MalwareScanFailClosed)
	if err != nil {
		writeUploadObjectError(w, r, err)
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
		"malware_scan": malwareScanResponse(scanResult),
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
	reader, objectMetadata, err := service.GetDownloadableObject(r.Context(), tenantID, key)
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
			"object_metadata_id": objectMetadata.ID,
			"object_key":         key,
			"asset_type":         objectMetadata.AssetType,
			"project_id":         stringValue(objectMetadata.ProjectID),
			"owner_id":           stringValue(objectMetadata.OwnerID),
			"bucket":             reader.Object.Bucket,
			"content_type":       firstNonEmpty(reader.Object.ContentType, objectMetadata.ContentType),
			"byte_size":          firstPositive(reader.Object.ByteSize, objectMetadata.ByteSize),
			"expires_at":         time.Unix(expires, 0).UTC().Format(time.RFC3339),
			"request_id":         requestIDFrom(r.Context()),
			"remote_addr":        r.RemoteAddr,
			"user_agent":         r.UserAgent(),
			"signed_access":      true,
		},
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "download_audit_record_error", "signed download audit log could not be written", nil)
		return
	}
	if err := service.Repository().RecordAnalyticsEvent(r.Context(), stage0.AnalyticsEvent{
		TenantID:    tenantID,
		UserID:      stringValue(objectMetadata.OwnerID),
		ProjectID:   stringValue(objectMetadata.ProjectID),
		EventName:   "object_downloaded",
		SubjectType: "object_metadata",
		SubjectID:   objectMetadata.ID,
		Properties: map[string]any{
			"object_key":    key,
			"asset_type":    objectMetadata.AssetType,
			"bucket":        reader.Object.Bucket,
			"content_type":  firstNonEmpty(reader.Object.ContentType, objectMetadata.ContentType),
			"byte_size":     firstPositive(reader.Object.ByteSize, objectMetadata.ByteSize),
			"expires_at":    time.Unix(expires, 0).UTC().Format(time.RFC3339),
			"request_id":    requestIDFrom(r.Context()),
			"signed_access": true,
		},
		CreatedAt: time.Now().UTC(),
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "download_analytics_record_error", "signed download analytics event could not be written", nil)
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

func malwareScanResponse(result security.MalwareScanResult) map[string]any {
	value := map[string]any{
		"status":     string(result.Status),
		"provider":   result.Provider,
		"definition": result.Signature,
		"rationale":  result.Rationale,
		"scanned_at": result.ScannedAt.UTC().Format(time.RFC3339),
	}
	if len(result.Metadata) > 0 {
		value["metadata"] = result.Metadata
	}
	return security.RedactMap(value)
}

func signedObjectParams(r *http.Request) (string, int64, string, bool) {
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return "", 0, "", false
	}
	key, ok := singleSignedQueryValue(query, "key")
	if !ok {
		return "", 0, "", false
	}
	key = strings.Trim(strings.TrimSpace(key), "/")
	expiresValue, ok := singleSignedQueryValue(query, "expires")
	if !ok {
		return "", 0, "", false
	}
	sig, ok := singleSignedQueryValue(query, "sig")
	if !ok {
		return "", 0, "", false
	}
	sig = strings.TrimSpace(sig)
	expires, err := strconv.ParseInt(expiresValue, 10, 64)
	if key == "" || sig == "" || err != nil {
		return "", 0, "", false
	}
	return key, expires, sig, true
}

func singleSignedQueryValue(query url.Values, name string) (string, bool) {
	values, ok := query[name]
	if !ok || len(values) != 1 {
		return "", false
	}
	return values[0], true
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

func (s *Server) SignDownloadURL(_ context.Context, tenantID, objectKey string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		return "", errors.New("signed URL ttl must be positive")
	}
	key, err := tenantScopedDownloadObjectKey(tenantID, objectKey)
	if err != nil {
		return "", err
	}
	if _, err := tenantIDFromScopedObjectKey(key); err != nil {
		return "", err
	}
	expires := time.Now().UTC().Add(ttl).Unix()
	values := url.Values{}
	values.Set("key", key)
	values.Set("expires", strconv.FormatInt(expires, 10))
	values.Set("sig", s.signDownloadObjectKey(key, expires))
	return "/api/v1/objects/download?" + values.Encode(), nil
}

func tenantScopedDownloadObjectKey(tenantID, objectKey string) (string, error) {
	tenantID = strings.Trim(strings.TrimSpace(tenantID), "/")
	key := strings.Trim(strings.TrimSpace(objectKey), "/")
	prefix := "tenants/" + tenantID + "/"
	if strings.HasPrefix(key, "tenants/") && !strings.HasPrefix(key, prefix) {
		return "", errors.New("object key tenant scope does not match tenant_id")
	}
	if strings.HasPrefix(key, prefix) {
		return key, nil
	}
	return prefix + key, nil
}

func tenantIDFromScopedObjectKey(key string) (string, error) {
	key = strings.Trim(strings.TrimSpace(key), "/")
	parts := strings.SplitN(key, "/", 3)
	if len(parts) != 3 || parts[0] != "tenants" || parts[1] == "" || parts[2] == "" {
		return "", errors.New("object key is missing tenant scope")
	}
	if strings.ContainsAny(parts[1], `/\`) || parts[1] == "." || parts[1] == ".." || !scopedObjectTenantIDPattern.MatchString(parts[1]) {
		return "", errors.New("tenant_id is invalid")
	}
	if strings.Contains(parts[2], "\\") || hasUnsafeObjectKeySegment(parts[2]) {
		return "", errors.New("object key is invalid")
	}
	return parts[1], nil
}

func hasUnsafeObjectKeySegment(key string) bool {
	for _, segment := range strings.Split(key, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return true
		}
	}
	return false
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
	taskStatus, err := service.CreateExport(r.Context(), principal.TenantID, principal.UserID, r.PathValue("package_id"), input, s.cfg.Tasks.SchemaVersion)
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
	export, err := service.GetExport(r.Context(), principal.TenantID, r.PathValue("export_id"))
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

func (s *Server) listSkills(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "skill_release_service_not_connected", "skill release storage is not connected yet", nil)
		return
	}
	page, err := repo.ListSkills(r.Context(), principal.TenantID, r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) listSkillVersions(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "skill_release_service_not_connected", "skill release storage is not connected yet", nil)
		return
	}
	page, err := repo.ListSkillVersions(r.Context(), principal.TenantID, r.PathValue("skill_id"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) listEvalResults(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "eval_result_service_not_connected", "eval result storage is not connected yet", nil)
		return
	}
	completedAfter, err := parseOptionalRFC3339(r.URL.Query().Get("completed_after"))
	if err != nil {
		writeError(w, r, http.StatusBadRequest, "eval_completed_after_invalid", "completed_after must be RFC3339 when provided", map[string]any{"field": "completed_after"})
		return
	}
	page, err := repo.ListEvalResults(r.Context(), stage0.EvalResultFilters{
		TenantID:       principal.TenantID,
		SuiteID:        r.URL.Query().Get("eval_suite_id"),
		Status:         r.URL.Query().Get("status"),
		SubjectType:    r.URL.Query().Get("subject_type"),
		SubjectID:      r.URL.Query().Get("subject_id"),
		SubjectVersion: r.URL.Query().Get("subject_version"),
		CompletedAfter: completedAfter,
		LatestOnly:     parseBoolQuery(r.URL.Query().Get("latest_only")),
		Limit:          pageSize(r),
	})
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) getEvalResultArtifact(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "eval_result_service_not_connected", "eval result storage is not connected yet", nil)
		return
	}
	artifact, err := repo.GetEvalResultArtifact(r.Context(), principal.TenantID, r.PathValue("result_id"), time.Now().UTC())
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, artifact)
}

func (s *Server) cleanupExports(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	s.cleanupExportsWithMode(w, r, "combined", false)
}

func (s *Server) cleanupObjectStorageExpiredExports(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	s.cleanupExportsWithMode(w, r, "expired_export_cleanup", true)
}

func (s *Server) cleanupObjectStorageOrphans(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	s.cleanupExportsWithMode(w, r, "orphan_cleanup", true)
}

func (s *Server) objectStorageRetentionPolicy(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	now := time.Now().UTC()
	writeJSON(w, http.StatusOK, map[string]any{
		"policy":             "object storage retention policy",
		"retention_policy":   "tenant scoped export objects keep retention_until metadata and expire through audited cleanup",
		"versioning":         "S3-compatible buckets must keep provider versioning or equivalent object restore enabled for staging and production",
		"retention_until":    "required for expiring export objects and propagated to derived thumbnails",
		"tenant":             principal.TenantID,
		"cleanup_modes":      []string{"expired export cleanup", "orphan cleanup"},
		"audit_resource":     "object_storage_cleanup",
		"release_gate_check": "staging_object_storage_signed_downloads",
		"checked_at":         now,
	})
}

func (s *Server) cleanupExportsWithMode(w http.ResponseWriter, r *http.Request, mode string, smokeRationaleAllowed bool) {
	principal, _ := PrincipalFromContext(r.Context())
	service, ok := stage0.ServiceFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "export_service_not_connected", "export storage is not connected yet", nil)
		return
	}
	var input struct {
		Rationale             string `json:"rationale"`
		Mode                  string `json:"mode"`
		Limit                 int    `json:"limit"`
		DryRun                bool   `json:"dry_run"`
		SecondReviewerID      string `json:"second_reviewer_id"`
		SecondReviewerRole    string `json:"second_reviewer_role"`
		SecondReviewRationale string `json:"second_review_rationale"`
	}
	if err := readOptionalJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	rationale := security.RedactString(strings.TrimSpace(input.Rationale))
	if rationale == "" && smokeRationaleAllowed && strings.TrimSpace(input.Mode) == "stage0_retention_cleanup_smoke" {
		rationale = "stage0 retention cleanup smoke"
	}
	if rationale == "" || rationale == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "rationale_required", "object retention cleanup requires a non-secret rationale", map[string]any{
			"field": "rationale",
		})
		return
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	secondReview, reviewErr := validateAdminSecondReview(r.Context(), principal, adminSecondReviewInput{
		ReviewerID: input.SecondReviewerID,
		Role:       input.SecondReviewerRole,
		Rationale:  input.SecondReviewRationale,
	}, auth.PermissionObjectCleanupAdmin, "object retention cleanup")
	if reviewErr != nil && !input.DryRun {
		writeError(w, r, http.StatusBadRequest, "second_review_required", reviewErr.Error(), secondReview.Details)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "cleanup_audit_not_connected", "object retention cleanup audit logging is not connected yet", nil)
		return
	}
	now := time.Now().UTC()
	action := "export.cleanup"
	if input.DryRun {
		action = "export.cleanup.preview"
	}
	requestAuditRef, err := s.recordCleanupAudit(r.Context(), recorder, principal, action+".requested", now, map[string]any{
		"rationale":               rationale,
		"limit":                   limit,
		"dry_run":                 input.DryRun,
		"mode":                    mode,
		"request_id":              requestIDFrom(r.Context()),
		"high_risk":               !input.DryRun,
		"second_review_required":  !input.DryRun,
		"second_reviewer_id":      secondReview.ReviewerID,
		"second_reviewer_role":    string(secondReview.Role),
		"second_review_rationale": secondReview.Rationale,
	})
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "audit_record_error", "object retention cleanup audit request record could not be written", nil)
		return
	}
	var result stage0.CleanupResult
	if input.DryRun {
		result, err = service.PreviewExpiredExportsAndOrphanedObjectsForTenantMode(r.Context(), principal.TenantID, now, limit, stage0.CleanupMode(mode))
	} else {
		result, err = service.CleanupExpiredExportsAndOrphanedObjectsForTenantMode(r.Context(), principal.TenantID, now, limit, stage0.CleanupMode(mode))
	}
	if err != nil {
		_, _ = s.recordCleanupAudit(r.Context(), recorder, principal, action+".failed", now, cleanupAuditMetadata(rationale, limit, input.DryRun, mode, result, security.RedactString(err.Error()), secondReview, requestIDFrom(r.Context())))
		writeStage0Error(w, r, err)
		return
	}
	completionAuditRef, err := s.recordCleanupAudit(r.Context(), recorder, principal, action, now, cleanupAuditMetadata(rationale, limit, input.DryRun, mode, result, "", secondReview, requestIDFrom(r.Context())))
	if err != nil {
		writeError(w, r, http.StatusInternalServerError, "audit_record_error", "object retention cleanup audit record could not be written", nil)
		return
	}
	writeJSON(w, http.StatusAccepted, cleanupResponseWithMode(result, mode, requestAuditRef, completionAuditRef))
}

func (s *Server) recordCleanupAudit(ctx context.Context, recorder audit.Recorder, principal auth.Principal, action string, now time.Time, metadata map[string]any) (string, error) {
	auditID := newAuditID(principal.TenantID, principal.UserID, action, now.Format(time.RFC3339Nano))
	return auditID, recorder.Record(ctx, audit.Event{
		ID:        auditID,
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    action,
		Resource:  "object_storage_cleanup",
		Metadata:  metadata,
		CreatedAt: now,
	})
}

func cleanupAuditMetadata(rationale string, limit int, dryRun bool, mode string, result stage0.CleanupResult, errorMessage string, secondReview adminSecondReview, requestID string) map[string]any {
	metadata := map[string]any{
		"rationale":               rationale,
		"limit":                   limit,
		"dry_run":                 dryRun,
		"mode":                    mode,
		"request_id":              requestID,
		"high_risk":               !dryRun,
		"second_review_required":  !dryRun,
		"second_reviewer_id":      secondReview.ReviewerID,
		"second_reviewer_role":    string(secondReview.Role),
		"second_review_rationale": secondReview.Rationale,
		"preview_objects":         result.PreviewObjects,
		"expired_exports":         result.ExpiredExports,
		"orphaned_objects":        result.OrphanedObjects,
		"deleted_objects":         result.DeletedObjects,
		"failed_objects":          result.FailedObjects,
		"cleanup_status":          result.Status,
	}
	if errorMessage != "" {
		metadata["error"] = errorMessage
	}
	return metadata
}

type adminSecondReviewInput struct {
	ReviewerID string
	Role       string
	Rationale  string
}

type adminSecondReview struct {
	ReviewerID string
	Role       auth.Role
	Rationale  string
	Details    map[string]any
}

func validateAdminSecondReview(ctx context.Context, principal auth.Principal, input adminSecondReviewInput, permission auth.Permission, operation string) (adminSecondReview, error) {
	review := adminSecondReview{
		ReviewerID: strings.TrimSpace(input.ReviewerID),
		Rationale:  security.RedactString(strings.TrimSpace(input.Rationale)),
	}
	if review.ReviewerID == "" || review.ReviewerID == principal.UserID {
		review.Details = map[string]any{"field": "second_reviewer_id"}
		return review, fmt.Errorf("admin %s requires a distinct second reviewer", operation)
	}
	role, ok := auth.ParseRole(input.Role)
	review.Role = role
	if !ok || !auth.Authorize(ctx, auth.Principal{
		UserID:   review.ReviewerID,
		TenantID: principal.TenantID,
		Roles:    []auth.Role{role},
	}, auth.Policy{Required: permission}) {
		review.Details = map[string]any{
			"field":               "second_reviewer_role",
			"required_permission": string(permission),
		}
		return review, fmt.Errorf("admin %s requires a second reviewer with %s permission", operation, permission)
	}
	if review.Rationale == "" || review.Rationale == security.Redacted {
		review.Details = map[string]any{"field": "second_review_rationale"}
		return review, fmt.Errorf("admin %s requires a non-secret second-review rationale", operation)
	}
	return review, nil
}

func cleanupResponseWithMode(result stage0.CleanupResult, mode string, requestAuditRef string, completionAuditRef string) map[string]any {
	auditRefs := []string{}
	if strings.TrimSpace(requestAuditRef) != "" {
		auditRefs = append(auditRefs, requestAuditRef)
	}
	if strings.TrimSpace(completionAuditRef) != "" {
		auditRefs = append(auditRefs, completionAuditRef)
	}
	response := map[string]any{
		"expired_exports":        result.ExpiredExports,
		"orphaned_objects":       result.OrphanedObjects,
		"deleted_objects":        result.DeletedObjects,
		"failed_objects":         result.FailedObjects,
		"dry_run":                result.DryRun,
		"status":                 result.Status,
		"mode":                   mode,
		"retention_policy":       "tenant scoped retention_until enforced before deletion",
		"expired_export_cleanup": "expired export cleanup retained tenant scope and audit refs",
		"orphan_cleanup":         "orphan cleanup retained tenant scope and audit refs",
		"retained":               result.FailedObjects,
		"deleted":                result.DeletedObjects,
		"audit":                  "object_storage_cleanup",
		"audit_refs":             auditRefs,
		"audit_ref":              completionAuditRef,
	}
	if result.PreviewObjects > 0 {
		response["preview_objects"] = result.PreviewObjects
	}
	return response
}

func (s *Server) regenerateExport(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
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
	exportID := r.PathValue("export_id")
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

func (s *Server) createExportOverride(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "export_service_not_connected", "export storage is not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusInternalServerError, "export_override_audit_required", "export override decisions require an audit recorder", nil)
		return
	}
	var input struct {
		SourceType   string         `json:"source_type"`
		SourceID     string         `json:"source_id"`
		TraceID      string         `json:"trace_id"`
		Decision     string         `json:"decision"`
		DenialReason string         `json:"denial_reason"`
		Rationale    string         `json:"rationale"`
		Metadata     map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	rationale := security.RedactString(strings.TrimSpace(input.Rationale))
	if rationale == "" || rationale == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "validation_error", "non-secret export override rationale is required", map[string]any{"field": "rationale"})
		return
	}
	exportID := strings.TrimSpace(r.PathValue("export_id"))
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	now := time.Now().UTC()
	auditRef := newAuditID(principal.TenantID, principal.UserID, "export.override", exportID, idempotencyKey)
	metadata := security.RedactMap(input.Metadata)
	role := adminRoleForAudit(principal)
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        auditRef,
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    "export.override",
		Resource:  "exports/" + exportID,
		Metadata:  exportOverrideAuditMetadata(exportID, input.SourceType, input.SourceID, input.TraceID, input.Decision, input.DenialReason, rationale, idempotencyKey, requestIDFrom(r.Context()), metadata),
		CreatedAt: now,
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "export_override_audit_record_error", "export override audit record could not be written", nil)
		return
	}
	result, err := repo.RecordExportOverrideDecision(r.Context(), stage0.ExportOverrideDecisionInput{
		TenantID:       principal.TenantID,
		ExportID:       exportID,
		SourceType:     input.SourceType,
		SourceID:       input.SourceID,
		TraceID:        input.TraceID,
		RequestedBy:    principal.UserID,
		RequestedRole:  role,
		ResolvedBy:     principal.UserID,
		ResolvedRole:   role,
		Outcome:        input.Decision,
		DenialReason:   input.DenialReason,
		Rationale:      rationale,
		AuditLogID:     auditRef,
		IdempotencyKey: idempotencyKey,
		Metadata:       metadata,
		CreatedAt:      now,
	})
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
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
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "crawler_service_not_connected", "crawler storage is not connected yet", nil)
		return
	}
	run, err := repo.StartCrawlerRun(r.Context(), principal.TenantID, r.PathValue("source_id"), stage0.CrawlerPolicy{
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

func (s *Server) listSafetyReviews(w http.ResponseWriter, r *http.Request) {
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "safety_service_not_connected", "safety review storage is not connected yet", nil)
		return
	}
	page, err := repo.ListSafetyReviewQueue(r.Context(), principal.TenantID, r.URL.Query().Get("status"), pageSize(r))
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) recordSafetyReviewDecision(w http.ResponseWriter, r *http.Request) {
	if !requireIdempotencyKey(w, r) {
		return
	}
	principal, _ := PrincipalFromContext(r.Context())
	repo, ok := stage0RepoFrom(r)
	if !ok {
		writeError(w, r, http.StatusNotImplemented, "safety_service_not_connected", "safety review storage is not connected yet", nil)
		return
	}
	recorder, ok := audit.RecorderFromContext(r.Context())
	if !ok {
		writeError(w, r, http.StatusInternalServerError, "safety_review_audit_required", "safety review decisions require an audit recorder", nil)
		return
	}
	var input struct {
		Decision  string         `json:"decision"`
		Rationale string         `json:"rationale"`
		Metadata  map[string]any `json:"metadata"`
	}
	if err := readJSON(r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_json", "request body must be valid JSON", nil)
		return
	}
	decisionID := strings.TrimSpace(r.PathValue("decision_id"))
	rationale := security.RedactString(strings.TrimSpace(input.Rationale))
	if rationale == "" || rationale == security.Redacted {
		writeError(w, r, http.StatusBadRequest, "validation_error", "non-secret review rationale is required", map[string]any{"field": "rationale"})
		return
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	auditRef := newAuditID(principal.TenantID, principal.UserID, "safety.review", decisionID, idempotencyKey)
	now := time.Now().UTC()
	metadata := security.RedactMap(input.Metadata)
	if err := recorder.Record(r.Context(), audit.Event{
		ID:        auditRef,
		TenantID:  principal.TenantID,
		ActorID:   principal.UserID,
		Action:    "safety.review",
		Resource:  "safety_decisions/" + decisionID,
		Metadata:  safetyReviewAuditMetadata(decisionID, input.Decision, rationale, idempotencyKey, requestIDFrom(r.Context()), metadata),
		CreatedAt: now,
	}); err != nil {
		writeError(w, r, http.StatusInternalServerError, "safety_review_audit_record_error", "safety review audit record could not be written", nil)
		return
	}
	result, err := repo.RecordSafetyReviewDecision(r.Context(), stage0.SafetyReviewDecisionInput{
		TenantID:         principal.TenantID,
		SafetyDecisionID: decisionID,
		ReviewerID:       principal.UserID,
		Decision:         input.Decision,
		Rationale:        rationale,
		AuditRef:         auditRef,
		IdempotencyKey:   idempotencyKey,
		Metadata:         metadata,
		CreatedAt:        now,
	})
	if err != nil {
		writeStage0Error(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, result)
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

func requireIdempotencyKey(w http.ResponseWriter, r *http.Request) bool {
	if strings.TrimSpace(r.Header.Get("Idempotency-Key")) != "" {
		return true
	}
	writeError(w, r, http.StatusBadRequest, "idempotency_key_required", "state-changing idempotent operation requires an Idempotency-Key header", map[string]any{
		"required_header": "Idempotency-Key",
	})
	return false
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

func parseBoolQuery(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "t", "yes", "y":
		return true
	default:
		return false
	}
}

func writeStage0Error(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, stage0.ErrTenantDenied):
		writeError(w, r, http.StatusForbidden, "tenant_denied", "requested record is not available for this tenant", nil)
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

func writeUploadObjectError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, stage0.ErrMalwareBlocked) {
		writeStage0Error(w, r, err)
		return
	}
	writeObjectStoreError(w, r, err)
}

func safetyReviewAuditMetadata(decisionID, decision, rationale, idempotencyKey, requestID string, metadata map[string]any) map[string]any {
	return security.RedactMap(map[string]any{
		"safety_decision_id":             decisionID,
		"decision":                       strings.TrimSpace(decision),
		"rationale":                      rationale,
		"idempotency_key":                idempotencyKey,
		"request_id":                     requestID,
		"metadata":                       metadata,
		"raw_prompt_persisted":           false,
		"raw_provider_payload_persisted": false,
		"raw_safety_payload_persisted":   false,
		"secret_material_persisted":      false,
	})
}

func exportOverrideAuditMetadata(exportID, sourceType, sourceID, traceID, decision, denialReason, rationale, idempotencyKey, requestID string, metadata map[string]any) map[string]any {
	return security.RedactMap(map[string]any{
		"export_id":        strings.TrimSpace(exportID),
		"source_type":      strings.TrimSpace(sourceType),
		"source_id":        strings.TrimSpace(sourceID),
		"trace_id":         strings.TrimSpace(traceID),
		"decision":         strings.TrimSpace(decision),
		"denial_reason":    strings.TrimSpace(denialReason),
		"rationale":        rationale,
		"idempotency_key":  idempotencyKey,
		"request_id":       requestID,
		"metadata":         metadata,
		"admin_only":       true,
		"audit_before_db":  true,
		"download_enabled": false,
	})
}

func adminRoleForAudit(principal auth.Principal) string {
	for _, want := range []auth.Role{
		auth.RoleAdminSuperadmin,
		auth.RoleAdmin,
		auth.RoleAdminReviewer,
		auth.RoleAdminOperator,
		auth.RoleAdminViewer,
		auth.RoleSupportOperator,
	} {
		for _, role := range principal.Roles {
			if role == want {
				return string(role)
			}
		}
	}
	if len(principal.Roles) > 0 {
		return string(principal.Roles[0])
	}
	return "admin_reviewer"
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

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func firstPositive(values ...int64) int64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
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
