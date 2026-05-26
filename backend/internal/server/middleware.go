package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/alphane-ai/zenart/backend/internal/auth"
	"github.com/alphane-ai/zenart/backend/internal/billing"
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
	return requirePrincipal(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, _ := PrincipalFromContext(r.Context())
		if !auth.Authorize(r.Context(), principal, auth.Policy{Admin: true}) {
			writeError(w, r, http.StatusForbidden, "forbidden", "admin role is required", nil)
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
		if strings.TrimSpace(role) == string(auth.RoleAdmin) {
			roles = append(roles, auth.RoleAdmin)
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

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string, details map[string]any) {
	if details == nil {
		details = map[string]any{}
	}
	writeJSON(w, status, map[string]any{
		"code":         code,
		"message":      message,
		"request_id":   requestIDFrom(r.Context()),
		"details":      details,
		"field_errors": []json.RawMessage{},
	})
}
