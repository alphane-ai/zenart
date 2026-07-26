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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
)

const billingStripeSecretFixture = "sk_test_" + "abcdefghijklmnopqrstuvwxyz123456"

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

func TestAdminBillingRepositoryManualCreditRecordsOperationAndQuotaCredit(t *testing.T) {
	db := &fakeDB{rowsAffected: []int64{1, 1, 1, 1, 1}}
	repo := NewAdminBillingRepository(db)

	result, err := repo.ManualCredit(context.Background(), AdminBillingOperationInput{
		TenantID:       "tenant_1",
		ActorID:        "admin_1",
		TargetUserID:   "user_1",
		BucketID:       "bucket_1",
		Units:          50,
		IdempotencyKey: "manual_credit_1",
		Rationale:      "restore quota after billing adjustment",
		RequestedAt:    time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("ManualCredit() error = %v", err)
	}
	if result.Operation != AdminBillingOperationManualCredit || result.Status != "succeeded" || result.Units != 50 {
		t.Fatalf("result = %#v, want succeeded manual credit", result)
	}
	if db.execs != 5 {
		t.Fatalf("execs = %d, want operation insert, quota credit, and operation status update", db.execs)
	}
	if !strings.Contains(db.execSQL[0], "INSERT INTO billing_admin_operations") {
		t.Fatalf("admin operation insert SQL = %s", db.execSQL[0])
	}
	if !strings.Contains(db.execSQL[1], "INSERT INTO quota_transactions") || db.execArgs[1][4] != "admin_credit" {
		t.Fatalf("quota credit SQL/args = %s %#v", db.execSQL[1], db.execArgs[1])
	}
	if !strings.Contains(db.execSQL[4], "UPDATE billing_admin_operations") || db.execArgs[4][0] != "succeeded" {
		t.Fatalf("operation status SQL/args = %s %#v", db.execSQL[4], db.execArgs[4])
	}
}

func TestAdminBillingRepositoryRedactsMetadataBeforePersistence(t *testing.T) {
	db := &fakeDB{rowsAffected: []int64{1, 1}}
	repo := NewAdminBillingRepository(db)

	_, err := repo.RecordRefundNote(context.Background(), AdminBillingOperationInput{
		TenantID:       "tenant_1",
		ActorID:        "admin_1",
		TargetUserID:   "user_1",
		IdempotencyKey: "refund_note_1",
		Rationale:      "customer refund review",
		Note:           "manual credit already issued",
		Metadata: map[string]any{
			"stripe_token": billingStripeSecretFixture,
			"ticket_id":    "ticket_1",
		},
	})
	if err != nil {
		t.Fatalf("RecordRefundNote() error = %v", err)
	}
	metadata, ok := db.execArgs[0][13].([]byte)
	if !ok {
		t.Fatalf("metadata arg = %T, want []byte", db.execArgs[0][13])
	}
	if strings.Contains(string(metadata), billingStripeSecretFixture) {
		t.Fatalf("metadata persisted raw secret: %s", string(metadata))
	}
	if !strings.Contains(string(metadata), `"ticket_id":"ticket_1"`) {
		t.Fatalf("metadata = %s, want non-secret ticket id retained", string(metadata))
	}
}

func TestTeamSeatBillingRepositorySkipsWhenTeamHasNoBillingLink(t *testing.T) {
	db := &fakeDB{queryRows: []fakeQueryRow{
		{err: pgx.ErrNoRows},
		{err: pgx.ErrNoRows},
	}}
	repo := NewTeamSeatBillingRepository(db, &fakeTeamSeatBillingProvider{})
	repo.Now = func() time.Time {
		return time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	}

	result, err := repo.SyncTeamSeatQuantity(context.Background(), TeamSeatSyncInput{
		TenantID:       "tenant_1",
		TeamID:         "team_1",
		ActorID:        "admin_1",
		Operation:      "team.invite",
		IdempotencyKey: "team-invite-1",
		Rationale:      "reserve launch seat",
		Usage: TeamSeatUsageSnapshot{
			PlanID:         "plan_pro",
			SeatLimit:      5,
			ActiveSeats:    2,
			InvitedSeats:   1,
			BillableSeats:  3,
			AvailableSeats: 2,
		},
	})
	if err != nil {
		t.Fatalf("SyncTeamSeatQuantity() error = %v", err)
	}
	if result.Status != "skipped" || result.Reason != "team_billing_link_missing" || result.RequestedQuantity != 3 {
		t.Fatalf("result = %#v, want skipped missing link", result)
	}
	if db.execs != 1 || !strings.Contains(db.execSQL[0], "INSERT INTO team_seat_billing_syncs") {
		t.Fatalf("execs/sql = %d %v", db.execs, db.execSQL)
	}
	if db.execArgs[0][10] != "skipped" || db.execArgs[0][11] != "team_billing_link_missing" {
		t.Fatalf("sync insert args = %#v", db.execArgs[0])
	}
}

func TestTeamSeatBillingRepositorySyncsProviderAndPersistsLedger(t *testing.T) {
	provider := &fakeTeamSeatBillingProvider{}
	db := &fakeDB{queryRows: []fakeQueryRow{
		{err: pgx.ErrNoRows},
		{values: []any{"tenant_1", "team_1", "stripe", "sub_test_001", "si_test_team_seats", "price_team_seat", "always_invoice", "active", []byte(`{}`), time.Date(2026, 6, 22, 9, 0, 0, 0, time.UTC), time.Date(2026, 6, 22, 9, 0, 0, 0, time.UTC)}},
	}}
	repo := NewTeamSeatBillingRepository(db, provider)
	repo.Now = func() time.Time {
		return time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	}

	result, err := repo.SyncTeamSeatQuantity(context.Background(), TeamSeatSyncInput{
		TenantID:       "tenant_1",
		TeamID:         "team_1",
		ActorID:        "admin_1",
		Operation:      "team.member.remove",
		IdempotencyKey: "team-remove-1",
		Rationale:      "remove stale paid seat",
		Usage: TeamSeatUsageSnapshot{
			PlanID:         "plan_pro",
			SeatLimit:      5,
			ActiveSeats:    2,
			InvitedSeats:   0,
			BillableSeats:  2,
			AvailableSeats: 3,
		},
	})
	if err != nil {
		t.Fatalf("SyncTeamSeatQuantity() error = %v", err)
	}
	if !provider.called ||
		provider.request.ProviderSubscriptionItemID != "si_test_team_seats" ||
		provider.request.Quantity != 2 ||
		provider.request.ProrationBehavior != "always_invoice" ||
		provider.request.IdempotencyKey != "team-remove-1" {
		t.Fatalf("provider request = %#v called=%v", provider.request, provider.called)
	}
	if result.Status != "synced" || result.Provider != "stripe" || result.SyncedQuantity != 2 {
		t.Fatalf("result = %#v", result)
	}
	if db.execs != 1 || !strings.Contains(db.execSQL[0], "INSERT INTO team_seat_billing_syncs") {
		t.Fatalf("execs/sql = %d %v", db.execs, db.execSQL)
	}
	if db.execArgs[0][7] != 2 || db.execArgs[0][8] != 2 || db.execArgs[0][10] != "synced" {
		t.Fatalf("sync insert args = %#v", db.execArgs[0])
	}
}

func TestTeamSeatBillingRepositoryUpsertsBillingLinkAndRedactsMetadata(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryRows: []fakeQueryRow{
			{values: []any{"tenant_1", "team_1", "stripe", "sub_test_001", "si_test_team_seats", "price_team_seat", "always_invoice", "active", []byte(`{"ticket_id":"ticket_1"}`), now, now}},
		},
	}
	repo := NewTeamSeatBillingRepository(db, &fakeTeamSeatBillingProvider{})
	repo.Now = func() time.Time { return now }

	link, err := repo.UpsertTeamBillingLink(context.Background(), TeamBillingLinkInput{
		TenantID:                   "tenant_1",
		TeamID:                     "team_1",
		ActorID:                    "admin_1",
		Provider:                   "stripe",
		ProviderSubscriptionID:     "sub_test_001",
		ProviderSubscriptionItemID: "si_test_team_seats",
		PriceID:                    "price_team_seat",
		ProrationBehavior:          "always_invoice",
		Status:                     "active",
		Rationale:                  "bind paid team to Stripe subscription item",
		IdempotencyKey:             "team-link-1",
		Metadata: map[string]any{
			"ticket_id":     "ticket_1",
			"stripe_secret": billingStripeSecretFixture,
		},
	})
	if err != nil {
		t.Fatalf("UpsertTeamBillingLink() error = %v", err)
	}
	if link.ProviderSubscriptionItemID != "si_test_team_seats" || link.Status != "active" || link.Metadata["ticket_id"] != "ticket_1" {
		t.Fatalf("link = %#v", link)
	}
	if db.execs != 2 {
		t.Fatalf("execs = %d, want pause old active and upsert", db.execs)
	}
	if !strings.Contains(db.execSQL[0], "UPDATE team_billing_links") || !strings.Contains(db.execSQL[1], "INSERT INTO team_billing_links") {
		t.Fatalf("sql = %#v", db.execSQL)
	}
	metadata, ok := db.execArgs[1][8].([]byte)
	if !ok {
		t.Fatalf("metadata arg = %T", db.execArgs[1][8])
	}
	if strings.Contains(string(metadata), billingStripeSecretFixture) || !strings.Contains(string(metadata), security.Redacted) {
		t.Fatalf("metadata not redacted: %s", string(metadata))
	}
}

func TestTeamSeatBillingRepositoryListsSeatSyncs(t *testing.T) {
	createdAt := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeDB{queryResults: []fakeRows{{rows: [][]any{
		{"team_seat_sync_1", "tenant_1", "team_1", "stripe", "sub_test_001", "si_test_team_seats", "price_team_seat", 3, 3, "create_prorations", "synced", "", "team.invite", "team-invite-1", createdAt},
	}}}}
	repo := NewTeamSeatBillingRepository(db, &fakeTeamSeatBillingProvider{})

	page, err := repo.ListTeamSeatBillingSyncs(context.Background(), "tenant_1", "team_1", 10)
	if err != nil {
		t.Fatalf("ListTeamSeatBillingSyncs() error = %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != "team_seat_sync_1" || page.Items[0].SyncedQuantity != 3 {
		t.Fatalf("page = %#v", page)
	}
	if len(db.queryArgs) != 1 || db.queryArgs[0][0] != "tenant_1" || db.queryArgs[0][1] != "team_1" || db.queryArgs[0][2] != 10 {
		t.Fatalf("query args = %#v", db.queryArgs)
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
	if db.execArgs[0][5] != "agent_task" {
		t.Fatalf("task ref type arg = %#v, want agent_task", db.execArgs[0][5])
	}
	if db.execArgs[0][12] != "recorded" {
		t.Fatalf("status arg = %#v, want recorded", db.execArgs[0][12])
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

func TestProviderCostReconcilerDebitsQuotaFlagsOutliersAndManualReview(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryResults: []fakeRows{{rows: [][]any{
			{
				"child_reconcile_debit_1",
				"batch_cost_1",
				"zenari-image-sandbox",
				"image-fast-v1",
				int64(1),
				int64(15),
				int64(120),
				int64(8),
				int64(40),
				"USD",
				"quota_reservation_cost_1:child_reconcile_debit_1",
			},
			{
				"child_manual_review_1",
				"batch_cost_1",
				"zenari-image-sandbox",
				"image-fast-v1",
				int64(1),
				int64(3),
				int64(10),
				int64(8),
				int64(40),
				"USD",
				"",
			},
		}}},
		queryRows: []fakeQueryRow{
			{values: []any{int64(15), int64(120), int64(1)}},
			{values: []any{int64(10)}},
		},
	}
	reconciler := NewProviderCostReconciler(db)
	reconciler.Now = func() time.Time { return now }

	report, err := reconciler.ReconcileProviderCost(context.Background(), ProviderCostReconciliationInput{
		TenantID:            "tenant_1",
		BucketID:            "bucket_1",
		Since:               now.Add(-24 * time.Hour),
		Until:               now,
		DailySpendCapCents:  100,
		OutlierCostMultiple: 2,
	})
	if err != nil {
		t.Fatalf("ReconcileProviderCost() error = %v", err)
	}
	if report.TaskCount != 2 || report.ReconciledCount != 1 || report.ManualReviewCount != 1 || report.OutlierCount != 1 {
		t.Fatalf("report counts = %#v", report)
	}
	if report.TotalCostCents != 130 || !report.SpendCapExceeded || report.ReleaseGateStatus != "contract_ready_staging_provider_invoice_usage_evidence_open" {
		t.Fatalf("report spend/status = %#v", report)
	}
	reconciled := report.Tasks[0]
	if reconciled.Status != "reconciled" || reconciled.AdjustmentKind != "provider_usage_debit" || reconciled.AdjustedUnits != 5 || !reconciled.UsageOutlier || !reconciled.SpendCapExceeded {
		t.Fatalf("reconciled task = %#v", reconciled)
	}
	manual := report.Tasks[1]
	if manual.Status != "manual_review" || manual.Reason != "quota_idempotency_key_missing" {
		t.Fatalf("manual review task = %#v", manual)
	}
	if len(db.querySQL) != 1 || !strings.Contains(db.querySQL[0], "provider_model_capabilities") || !strings.Contains(db.querySQL[0], "metadata->>'quota_idempotency_key'") {
		t.Fatalf("provider cost query = %#v", db.querySQL)
	}
	if db.execs != 5 {
		t.Fatalf("execs = %d, want provider usage adjustment plus two provider cost markers", db.execs)
	}
	if db.execArgs[3][0] != "tenant_1" || db.execArgs[3][1] != "child_reconcile_debit_1" {
		t.Fatalf("reconciled marker args = %#v", db.execArgs[3])
	}
	if db.execArgs[4][0] != "tenant_1" || db.execArgs[4][1] != "child_manual_review_1" {
		t.Fatalf("manual marker args = %#v", db.execArgs[4])
	}
}

func TestProviderCostReconcilerRequiresScopeAndWindow(t *testing.T) {
	reconciler := NewProviderCostReconciler(&fakeDB{})
	_, err := reconciler.ReconcileProviderCost(context.Background(), ProviderCostReconciliationInput{TenantID: "tenant_1", BucketID: "bucket_1", Since: time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC), Until: time.Date(2026, 6, 22, 9, 0, 0, 0, time.UTC)})
	if err == nil {
		t.Fatal("ReconcileProviderCost() error = nil, want invalid window error")
	}
	_, err = reconciler.ReconcileProviderCost(context.Background(), ProviderCostReconciliationInput{})
	if err == nil {
		t.Fatal("ReconcileProviderCost() error = nil, want missing scope error")
	}
}

func TestAccountRepositoryReadsQuotaStateForTenantUser(t *testing.T) {
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryResults: []fakeRows{
			{rows: [][]any{{"quota_1", int64(100), int64(25), int64(5), now.Add(24 * time.Hour)}}},
			{rows: [][]any{{"txn_1", "commit", int64(4), "committed", now}}},
		},
	}
	repo := NewAccountRepository(db)

	state, err := repo.GetQuotaState(context.Background(), "tenant_1", "user_1")
	if err != nil {
		t.Fatalf("GetQuotaState() error = %v", err)
	}
	if len(state.Buckets) != 1 || state.Buckets[0].ID != "quota_1" || state.Buckets[0].ReservedUnits != 5 {
		t.Fatalf("buckets = %#v", state.Buckets)
	}
	if len(state.Transactions) != 1 || state.Transactions[0].Kind != "commit" || state.Transactions[0].Units != 4 {
		t.Fatalf("transactions = %#v", state.Transactions)
	}
	if len(db.querySQL) != 2 || !strings.Contains(db.querySQL[0], "subject_type = 'user'") || !strings.Contains(db.querySQL[1], "JOIN quota_buckets") {
		t.Fatalf("queries = %#v", db.querySQL)
	}
	if db.queryArgs[0][0] != "tenant_1" || db.queryArgs[0][1] != "user_1" || db.queryArgs[1][0] != "tenant_1" || db.queryArgs[1][1] != "user_1" {
		t.Fatalf("query args = %#v", db.queryArgs)
	}
}

func TestAccountRepositoryReadsLatestSubscription(t *testing.T) {
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryRows: []fakeQueryRow{{values: []any{"sub_1", "plan_pro", SubscriptionActive, start, &end, "stripe", "sub_test_001", "cus_test_001"}}},
	}
	repo := NewAccountRepository(db)

	sub, err := repo.GetSubscription(context.Background(), "tenant_1", "user_1")
	if err != nil {
		t.Fatalf("GetSubscription() error = %v", err)
	}
	if sub.ID != "sub_1" || sub.PlanID != "plan_pro" || sub.Status != SubscriptionActive || sub.CurrentPeriodEnd == nil || !sub.CurrentPeriodEnd.Equal(end) {
		t.Fatalf("subscription = %#v", sub)
	}
	if sub.Provider != "stripe" || sub.ProviderRef != "sub_test_001" || sub.ProviderCustomerID != "cus_test_001" {
		t.Fatalf("subscription provider refs = %#v", sub)
	}
	if len(db.queryRowSQL) != 1 || !strings.Contains(db.queryRowSQL[0], "FROM user_subscriptions") {
		t.Fatalf("query row sql = %#v", db.queryRowSQL)
	}
	if db.queryRowArgs[0][0] != "tenant_1" || db.queryRowArgs[0][1] != "user_1" {
		t.Fatalf("query row args = %#v", db.queryRowArgs)
	}
}

func TestAccountRepositoryMapsMissingSubscription(t *testing.T) {
	db := &fakeDB{queryRows: []fakeQueryRow{{err: pgx.ErrNoRows}}}
	repo := NewAccountRepository(db)

	_, err := repo.GetSubscription(context.Background(), "tenant_1", "user_1")
	if !errors.Is(err, ErrSubscriptionNotFound) {
		t.Fatalf("GetSubscription() error = %v, want ErrSubscriptionNotFound", err)
	}
}

func TestStripeLifecycleReconcilerReportsPaidPastDueCancelRefundCreditAndQuotaReset(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	periodStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	periodEnd := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	resetAt := now.Add(7 * 24 * time.Hour)
	db := &fakeDB{
		rowsAffected: []int64{3},
		queryRows: []fakeQueryRow{
			{values: []any{"stripe:sub_test_001", "plan_pro", SubscriptionPastDue, periodStart, &periodEnd, "stripe", "sub_test_001", "cus_test_001"}},
			{values: []any{"monthly_generation", int64(120), int64(30), int64(0), resetAt}},
		},
		queryResults: []fakeRows{
			{rows: [][]any{
				{"checkout.session.completed", SubscriptionActive, int64(1), int64(1), int64(0), int64(0)},
				{"invoice.paid", SubscriptionActive, int64(1), int64(1), int64(0), int64(0)},
				{"invoice.payment_failed", SubscriptionPastDue, int64(1), int64(1), int64(0), int64(0)},
				{"customer.subscription.deleted", SubscriptionCancelled, int64(1), int64(1), int64(0), int64(0)},
			}},
			{rows: [][]any{
				{string(AdminBillingOperationRefundNote), "recorded", int64(1), int64(0), "stripe", "re_test_001"},
				{string(AdminBillingOperationManualCredit), "succeeded", int64(1), int64(25), "stripe", "re_test_001"},
			}},
			{rows: [][]any{
				{"admin_credit", "committed", int64(1), int64(25)},
				{"commit", "committed", int64(3), int64(30)},
			}},
		},
	}
	reconciler := NewStripeLifecycleReconciler(db)
	reconciler.Now = func() time.Time { return now }

	report, err := reconciler.ReconcileStripeLifecycle(context.Background(), StripeLifecycleReconciliationInput{
		TenantID:               "tenant_1",
		UserID:                 "user_1",
		BucketID:               "monthly_generation",
		ProviderSubscriptionID: "sub_test_001",
		Since:                  now.Add(-24 * time.Hour),
		Until:                  now.Add(time.Hour),
		ResetDueQuotas:         true,
	})
	if err != nil {
		t.Fatalf("ReconcileStripeLifecycle() error = %v", err)
	}
	if !report.CheckoutSeen || !report.InvoicePaidSeen || !report.PaymentFailedSeen || !report.CancelSeen || !report.RefundCreditSeen || !report.QuotaCreditSeen {
		t.Fatalf("lifecycle flags = checkout %v invoice %v failed %v cancel %v refund %v credit %v", report.CheckoutSeen, report.InvoicePaidSeen, report.PaymentFailedSeen, report.CancelSeen, report.RefundCreditSeen, report.QuotaCreditSeen)
	}
	if !report.WebhookReplayIdempotent || !report.QuotaProjectionValid || !report.QuotaResetInvoked || !report.ReadyForStagingEvidence {
		t.Fatalf("readiness flags = replay %v quota %v reset %v staging %v", report.WebhookReplayIdempotent, report.QuotaProjectionValid, report.QuotaResetInvoked, report.ReadyForStagingEvidence)
	}
	if report.SecretMaterialProjected {
		t.Fatal("SecretMaterialProjected = true, want false")
	}
	if report.ReleaseGateStatus != "contract_ready_staging_stripe_lifecycle_evidence_open" {
		t.Fatalf("release gate status = %q", report.ReleaseGateStatus)
	}
	if len(report.SubscriptionStatusesSeen) != 3 || report.SubscriptionStatusesSeen[0] != SubscriptionActive || report.SubscriptionStatusesSeen[1] != SubscriptionPastDue || report.SubscriptionStatusesSeen[2] != SubscriptionCancelled {
		t.Fatalf("statuses seen = %#v", report.SubscriptionStatusesSeen)
	}
	if db.execs != 1 || !strings.Contains(db.execSQL[0], "UPDATE quota_buckets") || !strings.Contains(db.execSQL[0], "WHERE period = 'weekly'") {
		t.Fatalf("quota reset exec = %d %v", db.execs, db.execSQL)
	}
	if len(db.querySQL) != 3 ||
		!strings.Contains(db.querySQL[0], "FROM stripe_webhook_events") ||
		!strings.Contains(db.querySQL[1], "FROM billing_admin_operations") ||
		!strings.Contains(db.querySQL[2], "FROM quota_transactions") {
		t.Fatalf("query SQL = %#v", db.querySQL)
	}
	if len(db.queryRowSQL) != 2 ||
		!strings.Contains(db.queryRowSQL[0], "FROM user_subscriptions") ||
		!strings.Contains(db.queryRowSQL[1], "FROM quota_buckets") {
		t.Fatalf("query row SQL = %#v", db.queryRowSQL)
	}
}

func TestStripeLifecycleReconcilerRejectsMissingScopeAndInvalidWindow(t *testing.T) {
	reconciler := NewStripeLifecycleReconciler(&fakeDB{})
	_, err := reconciler.ReconcileStripeLifecycle(context.Background(), StripeLifecycleReconciliationInput{})
	if err == nil {
		t.Fatal("ReconcileStripeLifecycle() error = nil, want missing scope error")
	}
	_, err = reconciler.ReconcileStripeLifecycle(context.Background(), StripeLifecycleReconciliationInput{
		TenantID: "tenant_1",
		UserID:   "user_1",
		BucketID: "monthly_generation",
		Since:    time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC),
		Until:    time.Date(2026, 6, 22, 9, 0, 0, 0, time.UTC),
	})
	if err == nil {
		t.Fatal("ReconcileStripeLifecycle() error = nil, want invalid window error")
	}
}

type fakeDB struct {
	rowsAffected []int64
	execs        int
	execSQL      []string
	execArgs     [][]any
	queryRows    []fakeQueryRow
	queryResults []fakeRows
	querySQL     []string
	queryArgs    [][]any
	queryRowSQL  []string
	queryRowArgs [][]any
}

type staticEntitlements struct {
	decision EntitlementDecision
	err      error
}

func (s staticEntitlements) Check(context.Context, EntitlementRequest) (EntitlementDecision, error) {
	return s.decision, s.err
}

type fakeTeamSeatBillingProvider struct {
	called  bool
	request TeamSeatProviderRequest
	err     error
}

func (p *fakeTeamSeatBillingProvider) SyncTeamSeatQuantity(_ context.Context, request TeamSeatProviderRequest) (TeamSeatSyncResult, error) {
	p.called = true
	p.request = request
	if p.err != nil {
		return TeamSeatSyncResult{}, p.err
	}
	return TeamSeatSyncResult{
		ID:                         teamSeatSyncID(request.TenantID, request.TeamID, request.Operation, request.IdempotencyKey),
		TenantID:                   request.TenantID,
		TeamID:                     request.TeamID,
		Provider:                   "stripe",
		ProviderSubscriptionID:     request.ProviderSubscriptionID,
		ProviderSubscriptionItemID: request.ProviderSubscriptionItemID,
		PriceID:                    request.PriceID,
		RequestedQuantity:          request.Quantity,
		SyncedQuantity:             request.Quantity,
		ProrationBehavior:          request.ProrationBehavior,
		Status:                     "synced",
		Operation:                  request.Operation,
		IdempotencyKey:             request.IdempotencyKey,
		CreatedAt:                  request.RequestedAt,
	}, nil
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

func (f *fakeDB) Query(_ context.Context, sql string, args ...any) (store.Rows, error) {
	f.querySQL = append(f.querySQL, sql)
	f.queryArgs = append(f.queryArgs, args)
	if len(f.queryResults) == 0 {
		return &fakeRows{}, nil
	}
	rows := f.queryResults[0]
	f.queryResults = f.queryResults[1:]
	return &rows, nil
}

func (f *fakeDB) QueryRow(_ context.Context, sql string, args ...any) store.Row {
	f.queryRowSQL = append(f.queryRowSQL, sql)
	f.queryRowArgs = append(f.queryRowArgs, args)
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

type fakeRows struct {
	rows  [][]any
	index int
}

func (*fakeRows) Close() {}

func (*fakeRows) Err() error {
	return nil
}

func (r *fakeRows) Next() bool {
	if r.index >= len(r.rows) {
		return false
	}
	r.index++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	row := r.rows[r.index-1]
	for i := range dest {
		assign(dest[i], row[i])
	}
	return nil
}

func assign(dest any, value any) {
	switch ptr := dest.(type) {
	case *string:
		*ptr = value.(string)
	case *int:
		*ptr = value.(int)
	case *int64:
		*ptr = value.(int64)
	case *[]byte:
		*ptr = value.([]byte)
	case *SubscriptionState:
		*ptr = value.(SubscriptionState)
	case *time.Time:
		*ptr = value.(time.Time)
	case **time.Time:
		if value == nil {
			*ptr = nil
			return
		}
		switch v := value.(type) {
		case time.Time:
			*ptr = &v
		case *time.Time:
			*ptr = v
		default:
			panic("unsupported nullable time scan value")
		}
	default:
		panic("unsupported scan destination")
	}
}
