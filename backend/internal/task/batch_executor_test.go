package task

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/billing"
	"github.com/alphane-ai/zenart/backend/internal/provider"
)

const providerSecretShapeFixture = "sk-" + "testsecretsecretsecretsecretsecret"

func TestBatchChildExecutorPersistsProviderSuccessAndUsage(t *testing.T) {
	now := time.Date(2026, 6, 21, 13, 0, 0, 0, time.UTC)
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	child.Metadata = map[string]string{"fanout_index": "0", "claimed_by_worker_id": "worker_1"}
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusRunning
	batch.Children = []GenerationChildTask{child}
	batch.QuotaCommittedUnits = 0
	store := &executorFakeStore{batch: batch}
	client := &executorFakeProvider{
		response: provider.Response{
			ID:         "provider_response_1",
			RequestID:  "provider_request:child_1",
			ProviderID: child.ProviderID,
			ModelID:    child.ModelID,
			Status:     "succeeded",
			Output:     map[string]any{"asset_ref": "opaque-provider-result"},
			Usage:      provider.Usage{InputTokens: 12, OutputTokens: 24, CostUnits: 2},
			TraceID:    child.TraceID,
			Provenance: provider.Provenance{
				ProviderID:      child.ProviderID,
				ModelID:         child.ModelID,
				EndpointVersion: "sandbox-v1",
			},
			CompletedAt: now,
		},
	}
	sink := &executorFakeResultSink{result: BatchChildResult{
		AssetID:        "asset_child_1",
		CanvasObjectID: "object_child_1",
		Metadata:       map[string]string{"result_persisted_by": "fake_sink"},
	}}
	usage := &executorFakeUsageRecorder{}
	executor := BatchChildExecutor{
		Providers:     ProviderClientMap{child.ProviderID: client},
		ResultSink:    sink,
		UsageRecorder: usage,
		Now:           func() time.Time { return now },
	}

	completed, err := executor.ExecuteClaimedChild(context.Background(), store, child)
	if err != nil {
		t.Fatalf("ExecuteClaimedChild() error = %v", err)
	}
	if completed.Status != ChildStatusSucceeded || completed.AssetID != "asset_child_1" || completed.CanvasObjectID != "object_child_1" {
		t.Fatalf("completed child = %#v", completed)
	}
	if client.request.ID != "provider_request:child_1" || client.request.IdempotencyKey != "batch_child:child_1:retry:0" {
		t.Fatalf("provider request id/idempotency = %q/%q", client.request.ID, client.request.IdempotencyKey)
	}
	if client.request.Payload["prompt"] != batch.PromptContext.Text || client.request.Payload["fanout_index"] != "0" {
		t.Fatalf("provider payload = %#v", client.request.Payload)
	}
	if client.request.Provenance.RequestHash == "" {
		t.Fatalf("provider request provenance missing request hash: %#v", client.request.Provenance)
	}
	if sink.input.ProviderRequest.Provenance.RequestHash != client.request.Provenance.RequestHash {
		t.Fatalf("sink did not receive provider request provenance")
	}
	if len(usage.logs) != 1 {
		t.Fatalf("usage logs = %#v, want one log", usage.logs)
	}
	if usage.logs[0].UsageUnits != 2 || usage.logs[0].TaskID != child.ID || usage.logs[0].RequestHash != client.request.Provenance.RequestHash {
		t.Fatalf("usage log = %#v", usage.logs[0])
	}
	if usage.logs[0].Metadata["quota_idempotency_key"] != "quota_reservation_1:child_1" {
		t.Fatalf("usage log quota idempotency key = %#v", usage.logs[0].Metadata)
	}
	if store.successInput.QuotaCommittedUnits != 2 || store.successInput.QuotaRefundedUnits != 2 {
		t.Fatalf("success quota = committed %d refunded %d", store.successInput.QuotaCommittedUnits, store.successInput.QuotaRefundedUnits)
	}
	if store.successInput.Metadata["fanout_stage"] != "provider_execution_succeeded" || store.successInput.Metadata["request_hash"] == "" {
		t.Fatalf("success metadata = %#v", store.successInput.Metadata)
	}
	for key, value := range store.successInput.Metadata {
		if strings.Contains(strings.ToLower(key), "payload") || strings.Contains(value, batch.PromptContext.Text) {
			t.Fatalf("completion metadata leaks provider payload or prompt: %#v", store.successInput.Metadata)
		}
	}
}

func TestBatchChildExecutorSchedulesRetryForRetryableProviderError(t *testing.T) {
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusRunning
	batch.Children = []GenerationChildTask{child}
	store := &executorFakeStore{batch: batch}
	client := &executorFakeProvider{err: errors.New("upstream timeout " + providerSecretShapeFixture)}
	executor := BatchChildExecutor{Providers: ProviderClientMap{child.ProviderID: client}}

	failed, err := executor.ExecuteClaimedChild(context.Background(), store, child)
	if err != nil {
		t.Fatalf("ExecuteClaimedChild() error = %v", err)
	}
	if failed.Status != ChildStatusQueued || failed.FailureCode != "provider_invoke_failed" || failed.RetryCount != 1 {
		t.Fatalf("retried child = %#v", failed)
	}
	if store.failureCalled {
		t.Fatal("retryable provider error should not terminally fail before retry budget is exhausted")
	}
	if !store.retryCalled {
		t.Fatal("retryable provider error did not schedule retry")
	}
	if store.retryInput.QuotaRefundedUnits != 0 {
		t.Fatalf("retry should not refund reserved quota, got %d", store.retryInput.QuotaRefundedUnits)
	}
	if strings.Contains(store.retryInput.FailureMessage, "sk-testsecret") {
		t.Fatalf("failure message leaked secret-looking value: %q", store.retryInput.FailureMessage)
	}
	if store.retryInput.Metadata["retryable"] != "true" || failed.Metadata["retry_state"] != "scheduled" {
		t.Fatalf("retry metadata = %#v", store.retryInput.Metadata)
	}
}

func TestBatchChildExecutorDoesNotRetryProviderQuotaUnavailable(t *testing.T) {
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusRunning
	batch.Children = []GenerationChildTask{child}
	store := &executorFakeStore{batch: batch}
	client := &executorFakeProvider{err: &provider.Error{
		ProviderID:   child.ProviderID,
		Code:         "provider_quota_unavailable",
		HTTPStatus:   429,
		ProviderCode: "1113",
		Message:      "Insufficient balance or no resource package. Please recharge.",
		Retryable:    false,
	}}
	executor := BatchChildExecutor{Providers: ProviderClientMap{child.ProviderID: client}}

	failed, err := executor.ExecuteClaimedChild(context.Background(), store, child)
	if err != nil {
		t.Fatalf("ExecuteClaimedChild() error = %v", err)
	}
	if failed.Status != ChildStatusFailed || failed.FailureCode != "provider_quota_unavailable" {
		t.Fatalf("failed child = %#v, want terminal provider quota failure", failed)
	}
	if store.retryCalled {
		t.Fatal("provider quota unavailable must not schedule retry")
	}
	if !store.failureCalled || store.failureInput.QuotaRefundedUnits != child.QuotaEstimateUnits {
		t.Fatalf("failure/refund = called %v units %d, want full refund", store.failureCalled, store.failureInput.QuotaRefundedUnits)
	}
	if store.failureInput.Metadata["retryable"] != "false" || store.failureInput.Metadata["provider_code"] != "1113" || store.failureInput.Metadata["provider_http_status"] != "429" {
		t.Fatalf("failure metadata = %#v, want provider code/http status and non-retryable", store.failureInput.Metadata)
	}
	if strings.Contains(strings.ToLower(store.failureInput.FailureMessage), "authorization") {
		t.Fatalf("failure message leaked secret-bearing detail: %q", store.failureInput.FailureMessage)
	}
}

func TestBatchChildExecutorBlocksBeforeProviderInvokeWhenSafetyGateDenies(t *testing.T) {
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusRunning
	batch.Children = []GenerationChildTask{child}
	store := &executorFakeStore{batch: batch}
	client := &executorFakeProvider{response: provider.Response{Status: "succeeded"}}
	executor := BatchChildExecutor{
		Providers:  ProviderClientMap{child.ProviderID: client},
		SafetyGate: executorFakeSafetyGate{decision: BatchSafetyDecision{ReviewReason: "safety_review_required", PolicyID: "policy_stage1_batch", RuleID: "rule_prompt_hold"}},
	}

	blocked, err := executor.ExecuteClaimedChild(context.Background(), store, child)
	if err != nil {
		t.Fatalf("ExecuteClaimedChild() error = %v", err)
	}
	if blocked.Status != ChildStatusBlocked || blocked.ReviewReason != "safety_review_required" {
		t.Fatalf("blocked child = %#v", blocked)
	}
	if client.request.ID != "" {
		t.Fatalf("provider was invoked despite safety block: %#v", client.request)
	}
	if !store.blockCalled || store.blockInput.QuotaRefundedUnits != child.QuotaEstimateUnits {
		t.Fatalf("block/refund = called %v units %d", store.blockCalled, store.blockInput.QuotaRefundedUnits)
	}
	if store.successCalled || store.failureCalled || store.retryCalled {
		t.Fatalf("safety block should not call success/failure/retry: success=%v failure=%v retry=%v", store.successCalled, store.failureCalled, store.retryCalled)
	}
	if store.blockInput.Metadata["fanout_stage"] != "safety_gate_blocked" || store.blockInput.Metadata["provider_invoked"] != "false" || store.blockInput.Metadata["safety_policy_id"] != "policy_stage1_batch" {
		t.Fatalf("safety block metadata = %#v", store.blockInput.Metadata)
	}
	for key, value := range store.blockInput.Metadata {
		if strings.Contains(strings.ToLower(key), "payload") || strings.Contains(value, batch.PromptContext.Text) {
			t.Fatalf("safety block metadata leaks prompt or payload: %#v", store.blockInput.Metadata)
		}
	}
}

func TestBatchChildExecutorDeadLettersAfterRetryBudgetAndRefunds(t *testing.T) {
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	child.RetryCount = 2
	child.MaxRetries = 2
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusRunning
	batch.Children = []GenerationChildTask{child}
	store := &executorFakeStore{batch: batch}
	client := &executorFakeProvider{err: errors.New("upstream timeout")}
	executor := BatchChildExecutor{Providers: ProviderClientMap{child.ProviderID: client}}

	failed, err := executor.ExecuteClaimedChild(context.Background(), store, child)
	if err != nil {
		t.Fatalf("ExecuteClaimedChild() error = %v", err)
	}
	if failed.Status != ChildStatusFailed || failed.FailureCode != "provider_invoke_failed" {
		t.Fatalf("failed child = %#v", failed)
	}
	if store.retryCalled {
		t.Fatal("executor scheduled retry after retry budget was exhausted")
	}
	if store.failureInput.QuotaRefundedUnits != child.QuotaEstimateUnits {
		t.Fatalf("refund units = %d, want %d", store.failureInput.QuotaRefundedUnits, child.QuotaEstimateUnits)
	}
	if store.failureInput.Metadata["dead_letter_state"] != "dead_lettered" || store.failureInput.Metadata["retryable"] != "true" {
		t.Fatalf("dead letter metadata = %#v", store.failureInput.Metadata)
	}
}

func TestBatchChildExecutorRequiresResultSinkBeforeSuccess(t *testing.T) {
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	batch := validBatchGenerationRequest()
	batch.Status = BatchStatusRunning
	batch.Children = []GenerationChildTask{child}
	store := &executorFakeStore{batch: batch}
	client := &executorFakeProvider{response: provider.Response{
		ID:         "provider_response_1",
		RequestID:  "provider_request:child_1",
		ProviderID: child.ProviderID,
		ModelID:    child.ModelID,
		Status:     "succeeded",
		Usage:      provider.Usage{CostUnits: 1},
		TraceID:    child.TraceID,
		Provenance: provider.Provenance{EndpointVersion: "sandbox-v1"},
	}}
	executor := BatchChildExecutor{Providers: ProviderClientMap{child.ProviderID: client}}

	failed, err := executor.ExecuteClaimedChild(context.Background(), store, child)
	if err != nil {
		t.Fatalf("ExecuteClaimedChild() error = %v", err)
	}
	if failed.Status != ChildStatusFailed || failed.FailureCode != "result_sink_unavailable" {
		t.Fatalf("failed child = %#v", failed)
	}
	if store.retryCalled {
		t.Fatal("result sink failure should not schedule provider retry after provider success")
	}
	if store.failureInput.Metadata["dead_letter_state"] != "dead_lettered" || store.failureInput.Metadata["retryable"] != "false" {
		t.Fatalf("result sink failure metadata = %#v", store.failureInput.Metadata)
	}
	if store.successCalled {
		t.Fatal("executor marked success without a result sink")
	}
}

func TestBuildProviderRequestForChildRejectsScopeDrift(t *testing.T) {
	batch := validBatchGenerationRequest()
	child := validGenerationChildTask("child_1", ChildStatusRunning)
	child.TenantID = "tenant_2"

	if _, err := BuildProviderRequestForChild(batch, child); !errors.Is(err, ErrBatchValidation) {
		t.Fatalf("BuildProviderRequestForChild() error = %v, want ErrBatchValidation", err)
	}
}

type executorFakeStore struct {
	batch         BatchGenerationRequest
	successInput  CompleteChildSuccessInput
	failureInput  CompleteChildFailureInput
	retryInput    CompleteChildFailureInput
	blockInput    BlockChildForReviewInput
	successCalled bool
	failureCalled bool
	retryCalled   bool
	blockCalled   bool
}

func (s *executorFakeStore) GetBatch(_ context.Context, tenantID, batchID string) (BatchGenerationRequest, error) {
	if tenantID != s.batch.TenantID || batchID != s.batch.ID {
		return BatchGenerationRequest{}, ErrNotFound
	}
	return s.batch, nil
}

func (s *executorFakeStore) CompleteChildSuccess(_ context.Context, input CompleteChildSuccessInput) (GenerationChildTask, error) {
	s.successCalled = true
	s.successInput = input
	child := s.batch.Children[0]
	child.Status = ChildStatusSucceeded
	child.AssetID = input.AssetID
	child.CanvasObjectID = input.CanvasObjectID
	child.QuotaCommittedUnits += input.QuotaCommittedUnits
	child.QuotaRefundedUnits += input.QuotaRefundedUnits
	child.Metadata = mergeStringMaps(child.Metadata, input.Metadata)
	return child, nil
}

func (s *executorFakeStore) CompleteChildFailure(_ context.Context, input CompleteChildFailureInput) (GenerationChildTask, error) {
	s.failureCalled = true
	s.failureInput = input
	child := s.batch.Children[0]
	child.Status = ChildStatusFailed
	child.FailureCode = input.FailureCode
	child.FailureMessage = input.FailureMessage
	child.QuotaRefundedUnits += input.QuotaRefundedUnits
	child.Metadata = mergeStringMaps(child.Metadata, input.Metadata)
	return child, nil
}

func (s *executorFakeStore) BlockChildForReview(_ context.Context, input BlockChildForReviewInput) (GenerationChildTask, error) {
	s.blockCalled = true
	s.blockInput = input
	child := s.batch.Children[0]
	child.Status = ChildStatusBlocked
	child.ReviewReason = input.ReviewReason
	child.QuotaRefundedUnits += input.QuotaRefundedUnits
	child.Metadata = mergeStringMaps(child.Metadata, input.Metadata)
	return child, nil
}

func (s *executorFakeStore) MarkChildRetryScheduled(_ context.Context, input CompleteChildFailureInput) (GenerationChildTask, error) {
	s.retryCalled = true
	s.retryInput = input
	child := s.batch.Children[0]
	child.Status = ChildStatusQueued
	child.RetryCount++
	child.FailureCode = input.FailureCode
	child.FailureMessage = input.FailureMessage
	child.Metadata = mergeStringMaps(child.Metadata, mergeStringMaps(input.Metadata, map[string]string{
		"retry_state":       "scheduled",
		"dead_letter_state": "not_dead_lettered",
	}))
	return child, nil
}

type executorFakeSafetyGate struct {
	decision BatchSafetyDecision
	err      error
}

func (g executorFakeSafetyGate) EvaluateBatchChild(context.Context, BatchSafetyGateInput) (BatchSafetyDecision, error) {
	return g.decision, g.err
}

type executorFakeProvider struct {
	request  provider.Request
	response provider.Response
	err      error
}

func (p *executorFakeProvider) Invoke(_ context.Context, req provider.Request) (provider.Response, error) {
	p.request = req
	if p.err != nil {
		return provider.Response{}, p.err
	}
	if p.response.RequestID == "" {
		p.response.RequestID = req.ID
	}
	if p.response.TraceID == "" {
		p.response.TraceID = req.TraceID
	}
	return p.response, nil
}

func (p *executorFakeProvider) Status(context.Context) provider.Status {
	return provider.Status{ProviderID: "fake", Available: true}
}

func (p *executorFakeProvider) Capabilities() []provider.Capability {
	return nil
}

type executorFakeResultSink struct {
	input  BatchChildResultInput
	result BatchChildResult
	err    error
}

func (s *executorFakeResultSink) PersistBatchChildResult(_ context.Context, input BatchChildResultInput) (BatchChildResult, error) {
	s.input = input
	return s.result, s.err
}

type executorFakeUsageRecorder struct {
	logs []billing.ProviderUsageLog
	err  error
}

func (r *executorFakeUsageRecorder) RecordProviderUsage(_ context.Context, usage billing.ProviderUsageLog) error {
	if r.err != nil {
		return r.err
	}
	r.logs = append(r.logs, usage)
	return nil
}
