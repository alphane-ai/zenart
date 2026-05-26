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
	PermissionTaskRead             Permission = "task:read"
	PermissionAdminQuotaEdit       Permission = "quota:admin_edit"
	PermissionAuditRead            Permission = "audit:read"
	PermissionSkillReleaseAdmin    Permission = "skill_release:admin"
	PermissionCrawlerImportAdmin   Permission = "crawler_import:admin"
	PermissionPromptApprovalAdmin  Permission = "prompt_approval:admin"
	PermissionProviderRoutingAdmin Permission = "provider_routing:admin"
	PermissionSafetyRuleAdmin      Permission = "safety_rule:admin"
	PermissionExportOverrideAdmin  Permission = "export_override:admin"
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

func Matrix() map[Permission]Policy {
	adminPermissions := []Permission{
		PermissionAdminQuotaEdit,
		PermissionAuditRead,
		PermissionSkillReleaseAdmin,
		PermissionCrawlerImportAdmin,
		PermissionPromptApprovalAdmin,
		PermissionProviderRoutingAdmin,
		PermissionSafetyRuleAdmin,
		PermissionExportOverrideAdmin,
	}
	matrix := map[Permission]Policy{
		PermissionTaskRead: {Required: PermissionTaskRead},
	}
	for _, permission := range adminPermissions {
		matrix[permission] = Policy{Required: permission, Admin: true}
	}
	return matrix
}

func hasRole(roles []Role, want Role) bool {
	for _, role := range roles {
		if role == want {
			return true
		}
	}
	return false
}
