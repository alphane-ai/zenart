package billing

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
)

type SubscriptionState string

const (
	SubscriptionTrialing   SubscriptionState = "trialing"
	SubscriptionActive     SubscriptionState = "active"
	SubscriptionPastDue    SubscriptionState = "past_due"
	SubscriptionCancelled  SubscriptionState = "cancelled"
	SubscriptionIncomplete SubscriptionState = "incomplete"
	SubscriptionExpired    SubscriptionState = "expired"
	SubscriptionComped     SubscriptionState = "comped"
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

type BillingPortalSession struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenant_id"`
	UserID      string    `json:"user_id"`
	Provider    string    `json:"provider"`
	RedirectURL string    `json:"redirect_url"`
	CreatedAt   time.Time `json:"created_at"`
}

type SubscriptionCancellation struct {
	ID                string            `json:"id"`
	Provider          string            `json:"provider"`
	Status            SubscriptionState `json:"status"`
	CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
	CurrentPeriodEnd  *time.Time        `json:"current_period_end,omitempty"`
	UpdatedAt         time.Time         `json:"updated_at"`
}

type BillingInvoice struct {
	ID              string    `json:"id"`
	Provider        string    `json:"provider"`
	Status          string    `json:"status"`
	Currency        string    `json:"currency"`
	AmountDueCents  int64     `json:"amount_due_cents"`
	AmountPaidCents int64     `json:"amount_paid_cents"`
	InvoiceURL      string    `json:"invoice_url,omitempty"`
	ReceiptURL      string    `json:"receipt_url,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type BillingInvoicePage struct {
	Items []BillingInvoice `json:"items"`
}

type TeamSeatUsageSnapshot struct {
	PlanID         string `json:"plan_id"`
	SeatLimit      int    `json:"seat_limit"`
	ActiveSeats    int    `json:"active_seats"`
	InvitedSeats   int    `json:"invited_seats"`
	BillableSeats  int    `json:"billable_seats"`
	AvailableSeats int    `json:"available_seats"`
}

type TeamSeatSyncInput struct {
	TenantID       string
	TeamID         string
	ActorID        string
	Operation      string
	IdempotencyKey string
	Rationale      string
	Usage          TeamSeatUsageSnapshot
	RequestedAt    time.Time
}

type TeamSeatProviderRequest struct {
	TenantID                   string
	TeamID                     string
	Operation                  string
	IdempotencyKey             string
	ProviderSubscriptionID     string
	ProviderSubscriptionItemID string
	PriceID                    string
	Quantity                   int
	ProrationBehavior          string
	RequestedAt                time.Time
}

type TeamSeatSyncResult struct {
	ID                         string    `json:"id"`
	TenantID                   string    `json:"tenant_id"`
	TeamID                     string    `json:"team_id"`
	Provider                   string    `json:"provider"`
	ProviderSubscriptionID     string    `json:"provider_subscription_id,omitempty"`
	ProviderSubscriptionItemID string    `json:"provider_subscription_item_id,omitempty"`
	PriceID                    string    `json:"price_id,omitempty"`
	RequestedQuantity          int       `json:"requested_quantity"`
	SyncedQuantity             int       `json:"synced_quantity"`
	ProrationBehavior          string    `json:"proration_behavior"`
	Status                     string    `json:"status"`
	Reason                     string    `json:"reason,omitempty"`
	Operation                  string    `json:"operation"`
	IdempotencyKey             string    `json:"idempotency_key"`
	CreatedAt                  time.Time `json:"created_at"`
}

type TeamBillingLink struct {
	TenantID                   string         `json:"tenant_id"`
	TeamID                     string         `json:"team_id"`
	Provider                   string         `json:"provider"`
	ProviderSubscriptionID     string         `json:"provider_subscription_id"`
	ProviderSubscriptionItemID string         `json:"provider_subscription_item_id"`
	PriceID                    string         `json:"price_id,omitempty"`
	ProrationBehavior          string         `json:"proration_behavior"`
	Status                     string         `json:"status"`
	Metadata                   map[string]any `json:"metadata"`
	CreatedAt                  time.Time      `json:"created_at"`
	UpdatedAt                  time.Time      `json:"updated_at"`
}

type TeamBillingLinkInput struct {
	TenantID                   string
	TeamID                     string
	ActorID                    string
	Provider                   string
	ProviderSubscriptionID     string
	ProviderSubscriptionItemID string
	PriceID                    string
	ProrationBehavior          string
	Status                     string
	Rationale                  string
	IdempotencyKey             string
	Metadata                   map[string]any
	RequestedAt                time.Time
}

type TeamSeatSyncPage struct {
	Items []TeamSeatSyncResult `json:"items"`
}

type TeamSeatBillingSyncer interface {
	SyncTeamSeatQuantity(ctx context.Context, input TeamSeatSyncInput) (TeamSeatSyncResult, error)
}

type TeamSeatBillingManager interface {
	TeamSeatBillingSyncer
	GetTeamBillingLink(ctx context.Context, tenantID, teamID string) (TeamBillingLink, error)
	UpsertTeamBillingLink(ctx context.Context, input TeamBillingLinkInput) (TeamBillingLink, error)
	ListTeamSeatBillingSyncs(ctx context.Context, tenantID, teamID string, limit int) (TeamSeatSyncPage, error)
}

type TeamSeatBillingProvider interface {
	SyncTeamSeatQuantity(ctx context.Context, request TeamSeatProviderRequest) (TeamSeatSyncResult, error)
}

type AdminBillingOperation string

const (
	AdminBillingOperationManualCredit     AdminBillingOperation = "manual_credit"
	AdminBillingOperationRefundNote       AdminBillingOperation = "refund_note"
	AdminBillingOperationSyncSubscription AdminBillingOperation = "sync_subscription"
	AdminBillingOperationAccountLock      AdminBillingOperation = "account_lock"
)

type AdminBillingOperationInput struct {
	TenantID       string
	ActorID        string
	TargetUserID   string
	Operation      AdminBillingOperation
	IdempotencyKey string
	Units          int64
	BucketID       string
	SubscriptionID string
	Provider       string
	ProviderRef    string
	Rationale      string
	Note           string
	Locked         *bool
	Metadata       map[string]any
	RequestedAt    time.Time
}

type AdminBillingOperationResult struct {
	ID             string                `json:"id"`
	TenantID       string                `json:"tenant_id"`
	ActorID        string                `json:"actor_id"`
	TargetUserID   string                `json:"target_user_id"`
	Operation      AdminBillingOperation `json:"operation"`
	IdempotencyKey string                `json:"idempotency_key"`
	Status         string                `json:"status"`
	Units          int64                 `json:"units,omitempty"`
	BucketID       string                `json:"bucket_id,omitempty"`
	SubscriptionID string                `json:"subscription_id,omitempty"`
	Provider       string                `json:"provider,omitempty"`
	ProviderRef    string                `json:"provider_ref,omitempty"`
	Rationale      string                `json:"rationale"`
	Note           string                `json:"note,omitempty"`
	Locked         *bool                 `json:"locked,omitempty"`
	Metadata       map[string]any        `json:"metadata"`
	CreatedAt      time.Time             `json:"created_at"`
	UpdatedAt      time.Time             `json:"updated_at"`
}

type AdminBillingOperator interface {
	ManualCredit(ctx context.Context, input AdminBillingOperationInput) (AdminBillingOperationResult, error)
	RecordRefundNote(ctx context.Context, input AdminBillingOperationInput) (AdminBillingOperationResult, error)
	SyncSubscription(ctx context.Context, input AdminBillingOperationInput) (AdminBillingOperationResult, error)
	LockAccount(ctx context.Context, input AdminBillingOperationInput) (AdminBillingOperationResult, error)
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

type MockPaidProviderAdapter struct {
	Checkout MockCheckoutProvider
}

func (p MockPaidProviderAdapter) CreateCheckout(ctx context.Context, tenantID, userID, planID string) (CheckoutSession, error) {
	return p.Checkout.CreateCheckout(ctx, tenantID, userID, planID)
}

func (MockPaidProviderAdapter) HandleWebhook(context.Context, []byte, string) error {
	return errors.New("mock billing provider does not accept webhooks")
}

func (p MockPaidProviderAdapter) CreatePortalSession(_ context.Context, tenantID, userID, customerID, returnURL string) (BillingPortalSession, error) {
	if tenantID == "" || userID == "" {
		return BillingPortalSession{}, errors.New("tenant_id and user_id are required")
	}
	if returnURL == "" {
		returnURL = "/billing"
	}
	return BillingPortalSession{
		ID:          "mock_portal:" + tenantID + ":" + userID,
		TenantID:    tenantID,
		UserID:      userID,
		Provider:    "mock",
		RedirectURL: returnURL,
		CreatedAt:   p.Checkout.NowOrDefault(),
	}, nil
}

func (MockPaidProviderAdapter) CancelSubscription(_ context.Context, subscriptionID string) (SubscriptionCancellation, error) {
	if subscriptionID == "" {
		return SubscriptionCancellation{}, errors.New("subscription id is required")
	}
	now := time.Now().UTC()
	return SubscriptionCancellation{
		ID:                subscriptionID,
		Provider:          "mock",
		Status:            SubscriptionCancelled,
		CancelAtPeriodEnd: true,
		UpdatedAt:         now,
	}, nil
}

func (MockPaidProviderAdapter) ListInvoices(context.Context, string) (BillingInvoicePage, error) {
	return BillingInvoicePage{Items: []BillingInvoice{}}, nil
}

func (p MockPaidProviderAdapter) SyncTeamSeatQuantity(_ context.Context, request TeamSeatProviderRequest) (TeamSeatSyncResult, error) {
	if request.TenantID == "" || request.TeamID == "" || request.Quantity <= 0 || request.IdempotencyKey == "" {
		return TeamSeatSyncResult{}, ErrTeamSeatBillingValidation
	}
	now := p.Checkout.NowOrDefault()
	return TeamSeatSyncResult{
		ID:                         teamSeatSyncID(request.TenantID, request.TeamID, request.Operation, request.IdempotencyKey),
		TenantID:                   request.TenantID,
		TeamID:                     request.TeamID,
		Provider:                   "mock",
		ProviderSubscriptionID:     request.ProviderSubscriptionID,
		ProviderSubscriptionItemID: request.ProviderSubscriptionItemID,
		PriceID:                    request.PriceID,
		RequestedQuantity:          request.Quantity,
		SyncedQuantity:             request.Quantity,
		ProrationBehavior:          firstNonEmptyString(request.ProrationBehavior, "create_prorations"),
		Status:                     "synced",
		Reason:                     "mock_provider",
		Operation:                  request.Operation,
		IdempotencyKey:             request.IdempotencyKey,
		CreatedAt:                  now,
	}, nil
}

type PaidProviderAdapter interface {
	CreateCheckout(ctx context.Context, tenantID, userID, planID string) (CheckoutSession, error)
	CreatePortalSession(ctx context.Context, tenantID, userID, customerID, returnURL string) (BillingPortalSession, error)
	CancelSubscription(ctx context.Context, subscriptionID string) (SubscriptionCancellation, error)
	ListInvoices(ctx context.Context, subscriptionID string) (BillingInvoicePage, error)
	SyncTeamSeatQuantity(ctx context.Context, request TeamSeatProviderRequest) (TeamSeatSyncResult, error)
	HandleWebhook(ctx context.Context, payload []byte, signature string) error
}

type QuotaState struct {
	Buckets      []QuotaBucketProjection      `json:"buckets"`
	Transactions []QuotaTransactionProjection `json:"transactions"`
}

type QuotaBucketProjection struct {
	ID            string    `json:"id"`
	LimitUnits    int64     `json:"limit_units"`
	UsedUnits     int64     `json:"used_units"`
	ReservedUnits int64     `json:"reserved_units"`
	ResetsAt      time.Time `json:"resets_at"`
}

type QuotaTransactionProjection struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind"`
	Units     int64     `json:"units"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type UserSubscriptionProjection struct {
	ID                 string            `json:"id"`
	PlanID             string            `json:"plan_id"`
	Status             SubscriptionState `json:"status"`
	CurrentPeriodStart time.Time         `json:"current_period_start"`
	CurrentPeriodEnd   *time.Time        `json:"current_period_end,omitempty"`
	Provider           string            `json:"provider,omitempty"`
	ProviderRef        string            `json:"-"`
	ProviderCustomerID string            `json:"-"`
}

type AccountReader interface {
	GetQuotaState(ctx context.Context, tenantID, userID string) (QuotaState, error)
	GetSubscription(ctx context.Context, tenantID, userID string) (UserSubscriptionProjection, error)
}

type AccountRepository struct {
	db store.DBTX
}

func NewAccountRepository(db store.DBTX) AccountRepository {
	return AccountRepository{db: db}
}

type AdminBillingRepository struct {
	db store.DBTX
}

func NewAdminBillingRepository(db store.DBTX) AdminBillingRepository {
	return AdminBillingRepository{db: db}
}

type TeamSeatBillingRepository struct {
	db       store.DBTX
	provider TeamSeatBillingProvider
	Now      func() time.Time
}

func NewTeamSeatBillingRepository(db store.DBTX, provider TeamSeatBillingProvider) TeamSeatBillingRepository {
	return TeamSeatBillingRepository{db: db, provider: provider}
}

func (r TeamSeatBillingRepository) SyncTeamSeatQuantity(ctx context.Context, input TeamSeatSyncInput) (TeamSeatSyncResult, error) {
	if err := input.validate(); err != nil {
		return TeamSeatSyncResult{}, err
	}
	now := input.requestedAt(r.Now)
	existing, err := r.getExistingSync(ctx, input.TenantID, input.TeamID, input.Operation, input.IdempotencyKey)
	if err == nil {
		return existing, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return TeamSeatSyncResult{}, err
	}

	link, err := r.getTeamBillingLink(ctx, input.TenantID, input.TeamID)
	if errors.Is(err, pgx.ErrNoRows) {
		result := input.result(now, "skipped", "team_billing_link_missing")
		if err := r.insertSyncResult(ctx, result); err != nil {
			return TeamSeatSyncResult{}, err
		}
		return result, nil
	}
	if err != nil {
		return TeamSeatSyncResult{}, err
	}
	if r.provider == nil {
		return TeamSeatSyncResult{}, ErrTeamSeatBillingProviderMissing
	}

	request := TeamSeatProviderRequest{
		TenantID:                   input.TenantID,
		TeamID:                     input.TeamID,
		Operation:                  input.Operation,
		IdempotencyKey:             input.IdempotencyKey,
		ProviderSubscriptionID:     link.ProviderSubscriptionID,
		ProviderSubscriptionItemID: link.ProviderSubscriptionItemID,
		PriceID:                    link.PriceID,
		Quantity:                   input.Usage.BillableSeats,
		ProrationBehavior:          link.ProrationBehavior,
		RequestedAt:                now,
	}
	result, err := r.provider.SyncTeamSeatQuantity(ctx, request)
	if err != nil {
		failed := input.result(now, "failed", security.RedactString(err.Error()))
		failed.Provider = link.Provider
		failed.ProviderSubscriptionID = link.ProviderSubscriptionID
		failed.ProviderSubscriptionItemID = link.ProviderSubscriptionItemID
		failed.PriceID = link.PriceID
		failed.ProrationBehavior = link.ProrationBehavior
		_ = r.insertSyncResult(ctx, failed)
		return TeamSeatSyncResult{}, err
	}
	result.ID = firstNonEmptyString(result.ID, teamSeatSyncID(input.TenantID, input.TeamID, input.Operation, input.IdempotencyKey))
	result.TenantID = input.TenantID
	result.TeamID = input.TeamID
	result.Operation = input.Operation
	result.IdempotencyKey = input.IdempotencyKey
	result.RequestedQuantity = input.Usage.BillableSeats
	result.Provider = firstNonEmptyString(result.Provider, link.Provider)
	result.ProviderSubscriptionID = firstNonEmptyString(result.ProviderSubscriptionID, link.ProviderSubscriptionID)
	result.ProviderSubscriptionItemID = firstNonEmptyString(result.ProviderSubscriptionItemID, link.ProviderSubscriptionItemID)
	result.PriceID = firstNonEmptyString(result.PriceID, link.PriceID)
	result.ProrationBehavior = firstNonEmptyString(result.ProrationBehavior, link.ProrationBehavior)
	result.Status = firstNonEmptyString(result.Status, "synced")
	result.CreatedAt = firstTimeValue(result.CreatedAt, now)
	if result.SyncedQuantity == 0 {
		result.SyncedQuantity = input.Usage.BillableSeats
	}
	if err := r.insertSyncResult(ctx, result); err != nil {
		return TeamSeatSyncResult{}, err
	}
	return result, nil
}

func (r TeamSeatBillingRepository) GetTeamBillingLink(ctx context.Context, tenantID, teamID string) (TeamBillingLink, error) {
	if tenantID == "" || teamID == "" {
		return TeamBillingLink{}, ErrTeamSeatBillingValidation
	}
	return r.getTeamBillingLink(ctx, tenantID, teamID)
}

func (r TeamSeatBillingRepository) UpsertTeamBillingLink(ctx context.Context, input TeamBillingLinkInput) (TeamBillingLink, error) {
	input.normalize()
	if err := input.validate(); err != nil {
		return TeamBillingLink{}, err
	}
	now := input.requestedAt(r.Now)
	metadata := security.RedactMap(input.Metadata)
	tx, err := r.begin(ctx)
	if err != nil {
		return TeamBillingLink{}, err
	}
	defer rollback(ctx, tx)
	if input.normalizedStatus() == "active" {
		if _, err := tx.Exec(ctx, `
UPDATE team_billing_links
SET status = 'paused',
    updated_at = $3
WHERE tenant_id = $1
  AND team_id = $2
  AND status = 'active'
  AND provider_subscription_item_id <> $4`,
			input.TenantID,
			input.TeamID,
			now,
			input.ProviderSubscriptionItemID,
		); err != nil {
			return TeamBillingLink{}, err
		}
	}
	_, err = tx.Exec(ctx, `
INSERT INTO team_billing_links(
	tenant_id,
	team_id,
	provider,
	provider_subscription_id,
	provider_subscription_item_id,
	price_id,
	proration_behavior,
	status,
	metadata,
	created_at,
	updated_at
)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
ON CONFLICT (tenant_id, team_id, provider_subscription_item_id) DO UPDATE
SET provider = EXCLUDED.provider,
    provider_subscription_id = EXCLUDED.provider_subscription_id,
    price_id = EXCLUDED.price_id,
    proration_behavior = EXCLUDED.proration_behavior,
    status = EXCLUDED.status,
    metadata = EXCLUDED.metadata,
    updated_at = EXCLUDED.updated_at`,
		input.TenantID,
		input.TeamID,
		input.normalizedProvider(),
		input.ProviderSubscriptionID,
		input.ProviderSubscriptionItemID,
		input.PriceID,
		input.normalizedProrationBehavior(),
		input.normalizedStatus(),
		jsonMap(metadata),
		now,
	)
	if err != nil {
		return TeamBillingLink{}, err
	}
	link, err := r.getTeamBillingLinkBySubscriptionItem(ctx, tx, input.TenantID, input.TeamID, input.ProviderSubscriptionItemID)
	if err != nil {
		return TeamBillingLink{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TeamBillingLink{}, err
	}
	return link, nil
}

func (r TeamSeatBillingRepository) ListTeamSeatBillingSyncs(ctx context.Context, tenantID, teamID string, limit int) (TeamSeatSyncPage, error) {
	if tenantID == "" || teamID == "" {
		return TeamSeatSyncPage{}, ErrTeamSeatBillingValidation
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
SELECT id,
       tenant_id,
       team_id,
       provider,
       provider_subscription_id,
       provider_subscription_item_id,
       price_id,
       requested_quantity,
       synced_quantity,
       proration_behavior,
       status,
       reason,
       operation,
       idempotency_key,
       created_at
FROM team_seat_billing_syncs
WHERE tenant_id = $1
  AND team_id = $2
ORDER BY created_at DESC
LIMIT $3`,
		tenantID,
		teamID,
		limit,
	)
	if err != nil {
		return TeamSeatSyncPage{}, err
	}
	defer rows.Close()
	page := TeamSeatSyncPage{Items: []TeamSeatSyncResult{}}
	for rows.Next() {
		var item TeamSeatSyncResult
		if err := rows.Scan(
			&item.ID,
			&item.TenantID,
			&item.TeamID,
			&item.Provider,
			&item.ProviderSubscriptionID,
			&item.ProviderSubscriptionItemID,
			&item.PriceID,
			&item.RequestedQuantity,
			&item.SyncedQuantity,
			&item.ProrationBehavior,
			&item.Status,
			&item.Reason,
			&item.Operation,
			&item.IdempotencyKey,
			&item.CreatedAt,
		); err != nil {
			return TeamSeatSyncPage{}, err
		}
		page.Items = append(page.Items, item)
	}
	if err := rows.Err(); err != nil {
		return TeamSeatSyncPage{}, err
	}
	return page, nil
}

func (r AdminBillingRepository) ManualCredit(ctx context.Context, input AdminBillingOperationInput) (AdminBillingOperationResult, error) {
	input.Operation = AdminBillingOperationManualCredit
	if input.Units <= 0 {
		return AdminBillingOperationResult{}, ErrAdminBillingValidation
	}
	if input.BucketID == "" {
		return AdminBillingOperationResult{}, ErrAdminBillingValidation
	}
	return r.recordAdminOperation(ctx, input, "succeeded", func(tx store.Tx) error {
		return (QuotaRepository{db: tx}).AdminCredit(ctx, input.TenantID, input.BucketID, input.IdempotencyKey, input.Units)
	})
}

func (r TeamSeatBillingRepository) getTeamBillingLink(ctx context.Context, tenantID, teamID string) (TeamBillingLink, error) {
	var link TeamBillingLink
	var metadata []byte
	err := r.db.QueryRow(ctx, `
SELECT tenant_id,
       team_id,
       provider,
       provider_subscription_id,
       provider_subscription_item_id,
       price_id,
       proration_behavior,
       status,
       metadata,
       created_at,
       updated_at
FROM team_billing_links
WHERE tenant_id = $1
  AND team_id = $2
  AND status = 'active'
ORDER BY updated_at DESC
LIMIT 1`,
		tenantID,
		teamID,
	).Scan(
		&link.TenantID,
		&link.TeamID,
		&link.Provider,
		&link.ProviderSubscriptionID,
		&link.ProviderSubscriptionItemID,
		&link.PriceID,
		&link.ProrationBehavior,
		&link.Status,
		&metadata,
		&link.CreatedAt,
		&link.UpdatedAt,
	)
	if err != nil {
		return TeamBillingLink{}, err
	}
	link.Metadata = decodeJSONMap(metadata)
	return link, err
}

func (r TeamSeatBillingRepository) getTeamBillingLinkBySubscriptionItem(ctx context.Context, db store.DBTX, tenantID, teamID, providerSubscriptionItemID string) (TeamBillingLink, error) {
	var link TeamBillingLink
	var metadata []byte
	err := db.QueryRow(ctx, `
SELECT tenant_id,
       team_id,
       provider,
       provider_subscription_id,
       provider_subscription_item_id,
       price_id,
       proration_behavior,
       status,
       metadata,
       created_at,
       updated_at
FROM team_billing_links
WHERE tenant_id = $1
  AND team_id = $2
  AND provider_subscription_item_id = $3`,
		tenantID,
		teamID,
		providerSubscriptionItemID,
	).Scan(
		&link.TenantID,
		&link.TeamID,
		&link.Provider,
		&link.ProviderSubscriptionID,
		&link.ProviderSubscriptionItemID,
		&link.PriceID,
		&link.ProrationBehavior,
		&link.Status,
		&metadata,
		&link.CreatedAt,
		&link.UpdatedAt,
	)
	if err != nil {
		return TeamBillingLink{}, err
	}
	link.Metadata = decodeJSONMap(metadata)
	return link, nil
}

func (r TeamSeatBillingRepository) getExistingSync(ctx context.Context, tenantID, teamID, operation, idempotencyKey string) (TeamSeatSyncResult, error) {
	var result TeamSeatSyncResult
	err := r.db.QueryRow(ctx, `
SELECT id,
       tenant_id,
       team_id,
       provider,
       provider_subscription_id,
       provider_subscription_item_id,
       price_id,
       requested_quantity,
       synced_quantity,
       proration_behavior,
       status,
       reason,
       operation,
       idempotency_key,
       created_at
FROM team_seat_billing_syncs
WHERE tenant_id = $1
  AND team_id = $2
  AND operation = $3
  AND idempotency_key = $4`,
		tenantID,
		teamID,
		operation,
		idempotencyKey,
	).Scan(
		&result.ID,
		&result.TenantID,
		&result.TeamID,
		&result.Provider,
		&result.ProviderSubscriptionID,
		&result.ProviderSubscriptionItemID,
		&result.PriceID,
		&result.RequestedQuantity,
		&result.SyncedQuantity,
		&result.ProrationBehavior,
		&result.Status,
		&result.Reason,
		&result.Operation,
		&result.IdempotencyKey,
		&result.CreatedAt,
	)
	return result, err
}

func (r TeamSeatBillingRepository) insertSyncResult(ctx context.Context, result TeamSeatSyncResult) error {
	if result.ID == "" || result.TenantID == "" || result.TeamID == "" || result.Operation == "" || result.IdempotencyKey == "" {
		return ErrTeamSeatBillingValidation
	}
	if result.CreatedAt.IsZero() {
		result.CreatedAt = time.Now().UTC()
	}
	_, err := r.db.Exec(ctx, `
INSERT INTO team_seat_billing_syncs(
	id,
	tenant_id,
	team_id,
	provider,
	provider_subscription_id,
	provider_subscription_item_id,
	price_id,
	requested_quantity,
	synced_quantity,
	proration_behavior,
	status,
	reason,
	operation,
	idempotency_key,
	created_at,
	updated_at
)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
ON CONFLICT (tenant_id, team_id, operation, idempotency_key) DO NOTHING`,
		result.ID,
		result.TenantID,
		result.TeamID,
		result.Provider,
		result.ProviderSubscriptionID,
		result.ProviderSubscriptionItemID,
		result.PriceID,
		result.RequestedQuantity,
		result.SyncedQuantity,
		result.ProrationBehavior,
		result.Status,
		result.Reason,
		result.Operation,
		result.IdempotencyKey,
		result.CreatedAt.UTC(),
	)
	return err
}

func (r AdminBillingRepository) RecordRefundNote(ctx context.Context, input AdminBillingOperationInput) (AdminBillingOperationResult, error) {
	input.Operation = AdminBillingOperationRefundNote
	if input.Note == "" {
		return AdminBillingOperationResult{}, ErrAdminBillingValidation
	}
	return r.recordAdminOperation(ctx, input, "recorded", nil)
}

func (r AdminBillingRepository) SyncSubscription(ctx context.Context, input AdminBillingOperationInput) (AdminBillingOperationResult, error) {
	input.Operation = AdminBillingOperationSyncSubscription
	return r.recordAdminOperation(ctx, input, "recorded", nil)
}

func (r AdminBillingRepository) LockAccount(ctx context.Context, input AdminBillingOperationInput) (AdminBillingOperationResult, error) {
	input.Operation = AdminBillingOperationAccountLock
	if input.Locked == nil {
		locked := true
		input.Locked = &locked
	}
	return r.recordAdminOperation(ctx, input, "recorded", func(tx store.Tx) error {
		metadata := redactedJSONMap(input.Metadata)
		if *input.Locked {
			_, err := tx.Exec(ctx, `
INSERT INTO billing_account_locks(tenant_id, user_id, locked, reason, locked_by, locked_at, unlocked_at, metadata, updated_at)
VALUES($1, $2, true, $3, $4, $5, null, $6, $5)
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET locked = true,
    reason = EXCLUDED.reason,
    locked_by = EXCLUDED.locked_by,
    locked_at = EXCLUDED.locked_at,
    unlocked_at = null,
    metadata = EXCLUDED.metadata,
    updated_at = EXCLUDED.updated_at`,
				input.TenantID,
				input.TargetUserID,
				input.Rationale,
				input.ActorID,
				input.requestedAt(),
				metadata,
			)
			return err
		}
		_, err := tx.Exec(ctx, `
INSERT INTO billing_account_locks(tenant_id, user_id, locked, reason, locked_by, locked_at, unlocked_at, metadata, updated_at)
VALUES($1, $2, false, $3, $4, $5, $5, $6, $5)
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET locked = false,
    reason = EXCLUDED.reason,
    locked_by = EXCLUDED.locked_by,
    unlocked_at = EXCLUDED.unlocked_at,
    metadata = EXCLUDED.metadata,
    updated_at = EXCLUDED.updated_at`,
			input.TenantID,
			input.TargetUserID,
			input.Rationale,
			input.ActorID,
			input.requestedAt(),
			metadata,
		)
		return err
	})
}

func (r AdminBillingRepository) recordAdminOperation(ctx context.Context, input AdminBillingOperationInput, status string, mutate func(store.Tx) error) (AdminBillingOperationResult, error) {
	if err := input.validate(); err != nil {
		return AdminBillingOperationResult{}, err
	}
	if status == "" {
		status = "recorded"
	}
	tx, err := r.begin(ctx)
	if err != nil {
		return AdminBillingOperationResult{}, err
	}
	defer rollback(ctx, tx)

	now := input.requestedAt()
	result := input.result(now, status)
	insertTag, err := tx.Exec(ctx, `
INSERT INTO billing_admin_operations(
	id,
	tenant_id,
	actor_id,
	target_user_id,
	operation,
	idempotency_key,
	status,
	units,
	bucket_id,
	subscription_id,
	provider,
	provider_ref,
	rationale,
	note,
	metadata,
	created_at,
	updated_at
)
VALUES($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
ON CONFLICT (tenant_id, operation, idempotency_key) DO NOTHING`,
		result.ID,
		input.TenantID,
		input.ActorID,
		input.TargetUserID,
		string(input.Operation),
		input.IdempotencyKey,
		input.Units,
		input.BucketID,
		input.SubscriptionID,
		input.Provider,
		input.ProviderRef,
		input.Rationale,
		input.Note,
		redactedJSONMap(result.Metadata),
		now,
	)
	if err != nil {
		return AdminBillingOperationResult{}, err
	}
	if insertTag.RowsAffected() == 0 {
		existing, err := r.getAdminOperation(ctx, tx, input.TenantID, input.Operation, input.IdempotencyKey)
		if err != nil {
			return AdminBillingOperationResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return AdminBillingOperationResult{}, err
		}
		return existing, nil
	}
	if mutate != nil {
		if err := mutate(tx); err != nil {
			return AdminBillingOperationResult{}, err
		}
	}
	_, err = tx.Exec(ctx, `
UPDATE billing_admin_operations
SET status = $1,
    updated_at = $2
WHERE tenant_id = $3
  AND operation = $4
  AND idempotency_key = $5`,
		status,
		now,
		input.TenantID,
		string(input.Operation),
		input.IdempotencyKey,
	)
	if err != nil {
		return AdminBillingOperationResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminBillingOperationResult{}, err
	}
	return result, nil
}

func (r AdminBillingRepository) getAdminOperation(ctx context.Context, db store.DBTX, tenantID string, operation AdminBillingOperation, idempotencyKey string) (AdminBillingOperationResult, error) {
	var result AdminBillingOperationResult
	var operationValue string
	var metadata []byte
	err := db.QueryRow(ctx, `
SELECT id, tenant_id, actor_id, target_user_id, operation, idempotency_key, status, units, bucket_id, subscription_id, provider, provider_ref, rationale, note, metadata, created_at, updated_at
FROM billing_admin_operations
WHERE tenant_id = $1
  AND operation = $2
  AND idempotency_key = $3`,
		tenantID,
		string(operation),
		idempotencyKey,
	).Scan(
		&result.ID,
		&result.TenantID,
		&result.ActorID,
		&result.TargetUserID,
		&operationValue,
		&result.IdempotencyKey,
		&result.Status,
		&result.Units,
		&result.BucketID,
		&result.SubscriptionID,
		&result.Provider,
		&result.ProviderRef,
		&result.Rationale,
		&result.Note,
		&metadata,
		&result.CreatedAt,
		&result.UpdatedAt,
	)
	if err != nil {
		return AdminBillingOperationResult{}, err
	}
	result.Operation = AdminBillingOperation(operationValue)
	if len(metadata) > 0 {
		_ = json.Unmarshal(metadata, &result.Metadata)
	}
	if result.Metadata == nil {
		result.Metadata = map[string]any{}
	}
	if value, ok := result.Metadata["locked"].(bool); ok {
		result.Locked = &value
	}
	return result, nil
}

func (r AdminBillingRepository) begin(ctx context.Context) (store.Tx, error) {
	transactor, ok := r.db.(store.Transactor)
	if !ok {
		return noopTx{DBTX: r.db}, nil
	}
	return transactor.Begin(ctx)
}

func (r TeamSeatBillingRepository) begin(ctx context.Context) (store.Tx, error) {
	transactor, ok := r.db.(store.Transactor)
	if !ok {
		return noopTx{DBTX: r.db}, nil
	}
	return transactor.Begin(ctx)
}

func (input AdminBillingOperationInput) validate() error {
	if input.TenantID == "" ||
		input.ActorID == "" ||
		input.TargetUserID == "" ||
		input.Operation == "" ||
		input.IdempotencyKey == "" ||
		input.Rationale == "" ||
		input.Rationale == security.Redacted {
		return ErrAdminBillingValidation
	}
	switch input.Operation {
	case AdminBillingOperationManualCredit, AdminBillingOperationRefundNote, AdminBillingOperationSyncSubscription, AdminBillingOperationAccountLock:
		return nil
	default:
		return ErrAdminBillingValidation
	}
}

func (input AdminBillingOperationInput) requestedAt() time.Time {
	if input.RequestedAt.IsZero() {
		return time.Now().UTC()
	}
	return input.RequestedAt.UTC()
}

func (input AdminBillingOperationInput) result(now time.Time, status string) AdminBillingOperationResult {
	metadata := map[string]any{}
	for key, value := range input.Metadata {
		metadata[key] = value
	}
	if input.Locked != nil {
		metadata["locked"] = *input.Locked
	}
	return AdminBillingOperationResult{
		ID:             adminBillingOperationID(input),
		TenantID:       input.TenantID,
		ActorID:        input.ActorID,
		TargetUserID:   input.TargetUserID,
		Operation:      input.Operation,
		IdempotencyKey: input.IdempotencyKey,
		Status:         status,
		Units:          input.Units,
		BucketID:       input.BucketID,
		SubscriptionID: input.SubscriptionID,
		Provider:       input.Provider,
		ProviderRef:    input.ProviderRef,
		Rationale:      input.Rationale,
		Note:           input.Note,
		Locked:         input.Locked,
		Metadata:       security.RedactMap(metadata),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
}

func adminBillingOperationID(input AdminBillingOperationInput) string {
	hash := sha256.Sum256([]byte(input.TenantID + ":" + string(input.Operation) + ":" + input.IdempotencyKey))
	return fmt.Sprintf("billing_admin_%x", hash[:12])
}

func (input TeamSeatSyncInput) validate() error {
	if input.TenantID == "" ||
		input.TeamID == "" ||
		input.ActorID == "" ||
		input.Operation == "" ||
		input.IdempotencyKey == "" ||
		input.Rationale == "" ||
		input.Rationale == security.Redacted ||
		input.Usage.BillableSeats <= 0 ||
		input.Usage.SeatLimit <= 0 ||
		input.Usage.BillableSeats > input.Usage.SeatLimit {
		return ErrTeamSeatBillingValidation
	}
	return nil
}

func (input TeamBillingLinkInput) validate() error {
	if input.TenantID == "" ||
		input.TeamID == "" ||
		input.ActorID == "" ||
		input.ProviderSubscriptionID == "" ||
		input.ProviderSubscriptionItemID == "" ||
		input.IdempotencyKey == "" ||
		input.Rationale == "" ||
		input.Rationale == security.Redacted {
		return ErrTeamSeatBillingValidation
	}
	switch input.normalizedProvider() {
	case "stripe", "mock":
	default:
		return ErrTeamSeatBillingValidation
	}
	switch input.normalizedProrationBehavior() {
	case "create_prorations", "none", "always_invoice":
	default:
		return ErrTeamSeatBillingValidation
	}
	switch input.normalizedStatus() {
	case "active", "paused", "removed":
	default:
		return ErrTeamSeatBillingValidation
	}
	return nil
}

func (input *TeamBillingLinkInput) normalize() {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.TeamID = strings.TrimSpace(input.TeamID)
	input.ActorID = strings.TrimSpace(input.ActorID)
	input.Provider = strings.TrimSpace(input.Provider)
	input.ProviderSubscriptionID = strings.TrimSpace(input.ProviderSubscriptionID)
	input.ProviderSubscriptionItemID = strings.TrimSpace(input.ProviderSubscriptionItemID)
	input.PriceID = strings.TrimSpace(input.PriceID)
	input.ProrationBehavior = strings.TrimSpace(input.ProrationBehavior)
	input.Status = strings.TrimSpace(input.Status)
	input.Rationale = strings.TrimSpace(input.Rationale)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
}

func (input TeamSeatSyncInput) requestedAt(now func() time.Time) time.Time {
	if !input.RequestedAt.IsZero() {
		return input.RequestedAt.UTC()
	}
	if now != nil {
		return now().UTC()
	}
	return time.Now().UTC()
}

func (input TeamBillingLinkInput) requestedAt(now func() time.Time) time.Time {
	if !input.RequestedAt.IsZero() {
		return input.RequestedAt.UTC()
	}
	if now != nil {
		return now().UTC()
	}
	return time.Now().UTC()
}

func (input TeamBillingLinkInput) normalizedProvider() string {
	if input.Provider == "" {
		return "stripe"
	}
	return input.Provider
}

func (input TeamBillingLinkInput) normalizedProrationBehavior() string {
	if input.ProrationBehavior == "" {
		return "create_prorations"
	}
	return input.ProrationBehavior
}

func (input TeamBillingLinkInput) normalizedStatus() string {
	if input.Status == "" {
		return "active"
	}
	return input.Status
}

func (input TeamSeatSyncInput) result(now time.Time, status, reason string) TeamSeatSyncResult {
	return TeamSeatSyncResult{
		ID:                teamSeatSyncID(input.TenantID, input.TeamID, input.Operation, input.IdempotencyKey),
		TenantID:          input.TenantID,
		TeamID:            input.TeamID,
		RequestedQuantity: input.Usage.BillableSeats,
		SyncedQuantity:    0,
		ProrationBehavior: "create_prorations",
		Status:            status,
		Reason:            security.RedactString(reason),
		Operation:         input.Operation,
		IdempotencyKey:    input.IdempotencyKey,
		CreatedAt:         now.UTC(),
	}
}

func teamSeatSyncID(tenantID, teamID, operation, idempotencyKey string) string {
	hash := sha256.Sum256([]byte(tenantID + ":" + teamID + ":" + operation + ":" + idempotencyKey))
	return fmt.Sprintf("team_seat_sync_%x", hash[:12])
}

func firstTimeValue(values ...time.Time) time.Time {
	for _, value := range values {
		if !value.IsZero() {
			return value.UTC()
		}
	}
	return time.Now().UTC()
}

func (r AccountRepository) GetQuotaState(ctx context.Context, tenantID, userID string) (QuotaState, error) {
	if tenantID == "" || userID == "" {
		return QuotaState{}, errors.New("tenant_id and user_id are required")
	}
	rows, err := r.db.Query(ctx, `
SELECT id, limit_units, used_units, reserved_units, resets_at
FROM quota_buckets
WHERE tenant_id = $1
  AND subject_type = 'user'
  AND subject_id = $2
ORDER BY resets_at ASC, id ASC`,
		tenantID,
		userID,
	)
	if err != nil {
		return QuotaState{}, err
	}
	defer rows.Close()

	state := QuotaState{
		Buckets:      []QuotaBucketProjection{},
		Transactions: []QuotaTransactionProjection{},
	}
	for rows.Next() {
		var bucket QuotaBucketProjection
		if err := rows.Scan(&bucket.ID, &bucket.LimitUnits, &bucket.UsedUnits, &bucket.ReservedUnits, &bucket.ResetsAt); err != nil {
			return QuotaState{}, err
		}
		state.Buckets = append(state.Buckets, bucket)
	}
	if err := rows.Err(); err != nil {
		return QuotaState{}, err
	}

	txRows, err := r.db.Query(ctx, `
SELECT qt.id, qt.kind, qt.units, qt.status, qt.created_at
FROM quota_transactions qt
JOIN quota_buckets qb
  ON qb.id = qt.bucket_id
 AND qb.tenant_id = qt.tenant_id
WHERE qt.tenant_id = $1
  AND qb.subject_type = 'user'
  AND qb.subject_id = $2
ORDER BY qt.created_at DESC, qt.id DESC
LIMIT 25`,
		tenantID,
		userID,
	)
	if err != nil {
		return QuotaState{}, err
	}
	defer txRows.Close()
	for txRows.Next() {
		var tx QuotaTransactionProjection
		if err := txRows.Scan(&tx.ID, &tx.Kind, &tx.Units, &tx.Status, &tx.CreatedAt); err != nil {
			return QuotaState{}, err
		}
		state.Transactions = append(state.Transactions, tx)
	}
	if err := txRows.Err(); err != nil {
		return QuotaState{}, err
	}
	return state, nil
}

func (r AccountRepository) GetSubscription(ctx context.Context, tenantID, userID string) (UserSubscriptionProjection, error) {
	if tenantID == "" || userID == "" {
		return UserSubscriptionProjection{}, errors.New("tenant_id and user_id are required")
	}
	var sub UserSubscriptionProjection
	err := r.db.QueryRow(ctx, `
SELECT
	us.id,
	us.plan_id,
	us.status,
	us.current_period_start,
	us.current_period_end,
	us.provider,
	us.provider_ref,
	COALESCE((
		SELECT swe.provider_customer_id
		FROM stripe_webhook_events swe
		WHERE swe.tenant_id = us.tenant_id
		  AND swe.user_id = us.user_id
		  AND swe.provider_subscription_id = us.provider_ref
		  AND swe.provider_customer_id <> ''
		ORDER BY swe.updated_at DESC, swe.id DESC
		LIMIT 1
	), '')
FROM user_subscriptions us
WHERE us.tenant_id = $1
  AND us.user_id = $2
ORDER BY us.updated_at DESC, us.id DESC
LIMIT 1`,
		tenantID,
		userID,
	).Scan(
		&sub.ID,
		&sub.PlanID,
		&sub.Status,
		&sub.CurrentPeriodStart,
		&sub.CurrentPeriodEnd,
		&sub.Provider,
		&sub.ProviderRef,
		&sub.ProviderCustomerID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserSubscriptionProjection{}, ErrSubscriptionNotFound
	}
	if err != nil {
		return UserSubscriptionProjection{}, err
	}
	return sub, nil
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
	TaskRefType     string
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
	if usage.TaskRefType == "" {
		usage.TaskRefType = "agent_task"
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
	task_ref_type,
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
VALUES($1, $2, nullif($3, ''), nullif($4, ''), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
ON CONFLICT (id) DO NOTHING`,
		usage.ID,
		usage.TenantID,
		usage.UserID,
		usage.ProjectID,
		usage.TaskID,
		usage.TaskRefType,
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
var ErrSubscriptionNotFound = errors.New("subscription not found")
var ErrAdminBillingValidation = errors.New("admin billing validation failed")
var ErrTeamSeatBillingValidation = errors.New("team seat billing validation failed")
var ErrTeamSeatBillingProviderMissing = errors.New("team seat billing provider missing")

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

func decodeJSONMap(data []byte) map[string]any {
	if len(data) == 0 {
		return map[string]any{}
	}
	value := map[string]any{}
	if err := json.Unmarshal(data, &value); err != nil {
		return map[string]any{}
	}
	return security.RedactMap(value)
}

func redactedJSONMap(value map[string]any) []byte {
	return jsonMap(security.RedactMap(value))
}

func (p MockCheckoutProvider) NowOrDefault() time.Time {
	if p.Now != nil {
		return p.Now().UTC()
	}
	return time.Now().UTC()
}
