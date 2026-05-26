package auth

import (
	"context"
	"testing"
	"time"
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

func TestLocalSessionServiceCreatesAdminSession(t *testing.T) {
	session, err := (SessionService{Mode: AccessModeLocal}).CreateLocalSession("admin@example.com", "tenant_1", []Role{RoleUser, RoleAdmin}, time.Hour)
	if err != nil {
		t.Fatalf("CreateLocalSession() error = %v", err)
	}
	if !Authorize(context.Background(), session.Principal(), Policy{Admin: true}) {
		t.Fatal("admin session principal was not authorized for admin policy")
	}
}
