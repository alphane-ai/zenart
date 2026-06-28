package task

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

type BatchQuotaLedger interface {
	ResolveBatchQuotaBucket(ctx context.Context, tenantID, userID string) (string, error)
	ReserveBatchQuota(ctx context.Context, db store.DBTX, batch BatchGenerationRequest) error
	CommitBatchQuota(ctx context.Context, db store.DBTX, batch BatchGenerationRequest, child GenerationChildTask, units int64) error
	RefundBatchQuota(ctx context.Context, db store.DBTX, batch BatchGenerationRequest, child GenerationChildTask, units int64) error
}

type PostgresBatchQuotaLedger struct {
	db store.DBTX
}

func NewPostgresBatchQuotaLedger(db store.DBTX) PostgresBatchQuotaLedger {
	return PostgresBatchQuotaLedger{db: db}
}

func (l PostgresBatchQuotaLedger) ResolveBatchQuotaBucket(ctx context.Context, tenantID, userID string) (string, error) {
	if l.db == nil {
		return "", errors.New("batch quota ledger database is required")
	}
	tenantID = strings.TrimSpace(tenantID)
	userID = strings.TrimSpace(userID)
	if tenantID == "" || userID == "" {
		return "", fmt.Errorf("%w: tenant_id and user_id are required for quota bucket lookup", ErrBatchValidation)
	}
	var bucketID string
	err := l.db.QueryRow(ctx, `
SELECT id
FROM quota_buckets
WHERE tenant_id = $1
  AND subject_type = 'user'
  AND subject_id = $2
  AND resets_at > now()
ORDER BY resets_at ASC, created_at ASC
	LIMIT 1`, tenantID, userID).Scan(&bucketID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrBatchQuotaInsufficient
	}
	if err != nil {
		return "", err
	}
	return bucketID, nil
}

func (PostgresBatchQuotaLedger) ReserveBatchQuota(ctx context.Context, db store.DBTX, batch BatchGenerationRequest) error {
	if batch.QuotaEstimatedUnits <= 0 {
		return nil
	}
	if err := validateBatchQuotaScope(batch); err != nil {
		return err
	}
	insertTag, err := db.Exec(ctx, `
INSERT INTO quota_transactions(id, bucket_id, tenant_id, idempotency_key, kind, units, status, metadata, created_at)
VALUES($1, $2, $3, $4, 'reserve', $5, 'pending', jsonb_build_object('batch_id', $6::text, 'quota_source', 'batch_generation'), $7)
ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING`,
		batch.QuotaReservationID+":reserve",
		batch.QuotaBucketID,
		batch.TenantID,
		batch.QuotaReservationID,
		batch.QuotaEstimatedUnits,
		batch.ID,
		batch.CreatedAt.UTC(),
	)
	if err != nil {
		return err
	}
	if insertTag.RowsAffected() == 0 {
		return nil
	}
	tag, err := db.Exec(ctx, `
UPDATE quota_buckets
SET reserved_units = reserved_units + $1, updated_at = now()
WHERE id = $2
  AND tenant_id = $3
  AND used_units + reserved_units + $1 <= limit_units`,
		batch.QuotaEstimatedUnits,
		batch.QuotaBucketID,
		batch.TenantID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrBatchQuotaInsufficient
	}
	_, err = db.Exec(ctx, `
UPDATE quota_transactions
SET status = 'reserved'
WHERE tenant_id = $1 AND idempotency_key = $2 AND kind = 'reserve'`,
		batch.TenantID,
		batch.QuotaReservationID,
	)
	return err
}

func (PostgresBatchQuotaLedger) CommitBatchQuota(ctx context.Context, db store.DBTX, batch BatchGenerationRequest, child GenerationChildTask, units int64) error {
	return moveBatchQuota(ctx, db, batch, child, units, "commit", "committed", true)
}

func (PostgresBatchQuotaLedger) RefundBatchQuota(ctx context.Context, db store.DBTX, batch BatchGenerationRequest, child GenerationChildTask, units int64) error {
	return moveBatchQuota(ctx, db, batch, child, units, "refund", "refunded", false)
}

func moveBatchQuota(ctx context.Context, db store.DBTX, batch BatchGenerationRequest, child GenerationChildTask, units int64, kind, status string, commit bool) error {
	if units <= 0 {
		return nil
	}
	if err := validateBatchQuotaScope(batch); err != nil {
		return err
	}
	if child.ID == "" || child.BatchID != batch.ID || child.TenantID != batch.TenantID {
		return fmt.Errorf("%w: child scope must match batch quota scope", ErrBatchValidation)
	}
	idempotencyKey := BatchChildQuotaIdempotencyKey(batch, child)
	insertTag, err := db.Exec(ctx, `
INSERT INTO quota_transactions(id, bucket_id, tenant_id, idempotency_key, kind, units, status, metadata, created_at)
VALUES($1, $2, $3, $4, $5, $6, 'pending', jsonb_build_object('batch_id', $7::text, 'child_id', $8::text, 'quota_source', 'batch_generation'), now())
ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING`,
		idempotencyKey+":"+kind,
		batch.QuotaBucketID,
		batch.TenantID,
		idempotencyKey,
		kind,
		units,
		batch.ID,
		child.ID,
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
	tag, err := db.Exec(ctx, sql, units, batch.QuotaBucketID, batch.TenantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("%w: reserved quota unavailable for %s", ErrBatchQuotaUnavailable, kind)
	}
	_, err = db.Exec(ctx, `
UPDATE quota_transactions
SET status = $1
WHERE tenant_id = $2 AND idempotency_key = $3 AND kind = $4`,
		status,
		batch.TenantID,
		idempotencyKey,
		kind,
	)
	return err
}

func validateBatchQuotaScope(batch BatchGenerationRequest) error {
	if strings.TrimSpace(batch.TenantID) == "" || strings.TrimSpace(batch.QuotaBucketID) == "" || strings.TrimSpace(batch.QuotaReservationID) == "" {
		return fmt.Errorf("%w: tenant_id, quota_bucket_id, and quota_reservation_id are required", ErrBatchValidation)
	}
	if batch.CreatedAt.IsZero() {
		batch.CreatedAt = time.Now().UTC()
	}
	return nil
}

func BatchChildQuotaIdempotencyKey(batch BatchGenerationRequest, child GenerationChildTask) string {
	idempotencyKey := batch.QuotaReservationID + ":" + child.ID
	if child.RetryCount > 0 {
		idempotencyKey += ":attempt:" + strconv.Itoa(child.RetryCount)
	}
	return idempotencyKey
}

var ErrBatchQuotaInsufficient = errors.New("batch quota insufficient")
var ErrBatchQuotaUnavailable = errors.New("batch quota unavailable")
