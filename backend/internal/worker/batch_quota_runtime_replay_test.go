package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/billing"
	"github.com/alphane-ai/zenart/backend/internal/provider"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
)

func TestBatchQuotaRuntimeReplayProducesEvidenceFixture(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 6, 21, 18, 0, 0, 0, time.UTC)
	replay := newBatchQuotaRuntimeReplay(now)

	if err := replay.ledger.ReserveBatchQuota(ctx, nil, replay.batch); err != nil {
		t.Fatalf("ReserveBatchQuota() error = %v", err)
	}
	runner := NewBatchRunner(replay, task.BatchChildExecutor{
		Providers:     task.ProviderClientMap{"zenari-image-sandbox": replay.provider},
		ResultSink:    batchQuotaRuntimeResultSink{},
		UsageRecorder: replay,
		Now:           func() time.Time { return now },
	}, nil, BatchRunnerOptions{
		Policy: task.BatchSchedulePolicy{
			TenantID:             replay.batch.TenantID,
			WorkerID:             "worker_runtime_replay",
			Limit:                1,
			MaxTenantConcurrency: 1,
			ProviderMaxConcurrency: map[string]int{
				"zenari-image-sandbox": 1,
			},
			ProviderModelConcurrency: map[string]int{
				"zenari-image-sandbox:image-fast-v1": 1,
			},
		},
		PollInterval: time.Hour,
	})

	for run := 0; run < 7; run++ {
		if err := runner.RunOnce(ctx); err != nil {
			t.Fatalf("RunOnce(%d) error = %v", run+1, err)
		}
	}
	if _, err := replay.RetryChild(ctx, replay.batch.TenantID, "child_manual_retry_1"); err != nil {
		t.Fatalf("RetryChild() error = %v", err)
	}
	for run := 7; run < 10; run++ {
		if err := runner.RunOnce(ctx); err != nil {
			t.Fatalf("RunOnce(%d) error = %v", run+1, err)
		}
	}
	if reconciliation := replay.ReconcileProviderUsage("child_reconcile_debit_1"); reconciliation.AdjustmentKind != "provider_usage_debit" || reconciliation.AdjustedUnits != 1 {
		t.Fatalf("debit reconciliation = %#v, want provider_usage_debit/1", reconciliation)
	}
	if reconciliation := replay.ReconcileProviderUsage("child_reconcile_debit_1"); reconciliation.AdjustmentKind != "" || reconciliation.AdjustedUnits != 0 {
		t.Fatalf("debit replay reconciliation = %#v, want idempotent no-op", reconciliation)
	}
	if err := runner.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce(11) error = %v", err)
	}
	if reconciliation := replay.ReconcileProviderUsage("child_reconcile_credit_1"); reconciliation.AdjustmentKind != "provider_usage_credit" || reconciliation.AdjustedUnits != 4 {
		t.Fatalf("credit reconciliation = %#v, want provider_usage_credit/4", reconciliation)
	}
	if reconciliation := replay.ReconcileProviderUsage("child_reconcile_credit_1"); reconciliation.AdjustmentKind != "" || reconciliation.AdjustedUnits != 0 {
		t.Fatalf("credit replay reconciliation = %#v, want idempotent no-op", reconciliation)
	}

	evidence := replay.Evidence()
	fixturePath := filepath.Join("..", "..", "..", "fixtures", "stage1", "batch_quota_reconciliation", "runtime_replay.json")
	fixtureBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read runtime replay fixture: %v\n--- generated ---\n%s", err, mustMarshalEvidence(t, evidence))
	}
	assertJSONEqual(t, fixtureBytes, mustMarshalEvidence(t, evidence))
	if evidence.ExpectedBucket.UsedUnits != replay.bucket.UsedUnits || evidence.ExpectedBucket.ReservedUnits != replay.bucket.ReservedUnits {
		t.Fatalf("evidence bucket = %#v runtime bucket = %#v", evidence.ExpectedBucket, replay.bucket)
	}
}

type batchQuotaRuntimeReplay struct {
	batch        task.BatchGenerationRequest
	bucket       batchQuotaRuntimeBucket
	initial      batchQuotaRuntimeBucket
	events       []batchQuotaRuntimeEvent
	ledger       *batchQuotaRuntimeLedger
	provider     *batchQuotaRuntimeProvider
	usageLogs    map[string][]billing.ProviderUsageLog
	transactions []batchQuotaRuntimeTransaction
}

type batchQuotaRuntimeBucket struct {
	LimitUnits    int64 `json:"limit_units"`
	UsedUnits     int64 `json:"used_units"`
	ReservedUnits int64 `json:"reserved_units"`
}

type batchQuotaRuntimeEvidence struct {
	FixtureID         string                   `json:"fixture_id"`
	ContractVersion   int                      `json:"contract_version"`
	GeneratedByGoTest string                   `json:"generated_by_go_test"`
	RuntimeComponents []string                 `json:"runtime_components"`
	TenantID          string                   `json:"tenant_id"`
	UserID            string                   `json:"user_id"`
	BucketID          string                   `json:"bucket_id"`
	BatchID           string                   `json:"batch_id"`
	QuotaReservation  string                   `json:"quota_reservation_id"`
	InitialBucket     batchQuotaRuntimeBucket  `json:"initial_bucket"`
	Events            []batchQuotaRuntimeEvent `json:"events"`
	ExpectedBucket    batchQuotaRuntimeBucket  `json:"expected_bucket"`
	Assertions        []string                 `json:"assertions"`
	ReleaseNote       string                   `json:"release_note"`
}

type batchQuotaRuntimeEvent struct {
	EventID                   string `json:"event_id"`
	Kind                      string `json:"kind"`
	Source                    string `json:"source"`
	ChildID                   string `json:"child_id,omitempty"`
	FailureCode               string `json:"failure_code,omitempty"`
	RetryState                string `json:"retry_state,omitempty"`
	RetryCountBefore          *int   `json:"retry_count_before,omitempty"`
	RetryCountAfter           *int   `json:"retry_count_after,omitempty"`
	MaxRetries                *int   `json:"max_retries,omitempty"`
	QuotaTransaction          string `json:"quota_transaction,omitempty"`
	DeadLetterState           string `json:"dead_letter_state,omitempty"`
	IDempotencyKey            string `json:"idempotency_key,omitempty"`
	TransactionKind           string `json:"transaction_kind,omitempty"`
	TransactionStatus         string `json:"transaction_status,omitempty"`
	Units                     *int64 `json:"units,omitempty"`
	ReservedDelta             int64  `json:"reserved_delta"`
	UsedDelta                 int64  `json:"used_delta"`
	ProviderUsageUnits        *int64 `json:"provider_usage_units,omitempty"`
	PreviousRefundedUnits     *int64 `json:"previous_refunded_units,omitempty"`
	ProviderLogCount          *int   `json:"provider_log_count,omitempty"`
	ActualUsageUnits          *int64 `json:"actual_usage_units,omitempty"`
	AccountedQuotaUnits       *int64 `json:"accounted_quota_units,omitempty"`
	AdjustmentKind            string `json:"adjustment_kind,omitempty"`
	AdjustedUnits             *int64 `json:"adjusted_units,omitempty"`
	IDempotentOnReplay        *bool  `json:"idempotent_on_replay,omitempty"`
	QuotaIdempotencyKeySource string `json:"quota_idempotency_key_source,omitempty"`
}

type batchQuotaRuntimeTransaction struct {
	IDempotencyKey string
	Kind           string
	Status         string
	Units          int64
	ReconcilesKey  string
}

type batchQuotaRuntimeProviderUsageReconciliation struct {
	AdjustmentKind string
	AdjustedUnits  int64
}

func newBatchQuotaRuntimeReplay(now time.Time) *batchQuotaRuntimeReplay {
	children := []task.GenerationChildTask{
		runtimeReplayChild("child_success_1", now),
		runtimeReplayChild("child_retry_success_1", now),
		runtimeReplayChild("child_dead_letter_1", now),
		runtimeReplayChild("child_manual_retry_1", now),
		runtimeReplayChild("child_reconcile_debit_1", now),
		runtimeReplayChild("child_reconcile_credit_1", now),
	}
	replay := &batchQuotaRuntimeReplay{
		bucket: batchQuotaRuntimeBucket{
			LimitUnits: 100,
		},
		initial: batchQuotaRuntimeBucket{
			LimitUnits: 100,
		},
		usageLogs: map[string][]billing.ProviderUsageLog{},
	}
	replay.batch = task.BatchGenerationRequest{
		ID:                  "batch_runtime_replay_1",
		TenantID:            "tenant_1",
		UserID:              "user_1",
		ProjectID:           "project_1",
		WorkspaceID:         "workspace_1",
		PromptContext:       task.PromptContext{Text: "Create six launch image variants", ToolHint: "image.generate", ModelHints: []string{"image-fast-v1"}},
		RequestedCount:      len(children),
		AllowedModels:       []string{"image-fast-v1"},
		QuotaReservationID:  "quota_reservation_runtime_replay_1",
		QuotaBucketID:       "quota_bucket_runtime_replay_1",
		QuotaEstimatedUnits: int64(len(children)) * 4,
		TraceID:             "trace_batch_runtime_replay_1",
		Status:              task.BatchStatusQueued,
		Children:            children,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	replay.ledger = &batchQuotaRuntimeLedger{replay: replay, seen: map[string]bool{}}
	replay.provider = &batchQuotaRuntimeProvider{outcomes: map[string]map[int]batchQuotaRuntimeProviderOutcome{
		"child_success_1": {
			0: {status: "succeeded", costUnits: 3},
		},
		"child_retry_success_1": {
			0: {err: errors.New("upstream timeout")},
			1: {status: "succeeded", costUnits: 2},
		},
		"child_dead_letter_1": {
			0: {err: errors.New("upstream timeout")},
			1: {err: errors.New("upstream timeout")},
			2: {err: errors.New("upstream timeout")},
		},
		"child_manual_retry_1": {
			0: {status: "failed_permanent"},
			1: {status: "succeeded", costUnits: 3},
		},
		"child_reconcile_debit_1": {
			0: {status: "succeeded", costUnits: 5},
		},
		"child_reconcile_credit_1": {
			0: {status: "succeeded", costUnits: 0},
		},
	}}
	return replay
}

func runtimeReplayChild(id string, now time.Time) task.GenerationChildTask {
	return task.GenerationChildTask{
		ID:                 id,
		BatchID:            "batch_runtime_replay_1",
		TenantID:           "tenant_1",
		Status:             task.ChildStatusQueued,
		ProviderID:         "zenari-image-sandbox",
		ModelID:            "image-fast-v1",
		ToolType:           "image.generate",
		Seed:               id + "_seed",
		MaxRetries:         2,
		QuotaEstimateUnits: 4,
		TraceID:            "trace_" + id,
		VisibleTraceRef:    "trace_projection_" + id,
		Metadata:           map[string]string{"fanout_index": id},
		CreatedAt:          now,
		UpdatedAt:          now,
	}
}

func (r *batchQuotaRuntimeReplay) ClaimRunnableChildren(_ context.Context, _ task.BatchSchedulePolicy) (task.BatchScheduleClaim, error) {
	for idx := range r.batch.Children {
		if r.batch.Children[idx].Status != task.ChildStatusQueued {
			continue
		}
		r.batch.Children[idx].Status = task.ChildStatusRunning
		r.batch.Children[idx].Metadata = mergeRuntimeStringMaps(r.batch.Children[idx].Metadata, map[string]string{
			"claimed_by_worker_id": "worker_runtime_replay",
			"fanout_stage":         "claimed_by_worker_scheduler",
		})
		r.refreshBatchAggregate()
		return task.BatchScheduleClaim{Children: []task.GenerationChildTask{r.batch.Children[idx]}}, nil
	}
	return task.BatchScheduleClaim{}, nil
}

func (r *batchQuotaRuntimeReplay) GetBatch(_ context.Context, tenantID, batchID string) (task.BatchGenerationRequest, error) {
	if tenantID != r.batch.TenantID || batchID != r.batch.ID {
		return task.BatchGenerationRequest{}, task.ErrNotFound
	}
	return r.batch, nil
}

func (r *batchQuotaRuntimeReplay) CompleteChildSuccess(ctx context.Context, input task.CompleteChildSuccessInput) (task.GenerationChildTask, error) {
	idx, err := r.childIndex(input.ChildID)
	if err != nil {
		return task.GenerationChildTask{}, err
	}
	child := r.batch.Children[idx]
	if child.Status != task.ChildStatusRunning {
		return task.GenerationChildTask{}, task.ErrBatchConflict
	}
	remaining := child.QuotaEstimateUnits - child.QuotaCommittedUnits - child.QuotaRefundedUnits
	if input.QuotaCommittedUnits == 0 && remaining > 0 {
		input.QuotaCommittedUnits = remaining
	}
	if input.QuotaRefundedUnits == 0 && input.QuotaCommittedUnits < remaining {
		input.QuotaRefundedUnits = remaining - input.QuotaCommittedUnits
	}
	child.Status = task.ChildStatusSucceeded
	child.AssetID = input.AssetID
	child.CanvasObjectID = input.CanvasObjectID
	child.QuotaCommittedUnits += input.QuotaCommittedUnits
	child.QuotaRefundedUnits += input.QuotaRefundedUnits
	child.Metadata = mergeRuntimeStringMaps(child.Metadata, input.Metadata)
	r.batch.Children[idx] = child
	if input.QuotaCommittedUnits > 0 {
		if err := r.ledger.CommitBatchQuota(ctx, nil, r.batch, child, input.QuotaCommittedUnits); err != nil {
			return task.GenerationChildTask{}, err
		}
	}
	if input.QuotaRefundedUnits > 0 {
		if err := r.ledger.RefundBatchQuota(ctx, nil, r.batch, child, input.QuotaRefundedUnits); err != nil {
			return task.GenerationChildTask{}, err
		}
	}
	r.refreshBatchAggregate()
	return child, nil
}

func (r *batchQuotaRuntimeReplay) CompleteChildFailure(ctx context.Context, input task.CompleteChildFailureInput) (task.GenerationChildTask, error) {
	idx, err := r.childIndex(input.ChildID)
	if err != nil {
		return task.GenerationChildTask{}, err
	}
	child := r.batch.Children[idx]
	if child.Status != task.ChildStatusRunning {
		return task.GenerationChildTask{}, task.ErrBatchConflict
	}
	remaining := child.QuotaEstimateUnits - child.QuotaCommittedUnits - child.QuotaRefundedUnits
	if input.QuotaRefundedUnits == 0 && remaining > 0 {
		input.QuotaRefundedUnits = remaining
	}
	child.Status = task.ChildStatusFailed
	child.FailureCode = input.FailureCode
	child.FailureMessage = input.FailureMessage
	child.QuotaRefundedUnits += input.QuotaRefundedUnits
	child.Metadata = mergeRuntimeStringMaps(child.Metadata, input.Metadata)
	r.batch.Children[idx] = child
	if input.QuotaRefundedUnits > 0 {
		if err := r.ledger.RefundBatchQuota(ctx, nil, r.batch, child, input.QuotaRefundedUnits); err != nil {
			return task.GenerationChildTask{}, err
		}
	}
	r.refreshBatchAggregate()
	return child, nil
}

func (r *batchQuotaRuntimeReplay) BlockChildForReview(ctx context.Context, input task.BlockChildForReviewInput) (task.GenerationChildTask, error) {
	idx, err := r.childIndex(input.ChildID)
	if err != nil {
		return task.GenerationChildTask{}, err
	}
	child := r.batch.Children[idx]
	if child.Status != task.ChildStatusRunning {
		return task.GenerationChildTask{}, task.ErrBatchConflict
	}
	remaining := child.QuotaEstimateUnits - child.QuotaCommittedUnits - child.QuotaRefundedUnits
	if input.QuotaRefundedUnits == 0 && remaining > 0 {
		input.QuotaRefundedUnits = remaining
	}
	child.Status = task.ChildStatusBlocked
	child.ReviewReason = input.ReviewReason
	child.FailureCode = ""
	child.FailureMessage = ""
	child.QuotaRefundedUnits += input.QuotaRefundedUnits
	child.Metadata = mergeRuntimeStringMaps(child.Metadata, input.Metadata)
	r.batch.Children[idx] = child
	if input.QuotaRefundedUnits > 0 {
		if err := r.ledger.RefundBatchQuota(ctx, nil, r.batch, child, input.QuotaRefundedUnits); err != nil {
			return task.GenerationChildTask{}, err
		}
	}
	r.refreshBatchAggregate()
	return child, nil
}

func (r *batchQuotaRuntimeReplay) MarkChildRetryScheduled(_ context.Context, input task.CompleteChildFailureInput) (task.GenerationChildTask, error) {
	idx, err := r.childIndex(input.ChildID)
	if err != nil {
		return task.GenerationChildTask{}, err
	}
	child := r.batch.Children[idx]
	before := child.RetryCount
	child.Status = task.ChildStatusQueued
	child.RetryCount++
	child.FailureCode = input.FailureCode
	child.FailureMessage = input.FailureMessage
	child.Metadata = mergeRuntimeStringMaps(child.Metadata, mergeRuntimeStringMaps(input.Metadata, map[string]string{
		"retry_state":       "scheduled",
		"retryable":         "true",
		"dead_letter_state": "not_dead_lettered",
	}))
	r.batch.Children[idx] = child
	r.events = append(r.events, batchQuotaRuntimeEvent{
		EventID:          runtimeRetryEventID(child.ID, child.RetryCount),
		Kind:             "retry_scheduled",
		Source:           "BatchRunner.RunOnce -> BatchChildExecutor.ExecuteClaimedChild -> BatchRepository.MarkChildRetryScheduled",
		ChildID:          child.ID,
		FailureCode:      input.FailureCode,
		RetryState:       "scheduled",
		RetryCountBefore: intPtr(before),
		RetryCountAfter:  intPtr(child.RetryCount),
		MaxRetries:       intPtr(child.MaxRetries),
		QuotaTransaction: "none",
		ReservedDelta:    0,
		UsedDelta:        0,
	})
	r.refreshBatchAggregate()
	return child, nil
}

func (r *batchQuotaRuntimeReplay) RetryChild(ctx context.Context, tenantID, childID string) (task.GenerationChildTask, error) {
	if tenantID != r.batch.TenantID {
		return task.GenerationChildTask{}, task.ErrNotFound
	}
	idx, err := r.childIndex(childID)
	if err != nil {
		return task.GenerationChildTask{}, err
	}
	before := r.batch.Children[idx]
	if before.Status != task.ChildStatusFailed || before.RetryCount >= before.MaxRetries {
		return task.GenerationChildTask{}, task.ErrBatchConflict
	}
	if before.QuotaRefundedUnits > 0 {
		retryReservation := r.batch
		retryReservation.QuotaReservationID = retryReservation.QuotaReservationID + ":" + before.ID + ":retry:" + strconv.Itoa(before.RetryCount+1)
		retryReservation.QuotaEstimatedUnits = before.QuotaRefundedUnits
		if err := r.ledger.ReserveBatchQuota(ctx, nil, retryReservation); err != nil {
			return task.GenerationChildTask{}, err
		}
	}
	child := before
	child.Status = task.ChildStatusQueued
	child.RetryCount++
	child.QuotaRefundedUnits = 0
	child.FailureCode = ""
	child.FailureMessage = ""
	child.Metadata = mergeRuntimeStringMaps(child.Metadata, map[string]string{
		"manual_retry_requested": "true",
		"retry_state":            "manual_retry_queued",
		"retryable":              "true",
		"dead_letter_state":      "not_dead_lettered",
	})
	r.batch.Children[idx] = child
	r.refreshBatchAggregate()
	return child, nil
}

func (r *batchQuotaRuntimeReplay) RecordProviderUsage(_ context.Context, usage billing.ProviderUsageLog) error {
	r.usageLogs[usage.TaskID] = append(r.usageLogs[usage.TaskID], usage)
	return nil
}

func (r *batchQuotaRuntimeReplay) ReconcileProviderUsage(childID string) batchQuotaRuntimeProviderUsageReconciliation {
	key := r.batch.QuotaReservationID + ":" + childID
	var actual int64
	for _, usage := range r.usageLogs[childID] {
		actual += usage.UsageUnits
	}
	accounted := r.accountedUnits(key)
	delta := actual - accounted
	if delta == 0 {
		return batchQuotaRuntimeProviderUsageReconciliation{}
	}
	adjustmentKind := "provider_usage_debit"
	adjustedUnits := delta
	usedDelta := delta
	if delta < 0 {
		adjustmentKind = "provider_usage_credit"
		adjustedUnits = -delta
		usedDelta = delta
	}
	adjustmentIDKey := fmt.Sprintf("%s:%s:%s:%d", key, childID, adjustmentKind, actual)
	for _, tx := range r.transactions {
		if tx.IDempotencyKey == adjustmentIDKey && tx.Kind == adjustmentKind {
			return batchQuotaRuntimeProviderUsageReconciliation{}
		}
	}
	r.transactions = append(r.transactions, batchQuotaRuntimeTransaction{
		IDempotencyKey: adjustmentIDKey,
		Kind:           adjustmentKind,
		Status:         "committed",
		Units:          adjustedUnits,
		ReconcilesKey:  key,
	})
	r.bucket.UsedUnits += usedDelta
	r.events = append(r.events, batchQuotaRuntimeEvent{
		EventID:                   runtimeReconcileEventID(adjustmentKind),
		Kind:                      "provider_usage_reconcile",
		Source:                    "QuotaRepository.ReconcileProviderUsage",
		ChildID:                   childID,
		IDempotencyKey:            key,
		ProviderLogCount:          intPtr(len(r.usageLogs[childID])),
		ActualUsageUnits:          int64Ptr(actual),
		AccountedQuotaUnits:       int64Ptr(accounted),
		AdjustmentKind:            adjustmentKind,
		AdjustedUnits:             int64Ptr(adjustedUnits),
		ReservedDelta:             0,
		UsedDelta:                 usedDelta,
		IDempotentOnReplay:        boolPtr(true),
		QuotaIdempotencyKeySource: "BatchChildQuotaIdempotencyKey",
	})
	return batchQuotaRuntimeProviderUsageReconciliation{AdjustmentKind: adjustmentKind, AdjustedUnits: adjustedUnits}
}

func (r *batchQuotaRuntimeReplay) Evidence() batchQuotaRuntimeEvidence {
	return batchQuotaRuntimeEvidence{
		FixtureID:         "batch_quota_runtime_replay",
		ContractVersion:   1,
		GeneratedByGoTest: "backend/internal/worker TestBatchQuotaRuntimeReplayProducesEvidenceFixture",
		RuntimeComponents: []string{
			"BatchRunner.RunOnce",
			"BatchChildExecutor.ExecuteClaimedChild",
			"BatchRepository.RetryChild",
			"PostgresBatchQuotaLedger.ReserveBatchQuota",
			"PostgresBatchQuotaLedger.CommitBatchQuota",
			"PostgresBatchQuotaLedger.RefundBatchQuota",
			"QuotaRepository.ReconcileProviderUsage",
		},
		TenantID:         r.batch.TenantID,
		UserID:           r.batch.UserID,
		BucketID:         r.batch.QuotaBucketID,
		BatchID:          r.batch.ID,
		QuotaReservation: r.batch.QuotaReservationID,
		InitialBucket:    r.initial,
		Events:           r.events,
		ExpectedBucket:   r.bucket,
		Assertions: []string{
			"automatic retry scheduling does not move reserved quota",
			"dead-letter failure refunds remaining reserved quota",
			"manual retry re-reserves previously refunded quota before dispatch",
			"retry-attempt quota idempotency prevents stale refund keys from swallowing manual retry commit/refund",
			"provider usage reconciliation covers debit and credit adjustments and is idempotent on replay",
		},
		ReleaseNote: "Local runtime replay evidence only; real staging quota reconciliation replay against deployed Postgres/provider logs remains required before paid batch generation launch.",
	}
}

func (r *batchQuotaRuntimeReplay) childIndex(childID string) (int, error) {
	for idx := range r.batch.Children {
		if r.batch.Children[idx].ID == childID {
			return idx, nil
		}
	}
	return -1, task.ErrNotFound
}

func (r *batchQuotaRuntimeReplay) refreshBatchAggregate() {
	var committed, refunded int64
	for _, child := range r.batch.Children {
		committed += child.QuotaCommittedUnits
		refunded += child.QuotaRefundedUnits
	}
	r.batch.QuotaCommittedUnits = committed
	r.batch.QuotaRefundedUnits = refunded
	r.batch.Status = task.AggregateBatchStatus(r.batch.Children)
}

func (r *batchQuotaRuntimeReplay) accountedUnits(key string) int64 {
	var accounted int64
	for _, tx := range r.transactions {
		switch {
		case tx.IDempotencyKey == key && tx.Kind == "commit" && tx.Status == "committed":
			accounted += tx.Units
		case tx.ReconcilesKey == key && tx.Kind == "provider_usage_debit" && tx.Status == "committed":
			accounted += tx.Units
		case tx.ReconcilesKey == key && tx.Kind == "provider_usage_credit" && tx.Status == "committed":
			accounted -= tx.Units
		}
	}
	return accounted
}

type batchQuotaRuntimeLedger struct {
	replay *batchQuotaRuntimeReplay
	seen   map[string]bool
}

func (l *batchQuotaRuntimeLedger) ResolveBatchQuotaBucket(context.Context, string, string) (string, error) {
	return "quota_bucket_runtime_replay_1", nil
}

func (l *batchQuotaRuntimeLedger) ReserveBatchQuota(_ context.Context, _ store.DBTX, batch task.BatchGenerationRequest) error {
	key := batch.QuotaReservationID
	seenKey := key + ":reserve"
	if l.seen[seenKey] {
		return nil
	}
	l.seen[seenKey] = true
	if l.replay.bucket.UsedUnits+l.replay.bucket.ReservedUnits+batch.QuotaEstimatedUnits > l.replay.bucket.LimitUnits {
		return task.ErrBatchQuotaInsufficient
	}
	l.replay.bucket.ReservedUnits += batch.QuotaEstimatedUnits
	event := batchQuotaRuntimeEvent{
		EventID:           "evt_reserve_batch",
		Kind:              "reserve",
		Source:            "BatchRepository.CreateBatch -> PostgresBatchQuotaLedger.ReserveBatchQuota",
		IDempotencyKey:    key,
		TransactionKind:   "reserve",
		TransactionStatus: "reserved",
		Units:             int64Ptr(batch.QuotaEstimatedUnits),
		ReservedDelta:     batch.QuotaEstimatedUnits,
		UsedDelta:         0,
	}
	if childID, ok := manualRetryChildID(key); ok {
		event.EventID = "evt_manual_retry_rereserve"
		event.Kind = "manual_retry_rereserve"
		event.Source = "BatchRepository.RetryChild -> PostgresBatchQuotaLedger.ReserveBatchQuota"
		event.ChildID = childID
		event.PreviousRefundedUnits = int64Ptr(batch.QuotaEstimatedUnits)
	}
	l.replay.transactions = append(l.replay.transactions, batchQuotaRuntimeTransaction{
		IDempotencyKey: key,
		Kind:           "reserve",
		Status:         "reserved",
		Units:          batch.QuotaEstimatedUnits,
	})
	l.replay.events = append(l.replay.events, event)
	return nil
}

func (l *batchQuotaRuntimeLedger) CommitBatchQuota(_ context.Context, _ store.DBTX, batch task.BatchGenerationRequest, child task.GenerationChildTask, units int64) error {
	key := task.BatchChildQuotaIdempotencyKey(batch, child)
	seenKey := key + ":commit"
	if l.seen[seenKey] {
		return nil
	}
	l.seen[seenKey] = true
	if l.replay.bucket.ReservedUnits < units {
		return task.ErrBatchQuotaUnavailable
	}
	l.replay.bucket.ReservedUnits -= units
	l.replay.bucket.UsedUnits += units
	l.replay.transactions = append(l.replay.transactions, batchQuotaRuntimeTransaction{
		IDempotencyKey: key,
		Kind:           "commit",
		Status:         "committed",
		Units:          units,
	})
	l.replay.events = append(l.replay.events, batchQuotaRuntimeEvent{
		EventID:                   runtimeCommitEventID(child.ID),
		Kind:                      "commit",
		Source:                    "BatchRunner.RunOnce -> BatchChildExecutor.ExecuteClaimedChild -> PostgresBatchQuotaLedger.CommitBatchQuota",
		ChildID:                   child.ID,
		IDempotencyKey:            key,
		TransactionKind:           "commit",
		TransactionStatus:         "committed",
		Units:                     int64Ptr(units),
		ReservedDelta:             -units,
		UsedDelta:                 units,
		ProviderUsageUnits:        int64Ptr(parseRuntimeInt64(child.Metadata["usage_units"])),
		QuotaIdempotencyKeySource: "BatchChildQuotaIdempotencyKey",
	})
	return nil
}

func (l *batchQuotaRuntimeLedger) RefundBatchQuota(_ context.Context, _ store.DBTX, batch task.BatchGenerationRequest, child task.GenerationChildTask, units int64) error {
	key := task.BatchChildQuotaIdempotencyKey(batch, child)
	seenKey := key + ":refund"
	if l.seen[seenKey] {
		return nil
	}
	l.seen[seenKey] = true
	if l.replay.bucket.ReservedUnits < units {
		return task.ErrBatchQuotaUnavailable
	}
	l.replay.bucket.ReservedUnits -= units
	l.replay.transactions = append(l.replay.transactions, batchQuotaRuntimeTransaction{
		IDempotencyKey: key,
		Kind:           "refund",
		Status:         "refunded",
		Units:          units,
	})
	kind := "refund"
	if child.Status == task.ChildStatusFailed && child.Metadata["dead_letter_state"] == "dead_lettered" {
		kind = "dead_letter_refund"
	}
	l.replay.events = append(l.replay.events, batchQuotaRuntimeEvent{
		EventID:                   runtimeRefundEventID(child.ID, kind),
		Kind:                      kind,
		Source:                    "BatchRunner.RunOnce -> BatchChildExecutor.ExecuteClaimedChild -> PostgresBatchQuotaLedger.RefundBatchQuota",
		ChildID:                   child.ID,
		FailureCode:               child.FailureCode,
		RetryState:                child.Metadata["retry_state"],
		DeadLetterState:           child.Metadata["dead_letter_state"],
		IDempotencyKey:            key,
		TransactionKind:           "refund",
		TransactionStatus:         "refunded",
		Units:                     int64Ptr(units),
		ReservedDelta:             -units,
		UsedDelta:                 0,
		QuotaIdempotencyKeySource: "BatchChildQuotaIdempotencyKey",
	})
	return nil
}

type batchQuotaRuntimeProvider struct {
	outcomes map[string]map[int]batchQuotaRuntimeProviderOutcome
}

type batchQuotaRuntimeProviderOutcome struct {
	status    string
	costUnits int64
	err       error
}

func (p *batchQuotaRuntimeProvider) Invoke(_ context.Context, req provider.Request) (provider.Response, error) {
	retryCount := runtimeRetryCount(req.IdempotencyKey)
	outcome := p.outcomes[req.TaskID][retryCount]
	if outcome.err != nil {
		return provider.Response{}, outcome.err
	}
	status := outcome.status
	if status == "" {
		status = "succeeded"
	}
	return provider.Response{
		ID:         fmt.Sprintf("provider_response_%s_retry_%d", req.TaskID, retryCount),
		RequestID:  req.ID,
		ProviderID: req.ProviderID,
		ModelID:    req.ModelID,
		Status:     status,
		Output:     map[string]any{"asset_ref": "opaque-provider-result"},
		Usage:      provider.Usage{InputTokens: 10, OutputTokens: 20, CostUnits: outcome.costUnits},
		TraceID:    req.TraceID,
		Provenance: provider.Provenance{
			ProviderID:      req.ProviderID,
			ModelID:         req.ModelID,
			EndpointVersion: "sandbox-v1",
		},
		CompletedAt: time.Date(2026, 6, 21, 18, 0, 0, 0, time.UTC),
	}, nil
}

func (p *batchQuotaRuntimeProvider) Status(context.Context) provider.Status {
	return provider.Status{ProviderID: "zenari-image-sandbox", Available: true}
}

func (p *batchQuotaRuntimeProvider) Capabilities() []provider.Capability {
	return []provider.Capability{{ProviderID: "zenari-image-sandbox", ModelID: "image-fast-v1", Endpoints: []string{"image"}, SupportsBatch: true}}
}

type batchQuotaRuntimeResultSink struct{}

func (batchQuotaRuntimeResultSink) PersistBatchChildResult(_ context.Context, input task.BatchChildResultInput) (task.BatchChildResult, error) {
	return task.BatchChildResult{
		AssetID:        "asset_" + input.Child.ID,
		CanvasObjectID: "object_" + input.Child.ID,
		Metadata:       map[string]string{"result_sink": "runtime_replay"},
	}, nil
}

func manualRetryChildID(idempotencyKey string) (string, bool) {
	parts := strings.Split(idempotencyKey, ":")
	if len(parts) < 4 || parts[len(parts)-2] != "retry" {
		return "", false
	}
	return parts[len(parts)-3], true
}

func runtimeRetryCount(idempotencyKey string) int {
	_, after, ok := strings.Cut(idempotencyKey, ":retry:")
	if !ok {
		return 0
	}
	value, _ := strconv.Atoi(after)
	return value
}

func runtimeRetryEventID(childID string, retryCount int) string {
	switch childID {
	case "child_retry_success_1":
		return "evt_retryable_provider_failure_requeued"
	case "child_dead_letter_1":
		return fmt.Sprintf("evt_dead_letter_retry_%d", retryCount)
	default:
		return "evt_retry_scheduled_" + childID + "_" + strconv.Itoa(retryCount)
	}
}

func runtimeCommitEventID(childID string) string {
	switch childID {
	case "child_success_1":
		return "evt_child_success_commit"
	case "child_retry_success_1":
		return "evt_retry_success_commit"
	case "child_manual_retry_1":
		return "evt_manual_retry_success_commit"
	case "child_reconcile_debit_1":
		return "evt_reconcile_debit_base_commit"
	case "child_reconcile_credit_1":
		return "evt_reconcile_credit_base_commit"
	default:
		return "evt_commit_" + childID
	}
}

func runtimeRefundEventID(childID, kind string) string {
	if kind == "dead_letter_refund" {
		switch childID {
		case "child_dead_letter_1":
			return "evt_dead_letter_final_refund"
		case "child_manual_retry_1":
			return "evt_manual_retry_prior_final_refund"
		}
	}
	switch childID {
	case "child_success_1":
		return "evt_child_success_refund_remainder"
	case "child_retry_success_1":
		return "evt_retry_success_refund_remainder"
	case "child_manual_retry_1":
		return "evt_manual_retry_success_refund_remainder"
	default:
		return "evt_refund_" + childID
	}
}

func runtimeReconcileEventID(kind string) string {
	if kind == "provider_usage_debit" {
		return "evt_provider_usage_debit_reconciliation"
	}
	return "evt_provider_usage_credit_reconciliation"
}

func parseRuntimeInt64(value string) int64 {
	parsed, _ := strconv.ParseInt(value, 10, 64)
	return parsed
}

func mergeRuntimeStringMaps(left, right map[string]string) map[string]string {
	merged := map[string]string{}
	for key, value := range left {
		merged[key] = value
	}
	for key, value := range right {
		merged[key] = value
	}
	return merged
}

func intPtr(value int) *int {
	return &value
}

func int64Ptr(value int64) *int64 {
	return &value
}

func boolPtr(value bool) *bool {
	return &value
}

func mustMarshalEvidence(t *testing.T, evidence batchQuotaRuntimeEvidence) []byte {
	t.Helper()
	data, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		t.Fatalf("marshal evidence: %v", err)
	}
	return append(data, '\n')
}

func assertJSONEqual(t *testing.T, want, got []byte) {
	t.Helper()
	var wantValue any
	if err := json.Unmarshal(want, &wantValue); err != nil {
		t.Fatalf("fixture JSON is invalid: %v", err)
	}
	var gotValue any
	if err := json.Unmarshal(got, &gotValue); err != nil {
		t.Fatalf("generated JSON is invalid: %v", err)
	}
	if !reflect.DeepEqual(wantValue, gotValue) {
		t.Fatalf("runtime replay evidence fixture mismatch\n--- generated ---\n%s", got)
	}
}
