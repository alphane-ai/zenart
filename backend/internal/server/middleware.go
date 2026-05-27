package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/auth"
	"github.com/alphane-ai/zenart/backend/internal/billing"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/security"
)

type principalKey struct{}

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.status == 0 {
		r.status = status
		r.ResponseWriter.WriteHeader(status)
	}
}

func (r *statusRecorder) Write(body []byte) (int, error) {
	if r.status == 0 {
		r.WriteHeader(http.StatusOK)
	}
	n, err := r.ResponseWriter.Write(body)
	r.bytes += n
	return n, err
}

func (r *statusRecorder) Flush() {
	if flusher, ok := r.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (r *statusRecorder) Header() http.Header {
	return r.ResponseWriter.Header()
}

func withAccessLog(logger *slog.Logger, metrics *Metrics, next http.Handler) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startedAt := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		status := rec.status
		if status == 0 {
			status = http.StatusOK
		}
		duration := time.Since(startedAt)
		route := normalizeRoute(r)
		authCfg, authCfgOK := authConfigFromRequest(r)
		principal, _ := principalFromRequestWithAuthConfig(r, authCfg, authCfgOK)
		logger.Info("http request",
			"request_id", requestIDFrom(r.Context()),
			"method", r.Method,
			"path", security.RedactString(r.URL.Path),
			"route", route,
			"status", status,
			"latency_ms", duration.Milliseconds(),
			"bytes", rec.bytes,
			"user_id", principal.UserID,
			"tenant_id", principal.TenantID,
			"remote_addr", r.RemoteAddr,
			"user_agent", security.RedactString(r.UserAgent()),
		)
		metrics.ObserveHTTP(route, r.Method, status, duration)
	})
}

func requirePrincipal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, ok := principalFromRequest(r)
		if !ok {
			writeError(w, r, http.StatusUnauthorized, "unauthorized", "authentication is required", nil)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), principalKey{}, principal)))
	})
}

func requireAdmin(next http.Handler) http.Handler {
	return requirePermission("", next)
}

func requirePermission(permission auth.Permission, next http.Handler) http.Handler {
	return requirePrincipal(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, _ := PrincipalFromContext(r.Context())
		policy := auth.Policy{Admin: true}
		if permission != "" {
			policy = auth.Policy{Required: permission}
		}
		if !auth.Authorize(r.Context(), principal, policy) {
			details := map[string]any{}
			if permission != "" {
				details["required_permission"] = string(permission)
			}
			writeError(w, r, http.StatusForbidden, "forbidden", "required admin permission is missing", details)
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func requireEntitlement(service billing.EntitlementService, action string, cost int64, next http.Handler) http.Handler {
	return billing.EntitlementMiddleware(service, action, cost, principalForEntitlement, denyEntitlement)(next)
}

func PrincipalFromContext(ctx context.Context) (auth.Principal, bool) {
	principal, ok := ctx.Value(principalKey{}).(auth.Principal)
	return principal, ok
}

func principalFromRequest(r *http.Request) (auth.Principal, bool) {
	authCfg, authCfgOK := authConfigFromRequest(r)
	return principalFromRequestWithAuthConfig(r, authCfg, authCfgOK)
}

func principalFromRequestWithAuthConfig(r *http.Request, cfg config.AuthConfig, cfgOK bool) (auth.Principal, bool) {
	if cfgOK {
		adminRoute := isAdminAPIPath(r.URL.Path)
		if principal, ok := principalFromSessionCookieConfig(r, cfg, time.Now().UTC(), adminRoute); ok {
			return principal, true
		}
		if devHeadersAllowedForRoute(cfg, adminRoute) {
			return principalFromHeaders(r)
		}
		return auth.Principal{}, false
	}
	return principalFromHeaders(r)
}

func devHeadersAllowedForRoute(cfg config.AuthConfig, adminRoute bool) bool {
	if cfg.AccessMode != string(auth.AccessModeLocal) {
		return false
	}
	if adminRoute {
		return cfg.AdminDevIdentityHeaders
	}
	return cfg.DevIdentityHeaders
}

func authConfigFromRequest(r *http.Request) (config.AuthConfig, bool) {
	if cfg, ok := authConfigFromContext(r.Context()); ok {
		return cfg, true
	}
	cfg, err := config.Load()
	if err != nil {
		return config.AuthConfig{}, false
	}
	return cfg.Auth, true
}

func principalFromSessionCookieConfig(r *http.Request, cfg config.AuthConfig, now time.Time, adminRoute bool) (auth.Principal, bool) {
	secret := cfg.SessionSecret
	cookieName := cfg.SessionCookieName
	if adminRoute {
		cookieName = cfg.AdminSessionCookieName
		secret = cfg.AdminSessionSecret
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil || cookie == nil {
		return auth.Principal{}, false
	}
	payload, ok := verifySessionCookie(cookie.Value, secret, now, adminRoute)
	if !ok {
		return auth.Principal{}, false
	}
	return auth.Principal{
		UserID:   payload.UserID,
		TenantID: payload.TenantID,
		Roles:    payload.Roles,
	}, true
}

func principalFromSessionCookie(r *http.Request, ctx context.Context) (auth.Principal, bool) {
	cfg, ok := authConfigFromContext(ctx)
	if !ok {
		return auth.Principal{}, false
	}
	return principalFromSessionCookieConfig(r, cfg, time.Now().UTC(), isAdminAPIPath(r.URL.Path))
}

func isAdminAPIPath(path string) bool {
	return strings.HasPrefix(path, "/api/admin/")
}

func principalFromHeaders(r *http.Request) (auth.Principal, bool) {
	userID := strings.TrimSpace(r.Header.Get("X-Zenart-User-ID"))
	tenantID := strings.TrimSpace(r.Header.Get("X-Zenart-Tenant-ID"))
	if userID == "" || tenantID == "" {
		return auth.Principal{}, false
	}
	if !auth.ValidTenantID(tenantID) {
		return auth.Principal{}, false
	}

	roles := []auth.Role{auth.RoleUser}
	for _, role := range strings.Split(r.Header.Get("X-Zenart-Roles"), ",") {
		parsed, ok := auth.ParseRole(role)
		if ok && parsed != auth.RoleUser {
			roles = append(roles, parsed)
		}
	}

	return auth.Principal{
		UserID:   userID,
		TenantID: tenantID,
		Roles:    roles,
	}, true
}

type sessionCookiePayload struct {
	UserID    string      `json:"user_id"`
	TenantID  string      `json:"tenant_id"`
	Roles     []auth.Role `json:"roles"`
	ExpiresAt int64       `json:"expires_at"`
}

func principalForEntitlement(r *http.Request) (tenantID, userID string, ok bool) {
	principal, ok := PrincipalFromContext(r.Context())
	if !ok {
		return "", "", false
	}
	return principal.TenantID, principal.UserID, true
}

func denyEntitlement(w http.ResponseWriter, r *http.Request, decision billing.EntitlementDecision) {
	writeError(w, r, http.StatusPaymentRequired, "entitlement_denied", "entitlement check failed", map[string]any{
		"reason": decision.Reason,
	})
}

func withSecurityHeaders(cfg config.SecurityConfig, next http.Handler) http.Handler {
	allowedOrigins := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, origin := range cfg.AllowedOrigins {
		allowedOrigins[strings.TrimSpace(origin)] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := w.Header()
		header.Set("X-Content-Type-Options", "nosniff")
		header.Set("X-Frame-Options", "DENY")
		header.Set("Referrer-Policy", "no-referrer")
		header.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
		header.Set("Cross-Origin-Resource-Policy", "same-site")
		if cfg.ContentSecurityPolicy != "" {
			header.Set("Content-Security-Policy", cfg.ContentSecurityPolicy)
		}
		if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" {
			if _, ok := allowedOrigins[origin]; ok {
				header.Set("Access-Control-Allow-Origin", origin)
				header.Set("Vary", "Origin")
				header.Set("Access-Control-Allow-Credentials", "true")
				header.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-Zenart-User-ID, X-Zenart-Tenant-ID, X-Zenart-Roles, Idempotency-Key, "+cfg.CSRFHeaderName)
				header.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func withRuntimeSecurity(cfg config.Config, next http.Handler) http.Handler {
	return withAuthConfig(cfg.Auth, withSameSiteCSRF(cfg.Security, next))
}

type authConfigKey struct{}

func withAuthConfig(cfg config.AuthConfig, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), authConfigKey{}, cfg)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func authConfigFromContext(ctx context.Context) (config.AuthConfig, bool) {
	cfg, ok := ctx.Value(authConfigKey{}).(config.AuthConfig)
	return cfg, ok
}

func withSameSiteCSRF(cfg config.SecurityConfig, next http.Handler) http.Handler {
	allowedOrigins := make(map[string]struct{}, len(cfg.AllowedOrigins))
	for _, origin := range cfg.AllowedOrigins {
		allowedOrigins[strings.TrimRight(strings.TrimSpace(origin), "/")] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !csrfProtectedMethod(r.Method) || !strings.HasPrefix(r.URL.Path, "/api/") {
			next.ServeHTTP(w, r)
			return
		}
		if strings.TrimSpace(r.Header.Get(cfg.CSRFHeaderName)) != cfg.CSRFHeaderValue {
			writeError(w, r, http.StatusForbidden, "csrf_required", "state-changing API requests must include the same-site CSRF header", map[string]any{
				"required_header": cfg.CSRFHeaderName,
				"strategy":        "same-site-origin-check",
			})
			return
		}
		origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
		if origin == "" {
			origin = originFromReferer(r.Header.Get("Referer"))
		}
		if origin == "" {
			writeError(w, r, http.StatusForbidden, "csrf_origin_required", "state-changing API requests must include an allowed Origin or Referer", map[string]any{
				"strategy": "same-site-origin-check",
			})
			return
		}
		if _, ok := allowedOrigins[origin]; !ok {
			writeError(w, r, http.StatusForbidden, "csrf_origin_denied", "request origin is not allowed for state-changing API requests", map[string]any{
				"origin":   origin,
				"strategy": "same-site-origin-check",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func csrfProtectedMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func originFromReferer(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func signSessionCookie(payload sessionCookiePayload, secret string) (string, error) {
	encoded, err := encodeSessionPayload(payload)
	if err != nil {
		return "", err
	}
	sig := signSessionValue(encoded, secret)
	return encoded + "." + sig, nil
}

func verifySessionCookie(value, secret string, now time.Time, adminRoute bool) (sessionCookiePayload, bool) {
	encoded, sig, ok := strings.Cut(value, ".")
	if !ok || !hmac.Equal([]byte(sig), []byte(signSessionValue(encoded, secret))) {
		return sessionCookiePayload{}, false
	}
	var payload sessionCookiePayload
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return sessionCookiePayload{}, false
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return sessionCookiePayload{}, false
	}
	if payload.UserID == "" || !auth.ValidTenantID(payload.TenantID) || payload.ExpiresAt <= now.Unix() {
		return sessionCookiePayload{}, false
	}
	if len(payload.Roles) == 0 {
		payload.Roles = []auth.Role{auth.RoleUser}
	}
	if !rolesAllowedForSession(adminRoute, payload.Roles) {
		return sessionCookiePayload{}, false
	}
	return payload, true
}

func encodeSessionPayload(payload sessionCookiePayload) (string, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func signSessionValue(value, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func sessionSameSite(value string) http.SameSite {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string, details map[string]any) {
	if details == nil {
		details = map[string]any{}
	}
	details = security.RedactMap(details)
	writeJSON(w, status, map[string]any{
		"code":         code,
		"message":      message,
		"request_id":   requestIDFrom(r.Context()),
		"details":      details,
		"field_errors": []json.RawMessage{},
	})
}

func normalizeRoute(r *http.Request) string {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	for i, part := range parts {
		if part == "" {
			continue
		}
		if looksLikeID(part) {
			parts[i] = "{id}"
		}
	}
	if len(parts) == 0 || (len(parts) == 1 && parts[0] == "") {
		return "/"
	}
	return "/" + strings.Join(parts, "/")
}

func looksLikeID(value string) bool {
	if _, err := strconv.ParseInt(value, 10, 64); err == nil {
		return true
	}
	if strings.Contains(value, "_") {
		return true
	}
	if len(value) >= 16 && strings.Contains(value, "-") {
		for _, char := range value {
			if (char < '0' || char > '9') && (char < 'a' || char > 'f') && (char < 'A' || char > 'F') && char != '-' {
				return false
			}
		}
		return true
	}
	return false
}
