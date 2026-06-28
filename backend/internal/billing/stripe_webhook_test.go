package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestStripeHandleWebhookProcessesValidCheckoutEventOnce(t *testing.T) {
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	payload := []byte(`{
		"id":"evt_checkout_completed_001",
		"type":"checkout.session.completed",
		"livemode":false,
		"data":{"object":{
			"id":"cs_test_001",
			"status":"complete",
			"payment_status":"paid",
			"customer":"cus_test_001",
			"subscription":"sub_test_001",
			"client_reference_id":"tenant_1:user_1:plan_pro",
			"metadata":{}
		}}
	}`)
	store := newMemoryStripeStore()
	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			WebhookSecret: "whsec_local_webhook_secret",
			Mode:          "test",
		},
		Events: store,
		Now: func() time.Time {
			return now
		},
	}

	signature := stripeTestSignature(payload, "whsec_local_webhook_secret", now)
	if err := adapter.HandleWebhook(context.Background(), payload, signature); err != nil {
		t.Fatalf("HandleWebhook() error = %v", err)
	}
	if err := adapter.HandleWebhook(context.Background(), payload, signature); err != nil {
		t.Fatalf("HandleWebhook() replay error = %v", err)
	}

	if store.claims != 1 {
		t.Fatalf("claims = %d, want one first-claim write", store.claims)
	}
	if store.syncs != 1 {
		t.Fatalf("syncs = %d, want one subscription sync", store.syncs)
	}
	if store.processed != 1 {
		t.Fatalf("processed = %d, want one processed mark", store.processed)
	}
	if got := store.syncedEvent; got.State != SubscriptionActive || got.TenantID != "tenant_1" || got.UserID != "user_1" || got.PlanID != "plan_pro" || got.SubscriptionID != "sub_test_001" {
		t.Fatalf("synced event = %+v", got)
	}
}

func TestStripeHandleWebhookRejectsInvalidSignature(t *testing.T) {
	payload := []byte(`{"id":"evt_bad_sig","type":"invoice.payment_failed","livemode":false,"data":{"object":{"id":"in_test_001","subscription":"sub_test_001","metadata":{"tenant_id":"tenant_1","user_id":"user_1","plan_id":"plan_pro"}}}}`)
	store := newMemoryStripeStore()
	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			WebhookSecret: "whsec_local_webhook_secret",
			Mode:          "test",
		},
		Events: store,
		Now: func() time.Time {
			return time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
		},
	}

	err := adapter.HandleWebhook(context.Background(), payload, "t=1782036000,v1=not-hex")
	if err == nil || !strings.Contains(err.Error(), "signature verification failed") {
		t.Fatalf("HandleWebhook() error = %v, want signature failure", err)
	}
	if store.claims != 0 || store.syncs != 0 || store.processed != 0 {
		t.Fatalf("store writes after invalid signature: claims=%d syncs=%d processed=%d", store.claims, store.syncs, store.processed)
	}
}

func TestStripeHandleWebhookRejectsStaleTimestamp(t *testing.T) {
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	payload := []byte(`{"id":"evt_stale","type":"invoice.payment_failed","livemode":false,"data":{"object":{"id":"in_test_001","subscription":"sub_test_001","metadata":{"tenant_id":"tenant_1","user_id":"user_1","plan_id":"plan_pro"}}}}`)
	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			WebhookSecret: "whsec_local_webhook_secret",
			Mode:          "test",
		},
		Events: newMemoryStripeStore(),
		Now: func() time.Time {
			return now
		},
	}

	stale := now.Add(-10 * time.Minute)
	err := adapter.HandleWebhook(context.Background(), payload, stripeTestSignature(payload, "whsec_local_webhook_secret", stale))
	if err == nil || !strings.Contains(err.Error(), "timestamp outside tolerance") {
		t.Fatalf("HandleWebhook() error = %v, want stale timestamp failure", err)
	}
}

func TestStripeHandleWebhookRejectsLiveModeEventInTestMode(t *testing.T) {
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	payload := []byte(`{"id":"evt_live","type":"customer.subscription.updated","livemode":true,"data":{"object":{"id":"sub_live_001","status":"active","metadata":{"tenant_id":"tenant_1","user_id":"user_1","plan_id":"plan_pro"}}}}`)
	store := newMemoryStripeStore()
	adapter := StripeAdapter{
		Config: StripeCheckoutConfig{
			WebhookSecret: "whsec_local_webhook_secret",
			Mode:          "test",
		},
		Events: store,
		Now: func() time.Time {
			return now
		},
	}

	err := adapter.HandleWebhook(context.Background(), payload, stripeTestSignature(payload, "whsec_local_webhook_secret", now))
	if err == nil || !strings.Contains(err.Error(), "livemode=true") {
		t.Fatalf("HandleWebhook() error = %v, want livemode rejection", err)
	}
	if store.claims != 0 {
		t.Fatalf("claims = %d, want no event claim for live event in test mode", store.claims)
	}
}

func TestStripeWebhookStatusMapping(t *testing.T) {
	cases := map[string]SubscriptionState{
		"trialing":           SubscriptionTrialing,
		"active":             SubscriptionActive,
		"past_due":           SubscriptionPastDue,
		"unpaid":             SubscriptionPastDue,
		"canceled":           SubscriptionCancelled,
		"cancelled":          SubscriptionCancelled,
		"incomplete_expired": SubscriptionExpired,
	}
	for status, want := range cases {
		if got := mapStripeSubscriptionStatus(status); got != want {
			t.Fatalf("mapStripeSubscriptionStatus(%q) = %q, want %q", status, got, want)
		}
	}
	if got := mapStripeCheckoutStatus("complete", "paid"); got != SubscriptionActive {
		t.Fatalf("mapStripeCheckoutStatus(complete, paid) = %q, want active", got)
	}
	if got := mapStripeCheckoutStatus("expired", ""); got != SubscriptionExpired {
		t.Fatalf("mapStripeCheckoutStatus(expired, empty) = %q, want expired", got)
	}
}

func TestStripeEventRepositoryPersistsAndSyncsSubscription(t *testing.T) {
	db := &fakeDB{rowsAffected: []int64{1, 1, 1}}
	repo := NewStripeEventRepository(db)
	event := StripeWebhookEvent{
		ID:             "evt_001",
		Type:           "customer.subscription.updated",
		TenantID:       "tenant_1",
		UserID:         "user_1",
		PlanID:         "plan_pro",
		CustomerID:     "cus_001",
		SubscriptionID: "sub_001",
		State:          SubscriptionActive,
		Raw:            []byte(`{"id":"evt_001"}`),
	}
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)

	claimed, err := repo.ClaimEvent(context.Background(), event, now)
	if err != nil {
		t.Fatalf("ClaimEvent() error = %v", err)
	}
	if !claimed {
		t.Fatal("ClaimEvent() claimed = false, want true")
	}
	if err := repo.SyncSubscription(context.Background(), event, now); err != nil {
		t.Fatalf("SyncSubscription() error = %v", err)
	}
	if err := repo.MarkEventProcessed(context.Background(), event.ID, event.State, now); err != nil {
		t.Fatalf("MarkEventProcessed() error = %v", err)
	}

	if db.execs != 3 {
		t.Fatalf("execs = %d, want 3", db.execs)
	}
	if !strings.Contains(db.execSQL[0], "INSERT INTO stripe_webhook_events") || !strings.Contains(db.execSQL[0], "ON CONFLICT (id) DO NOTHING") {
		t.Fatalf("claim SQL = %s", db.execSQL[0])
	}
	if !strings.Contains(db.execSQL[1], "INSERT INTO user_subscriptions") || !strings.Contains(db.execSQL[1], "ON CONFLICT (id) DO UPDATE") {
		t.Fatalf("sync SQL = %s", db.execSQL[1])
	}
	if db.execArgs[1][0] != "stripe:sub_001" || db.execArgs[1][4] != SubscriptionActive || db.execArgs[1][7] != "sub_001" {
		t.Fatalf("sync args = %#v", db.execArgs[1])
	}
	if !strings.Contains(db.execSQL[2], "UPDATE stripe_webhook_events") {
		t.Fatalf("processed SQL = %s", db.execSQL[2])
	}
}

func TestStripeEventRepositoryIdempotencyAndNoRows(t *testing.T) {
	repo := NewStripeEventRepository(&fakeDB{rowsAffected: []int64{0}})
	claimed, err := repo.ClaimEvent(context.Background(), StripeWebhookEvent{ID: "evt_001", Type: "invoice.paid"}, time.Now())
	if err != nil {
		t.Fatalf("ClaimEvent() error = %v", err)
	}
	if claimed {
		t.Fatal("ClaimEvent() claimed = true, want duplicate no-op")
	}

	repo = NewStripeEventRepository(&fakeDB{rowsAffected: []int64{0}})
	err = repo.MarkEventProcessed(context.Background(), "evt_001", SubscriptionActive, time.Now())
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("MarkEventProcessed() error = %v, want pgx.ErrNoRows", err)
	}
}

func stripeTestSignature(payload []byte, secret string, at time.Time) string {
	timestamp := strconv.FormatInt(at.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(payload)
	return "t=" + timestamp + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

type memoryStripeStore struct {
	seen        map[string]struct{}
	claims      int
	syncs       int
	processed   int
	syncedEvent StripeWebhookEvent
}

func newMemoryStripeStore() *memoryStripeStore {
	return &memoryStripeStore{seen: map[string]struct{}{}}
}

func (s *memoryStripeStore) ClaimEvent(_ context.Context, event StripeWebhookEvent, _ time.Time) (bool, error) {
	if _, ok := s.seen[event.ID]; ok {
		return false, nil
	}
	s.seen[event.ID] = struct{}{}
	s.claims++
	return true, nil
}

func (s *memoryStripeStore) SyncSubscription(_ context.Context, event StripeWebhookEvent, _ time.Time) error {
	s.syncs++
	s.syncedEvent = event
	return nil
}

func (s *memoryStripeStore) MarkEventProcessed(_ context.Context, _ string, _ SubscriptionState, _ time.Time) error {
	s.processed++
	return nil
}
