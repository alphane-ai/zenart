package billing

import (
	"context"
	"errors"
	"fmt"
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
INSERT INTO quota_transactions(id, bucket_id, tenant_id, idempotency_key, kind, units, status, created_at)
VALUES($1, $2, $3, $4, 'reserve', $5, 'reserved', $6)
ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING`,
		reservation.ID,
		reservation.BucketID,
		reservation.TenantID,
		reservation.IdempotencyKey,
		reservation.Units,
		reservation.CreatedAt.UTC(),
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
INSERT INTO quota_transactions(id, bucket_id, tenant_id, idempotency_key, kind, units, status, created_at)
VALUES($1, $2, $3, $4, $5, $6, $7, now())
ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING`,
		idempotencyKey+":"+kind,
		bucketID,
		tenantID,
		idempotencyKey,
		kind,
		units,
		status,
	)
	return err
}

var ErrQuotaInsufficient = errors.New("quota insufficient")
