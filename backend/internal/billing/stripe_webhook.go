package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

type StripeEventStore interface {
	ClaimEvent(ctx context.Context, event StripeWebhookEvent, receivedAt time.Time) (bool, error)
	MarkEventProcessed(ctx context.Context, eventID string, status SubscriptionState, processedAt time.Time) error
}

type StripeSubscriptionStore interface {
	SyncSubscription(ctx context.Context, event StripeWebhookEvent, syncedAt time.Time) error
}

type StripeWebhookEvent struct {
	ID             string
	Type           string
	Livemode       bool
	TenantID       string
	UserID         string
	PlanID         string
	CustomerID     string
	SubscriptionID string
	InvoiceID      string
	State          SubscriptionState
	PeriodEnd      *time.Time
	Raw            json.RawMessage
}

func (a StripeAdapter) HandleWebhook(ctx context.Context, payload []byte, signature string) error {
	mode := strings.TrimSpace(a.Config.Mode)
	if mode == "" {
		mode = "test"
	}
	if err := verifyStripeWebhookSignature(payload, signature, a.Config.WebhookSecret, a.now()); err != nil {
		return err
	}
	event, err := parseStripeWebhookEvent(payload)
	if err != nil {
		return err
	}
	if mode == "test" && event.Livemode {
		return errors.New("stripe webhook livemode=true while STRIPE_MODE=test")
	}
	if mode != "test" && mode != "live" {
		return errors.New(`stripe mode must be "test" or "live"`)
	}
	if event.State == "" {
		return fmt.Errorf("unsupported stripe webhook event type: %s", event.Type)
	}
	if err := validateStripeSubscriptionEvent(event); err != nil {
		return err
	}
	if a.Events == nil {
		return errors.New("stripe event store is required")
	}

	claimed, err := a.Events.ClaimEvent(ctx, event, a.now())
	if err != nil {
		return err
	}
	if !claimed {
		return nil
	}
	if subscriptionStore, ok := a.Events.(StripeSubscriptionStore); ok {
		if err := subscriptionStore.SyncSubscription(ctx, event, a.now()); err != nil {
			return err
		}
	}
	return a.Events.MarkEventProcessed(ctx, event.ID, event.State, a.now())
}

func verifyStripeWebhookSignature(payload []byte, header, secret string, now time.Time) error {
	if strings.TrimSpace(secret) == "" {
		return errors.New("stripe webhook secret is required")
	}
	timestamp, signatures := parseStripeSignatureHeader(header)
	if timestamp == "" || len(signatures) == 0 {
		return errors.New("stripe webhook signature missing timestamp or v1 signature")
	}
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return errors.New("stripe webhook timestamp is invalid")
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	signedAt := time.Unix(ts, 0).UTC()
	if now.Sub(signedAt) > 5*time.Minute || signedAt.Sub(now) > 5*time.Minute {
		return errors.New("stripe webhook timestamp outside tolerance")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(payload)
	expected := mac.Sum(nil)
	for _, candidate := range signatures {
		decoded, err := hex.DecodeString(candidate)
		if err == nil && hmac.Equal(decoded, expected) {
			return nil
		}
	}
	return errors.New("stripe webhook signature verification failed")
}

func parseStripeSignatureHeader(header string) (string, []string) {
	var timestamp string
	var signatures []string
	for _, part := range strings.Split(header, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		switch key {
		case "t":
			timestamp = value
		case "v1":
			signatures = append(signatures, value)
		}
	}
	return timestamp, signatures
}

func parseStripeWebhookEvent(payload []byte) (StripeWebhookEvent, error) {
	var envelope struct {
		ID       string          `json:"id"`
		Type     string          `json:"type"`
		Livemode bool            `json:"livemode"`
		Data     json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return StripeWebhookEvent{}, err
	}
	if envelope.ID == "" || envelope.Type == "" {
		return StripeWebhookEvent{}, errors.New("stripe webhook event missing id or type")
	}

	var data struct {
		Object stripeObject `json:"object"`
	}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return StripeWebhookEvent{}, err
	}

	event := StripeWebhookEvent{
		ID:             envelope.ID,
		Type:           envelope.Type,
		Livemode:       envelope.Livemode,
		TenantID:       firstNonEmptyString(data.Object.Metadata["tenant_id"], data.Object.ClientReferenceTenantID()),
		UserID:         firstNonEmptyString(data.Object.Metadata["user_id"], data.Object.ClientReferenceUserID()),
		PlanID:         firstNonEmptyString(data.Object.Metadata["plan_id"], data.Object.ClientReferencePlanID()),
		CustomerID:     data.Object.Customer,
		SubscriptionID: firstNonEmptyString(data.Object.Subscription, data.Object.ID),
		InvoiceID:      data.Object.Invoice,
		Raw:            append(json.RawMessage(nil), payload...),
	}
	if data.Object.CurrentPeriodEnd > 0 {
		periodEnd := time.Unix(data.Object.CurrentPeriodEnd, 0).UTC()
		event.PeriodEnd = &periodEnd
	}

	switch envelope.Type {
	case "checkout.session.completed":
		event.State = mapStripeCheckoutStatus(data.Object.Status, data.Object.PaymentStatus)
	case "customer.subscription.created", "customer.subscription.updated":
		event.State = mapStripeSubscriptionStatus(data.Object.Status)
	case "customer.subscription.deleted":
		event.State = SubscriptionCancelled
	case "invoice.payment_failed":
		event.State = SubscriptionPastDue
	case "invoice.paid", "invoice.payment_succeeded":
		event.State = SubscriptionActive
	}
	return event, nil
}

type stripeObject struct {
	ID                string            `json:"id"`
	Status            string            `json:"status"`
	PaymentStatus     string            `json:"payment_status"`
	Customer          string            `json:"customer"`
	Subscription      string            `json:"subscription"`
	Invoice           string            `json:"invoice"`
	ClientReferenceID string            `json:"client_reference_id"`
	CurrentPeriodEnd  int64             `json:"current_period_end"`
	Metadata          map[string]string `json:"metadata"`
}

func (o stripeObject) ClientReferenceTenantID() string {
	tenantID, _, _ := strings.Cut(o.ClientReferenceID, ":")
	return tenantID
}

func (o stripeObject) ClientReferenceUserID() string {
	_, rest, ok := strings.Cut(o.ClientReferenceID, ":")
	if !ok {
		return ""
	}
	userID, _, _ := strings.Cut(rest, ":")
	return userID
}

func (o stripeObject) ClientReferencePlanID() string {
	_, rest, ok := strings.Cut(o.ClientReferenceID, ":")
	if !ok {
		return ""
	}
	_, planID, ok := strings.Cut(rest, ":")
	if !ok {
		return ""
	}
	return planID
}

func validateStripeSubscriptionEvent(event StripeWebhookEvent) error {
	if event.TenantID == "" || event.UserID == "" || event.PlanID == "" || event.SubscriptionID == "" {
		return errors.New("stripe webhook event missing tenant, user, plan, or subscription metadata")
	}
	return nil
}

func mapStripeCheckoutStatus(status, paymentStatus string) SubscriptionState {
	switch strings.ToLower(strings.TrimSpace(paymentStatus)) {
	case "paid", "no_payment_required":
		return SubscriptionActive
	}
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "complete":
		return SubscriptionActive
	case "expired":
		return SubscriptionExpired
	default:
		return ""
	}
}

func mapStripeSubscriptionStatus(status string) SubscriptionState {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "trialing":
		return SubscriptionTrialing
	case "active", "paid":
		return SubscriptionActive
	case "past_due", "unpaid":
		return SubscriptionPastDue
	case "canceled", "cancelled":
		return SubscriptionCancelled
	case "incomplete_expired":
		return SubscriptionExpired
	default:
		return ""
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

type StripeEventRepository struct {
	db store.DBTX
}

func NewStripeEventRepository(db store.DBTX) StripeEventRepository {
	return StripeEventRepository{db: db}
}

func (r StripeEventRepository) ClaimEvent(ctx context.Context, event StripeWebhookEvent, receivedAt time.Time) (bool, error) {
	if event.ID == "" || event.Type == "" {
		return false, errors.New("stripe event id and type are required")
	}
	tag, err := r.db.Exec(ctx, `
INSERT INTO stripe_webhook_events(id, type, livemode, tenant_id, user_id, provider_customer_id, provider_subscription_id, payload, status, received_at, updated_at)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, 'received', $9, $9)
ON CONFLICT (id) DO NOTHING`,
		event.ID,
		event.Type,
		event.Livemode,
		event.TenantID,
		event.UserID,
		event.CustomerID,
		event.SubscriptionID,
		event.Raw,
		receivedAt.UTC(),
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (r StripeEventRepository) MarkEventProcessed(ctx context.Context, eventID string, status SubscriptionState, processedAt time.Time) error {
	if eventID == "" || status == "" {
		return errors.New("stripe event id and subscription status are required")
	}
	tag, err := r.db.Exec(ctx, `
UPDATE stripe_webhook_events
SET status = 'processed', subscription_status = $2, processed_at = $3, updated_at = $3
WHERE id = $1 AND status = 'received'`,
		eventID,
		status,
		processedAt.UTC(),
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r StripeEventRepository) SyncSubscription(ctx context.Context, event StripeWebhookEvent, syncedAt time.Time) error {
	if event.TenantID == "" || event.UserID == "" || event.PlanID == "" || event.SubscriptionID == "" || event.State == "" {
		return errors.New("stripe subscription event requires tenant, user, plan, subscription, and state")
	}
	subscriptionID := "stripe:" + event.SubscriptionID
	periodStart := syncedAt.UTC()
	var periodEnd any
	if event.PeriodEnd != nil {
		periodEnd = event.PeriodEnd.UTC()
	}
	tag, err := r.db.Exec(ctx, `
INSERT INTO user_subscriptions(id, tenant_id, user_id, plan_id, status, current_period_start, current_period_end, provider, provider_ref, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, $6, $7, 'stripe', $8, $9, $9)
ON CONFLICT (id) DO UPDATE
SET status = EXCLUDED.status,
    plan_id = EXCLUDED.plan_id,
    current_period_end = EXCLUDED.current_period_end,
    provider = EXCLUDED.provider,
    provider_ref = EXCLUDED.provider_ref,
    updated_at = EXCLUDED.updated_at
WHERE user_subscriptions.tenant_id = EXCLUDED.tenant_id
  AND user_subscriptions.user_id = EXCLUDED.user_id`,
		subscriptionID,
		event.TenantID,
		event.UserID,
		event.PlanID,
		event.State,
		periodStart,
		periodEnd,
		event.SubscriptionID,
		syncedAt.UTC(),
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return pgx.ErrNoRows
	}
	return nil
}
