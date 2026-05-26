package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

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

type ProviderUsageLog struct {
	ID              string
	TenantID        string
	UserID          string
	ProjectID       string
	TaskID          string
	ProviderID      string
	ModelID         string
	EndpointVersion string
	RequestHash     string
	UsageUnits      int64
	CostCents       int
	Status          string
	Metadata        map[string]any
	CreatedAt       time.Time
}

type ProviderUsageReconciliation struct {
	TenantID                  string
	BucketID                  string
	TaskID                    string
	QuotaIdempotencyKey       string
	ProviderLogCount          int64
	ActualUsageUnits          int64
	AccountedQuotaUnits       int64
	AdjustmentKind            string
	AdjustedUnits             int64
	AdjustmentAlreadyRecorded bool
	CostCents                 int64
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

	tx, err := r.begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx)

	insertTag, err := tx.Exec(ctx, `
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
		return tx.Commit(ctx)
	}

	tag, err := tx.Exec(ctx, `
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

	if _, err := tx.Exec(ctx, `
UPDATE quota_transactions
SET status = 'reserved'
WHERE tenant_id = $1 AND idempotency_key = $2 AND kind = 'reserve'`,
		reservation.TenantID,
		reservation.IdempotencyKey,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
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

	tx, err := r.begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx)

	insertTag, err := tx.Exec(ctx, `
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
		return tx.Commit(ctx)
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

	tag, err := tx.Exec(ctx, sql, units, bucketID, tenantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("quota %s failed: reserved units unavailable", kind)
	}

	if _, err := tx.Exec(ctx, `
UPDATE quota_transactions
SET status = $1
WHERE tenant_id = $2 AND idempotency_key = $3 AND kind = $4`,
		status,
		tenantID,
		idempotencyKey,
		kind,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
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

func (r QuotaRepository) RecordProviderUsage(ctx context.Context, usage ProviderUsageLog) error {
	if usage.ID == "" || usage.TenantID == "" || usage.TaskID == "" || usage.ProviderID == "" || usage.ModelID == "" {
		return errors.New("usage id, tenant_id, task_id, provider_id, and model_id are required")
	}
	if usage.UsageUnits < 0 {
		return errors.New("usage units must be non-negative")
	}
	if usage.CostCents < 0 {
		return errors.New("cost cents must be non-negative")
	}
	if usage.Status == "" {
		usage.Status = "recorded"
	}
	if usage.CreatedAt.IsZero() {
		usage.CreatedAt = time.Now().UTC()
	}
	_, err := r.db.Exec(ctx, `
INSERT INTO provider_usage_logs(
	id,
	tenant_id,
	user_id,
	project_id,
	task_id,
	provider_id,
	model_id,
	endpoint_version,
	request_hash,
	usage_units,
	cost_cents,
	status,
	metadata,
	created_at
)
VALUES($1, $2, nullif($3, ''), nullif($4, ''), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
ON CONFLICT (id) DO NOTHING`,
		usage.ID,
		usage.TenantID,
		usage.UserID,
		usage.ProjectID,
		usage.TaskID,
		usage.ProviderID,
		usage.ModelID,
		usage.EndpointVersion,
		usage.RequestHash,
		usage.UsageUnits,
		usage.CostCents,
		usage.Status,
		jsonMap(usage.Metadata),
		usage.CreatedAt.UTC(),
	)
	return err
}

func (r QuotaRepository) ReconcileProviderUsage(ctx context.Context, tenantID, bucketID, taskID, quotaIdempotencyKey string) (ProviderUsageReconciliation, error) {
	if tenantID == "" || bucketID == "" || taskID == "" || quotaIdempotencyKey == "" {
		return ProviderUsageReconciliation{}, errors.New("tenant_id, bucket_id, task_id, and quota idempotency key are required")
	}

	tx, err := r.begin(ctx)
	if err != nil {
		return ProviderUsageReconciliation{}, err
	}
	defer rollback(ctx, tx)

	result := ProviderUsageReconciliation{
		TenantID:            tenantID,
		BucketID:            bucketID,
		TaskID:              taskID,
		QuotaIdempotencyKey: quotaIdempotencyKey,
	}
	err = tx.QueryRow(ctx, `
SELECT
	COALESCE(sum(usage_units), 0),
	COALESCE(sum(cost_cents), 0),
	count(*)
FROM provider_usage_logs
WHERE tenant_id = $1
  AND task_id = $2
  AND status IN ('recorded', 'reconciled')`,
		tenantID,
		taskID,
	).Scan(&result.ActualUsageUnits, &result.CostCents, &result.ProviderLogCount)
	if err != nil {
		return ProviderUsageReconciliation{}, err
	}
	if result.ProviderLogCount == 0 {
		return ProviderUsageReconciliation{}, ErrProviderUsageMissing
	}

	err = tx.QueryRow(ctx, `
SELECT COALESCE(sum(
	CASE
		WHEN kind IN ('commit', 'provider_usage_debit') AND status = 'committed' THEN units
		WHEN kind = 'provider_usage_credit' AND status = 'committed' THEN -units
		ELSE 0
	END
), 0)
FROM quota_transactions
WHERE tenant_id = $1
  AND bucket_id = $2
  AND (
    (idempotency_key = $3 AND kind = 'commit')
    OR (metadata->>'reconciles_idempotency_key' = $3 AND kind IN ('provider_usage_debit', 'provider_usage_credit'))
  )`,
		tenantID,
		bucketID,
		quotaIdempotencyKey,
	).Scan(&result.AccountedQuotaUnits)
	if err != nil {
		return ProviderUsageReconciliation{}, err
	}

	delta := result.ActualUsageUnits - result.AccountedQuotaUnits
	if delta != 0 {
		adjustmentKind := "provider_usage_debit"
		adjustedUnits := delta
		bucketSQL := `
UPDATE quota_buckets
SET used_units = used_units + $1, updated_at = now()
WHERE id = $2
  AND tenant_id = $3`
		if delta < 0 {
			adjustmentKind = "provider_usage_credit"
			adjustedUnits = -delta
			bucketSQL = `
UPDATE quota_buckets
SET used_units = used_units - $1, updated_at = now()
WHERE id = $2
  AND tenant_id = $3
  AND used_units >= $1`
		}
		result.AdjustmentKind = adjustmentKind
		result.AdjustedUnits = adjustedUnits

		adjustmentIDKey := fmt.Sprintf("%s:%s:%s:%d", quotaIdempotencyKey, taskID, adjustmentKind, result.ActualUsageUnits)
		insertTag, err := tx.Exec(ctx, `
INSERT INTO quota_transactions(id, bucket_id, tenant_id, idempotency_key, kind, units, status, metadata, created_at)
VALUES($1, $2, $3, $4, $5, $6, 'committed', $7, now())
ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING`,
			adjustmentIDKey,
			bucketID,
			tenantID,
			adjustmentIDKey,
			adjustmentKind,
			adjustedUnits,
			jsonMap(map[string]any{
				"task_id":                      taskID,
				"actual_usage_units":           result.ActualUsageUnits,
				"accounted_quota_units":        result.AccountedQuotaUnits,
				"reconciles_idempotency_key":   quotaIdempotencyKey,
				"provider_usage_log_count":     result.ProviderLogCount,
				"provider_usage_cost_cents":    result.CostCents,
				"provider_usage_reconciled_at": time.Now().UTC().Format(time.RFC3339Nano),
			}),
		)
		if err != nil {
			return ProviderUsageReconciliation{}, err
		}
		if insertTag.RowsAffected() == 0 {
			result.AdjustmentAlreadyRecorded = true
		} else {
			tag, err := tx.Exec(ctx, bucketSQL, adjustedUnits, bucketID, tenantID)
			if err != nil {
				return ProviderUsageReconciliation{}, err
			}
			if tag.RowsAffected() != 1 {
				return ProviderUsageReconciliation{}, fmt.Errorf("provider usage reconciliation failed: quota bucket adjustment unavailable")
			}
		}
	}

	_, err = tx.Exec(ctx, `
UPDATE provider_usage_logs
SET status = 'reconciled',
    metadata = metadata || $3
WHERE tenant_id = $1
  AND task_id = $2
  AND status IN ('recorded', 'reconciled')`,
		tenantID,
		taskID,
		jsonMap(map[string]any{
			"reconciled_quota_idempotency_key": quotaIdempotencyKey,
			"reconciled_bucket_id":             bucketID,
			"reconciled_actual_usage_units":    result.ActualUsageUnits,
			"reconciled_accounted_quota_units": result.AccountedQuotaUnits,
		}),
	)
	if err != nil {
		return ProviderUsageReconciliation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ProviderUsageReconciliation{}, err
	}
	return result, nil
}

func (r QuotaRepository) adjustLimit(ctx context.Context, tenantID, bucketID, idempotencyKey string, delta int64, kind string) error {
	tx, err := r.begin(ctx)
	if err != nil {
		return err
	}
	defer rollback(ctx, tx)

	insertTag, err := tx.Exec(ctx, `
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
		return tx.Commit(ctx)
	}

	tag, err := tx.Exec(ctx, `
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

	if _, err := tx.Exec(ctx, `
UPDATE quota_transactions
SET status = 'committed'
WHERE tenant_id = $1 AND idempotency_key = $2 AND kind = $3`,
		tenantID,
		idempotencyKey,
		kind,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

var ErrQuotaInsufficient = errors.New("quota insufficient")
var ErrProviderUsageMissing = errors.New("provider usage missing")

func (r QuotaRepository) begin(ctx context.Context) (store.Tx, error) {
	transactor, ok := r.db.(store.Transactor)
	if !ok {
		return noopTx{DBTX: r.db}, nil
	}
	return transactor.Begin(ctx)
}

func rollback(ctx context.Context, tx store.Tx) {
	_ = tx.Rollback(ctx)
}

type noopTx struct {
	store.DBTX
}

func (noopTx) Commit(context.Context) error {
	return nil
}

func (noopTx) Rollback(context.Context) error {
	return pgx.ErrTxClosed
}

func jsonMap(value map[string]any) []byte {
	if value == nil {
		value = map[string]any{}
	}
	data, _ := json.Marshal(value)
	return data
}
