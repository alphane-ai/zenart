package task

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

func TestPostgresBatchQuotaLedgerReservesBatchQuota(t *testing.T) {
	db := &batchFakeDB{}
	ledger := NewPostgresBatchQuotaLedger(db)
	batch := validBatchGenerationRequest()
	batch.CreatedAt = time.Date(2026, 6, 21, 16, 0, 0, 0, time.UTC)

	if err := ledger.ReserveBatchQuota(context.Background(), db, batch); err != nil {
		t.Fatalf("ReserveBatchQuota() error = %v", err)
	}
	if len(db.execs) != 3 {
		t.Fatalf("execs = %#v, want insert/update/status", db.execs)
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO quota_transactions") || !strings.Contains(db.execs[0].sql, "'reserve'") {
		t.Fatalf("reserve insert SQL = %s", db.execs[0].sql)
	}
	if db.execs[0].args[1] != batch.QuotaBucketID || db.execs[0].args[3] != batch.QuotaReservationID {
		t.Fatalf("reserve args = %#v", db.execs[0].args)
	}
	if !strings.Contains(db.execs[1].sql, "reserved_units = reserved_units + $1") {
		t.Fatalf("reserve bucket SQL = %s", db.execs[1].sql)
	}
	if !strings.Contains(db.execs[2].sql, "status = 'reserved'") {
		t.Fatalf("reserve status SQL = %s", db.execs[2].sql)
	}
}

func TestPostgresBatchQuotaLedgerCommitAndRefundMoveReservedUnits(t *testing.T) {
	child := validGenerationChildTask("child_1", ChildStatusSucceeded)
	batch := validBatchGenerationRequest()
	db := &batchFakeDB{}
	ledger := NewPostgresBatchQuotaLedger(db)

	if err := ledger.CommitBatchQuota(context.Background(), db, batch, child, 2); err != nil {
		t.Fatalf("CommitBatchQuota() error = %v", err)
	}
	if err := ledger.RefundBatchQuota(context.Background(), db, batch, child, 2); err != nil {
		t.Fatalf("RefundBatchQuota() error = %v", err)
	}
	if len(db.execs) != 6 {
		t.Fatalf("execs = %#v, want 6", db.execs)
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO quota_transactions") || db.execs[0].args[4] != "commit" {
		t.Fatalf("commit insert = %s args=%#v", db.execs[0].sql, db.execs[0].args)
	}
	if !strings.Contains(db.execs[1].sql, "used_units = used_units + $1") {
		t.Fatalf("commit bucket SQL = %s", db.execs[1].sql)
	}
	if !strings.Contains(db.execs[3].sql, "INSERT INTO quota_transactions") || db.execs[3].args[4] != "refund" {
		t.Fatalf("refund insert = %s args=%#v", db.execs[3].sql, db.execs[3].args)
	}
	if strings.Contains(db.execs[4].sql, "used_units = used_units + $1") || !strings.Contains(db.execs[4].sql, "reserved_units = reserved_units - $1") {
		t.Fatalf("refund bucket SQL = %s", db.execs[4].sql)
	}
}

func TestPostgresBatchQuotaLedgerUsesRetryAttemptInChildIdempotency(t *testing.T) {
	child := validGenerationChildTask("child_1", ChildStatusSucceeded)
	child.RetryCount = 1
	batch := validBatchGenerationRequest()
	db := &batchFakeDB{}
	ledger := NewPostgresBatchQuotaLedger(db)

	if err := ledger.CommitBatchQuota(context.Background(), db, batch, child, 2); err != nil {
		t.Fatalf("CommitBatchQuota() error = %v", err)
	}
	if len(db.execs) < 1 {
		t.Fatalf("execs = %#v, want commit insert", db.execs)
	}
	gotKey, _ := db.execs[0].args[3].(string)
	if gotKey != "quota_reservation_1:child_1:attempt:1" {
		t.Fatalf("commit idempotency key = %q, want retry-attempt scoped key", gotKey)
	}
	if BatchChildQuotaIdempotencyKey(batch, child) != gotKey {
		t.Fatalf("BatchChildQuotaIdempotencyKey() drifted from ledger args")
	}
}

func TestPostgresBatchQuotaLedgerResolveMissingBucketIsInsufficient(t *testing.T) {
	db := &batchFakeDB{row: batchFakeRow{err: pgx.ErrNoRows}}
	ledger := NewPostgresBatchQuotaLedger(db)

	_, err := ledger.ResolveBatchQuotaBucket(context.Background(), "tenant_1", "user_1")
	if !errors.Is(err, ErrBatchQuotaInsufficient) {
		t.Fatalf("ResolveBatchQuotaBucket() error = %v, want ErrBatchQuotaInsufficient", err)
	}
}

func TestBatchRepositoryWithQuotaLedgerReservesOnCreate(t *testing.T) {
	db := &batchFakeDB{}
	ledger := &fakeBatchQuotaLedger{bucketID: "quota_bucket_1"}
	repo := NewBatchRepository(db).WithQuotaLedger(ledger)

	batch, err := repo.CreateBatch(context.Background(), BatchCreateInput{
		TenantID:       "tenant_1",
		UserID:         "user_1",
		ProjectID:      "project_1",
		WorkspaceID:    "workspace_1",
		PromptContext:  validBatchGenerationRequest().PromptContext,
		RequestedCount: 1,
	})
	if err != nil {
		t.Fatalf("CreateBatch() error = %v", err)
	}
	if batch.QuotaBucketID != "quota_bucket_1" {
		t.Fatalf("QuotaBucketID = %q", batch.QuotaBucketID)
	}
	if !ledger.reserved {
		t.Fatal("ledger did not reserve batch quota")
	}
	if ledger.reservedBatch.QuotaEstimatedUnits != 4 || ledger.reservedBatch.QuotaReservationID == "" {
		t.Fatalf("reserved batch = %#v", ledger.reservedBatch)
	}
	if db.execs[0].args[9] != "quota_bucket_1" {
		t.Fatalf("insert batch quota bucket arg = %#v", db.execs[0].args)
	}
}

func TestBatchRepositoryWithQuotaLedgerPostgresCreateSmoke(t *testing.T) {
	dsn := os.Getenv("ZENARI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set ZENARI_TEST_DATABASE_URL to run postgres batch create smoke")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer pool.Close()

	repo := NewBatchRepository(store.NewPoolAdapter(pool)).WithQuotaLedger(NewPostgresBatchQuotaLedger(store.NewPoolAdapter(pool)))
	_, err = repo.CreateBatch(ctx, BatchCreateInput{
		TenantID:       "tenant_local",
		UserID:         "user_local_user",
		ProjectID:      "project_local_ecommerce_growth",
		WorkspaceID:    "ws_stage1_smoke",
		PromptContext:  PromptContext{Text: "postgres batch smoke", ModelHints: []string{"image-fast-v1"}, ToolHint: "image.generate"},
		RequestedCount: 1,
		AllowedModels:  []string{"image-fast-v1"},
		IdempotencyKey: "stage1-provider-sandbox-batch_create",
	})
	if err != nil {
		t.Fatalf("CreateBatch() error = %T %v", err, err)
	}
}

type fakeBatchQuotaLedger struct {
	bucketID      string
	reserved      bool
	committed     int64
	refunded      int64
	reservedBatch BatchGenerationRequest
	reserveErr    error
	commitErr     error
	refundErr     error
}

func (l *fakeBatchQuotaLedger) ResolveBatchQuotaBucket(context.Context, string, string) (string, error) {
	return l.bucketID, nil
}

func (l *fakeBatchQuotaLedger) ReserveBatchQuota(_ context.Context, _ store.DBTX, batch BatchGenerationRequest) error {
	if l.reserveErr != nil {
		return l.reserveErr
	}
	l.reserved = true
	l.reservedBatch = batch
	return nil
}

func (l *fakeBatchQuotaLedger) CommitBatchQuota(_ context.Context, _ store.DBTX, _ BatchGenerationRequest, _ GenerationChildTask, units int64) error {
	if l.commitErr != nil {
		return l.commitErr
	}
	l.committed += units
	return nil
}

func (l *fakeBatchQuotaLedger) RefundBatchQuota(_ context.Context, _ store.DBTX, _ BatchGenerationRequest, _ GenerationChildTask, units int64) error {
	if l.refundErr != nil {
		return l.refundErr
	}
	l.refunded += units
	return nil
}
