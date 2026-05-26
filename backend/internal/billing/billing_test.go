package billing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

func TestSubscriptionStateMachine(t *testing.T) {
	if !CanTransitionSubscription("", SubscriptionTrialing) {
		t.Fatal("new subscription should transition to trialing")
	}
	if !CanTransitionSubscription(SubscriptionPastDue, SubscriptionActive) {
		t.Fatal("past_due should transition back to active")
	}
	if CanTransitionSubscription(SubscriptionExpired, SubscriptionPastDue) {
		t.Fatal("expired should not transition to past_due")
	}
}

func TestMockCheckoutProvider(t *testing.T) {
	session, err := (MockCheckoutProvider{}).CreateCheckout(context.Background(), "tenant_1", "user_1", "plan_1")
	if err != nil {
		t.Fatalf("CreateCheckout() error = %v", err)
	}
	if session.Provider != "mock" {
		t.Fatalf("Provider = %q, want mock", session.Provider)
	}
	if session.RedirectURL == "" {
		t.Fatal("RedirectURL must not be empty")
	}
}

func TestEntitlementMiddlewareAllowsDecision(t *testing.T) {
	service := staticEntitlements{decision: EntitlementDecision{Allowed: true, Reason: "ok"}}
	called := false
	handler := EntitlementMiddleware(service, "generate", 10, testPrincipal, testDeny)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/generate", nil))

	if !called {
		t.Fatal("next handler was not called")
	}
}

func TestEntitlementMiddlewareDeniesDecision(t *testing.T) {
	service := staticEntitlements{decision: EntitlementDecision{Allowed: false, Reason: "quota_insufficient"}}
	rec := httptest.NewRecorder()
	handler := EntitlementMiddleware(service, "generate", 10, testPrincipal, testDeny)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("next handler should not be called")
	}))

	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/generate", nil))

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusPaymentRequired)
	}
}

func TestQuotaReserveRejectsNonPositiveUnits(t *testing.T) {
	repo := NewQuotaRepository(&fakeDB{})
	err := repo.Reserve(context.Background(), QuotaReservation{Units: 0})
	if err == nil {
		t.Fatal("Reserve() error = nil, want validation error")
	}
}

func TestQuotaReserveReturnsInsufficientWhenBucketUpdateMisses(t *testing.T) {
	repo := NewQuotaRepository(&fakeDB{rowsAffected: []int64{1, 0}})
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
	db := &fakeDB{rowsAffected: []int64{1, 1, 1}}
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
	if db.execs != 3 {
		t.Fatalf("execs = %d, want 3", db.execs)
	}
}

func TestQuotaReserveRetryIsNoop(t *testing.T) {
	db := &fakeDB{rowsAffected: []int64{0}}
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
		t.Fatalf("Reserve() retry error = %v", err)
	}
	if db.execs != 1 {
		t.Fatalf("execs = %d, want 1", db.execs)
	}
}

func TestQuotaCommitMovesReservedUnits(t *testing.T) {
	db := &fakeDB{rowsAffected: []int64{1, 1, 1}}
	repo := NewQuotaRepository(db)

	err := repo.Commit(context.Background(), "tenant_1", "bucket_1", "idem_1", 25)
	if err != nil {
		t.Fatalf("Commit() error = %v", err)
	}
	if db.execs != 3 {
		t.Fatalf("execs = %d, want 3", db.execs)
	}
}

func TestQuotaRefundMovesReservedUnits(t *testing.T) {
	db := &fakeDB{rowsAffected: []int64{1, 1, 1}}
	repo := NewQuotaRepository(db)

	err := repo.Refund(context.Background(), "tenant_1", "bucket_1", "idem_1", 25)
	if err != nil {
		t.Fatalf("Refund() error = %v", err)
	}
	if db.execs != 3 {
		t.Fatalf("execs = %d, want 3", db.execs)
	}
}

func TestAdminCreditDebitAdjustQuota(t *testing.T) {
	db := &fakeDB{rowsAffected: []int64{1, 1, 1, 1, 1, 1}}
	repo := NewQuotaRepository(db)

	if err := repo.AdminCredit(context.Background(), "tenant_1", "bucket_1", "credit_1", 50); err != nil {
		t.Fatalf("AdminCredit() error = %v", err)
	}
	if err := repo.AdminDebit(context.Background(), "tenant_1", "bucket_1", "debit_1", 25); err != nil {
		t.Fatalf("AdminDebit() error = %v", err)
	}
	if db.execs != 6 {
		t.Fatalf("execs = %d, want 6", db.execs)
	}
}

type fakeDB struct {
	rowsAffected []int64
	execs        int
}

type staticEntitlements struct {
	decision EntitlementDecision
	err      error
}

func (s staticEntitlements) Check(context.Context, EntitlementRequest) (EntitlementDecision, error) {
	return s.decision, s.err
}

func testPrincipal(*http.Request) (string, string, bool) {
	return "tenant_1", "user_1", true
}

func testDeny(w http.ResponseWriter, _ *http.Request, _ EntitlementDecision) {
	http.Error(w, "denied", http.StatusPaymentRequired)
}

func (f *fakeDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	f.execs++
	rowsAffected := int64(1)
	if len(f.rowsAffected) >= f.execs {
		rowsAffected = f.rowsAffected[f.execs-1]
	}
	return pgconn.NewCommandTag(fmt.Sprintf("UPDATE %d", rowsAffected)), nil
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
