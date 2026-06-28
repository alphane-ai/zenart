package task

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/id"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
)

type batchStoreKey struct{}

type BatchCreateInput struct {
	TenantID        string
	UserID          string
	ProjectID       string
	WorkspaceID     string
	PromptContext   PromptContext
	RequestedCount  int
	AllowedModels   []string
	IdempotencyKey  string
	QuotaUnitPerJob int64
}

type CompleteChildSuccessInput struct {
	TenantID            string
	ChildID             string
	AssetID             string
	CanvasObjectID      string
	QuotaCommittedUnits int64
	QuotaRefundedUnits  int64
	Metadata            map[string]string
}

type CompleteChildFailureInput struct {
	TenantID           string
	ChildID            string
	FailureCode        string
	FailureMessage     string
	QuotaRefundedUnits int64
	Retryable          bool
	Metadata           map[string]string
}

type BlockChildForReviewInput struct {
	TenantID           string
	ChildID            string
	ReviewReason       string
	QuotaRefundedUnits int64
	Metadata           map[string]string
}

type BatchStore interface {
	CreateBatch(ctx context.Context, input BatchCreateInput) (BatchGenerationRequest, error)
	GetBatch(ctx context.Context, tenantID, batchID string) (BatchGenerationRequest, error)
	ListBatchChildren(ctx context.Context, tenantID, batchID string) ([]GenerationChildTask, error)
	GetBatchProgress(ctx context.Context, tenantID, batchID string) (BatchProgress, error)
	CancelBatch(ctx context.Context, tenantID, batchID string) (BatchGenerationRequest, error)
	RetryChild(ctx context.Context, tenantID, childID string) (GenerationChildTask, error)
	MarkChildRetryScheduled(ctx context.Context, input CompleteChildFailureInput) (GenerationChildTask, error)
	BlockChildForReview(ctx context.Context, input BlockChildForReviewInput) (GenerationChildTask, error)
	ClaimRunnableChildren(ctx context.Context, policy BatchSchedulePolicy) (BatchScheduleClaim, error)
}

type AdminBatchQueueReader interface {
	ListAdminBatchQueueRuntime(ctx context.Context, tenantID string, limit int) ([]AdminBatchQueueRuntime, error)
	ListAdminBatchChildTasks(ctx context.Context, tenantID string, limit int) ([]AdminBatchChildTask, error)
}

func ContextWithBatchStore(ctx context.Context, store BatchStore) context.Context {
	return context.WithValue(ctx, batchStoreKey{}, store)
}

func BatchStoreFromContext(ctx context.Context) (BatchStore, bool) {
	store, ok := ctx.Value(batchStoreKey{}).(BatchStore)
	return store, ok
}

type BatchRepository struct {
	db                  store.DBTX
	ledger              BatchQuotaLedger
	strategyGroupReader StrategyGroupReader
}

func NewBatchRepository(db store.DBTX) BatchRepository {
	return BatchRepository{db: db}
}

func (r BatchRepository) WithQuotaLedger(ledger BatchQuotaLedger) BatchRepository {
	r.ledger = ledger
	return r
}

func (r BatchRepository) WithStrategyGroupReader(reader StrategyGroupReader) BatchRepository {
	r.strategyGroupReader = reader
	return r
}

var (
	ErrBatchValidation = errors.New("batch generation validation error")
	ErrBatchConflict   = errors.New("batch generation state conflict")
)

func (r BatchRepository) CreateBatch(ctx context.Context, input BatchCreateInput) (BatchGenerationRequest, error) {
	if r.db == nil {
		return BatchGenerationRequest{}, errors.New("batch generation database is required")
	}
	normalized, err := normalizeBatchCreateInput(input)
	if err != nil {
		return BatchGenerationRequest{}, err
	}
	if normalized.IdempotencyKey != "" {
		existingID, err := r.findBatchByIdempotency(ctx, normalized.TenantID, normalized.IdempotencyKey)
		if err != nil {
			return BatchGenerationRequest{}, err
		}
		if existingID != "" {
			return r.GetBatch(ctx, normalized.TenantID, existingID)
		}
	}

	now := time.Now().UTC()
	batch := BatchGenerationRequest{
		ID:                  id.New("batch"),
		TenantID:            normalized.TenantID,
		UserID:              normalized.UserID,
		ProjectID:           normalized.ProjectID,
		WorkspaceID:         normalized.WorkspaceID,
		PromptContext:       normalized.PromptContext,
		RequestedCount:      normalized.RequestedCount,
		AllowedModels:       normalized.AllowedModels,
		QuotaReservationID:  id.New("quota_reservation"),
		QuotaEstimatedUnits: int64(normalized.RequestedCount) * normalized.QuotaUnitPerJob,
		TraceID:             id.New("trace_batch"),
		Status:              BatchStatusQueued,
		Metadata: map[string]string{
			"source":         "api",
			"fanout_stage":   "queued_children_created_by_api",
			"scheduler_note": "worker_policy_fanout_pending",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if r.ledger != nil {
		bucketID, err := r.ledger.ResolveBatchQuotaBucket(ctx, batch.TenantID, batch.UserID)
		if err != nil {
			return BatchGenerationRequest{}, err
		}
		batch.QuotaBucketID = bucketID
	}
	if normalized.IdempotencyKey != "" {
		batch.Metadata["idempotency_fingerprint"] = idempotencyFingerprint(normalized.TenantID, normalized.IdempotencyKey)
	}
	toolType := pickToolType(normalized.PromptContext.ToolHint)
	modelID := pickModelID(normalized.AllowedModels, normalized.PromptContext.ModelHints)
	for idx := 0; idx < normalized.RequestedCount; idx++ {
		routing := r.routeBatchChild(ctx, toolType, idx)
		childMetadata := map[string]string{
			"source":                   "api",
			"fanout_index":             fmt.Sprintf("%d", idx),
			"routing_selection_reason": routing.SelectionReason,
		}
		if routing.StrategyGroupID != "" {
			childMetadata["routing_strategy_group_id"] = routing.StrategyGroupID
			childMetadata["routing_selection_policy"] = string(routing.SelectionPolicy)
			childMetadata["routing_fallback_providers"] = strings.Join(routing.FallbackProviderIDs, ",")
			childMetadata["routing_considered"] = strings.Join(routing.ConsideredProviders, ",")
		}
		child := GenerationChildTask{
			ID:                 id.New("child"),
			BatchID:            batch.ID,
			TenantID:           batch.TenantID,
			Status:             ChildStatusQueued,
			ProviderID:         routing.ProviderID,
			ModelID:            modelID,
			ToolType:           toolType,
			Seed:               fmt.Sprintf("%s_%02d", batch.ID, idx+1),
			MaxRetries:         2,
			QuotaEstimateUnits: normalized.QuotaUnitPerJob,
			TraceID:            id.New("trace_child"),
			VisibleTraceRef:    id.New("trace_projection"),
			Metadata:           childMetadata,
			CreatedAt:          now,
			UpdatedAt:          now,
		}
		if routing.StrategyGroupID != "" {
			batch.Metadata["routing_strategy_group_id"] = routing.StrategyGroupID
			batch.Metadata["routing_strategy_group_name"] = routing.StrategyDisplayName
			batch.Metadata["routing_selection_policy"] = string(routing.SelectionPolicy)
		}
		batch.Children = append(batch.Children, child)
	}
	if err := ValidateBatchGenerationRequest(batch); err != nil {
		return BatchGenerationRequest{}, fmt.Errorf("%w: %v", ErrBatchValidation, err)
	}

	if txer, ok := r.db.(store.Transactor); ok {
		tx, err := txer.Begin(ctx)
		if err != nil {
			return BatchGenerationRequest{}, err
		}
		committed := false
		defer func() {
			if !committed {
				_ = tx.Rollback(ctx)
			}
		}()
		if err := insertBatch(ctx, tx, batch); err != nil {
			return BatchGenerationRequest{}, err
		}
		if r.ledger != nil && batch.QuotaBucketID != "" && batch.QuotaEstimatedUnits > 0 {
			if err := r.ledger.ReserveBatchQuota(ctx, tx, batch); err != nil {
				return BatchGenerationRequest{}, err
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return BatchGenerationRequest{}, err
		}
		committed = true
		return batch, nil
	}
	if err := insertBatch(ctx, r.db, batch); err != nil {
		return BatchGenerationRequest{}, err
	}
	if r.ledger != nil && batch.QuotaBucketID != "" && batch.QuotaEstimatedUnits > 0 {
		if err := r.ledger.ReserveBatchQuota(ctx, r.db, batch); err != nil {
			return BatchGenerationRequest{}, err
		}
	}
	return batch, nil
}

func (r BatchRepository) routeBatchChild(ctx context.Context, toolType string, childIndex int) BatchRoutingDecision {
	decision := BatchRoutingDecision{
		ProviderID:          "zenari-image-sandbox",
		SelectionReason:     "static_default",
		ConsideredProviders: []string{"zenari-image-sandbox"},
	}
	if r.strategyGroupReader == nil {
		return decision
	}
	selected, ok, err := SelectBatchRoutingProvider(ctx, r.strategyGroupReader, toolType, childIndex)
	if err != nil || !ok || strings.TrimSpace(selected.ProviderID) == "" {
		decision.SelectionReason = "strategy_group_unavailable_static_default"
		return decision
	}
	return selected
}

func (r BatchRepository) GetBatch(ctx context.Context, tenantID, batchID string) (BatchGenerationRequest, error) {
	if r.db == nil {
		return BatchGenerationRequest{}, errors.New("batch generation database is required")
	}
	batch, err := scanBatch(r.db.QueryRow(ctx, `
SELECT id, tenant_id, user_id, project_id, workspace_id, prompt_context, requested_count, allowed_models, quota_reservation_id, COALESCE(quota_bucket_id, ''), quota_estimated_units, quota_committed_units, quota_refunded_units, trace_id, status, metadata, created_at, updated_at
FROM batch_generation_requests
WHERE tenant_id = $1 AND id = $2`,
		strings.TrimSpace(tenantID),
		strings.TrimSpace(batchID),
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return BatchGenerationRequest{}, ErrNotFound
	}
	if err != nil {
		return BatchGenerationRequest{}, err
	}
	children, err := r.ListBatchChildren(ctx, tenantID, batchID)
	if err != nil {
		return BatchGenerationRequest{}, err
	}
	batch.Children = children
	return batch, nil
}

func (r BatchRepository) ListBatchChildren(ctx context.Context, tenantID, batchID string) ([]GenerationChildTask, error) {
	if r.db == nil {
		return nil, errors.New("batch generation database is required")
	}
	return listBatchChildrenInDB(ctx, r.db, tenantID, batchID)
}

func (r BatchRepository) ListAdminBatchQueueRuntime(ctx context.Context, tenantID string, limit int) ([]AdminBatchQueueRuntime, error) {
	if r.db == nil {
		return nil, errors.New("batch generation database is required")
	}
	limit = normalizeAdminBatchLimit(limit)
	rows, err := r.db.Query(ctx, `
SELECT id, tenant_id, user_id, project_id, workspace_id, requested_count, allowed_models, quota_reservation_id, COALESCE(quota_bucket_id, ''), quota_estimated_units, quota_committed_units, quota_refunded_units, trace_id, status, metadata, created_at, updated_at
FROM batch_generation_requests
WHERE tenant_id = $1
ORDER BY updated_at DESC, id
LIMIT $2`,
		strings.TrimSpace(tenantID),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	runtimes := make([]AdminBatchQueueRuntime, 0)
	for rows.Next() {
		batch, err := scanAdminBatchRuntimeRow(rows)
		if err != nil {
			return nil, err
		}
		children, err := listBatchChildrenInDB(ctx, r.db, tenantID, batch.ID)
		if err != nil {
			return nil, err
		}
		batch.Children = children
		runtimes = append(runtimes, BuildAdminBatchQueueRuntime(batch, time.Now().UTC()))
	}
	return runtimes, rows.Err()
}

func (r BatchRepository) ListAdminBatchChildTasks(ctx context.Context, tenantID string, limit int) ([]AdminBatchChildTask, error) {
	if r.db == nil {
		return nil, errors.New("batch generation database is required")
	}
	limit = normalizeAdminBatchLimit(limit)
	rows, err := r.db.Query(ctx, `
SELECT id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at
FROM generation_child_tasks
WHERE tenant_id = $1
ORDER BY updated_at DESC, id
LIMIT $2`,
		strings.TrimSpace(tenantID),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	children := make([]AdminBatchChildTask, 0)
	for rows.Next() {
		child, err := scanChild(rows)
		if err != nil {
			return nil, err
		}
		children = append(children, BuildAdminBatchChildTask(child))
	}
	return children, rows.Err()
}

func BuildAdminBatchQueueRuntime(batch BatchGenerationRequest, now time.Time) AdminBatchQueueRuntime {
	progress := BuildBatchProgress(batch)
	progress.Status = AggregateBatchStatus(batch.Children)
	first := firstAdminRepresentativeChild(batch.Children)
	workerID := metadataValue(first.Metadata, "claimed_by_worker_id", "worker_id")
	providerStrategyGroupID := metadataValue(first.Metadata, "routing_strategy_group_id")
	if providerStrategyGroupID == "" {
		providerStrategyGroupID = metadataValue(batch.Metadata, "routing_strategy_group_id")
	}
	providerSelectionPolicy := metadataValue(first.Metadata, "routing_selection_policy")
	if providerSelectionPolicy == "" {
		providerSelectionPolicy = metadataValue(batch.Metadata, "routing_selection_policy")
	}
	if providerSelectionPolicy == "" {
		providerSelectionPolicy = "weighted"
	}
	providerID := first.ProviderID
	if providerID == "" {
		providerID = "none"
	}
	modelID := first.ModelID
	if modelID == "" {
		modelID = "none"
	}
	toolType := first.ToolType
	if toolType == "" {
		toolType = "none"
	}
	return AdminBatchQueueRuntime{
		ID:                       "admin-batch-runtime-" + batch.ID,
		BatchID:                  batch.ID,
		TenantID:                 batch.TenantID,
		ProjectID:                batch.ProjectID,
		WorkspaceID:              batch.WorkspaceID,
		Status:                   progress.Status,
		RequestedCount:           batch.RequestedCount,
		Queued:                   progress.Queued,
		Running:                  progress.Running,
		Succeeded:                progress.Succeeded,
		Failed:                   progress.Failed,
		Cancelled:                progress.Cancelled,
		Blocked:                  progress.Blocked,
		Retryable:                progress.Retryable,
		WorkerID:                 defaultString(workerID, "none"),
		ClaimTimeoutSeconds:      metadataInt(first.Metadata, 900, "claim_timeout_seconds"),
		OldestChildAgeMinutes:    oldestChildAgeMinutes(batch.Children, now),
		ProviderID:               providerID,
		ModelID:                  modelID,
		ToolType:                 toolType,
		ProviderStrategyGroupID:  defaultString(providerStrategyGroupID, "none"),
		ProviderSelectionPolicy:  providerSelectionPolicy,
		ProviderConcurrency:      metadataValueDefault(first.Metadata, "current provider slots derived from worker claim policy", "provider_concurrency"),
		ProviderModelConcurrency: metadataValueDefault(first.Metadata, "current provider-model slots derived from worker claim policy", "provider_model_concurrency"),
		ClaimLeasePolicy:         "Expired running children with zero committed/refunded quota are requeued before the next claim.",
		DrainPolicy:              "BatchRunner.Drain stops new claims during worker shutdown while already claimed children finish or expire by claim lease.",
		QuotaPolicy:              "Reserve estimate on create, commit actual provider usage on success, and refund remainder on failure, cancel, or safety block.",
		DeadLetterPolicy:         "Retryable failures requeue until max retry count; exhausted or non-retryable failures dead-letter and refund remaining reserved quota.",
		IdempotencyScope:         "batch_child:<child_id>:retry:<retry_count> provider requests plus retry-attempt quota idempotency.",
		NextOperatorAction:       adminBatchNextOperatorAction(progress),
		AuditRef:                 defaultString(metadataValue(batch.Metadata, "audit_ref"), "audit:"+batch.ID),
		EvidenceRefs: []string{
			"backend/internal/task/batch_repository.go",
			"backend/internal/task/batch_scheduler.go",
			"backend/internal/worker/batch_runner.go",
		},
	}
}

func BuildAdminBatchChildTask(child GenerationChildTask) AdminBatchChildTask {
	return AdminBatchChildTask{
		ID:                  child.ID,
		BatchID:             child.BatchID,
		TenantID:            child.TenantID,
		Status:              child.Status,
		ProviderID:          child.ProviderID,
		ModelID:             child.ModelID,
		ToolType:            child.ToolType,
		RetryCount:          child.RetryCount,
		MaxRetries:          child.MaxRetries,
		WorkerID:            defaultString(metadataValue(child.Metadata, "claimed_by_worker_id", "worker_id"), "none"),
		ClaimAttempt:        metadataInt(child.Metadata, 0, "claim_attempt"),
		ClaimExpiresAt:      defaultString(metadataValue(child.Metadata, "claim_expires_at"), "none"),
		FanoutStage:         defaultString(metadataValue(child.Metadata, "fanout_stage"), "none"),
		FailureCode:         defaultString(child.FailureCode, "none"),
		ReviewReason:        defaultString(child.ReviewReason, "none"),
		QuotaEstimateUnits:  child.QuotaEstimateUnits,
		QuotaCommittedUnits: child.QuotaCommittedUnits,
		QuotaRefundedUnits:  child.QuotaRefundedUnits,
		RetryState:          adminChildRetryState(child),
		DeadLetterState:     adminChildDeadLetterState(child),
		ResultAssetID:       defaultString(child.AssetID, "none"),
		CanvasObjectID:      defaultString(child.CanvasObjectID, "none"),
		VisibleTraceRef:     defaultString(child.VisibleTraceRef, child.TraceID),
		ProviderUsageRef:    defaultString(metadataValue(child.Metadata, "provider_usage_ref"), "none"),
		IdempotencyKey:      fmt.Sprintf("batch_child:%s:retry:%d", child.ID, child.RetryCount),
		OperatorAction:      adminChildOperatorAction(child),
		AuditRef:            defaultString(metadataValue(child.Metadata, "audit_ref"), "audit:"+child.ID),
		EvidenceRefs: []string{
			"backend/internal/task/batch_repository.go",
			"backend/internal/task/batch_retry.go",
			"backend/internal/task/batch_result_sink.go",
		},
	}
}

func listBatchChildrenInDB(ctx context.Context, db store.DBTX, tenantID, batchID string) ([]GenerationChildTask, error) {
	rows, err := db.Query(ctx, `
SELECT id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at
FROM generation_child_tasks
WHERE tenant_id = $1 AND batch_id = $2
ORDER BY created_at, id`,
		strings.TrimSpace(tenantID),
		strings.TrimSpace(batchID),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	children := make([]GenerationChildTask, 0)
	for rows.Next() {
		child, err := scanChild(rows)
		if err != nil {
			return nil, err
		}
		children = append(children, child)
	}
	return children, rows.Err()
}

func (r BatchRepository) GetBatchProgress(ctx context.Context, tenantID, batchID string) (BatchProgress, error) {
	batch, err := r.GetBatch(ctx, tenantID, batchID)
	if err != nil {
		return BatchProgress{}, err
	}
	progress := BuildBatchProgress(batch)
	progress.Status = AggregateBatchStatus(batch.Children)
	return progress, nil
}

func (r BatchRepository) CancelBatch(ctx context.Context, tenantID, batchID string) (BatchGenerationRequest, error) {
	tenantID = strings.TrimSpace(tenantID)
	batchID = strings.TrimSpace(batchID)
	if _, err := r.GetBatch(ctx, tenantID, batchID); err != nil {
		return BatchGenerationRequest{}, err
	}
	_, err := r.db.Exec(ctx, `
UPDATE generation_child_tasks
SET status = 'cancelled',
	quota_refunded_units = GREATEST(quota_estimate_units - quota_committed_units, 0),
	failure_code = '',
	failure_message = '',
	review_reason = '',
	updated_at = now()
WHERE tenant_id = $1
	AND batch_id = $2
	AND status IN ('queued', 'running')`,
		tenantID,
		batchID,
	)
	if err != nil {
		return BatchGenerationRequest{}, err
	}
	if err := r.refreshBatchAggregate(ctx, tenantID, batchID); err != nil {
		return BatchGenerationRequest{}, err
	}
	return r.GetBatch(ctx, tenantID, batchID)
}

func (r BatchRepository) RetryChild(ctx context.Context, tenantID, childID string) (GenerationChildTask, error) {
	tenantID = strings.TrimSpace(tenantID)
	childID = strings.TrimSpace(childID)
	before, err := r.getChild(ctx, tenantID, childID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if before.Status != ChildStatusFailed {
		return GenerationChildTask{}, fmt.Errorf("%w: only failed child tasks can be retried", ErrBatchConflict)
	}
	if before.RetryCount >= before.MaxRetries {
		return GenerationChildTask{}, fmt.Errorf("%w: child task retry limit reached", ErrBatchConflict)
	}
	batch, err := r.GetBatch(ctx, tenantID, before.BatchID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if r.ledger != nil && batch.QuotaBucketID != "" && before.QuotaRefundedUnits > 0 {
		retryReservation := batch
		retryReservation.QuotaReservationID = retryReservation.QuotaReservationID + ":" + before.ID + ":retry:" + fmt.Sprintf("%d", before.RetryCount+1)
		retryReservation.QuotaEstimatedUnits = before.QuotaRefundedUnits
		retryReservation.CreatedAt = time.Now().UTC()
		if err := r.ledger.ReserveBatchQuota(ctx, r.db, retryReservation); err != nil {
			return GenerationChildTask{}, err
		}
	}
	child, err := scanChild(r.db.QueryRow(ctx, `
UPDATE generation_child_tasks
SET status = 'queued',
	retry_count = retry_count + 1,
	quota_refunded_units = 0,
	failure_code = '',
	failure_message = '',
	review_reason = '',
	metadata = metadata || jsonb_build_object('manual_retry_requested', 'true', 'retry_state', 'manual_retry_queued', 'retryable', 'true', 'dead_letter_state', 'not_dead_lettered'),
	updated_at = now()
WHERE tenant_id = $1 AND id = $2
RETURNING id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at`,
		tenantID,
		childID,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return GenerationChildTask{}, ErrNotFound
	}
	if err != nil {
		return GenerationChildTask{}, err
	}
	if err := r.refreshBatchAggregate(ctx, tenantID, child.BatchID); err != nil {
		return GenerationChildTask{}, err
	}
	return child, nil
}

func (r BatchRepository) CompleteChildSuccess(ctx context.Context, input CompleteChildSuccessInput) (GenerationChildTask, error) {
	if r.db == nil {
		return GenerationChildTask{}, errors.New("batch generation database is required")
	}
	input = normalizeCompleteChildSuccessInput(input)
	if input.TenantID == "" || input.ChildID == "" || input.AssetID == "" || input.CanvasObjectID == "" {
		return GenerationChildTask{}, fmt.Errorf("%w: tenant_id, child_id, asset_id, and canvas_object_id are required", ErrBatchValidation)
	}
	if stringMapContainsSecret(input.Metadata) {
		return GenerationChildTask{}, fmt.Errorf("%w: completion metadata must not contain raw secrets", ErrBatchValidation)
	}
	before, err := r.getChild(ctx, input.TenantID, input.ChildID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if before.Status == ChildStatusSucceeded {
		return before, nil
	}
	if before.Status != ChildStatusRunning {
		return GenerationChildTask{}, fmt.Errorf("%w: only running child tasks can be completed", ErrBatchConflict)
	}
	batch, err := r.GetBatch(ctx, input.TenantID, before.BatchID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	remaining := before.QuotaEstimateUnits - before.QuotaCommittedUnits - before.QuotaRefundedUnits
	if remaining < 0 {
		return GenerationChildTask{}, fmt.Errorf("%w: child quota is already over-accounted", ErrBatchConflict)
	}
	if input.QuotaCommittedUnits == 0 && remaining > 0 {
		input.QuotaCommittedUnits = remaining
	}
	if input.QuotaRefundedUnits == 0 && input.QuotaCommittedUnits < remaining {
		input.QuotaRefundedUnits = remaining - input.QuotaCommittedUnits
	}
	if input.QuotaCommittedUnits < 0 || input.QuotaRefundedUnits < 0 || input.QuotaCommittedUnits+input.QuotaRefundedUnits > remaining {
		return GenerationChildTask{}, fmt.Errorf("%w: completed quota units exceed remaining estimate", ErrBatchValidation)
	}
	metadataJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if txer, ok := r.db.(store.Transactor); ok {
		tx, err := txer.Begin(ctx)
		if err != nil {
			return GenerationChildTask{}, err
		}
		committed := false
		defer func() {
			if !committed {
				_ = tx.Rollback(ctx)
			}
		}()
		child, err := r.completeChildSuccessInDB(ctx, tx, batch, input, metadataJSON)
		if err != nil {
			return GenerationChildTask{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return GenerationChildTask{}, err
		}
		committed = true
		return child, nil
	}
	return r.completeChildSuccessInDB(ctx, r.db, batch, input, metadataJSON)
}

func (r BatchRepository) CompleteChildFailure(ctx context.Context, input CompleteChildFailureInput) (GenerationChildTask, error) {
	if r.db == nil {
		return GenerationChildTask{}, errors.New("batch generation database is required")
	}
	input = normalizeCompleteChildFailureInput(input)
	if input.TenantID == "" || input.ChildID == "" || input.FailureCode == "" {
		return GenerationChildTask{}, fmt.Errorf("%w: tenant_id, child_id, and failure_code are required", ErrBatchValidation)
	}
	if stringMapContainsSecret(input.Metadata) || security.RedactString(input.FailureMessage) != input.FailureMessage {
		return GenerationChildTask{}, fmt.Errorf("%w: failure details must not contain raw secrets", ErrBatchValidation)
	}
	before, err := r.getChild(ctx, input.TenantID, input.ChildID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if before.Status == ChildStatusFailed {
		return before, nil
	}
	if before.Status != ChildStatusRunning {
		return GenerationChildTask{}, fmt.Errorf("%w: only running child tasks can be failed", ErrBatchConflict)
	}
	batch, err := r.GetBatch(ctx, input.TenantID, before.BatchID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	remaining := before.QuotaEstimateUnits - before.QuotaCommittedUnits - before.QuotaRefundedUnits
	if remaining < 0 {
		return GenerationChildTask{}, fmt.Errorf("%w: child quota is already over-accounted", ErrBatchConflict)
	}
	if input.QuotaRefundedUnits == 0 && before.QuotaEstimateUnits > 0 {
		input.QuotaRefundedUnits = remaining
	}
	if input.QuotaRefundedUnits < 0 || input.QuotaRefundedUnits > remaining {
		return GenerationChildTask{}, fmt.Errorf("%w: refunded quota units exceed remaining estimate", ErrBatchValidation)
	}
	metadataJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if txer, ok := r.db.(store.Transactor); ok {
		tx, err := txer.Begin(ctx)
		if err != nil {
			return GenerationChildTask{}, err
		}
		committed := false
		defer func() {
			if !committed {
				_ = tx.Rollback(ctx)
			}
		}()
		child, err := r.completeChildFailureInDB(ctx, tx, batch, input, metadataJSON)
		if err != nil {
			return GenerationChildTask{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return GenerationChildTask{}, err
		}
		committed = true
		return child, nil
	}
	return r.completeChildFailureInDB(ctx, r.db, batch, input, metadataJSON)
}

func (r BatchRepository) BlockChildForReview(ctx context.Context, input BlockChildForReviewInput) (GenerationChildTask, error) {
	if r.db == nil {
		return GenerationChildTask{}, errors.New("batch generation database is required")
	}
	input = normalizeBlockChildForReviewInput(input)
	if input.TenantID == "" || input.ChildID == "" || input.ReviewReason == "" {
		return GenerationChildTask{}, fmt.Errorf("%w: tenant_id, child_id, and review_reason are required", ErrBatchValidation)
	}
	if stringMapContainsSecret(input.Metadata) || security.RedactString(input.ReviewReason) != input.ReviewReason {
		return GenerationChildTask{}, fmt.Errorf("%w: review details must not contain raw secrets", ErrBatchValidation)
	}
	before, err := r.getChild(ctx, input.TenantID, input.ChildID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if before.Status == ChildStatusBlocked {
		return before, nil
	}
	if before.Status != ChildStatusRunning {
		return GenerationChildTask{}, fmt.Errorf("%w: only running child tasks can be blocked for review", ErrBatchConflict)
	}
	batch, err := r.GetBatch(ctx, input.TenantID, before.BatchID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	remaining := before.QuotaEstimateUnits - before.QuotaCommittedUnits - before.QuotaRefundedUnits
	if remaining < 0 {
		return GenerationChildTask{}, fmt.Errorf("%w: child quota is already over-accounted", ErrBatchConflict)
	}
	if input.QuotaRefundedUnits == 0 && before.QuotaEstimateUnits > 0 {
		input.QuotaRefundedUnits = remaining
	}
	if input.QuotaRefundedUnits < 0 || input.QuotaRefundedUnits > remaining {
		return GenerationChildTask{}, fmt.Errorf("%w: blocked quota units exceed remaining estimate", ErrBatchValidation)
	}
	metadataJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if txer, ok := r.db.(store.Transactor); ok {
		tx, err := txer.Begin(ctx)
		if err != nil {
			return GenerationChildTask{}, err
		}
		committed := false
		defer func() {
			if !committed {
				_ = tx.Rollback(ctx)
			}
		}()
		child, err := r.blockChildForReviewInDB(ctx, tx, batch, input, metadataJSON)
		if err != nil {
			return GenerationChildTask{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return GenerationChildTask{}, err
		}
		committed = true
		return child, nil
	}
	return r.blockChildForReviewInDB(ctx, r.db, batch, input, metadataJSON)
}

func (r BatchRepository) completeChildSuccessInDB(ctx context.Context, db store.DBTX, batch BatchGenerationRequest, input CompleteChildSuccessInput, metadataJSON []byte) (GenerationChildTask, error) {
	child, err := scanChild(db.QueryRow(ctx, `
UPDATE generation_child_tasks
SET status = 'succeeded',
	asset_id = $3,
	canvas_object_id = $4,
	quota_committed_units = quota_committed_units + $5,
	quota_refunded_units = quota_refunded_units + $6,
	failure_code = '',
	failure_message = '',
	review_reason = '',
	metadata = metadata || $7::jsonb,
	updated_at = now()
WHERE tenant_id = $1 AND id = $2 AND status = 'running'
RETURNING id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at`,
		input.TenantID,
		input.ChildID,
		input.AssetID,
		input.CanvasObjectID,
		input.QuotaCommittedUnits,
		input.QuotaRefundedUnits,
		metadataJSON,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return GenerationChildTask{}, fmt.Errorf("%w: child task was not running at completion time", ErrBatchConflict)
	}
	if err != nil {
		return GenerationChildTask{}, err
	}
	if r.ledger != nil && batch.QuotaBucketID != "" {
		if input.QuotaCommittedUnits > 0 {
			if err := r.ledger.CommitBatchQuota(ctx, db, batch, child, input.QuotaCommittedUnits); err != nil {
				return GenerationChildTask{}, err
			}
		}
		if input.QuotaRefundedUnits > 0 {
			if err := r.ledger.RefundBatchQuota(ctx, db, batch, child, input.QuotaRefundedUnits); err != nil {
				return GenerationChildTask{}, err
			}
		}
	}
	if err := ValidateGenerationChildTask(child); err != nil {
		return GenerationChildTask{}, err
	}
	if err := r.refreshBatchAggregateWithDB(ctx, db, child.TenantID, child.BatchID); err != nil {
		return GenerationChildTask{}, err
	}
	return child, nil
}

func (r BatchRepository) completeChildFailureInDB(ctx context.Context, db store.DBTX, batch BatchGenerationRequest, input CompleteChildFailureInput, metadataJSON []byte) (GenerationChildTask, error) {
	child, err := scanChild(db.QueryRow(ctx, `
UPDATE generation_child_tasks
SET status = 'failed',
	quota_refunded_units = quota_refunded_units + $5,
	failure_code = $3,
	failure_message = $4,
	review_reason = '',
	metadata = metadata || $6::jsonb,
	updated_at = now()
WHERE tenant_id = $1 AND id = $2 AND status = 'running'
RETURNING id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at`,
		input.TenantID,
		input.ChildID,
		input.FailureCode,
		input.FailureMessage,
		input.QuotaRefundedUnits,
		metadataJSON,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return GenerationChildTask{}, fmt.Errorf("%w: child task was not running at failure time", ErrBatchConflict)
	}
	if err != nil {
		return GenerationChildTask{}, err
	}
	if r.ledger != nil && batch.QuotaBucketID != "" && input.QuotaRefundedUnits > 0 {
		if err := r.ledger.RefundBatchQuota(ctx, db, batch, child, input.QuotaRefundedUnits); err != nil {
			return GenerationChildTask{}, err
		}
	}
	if err := ValidateGenerationChildTask(child); err != nil {
		return GenerationChildTask{}, err
	}
	if err := r.refreshBatchAggregateWithDB(ctx, db, child.TenantID, child.BatchID); err != nil {
		return GenerationChildTask{}, err
	}
	return child, nil
}

func (r BatchRepository) blockChildForReviewInDB(ctx context.Context, db store.DBTX, batch BatchGenerationRequest, input BlockChildForReviewInput, metadataJSON []byte) (GenerationChildTask, error) {
	child, err := scanChild(db.QueryRow(ctx, `
UPDATE generation_child_tasks
SET status = 'blocked',
	quota_refunded_units = quota_refunded_units + $4,
	failure_code = '',
	failure_message = '',
	review_reason = $3,
	metadata = metadata || $5::jsonb,
	updated_at = now()
WHERE tenant_id = $1 AND id = $2 AND status = 'running'
RETURNING id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at`,
		input.TenantID,
		input.ChildID,
		input.ReviewReason,
		input.QuotaRefundedUnits,
		metadataJSON,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return GenerationChildTask{}, fmt.Errorf("%w: child task was not running at review-block time", ErrBatchConflict)
	}
	if err != nil {
		return GenerationChildTask{}, err
	}
	if r.ledger != nil && batch.QuotaBucketID != "" && input.QuotaRefundedUnits > 0 {
		if err := r.ledger.RefundBatchQuota(ctx, db, batch, child, input.QuotaRefundedUnits); err != nil {
			return GenerationChildTask{}, err
		}
	}
	if err := ValidateGenerationChildTask(child); err != nil {
		return GenerationChildTask{}, err
	}
	if err := r.refreshBatchAggregateWithDB(ctx, db, child.TenantID, child.BatchID); err != nil {
		return GenerationChildTask{}, err
	}
	return child, nil
}

func (r BatchRepository) MarkChildRetryScheduled(ctx context.Context, input CompleteChildFailureInput) (GenerationChildTask, error) {
	if r.db == nil {
		return GenerationChildTask{}, errors.New("batch generation database is required")
	}
	input = normalizeCompleteChildFailureInput(input)
	if input.TenantID == "" || input.ChildID == "" || input.FailureCode == "" {
		return GenerationChildTask{}, fmt.Errorf("%w: tenant_id, child_id, and failure_code are required", ErrBatchValidation)
	}
	if stringMapContainsSecret(input.Metadata) || security.RedactString(input.FailureMessage) != input.FailureMessage {
		return GenerationChildTask{}, fmt.Errorf("%w: retry details must not contain raw secrets", ErrBatchValidation)
	}
	before, err := r.getChild(ctx, input.TenantID, input.ChildID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if before.Status != ChildStatusRunning {
		return GenerationChildTask{}, fmt.Errorf("%w: only running child tasks can be scheduled for retry", ErrBatchConflict)
	}
	if before.RetryCount >= before.MaxRetries {
		return GenerationChildTask{}, fmt.Errorf("%w: child task retry limit reached", ErrBatchConflict)
	}
	if before.QuotaCommittedUnits != 0 || before.QuotaRefundedUnits != 0 {
		return GenerationChildTask{}, fmt.Errorf("%w: automatic retry requires unaccounted reserved quota", ErrBatchConflict)
	}
	metadata := mergeStringMaps(input.Metadata, map[string]string{
		"retry_state":       "scheduled",
		"retryable":         "true",
		"dead_letter_state": "not_dead_lettered",
	})
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return GenerationChildTask{}, err
	}
	child, err := scanChild(r.db.QueryRow(ctx, `
UPDATE generation_child_tasks
SET status = 'queued',
	retry_count = retry_count + 1,
	failure_code = $3,
	failure_message = $4,
	review_reason = '',
	metadata = metadata || $5::jsonb,
	updated_at = now()
WHERE tenant_id = $1
	AND id = $2
	AND status = 'running'
	AND retry_count < max_retries
	AND quota_committed_units = 0
	AND quota_refunded_units = 0
RETURNING id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at`,
		input.TenantID,
		input.ChildID,
		input.FailureCode,
		input.FailureMessage,
		metadataJSON,
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return GenerationChildTask{}, fmt.Errorf("%w: child task was not retryable at retry scheduling time", ErrBatchConflict)
	}
	if err != nil {
		return GenerationChildTask{}, err
	}
	if err := ValidateGenerationChildTask(child); err != nil {
		return GenerationChildTask{}, err
	}
	if err := r.refreshBatchAggregate(ctx, child.TenantID, child.BatchID); err != nil {
		return GenerationChildTask{}, err
	}
	return child, nil
}

func (r BatchRepository) getChild(ctx context.Context, tenantID, childID string) (GenerationChildTask, error) {
	child, err := scanChild(r.db.QueryRow(ctx, `
SELECT id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at
FROM generation_child_tasks
WHERE tenant_id = $1 AND id = $2`,
		strings.TrimSpace(tenantID),
		strings.TrimSpace(childID),
	))
	if errors.Is(err, pgx.ErrNoRows) {
		return GenerationChildTask{}, ErrNotFound
	}
	return child, err
}

func (r BatchRepository) refreshBatchAggregate(ctx context.Context, tenantID, batchID string) error {
	return r.refreshBatchAggregateWithDB(ctx, r.db, tenantID, batchID)
}

func (r BatchRepository) refreshBatchAggregateWithDB(ctx context.Context, db store.DBTX, tenantID, batchID string) error {
	children, err := listBatchChildrenInDB(ctx, db, tenantID, batchID)
	if err != nil {
		return err
	}
	if len(children) == 0 {
		return nil
	}
	var committed, refunded int64
	for _, child := range children {
		committed += child.QuotaCommittedUnits
		refunded += child.QuotaRefundedUnits
	}
	_, err = db.Exec(ctx, `
UPDATE batch_generation_requests
SET status = $3,
	quota_committed_units = $4,
	quota_refunded_units = $5,
	updated_at = now()
WHERE tenant_id = $1 AND id = $2`,
		strings.TrimSpace(tenantID),
		strings.TrimSpace(batchID),
		string(AggregateBatchStatus(children)),
		committed,
		refunded,
	)
	return err
}

func (r BatchRepository) findBatchByIdempotency(ctx context.Context, tenantID, key string) (string, error) {
	var batchID string
	err := r.db.QueryRow(ctx, `
SELECT id
FROM batch_generation_requests
WHERE tenant_id = $1 AND metadata->>'idempotency_fingerprint' = $2
ORDER BY created_at DESC
LIMIT 1`,
		tenantID,
		idempotencyFingerprint(tenantID, key),
	).Scan(&batchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return batchID, err
}

func insertBatch(ctx context.Context, db store.DBTX, batch BatchGenerationRequest) error {
	promptJSON, err := json.Marshal(batch.PromptContext)
	if err != nil {
		return err
	}
	metadataJSON, err := json.Marshal(batch.Metadata)
	if err != nil {
		return err
	}
	if _, err := db.Exec(ctx, `
INSERT INTO batch_generation_requests (
	id, tenant_id, user_id, project_id, workspace_id, prompt_context, requested_count, allowed_models,
	quota_reservation_id, quota_bucket_id, quota_estimated_units, quota_committed_units, quota_refunded_units, trace_id, status, metadata, created_at, updated_at
) VALUES (
	$1, $2, $3, $4, $5, $6::jsonb, $7, $8,
	$9, nullif($10, ''), $11, $12, $13, $14, $15, $16::jsonb, $17, $18
)`,
		batch.ID,
		batch.TenantID,
		batch.UserID,
		batch.ProjectID,
		batch.WorkspaceID,
		promptJSON,
		batch.RequestedCount,
		batch.AllowedModels,
		batch.QuotaReservationID,
		batch.QuotaBucketID,
		batch.QuotaEstimatedUnits,
		batch.QuotaCommittedUnits,
		batch.QuotaRefundedUnits,
		batch.TraceID,
		string(batch.Status),
		metadataJSON,
		batch.CreatedAt,
		batch.UpdatedAt,
	); err != nil {
		return err
	}
	for _, child := range batch.Children {
		metadataJSON, err := json.Marshal(child.Metadata)
		if err != nil {
			return err
		}
		if _, err := db.Exec(ctx, `
INSERT INTO generation_child_tasks (
	id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries,
	quota_estimate_units, quota_committed_units, quota_refunded_units, trace_id, visible_trace_ref, metadata, created_at, updated_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
	$11, $12, $13, $14, $15, $16::jsonb, $17, $18
)`,
			child.ID,
			child.BatchID,
			child.TenantID,
			string(child.Status),
			child.ProviderID,
			child.ModelID,
			child.ToolType,
			child.Seed,
			child.RetryCount,
			child.MaxRetries,
			child.QuotaEstimateUnits,
			child.QuotaCommittedUnits,
			child.QuotaRefundedUnits,
			child.TraceID,
			child.VisibleTraceRef,
			metadataJSON,
			child.CreatedAt,
			child.UpdatedAt,
		); err != nil {
			return err
		}
	}
	return nil
}

func scanBatch(row store.Row) (BatchGenerationRequest, error) {
	var batch BatchGenerationRequest
	var promptJSON []byte
	var metadataJSON []byte
	var status string
	if err := row.Scan(
		&batch.ID,
		&batch.TenantID,
		&batch.UserID,
		&batch.ProjectID,
		&batch.WorkspaceID,
		&promptJSON,
		&batch.RequestedCount,
		&batch.AllowedModels,
		&batch.QuotaReservationID,
		&batch.QuotaBucketID,
		&batch.QuotaEstimatedUnits,
		&batch.QuotaCommittedUnits,
		&batch.QuotaRefundedUnits,
		&batch.TraceID,
		&status,
		&metadataJSON,
		&batch.CreatedAt,
		&batch.UpdatedAt,
	); err != nil {
		return BatchGenerationRequest{}, err
	}
	if len(promptJSON) > 0 {
		if err := json.Unmarshal(promptJSON, &batch.PromptContext); err != nil {
			return BatchGenerationRequest{}, err
		}
	}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &batch.Metadata); err != nil {
			return BatchGenerationRequest{}, err
		}
	}
	batch.Status = BatchStatus(status)
	return batch, nil
}

func scanAdminBatchRuntimeRow(row store.Rows) (BatchGenerationRequest, error) {
	var batch BatchGenerationRequest
	var metadataJSON []byte
	var status string
	if err := row.Scan(
		&batch.ID,
		&batch.TenantID,
		&batch.UserID,
		&batch.ProjectID,
		&batch.WorkspaceID,
		&batch.RequestedCount,
		&batch.AllowedModels,
		&batch.QuotaReservationID,
		&batch.QuotaBucketID,
		&batch.QuotaEstimatedUnits,
		&batch.QuotaCommittedUnits,
		&batch.QuotaRefundedUnits,
		&batch.TraceID,
		&status,
		&metadataJSON,
		&batch.CreatedAt,
		&batch.UpdatedAt,
	); err != nil {
		return BatchGenerationRequest{}, err
	}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &batch.Metadata); err != nil {
			return BatchGenerationRequest{}, err
		}
	}
	batch.Status = BatchStatus(status)
	return batch, nil
}

func scanChild(row store.Row) (GenerationChildTask, error) {
	var child GenerationChildTask
	var metadataJSON []byte
	var status string
	if err := row.Scan(
		&child.ID,
		&child.BatchID,
		&child.TenantID,
		&status,
		&child.ProviderID,
		&child.ModelID,
		&child.ToolType,
		&child.Seed,
		&child.RetryCount,
		&child.MaxRetries,
		&child.QuotaEstimateUnits,
		&child.QuotaCommittedUnits,
		&child.QuotaRefundedUnits,
		&child.AssetID,
		&child.CanvasObjectID,
		&child.TraceID,
		&child.VisibleTraceRef,
		&child.FailureCode,
		&child.FailureMessage,
		&child.ReviewReason,
		&metadataJSON,
		&child.CreatedAt,
		&child.UpdatedAt,
	); err != nil {
		return GenerationChildTask{}, err
	}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &child.Metadata); err != nil {
			return GenerationChildTask{}, err
		}
	}
	child.Status = ChildStatus(status)
	return child, nil
}

func normalizeAdminBatchLimit(limit int) int {
	if limit <= 0 {
		return 50
	}
	if limit > 100 {
		return 100
	}
	return limit
}

func firstAdminRepresentativeChild(children []GenerationChildTask) GenerationChildTask {
	if len(children) == 0 {
		return GenerationChildTask{}
	}
	for _, child := range children {
		if child.Status == ChildStatusRunning {
			return child
		}
	}
	for _, child := range children {
		if child.Status == ChildStatusFailed || child.Status == ChildStatusBlocked {
			return child
		}
	}
	return children[0]
}

func oldestChildAgeMinutes(children []GenerationChildTask, now time.Time) int {
	if len(children) == 0 {
		return 0
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	oldest := children[0].CreatedAt
	for _, child := range children[1:] {
		if child.CreatedAt.Before(oldest) {
			oldest = child.CreatedAt
		}
	}
	if oldest.IsZero() || now.Before(oldest) {
		return 0
	}
	return int(now.Sub(oldest).Minutes())
}

func metadataValue(metadata map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(metadata[key]); value != "" {
			return value
		}
	}
	return ""
}

func metadataValueDefault(metadata map[string]string, fallback string, keys ...string) string {
	if value := metadataValue(metadata, keys...); value != "" {
		return value
	}
	return fallback
}

func metadataInt(metadata map[string]string, fallback int, keys ...string) int {
	for _, key := range keys {
		value := strings.TrimSpace(metadata[key])
		if value == "" {
			continue
		}
		parsed, err := strconv.Atoi(value)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func defaultString(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func adminBatchNextOperatorAction(progress BatchProgress) string {
	switch {
	case progress.Retryable > 0:
		return "Inspect failed child retry budget, provider health, and quota ledger before manually retrying."
	case progress.Blocked > 0:
		return "Review safety block reason and quota refund evidence before approving any retry."
	case progress.Running > 0:
		return "Monitor worker claim lease expiry and drain status before intervening."
	case progress.Queued > 0:
		return "Check provider strategy group capacity and worker availability."
	default:
		return "No queue intervention required."
	}
}

func adminChildRetryState(child GenerationChildTask) string {
	if child.Status != ChildStatusFailed {
		return "not_applicable"
	}
	if child.RetryCount >= child.MaxRetries {
		return "retry_exhausted"
	}
	if childFailureRetryable(child) {
		return "retry_available"
	}
	return "not_retryable"
}

func adminChildDeadLetterState(child GenerationChildTask) string {
	if child.Status == ChildStatusFailed && child.RetryCount >= child.MaxRetries {
		return "dead_lettered"
	}
	return "not_dead_lettered"
}

func adminChildOperatorAction(child GenerationChildTask) string {
	switch child.Status {
	case ChildStatusSucceeded:
		return "No action; success has asset, canvas object, trace projection, and provider usage."
	case ChildStatusRunning:
		return "Monitor claim lease expiry before requeue or drain intervention."
	case ChildStatusQueued:
		return "Wait for worker claim under current provider concurrency policy."
	case ChildStatusBlocked:
		return "Review safety block reason before approving retry or closure."
	case ChildStatusFailed:
		if child.RetryCount >= child.MaxRetries {
			return "Retry budget is exhausted; inspect dead-letter and quota refund evidence."
		}
		return "Retry is available after provider health and strategy group capacity are checked."
	case ChildStatusCancelled:
		return "No action unless cancellation requires support follow-up."
	default:
		return "Review child task state."
	}
}

func normalizeBatchCreateInput(input BatchCreateInput) (BatchCreateInput, error) {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.UserID = strings.TrimSpace(input.UserID)
	input.ProjectID = strings.TrimSpace(input.ProjectID)
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.PromptContext = normalizePromptContext(input.PromptContext)
	input.AllowedModels = normalizeStringSlice(input.AllowedModels)
	if input.QuotaUnitPerJob <= 0 {
		input.QuotaUnitPerJob = 4
	}
	if input.TenantID == "" || input.UserID == "" {
		return BatchCreateInput{}, fmt.Errorf("%w: tenant_id and user_id are required", ErrBatchValidation)
	}
	if input.ProjectID == "" || input.WorkspaceID == "" {
		return BatchCreateInput{}, fmt.Errorf("%w: project_id and workspace_id are required", ErrBatchValidation)
	}
	if input.PromptContext.Text == "" {
		return BatchCreateInput{}, fmt.Errorf("%w: prompt_context.text is required", ErrBatchValidation)
	}
	if input.RequestedCount <= 0 || input.RequestedCount > 20 {
		return BatchCreateInput{}, fmt.Errorf("%w: requested_count must be 1..20", ErrBatchValidation)
	}
	if promptContextContainsSecret(input.PromptContext) || stringSliceContainsSecret(input.AllowedModels) {
		return BatchCreateInput{}, fmt.Errorf("%w: prompt context and allowed models must not contain raw secrets", ErrBatchValidation)
	}
	return input, nil
}

func normalizeCompleteChildSuccessInput(input CompleteChildSuccessInput) CompleteChildSuccessInput {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.ChildID = strings.TrimSpace(input.ChildID)
	input.AssetID = strings.TrimSpace(input.AssetID)
	input.CanvasObjectID = strings.TrimSpace(input.CanvasObjectID)
	input.Metadata = normalizeStringMap(input.Metadata)
	return input
}

func normalizeCompleteChildFailureInput(input CompleteChildFailureInput) CompleteChildFailureInput {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.ChildID = strings.TrimSpace(input.ChildID)
	input.FailureCode = strings.TrimSpace(input.FailureCode)
	input.FailureMessage = strings.TrimSpace(input.FailureMessage)
	input.Metadata = normalizeStringMap(input.Metadata)
	return input
}

func normalizeBlockChildForReviewInput(input BlockChildForReviewInput) BlockChildForReviewInput {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.ChildID = strings.TrimSpace(input.ChildID)
	input.ReviewReason = strings.TrimSpace(input.ReviewReason)
	input.Metadata = normalizeStringMap(input.Metadata)
	return input
}

func normalizePromptContext(input PromptContext) PromptContext {
	return PromptContext{
		Text:              strings.TrimSpace(input.Text),
		SelectedObjectIDs: normalizeStringSlice(input.SelectedObjectIDs),
		ReferenceAssetIDs: normalizeStringSlice(input.ReferenceAssetIDs),
		BrandKitID:        strings.TrimSpace(input.BrandKitID),
		ModelHints:        normalizeStringSlice(input.ModelHints),
		ToolHint:          strings.TrimSpace(input.ToolHint),
	}
}

func normalizeStringSlice(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func normalizeStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(values))
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		out[trimmedKey] = strings.TrimSpace(value)
	}
	return out
}

func promptContextContainsSecret(prompt PromptContext) bool {
	values := []string{prompt.Text, prompt.BrandKitID, prompt.ToolHint}
	values = append(values, prompt.SelectedObjectIDs...)
	values = append(values, prompt.ReferenceAssetIDs...)
	values = append(values, prompt.ModelHints...)
	return stringSliceContainsSecret(values)
}

func stringMapContainsSecret(values map[string]string) bool {
	if len(values) == 0 {
		return false
	}
	flattened := make([]string, 0, len(values)*2)
	for key, value := range values {
		flattened = append(flattened, key, value)
	}
	return stringSliceContainsSecret(flattened)
}

func stringSliceContainsSecret(values []string) bool {
	for _, value := range values {
		if security.RedactString(value) != value {
			return true
		}
	}
	return false
}

func pickModelID(allowedModels, hints []string) string {
	if len(allowedModels) > 0 {
		return allowedModels[0]
	}
	if len(hints) > 0 {
		return hints[0]
	}
	return "image-fast-v1"
}

func pickToolType(toolHint string) string {
	toolHint = strings.TrimSpace(toolHint)
	if toolHint == "" {
		return "image.generate"
	}
	return toolHint
}

func idempotencyFingerprint(tenantID, key string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(tenantID) + ":" + strings.TrimSpace(key)))
	return hex.EncodeToString(sum[:])
}
