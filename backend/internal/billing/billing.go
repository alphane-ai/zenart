package billing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/store"
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

type ControlDecision struct {
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

type SpendControl struct {
	DailyCapUnits int64
	SpentToday    int64
	KillSwitch    bool
}

func (c SpendControl) Check(costUnits int64) ControlDecision {
	if c.KillSwitch {
		return ControlDecision{Allowed: false, Reason: "kill_switch_enabled"}
	}
	if costUnits < 0 {
		return ControlDecision{Allowed: false, Reason: "cost_must_be_non_negative"}
	}
	if c.DailyCapUnits > 0 && c.SpentToday+costUnits > c.DailyCapUnits {
		return ControlDecision{Allowed: false, Reason: "daily_spend_cap_exceeded"}
	}
	return ControlDecision{Allowed: true, Reason: "ok"}
}

func EntitlementMiddleware(service EntitlementService, action string, cost int64, principal func(*http.Request) (tenantID, userID string, ok bool), deny func(http.ResponseWriter, *http.Request, EntitlementDecision)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tenantID, userID, ok := principal(r)
			if !ok {
				deny(w, r, EntitlementDecision{Allowed: false, Reason: "principal_missing"})
				return
			}
			decision, err := service.Check(r.Context(), EntitlementRequest{
				TenantID: tenantID,
				UserID:   userID,
				Action:   action,
				Cost:     cost,
			})
			if err != nil {
				deny(w, r, EntitlementDecision{Allowed: false, Reason: err.Error()})
				return
			}
			if !decision.Allowed {
				deny(w, r, decision)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func CanTransitionSubscription(from, to SubscriptionState) bool {
	if from == to {
		return true
	}
	switch from {
	case "":
		return to == SubscriptionTrialing || to == SubscriptionActive || to == SubscriptionComped
	case SubscriptionTrialing:
		return to == SubscriptionActive || to == SubscriptionPastDue || to == SubscriptionCancelled || to == SubscriptionExpired || to == SubscriptionComped
	case SubscriptionActive:
		return to == SubscriptionPastDue || to == SubscriptionCancelled || to == SubscriptionExpired || to == SubscriptionComped
	case SubscriptionPastDue:
		return to == SubscriptionActive || to == SubscriptionCancelled || to == SubscriptionExpired || to == SubscriptionComped
	case SubscriptionCancelled:
		return to == SubscriptionExpired || to == SubscriptionActive || to == SubscriptionComped
	case SubscriptionExpired:
		return to == SubscriptionActive || to == SubscriptionComped
	case SubscriptionComped:
		return to == SubscriptionActive || to == SubscriptionCancelled || to == SubscriptionExpired
	default:
		return false
	}
}

type CheckoutSession struct {
	ID          string
	TenantID    string
	UserID      string
	Provider    string
	RedirectURL string
	CreatedAt   time.Time
}

type CheckoutProvider interface {
	CreateCheckout(ctx context.Context, tenantID, userID, planID string) (CheckoutSession, error)
}

type MockCheckoutProvider struct {
	Now func() time.Time
}

func (p MockCheckoutProvider) CreateCheckout(_ context.Context, tenantID, userID, planID string) (CheckoutSession, error) {
	if tenantID == "" || userID == "" || planID == "" {
		return CheckoutSession{}, errors.New("tenant_id, user_id, and plan_id are required")
	}
	now := time.Now().UTC()
	if p.Now != nil {
		now = p.Now().UTC()
	}
	return CheckoutSession{
		ID:          "mock_checkout:" + tenantID + ":" + userID + ":" + planID,
		TenantID:    tenantID,
		UserID:      userID,
		Provider:    "mock",
		RedirectURL: "/billing/mock-checkout/complete",
		CreatedAt:   now,
	}, nil
}

type PaidProviderAdapter interface {
	CreateCheckout(ctx context.Context, tenantID, userID, planID string) (CheckoutSession, error)
	HandleWebhook(ctx context.Context, payload []byte, signature string) error
}

type QuotaReservation struct {
	ID             string
	TenantID       string
	BucketID       string
	IdempotencyKey string
	Units          int64
	CreatedAt      time.Time
}

type QuotaRepository struct {
	db store.DBTX
}

func NewQuotaRepository(db store.DBTX) QuotaRepository {
	return QuotaRepository{db: db}
}

func (r QuotaRepository) Reserve(ctx context.Context, reservation QuotaReservation) error {
	if reservation.Units <= 0 {
		return errors.New("reservation units must be positive")
	}
	insertTag, err := r.db.Exec(ctx, `
INSERT INTO quota_transactions(id, bucket_id, tenant_id, idempotency_key, kind, units, status, created_at)
VALUES($1, $2, $3, $4, 'reserve', $5, 'pending', $6)
ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING`,
		reservation.ID,
		reservation.BucketID,
		reservation.TenantID,
		reservation.IdempotencyKey,
		reservation.Units,
		reservation.CreatedAt.UTC(),
	)
	if err != nil {
		return err
	}
	if insertTag.RowsAffected() == 0 {
		return nil
	}

	tag, err := r.db.Exec(ctx, `
UPDATE quota_buckets
SET reserved_units = reserved_units + $1, updated_at = now()
WHERE id = $2
  AND tenant_id = $3
  AND used_units + reserved_units + $1 <= limit_units`,
		reservation.Units,
		reservation.BucketID,
		reservation.TenantID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrQuotaInsufficient
	}

	_, err = r.db.Exec(ctx, `
UPDATE quota_transactions
SET status = 'reserved'
WHERE tenant_id = $1 AND idempotency_key = $2 AND kind = 'reserve'`,
		reservation.TenantID,
		reservation.IdempotencyKey,
	)
	return err
}

func (r QuotaRepository) Commit(ctx context.Context, tenantID, bucketID, idempotencyKey string, units int64) error {
	return r.moveReserved(ctx, tenantID, bucketID, idempotencyKey, units, "commit", "committed", true)
}

func (r QuotaRepository) Refund(ctx context.Context, tenantID, bucketID, idempotencyKey string, units int64) error {
	return r.moveReserved(ctx, tenantID, bucketID, idempotencyKey, units, "refund", "refunded", false)
}

func (r QuotaRepository) moveReserved(ctx context.Context, tenantID, bucketID, idempotencyKey string, units int64, kind, status string, commit bool) error {
	if units <= 0 {
		return errors.New("units must be positive")
	}

	insertTag, err := r.db.Exec(ctx, `
INSERT INTO quota_transactions(id, bucket_id, tenant_id, idempotency_key, kind, units, status, created_at)
VALUES($1, $2, $3, $4, $5, $6, 'pending', now())
ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING`,
		idempotencyKey+":"+kind,
		bucketID,
		tenantID,
		idempotencyKey,
		kind,
		units,
	)
	if err != nil {
		return err
	}
	if insertTag.RowsAffected() == 0 {
		return nil
	}

	sql := `
UPDATE quota_buckets
SET reserved_units = reserved_units - $1, updated_at = now()
WHERE id = $2
  AND tenant_id = $3
  AND reserved_units >= $1`
	if commit {
		sql = `
UPDATE quota_buckets
SET reserved_units = reserved_units - $1, used_units = used_units + $1, updated_at = now()
WHERE id = $2
  AND tenant_id = $3
  AND reserved_units >= $1`
	}

	tag, err := r.db.Exec(ctx, sql, units, bucketID, tenantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("quota %s failed: reserved units unavailable", kind)
	}

	_, err = r.db.Exec(ctx, `
UPDATE quota_transactions
SET status = $1
WHERE tenant_id = $2 AND idempotency_key = $3 AND kind = $4`,
		status,
		tenantID,
		idempotencyKey,
		kind,
	)
	return err
}

func (r QuotaRepository) AdminCredit(ctx context.Context, tenantID, bucketID, idempotencyKey string, units int64) error {
	if units <= 0 {
		return errors.New("units must be positive")
	}
	return r.adjustLimit(ctx, tenantID, bucketID, idempotencyKey, units, "admin_credit")
}

func (r QuotaRepository) AdminDebit(ctx context.Context, tenantID, bucketID, idempotencyKey string, units int64) error {
	if units <= 0 {
		return errors.New("units must be positive")
	}
	return r.adjustLimit(ctx, tenantID, bucketID, idempotencyKey, -units, "admin_debit")
}

func (r QuotaRepository) ResetWeekly(ctx context.Context, now time.Time) error {
	_, err := r.db.Exec(ctx, `
UPDATE quota_buckets
SET used_units = 0,
    reserved_units = 0,
    resets_at = $1,
    updated_at = now()
WHERE period = 'weekly'
  AND resets_at <= $2`,
		now.UTC().Add(7*24*time.Hour),
		now.UTC(),
	)
	return err
}

func (r QuotaRepository) adjustLimit(ctx context.Context, tenantID, bucketID, idempotencyKey string, delta int64, kind string) error {
	insertTag, err := r.db.Exec(ctx, `
INSERT INTO quota_transactions(id, bucket_id, tenant_id, idempotency_key, kind, units, status, created_at)
VALUES($1, $2, $3, $4, $5, abs($6), 'pending', now())
ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING`,
		idempotencyKey+":"+kind,
		bucketID,
		tenantID,
		idempotencyKey,
		kind,
		delta,
	)
	if err != nil {
		return err
	}
	if insertTag.RowsAffected() == 0 {
		return nil
	}

	tag, err := r.db.Exec(ctx, `
UPDATE quota_buckets
SET limit_units = limit_units + $1, updated_at = now()
WHERE id = $2
  AND tenant_id = $3
  AND limit_units + $1 >= used_units + reserved_units`,
		delta,
		bucketID,
		tenantID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("quota %s failed: limit would fall below used plus reserved units", kind)
	}

	_, err = r.db.Exec(ctx, `
UPDATE quota_transactions
SET status = 'committed'
WHERE tenant_id = $1 AND idempotency_key = $2 AND kind = $3`,
		tenantID,
		idempotencyKey,
		kind,
	)
	return err
}

var ErrQuotaInsufficient = errors.New("quota insufficient")
