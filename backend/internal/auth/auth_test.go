package auth

import (
	"context"
	"testing"
)

func TestAuthorizeAdminPolicy(t *testing.T) {
	user := Principal{UserID: "user_1", TenantID: "tenant_1", Roles: []Role{RoleUser}}
	admin := Principal{UserID: "admin_1", TenantID: "tenant_1", Roles: []Role{RoleUser, RoleAdmin}}

	if Authorize(context.Background(), user, Policy{Admin: true}) {
		t.Fatal("user principal authorized for admin policy")
	}
	if !Authorize(context.Background(), admin, Policy{Admin: true}) {
		t.Fatal("admin principal was not authorized for admin policy")
	}
}

func TestPermissionMatrixMarksHighRiskAdminOnly(t *testing.T) {
	matrix := Matrix()
	adminOnly := []Permission{
		PermissionAdminQuotaEdit,
		PermissionAuditRead,
		PermissionSkillReleaseAdmin,
		PermissionCrawlerImportAdmin,
		PermissionPromptApprovalAdmin,
		PermissionProviderRoutingAdmin,
		PermissionSafetyRuleAdmin,
		PermissionExportOverrideAdmin,
	}
	for _, permission := range adminOnly {
		if !matrix[permission].Admin {
			t.Fatalf("%s should require admin", permission)
		}
	}
	if matrix[PermissionTaskRead].Admin {
		t.Fatal("task read should not require admin")
	}
}
