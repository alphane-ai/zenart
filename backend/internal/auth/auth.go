package auth

import "context"

type Principal struct {
	UserID   string
	TenantID string
	Roles    []Role
}

type Role string

const (
	RoleUser  Role = "user"
	RoleAdmin Role = "admin"
)

type Permission string

const (
	PermissionReadTask       Permission = "task:read"
	PermissionAdminQuotaEdit Permission = "quota:admin_edit"
	PermissionAuditRead      Permission = "audit:read"
)

type Policy struct {
	Required Permission
	Admin    bool
}

func Authorize(_ context.Context, principal Principal, policy Policy) bool {
	if policy.Admin {
		return hasRole(principal.Roles, RoleAdmin)
	}
	return principal.UserID != "" && principal.TenantID != ""
}

func SameTenant(principal Principal, tenantID string) bool {
	return principal.TenantID != "" && principal.TenantID == tenantID
}

func hasRole(roles []Role, want Role) bool {
	for _, role := range roles {
		if role == want {
			return true
		}
	}
	return false
}
