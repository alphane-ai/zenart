package billing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

type ProviderCostReconciler struct {
	db  store.DBTX
	Now func() time.Time
}

func NewProviderCostReconciler(db store.DBTX) ProviderCostReconciler {
	return ProviderCostReconciler{db: db}
}

type ProviderCostReconciliationInput struct {
	TenantID            string
	BucketID            string
	Since               time.Time
	Until               time.Time
	DailySpendCapCents  int64
	OutlierCostMultiple float64
	Limit               int
}

type ProviderCostReconciliationReport struct {
	ID                 string                           `json:"id"`
	TenantID           string                           `json:"tenant_id"`
	BucketID           string                           `json:"bucket_id"`
	WindowStart        time.Time                        `json:"window_start"`
	WindowEnd          time.Time                        `json:"window_end"`
	Currency           string                           `json:"currency"`
	TotalCostCents     int64                            `json:"total_cost_cents"`
	DailySpendCapCents int64                            `json:"daily_spend_cap_cents,omitempty"`
	SpendCapExceeded   bool                             `json:"spend_cap_exceeded"`
	TaskCount          int                              `json:"task_count"`
	ReconciledCount    int                              `json:"reconciled_count"`
	ManualReviewCount  int                              `json:"manual_review_count"`
	OutlierCount       int                              `json:"outlier_count"`
	Tasks              []ProviderCostTaskReconciliation `json:"tasks"`
	GeneratedAt        time.Time                        `json:"generated_at"`
	ReleaseGateStatus  string                           `json:"release_gate_status"`
	RequiredEvidence   []string                         `json:"required_evidence"`
}

type ProviderCostTaskReconciliation struct {
	TaskID                    string `json:"task_id"`
	BatchID                   string `json:"batch_id,omitempty"`
	ProviderID                string `json:"provider_id"`
	ModelID                   string `json:"model_id"`
	QuotaIdempotencyKey       string `json:"quota_idempotency_key,omitempty"`
	ProviderLogCount          int64  `json:"provider_log_count"`
	ActualUsageUnits          int64  `json:"actual_usage_units"`
	AccountedQuotaUnits       int64  `json:"accounted_quota_units"`
	AdjustmentKind            string `json:"adjustment_kind,omitempty"`
	AdjustedUnits             int64  `json:"adjusted_units,omitempty"`
	AdjustmentAlreadyRecorded bool   `json:"adjustment_already_recorded,omitempty"`
	CostCents                 int64  `json:"cost_cents"`
	Currency                  string `json:"currency"`
	MaxCostUnits              int64  `json:"max_cost_units,omitempty"`
	EstimatedCostCents        int64  `json:"estimated_cost_cents,omitempty"`
	UsageOutlier              bool   `json:"usage_outlier"`
	SpendCapExceeded          bool   `json:"spend_cap_exceeded"`
	Status                    string `json:"status"`
	Reason                    string `json:"reason,omitempty"`
}

type providerCostUsageRow struct {
	TaskID              string
	BatchID             string
	ProviderID          string
	ModelID             string
	QuotaIdempotencyKey string
	ProviderLogCount    int64
	ActualUsageUnits    int64
	CostCents           int64
	MaxCostUnits        int64
	EstimatedCostCents  int64
	Currency            string
}

func (r ProviderCostReconciler) ReconcileProviderCost(ctx context.Context, input ProviderCostReconciliationInput) (ProviderCostReconciliationReport, error) {
	if r.db == nil {
		return ProviderCostReconciliationReport{}, errors.New("provider cost reconciliation database is required")
	}
	input.normalize(r.now())
	if input.TenantID == "" || input.BucketID == "" {
		return ProviderCostReconciliationReport{}, errors.New("tenant_id and bucket_id are required")
	}
	if !input.Until.After(input.Since) {
		return ProviderCostReconciliationReport{}, errors.New("provider cost reconciliation window is invalid")
	}

	rows, err := r.providerCostUsageRows(ctx, input)
	if err != nil {
		return ProviderCostReconciliationReport{}, err
	}
	totalCostCents := int64(0)
	currency := "USD"
	for _, row := range rows {
		totalCostCents += row.CostCents
		if strings.TrimSpace(row.Currency) != "" {
			currency = row.Currency
		}
	}

	report := ProviderCostReconciliationReport{
		ID:                 providerCostReconciliationID(input.TenantID, input.BucketID, input.Since, input.Until),
		TenantID:           input.TenantID,
		BucketID:           input.BucketID,
		WindowStart:        input.Since,
		WindowEnd:          input.Until,
		Currency:           currency,
		TotalCostCents:     totalCostCents,
		DailySpendCapCents: input.DailySpendCapCents,
		SpendCapExceeded:   input.DailySpendCapCents > 0 && totalCostCents > input.DailySpendCapCents,
		Tasks:              []ProviderCostTaskReconciliation{},
		GeneratedAt:        r.now(),
		ReleaseGateStatus:  "contract_ready_staging_provider_invoice_usage_evidence_open",
		RequiredEvidence: []string{
			"real provider usage export",
			"real provider invoice or billing-period spend report",
			"staging quota transaction reconciliation replay",
		},
	}

	quota := NewQuotaRepository(r.db)
	for _, row := range rows {
		task := ProviderCostTaskReconciliation{
			TaskID:              row.TaskID,
			BatchID:             row.BatchID,
			ProviderID:          row.ProviderID,
			ModelID:             row.ModelID,
			QuotaIdempotencyKey: row.QuotaIdempotencyKey,
			ProviderLogCount:    row.ProviderLogCount,
			ActualUsageUnits:    row.ActualUsageUnits,
			CostCents:           row.CostCents,
			Currency:            firstNonEmptyString(row.Currency, currency),
			MaxCostUnits:        row.MaxCostUnits,
			EstimatedCostCents:  row.EstimatedCostCents,
			UsageOutlier:        providerCostUsageOutlier(row, input.OutlierCostMultiple),
			SpendCapExceeded:    report.SpendCapExceeded,
		}
		if task.UsageOutlier {
			report.OutlierCount++
		}
		if task.QuotaIdempotencyKey == "" {
			task.Status = "manual_review"
			task.Reason = "quota_idempotency_key_missing"
			report.ManualReviewCount++
			if err := r.markProviderCostTask(ctx, input.TenantID, report.ID, task); err != nil {
				return ProviderCostReconciliationReport{}, err
			}
			report.Tasks = append(report.Tasks, task)
			continue
		}

		reconciliation, err := quota.ReconcileProviderUsage(ctx, input.TenantID, input.BucketID, task.TaskID, task.QuotaIdempotencyKey)
		if errors.Is(err, ErrProviderUsageMissing) {
			task.Status = "manual_review"
			task.Reason = "provider_usage_missing"
			report.ManualReviewCount++
			if err := r.markProviderCostTask(ctx, input.TenantID, report.ID, task); err != nil {
				return ProviderCostReconciliationReport{}, err
			}
			report.Tasks = append(report.Tasks, task)
			continue
		}
		if err != nil {
			return ProviderCostReconciliationReport{}, err
		}
		task.ProviderLogCount = reconciliation.ProviderLogCount
		task.ActualUsageUnits = reconciliation.ActualUsageUnits
		task.AccountedQuotaUnits = reconciliation.AccountedQuotaUnits
		task.AdjustmentKind = reconciliation.AdjustmentKind
		task.AdjustedUnits = reconciliation.AdjustedUnits
		task.AdjustmentAlreadyRecorded = reconciliation.AdjustmentAlreadyRecorded
		task.Status = "reconciled"
		report.ReconciledCount++
		if err := r.markProviderCostTask(ctx, input.TenantID, report.ID, task); err != nil {
			return ProviderCostReconciliationReport{}, err
		}
		report.Tasks = append(report.Tasks, task)
	}
	report.TaskCount = len(report.Tasks)
	return report, nil
}

func (r ProviderCostReconciler) providerCostUsageRows(ctx context.Context, input ProviderCostReconciliationInput) ([]providerCostUsageRow, error) {
	rows, err := r.db.Query(ctx, `
SELECT
	pul.task_id,
	COALESCE(max(pul.metadata->>'batch_id'), ''),
	COALESCE(max(pul.provider_id), ''),
	COALESCE(max(pul.model_id), ''),
	count(*),
	COALESCE(sum(pul.usage_units), 0),
	COALESCE(sum(pul.cost_cents), 0),
	COALESCE(max(pmc.max_cost_units), 0),
	COALESCE(max(pmc.estimated_cost_cents), 0),
	COALESCE(NULLIF(max(pmc.cost_currency), ''), 'USD'),
	COALESCE(max(pul.metadata->>'quota_idempotency_key'), '')
FROM provider_usage_logs pul
LEFT JOIN provider_model_capabilities pmc
  ON pmc.provider_id = pul.provider_id
 AND pmc.model_id = pul.model_id
WHERE pul.tenant_id = $1
  AND pul.created_at >= $2
  AND pul.created_at < $3
  AND pul.status IN ('recorded', 'reconciled')
GROUP BY pul.task_id
ORDER BY max(pul.created_at) ASC, pul.task_id ASC
LIMIT $4`,
		input.TenantID,
		input.Since,
		input.Until,
		input.Limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []providerCostUsageRow{}
	for rows.Next() {
		var row providerCostUsageRow
		if err := rows.Scan(
			&row.TaskID,
			&row.BatchID,
			&row.ProviderID,
			&row.ModelID,
			&row.ProviderLogCount,
			&row.ActualUsageUnits,
			&row.CostCents,
			&row.MaxCostUnits,
			&row.EstimatedCostCents,
			&row.Currency,
			&row.QuotaIdempotencyKey,
		); err != nil {
			return nil, err
		}
		row.TaskID = strings.TrimSpace(row.TaskID)
		row.BatchID = strings.TrimSpace(row.BatchID)
		row.ProviderID = strings.TrimSpace(row.ProviderID)
		row.ModelID = strings.TrimSpace(row.ModelID)
		row.Currency = firstNonEmptyString(strings.TrimSpace(row.Currency), "USD")
		row.QuotaIdempotencyKey = strings.TrimSpace(row.QuotaIdempotencyKey)
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r ProviderCostReconciler) markProviderCostTask(ctx context.Context, tenantID, reconciliationID string, task ProviderCostTaskReconciliation) error {
	_, err := r.db.Exec(ctx, `
UPDATE provider_usage_logs
SET metadata = metadata || $3
WHERE tenant_id = $1
  AND task_id = $2
  AND status IN ('recorded', 'reconciled')`,
		tenantID,
		task.TaskID,
		jsonMap(map[string]any{
			"provider_cost_reconciliation_id":  reconciliationID,
			"provider_cost_status":             task.Status,
			"provider_cost_reason":             task.Reason,
			"provider_cost_adjustment_kind":    task.AdjustmentKind,
			"provider_cost_adjusted_units":     task.AdjustedUnits,
			"provider_cost_usage_outlier":      task.UsageOutlier,
			"provider_cost_spend_cap_exceeded": task.SpendCapExceeded,
			"provider_cost_reconciled_at":      r.now().Format(time.RFC3339Nano),
		}),
	)
	return err
}

func (input *ProviderCostReconciliationInput) normalize(now time.Time) {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.BucketID = strings.TrimSpace(input.BucketID)
	if input.Until.IsZero() {
		input.Until = now
	}
	input.Until = input.Until.UTC()
	if input.Since.IsZero() {
		input.Since = input.Until.Add(-24 * time.Hour)
	}
	input.Since = input.Since.UTC()
	if input.Limit <= 0 || input.Limit > 500 {
		input.Limit = 100
	}
	if input.OutlierCostMultiple < 1 {
		input.OutlierCostMultiple = 2
	}
}

func (r ProviderCostReconciler) now() time.Time {
	if r.Now != nil {
		return r.Now().UTC()
	}
	return time.Now().UTC()
}

func providerCostUsageOutlier(row providerCostUsageRow, costMultiple float64) bool {
	logCount := row.ProviderLogCount
	if logCount <= 0 {
		logCount = 1
	}
	if row.MaxCostUnits > 0 && row.ActualUsageUnits > row.MaxCostUnits*logCount {
		return true
	}
	if row.EstimatedCostCents > 0 && float64(row.CostCents) > float64(row.EstimatedCostCents*logCount)*costMultiple {
		return true
	}
	return false
}

func providerCostReconciliationID(tenantID, bucketID string, since, until time.Time) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s:%s", tenantID, bucketID, since.UTC().Format(time.RFC3339Nano), until.UTC().Format(time.RFC3339Nano))))
	return "provider_cost_reconcile_" + hex.EncodeToString(sum[:8])
}
