package task

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/billing"
	"github.com/alphane-ai/zenart/backend/internal/provider"
	"github.com/alphane-ai/zenart/backend/internal/security"
)

type BatchChildExecutionStore interface {
	GetBatch(ctx context.Context, tenantID, batchID string) (BatchGenerationRequest, error)
	CompleteChildSuccess(ctx context.Context, input CompleteChildSuccessInput) (GenerationChildTask, error)
	CompleteChildFailure(ctx context.Context, input CompleteChildFailureInput) (GenerationChildTask, error)
	MarkChildRetryScheduled(ctx context.Context, input CompleteChildFailureInput) (GenerationChildTask, error)
	BlockChildForReview(ctx context.Context, input BlockChildForReviewInput) (GenerationChildTask, error)
}

type ProviderClientResolver interface {
	ResolveProviderClient(providerID string) (provider.Client, bool)
}

type ProviderClientMap map[string]provider.Client

func (m ProviderClientMap) ResolveProviderClient(providerID string) (provider.Client, bool) {
	client, ok := m[strings.TrimSpace(providerID)]
	return client, ok && client != nil
}

type ProviderUsageRecorder interface {
	RecordProviderUsage(ctx context.Context, usage billing.ProviderUsageLog) error
}

type BatchChildResultSink interface {
	PersistBatchChildResult(ctx context.Context, input BatchChildResultInput) (BatchChildResult, error)
}

type BatchChildResultInput struct {
	Batch            BatchGenerationRequest
	Child            GenerationChildTask
	ProviderRequest  provider.Request
	ProviderResponse provider.Response
}

type BatchChildResult struct {
	AssetID        string
	CanvasObjectID string
	Metadata       map[string]string
}

type BatchSafetyGate interface {
	EvaluateBatchChild(ctx context.Context, input BatchSafetyGateInput) (BatchSafetyDecision, error)
}

type BatchSafetyGateInput struct {
	Batch BatchGenerationRequest
	Child GenerationChildTask
}

type BatchSafetyDecision struct {
	Allowed      bool
	ReviewReason string
	PolicyID     string
	RuleID       string
	Metadata     map[string]string
}

type BatchChildExecutor struct {
	Providers     ProviderClientResolver
	ResultSink    BatchChildResultSink
	UsageRecorder ProviderUsageRecorder
	SafetyGate    BatchSafetyGate
	Now           func() time.Time
}

func (e BatchChildExecutor) ExecuteClaimedChild(ctx context.Context, store BatchChildExecutionStore, child GenerationChildTask) (GenerationChildTask, error) {
	if store == nil {
		return GenerationChildTask{}, errors.New("batch child execution store is required")
	}
	child.TenantID = strings.TrimSpace(child.TenantID)
	child.BatchID = strings.TrimSpace(child.BatchID)
	child.ID = strings.TrimSpace(child.ID)
	if child.ID == "" || child.TenantID == "" || child.BatchID == "" {
		return GenerationChildTask{}, fmt.Errorf("%w: claimed child id, tenant_id, and batch_id are required", ErrBatchValidation)
	}
	if child.Status != ChildStatusRunning {
		return GenerationChildTask{}, fmt.Errorf("%w: only running claimed children can be executed", ErrBatchConflict)
	}
	batch, err := store.GetBatch(ctx, child.TenantID, child.BatchID)
	if err != nil {
		return GenerationChildTask{}, err
	}
	if e.SafetyGate != nil {
		decision, err := e.SafetyGate.EvaluateBatchChild(ctx, BatchSafetyGateInput{Batch: batch, Child: child})
		if err != nil {
			return e.failClaimedChild(ctx, store, child, "safety_gate_error", sanitizeExecutionMessage(err.Error()), map[string]string{
				"fanout_stage": "safety_gate_failed",
				"failure_kind": "safety_gate_error",
			})
		}
		if !decision.Allowed {
			return e.blockClaimedChild(ctx, store, child, decision)
		}
	}
	client, ok := e.providerClient(child.ProviderID)
	if !ok {
		return e.failClaimedChild(ctx, store, child, "provider_client_unavailable", "provider client unavailable", map[string]string{
			"fanout_stage": "provider_execution_failed",
			"failure_kind": "provider_client_unavailable",
		})
	}
	req, err := BuildProviderRequestForChild(batch, child)
	if err != nil {
		return e.failClaimedChild(ctx, store, child, "provider_request_invalid", err.Error(), map[string]string{
			"fanout_stage": "provider_execution_failed",
			"failure_kind": "provider_request_invalid",
		})
	}
	resp, err := client.Invoke(ctx, req)
	if err != nil {
		code, message, metadata := providerInvokeFailure(err, req.Provenance.RequestHash)
		return e.failClaimedChild(ctx, store, child, code, message, metadata)
	}
	if !providerResponseSucceeded(resp) {
		return e.failClaimedChild(ctx, store, child, "provider_response_failed", sanitizeExecutionMessage(resp.Status), map[string]string{
			"fanout_stage":             "provider_execution_failed",
			"failure_kind":             "provider_response_failed",
			"provider_response_id":     resp.ID,
			"provider_response_status": resp.Status,
			"request_hash":             req.Provenance.RequestHash,
		})
	}
	if e.UsageRecorder != nil {
		if err := e.UsageRecorder.RecordProviderUsage(ctx, providerUsageLog(batch, child, req, resp, e.now())); err != nil {
			return e.failClaimedChild(ctx, store, child, "provider_usage_record_failed", sanitizeExecutionMessage(err.Error()), map[string]string{
				"fanout_stage":             "provider_execution_failed",
				"failure_kind":             "provider_usage_record_failed",
				"provider_response_id":     resp.ID,
				"provider_response_status": resp.Status,
				"request_hash":             req.Provenance.RequestHash,
			})
		}
	}
	if e.ResultSink == nil {
		return e.failClaimedChild(ctx, store, child, "result_sink_unavailable", "result sink unavailable", map[string]string{
			"fanout_stage":             "provider_execution_failed",
			"failure_kind":             "result_sink_unavailable",
			"provider_response_id":     resp.ID,
			"provider_response_status": resp.Status,
			"request_hash":             req.Provenance.RequestHash,
		})
	}
	result, err := e.ResultSink.PersistBatchChildResult(ctx, BatchChildResultInput{
		Batch:            batch,
		Child:            child,
		ProviderRequest:  req,
		ProviderResponse: resp,
	})
	if err != nil {
		return e.failClaimedChild(ctx, store, child, "result_persistence_failed", sanitizeExecutionMessage(err.Error()), map[string]string{
			"fanout_stage":             "provider_execution_failed",
			"failure_kind":             "result_persistence_failed",
			"provider_response_id":     resp.ID,
			"provider_response_status": resp.Status,
			"request_hash":             req.Provenance.RequestHash,
		})
	}
	result.AssetID = strings.TrimSpace(result.AssetID)
	result.CanvasObjectID = strings.TrimSpace(result.CanvasObjectID)
	if result.AssetID == "" || result.CanvasObjectID == "" {
		return e.failClaimedChild(ctx, store, child, "result_persistence_missing_ids", "result persistence did not return asset and canvas object ids", map[string]string{
			"fanout_stage":             "provider_execution_failed",
			"failure_kind":             "result_persistence_missing_ids",
			"provider_response_id":     resp.ID,
			"provider_response_status": resp.Status,
			"request_hash":             req.Provenance.RequestHash,
		})
	}
	committed, refunded := completionQuota(child, resp.Usage)
	metadata := mergeStringMaps(result.Metadata, map[string]string{
		"fanout_stage":             "provider_execution_succeeded",
		"provider_response_id":     resp.ID,
		"provider_response_status": resp.Status,
		"request_hash":             req.Provenance.RequestHash,
		"usage_units":              fmt.Sprintf("%d", resp.Usage.CostUnits),
		"usage_commit_units":       fmt.Sprintf("%d", committed),
		"usage_refund_units":       fmt.Sprintf("%d", refunded),
	})
	return store.CompleteChildSuccess(ctx, CompleteChildSuccessInput{
		TenantID:            child.TenantID,
		ChildID:             child.ID,
		AssetID:             result.AssetID,
		CanvasObjectID:      result.CanvasObjectID,
		QuotaCommittedUnits: committed,
		QuotaRefundedUnits:  refunded,
		Metadata:            metadata,
	})
}

func providerInvokeFailure(err error, requestHash string) (string, string, map[string]string) {
	metadata := map[string]string{
		"fanout_stage": "provider_execution_failed",
		"failure_kind": "provider_invoke_failed",
		"request_hash": requestHash,
	}
	if providerErr, ok := provider.ErrorDetails(err); ok {
		code := strings.TrimSpace(providerErr.Code)
		if code == "" {
			code = "provider_invoke_failed"
		}
		metadata["provider_error_code"] = code
		metadata["provider_retryable"] = retryableBool(providerErr.Retryable)
		if providerErr.HTTPStatus > 0 {
			metadata["provider_http_status"] = fmt.Sprintf("%d", providerErr.HTTPStatus)
		}
		if providerCode := strings.TrimSpace(providerErr.ProviderCode); providerCode != "" {
			metadata["provider_code"] = sanitizeExecutionMessage(providerCode)
		}
		if retryAfter := strings.TrimSpace(providerErr.RetryAfter); retryAfter != "" {
			metadata["provider_retry_after"] = sanitizeExecutionMessage(retryAfter)
		}
		return code, sanitizeExecutionMessage(providerErr.Error()), metadata
	}
	return "provider_invoke_failed", sanitizeExecutionMessage(err.Error()), metadata
}

func BuildProviderRequestForChild(batch BatchGenerationRequest, child GenerationChildTask) (provider.Request, error) {
	if batch.ID == "" || child.ID == "" {
		return provider.Request{}, fmt.Errorf("%w: batch and child ids are required", ErrBatchValidation)
	}
	if batch.TenantID != child.TenantID || batch.ID != child.BatchID {
		return provider.Request{}, fmt.Errorf("%w: child scope must match batch scope", ErrBatchValidation)
	}
	payload := map[string]any{
		"prompt":               batch.PromptContext.Text,
		"selected_object_ids":  batch.PromptContext.SelectedObjectIDs,
		"reference_asset_ids":  batch.PromptContext.ReferenceAssetIDs,
		"brand_kit_id":         batch.PromptContext.BrandKitID,
		"tool_type":            child.ToolType,
		"seed":                 child.Seed,
		"batch_id":             batch.ID,
		"child_id":             child.ID,
		"visible_trace_ref":    child.VisibleTraceRef,
		"requested_count":      batch.RequestedCount,
		"allowed_models":       batch.AllowedModels,
		"provider_model_id":    child.ModelID,
		"provider_endpoint":    providerEndpointForTool(child.ToolType),
		"provider_schema_name": "zenari.batch_child.v1",
	}
	if index := strings.TrimSpace(child.Metadata["fanout_index"]); index != "" {
		payload["fanout_index"] = index
	}
	requestHash, err := stableHash(payload)
	if err != nil {
		return provider.Request{}, err
	}
	req := provider.Request{
		ID:             "provider_request:" + child.ID,
		TenantID:       child.TenantID,
		TaskID:         child.ID,
		ProviderID:     child.ProviderID,
		ModelID:        child.ModelID,
		Endpoint:       providerEndpointForTool(child.ToolType),
		SchemaVersion:  1,
		IdempotencyKey: "batch_child:" + child.ID + ":retry:" + fmt.Sprintf("%d", child.RetryCount),
		Payload:        payload,
		TraceID:        child.TraceID,
		Provenance: provider.Provenance{
			ProviderID:      child.ProviderID,
			ModelID:         child.ModelID,
			EndpointVersion: "batch_child_v1",
			RequestHash:     requestHash,
			Parameters: map[string]any{
				"batch_id":  batch.ID,
				"tool_type": child.ToolType,
			},
			Seed: child.Seed,
		},
	}
	if err := provider.ValidateRequest(req); err != nil {
		return provider.Request{}, err
	}
	return req, nil
}

func (e BatchChildExecutor) providerClient(providerID string) (provider.Client, bool) {
	if e.Providers == nil {
		return nil, false
	}
	return e.Providers.ResolveProviderClient(providerID)
}

func (e BatchChildExecutor) failClaimedChild(ctx context.Context, store BatchChildExecutionStore, child GenerationChildTask, code, message string, metadata map[string]string) (GenerationChildTask, error) {
	retryable, retryReason := classifyBatchChildFailure(code, metadata)
	metadata = mergeStringMaps(metadata, map[string]string{
		"retryable":      retryableBool(retryable),
		"retry_reason":   retryReason,
		"retry_attempt":  fmt.Sprintf("%d", child.RetryCount),
		"retry_max":      fmt.Sprintf("%d", child.MaxRetries),
		"failure_code":   code,
		"failure_source": "batch_child_executor",
	})
	if retryable && child.RetryCount < child.MaxRetries && child.QuotaCommittedUnits == 0 && child.QuotaRefundedUnits == 0 {
		retried, err := store.MarkChildRetryScheduled(ctx, CompleteChildFailureInput{
			TenantID:       child.TenantID,
			ChildID:        child.ID,
			FailureCode:    code,
			FailureMessage: sanitizeExecutionMessage(message),
			Retryable:      true,
			Metadata:       metadata,
		})
		if err == nil {
			return retried, nil
		}
		metadata = mergeStringMaps(metadata, map[string]string{
			"retry_schedule_failed": sanitizeExecutionMessage(err.Error()),
			"retryable":             "false",
			"retry_reason":          "retry_schedule_failed",
		})
	}
	metadata = mergeStringMaps(metadata, map[string]string{
		"dead_letter_state":  "dead_lettered",
		"dead_letter_reason": retryReason,
	})
	failed, err := store.CompleteChildFailure(ctx, CompleteChildFailureInput{
		TenantID:           child.TenantID,
		ChildID:            child.ID,
		FailureCode:        code,
		FailureMessage:     sanitizeExecutionMessage(message),
		QuotaRefundedUnits: child.QuotaEstimateUnits - child.QuotaCommittedUnits - child.QuotaRefundedUnits,
		Retryable:          retryable,
		Metadata:           metadata,
	})
	if err != nil {
		return GenerationChildTask{}, err
	}
	return failed, nil
}

func (e BatchChildExecutor) blockClaimedChild(ctx context.Context, store BatchChildExecutionStore, child GenerationChildTask, decision BatchSafetyDecision) (GenerationChildTask, error) {
	reason := strings.TrimSpace(decision.ReviewReason)
	if reason == "" {
		reason = "safety_review_required"
	}
	metadata := mergeStringMaps(decision.Metadata, map[string]string{
		"fanout_stage":         "safety_gate_blocked",
		"blocked_by":           "batch_safety_gate",
		"review_reason":        reason,
		"retryable":            "false",
		"dead_letter_state":    "not_dead_lettered",
		"quota_refund_reason":  "safety_gate_blocked",
		"provider_invoked":     "false",
		"safety_gate_decision": "blocked",
	})
	if policyID := strings.TrimSpace(decision.PolicyID); policyID != "" {
		metadata["safety_policy_id"] = sanitizeExecutionMessage(policyID)
	}
	if ruleID := strings.TrimSpace(decision.RuleID); ruleID != "" {
		metadata["safety_rule_id"] = sanitizeExecutionMessage(ruleID)
	}
	return store.BlockChildForReview(ctx, BlockChildForReviewInput{
		TenantID:           child.TenantID,
		ChildID:            child.ID,
		ReviewReason:       sanitizeExecutionMessage(reason),
		QuotaRefundedUnits: child.QuotaEstimateUnits - child.QuotaCommittedUnits - child.QuotaRefundedUnits,
		Metadata:           metadata,
	})
}

func (e BatchChildExecutor) now() time.Time {
	if e.Now != nil {
		return e.Now().UTC()
	}
	return time.Now().UTC()
}

func providerUsageLog(batch BatchGenerationRequest, child GenerationChildTask, req provider.Request, resp provider.Response, now time.Time) billing.ProviderUsageLog {
	return billing.ProviderUsageLog{
		ID:              "provider_usage_" + stableID(child.ID+":"+resp.ID+":"+req.Provenance.RequestHash),
		TenantID:        child.TenantID,
		UserID:          batch.UserID,
		ProjectID:       batch.ProjectID,
		TaskID:          child.ID,
		TaskRefType:     "generation_child_task",
		ProviderID:      child.ProviderID,
		ModelID:         child.ModelID,
		EndpointVersion: resp.Provenance.EndpointVersion,
		RequestHash:     req.Provenance.RequestHash,
		UsageUnits:      maxInt64(resp.Usage.CostUnits, 0),
		CostCents:       0,
		Status:          "recorded",
		Metadata: map[string]any{
			"batch_id":                 batch.ID,
			"quota_idempotency_key":    BatchChildQuotaIdempotencyKey(batch, child),
			"provider_response_id":     resp.ID,
			"provider_response_status": resp.Status,
			"input_tokens":             resp.Usage.InputTokens,
			"output_tokens":            resp.Usage.OutputTokens,
			"usage_cost_units":         resp.Usage.CostUnits,
		},
		CreatedAt: now,
	}
}

func completionQuota(child GenerationChildTask, usage provider.Usage) (committed int64, refunded int64) {
	remaining := child.QuotaEstimateUnits - child.QuotaCommittedUnits - child.QuotaRefundedUnits
	if remaining <= 0 {
		return 0, 0
	}
	committed = usage.CostUnits
	if committed <= 0 || committed > remaining {
		committed = remaining
	}
	refunded = remaining - committed
	return committed, refunded
}

func providerResponseSucceeded(resp provider.Response) bool {
	status := strings.ToLower(strings.TrimSpace(resp.Status))
	return status == "" || status == "succeeded" || status == "success" || status == "completed"
}

func providerEndpointForTool(toolType string) string {
	toolType = strings.TrimSpace(toolType)
	if toolType == "" {
		return "image"
	}
	if before, _, ok := strings.Cut(toolType, "."); ok && strings.TrimSpace(before) != "" {
		return strings.TrimSpace(before)
	}
	return toolType
}

func stableHash(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func stableID(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:16])
}

func sanitizeExecutionMessage(message string) string {
	message = strings.TrimSpace(message)
	if message == "" {
		return "provider execution failed"
	}
	redacted := security.RedactString(message)
	if redacted != message {
		return "provider execution failed with redacted details"
	}
	if len(message) > 240 {
		return message[:240]
	}
	return message
}

func mergeStringMaps(left, right map[string]string) map[string]string {
	out := normalizeStringMap(left)
	for key, value := range normalizeStringMap(right) {
		out[key] = value
	}
	return out
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
