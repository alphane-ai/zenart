package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

type AccessMode string

const (
	AccessModeLocal AccessMode = "local"
)

type Principal struct {
	UserID   string
	TenantID string
	Roles    []Role
}

type Session struct {
	ID        string
	UserID    string
	TenantID  string
	Roles     []Role
	ExpiresAt time.Time
}

type SessionService struct {
	Mode AccessMode
	Now  func() time.Time
}

func (s SessionService) CreateLocalSession(email, tenantID string, roles []Role, ttl time.Duration) (Session, error) {
	if s.Mode == "" {
		s.Mode = AccessModeLocal
	}
	if s.Mode != AccessModeLocal {
		return Session{}, errors.New("only local access mode is implemented for stage 0")
	}
	email = strings.TrimSpace(strings.ToLower(email))
	tenantID = strings.TrimSpace(tenantID)
	if email == "" || tenantID == "" {
		return Session{}, errors.New("email and tenant_id are required")
	}
	if ttl <= 0 {
		return Session{}, errors.New("ttl must be positive")
	}
	if len(roles) == 0 {
		roles = []Role{RoleUser}
	}
	now := time.Now().UTC()
	if s.Now != nil {
		now = s.Now().UTC()
	}
	seed := email + ":" + tenantID + ":" + now.Format(time.RFC3339Nano)
	hash := sha256.Sum256([]byte(seed))
	return Session{
		ID:        "sess_" + hex.EncodeToString(hash[:12]),
		UserID:    "local_" + strings.ReplaceAll(email, "@", "_"),
		TenantID:  tenantID,
		Roles:     roles,
		ExpiresAt: now.Add(ttl),
	}, nil
}

func (s Session) Principal() Principal {
	return Principal{UserID: s.UserID, TenantID: s.TenantID, Roles: s.Roles}
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
