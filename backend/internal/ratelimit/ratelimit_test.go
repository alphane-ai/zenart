package ratelimit

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestUserRateLimitAllowsThenBlocksWithExplainableDecision(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 15, 30, 0, time.UTC)
	enforcer := NewEnforcer(NewMemoryStore(), Policy{
		Enabled:               true,
		UserRequestsPerMinute: 2,
	}).WithNow(func() time.Time { return now })

	for i := 0; i < 2; i++ {
		decision, err := enforcer.Check(context.Background(), Request{
			Scope:    ScopeUser,
			TenantID: "tenant_1",
			UserID:   "user_1",
			Action:   "batch_generation.create",
		})
		if err != nil {
			t.Fatalf("Check() error = %v", err)
		}
		if !decision.Allowed || decision.Code != CodeAllowed {
			t.Fatalf("decision = %#v, want allowed", decision)
		}
	}

	decision, err := enforcer.Check(context.Background(), Request{
		Scope:    ScopeUser,
		TenantID: "tenant_1",
		UserID:   "user_1",
		Action:   "batch_generation.create",
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if decision.Allowed || decision.Code != CodeRateLimitExceeded {
		t.Fatalf("decision = %#v, want rate limit exceeded", decision)
	}
	if decision.Limit != 2 || decision.Observed != 3 || decision.Remaining != 0 {
		t.Fatalf("limit projection = %#v", decision)
	}
	if decision.ResetAt != time.Date(2026, 6, 22, 10, 16, 0, 0, time.UTC) {
		t.Fatalf("ResetAt = %s, want next minute", decision.ResetAt)
	}
	if decision.RetryAfterSeconds != 30 {
		t.Fatalf("RetryAfterSeconds = %d, want 30", decision.RetryAfterSeconds)
	}
	if HTTPStatus(decision) != 429 {
		t.Fatalf("HTTPStatus = %d, want 429", HTTPStatus(decision))
	}
}

func TestTenantRateLimitIsTenantScoped(t *testing.T) {
	now := time.Date(2026, 6, 22, 11, 0, 0, 0, time.UTC)
	enforcer := NewEnforcer(NewMemoryStore(), Policy{
		Enabled:                 true,
		TenantRequestsPerMinute: 1,
	}).WithNow(func() time.Time { return now })

	first, err := enforcer.Check(context.Background(), Request{
		Scope:    ScopeTenant,
		TenantID: "tenant_1",
		UserID:   "user_1",
		Action:   "create_export",
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if !first.Allowed {
		t.Fatalf("first decision = %#v, want allowed", first)
	}

	blocked, err := enforcer.Check(context.Background(), Request{
		Scope:    ScopeTenant,
		TenantID: "tenant_1",
		UserID:   "user_2",
		Action:   "create_export",
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if blocked.Allowed || blocked.SubjectID != "tenant_1" || blocked.Code != CodeRateLimitExceeded {
		t.Fatalf("blocked decision = %#v, want tenant-scoped denial", blocked)
	}

	otherTenant, err := enforcer.Check(context.Background(), Request{
		Scope:    ScopeTenant,
		TenantID: "tenant_2",
		UserID:   "user_3",
		Action:   "create_export",
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if !otherTenant.Allowed {
		t.Fatalf("otherTenant decision = %#v, want allowed", otherTenant)
	}
}

func TestProviderSpendCapBlocksWithoutChargingRejectedCost(t *testing.T) {
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	enforcer := NewEnforcer(NewMemoryStore(), Policy{
		Enabled:                    true,
		ProviderRequestsPerMinute:  10,
		ProviderDailySpendCapCents: 100,
	}).WithNow(func() time.Time { return now })

	allowed, err := enforcer.Check(context.Background(), Request{
		Scope:      ScopeProvider,
		ProviderID: "zenari-image-sandbox",
		Action:     "provider.sandbox_test_call",
		CostCents:  80,
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if !allowed.Allowed || allowed.SpentCents != 80 || allowed.Remaining != 20 {
		t.Fatalf("allowed decision = %#v, want 80 cents spent and 20 remaining", allowed)
	}

	blocked, err := enforcer.Check(context.Background(), Request{
		Scope:      ScopeProvider,
		ProviderID: "zenari-image-sandbox",
		Action:     "provider.sandbox_test_call",
		CostCents:  30,
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if blocked.Allowed || blocked.Code != CodeDailySpendCapExceeded {
		t.Fatalf("blocked decision = %#v, want spend cap exceeded", blocked)
	}
	if blocked.SpentCents != 80 || blocked.Remaining != 20 {
		t.Fatalf("blocked spend projection = %#v, rejected cost should not be reserved", blocked)
	}
	if HTTPStatus(blocked) != 403 {
		t.Fatalf("HTTPStatus = %d, want 403", HTTPStatus(blocked))
	}
}

func TestProviderKillSwitchBlocksBeforeSpendReservation(t *testing.T) {
	now := time.Date(2026, 6, 22, 12, 30, 0, 0, time.UTC)
	enforcer := NewEnforcer(NewMemoryStore(), Policy{
		Enabled:                     true,
		ProviderRequestsPerMinute:   10,
		ProviderDailySpendCapCents:  100,
		ProviderEmergencyKillSwitch: true,
	}).WithNow(func() time.Time { return now })

	decision, err := enforcer.Check(context.Background(), Request{
		Scope:      ScopeProvider,
		ProviderID: "zenari-image-sandbox",
		Action:     "provider.sandbox_test_call",
		CostCents:  1,
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if decision.Allowed || decision.Code != CodeProviderKillSwitchEnabled {
		t.Fatalf("decision = %#v, want provider kill switch denial", decision)
	}
	if decision.SpentCents != 0 {
		t.Fatalf("SpentCents = %d, want no reservation", decision.SpentCents)
	}
}

func TestAdminActionDenialRequiresAuditMetadataWithoutRawPayloads(t *testing.T) {
	now := time.Date(2026, 6, 22, 13, 5, 10, 0, time.UTC)
	enforcer := NewEnforcer(NewMemoryStore(), Policy{
		Enabled:               true,
		AdminActionsPerMinute: 1,
	}).WithNow(func() time.Time { return now })

	_, err := enforcer.Check(context.Background(), Request{
		Scope:    ScopeAdminAction,
		TenantID: "tenant_1",
		UserID:   "admin_1",
		Action:   "admin.billing.manual_credit",
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	decision, err := enforcer.Check(context.Background(), Request{
		Scope:    ScopeAdminAction,
		TenantID: "tenant_1",
		UserID:   "admin_1",
		Action:   "admin.billing.manual_credit",
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if decision.Allowed || !decision.AuditRequired || decision.Code != CodeRateLimitExceeded {
		t.Fatalf("decision = %#v, want audited admin denial", decision)
	}

	metadata := AuditMetadata(decision)
	body, err := json.Marshal(metadata)
	if err != nil {
		t.Fatalf("Marshal metadata error = %v", err)
	}
	bodyText := string(body)
	for _, forbidden := range []string{
		"raw prompt",
		"raw_prompt_text",
		"provider_request_body",
		"api_key",
		"sk-test",
		"fixture-zai-secret-value",
	} {
		if strings.Contains(bodyText, forbidden) {
			t.Fatalf("metadata leaks forbidden token %q: %s", forbidden, bodyText)
		}
	}
	if metadata["rate_limit_code"] != CodeRateLimitExceeded || metadata["audit_required"] != true {
		t.Fatalf("metadata = %#v, want explainable audited denial", metadata)
	}
}

func TestDisabledPolicyAllowsWithoutCounting(t *testing.T) {
	enforcer := NewEnforcer(NewMemoryStore(), Policy{Enabled: false})
	decision, err := enforcer.Check(context.Background(), Request{
		Scope:    ScopeUser,
		TenantID: "tenant_1",
		UserID:   "user_1",
		Action:   "batch_generation.create",
	})
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if !decision.Allowed || decision.Code != CodeDisabled || decision.Observed != 0 {
		t.Fatalf("decision = %#v, want disabled allow without counter", decision)
	}
}

func TestValidationRejectsMissingSubjectAndNegativeCost(t *testing.T) {
	enforcer := NewEnforcer(NewMemoryStore(), Policy{Enabled: true, UserRequestsPerMinute: 1})
	if _, err := enforcer.Check(context.Background(), Request{Scope: ScopeUser, Action: "batch_generation.create"}); err == nil {
		t.Fatal("Check() error = nil, want missing subject error")
	}
	if _, err := enforcer.Check(context.Background(), Request{
		Scope:      ScopeProvider,
		ProviderID: "zenari-image-sandbox",
		Action:     "provider.sandbox_test_call",
		CostCents:  -1,
	}); err == nil {
		t.Fatal("Check() error = nil, want negative cost error")
	}
}
