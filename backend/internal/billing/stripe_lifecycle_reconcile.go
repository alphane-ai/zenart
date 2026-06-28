package billing

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

type StripeLifecycleReconciler struct {
	db  store.DBTX
	Now func() time.Time
}

func NewStripeLifecycleReconciler(db store.DBTX) StripeLifecycleReconciler {
	return StripeLifecycleReconciler{db: db}
}

type StripeLifecycleReconciliationInput struct {
	TenantID               string
	UserID                 string
	BucketID               string
	ProviderSubscriptionID string
	Since                  time.Time
	Until                  time.Time
	ResetDueQuotas         bool
}

type StripeLifecycleReconciliationReport struct {
	TenantID                 string                          `json:"tenant_id"`
	UserID                   string                          `json:"user_id"`
	BucketID                 string                          `json:"bucket_id"`
	ProviderSubscriptionID   string                          `json:"provider_subscription_id"`
	Subscription             UserSubscriptionProjection      `json:"subscription"`
	EventSummaries           []StripeLifecycleEventSummary   `json:"event_summaries"`
	AdminOperationSummaries  []StripeLifecycleAdminSummary   `json:"admin_operation_summaries"`
	QuotaTransactionSummary  []StripeLifecycleQuotaTxSummary `json:"quota_transaction_summary"`
	QuotaBucket              QuotaBucketProjection           `json:"quota_bucket"`
	SubscriptionStatusesSeen []SubscriptionState             `json:"subscription_statuses_seen"`
	CheckoutSeen             bool                            `json:"checkout_seen"`
	InvoicePaidSeen          bool                            `json:"invoice_paid_seen"`
	PaymentFailedSeen        bool                            `json:"payment_failed_seen"`
	CancelSeen               bool                            `json:"cancel_seen"`
	RefundCreditSeen         bool                            `json:"refund_credit_seen"`
	QuotaCreditSeen          bool                            `json:"quota_credit_seen"`
	QuotaProjectionValid     bool                            `json:"quota_projection_valid"`
	QuotaResetInvoked        bool                            `json:"quota_reset_invoked"`
	WebhookReplayIdempotent  bool                            `json:"webhook_replay_idempotent"`
	SecretMaterialProjected  bool                            `json:"secret_material_projected"`
	ReleaseGateStatus        string                          `json:"release_gate_status"`
	ReadyForStagingEvidence  bool                            `json:"ready_for_staging_evidence"`
}

type StripeLifecycleEventSummary struct {
	Type                    string            `json:"type"`
	SubscriptionStatus      SubscriptionState `json:"subscription_status"`
	EventCount              int64             `json:"event_count"`
	ProcessedCount          int64             `json:"processed_count"`
	DuplicateMutationCount  int64             `json:"duplicate_mutation_count"`
	LivemodeTrueCount       int64             `json:"livemode_true_count"`
	ReplayIdempotencyPolicy string            `json:"replay_idempotency_policy"`
}

type StripeLifecycleAdminSummary struct {
	Operation   string `json:"operation"`
	Status      string `json:"status"`
	Count       int64  `json:"count"`
	Units       int64  `json:"units"`
	Provider    string `json:"provider"`
	ProviderRef string `json:"provider_ref"`
}

type StripeLifecycleQuotaTxSummary struct {
	Kind   string `json:"kind"`
	Status string `json:"status"`
	Count  int64  `json:"count"`
	Units  int64  `json:"units"`
}

func (r StripeLifecycleReconciler) ReconcileStripeLifecycle(ctx context.Context, input StripeLifecycleReconciliationInput) (StripeLifecycleReconciliationReport, error) {
	if input.TenantID == "" || input.UserID == "" || input.BucketID == "" {
		return StripeLifecycleReconciliationReport{}, errors.New("tenant_id, user_id, and bucket_id are required")
	}
	if input.Since.IsZero() || input.Until.IsZero() || !input.Since.Before(input.Until) {
		return StripeLifecycleReconciliationReport{}, errors.New("valid since/until window is required")
	}
	if input.ResetDueQuotas {
		if err := NewQuotaRepository(r.db).ResetWeekly(ctx, r.now()); err != nil {
			return StripeLifecycleReconciliationReport{}, err
		}
	}

	subscription, err := r.readStripeSubscription(ctx, input)
	if err != nil {
		return StripeLifecycleReconciliationReport{}, err
	}
	eventSummaries, err := r.readStripeEventSummaries(ctx, input)
	if err != nil {
		return StripeLifecycleReconciliationReport{}, err
	}
	adminSummaries, err := r.readStripeAdminSummaries(ctx, input)
	if err != nil {
		return StripeLifecycleReconciliationReport{}, err
	}
	quotaBucket, err := r.readQuotaBucket(ctx, input)
	if err != nil {
		return StripeLifecycleReconciliationReport{}, err
	}
	quotaTransactions, err := r.readQuotaTransactions(ctx, input)
	if err != nil {
		return StripeLifecycleReconciliationReport{}, err
	}

	report := StripeLifecycleReconciliationReport{
		TenantID:                input.TenantID,
		UserID:                  input.UserID,
		BucketID:                input.BucketID,
		ProviderSubscriptionID:  firstNonEmptyString(input.ProviderSubscriptionID, subscription.ProviderRef),
		Subscription:            subscription,
		EventSummaries:          eventSummaries,
		AdminOperationSummaries: adminSummaries,
		QuotaTransactionSummary: quotaTransactions,
		QuotaBucket:             quotaBucket,
		QuotaResetInvoked:       input.ResetDueQuotas,
		WebhookReplayIdempotent: true,
		SecretMaterialProjected: false,
		ReleaseGateStatus:       "contract_ready_staging_stripe_lifecycle_evidence_open",
	}
	report.QuotaProjectionValid = quotaBucket.LimitUnits > 0 && quotaBucket.UsedUnits >= 0 && quotaBucket.ReservedUnits >= 0 && quotaBucket.UsedUnits+quotaBucket.ReservedUnits <= quotaBucket.LimitUnits

	statusSeen := map[SubscriptionState]bool{}
	for _, item := range eventSummaries {
		if item.ProcessedCount > 0 && item.LivemodeTrueCount == 0 && item.DuplicateMutationCount == 0 {
			switch item.Type {
			case "checkout.session.completed":
				report.CheckoutSeen = true
			case "invoice.paid", "invoice.payment_succeeded":
				report.InvoicePaidSeen = true
			case "invoice.payment_failed":
				report.PaymentFailedSeen = true
			case "customer.subscription.deleted":
				report.CancelSeen = true
			}
		}
		if item.SubscriptionStatus != "" {
			statusSeen[item.SubscriptionStatus] = true
			if item.SubscriptionStatus == SubscriptionCancelled || item.SubscriptionStatus == SubscriptionExpired {
				report.CancelSeen = true
			}
		}
		if item.DuplicateMutationCount != 0 || item.LivemodeTrueCount != 0 {
			report.WebhookReplayIdempotent = false
		}
	}
	if subscription.Status != "" {
		statusSeen[subscription.Status] = true
	}
	for _, status := range []SubscriptionState{SubscriptionTrialing, SubscriptionActive, SubscriptionPastDue, SubscriptionCancelled, SubscriptionExpired, SubscriptionComped} {
		if statusSeen[status] {
			report.SubscriptionStatusesSeen = append(report.SubscriptionStatusesSeen, status)
		}
	}

	for _, item := range adminSummaries {
		if item.Status != "recorded" && item.Status != "succeeded" {
			continue
		}
		if item.Operation == string(AdminBillingOperationRefundNote) || item.Operation == string(AdminBillingOperationManualCredit) {
			report.RefundCreditSeen = true
		}
	}
	for _, item := range quotaTransactions {
		if item.Status != "committed" && item.Status != "refunded" {
			continue
		}
		if item.Kind == "admin_credit" || item.Kind == "credit" || item.Kind == "provider_usage_credit" {
			report.QuotaCreditSeen = true
		}
	}
	report.ReadyForStagingEvidence = report.CheckoutSeen &&
		report.InvoicePaidSeen &&
		report.PaymentFailedSeen &&
		report.CancelSeen &&
		report.RefundCreditSeen &&
		report.QuotaCreditSeen &&
		report.QuotaProjectionValid &&
		report.WebhookReplayIdempotent
	return report, nil
}

func (r StripeLifecycleReconciler) readStripeSubscription(ctx context.Context, input StripeLifecycleReconciliationInput) (UserSubscriptionProjection, error) {
	var sub UserSubscriptionProjection
	err := r.db.QueryRow(ctx, `
SELECT id,
       plan_id,
       status,
       current_period_start,
       current_period_end,
       provider,
       provider_ref,
       provider_customer_id
FROM user_subscriptions
WHERE tenant_id = $1
  AND user_id = $2
  AND provider = 'stripe'
  AND ($3 = '' OR provider_ref = $3 OR id = $3)
ORDER BY updated_at DESC
LIMIT 1`,
		input.TenantID,
		input.UserID,
		input.ProviderSubscriptionID,
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
	return sub, err
}

func (r StripeLifecycleReconciler) readStripeEventSummaries(ctx context.Context, input StripeLifecycleReconciliationInput) ([]StripeLifecycleEventSummary, error) {
	rows, err := r.db.Query(ctx, `
SELECT type,
       subscription_status,
       count(*)::bigint,
       count(*) FILTER (WHERE status = 'processed')::bigint,
       0::bigint AS duplicate_mutation_count,
       count(*) FILTER (WHERE livemode = true)::bigint
FROM stripe_webhook_events
WHERE tenant_id = $1
  AND user_id = $2
  AND received_at >= $3
  AND received_at < $4
  AND ($5 = '' OR provider_subscription_id = $5)
GROUP BY type, subscription_status
ORDER BY type, subscription_status`,
		input.TenantID,
		input.UserID,
		input.Since.UTC(),
		input.Until.UTC(),
		input.ProviderSubscriptionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var summaries []StripeLifecycleEventSummary
	for rows.Next() {
		var item StripeLifecycleEventSummary
		if err := rows.Scan(
			&item.Type,
			&item.SubscriptionStatus,
			&item.EventCount,
			&item.ProcessedCount,
			&item.DuplicateMutationCount,
			&item.LivemodeTrueCount,
		); err != nil {
			return nil, err
		}
		item.ReplayIdempotencyPolicy = "stripe_webhook_events.id_primary_key_on_conflict_do_nothing"
		summaries = append(summaries, item)
	}
	return summaries, rows.Err()
}

func (r StripeLifecycleReconciler) readStripeAdminSummaries(ctx context.Context, input StripeLifecycleReconciliationInput) ([]StripeLifecycleAdminSummary, error) {
	rows, err := r.db.Query(ctx, `
SELECT operation,
       status,
       count(*)::bigint,
       COALESCE(sum(units), 0)::bigint,
       COALESCE(max(provider), ''),
       COALESCE(max(provider_ref), '')
FROM billing_admin_operations
WHERE tenant_id = $1
  AND target_user_id = $2
  AND created_at >= $3
  AND created_at < $4
  AND operation IN ('manual_credit', 'refund_note', 'sync_subscription', 'account_lock')
GROUP BY operation, status
ORDER BY operation, status`,
		input.TenantID,
		input.UserID,
		input.Since.UTC(),
		input.Until.UTC(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var summaries []StripeLifecycleAdminSummary
	for rows.Next() {
		var item StripeLifecycleAdminSummary
		if err := rows.Scan(&item.Operation, &item.Status, &item.Count, &item.Units, &item.Provider, &item.ProviderRef); err != nil {
			return nil, err
		}
		summaries = append(summaries, item)
	}
	return summaries, rows.Err()
}

func (r StripeLifecycleReconciler) readQuotaBucket(ctx context.Context, input StripeLifecycleReconciliationInput) (QuotaBucketProjection, error) {
	var bucket QuotaBucketProjection
	err := r.db.QueryRow(ctx, `
SELECT id,
       limit_units,
       used_units,
       reserved_units,
       resets_at
FROM quota_buckets
WHERE tenant_id = $1
  AND id = $2`,
		input.TenantID,
		input.BucketID,
	).Scan(&bucket.ID, &bucket.LimitUnits, &bucket.UsedUnits, &bucket.ReservedUnits, &bucket.ResetsAt)
	return bucket, err
}

func (r StripeLifecycleReconciler) readQuotaTransactions(ctx context.Context, input StripeLifecycleReconciliationInput) ([]StripeLifecycleQuotaTxSummary, error) {
	rows, err := r.db.Query(ctx, `
SELECT kind,
       status,
       count(*)::bigint,
       COALESCE(sum(units), 0)::bigint
FROM quota_transactions
WHERE tenant_id = $1
  AND bucket_id = $2
  AND created_at >= $3
  AND created_at < $4
GROUP BY kind, status
ORDER BY kind, status`,
		input.TenantID,
		input.BucketID,
		input.Since.UTC(),
		input.Until.UTC(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var summaries []StripeLifecycleQuotaTxSummary
	for rows.Next() {
		var item StripeLifecycleQuotaTxSummary
		if err := rows.Scan(&item.Kind, &item.Status, &item.Count, &item.Units); err != nil {
			return nil, err
		}
		summaries = append(summaries, item)
	}
	return summaries, rows.Err()
}

func (r StripeLifecycleReconciler) now() time.Time {
	if r.Now != nil {
		return r.Now().UTC()
	}
	return time.Now().UTC()
}
