package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/alphane-ai/zenart/backend/internal/auth"
	"github.com/alphane-ai/zenart/backend/internal/billing"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/security"
)

type principalKey struct{}

func requirePrincipal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, ok := principalFromHeaders(r)
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

func principalFromHeaders(r *http.Request) (auth.Principal, bool) {
	userID := strings.TrimSpace(r.Header.Get("X-Zenart-User-ID"))
	tenantID := strings.TrimSpace(r.Header.Get("X-Zenart-Tenant-ID"))
	if userID == "" || tenantID == "" {
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
				header.Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, X-Zenart-User-ID, X-Zenart-Tenant-ID, X-Zenart-Roles, Idempotency-Key")
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
