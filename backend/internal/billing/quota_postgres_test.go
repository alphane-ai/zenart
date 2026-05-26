package billing

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

func TestQuotaReserveConcurrentContentionPostgres(t *testing.T) {
	dsn := os.Getenv("ZENART_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set ZENART_TEST_DATABASE_URL to run postgres quota contention test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer pool.Close()

	tenantID := "tenant_quota_contention"
	userID := "user_quota_contention"
	bucketID := "bucket_quota_contention"
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)

	setupQuotaFixture(t, ctx, pool, tenantID, userID, bucketID, now)

	repo := NewQuotaRepository(store.NewPoolAdapter(pool))
	const workers = 12
	var allowed atomic.Int64
	var insufficient atomic.Int64
	var wg sync.WaitGroup
	start := make(chan struct{})

	for i := 0; i < workers; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			err := repo.Reserve(ctx, QuotaReservation{
				ID:             fmt.Sprintf("reservation_%02d", i),
				TenantID:       tenantID,
				BucketID:       bucketID,
				IdempotencyKey: fmt.Sprintf("generate_%02d", i),
				Units:          10,
				CreatedAt:      now,
			})
			switch {
			case err == nil:
				allowed.Add(1)
			case errors.Is(err, ErrQuotaInsufficient):
				insufficient.Add(1)
			default:
				t.Errorf("Reserve() error = %v", err)
			}
		}()
	}

	close(start)
	wg.Wait()

	if allowed.Load() != 5 {
		t.Fatalf("allowed reservations = %d, want 5", allowed.Load())
	}
	if insufficient.Load() != workers-5 {
		t.Fatalf("insufficient reservations = %d, want %d", insufficient.Load(), workers-5)
	}

	var used, reserved int64
	if err := pool.QueryRow(ctx, `
SELECT used_units, reserved_units
FROM quota_buckets
WHERE id = $1`, bucketID).Scan(&used, &reserved); err != nil {
		t.Fatalf("read quota bucket: %v", err)
	}
	if used != 0 || reserved != 50 {
		t.Fatalf("quota bucket used/reserved = %d/%d, want 0/50", used, reserved)
	}

	var reservedTransactions, pendingTransactions int64
	if err := pool.QueryRow(ctx, `
SELECT
	count(*) FILTER (WHERE status = 'reserved'),
	count(*) FILTER (WHERE status = 'pending')
FROM quota_transactions
WHERE tenant_id = $1
  AND bucket_id = $2
  AND kind = 'reserve'`, tenantID, bucketID).Scan(&reservedTransactions, &pendingTransactions); err != nil {
		t.Fatalf("read quota transactions: %v", err)
	}
	if reservedTransactions != 5 || pendingTransactions != 0 {
		t.Fatalf("reserved/pending transactions = %d/%d, want 5/0", reservedTransactions, pendingTransactions)
	}
}

func TestQuotaReserveInsufficientDoesNotPoisonIdempotencyPostgres(t *testing.T) {
	dsn := os.Getenv("ZENART_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set ZENART_TEST_DATABASE_URL to run postgres quota idempotency test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer pool.Close()

	tenantID := "tenant_quota_idempotency"
	userID := "user_quota_idempotency"
	bucketID := "bucket_quota_idempotency"
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)

	setupQuotaFixture(t, ctx, pool, tenantID, userID, bucketID, now)

	repo := NewQuotaRepository(store.NewPoolAdapter(pool))
	err = repo.Reserve(ctx, QuotaReservation{
		ID:             "reservation_too_large",
		TenantID:       tenantID,
		BucketID:       bucketID,
		IdempotencyKey: "same_request",
		Units:          60,
		CreatedAt:      now,
	})
	if !errors.Is(err, ErrQuotaInsufficient) {
		t.Fatalf("Reserve() error = %v, want ErrQuotaInsufficient", err)
	}

	if _, err := pool.Exec(ctx, `
UPDATE quota_buckets
SET limit_units = 100, updated_at = now()
WHERE id = $1`, bucketID); err != nil {
		t.Fatalf("raise quota limit: %v", err)
	}

	err = repo.Reserve(ctx, QuotaReservation{
		ID:             "reservation_retry_after_credit",
		TenantID:       tenantID,
		BucketID:       bucketID,
		IdempotencyKey: "same_request",
		Units:          60,
		CreatedAt:      now,
	})
	if err != nil {
		t.Fatalf("Reserve() retry error = %v", err)
	}

	var reserved int64
	if err := pool.QueryRow(ctx, `
SELECT reserved_units
FROM quota_buckets
WHERE id = $1`, bucketID).Scan(&reserved); err != nil {
		t.Fatalf("read quota bucket: %v", err)
	}
	if reserved != 60 {
		t.Fatalf("reserved units = %d, want 60", reserved)
	}
}

func TestProviderUsageReconciliationPostgres(t *testing.T) {
	dsn := os.Getenv("ZENART_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set ZENART_TEST_DATABASE_URL to run postgres provider usage reconciliation test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer pool.Close()

	tenantID := "tenant_provider_reconcile"
	userID := "user_provider_reconcile"
	bucketID := "bucket_provider_reconcile"
	taskID := "task_provider_reconcile"
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)

	setupQuotaFixture(t, ctx, pool, tenantID, userID, bucketID, now)
	execFixtureSQL(t, ctx, pool, "insert provider task", `
INSERT INTO agent_tasks(id, tenant_id, type, schema_version, status, user_status, idempotency_key, created_at, updated_at)
VALUES($1, $2, 'candidate_set_builder', 1, 'succeeded', 'succeeded', 'generate_reconcile', $3, $3)`, taskID, tenantID, now)

	repo := NewQuotaRepository(store.NewPoolAdapter(pool))
	if err := repo.Reserve(ctx, QuotaReservation{
		ID:             "reservation_provider_reconcile",
		TenantID:       tenantID,
		BucketID:       bucketID,
		IdempotencyKey: "generate_reconcile",
		Units:          10,
		CreatedAt:      now,
	}); err != nil {
		t.Fatalf("Reserve() error = %v", err)
	}
	if err := repo.Commit(ctx, tenantID, bucketID, "generate_reconcile", 10); err != nil {
		t.Fatalf("Commit() error = %v", err)
	}
	if err := repo.RecordProviderUsage(ctx, ProviderUsageLog{
		ID:              "usage_provider_reconcile",
		TenantID:        tenantID,
		UserID:          userID,
		TaskID:          taskID,
		ProviderID:      "dev",
		ModelID:         "dev-echo-v1",
		EndpointVersion: "v1",
		RequestHash:     "hash_reconcile",
		UsageUnits:      12,
		CostCents:       25,
		CreatedAt:       now,
	}); err != nil {
		t.Fatalf("RecordProviderUsage() error = %v", err)
	}

	reconciliation, err := repo.ReconcileProviderUsage(ctx, tenantID, bucketID, taskID, "generate_reconcile")
	if err != nil {
		t.Fatalf("ReconcileProviderUsage() error = %v", err)
	}
	if reconciliation.AdjustmentKind != "provider_usage_debit" || reconciliation.AdjustedUnits != 2 {
		t.Fatalf("adjustment = %s/%d, want provider_usage_debit/2", reconciliation.AdjustmentKind, reconciliation.AdjustedUnits)
	}

	var used, reserved int64
	if err := pool.QueryRow(ctx, `
SELECT used_units, reserved_units
FROM quota_buckets
WHERE id = $1`, bucketID).Scan(&used, &reserved); err != nil {
		t.Fatalf("read quota bucket: %v", err)
	}
	if used != 12 || reserved != 0 {
		t.Fatalf("quota bucket used/reserved = %d/%d, want 12/0", used, reserved)
	}

	var usageStatus string
	if err := pool.QueryRow(ctx, `
SELECT status
FROM provider_usage_logs
WHERE id = 'usage_provider_reconcile'`).Scan(&usageStatus); err != nil {
		t.Fatalf("read provider usage: %v", err)
	}
	if usageStatus != "reconciled" {
		t.Fatalf("provider usage status = %q, want reconciled", usageStatus)
	}

	again, err := repo.ReconcileProviderUsage(ctx, tenantID, bucketID, taskID, "generate_reconcile")
	if err != nil {
		t.Fatalf("ReconcileProviderUsage() retry error = %v", err)
	}
	if again.AdjustmentKind != "" || again.AdjustedUnits != 0 {
		t.Fatalf("retry adjustment = %s/%d, want no-op", again.AdjustmentKind, again.AdjustedUnits)
	}
}

func setupQuotaFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID, userID, bucketID string, now time.Time) {
	t.Helper()

	execFixtureSQL(t, ctx, pool, "delete provider usage", "DELETE FROM provider_usage_logs WHERE tenant_id = $1", tenantID)
	execFixtureSQL(t, ctx, pool, "delete agent traces", "DELETE FROM agent_traces WHERE tenant_id = $1", tenantID)
	execFixtureSQL(t, ctx, pool, "delete agent tasks", "DELETE FROM agent_tasks WHERE tenant_id = $1", tenantID)
	execFixtureSQL(t, ctx, pool, "delete quota transactions", "DELETE FROM quota_transactions WHERE tenant_id = $1", tenantID)
	execFixtureSQL(t, ctx, pool, "delete quota buckets", "DELETE FROM quota_buckets WHERE tenant_id = $1", tenantID)
	execFixtureSQL(t, ctx, pool, "delete user roles", "DELETE FROM user_roles WHERE user_id = $1", userID)
	execFixtureSQL(t, ctx, pool, "delete subscriptions", "DELETE FROM subscriptions WHERE tenant_id = $1", tenantID)
	execFixtureSQL(t, ctx, pool, "delete sessions", "DELETE FROM sessions WHERE tenant_id = $1", tenantID)
	execFixtureSQL(t, ctx, pool, "delete users", "DELETE FROM users WHERE tenant_id = $1", tenantID)
	execFixtureSQL(t, ctx, pool, "delete tenant", "DELETE FROM tenants WHERE id = $1", tenantID)

	execFixtureSQL(t, ctx, pool, "insert tenant", `
INSERT INTO tenants(id, name, created_at)
VALUES($1, 'Quota contention tenant', $2)`, tenantID, now)
	execFixtureSQL(t, ctx, pool, "insert user", `
INSERT INTO users(id, tenant_id, email, display_name, created_at)
VALUES($1, $2, $1 || '@example.test', 'Quota Test User', $3)`, userID, tenantID, now)
	execFixtureSQL(t, ctx, pool, "insert quota bucket", `
INSERT INTO quota_buckets(id, tenant_id, subject_type, subject_id, period, limit_units, used_units, reserved_units, resets_at, created_at, updated_at)
VALUES($1, $2, 'tenant', $2, 'weekly', 50, 0, 0, $3, $4, $4)`, bucketID, tenantID, now.Add(7*24*time.Hour), now)
}

func execFixtureSQL(t *testing.T, ctx context.Context, pool *pgxpool.Pool, label, sql string, args ...any) {
	t.Helper()

	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("%s: %v", label, err)
	}
}
