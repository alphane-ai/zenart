package task

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

const promptSecretShapeFixture = "sk-" + "testsecretsecretsecretsecretsecret"

func TestValidateBatchGenerationRequestAcceptsPartialSuccessContract(t *testing.T) {
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusPartialSucceeded
	batch.Children = []GenerationChildTask{
		validGenerationChildTask("child_1", ChildStatusSucceeded),
		validGenerationChildTask("child_2", ChildStatusFailed),
		validGenerationChildTask("child_3", ChildStatusCancelled),
		validGenerationChildTask("child_4", ChildStatusBlocked),
	}
	batch.Children[1].FailureCode = "provider_unavailable"
	batch.Children[1].FailureMessage = "provider timed out"
	batch.Children[1].QuotaRefundedUnits = batch.Children[1].QuotaEstimateUnits
	batch.Children[2].QuotaRefundedUnits = batch.Children[2].QuotaEstimateUnits
	batch.Children[3].ReviewReason = "safety_review_required"
	batch.Children[3].QuotaRefundedUnits = batch.Children[3].QuotaEstimateUnits
	batch.QuotaCommittedUnits = 4
	batch.QuotaRefundedUnits = 12

	if err := ValidateBatchGenerationRequest(batch); err != nil {
		t.Fatalf("ValidateBatchGenerationRequest() error = %v", err)
	}
}

func TestValidateBatchGenerationRequestRejectsStatusDrift(t *testing.T) {
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusSucceeded
	batch.Children = []GenerationChildTask{
		validGenerationChildTask("child_1", ChildStatusSucceeded),
		validGenerationChildTask("child_2", ChildStatusRunning),
	}

	if err := ValidateBatchGenerationRequest(batch); err == nil {
		t.Fatal("ValidateBatchGenerationRequest() error = nil, want aggregate status drift")
	}
}

func TestValidateBatchGenerationRequestRejectsQuotaOverAccounting(t *testing.T) {
	batch := validBatchGenerationRequest()
	batch.QuotaCommittedUnits = 10
	batch.QuotaRefundedUnits = 10

	if err := ValidateBatchGenerationRequest(batch); err == nil {
		t.Fatal("ValidateBatchGenerationRequest() error = nil, want quota over-accounting error")
	}
}

func TestValidateGenerationChildTaskRequiresAssetAndCanvasObjectOnSuccess(t *testing.T) {
	child := validGenerationChildTask("child_1", ChildStatusSucceeded)
	child.AssetID = ""

	if err := ValidateGenerationChildTask(child); err == nil {
		t.Fatal("ValidateGenerationChildTask() error = nil, want asset_id requirement")
	}
}

func TestBuildBatchProgressCountsRetryableChildren(t *testing.T) {
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusPartialSucceeded
	batch.Children = []GenerationChildTask{
		validGenerationChildTask("child_1", ChildStatusSucceeded),
		validGenerationChildTask("child_2", ChildStatusFailed),
		validGenerationChildTask("child_3", ChildStatusFailed),
		validGenerationChildTask("child_4", ChildStatusRunning),
	}
	batch.Children[1].FailureCode = "provider_unavailable"
	batch.Children[1].RetryCount = 1
	batch.Children[1].MaxRetries = 2
	batch.Children[2].FailureCode = "safety_rejected"
	batch.Children[2].RetryCount = 2
	batch.Children[2].MaxRetries = 2
	batch.Children[2].Metadata = map[string]string{"dead_letter_state": "dead_lettered", "retryable": "false"}

	progress := BuildBatchProgress(batch)
	if progress.Succeeded != 1 || progress.Failed != 2 || progress.Running != 1 || progress.Retryable != 1 {
		t.Fatalf("progress = %#v, want succeeded=1 failed=2 running=1 retryable=1", progress)
	}
}

func TestAggregateBatchStatus(t *testing.T) {
	tests := []struct {
		name     string
		children []GenerationChildTask
		want     BatchStatus
	}{
		{name: "empty", children: nil, want: BatchStatusQueued},
		{name: "queued", children: []GenerationChildTask{validGenerationChildTask("child_1", ChildStatusQueued)}, want: BatchStatusQueued},
		{name: "running", children: []GenerationChildTask{validGenerationChildTask("child_1", ChildStatusSucceeded), validGenerationChildTask("child_2", ChildStatusRunning)}, want: BatchStatusRunning},
		{name: "succeeded", children: []GenerationChildTask{validGenerationChildTask("child_1", ChildStatusSucceeded), validGenerationChildTask("child_2", ChildStatusSucceeded)}, want: BatchStatusSucceeded},
		{name: "failed", children: []GenerationChildTask{failedChild("child_1"), failedChild("child_2")}, want: BatchStatusFailed},
		{name: "blocked", children: []GenerationChildTask{blockedChild("child_1")}, want: BatchStatusBlocked},
		{name: "partial", children: []GenerationChildTask{validGenerationChildTask("child_1", ChildStatusSucceeded), failedChild("child_2")}, want: BatchStatusPartialSucceeded},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := AggregateBatchStatus(tc.children); got != tc.want {
				t.Fatalf("AggregateBatchStatus() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBatchRepositoryCreateBatchPersistsRequestAndQueuedChildren(t *testing.T) {
	db := &batchFakeDB{}
	repo := NewBatchRepository(db)

	batch, err := repo.CreateBatch(context.Background(), BatchCreateInput{
		TenantID:       "tenant_1",
		UserID:         "user_1",
		ProjectID:      "project_1",
		WorkspaceID:    "workspace_1",
		PromptContext:  validBatchGenerationRequest().PromptContext,
		RequestedCount: 3,
		AllowedModels:  []string{"image-fast-v1"},
		IdempotencyKey: "idem_batch_1",
	})
	if err != nil {
		t.Fatalf("CreateBatch() error = %v", err)
	}
	if batch.TenantID != "tenant_1" || batch.UserID != "user_1" || batch.ProjectID != "project_1" {
		t.Fatalf("batch scope = %#v", batch)
	}
	if batch.Status != BatchStatusQueued || len(batch.Children) != 3 {
		t.Fatalf("batch status/children = %s/%d", batch.Status, len(batch.Children))
	}
	if batch.QuotaEstimatedUnits != 12 || batch.QuotaCommittedUnits != 0 || batch.QuotaRefundedUnits != 0 {
		t.Fatalf("quota = estimated %d committed %d refunded %d", batch.QuotaEstimatedUnits, batch.QuotaCommittedUnits, batch.QuotaRefundedUnits)
	}
	if len(db.execs) != 4 {
		t.Fatalf("exec count = %d, want 4", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO batch_generation_requests") {
		t.Fatalf("first exec = %s", db.execs[0].sql)
	}
	for _, exec := range db.execs[1:] {
		if !strings.Contains(exec.sql, "INSERT INTO generation_child_tasks") {
			t.Fatalf("child insert missing: %s", exec.sql)
		}
	}
}

func TestBatchRepositoryRejectsRawSecretsInPromptContext(t *testing.T) {
	repo := NewBatchRepository(&batchFakeDB{})
	_, err := repo.CreateBatch(context.Background(), BatchCreateInput{
		TenantID:       "tenant_1",
		UserID:         "user_1",
		ProjectID:      "project_1",
		WorkspaceID:    "workspace_1",
		PromptContext:  PromptContext{Text: "use " + promptSecretShapeFixture},
		RequestedCount: 1,
	})
	if !errors.Is(err, ErrBatchValidation) {
		t.Fatalf("CreateBatch() error = %v, want ErrBatchValidation", err)
	}
}

func TestBatchRepositoryGetBatchScansChildren(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	db := &batchFakeDB{
		row: batchFakeRow{values: batchRowValues(now)},
		queryRows: []batchRowSet{{
			rows: [][]any{childRowValues(now, validGenerationChildTask("child_1", ChildStatusQueued))},
		}},
	}
	repo := NewBatchRepository(db)

	batch, err := repo.GetBatch(context.Background(), "tenant_1", "batch_1")
	if err != nil {
		t.Fatalf("GetBatch() error = %v", err)
	}
	if batch.ID != "batch_1" || len(batch.Children) != 1 || batch.Children[0].ID != "child_1" {
		t.Fatalf("batch = %#v", batch)
	}
	if !strings.Contains(db.queryRowSQL, "WHERE tenant_id = $1 AND id = $2") {
		t.Fatalf("batch lookup must be tenant scoped: %s", db.queryRowSQL)
	}
}

func TestBatchRepositoryAdminQueueRuntimeUsesSafeProjection(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	child.Metadata = map[string]string{
		"claimed_by_worker_id":         "worker_stage1_local_1",
		"claim_attempt":                "2",
		"claim_expires_at":             "2026-06-21T12:15:00Z",
		"claim_timeout_seconds":        "900",
		"fanout_stage":                 "claimed_by_worker_scheduler",
		"routing_strategy_group_id":    "image-generation-default",
		"routing_selection_policy":     "weighted",
		"provider_concurrency":         "1/4 provider slots used",
		"provider_model_concurrency":   "1/4 provider-model slots used",
		"unsafe_raw_provider_payload":  "must_not_be_returned",
		"unsafe_hidden_prompt_excerpt": "must_not_be_returned",
	}
	db := &batchFakeDB{
		queryRows: []batchRowSet{
			{rows: [][]any{adminBatchRuntimeRowValues(now)}},
			{rows: [][]any{childRowValues(now, child)}},
		},
	}
	repo := NewBatchRepository(db)

	items, err := repo.ListAdminBatchQueueRuntime(context.Background(), "tenant_1", 25)
	if err != nil {
		t.Fatalf("ListAdminBatchQueueRuntime() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	got := items[0]
	if got.BatchID != "batch_1" || got.TenantID != "tenant_1" || got.WorkerID != "worker_stage1_local_1" {
		t.Fatalf("runtime projection = %#v", got)
	}
	if got.ProviderStrategyGroupID != "image-generation-default" || got.ProviderSelectionPolicy != "weighted" {
		t.Fatalf("routing projection = %#v", got)
	}
	if got.ClaimTimeoutSeconds != 900 || got.Running != 1 {
		t.Fatalf("claim/progress projection = %#v", got)
	}
	firstQuery := db.queryRowsConsumedSQL[0]
	if strings.Contains(firstQuery, "prompt_context") {
		t.Fatalf("admin queue runtime query must not select prompt_context: %s", firstQuery)
	}
}

func TestBatchRepositoryAdminChildTasksUseSafeProjection(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	child := failedChild("child_1")
	child.RetryCount = 1
	child.MaxRetries = 2
	child.FailureMessage = "raw provider failure with hidden prompt must not be returned"
	child.Metadata = map[string]string{
		"claimed_by_worker_id":        "worker_stage1_local_1",
		"claim_attempt":               "2",
		"claim_expires_at":            "2026-06-21T12:30:00Z",
		"fanout_stage":                "provider_execution_failed",
		"provider_usage_ref":          "provider_usage_child_1_failed",
		"unsafe_raw_provider_payload": "must_not_be_returned",
	}
	db := &batchFakeDB{
		queryRows: []batchRowSet{{rows: [][]any{childRowValues(now, child)}}},
	}
	repo := NewBatchRepository(db)

	items, err := repo.ListAdminBatchChildTasks(context.Background(), "tenant_1", 25)
	if err != nil {
		t.Fatalf("ListAdminBatchChildTasks() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	got := items[0]
	if got.ID != "child_1" || got.WorkerID != "worker_stage1_local_1" || got.RetryState != "retry_available" {
		t.Fatalf("child projection = %#v", got)
	}
	if got.ProviderUsageRef != "provider_usage_child_1_failed" || got.IdempotencyKey != "batch_child:child_1:retry:1" {
		t.Fatalf("usage/idempotency projection = %#v", got)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("Marshal projection error = %v", err)
	}
	for _, forbidden := range []string{"raw provider failure", "hidden prompt", "must_not_be_returned", "unsafe_raw_provider_payload"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("admin child projection leaked %q: %s", forbidden, encoded)
		}
	}
	if strings.Contains(db.queryRowsConsumedSQL[0], "prompt_context") {
		t.Fatalf("admin child query must not select prompt_context: %s", db.queryRowsConsumedSQL[0])
	}
}

func TestBatchRepositoryCancelBatchCancelsQueuedChildrenAndRefreshesAggregate(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	cancelledChild := validGenerationChildTask("child_1", ChildStatusCancelled)
	cancelledChild.QuotaRefundedUnits = cancelledChild.QuotaEstimateUnits
	cancelledBatchRow := batchRowValues(now)
	cancelledBatchRow[14] = string(BatchStatusCancelled)
	cancelledBatchRow[12] = int64(4)
	db := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: batchRowValues(now)},
			{values: cancelledBatchRow},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, validGenerationChildTask("child_1", ChildStatusQueued))}},
			{rows: [][]any{childRowValues(now, cancelledChild)}},
			{rows: [][]any{childRowValues(now, cancelledChild)}},
		},
	}
	repo := NewBatchRepository(db)

	batch, err := repo.CancelBatch(context.Background(), "tenant_1", "batch_1")
	if err != nil {
		t.Fatalf("CancelBatch() error = %v", err)
	}
	if batch.Status != BatchStatusCancelled {
		t.Fatalf("batch status = %s, want cancelled", batch.Status)
	}
	foundCancelUpdate := false
	for _, exec := range db.execs {
		foundCancelUpdate = foundCancelUpdate || strings.Contains(exec.sql, "status = 'cancelled'")
	}
	if !foundCancelUpdate {
		t.Fatalf("cancel update not recorded: %#v", db.execs)
	}
}

func TestBatchRepositoryRetryChildRequiresFailedRetryableChild(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	failed := failedChild("child_1")
	failed.RetryCount = 0
	failed.MaxRetries = 2
	retried := failed
	retried.Status = ChildStatusQueued
	retried.RetryCount = 1
	retried.FailureCode = ""
	retried.FailureMessage = ""
	retried.QuotaRefundedUnits = 0
	db := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: childRowValues(now, failed)},
			{values: batchRowValues(now)},
			{values: childRowValues(now, retried)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, failed)}},
			{rows: [][]any{childRowValues(now, retried)}},
		},
	}
	repo := NewBatchRepository(db)

	child, err := repo.RetryChild(context.Background(), "tenant_1", "child_1")
	if err != nil {
		t.Fatalf("RetryChild() error = %v", err)
	}
	if child.Status != ChildStatusQueued || child.RetryCount != 1 || child.FailureCode != "" {
		t.Fatalf("retried child = %#v", child)
	}
	if !strings.Contains(db.queryRowSQL, "retry_count = retry_count + 1") {
		t.Fatalf("retry query missing increment: %s", db.queryRowSQL)
	}
}

func TestBatchRepositoryRetryChildRereservesRefundedQuotaWithLedger(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	failed := failedChild("child_1")
	failed.RetryCount = 1
	failed.MaxRetries = 2
	retried := failed
	retried.Status = ChildStatusQueued
	retried.RetryCount = 2
	retried.FailureCode = ""
	retried.FailureMessage = ""
	retried.QuotaRefundedUnits = 0
	db := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: childRowValues(now, failed)},
			{values: batchRowValues(now)},
			{values: childRowValues(now, retried)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, failed)}},
			{rows: [][]any{childRowValues(now, retried)}},
		},
	}
	ledger := &fakeBatchQuotaLedger{bucketID: "quota_bucket_1"}
	repo := NewBatchRepository(db).WithQuotaLedger(ledger)

	child, err := repo.RetryChild(context.Background(), "tenant_1", "child_1")
	if err != nil {
		t.Fatalf("RetryChild() error = %v", err)
	}
	if child.Status != ChildStatusQueued || child.RetryCount != 2 {
		t.Fatalf("retried child = %#v", child)
	}
	if !ledger.reserved || ledger.reservedBatch.QuotaEstimatedUnits != failed.QuotaRefundedUnits {
		t.Fatalf("retry reservation = reserved %v batch %#v", ledger.reserved, ledger.reservedBatch)
	}
	if !strings.Contains(ledger.reservedBatch.QuotaReservationID, ":child_1:retry:2") {
		t.Fatalf("retry quota reservation id = %q", ledger.reservedBatch.QuotaReservationID)
	}
	retrySQL := findBatchQueryRowSQL(db.queryRowSQLs, "manual_retry_requested")
	if !strings.Contains(retrySQL, "'dead_letter_state', 'not_dead_lettered'") || !strings.Contains(retrySQL, "'retryable', 'true'") {
		t.Fatalf("retry query must clear dead-letter metadata for manual retry: %s", retrySQL)
	}
}

func TestBatchRepositoryCompleteChildSuccessRequiresRunningAndRefreshesAggregate(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	running := validGenerationChildTask("child_1", ChildStatusRunning)
	completed := running
	completed.Status = ChildStatusSucceeded
	completed.AssetID = "asset_child_1"
	completed.CanvasObjectID = "object_child_1"
	completed.QuotaCommittedUnits = 2
	completed.QuotaRefundedUnits = 2
	completed.Metadata = map[string]string{"fanout_stage": "provider_execution_succeeded", "request_hash": "hash_1"}
	db := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: childRowValues(now, running)},
			{values: batchRowValues(now)},
			{values: childRowValues(now, completed)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, running)}},
			{rows: [][]any{childRowValues(now, completed)}},
		},
	}
	repo := NewBatchRepository(db)

	child, err := repo.CompleteChildSuccess(context.Background(), CompleteChildSuccessInput{
		TenantID:            "tenant_1",
		ChildID:             "child_1",
		AssetID:             "asset_child_1",
		CanvasObjectID:      "object_child_1",
		QuotaCommittedUnits: 2,
		Metadata:            map[string]string{"fanout_stage": "provider_execution_succeeded", "request_hash": "hash_1"},
	})
	if err != nil {
		t.Fatalf("CompleteChildSuccess() error = %v", err)
	}
	if child.Status != ChildStatusSucceeded || child.QuotaCommittedUnits != 2 || child.QuotaRefundedUnits != 2 {
		t.Fatalf("completed child = %#v", child)
	}
	successSQL := findBatchQueryRowSQL(db.queryRowSQLs, "status = 'succeeded'")
	if !strings.Contains(successSQL, "asset_id = $3") || !strings.Contains(successSQL, "canvas_object_id = $4") {
		t.Fatalf("success query missing result fields: %s", successSQL)
	}
	if !strings.Contains(successSQL, "quota_refunded_units = quota_refunded_units + $6") {
		t.Fatalf("success query must refund unused reserved quota: %s", successSQL)
	}
	if !strings.Contains(successSQL, "WHERE tenant_id = $1 AND id = $2 AND status = 'running'") {
		t.Fatalf("success query must only complete running tenant-scoped child: %s", successSQL)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "UPDATE batch_generation_requests") {
		t.Fatalf("batch aggregate refresh execs = %#v", db.execs)
	}
}

func TestBatchRepositoryCompleteChildSuccessRollsBackWhenLedgerCommitFails(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	running := validGenerationChildTask("child_1", ChildStatusRunning)
	completed := running
	completed.Status = ChildStatusSucceeded
	completed.AssetID = "asset_child_1"
	completed.CanvasObjectID = "object_child_1"
	completed.QuotaCommittedUnits = 4
	outerDB := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: childRowValues(now, running)},
			{values: batchRowValues(now)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, running)}},
		},
	}
	tx := &batchFakeTx{
		batchFakeDB: &batchFakeDB{
			rowQueue: []batchFakeRow{{values: childRowValues(now, completed)}},
		},
	}
	db := &batchFakeTransactorDB{batchFakeDB: outerDB, tx: tx}
	ledger := &fakeBatchQuotaLedger{bucketID: "quota_bucket_1", commitErr: errors.New("forced ledger commit failure")}
	repo := NewBatchRepository(db).WithQuotaLedger(ledger)

	_, err := repo.CompleteChildSuccess(context.Background(), CompleteChildSuccessInput{
		TenantID:            "tenant_1",
		ChildID:             "child_1",
		AssetID:             "asset_child_1",
		CanvasObjectID:      "object_child_1",
		QuotaCommittedUnits: 4,
		Metadata:            map[string]string{"fanout_stage": "provider_execution_succeeded"},
	})
	if err == nil || !strings.Contains(err.Error(), "forced ledger commit failure") {
		t.Fatalf("CompleteChildSuccess() error = %v, want ledger commit failure", err)
	}
	if !db.beginCalled {
		t.Fatal("transaction was not started")
	}
	if !tx.rollbackCalled || tx.commitCalled {
		t.Fatalf("tx rollback=%v commit=%v, want rollback only", tx.rollbackCalled, tx.commitCalled)
	}
	if successSQL := findBatchQueryRowSQL(tx.queryRowSQLs, "status = 'succeeded'"); successSQL == "" {
		t.Fatalf("transaction did not attempt child success update: %#v", tx.queryRowSQLs)
	}
}

func TestBatchRepositoryCompleteChildFailureRefundsRemainingQuota(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	running := validGenerationChildTask("child_1", ChildStatusRunning)
	failed := running
	failed.Status = ChildStatusFailed
	failed.FailureCode = "provider_invoke_failed"
	failed.FailureMessage = "provider timeout"
	failed.QuotaRefundedUnits = 4
	failed.Metadata = map[string]string{"fanout_stage": "provider_execution_failed"}
	db := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: childRowValues(now, running)},
			{values: batchRowValues(now)},
			{values: childRowValues(now, failed)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, running)}},
			{rows: [][]any{childRowValues(now, failed)}},
		},
	}
	repo := NewBatchRepository(db)

	child, err := repo.CompleteChildFailure(context.Background(), CompleteChildFailureInput{
		TenantID:       "tenant_1",
		ChildID:        "child_1",
		FailureCode:    "provider_invoke_failed",
		FailureMessage: "provider timeout",
		Metadata:       map[string]string{"fanout_stage": "provider_execution_failed"},
	})
	if err != nil {
		t.Fatalf("CompleteChildFailure() error = %v", err)
	}
	if child.Status != ChildStatusFailed || child.QuotaRefundedUnits != 4 {
		t.Fatalf("failed child = %#v", child)
	}
	failureSQL := findBatchQueryRowSQL(db.queryRowSQLs, "status = 'failed'")
	if !strings.Contains(failureSQL, "quota_refunded_units = quota_refunded_units + $5") {
		t.Fatalf("failure query missing failed/refund update: %s", failureSQL)
	}
	if !strings.Contains(failureSQL, "WHERE tenant_id = $1 AND id = $2 AND status = 'running'") {
		t.Fatalf("failure query must only fail running tenant-scoped child: %s", failureSQL)
	}
}

func TestBatchRepositoryCompleteChildFailureRollsBackWhenLedgerRefundFails(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	running := validGenerationChildTask("child_1", ChildStatusRunning)
	failed := running
	failed.Status = ChildStatusFailed
	failed.FailureCode = "provider_invoke_failed"
	failed.FailureMessage = "provider timeout"
	failed.QuotaRefundedUnits = 4
	outerDB := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: childRowValues(now, running)},
			{values: batchRowValues(now)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, running)}},
		},
	}
	tx := &batchFakeTx{
		batchFakeDB: &batchFakeDB{
			rowQueue: []batchFakeRow{{values: childRowValues(now, failed)}},
		},
	}
	db := &batchFakeTransactorDB{batchFakeDB: outerDB, tx: tx}
	ledger := &fakeBatchQuotaLedger{bucketID: "quota_bucket_1", refundErr: errors.New("forced ledger refund failure")}
	repo := NewBatchRepository(db).WithQuotaLedger(ledger)

	_, err := repo.CompleteChildFailure(context.Background(), CompleteChildFailureInput{
		TenantID:       "tenant_1",
		ChildID:        "child_1",
		FailureCode:    "provider_invoke_failed",
		FailureMessage: "provider timeout",
		Metadata:       map[string]string{"fanout_stage": "provider_execution_failed"},
	})
	if err == nil || !strings.Contains(err.Error(), "forced ledger refund failure") {
		t.Fatalf("CompleteChildFailure() error = %v, want ledger refund failure", err)
	}
	if !db.beginCalled {
		t.Fatal("transaction was not started")
	}
	if !tx.rollbackCalled || tx.commitCalled {
		t.Fatalf("tx rollback=%v commit=%v, want rollback only", tx.rollbackCalled, tx.commitCalled)
	}
	if failureSQL := findBatchQueryRowSQL(tx.queryRowSQLs, "status = 'failed'"); failureSQL == "" {
		t.Fatalf("transaction did not attempt child failure update: %#v", tx.queryRowSQLs)
	}
}

func TestBatchRepositoryBlockChildForReviewRefundsRemainingQuota(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	running := validGenerationChildTask("child_1", ChildStatusRunning)
	blocked := running
	blocked.Status = ChildStatusBlocked
	blocked.ReviewReason = "safety_review_required"
	blocked.QuotaRefundedUnits = 4
	blocked.Metadata = map[string]string{
		"fanout_stage":     "safety_gate_blocked",
		"provider_invoked": "false",
	}
	db := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: childRowValues(now, running)},
			{values: batchRowValues(now)},
			{values: childRowValues(now, blocked)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, running)}},
			{rows: [][]any{childRowValues(now, blocked)}},
		},
	}
	repo := NewBatchRepository(db)

	child, err := repo.BlockChildForReview(context.Background(), BlockChildForReviewInput{
		TenantID:     "tenant_1",
		ChildID:      "child_1",
		ReviewReason: "safety_review_required",
		Metadata: map[string]string{
			"fanout_stage":     "safety_gate_blocked",
			"provider_invoked": "false",
		},
	})
	if err != nil {
		t.Fatalf("BlockChildForReview() error = %v", err)
	}
	if child.Status != ChildStatusBlocked || child.ReviewReason != "safety_review_required" || child.QuotaRefundedUnits != 4 {
		t.Fatalf("blocked child = %#v", child)
	}
	if child.FailureCode != "" || child.FailureMessage != "" {
		t.Fatalf("blocked child should clear failure fields: %#v", child)
	}
	blockSQL := findBatchQueryRowSQL(db.queryRowSQLs, "status = 'blocked'")
	if !strings.Contains(blockSQL, "review_reason = $3") || !strings.Contains(blockSQL, "quota_refunded_units = quota_refunded_units + $4") {
		t.Fatalf("block query missing review/refund update: %s", blockSQL)
	}
	if !strings.Contains(blockSQL, "WHERE tenant_id = $1 AND id = $2 AND status = 'running'") {
		t.Fatalf("block query must only block running tenant-scoped child: %s", blockSQL)
	}
}

func TestBatchRepositoryBlockChildForReviewRollsBackWhenLedgerRefundFails(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	running := validGenerationChildTask("child_1", ChildStatusRunning)
	blocked := running
	blocked.Status = ChildStatusBlocked
	blocked.ReviewReason = "safety_review_required"
	blocked.QuotaRefundedUnits = 4
	outerDB := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: childRowValues(now, running)},
			{values: batchRowValues(now)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, running)}},
		},
	}
	tx := &batchFakeTx{
		batchFakeDB: &batchFakeDB{
			rowQueue: []batchFakeRow{{values: childRowValues(now, blocked)}},
		},
	}
	db := &batchFakeTransactorDB{batchFakeDB: outerDB, tx: tx}
	ledger := &fakeBatchQuotaLedger{bucketID: "quota_bucket_1", refundErr: errors.New("forced ledger refund failure")}
	repo := NewBatchRepository(db).WithQuotaLedger(ledger)

	_, err := repo.BlockChildForReview(context.Background(), BlockChildForReviewInput{
		TenantID:     "tenant_1",
		ChildID:      "child_1",
		ReviewReason: "safety_review_required",
		Metadata:     map[string]string{"fanout_stage": "safety_gate_blocked"},
	})
	if err == nil || !strings.Contains(err.Error(), "forced ledger refund failure") {
		t.Fatalf("BlockChildForReview() error = %v, want ledger refund failure", err)
	}
	if !db.beginCalled {
		t.Fatal("transaction was not started")
	}
	if !tx.rollbackCalled || tx.commitCalled {
		t.Fatalf("tx rollback=%v commit=%v, want rollback only", tx.rollbackCalled, tx.commitCalled)
	}
	if blockSQL := findBatchQueryRowSQL(tx.queryRowSQLs, "status = 'blocked'"); blockSQL == "" {
		t.Fatalf("transaction did not attempt child block update: %#v", tx.queryRowSQLs)
	}
}

func TestBatchRepositoryMarkChildRetryScheduledRequeuesWithoutRefund(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	running := validGenerationChildTask("child_1", ChildStatusRunning)
	retried := running
	retried.Status = ChildStatusQueued
	retried.RetryCount = 1
	retried.FailureCode = "provider_invoke_failed"
	retried.FailureMessage = "provider timeout"
	retried.Metadata = map[string]string{
		"fanout_stage":      "provider_execution_failed",
		"retry_state":       "scheduled",
		"retryable":         "true",
		"dead_letter_state": "not_dead_lettered",
	}
	db := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: childRowValues(now, running)},
			{values: childRowValues(now, retried)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, retried)}},
		},
	}
	repo := NewBatchRepository(db)

	child, err := repo.MarkChildRetryScheduled(context.Background(), CompleteChildFailureInput{
		TenantID:       "tenant_1",
		ChildID:        "child_1",
		FailureCode:    "provider_invoke_failed",
		FailureMessage: "provider timeout",
		Retryable:      true,
		Metadata:       map[string]string{"fanout_stage": "provider_execution_failed"},
	})
	if err != nil {
		t.Fatalf("MarkChildRetryScheduled() error = %v", err)
	}
	if child.Status != ChildStatusQueued || child.RetryCount != 1 || child.QuotaRefundedUnits != 0 {
		t.Fatalf("retried child = %#v", child)
	}
	retrySQL := findBatchQueryRowSQL(db.queryRowSQLs, "retry_count = retry_count + 1")
	if !strings.Contains(retrySQL, "status = 'queued'") || !strings.Contains(retrySQL, "retry_count < max_retries") {
		t.Fatalf("retry query missing queue/retry guard: %s", retrySQL)
	}
	retrySetClause := retrySQL
	if before, _, ok := strings.Cut(retrySQL, "WHERE tenant_id"); ok {
		retrySetClause = before
	}
	if strings.Contains(retrySetClause, "quota_refunded_units") {
		t.Fatalf("retry query must not refund reserved quota: %s", retrySQL)
	}
}

func TestBatchRepositoryClaimsRunnableChildrenWithConcurrencyPolicy(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	childOne := validGenerationChildTask("child_1", ChildStatusQueued)
	childTwo := validGenerationChildTask("child_2", ChildStatusQueued)
	claimed := childOne
	claimed.Status = ChildStatusRunning
	claimed.Metadata = map[string]string{"claimed_by_worker_id": "worker_1", "fanout_stage": "claimed_by_worker_scheduler"}
	db := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: countRowValues(0)}, // tenant running
			{values: countRowValues(0)}, // provider running
			{values: countRowValues(0)}, // provider:model running
			{values: childRowValues(now, claimed)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{
				childRowValues(now, childOne),
				childRowValues(now, childTwo),
			}},
			{rows: [][]any{childRowValues(now, claimed)}},
		},
	}
	repo := NewBatchRepository(db)

	claim, err := repo.ClaimRunnableChildren(context.Background(), BatchSchedulePolicy{
		TenantID:             "tenant_1",
		WorkerID:             "worker_1",
		Limit:                5,
		MaxTenantConcurrency: 1,
		ProviderMaxConcurrency: map[string]int{
			"zenari-image-sandbox": 1,
		},
		ProviderModelConcurrency: map[string]int{
			"zenari-image-sandbox:image-fast-v1": 1,
		},
		AllowedProviderModelTools: []ProviderModelTool{{
			ProviderID: "zenari-image-sandbox",
			ModelID:    "image-fast-v1",
			ToolType:   "image.generate",
		}},
	})
	if err != nil {
		t.Fatalf("ClaimRunnableChildren() error = %v", err)
	}
	if len(claim.Children) != 1 {
		t.Fatalf("claimed children = %#v, want one child due concurrency limit", claim.Children)
	}
	if claim.Children[0].Status != ChildStatusRunning || claim.Children[0].Metadata["claimed_by_worker_id"] != "worker_1" {
		t.Fatalf("claimed child = %#v, want running with worker metadata", claim.Children[0])
	}
	if claim.ProviderRunning["zenari-image-sandbox"] != 1 || claim.ProviderModelRunning["zenari-image-sandbox:image-fast-v1"] != 1 {
		t.Fatalf("claim counters = %#v/%#v, want provider and model running counts", claim.ProviderRunning, claim.ProviderModelRunning)
	}
	if len(db.queryRowSQLs) < 4 {
		t.Fatalf("query row sqls = %#v, want count and claim queries", db.queryRowSQLs)
	}
	if !strings.Contains(db.queryRowSQLs[len(db.queryRowSQLs)-1], "claimed_by_worker_id") {
		t.Fatalf("claim query = %s, want worker metadata update", db.queryRowSQLs[len(db.queryRowSQLs)-1])
	}
	if !strings.Contains(db.queryRowSQLs[len(db.queryRowSQLs)-1], "claim_expires_at") || !strings.Contains(db.queryRowSQLs[len(db.queryRowSQLs)-1], "claim_attempt") {
		t.Fatalf("claim query = %s, want claim lease metadata", db.queryRowSQLs[len(db.queryRowSQLs)-1])
	}
	if len(db.execs) == 0 || !strings.Contains(db.execs[0].sql, "claim_timeout_requeued") {
		t.Fatalf("expected expired claim lease release before claim, execs = %#v", db.execs)
	}
}

func TestBatchRepositoryClaimRunnableChildrenReturnsEmptyAtTenantLimit(t *testing.T) {
	db := &batchFakeDB{rowQueue: []batchFakeRow{{values: countRowValues(2)}}}
	repo := NewBatchRepository(db)

	claim, err := repo.ClaimRunnableChildren(context.Background(), BatchSchedulePolicy{
		TenantID:             "tenant_1",
		WorkerID:             "worker_1",
		Limit:                5,
		MaxTenantConcurrency: 2,
	})
	if err != nil {
		t.Fatalf("ClaimRunnableChildren() error = %v", err)
	}
	if len(claim.Children) != 0 || claim.TenantRunning != 2 {
		t.Fatalf("claim = %#v, want empty claim at tenant limit", claim)
	}
}

func TestBatchRepositoryReleaseExpiredClaimLeasesBeforeCountingConcurrency(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	requeued := validGenerationChildTask("child_1", ChildStatusQueued)
	db := &batchFakeDB{
		rowQueue: []batchFakeRow{
			{values: countRowValues(0)},
			{values: childRowValues(now, requeued)},
		},
		queryRows: []batchRowSet{
			{rows: [][]any{childRowValues(now, requeued)}},
			{rows: [][]any{childRowValues(now, requeued)}},
		},
	}
	repo := NewBatchRepository(db)

	_, err := repo.ClaimRunnableChildren(context.Background(), BatchSchedulePolicy{
		TenantID:     "tenant_1",
		WorkerID:     "worker_1",
		Limit:        1,
		ClaimTimeout: time.Minute,
	})
	if err != nil {
		t.Fatalf("ClaimRunnableChildren() error = %v", err)
	}
	if len(db.execs) == 0 {
		t.Fatal("expected expired lease release exec before count")
	}
	releaseSQL := db.execs[0].sql
	for _, snippet := range []string{
		"status = 'queued'",
		"claim_timeout_requeued",
		"metadata->>'claim_expires_at'",
		"quota_committed_units = 0",
		"quota_refunded_units = 0",
	} {
		if !strings.Contains(releaseSQL, snippet) {
			t.Fatalf("release expired claim SQL missing %q: %s", snippet, releaseSQL)
		}
	}
}

func validBatchGenerationRequest() BatchGenerationRequest {
	now := time.Date(2026, 6, 21, 11, 0, 0, 0, time.UTC)
	return BatchGenerationRequest{
		ID:          "batch_1",
		TenantID:    "tenant_1",
		UserID:      "user_1",
		ProjectID:   "project_1",
		WorkspaceID: "workspace_1",
		PromptContext: PromptContext{
			Text:              "Create four product hero image variants",
			SelectedObjectIDs: []string{"object_1"},
			ReferenceAssetIDs: []string{"asset_1"},
			BrandKitID:        "brand_kit_1",
			ModelHints:        []string{"image-fast-v1"},
			ToolHint:          "image.generate",
		},
		RequestedCount:      4,
		AllowedModels:       []string{"image-fast-v1"},
		QuotaReservationID:  "quota_reservation_1",
		QuotaBucketID:       "quota_bucket_1",
		QuotaEstimatedUnits: 16,
		QuotaCommittedUnits: 16,
		TraceID:             "trace_batch_1",
		Status:              BatchStatusSucceeded,
		Children: []GenerationChildTask{
			validGenerationChildTask("child_1", ChildStatusSucceeded),
			validGenerationChildTask("child_2", ChildStatusSucceeded),
			validGenerationChildTask("child_3", ChildStatusSucceeded),
			validGenerationChildTask("child_4", ChildStatusSucceeded),
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func validGenerationChildTask(id string, status ChildStatus) GenerationChildTask {
	now := time.Date(2026, 6, 21, 11, 0, 0, 0, time.UTC)
	child := GenerationChildTask{
		ID:                  id,
		BatchID:             "batch_1",
		TenantID:            "tenant_1",
		Status:              status,
		ProviderID:          "zenari-image-sandbox",
		ModelID:             "image-fast-v1",
		ToolType:            "image.generate",
		Seed:                id + "_seed",
		RetryCount:          0,
		MaxRetries:          2,
		QuotaEstimateUnits:  4,
		QuotaCommittedUnits: 0,
		TraceID:             "trace_" + id,
		VisibleTraceRef:     "trace_projection_" + id,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if status == ChildStatusSucceeded {
		child.AssetID = "asset_" + id
		child.CanvasObjectID = "object_" + id
		child.QuotaCommittedUnits = child.QuotaEstimateUnits
	}
	return child
}

func failedChild(id string) GenerationChildTask {
	child := validGenerationChildTask(id, ChildStatusFailed)
	child.FailureCode = "provider_unavailable"
	child.QuotaRefundedUnits = child.QuotaEstimateUnits
	return child
}

func blockedChild(id string) GenerationChildTask {
	child := validGenerationChildTask(id, ChildStatusBlocked)
	child.ReviewReason = "safety_review_required"
	child.QuotaRefundedUnits = child.QuotaEstimateUnits
	return child
}

type batchFakeDB struct {
	execs                []batchDBCall
	execErrAfter         int
	queryRowSQL          string
	queryRowSQLs         []string
	queryRowsConsumedSQL []string
	queryRows            []batchRowSet
	row                  batchFakeRow
	rowQueue             []batchFakeRow
}

type batchFakeTransactorDB struct {
	*batchFakeDB
	tx          *batchFakeTx
	beginCalled bool
	beginErr    error
}

func (f *batchFakeTransactorDB) Begin(context.Context) (store.Tx, error) {
	f.beginCalled = true
	if f.beginErr != nil {
		return nil, f.beginErr
	}
	if f.tx == nil {
		f.tx = &batchFakeTx{batchFakeDB: &batchFakeDB{}}
	}
	return f.tx, nil
}

type batchFakeTx struct {
	*batchFakeDB
	commitCalled   bool
	rollbackCalled bool
	commitErr      error
	rollbackErr    error
}

func (t *batchFakeTx) Commit(context.Context) error {
	t.commitCalled = true
	return t.commitErr
}

func (t *batchFakeTx) Rollback(context.Context) error {
	t.rollbackCalled = true
	return t.rollbackErr
}

type batchDBCall struct {
	sql  string
	args []any
}

type batchRowSet struct {
	rows [][]any
}

func (f *batchFakeDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execs = append(f.execs, batchDBCall{sql: sql, args: args})
	if f.execErrAfter > 0 && len(f.execs) >= f.execErrAfter {
		return pgconn.NewCommandTag("UPDATE 0"), errors.New("forced batch fake exec error")
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func (f *batchFakeDB) Query(_ context.Context, sql string, args ...any) (store.Rows, error) {
	f.queryRowsConsumedSQL = append(f.queryRowsConsumedSQL, sql)
	if len(f.queryRows) == 0 {
		return &batchFakeRows{}, nil
	}
	rows := f.queryRows[0]
	f.queryRows = f.queryRows[1:]
	return &batchFakeRows{rows: rows.rows}, nil
}

func (f *batchFakeDB) QueryRow(_ context.Context, sql string, args ...any) store.Row {
	f.queryRowSQL = sql
	f.queryRowSQLs = append(f.queryRowSQLs, sql)
	if strings.Contains(sql, "metadata->>'idempotency_fingerprint'") {
		return batchFakeRow{err: pgx.ErrNoRows}
	}
	if len(f.rowQueue) > 0 {
		row := f.rowQueue[0]
		f.rowQueue = f.rowQueue[1:]
		return row
	}
	if f.row.values != nil || f.row.err != nil {
		return f.row
	}
	return batchFakeRow{err: pgx.ErrNoRows}
}

type batchFakeRows struct {
	rows  [][]any
	index int
}

func (r *batchFakeRows) Close() {}

func (r *batchFakeRows) Err() error {
	return nil
}

func (r *batchFakeRows) Next() bool {
	if r.index >= len(r.rows) {
		return false
	}
	r.index++
	return true
}

func (r *batchFakeRows) Scan(dest ...any) error {
	row := r.rows[r.index-1]
	for i := range dest {
		assignBatchScan(dest[i], row[i])
	}
	return nil
}

type batchFakeRow struct {
	err    error
	values []any
}

func (r batchFakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i := range dest {
		assignBatchScan(dest[i], r.values[i])
	}
	return nil
}

func batchRowValues(now time.Time) []any {
	return []any{
		"batch_1",
		"tenant_1",
		"user_1",
		"project_1",
		"workspace_1",
		[]byte(`{"text":"Create four product hero image variants","selected_object_ids":["object_1"],"reference_asset_ids":["asset_1"],"brand_kit_id":"brand_kit_1","model_hints":["image-fast-v1"],"tool_hint":"image.generate"}`),
		4,
		[]string{"image-fast-v1"},
		"quota_reservation_1",
		"quota_bucket_1",
		int64(16),
		int64(0),
		int64(0),
		"trace_batch_1",
		string(BatchStatusQueued),
		[]byte(`{"source":"api"}`),
		now,
		now,
	}
}

func adminBatchRuntimeRowValues(now time.Time) []any {
	return []any{
		"batch_1",
		"tenant_1",
		"user_1",
		"project_1",
		"workspace_1",
		4,
		[]string{"image-fast-v1"},
		"quota_reservation_1",
		"quota_bucket_1",
		int64(16),
		int64(0),
		int64(0),
		"trace_batch_1",
		string(BatchStatusRunning),
		[]byte(`{"routing_strategy_group_id":"image-generation-default","routing_selection_policy":"weighted","unsafe_prompt_note":"must_not_be_returned"}`),
		now,
		now,
	}
}

func childRowValues(now time.Time, child GenerationChildTask) []any {
	metadataJSON := []byte(`{"source":"api"}`)
	if child.Metadata != nil {
		marshaled, err := json.Marshal(child.Metadata)
		if err != nil {
			panic(err)
		}
		metadataJSON = marshaled
	}
	return []any{
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
		child.AssetID,
		child.CanvasObjectID,
		child.TraceID,
		child.VisibleTraceRef,
		child.FailureCode,
		child.FailureMessage,
		child.ReviewReason,
		metadataJSON,
		now,
		now,
	}
}

func countRowValues(count int64) []any {
	return []any{count}
}

func assignBatchScan(dest any, value any) {
	switch ptr := dest.(type) {
	case *string:
		*ptr = value.(string)
	case *[]byte:
		*ptr = value.([]byte)
	case *int:
		*ptr = value.(int)
	case *int64:
		*ptr = value.(int64)
	case *[]string:
		*ptr = value.([]string)
	case *time.Time:
		*ptr = value.(time.Time)
	default:
		panic("unsupported batch scan destination")
	}
}

func findBatchQueryRowSQL(queries []string, snippet string) string {
	for _, query := range queries {
		if strings.Contains(query, snippet) {
			return query
		}
	}
	return ""
}
