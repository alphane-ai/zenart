package worker

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/provider"
	"github.com/alphane-ai/zenart/backend/internal/task"
)

func TestBatchRunnerRunOnceClaimsAndExecutesChildren(t *testing.T) {
	now := time.Date(2026, 6, 21, 14, 0, 0, 0, time.UTC)
	child := workerBatchChild(task.ChildStatusRunning)
	store := &workerBatchStore{
		claim: task.BatchScheduleClaim{Children: []task.GenerationChildTask{child}},
		batch: workerBatchRequest(child),
	}
	providerClient := &workerBatchProvider{response: provider.Response{
		ID:          "provider_response_1",
		RequestID:   "provider_request:child_1",
		ProviderID:  child.ProviderID,
		ModelID:     child.ModelID,
		Status:      "succeeded",
		Usage:       provider.Usage{CostUnits: 3},
		TraceID:     child.TraceID,
		Provenance:  provider.Provenance{EndpointVersion: "sandbox-v1"},
		CompletedAt: now,
	}}
	executor := task.BatchChildExecutor{
		Providers:  task.ProviderClientMap{child.ProviderID: providerClient},
		ResultSink: workerBatchResultSink{},
		Now:        func() time.Time { return now },
	}
	runner := NewBatchRunner(store, executor, nil, BatchRunnerOptions{
		Policy: task.BatchSchedulePolicy{
			TenantID: "tenant_1",
			WorkerID: "worker_1",
			Limit:    1,
		},
		PollInterval: time.Hour,
	})

	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if store.claimPolicy.WorkerID != "worker_1" || store.claimPolicy.Limit != 1 {
		t.Fatalf("claim policy = %#v", store.claimPolicy)
	}
	if !store.successCalled {
		t.Fatal("batch runner did not complete claimed child")
	}
	if store.successInput.AssetID != "asset_child_1" || store.successInput.CanvasObjectID != "object_child_1" {
		t.Fatalf("success result ids = %#v", store.successInput)
	}
	if store.successInput.QuotaCommittedUnits != 3 || store.successInput.QuotaRefundedUnits != 1 {
		t.Fatalf("success quota = committed %d refunded %d", store.successInput.QuotaCommittedUnits, store.successInput.QuotaRefundedUnits)
	}
}

func TestBatchRunnerRunOnceAllowsEmptyClaim(t *testing.T) {
	store := &workerBatchStore{claim: task.BatchScheduleClaim{}}
	runner := NewBatchRunner(store, task.BatchChildExecutor{}, nil, BatchRunnerOptions{
		Policy: task.BatchSchedulePolicy{TenantID: "tenant_1", WorkerID: "worker_1", Limit: 5},
	})

	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if store.successCalled || store.failureCalled {
		t.Fatalf("empty claim should not complete or fail children")
	}
}

func TestBatchRunnerDrainStopsNewClaims(t *testing.T) {
	child := workerBatchChild(task.ChildStatusRunning)
	store := &workerBatchStore{
		claim: task.BatchScheduleClaim{Children: []task.GenerationChildTask{child}},
		batch: workerBatchRequest(child),
	}
	runner := NewBatchRunner(store, task.BatchChildExecutor{}, nil, BatchRunnerOptions{
		Policy: task.BatchSchedulePolicy{TenantID: "tenant_1", WorkerID: "worker_1", Limit: 1},
	})

	runner.Drain()
	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if store.claimCalled || store.successCalled || store.failureCalled || store.retryCalled || store.blockCalled {
		t.Fatalf("drained runner should not claim or execute: %#v", store)
	}
}

func TestBatchRunnerRunOnceSchedulesRetryForTransientProviderFailure(t *testing.T) {
	child := workerBatchChild(task.ChildStatusRunning)
	store := &workerBatchStore{
		claim: task.BatchScheduleClaim{Children: []task.GenerationChildTask{child}},
		batch: workerBatchRequest(child),
	}
	providerClient := &workerBatchProvider{err: errors.New("upstream timeout")}
	executor := task.BatchChildExecutor{
		Providers: task.ProviderClientMap{child.ProviderID: providerClient},
	}
	runner := NewBatchRunner(store, executor, nil, BatchRunnerOptions{
		Policy: task.BatchSchedulePolicy{
			TenantID: "tenant_1",
			WorkerID: "worker_1",
			Limit:    1,
		},
		PollInterval: time.Hour,
	})

	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if !store.retryCalled || store.failureCalled {
		t.Fatalf("retry/failure called = %v/%v, want retry only", store.retryCalled, store.failureCalled)
	}
	if store.retryInput.FailureCode != "provider_invoke_failed" || store.retryInput.Metadata["retryable"] != "true" {
		t.Fatalf("retry input = %#v", store.retryInput)
	}
}

func TestBatchRunnerRunOnceBlocksSafetyDeniedChildBeforeProvider(t *testing.T) {
	child := workerBatchChild(task.ChildStatusRunning)
	store := &workerBatchStore{
		claim: task.BatchScheduleClaim{Children: []task.GenerationChildTask{child}},
		batch: workerBatchRequest(child),
	}
	providerClient := &workerBatchProvider{response: provider.Response{Status: "succeeded"}}
	executor := task.BatchChildExecutor{
		Providers:  task.ProviderClientMap{child.ProviderID: providerClient},
		SafetyGate: workerBatchSafetyGate{},
	}
	runner := NewBatchRunner(store, executor, nil, BatchRunnerOptions{
		Policy: task.BatchSchedulePolicy{
			TenantID: "tenant_1",
			WorkerID: "worker_1",
			Limit:    1,
		},
		PollInterval: time.Hour,
	})

	if err := runner.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if !store.blockCalled || store.blockInput.ReviewReason != "safety_review_required" {
		t.Fatalf("block input = called %v %#v", store.blockCalled, store.blockInput)
	}
	if store.blockInput.QuotaRefundedUnits != child.QuotaEstimateUnits {
		t.Fatalf("block refund = %d, want %d", store.blockInput.QuotaRefundedUnits, child.QuotaEstimateUnits)
	}
	if providerClient.invoked {
		t.Fatal("provider was invoked despite safety gate block")
	}
	if store.successCalled || store.failureCalled || store.retryCalled {
		t.Fatalf("safety block should not complete/fail/retry: success=%v failure=%v retry=%v", store.successCalled, store.failureCalled, store.retryCalled)
	}
	if store.blockInput.Metadata["fanout_stage"] != "safety_gate_blocked" || store.blockInput.Metadata["provider_invoked"] != "false" {
		t.Fatalf("safety block metadata = %#v", store.blockInput.Metadata)
	}
}

type workerBatchStore struct {
	claim         task.BatchScheduleClaim
	claimPolicy   task.BatchSchedulePolicy
	batch         task.BatchGenerationRequest
	successInput  task.CompleteChildSuccessInput
	failureInput  task.CompleteChildFailureInput
	retryInput    task.CompleteChildFailureInput
	blockInput    task.BlockChildForReviewInput
	successCalled bool
	failureCalled bool
	retryCalled   bool
	blockCalled   bool
	claimCalled   bool
}

func (s *workerBatchStore) ClaimRunnableChildren(_ context.Context, policy task.BatchSchedulePolicy) (task.BatchScheduleClaim, error) {
	s.claimCalled = true
	s.claimPolicy = policy
	return s.claim, nil
}

func (s *workerBatchStore) GetBatch(_ context.Context, tenantID, batchID string) (task.BatchGenerationRequest, error) {
	if tenantID != s.batch.TenantID || batchID != s.batch.ID {
		return task.BatchGenerationRequest{}, task.ErrNotFound
	}
	return s.batch, nil
}

func (s *workerBatchStore) CompleteChildSuccess(_ context.Context, input task.CompleteChildSuccessInput) (task.GenerationChildTask, error) {
	s.successCalled = true
	s.successInput = input
	child := s.batch.Children[0]
	child.Status = task.ChildStatusSucceeded
	child.AssetID = input.AssetID
	child.CanvasObjectID = input.CanvasObjectID
	child.QuotaCommittedUnits += input.QuotaCommittedUnits
	child.QuotaRefundedUnits += input.QuotaRefundedUnits
	child.Metadata = input.Metadata
	return child, nil
}

func (s *workerBatchStore) CompleteChildFailure(_ context.Context, input task.CompleteChildFailureInput) (task.GenerationChildTask, error) {
	s.failureCalled = true
	s.failureInput = input
	child := s.batch.Children[0]
	child.Status = task.ChildStatusFailed
	child.FailureCode = input.FailureCode
	child.FailureMessage = input.FailureMessage
	child.QuotaRefundedUnits += input.QuotaRefundedUnits
	child.Metadata = input.Metadata
	return child, nil
}

func (s *workerBatchStore) BlockChildForReview(_ context.Context, input task.BlockChildForReviewInput) (task.GenerationChildTask, error) {
	s.blockCalled = true
	s.blockInput = input
	child := s.batch.Children[0]
	child.Status = task.ChildStatusBlocked
	child.ReviewReason = input.ReviewReason
	child.QuotaRefundedUnits += input.QuotaRefundedUnits
	child.Metadata = input.Metadata
	return child, nil
}

func (s *workerBatchStore) MarkChildRetryScheduled(_ context.Context, input task.CompleteChildFailureInput) (task.GenerationChildTask, error) {
	s.retryCalled = true
	s.retryInput = input
	child := s.batch.Children[0]
	child.Status = task.ChildStatusQueued
	child.RetryCount++
	child.FailureCode = input.FailureCode
	child.FailureMessage = input.FailureMessage
	child.Metadata = input.Metadata
	return child, nil
}

type workerBatchSafetyGate struct{}

func (workerBatchSafetyGate) EvaluateBatchChild(context.Context, task.BatchSafetyGateInput) (task.BatchSafetyDecision, error) {
	return task.BatchSafetyDecision{
		Allowed:      false,
		ReviewReason: "safety_review_required",
		PolicyID:     "policy_stage1_batch",
		RuleID:       "rule_prompt_hold",
	}, nil
}

type workerBatchProvider struct {
	response provider.Response
	err      error
	invoked  bool
}

func (p *workerBatchProvider) Invoke(_ context.Context, req provider.Request) (provider.Response, error) {
	p.invoked = true
	if p.err != nil {
		return provider.Response{}, p.err
	}
	if p.response.RequestID == "" {
		p.response.RequestID = req.ID
	}
	return p.response, nil
}

func (p *workerBatchProvider) Status(context.Context) provider.Status {
	return provider.Status{ProviderID: "zenari-image-sandbox", Available: true}
}

func (p *workerBatchProvider) Capabilities() []provider.Capability {
	return nil
}

type workerBatchResultSink struct{}

func (workerBatchResultSink) PersistBatchChildResult(_ context.Context, input task.BatchChildResultInput) (task.BatchChildResult, error) {
	return task.BatchChildResult{
		AssetID:        "asset_" + input.Child.ID,
		CanvasObjectID: "object_" + input.Child.ID,
		Metadata:       map[string]string{"result_sink": "worker_test"},
	}, nil
}

func workerBatchRequest(child task.GenerationChildTask) task.BatchGenerationRequest {
	return task.BatchGenerationRequest{
		ID:                  child.BatchID,
		TenantID:            child.TenantID,
		UserID:              "user_1",
		ProjectID:           "project_1",
		WorkspaceID:         "workspace_1",
		PromptContext:       task.PromptContext{Text: "Create one launch image", ToolHint: child.ToolType, ModelHints: []string{child.ModelID}},
		RequestedCount:      1,
		AllowedModels:       []string{child.ModelID},
		QuotaReservationID:  "quota_1",
		QuotaEstimatedUnits: child.QuotaEstimateUnits,
		TraceID:             "trace_batch_1",
		Status:              task.BatchStatusRunning,
		Children:            []task.GenerationChildTask{child},
		CreatedAt:           child.CreatedAt,
		UpdatedAt:           child.UpdatedAt,
	}
}

func workerBatchChild(status task.ChildStatus) task.GenerationChildTask {
	now := time.Date(2026, 6, 21, 14, 0, 0, 0, time.UTC)
	return task.GenerationChildTask{
		ID:                 "child_1",
		BatchID:            "batch_1",
		TenantID:           "tenant_1",
		Status:             status,
		ProviderID:         "zenari-image-sandbox",
		ModelID:            "image-fast-v1",
		ToolType:           "image.generate",
		Seed:               "seed_1",
		MaxRetries:         2,
		QuotaEstimateUnits: 4,
		TraceID:            "trace_child_1",
		VisibleTraceRef:    "trace_projection_child_1",
		Metadata:           map[string]string{"fanout_index": "0"},
		CreatedAt:          now,
		UpdatedAt:          now,
	}
}
