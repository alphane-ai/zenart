package billing

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

func TestQuotaReserveRejectsNonPositiveUnits(t *testing.T) {
	repo := NewQuotaRepository(&fakeDB{})
	err := repo.Reserve(context.Background(), QuotaReservation{Units: 0})
	if err == nil {
		t.Fatal("Reserve() error = nil, want validation error")
	}
}

func TestQuotaReserveReturnsInsufficientWhenBucketUpdateMisses(t *testing.T) {
	repo := NewQuotaRepository(&fakeDB{rowsAffected: 0})
	err := repo.Reserve(context.Background(), QuotaReservation{
		ID:             "reservation_1",
		TenantID:       "tenant_1",
		BucketID:       "bucket_1",
		IdempotencyKey: "idem_1",
		Units:          100,
		CreatedAt:      time.Now(),
	})
	if !errors.Is(err, ErrQuotaInsufficient) {
		t.Fatalf("Reserve() error = %v, want ErrQuotaInsufficient", err)
	}
}

func TestQuotaReserveRecordsTransactionAfterSuccessfulBucketUpdate(t *testing.T) {
	db := &fakeDB{rowsAffected: 1}
	repo := NewQuotaRepository(db)
	err := repo.Reserve(context.Background(), QuotaReservation{
		ID:             "reservation_1",
		TenantID:       "tenant_1",
		BucketID:       "bucket_1",
		IdempotencyKey: "idem_1",
		Units:          100,
		CreatedAt:      time.Now(),
	})
	if err != nil {
		t.Fatalf("Reserve() error = %v", err)
	}
	if db.execs != 2 {
		t.Fatalf("execs = %d, want 2", db.execs)
	}
}

func TestQuotaCommitMovesReservedUnits(t *testing.T) {
	db := &fakeDB{rowsAffected: 1}
	repo := NewQuotaRepository(db)

	err := repo.Commit(context.Background(), "tenant_1", "bucket_1", "idem_1", 25)
	if err != nil {
		t.Fatalf("Commit() error = %v", err)
	}
	if db.execs != 2 {
		t.Fatalf("execs = %d, want 2", db.execs)
	}
}

func TestQuotaRefundMovesReservedUnits(t *testing.T) {
	db := &fakeDB{rowsAffected: 1}
	repo := NewQuotaRepository(db)

	err := repo.Refund(context.Background(), "tenant_1", "bucket_1", "idem_1", 25)
	if err != nil {
		t.Fatalf("Refund() error = %v", err)
	}
	if db.execs != 2 {
		t.Fatalf("execs = %d, want 2", db.execs)
	}
}

type fakeDB struct {
	rowsAffected int64
	execs        int
}

func (f *fakeDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	f.execs++
	return pgconn.NewCommandTag(fmt.Sprintf("UPDATE %d", f.rowsAffected)), nil
}

func (f *fakeDB) Query(context.Context, string, ...any) (store.Rows, error) {
	return fakeRows{}, nil
}

func (f *fakeDB) QueryRow(context.Context, string, ...any) store.Row {
	return fakeRow{}
}

type fakeRow struct{}

func (fakeRow) Scan(...any) error {
	return nil
}

type fakeRows struct{}

func (fakeRows) Close() {}

func (fakeRows) Err() error {
	return nil
}

func (fakeRows) Next() bool {
	return false
}

func (fakeRows) Scan(...any) error {
	return nil
}
