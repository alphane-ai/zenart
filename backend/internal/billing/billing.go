package billing

import (
	"context"
	"errors"
)

type SubscriptionState string

const (
	SubscriptionTrialing  SubscriptionState = "trialing"
	SubscriptionActive    SubscriptionState = "active"
	SubscriptionPastDue   SubscriptionState = "past_due"
	SubscriptionCancelled SubscriptionState = "cancelled"
	SubscriptionExpired   SubscriptionState = "expired"
	SubscriptionComped    SubscriptionState = "comped"
)

type EntitlementRequest struct {
	TenantID string
	UserID   string
	Action   string
	Cost     int64
}

type EntitlementDecision struct {
	Allowed bool
	Reason  string
}

type EntitlementService interface {
	Check(ctx context.Context, req EntitlementRequest) (EntitlementDecision, error)
}

type LocalEntitlements struct{}

func (LocalEntitlements) Check(_ context.Context, req EntitlementRequest) (EntitlementDecision, error) {
	if req.TenantID == "" || req.UserID == "" {
		return EntitlementDecision{}, errors.New("tenant_id and user_id are required")
	}
	if req.Cost < 0 {
		return EntitlementDecision{}, errors.New("cost must be non-negative")
	}
	return EntitlementDecision{Allowed: true, Reason: "local_mode"}, nil
}
