package billing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestSpendControl(t *testing.T) {
	if decision := (SpendControl{KillSwitch: true}).Check(1); decision.Allowed || decision.Reason != "kill_switch_enabled" {
		t.Fatalf("kill switch decision = %+v", decision)
	}
	if decision := (SpendControl{DailyCapUnits: 10, SpentToday: 9}).Check(2); decision.Allowed || decision.Reason != "daily_spend_cap_exceeded" {
		t.Fatalf("daily cap decision = %+v", decision)
	}
	if decision := (SpendControl{DailyCapUnits: 10, SpentToday: 9}).Check(1); !decision.Allowed {
		t.Fatalf("allowed decision = %+v", decision)
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

func TestResetWeeklyQuota(t *testing.T) {
	db := &fakeDB{rowsAffected: []int64{2}}
	repo := NewQuotaRepository(db)
	if err := repo.ResetWeekly(context.Background(), time.Date(2026, 5, 26, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("ResetWeekly() error = %v", err)
	}
	if db.execs != 1 {
		t.Fatalf("execs = %d, want 1", db.execs)
	}
}

func TestRecordProviderUsagePersistsLog(t *testing.T) {
	db := &fakeDB{}
	repo := NewQuotaRepository(db)
	err := repo.RecordProviderUsage(context.Background(), ProviderUsageLog{
		ID:              "usage_1",
		TenantID:        "tenant_1",
		UserID:          "user_1",
		ProjectID:       "project_1",
		TaskID:          "task_1",
		ProviderID:      "dev",
		ModelID:         "dev-echo-v1",
		EndpointVersion: "v1",
		RequestHash:     "hash_1",
		UsageUnits:      12,
		CostCents:       34,
		Metadata:        map[string]any{"trace_id": "trace_1"},
		CreatedAt:       time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("RecordProviderUsage() error = %v", err)
	}
	if db.execs != 1 {
		t.Fatalf("execs = %d, want 1", db.execs)
	}
	if !strings.Contains(db.execSQL[0], "INSERT INTO provider_usage_logs") {
		t.Fatalf("provider usage insert SQL = %s", db.execSQL[0])
	}
	if db.execArgs[0][11] != "recorded" {
		t.Fatalf("status arg = %#v, want recorded", db.execArgs[0][11])
	}
}

func TestRecordProviderUsageValidatesIdentityAndUnits(t *testing.T) {
	repo := NewQuotaRepository(&fakeDB{})
	if err := repo.RecordProviderUsage(context.Background(), ProviderUsageLog{UsageUnits: -1}); err == nil {
		t.Fatal("RecordProviderUsage() error = nil, want validation error")
	}
}

func TestReconcileProviderUsageDebitsQuotaForUnderAccountedActualUsage(t *testing.T) {
	db := &fakeDB{
		rowsAffected: []int64{1, 1, 2},
		queryRows: []fakeQueryRow{
			{values: []any{int64(15), int64(42), int64(2)}},
			{values: []any{int64(10)}},
		},
	}
	repo := NewQuotaRepository(db)

	reconciliation, err := repo.ReconcileProviderUsage(context.Background(), "tenant_1", "bucket_1", "task_1", "generate_1")
	if err != nil {
		t.Fatalf("ReconcileProviderUsage() error = %v", err)
	}
	if reconciliation.ActualUsageUnits != 15 || reconciliation.AccountedQuotaUnits != 10 {
		t.Fatalf("reconciliation usage = %+v", reconciliation)
	}
	if reconciliation.AdjustmentKind != "provider_usage_debit" || reconciliation.AdjustedUnits != 5 {
		t.Fatalf("adjustment = %s/%d, want provider_usage_debit/5", reconciliation.AdjustmentKind, reconciliation.AdjustedUnits)
	}
	if db.execs != 3 {
		t.Fatalf("execs = %d, want 3", db.execs)
	}
	if !strings.Contains(db.execSQL[0], "INSERT INTO quota_transactions") {
		t.Fatalf("adjustment SQL = %s", db.execSQL[0])
	}
	if db.execArgs[0][4] != "provider_usage_debit" {
		t.Fatalf("adjustment kind arg = %#v, want provider_usage_debit", db.execArgs[0][4])
	}
	if !strings.Contains(db.execSQL[1], "used_units = used_units + $1") {
		t.Fatalf("bucket debit SQL = %s", db.execSQL[1])
	}
	if !strings.Contains(db.execSQL[2], "UPDATE provider_usage_logs") {
		t.Fatalf("provider usage status SQL = %s", db.execSQL[2])
	}
}

func TestReconcileProviderUsageCreditsQuotaForOverAccountedUsage(t *testing.T) {
	db := &fakeDB{
		rowsAffected: []int64{1, 1, 1},
		queryRows: []fakeQueryRow{
			{values: []any{int64(7), int64(0), int64(1)}},
			{values: []any{int64(10)}},
		},
	}
	repo := NewQuotaRepository(db)

	reconciliation, err := repo.ReconcileProviderUsage(context.Background(), "tenant_1", "bucket_1", "task_1", "generate_1")
	if err != nil {
		t.Fatalf("ReconcileProviderUsage() error = %v", err)
	}
	if reconciliation.AdjustmentKind != "provider_usage_credit" || reconciliation.AdjustedUnits != 3 {
		t.Fatalf("adjustment = %s/%d, want provider_usage_credit/3", reconciliation.AdjustmentKind, reconciliation.AdjustedUnits)
	}
	if !strings.Contains(db.execSQL[1], "used_units = used_units - $1") {
		t.Fatalf("bucket credit SQL = %s", db.execSQL[1])
	}
}

func TestReconcileProviderUsageReturnsMissingWhenNoLogsExist(t *testing.T) {
	db := &fakeDB{queryRows: []fakeQueryRow{{values: []any{int64(0), int64(0), int64(0)}}}}
	repo := NewQuotaRepository(db)

	_, err := repo.ReconcileProviderUsage(context.Background(), "tenant_1", "bucket_1", "task_1", "generate_1")
	if !errors.Is(err, ErrProviderUsageMissing) {
		t.Fatalf("ReconcileProviderUsage() error = %v, want ErrProviderUsageMissing", err)
	}
	if db.execs != 0 {
		t.Fatalf("missing usage should not write rows: %d", db.execs)
	}
}

type fakeDB struct {
	rowsAffected []int64
	execs        int
	execSQL      []string
	execArgs     [][]any
	queryRows    []fakeQueryRow
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

func (f *fakeDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execs++
	f.execSQL = append(f.execSQL, sql)
	f.execArgs = append(f.execArgs, args)
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
	if len(f.queryRows) == 0 {
		return fakeQueryRow{}
	}
	row := f.queryRows[0]
	f.queryRows = f.queryRows[1:]
	return row
}

type fakeQueryRow struct {
	values []any
	err    error
}

func (r fakeQueryRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i := range dest {
		assign(dest[i], r.values[i])
	}
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

func assign(dest any, value any) {
	switch ptr := dest.(type) {
	case *int64:
		*ptr = value.(int64)
	default:
		panic("unsupported scan destination")
	}
}
