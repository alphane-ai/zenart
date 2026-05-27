package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"time"
)

type AccessMode string

const (
	AccessModeLocal AccessMode = "local"
)

var tenantIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

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
	if !ValidTenantID(tenantID) {
		return Session{}, errors.New("tenant_id is invalid")
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
	RoleUser            Role = "user"
	RoleUserOwner       Role = "user_owner"
	RoleUserMember      Role = "user_member"
	RoleSupportOperator Role = "support_operator"
	RoleAdminViewer     Role = "admin_viewer"
	RoleAdminOperator   Role = "admin_operator"
	RoleAdminReviewer   Role = "admin_reviewer"
	RoleAdminSuperadmin Role = "admin_superadmin"
	RoleAdmin           Role = "admin" // legacy local/dev superadmin alias
)

type Permission string

const (
	PermissionTaskRead             Permission = "task:read"
	PermissionSupportRead          Permission = "support:read"
	PermissionExportRead           Permission = "export:read"
	PermissionCrawlerRead          Permission = "crawler:read"
	PermissionSafetyRead           Permission = "safety:read"
	PermissionAnalyticsRead        Permission = "analytics:read"
	PermissionAdminQuotaEdit       Permission = "quota:admin_edit"
	PermissionAuditRead            Permission = "audit:read"
	PermissionSkillReleaseAdmin    Permission = "skill_release:admin"
	PermissionCrawlerImportAdmin   Permission = "crawler_import:admin"
	PermissionPromptApprovalAdmin  Permission = "prompt_approval:admin"
	PermissionProviderRoutingAdmin Permission = "provider_routing:admin"
	PermissionSafetyRuleAdmin      Permission = "safety_rule:admin"
	PermissionExportOverrideAdmin  Permission = "export_override:admin"
	PermissionObjectCleanupAdmin   Permission = "object_retention_cleanup:admin"
)

type Policy struct {
	Required     Permission
	Admin        bool
	AllowedRoles []Role
}

func Authorize(_ context.Context, principal Principal, policy Policy) bool {
	if principal.UserID == "" || principal.TenantID == "" {
		return false
	}
	if policy.Required != "" {
		permissionPolicy, ok := Matrix()[policy.Required]
		if !ok {
			return false
		}
		return hasAllowedRole(principal.Roles, permissionPolicy.AllowedRoles)
	}
	if len(policy.AllowedRoles) > 0 {
		return hasAllowedRole(principal.Roles, policy.AllowedRoles)
	}
	if policy.Admin {
		return hasAnyAdminRole(principal.Roles)
	}
	return true
}

func SameTenant(principal Principal, tenantID string) bool {
	return principal.TenantID != "" && principal.TenantID == tenantID
}

func ValidTenantID(tenantID string) bool {
	tenantID = strings.TrimSpace(tenantID)
	return tenantID != "" &&
		tenantID == strings.Trim(tenantID, "/") &&
		!strings.ContainsAny(tenantID, `/\`) &&
		tenantID != "." &&
		tenantID != ".." &&
		tenantIDPattern.MatchString(tenantID)
}

func Matrix() map[Permission]Policy {
	readOnlyAdminRoles := []Role{
		RoleAdminViewer,
		RoleAdminOperator,
		RoleAdminReviewer,
		RoleAdminSuperadmin,
		RoleAdmin,
	}
	supportReadRoles := []Role{
		RoleSupportOperator,
		RoleAdminViewer,
		RoleAdminOperator,
		RoleAdminReviewer,
		RoleAdminSuperadmin,
		RoleAdmin,
	}
	operatorRoles := []Role{
		RoleAdminOperator,
		RoleAdminSuperadmin,
		RoleAdmin,
	}
	reviewerRoles := []Role{
		RoleAdminReviewer,
		RoleAdminSuperadmin,
		RoleAdmin,
	}
	superadminRoles := []Role{
		RoleAdminSuperadmin,
		RoleAdmin,
	}
	matrix := map[Permission]Policy{
		PermissionTaskRead:             {Required: PermissionTaskRead},
		PermissionSupportRead:          {Required: PermissionSupportRead, Admin: true, AllowedRoles: supportReadRoles},
		PermissionExportRead:           {Required: PermissionExportRead, Admin: true, AllowedRoles: readOnlyAdminRoles},
		PermissionCrawlerRead:          {Required: PermissionCrawlerRead, Admin: true, AllowedRoles: readOnlyAdminRoles},
		PermissionSafetyRead:           {Required: PermissionSafetyRead, Admin: true, AllowedRoles: readOnlyAdminRoles},
		PermissionAnalyticsRead:        {Required: PermissionAnalyticsRead, Admin: true, AllowedRoles: readOnlyAdminRoles},
		PermissionAdminQuotaEdit:       {Required: PermissionAdminQuotaEdit, Admin: true, AllowedRoles: operatorRoles},
		PermissionAuditRead:            {Required: PermissionAuditRead, Admin: true, AllowedRoles: superadminRoles},
		PermissionSkillReleaseAdmin:    {Required: PermissionSkillReleaseAdmin, Admin: true, AllowedRoles: reviewerRoles},
		PermissionCrawlerImportAdmin:   {Required: PermissionCrawlerImportAdmin, Admin: true, AllowedRoles: operatorRoles},
		PermissionPromptApprovalAdmin:  {Required: PermissionPromptApprovalAdmin, Admin: true, AllowedRoles: reviewerRoles},
		PermissionProviderRoutingAdmin: {Required: PermissionProviderRoutingAdmin, Admin: true, AllowedRoles: superadminRoles},
		PermissionSafetyRuleAdmin:      {Required: PermissionSafetyRuleAdmin, Admin: true, AllowedRoles: reviewerRoles},
		PermissionExportOverrideAdmin:  {Required: PermissionExportOverrideAdmin, Admin: true, AllowedRoles: reviewerRoles},
		PermissionObjectCleanupAdmin:   {Required: PermissionObjectCleanupAdmin, Admin: true, AllowedRoles: superadminRoles},
	}
	return matrix
}

func ParseRole(value string) (Role, bool) {
	switch Role(strings.TrimSpace(value)) {
	case RoleUser:
		return RoleUser, true
	case RoleUserOwner:
		return RoleUserOwner, true
	case RoleUserMember:
		return RoleUserMember, true
	case RoleSupportOperator:
		return RoleSupportOperator, true
	case RoleAdminViewer:
		return RoleAdminViewer, true
	case RoleAdminOperator:
		return RoleAdminOperator, true
	case RoleAdminReviewer:
		return RoleAdminReviewer, true
	case RoleAdminSuperadmin:
		return RoleAdminSuperadmin, true
	case RoleAdmin:
		return RoleAdmin, true
	default:
		return "", false
	}
}

func hasRole(roles []Role, want Role) bool {
	for _, role := range roles {
		if role == want {
			return true
		}
	}
	return false
}

func IsAdminRole(role Role) bool {
	switch role {
	case RoleSupportOperator, RoleAdminViewer, RoleAdminOperator, RoleAdminReviewer, RoleAdminSuperadmin, RoleAdmin:
		return true
	default:
		return false
	}
}

func hasAllowedRole(roles []Role, allowed []Role) bool {
	for _, want := range allowed {
		if hasRole(roles, want) {
			return true
		}
	}
	return false
}

func hasAnyAdminRole(roles []Role) bool {
	for _, role := range roles {
		if IsAdminRole(role) {
			return true
		}
	}
	return false
}
