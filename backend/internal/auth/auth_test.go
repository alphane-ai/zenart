package auth

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestAuthorizeAdminPolicy(t *testing.T) {
	user := Principal{UserID: "user_1", TenantID: "tenant_1", Roles: []Role{RoleUser}}
	admin := Principal{UserID: "admin_1", TenantID: "tenant_1", Roles: []Role{RoleUser, RoleAdminViewer}}

	if Authorize(context.Background(), user, Policy{Admin: true}) {
		t.Fatal("user principal authorized for admin policy")
	}
	if !Authorize(context.Background(), admin, Policy{Admin: true}) {
		t.Fatal("admin principal was not authorized for admin policy")
	}
}

func TestPermissionMatrixRequiresSpecificAdminRoles(t *testing.T) {
	matrix := Matrix()
	viewer := Principal{UserID: "admin_viewer", TenantID: "tenant_1", Roles: []Role{RoleAdminViewer}}
	operator := Principal{UserID: "admin_operator", TenantID: "tenant_1", Roles: []Role{RoleAdminOperator}}
	reviewer := Principal{UserID: "admin_reviewer", TenantID: "tenant_1", Roles: []Role{RoleAdminReviewer}}
	superadmin := Principal{UserID: "admin_super", TenantID: "tenant_1", Roles: []Role{RoleAdminSuperadmin}}

	for _, permission := range []Permission{PermissionSupportRead, PermissionExportRead, PermissionCrawlerRead, PermissionSafetyRead, PermissionAdminQuotaEdit, PermissionAuditRead, PermissionSkillReleaseAdmin, PermissionCrawlerImportAdmin, PermissionPromptApprovalAdmin, PermissionProviderRoutingAdmin, PermissionSafetyRuleAdmin, PermissionExportOverrideAdmin, PermissionObjectCleanupAdmin} {
		policy := matrix[permission]
		if !policy.Admin || len(policy.AllowedRoles) == 0 {
			t.Fatalf("%s should require explicit admin roles: %#v", permission, policy)
		}
	}
	if !Authorize(context.Background(), viewer, Policy{Required: PermissionExportRead}) {
		t.Fatal("admin_viewer should read exports")
	}
	if Authorize(context.Background(), viewer, Policy{Required: PermissionExportOverrideAdmin}) {
		t.Fatal("admin_viewer should not regenerate exports")
	}
	if !Authorize(context.Background(), operator, Policy{Required: PermissionCrawlerImportAdmin}) {
		t.Fatal("admin_operator should run crawler imports")
	}
	if Authorize(context.Background(), operator, Policy{Required: PermissionSafetyRuleAdmin}) {
		t.Fatal("admin_operator should not administer safety rules")
	}
	if !Authorize(context.Background(), reviewer, Policy{Required: PermissionSafetyRuleAdmin}) {
		t.Fatal("admin_reviewer should administer safety rules")
	}
	if Authorize(context.Background(), reviewer, Policy{Required: PermissionObjectCleanupAdmin}) {
		t.Fatal("admin_reviewer should not run object retention cleanup")
	}
	if !Authorize(context.Background(), operator, Policy{Required: PermissionObjectCleanupAdmin}) {
		t.Fatal("admin_operator should run object retention cleanup")
	}
	if !Authorize(context.Background(), operator, Policy{Required: PermissionAuditRead}) {
		t.Fatal("admin_operator should read audit for cleanup smoke probes")
	}
	if !Authorize(context.Background(), superadmin, Policy{Required: PermissionAuditRead}) {
		t.Fatal("admin_superadmin should read audit")
	}
	if !Authorize(context.Background(), superadmin, Policy{Required: PermissionObjectCleanupAdmin}) {
		t.Fatal("admin_superadmin should run object retention cleanup")
	}
	if matrix[PermissionTaskRead].Admin {
		t.Fatal("task read should not require admin")
	}
}

func TestParseRoleAcceptsStage0Rev2Roles(t *testing.T) {
	for _, role := range []Role{RoleUserOwner, RoleUserMember, RoleSupportOperator, RoleAdminViewer, RoleAdminOperator, RoleAdminReviewer, RoleAdminSuperadmin, RoleAdmin} {
		parsed, ok := ParseRole(string(role))
		if !ok || parsed != role {
			t.Fatalf("ParseRole(%q) = %q/%v, want same role", role, parsed, ok)
		}
	}
	if _, ok := ParseRole("unknown_admin"); ok {
		t.Fatal("ParseRole accepted unknown role")
	}
}

func TestLocalSessionServiceCreatesWebUserSession(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	session, err := (SessionService{Mode: AccessModeLocal, Now: func() time.Time { return now }}).CreateLocalSession("USER@example.com", "tenant_1", nil, time.Hour)
	if err != nil {
		t.Fatalf("CreateLocalSession() error = %v", err)
	}
	if session.TenantID != "tenant_1" {
		t.Fatalf("TenantID = %q, want tenant_1", session.TenantID)
	}
	if !session.ExpiresAt.Equal(now.Add(time.Hour)) {
		t.Fatalf("ExpiresAt = %v, want %v", session.ExpiresAt, now.Add(time.Hour))
	}
	if !Authorize(context.Background(), session.Principal(), Policy{}) {
		t.Fatal("session principal was not authorized for user policy")
	}
}

func TestLocalSessionServiceRejectsUnsafeTenantIDs(t *testing.T) {
	for _, tenantID := range []string{
		"tenant_1/../tenant_2",
		"tenant 1",
		"tenant\\one",
		".",
		"..",
	} {
		_, err := (SessionService{Mode: AccessModeLocal}).CreateLocalSession("user@example.com", tenantID, nil, time.Hour)
		if err == nil || !strings.Contains(err.Error(), "tenant_id is invalid") {
			t.Fatalf("CreateLocalSession(%q) error = %v, want invalid tenant_id", tenantID, err)
		}
	}
}

func TestLocalSessionServiceCreatesAdminSession(t *testing.T) {
	session, err := (SessionService{Mode: AccessModeLocal}).CreateLocalSession("admin@example.com", "tenant_1", []Role{RoleUser, RoleAdminSuperadmin}, time.Hour)
	if err != nil {
		t.Fatalf("CreateLocalSession() error = %v", err)
	}
	if !Authorize(context.Background(), session.Principal(), Policy{Admin: true}) {
		t.Fatal("admin session principal was not authorized for admin policy")
	}
}
