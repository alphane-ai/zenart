package task

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type BatchStatus string

const (
	BatchStatusQueued           BatchStatus = "queued"
	BatchStatusRunning          BatchStatus = "running"
	BatchStatusPartialSucceeded BatchStatus = "partial_succeeded"
	BatchStatusSucceeded        BatchStatus = "succeeded"
	BatchStatusFailed           BatchStatus = "failed"
	BatchStatusCancelled        BatchStatus = "cancelled"
	BatchStatusBlocked          BatchStatus = "blocked"
)

type ChildStatus string

const (
	ChildStatusQueued    ChildStatus = "queued"
	ChildStatusRunning   ChildStatus = "running"
	ChildStatusSucceeded ChildStatus = "succeeded"
	ChildStatusFailed    ChildStatus = "failed"
	ChildStatusCancelled ChildStatus = "cancelled"
	ChildStatusBlocked   ChildStatus = "blocked"
)

type PromptContext struct {
	Text              string   `json:"text"`
	SelectedObjectIDs []string `json:"selected_object_ids,omitempty"`
	ReferenceAssetIDs []string `json:"reference_asset_ids,omitempty"`
	BrandKitID        string   `json:"brand_kit_id,omitempty"`
	ModelHints        []string `json:"model_hints,omitempty"`
	ToolHint          string   `json:"tool_hint,omitempty"`
}

type BatchGenerationRequest struct {
	ID                  string                `json:"id"`
	TenantID            string                `json:"tenant_id"`
	UserID              string                `json:"user_id"`
	ProjectID           string                `json:"project_id"`
	WorkspaceID         string                `json:"workspace_id"`
	PromptContext       PromptContext         `json:"prompt_context"`
	RequestedCount      int                   `json:"requested_count"`
	AllowedModels       []string              `json:"allowed_models,omitempty"`
	QuotaReservationID  string                `json:"quota_reservation_id"`
	QuotaBucketID       string                `json:"-"`
	QuotaEstimatedUnits int64                 `json:"quota_estimated_units"`
	QuotaCommittedUnits int64                 `json:"quota_committed_units"`
	QuotaRefundedUnits  int64                 `json:"quota_refunded_units"`
	TraceID             string                `json:"trace_id"`
	Status              BatchStatus           `json:"status"`
	Children            []GenerationChildTask `json:"children"`
	Metadata            map[string]string     `json:"metadata,omitempty"`
	CreatedAt           time.Time             `json:"created_at"`
	UpdatedAt           time.Time             `json:"updated_at"`
}

type GenerationChildTask struct {
	ID                  string            `json:"id"`
	BatchID             string            `json:"batch_id"`
	TenantID            string            `json:"tenant_id"`
	Status              ChildStatus       `json:"status"`
	ProviderID          string            `json:"provider_id"`
	ModelID             string            `json:"model_id"`
	ToolType            string            `json:"tool_type"`
	Seed                string            `json:"seed,omitempty"`
	RetryCount          int               `json:"retry_count"`
	MaxRetries          int               `json:"max_retries"`
	QuotaEstimateUnits  int64             `json:"quota_estimate_units"`
	QuotaCommittedUnits int64             `json:"quota_committed_units"`
	QuotaRefundedUnits  int64             `json:"quota_refunded_units"`
	AssetID             string            `json:"asset_id,omitempty"`
	CanvasObjectID      string            `json:"canvas_object_id,omitempty"`
	TraceID             string            `json:"trace_id"`
	VisibleTraceRef     string            `json:"visible_trace_ref,omitempty"`
	FailureCode         string            `json:"failure_code,omitempty"`
	FailureMessage      string            `json:"failure_message,omitempty"`
	ReviewReason        string            `json:"review_reason,omitempty"`
	Metadata            map[string]string `json:"metadata,omitempty"`
	CreatedAt           time.Time         `json:"created_at"`
	UpdatedAt           time.Time         `json:"updated_at"`
}

type BatchProgress struct {
	BatchID        string      `json:"batch_id"`
	Status         BatchStatus `json:"status"`
	RequestedCount int         `json:"requested_count"`
	Queued         int         `json:"queued"`
	Running        int         `json:"running"`
	Succeeded      int         `json:"succeeded"`
	Failed         int         `json:"failed"`
	Cancelled      int         `json:"cancelled"`
	Blocked        int         `json:"blocked"`
	Retryable      int         `json:"retryable"`
}

type AdminBatchQueueRuntime struct {
	ID                       string      `json:"id"`
	BatchID                  string      `json:"batch_id"`
	TenantID                 string      `json:"tenant_id"`
	ProjectID                string      `json:"project_id"`
	WorkspaceID              string      `json:"workspace_id"`
	Status                   BatchStatus `json:"status"`
	RequestedCount           int         `json:"requested_count"`
	Queued                   int         `json:"queued"`
	Running                  int         `json:"running"`
	Succeeded                int         `json:"succeeded"`
	Failed                   int         `json:"failed"`
	Cancelled                int         `json:"cancelled"`
	Blocked                  int         `json:"blocked"`
	Retryable                int         `json:"retryable"`
	WorkerID                 string      `json:"worker_id"`
	ClaimTimeoutSeconds      int         `json:"claim_timeout_seconds"`
	OldestChildAgeMinutes    int         `json:"oldest_child_age_minutes"`
	ProviderID               string      `json:"provider_id"`
	ModelID                  string      `json:"model_id"`
	ToolType                 string      `json:"tool_type"`
	ProviderStrategyGroupID  string      `json:"provider_strategy_group_id"`
	ProviderSelectionPolicy  string      `json:"provider_selection_policy"`
	ProviderConcurrency      string      `json:"provider_concurrency"`
	ProviderModelConcurrency string      `json:"provider_model_concurrency"`
	ClaimLeasePolicy         string      `json:"claim_lease_policy"`
	DrainPolicy              string      `json:"drain_policy"`
	QuotaPolicy              string      `json:"quota_policy"`
	DeadLetterPolicy         string      `json:"dead_letter_policy"`
	IdempotencyScope         string      `json:"idempotency_scope"`
	NextOperatorAction       string      `json:"next_operator_action"`
	AuditRef                 string      `json:"audit_ref"`
	EvidenceRefs             []string    `json:"evidence_refs"`
}

type AdminBatchChildTask struct {
	ID                  string      `json:"id"`
	BatchID             string      `json:"batch_id"`
	TenantID            string      `json:"tenant_id"`
	Status              ChildStatus `json:"status"`
	ProviderID          string      `json:"provider_id"`
	ModelID             string      `json:"model_id"`
	ToolType            string      `json:"tool_type"`
	RetryCount          int         `json:"retry_count"`
	MaxRetries          int         `json:"max_retries"`
	WorkerID            string      `json:"worker_id"`
	ClaimAttempt        int         `json:"claim_attempt"`
	ClaimExpiresAt      string      `json:"claim_expires_at"`
	FanoutStage         string      `json:"fanout_stage"`
	FailureCode         string      `json:"failure_code"`
	ReviewReason        string      `json:"review_reason"`
	QuotaEstimateUnits  int64       `json:"quota_estimate_units"`
	QuotaCommittedUnits int64       `json:"quota_committed_units"`
	QuotaRefundedUnits  int64       `json:"quota_refunded_units"`
	RetryState          string      `json:"retry_state"`
	DeadLetterState     string      `json:"dead_letter_state"`
	ResultAssetID       string      `json:"result_asset_id"`
	CanvasObjectID      string      `json:"canvas_object_id"`
	VisibleTraceRef     string      `json:"visible_trace_ref"`
	ProviderUsageRef    string      `json:"provider_usage_ref"`
	IdempotencyKey      string      `json:"idempotency_key"`
	OperatorAction      string      `json:"operator_action"`
	AuditRef            string      `json:"audit_ref"`
	EvidenceRefs        []string    `json:"evidence_refs"`
}

func ValidateBatchGenerationRequest(batch BatchGenerationRequest) error {
	if strings.TrimSpace(batch.ID) == "" || strings.TrimSpace(batch.TenantID) == "" || strings.TrimSpace(batch.UserID) == "" {
		return errors.New("batch id, tenant_id, and user_id are required")
	}
	if strings.TrimSpace(batch.ProjectID) == "" || strings.TrimSpace(batch.WorkspaceID) == "" {
		return errors.New("project_id and workspace_id are required")
	}
	if strings.TrimSpace(batch.PromptContext.Text) == "" {
		return errors.New("prompt_context.text is required")
	}
	if batch.RequestedCount <= 0 {
		return errors.New("requested_count must be positive")
	}
	if batch.RequestedCount > 20 {
		return errors.New("requested_count must be <= 20")
	}
	if strings.TrimSpace(batch.QuotaReservationID) == "" {
		return errors.New("quota_reservation_id is required")
	}
	if batch.QuotaEstimatedUnits < 0 || batch.QuotaCommittedUnits < 0 || batch.QuotaRefundedUnits < 0 {
		return errors.New("quota units must be non-negative")
	}
	if batch.QuotaCommittedUnits+batch.QuotaRefundedUnits > batch.QuotaEstimatedUnits {
		return errors.New("committed plus refunded quota units must not exceed estimated units")
	}
	if strings.TrimSpace(batch.TraceID) == "" {
		return errors.New("trace_id is required")
	}
	if !validBatchStatus(batch.Status) {
		return fmt.Errorf("unsupported batch status %q", batch.Status)
	}
	if len(batch.Children) > batch.RequestedCount {
		return errors.New("child task count must not exceed requested_count")
	}
	for _, child := range batch.Children {
		if err := ValidateGenerationChildTask(child); err != nil {
			return err
		}
		if child.BatchID != batch.ID {
			return fmt.Errorf("child %s batch_id %q must match batch id %q", child.ID, child.BatchID, batch.ID)
		}
		if child.TenantID != batch.TenantID {
			return fmt.Errorf("child %s tenant_id %q must match batch tenant_id %q", child.ID, child.TenantID, batch.TenantID)
		}
	}
	if len(batch.Children) > 0 {
		if got := AggregateBatchStatus(batch.Children); got != batch.Status {
			return fmt.Errorf("batch status %q does not match child aggregate %q", batch.Status, got)
		}
	}
	return nil
}

func ValidateGenerationChildTask(child GenerationChildTask) error {
	if strings.TrimSpace(child.ID) == "" || strings.TrimSpace(child.BatchID) == "" || strings.TrimSpace(child.TenantID) == "" {
		return errors.New("child id, batch_id, and tenant_id are required")
	}
	if !validChildStatus(child.Status) {
		return fmt.Errorf("unsupported child status %q", child.Status)
	}
	if strings.TrimSpace(child.ProviderID) == "" || strings.TrimSpace(child.ModelID) == "" || strings.TrimSpace(child.ToolType) == "" {
		return errors.New("child provider_id, model_id, and tool_type are required")
	}
	if child.RetryCount < 0 || child.MaxRetries < 0 || child.RetryCount > child.MaxRetries {
		return errors.New("child retry_count must be between 0 and max_retries")
	}
	if child.QuotaEstimateUnits < 0 || child.QuotaCommittedUnits < 0 || child.QuotaRefundedUnits < 0 {
		return errors.New("child quota units must be non-negative")
	}
	if child.QuotaCommittedUnits+child.QuotaRefundedUnits > child.QuotaEstimateUnits {
		return errors.New("child committed plus refunded quota units must not exceed estimate")
	}
	if isTerminalChildStatus(child.Status) && child.QuotaCommittedUnits+child.QuotaRefundedUnits != child.QuotaEstimateUnits {
		return errors.New("terminal child tasks must fully account estimated quota")
	}
	if strings.TrimSpace(child.TraceID) == "" {
		return errors.New("child trace_id is required")
	}
	if child.Status == ChildStatusSucceeded {
		if strings.TrimSpace(child.AssetID) == "" || strings.TrimSpace(child.CanvasObjectID) == "" {
			return errors.New("succeeded child tasks must include asset_id and canvas_object_id")
		}
		if child.QuotaCommittedUnits <= 0 && child.QuotaEstimateUnits > 0 {
			return errors.New("succeeded child tasks must commit quota")
		}
	}
	if child.Status == ChildStatusBlocked && strings.TrimSpace(child.ReviewReason) == "" {
		return errors.New("blocked child tasks must include review_reason")
	}
	if child.Status == ChildStatusFailed && strings.TrimSpace(child.FailureCode) == "" {
		return errors.New("failed child tasks must include failure_code")
	}
	return nil
}

func AggregateBatchStatus(children []GenerationChildTask) BatchStatus {
	if len(children) == 0 {
		return BatchStatusQueued
	}
	var queued, running, succeeded, failed, cancelled, blocked int
	for _, child := range children {
		switch child.Status {
		case ChildStatusQueued:
			queued++
		case ChildStatusRunning:
			running++
		case ChildStatusSucceeded:
			succeeded++
		case ChildStatusFailed:
			failed++
		case ChildStatusCancelled:
			cancelled++
		case ChildStatusBlocked:
			blocked++
		}
	}
	if running > 0 {
		return BatchStatusRunning
	}
	if queued > 0 {
		if succeeded+failed+cancelled+blocked > 0 {
			return BatchStatusRunning
		}
		return BatchStatusQueued
	}
	if blocked > 0 && succeeded+failed+cancelled == 0 {
		return BatchStatusBlocked
	}
	if cancelled > 0 && succeeded+failed+blocked == 0 {
		return BatchStatusCancelled
	}
	if failed > 0 && succeeded == 0 && blocked == 0 {
		return BatchStatusFailed
	}
	if succeeded == len(children) {
		return BatchStatusSucceeded
	}
	return BatchStatusPartialSucceeded
}

func BuildBatchProgress(batch BatchGenerationRequest) BatchProgress {
	progress := BatchProgress{
		BatchID:        batch.ID,
		Status:         batch.Status,
		RequestedCount: batch.RequestedCount,
	}
	for _, child := range batch.Children {
		switch child.Status {
		case ChildStatusQueued:
			progress.Queued++
		case ChildStatusRunning:
			progress.Running++
		case ChildStatusSucceeded:
			progress.Succeeded++
		case ChildStatusFailed:
			progress.Failed++
			if childFailureRetryable(child) {
				progress.Retryable++
			}
		case ChildStatusCancelled:
			progress.Cancelled++
		case ChildStatusBlocked:
			progress.Blocked++
		}
	}
	return progress
}

func validBatchStatus(status BatchStatus) bool {
	switch status {
	case BatchStatusQueued, BatchStatusRunning, BatchStatusPartialSucceeded, BatchStatusSucceeded, BatchStatusFailed, BatchStatusCancelled, BatchStatusBlocked:
		return true
	default:
		return false
	}
}

func validChildStatus(status ChildStatus) bool {
	switch status {
	case ChildStatusQueued, ChildStatusRunning, ChildStatusSucceeded, ChildStatusFailed, ChildStatusCancelled, ChildStatusBlocked:
		return true
	default:
		return false
	}
}

func isTerminalChildStatus(status ChildStatus) bool {
	switch status {
	case ChildStatusSucceeded, ChildStatusFailed, ChildStatusCancelled, ChildStatusBlocked:
		return true
	default:
		return false
	}
}
