package task

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

type BatchSchedulePolicy struct {
	TenantID                  string
	WorkerID                  string
	Limit                     int
	ClaimTimeout              time.Duration
	MaxTenantConcurrency      int
	ProviderMaxConcurrency    map[string]int
	ProviderModelConcurrency  map[string]int
	AllowedProviderModelTools []ProviderModelTool
}

type ProviderModelTool struct {
	ProviderID string
	ModelID    string
	ToolType   string
}

type BatchScheduleClaim struct {
	Children              []GenerationChildTask `json:"children"`
	TenantRunning         int                   `json:"tenant_running"`
	ProviderRunning       map[string]int        `json:"provider_running"`
	ProviderModelRunning  map[string]int        `json:"provider_model_running"`
	ProviderModelCapacity map[string]int        `json:"provider_model_capacity"`
}

func ValidateBatchSchedulePolicy(policy BatchSchedulePolicy) error {
	if strings.TrimSpace(policy.TenantID) == "" {
		return errors.New("tenant_id is required")
	}
	if strings.TrimSpace(policy.WorkerID) == "" {
		return errors.New("worker_id is required")
	}
	if policy.Limit <= 0 {
		return errors.New("claim limit must be positive")
	}
	if policy.Limit > 100 {
		return errors.New("claim limit must be <= 100")
	}
	if policy.ClaimTimeout <= 0 {
		return errors.New("claim timeout must be > 0")
	}
	if policy.MaxTenantConcurrency < 0 {
		return errors.New("tenant concurrency must be non-negative")
	}
	for providerID, limit := range policy.ProviderMaxConcurrency {
		if strings.TrimSpace(providerID) == "" {
			return errors.New("provider concurrency provider_id is required")
		}
		if limit < 0 {
			return errors.New("provider concurrency must be non-negative")
		}
	}
	for key, limit := range policy.ProviderModelConcurrency {
		if strings.TrimSpace(key) == "" {
			return errors.New("provider model concurrency key is required")
		}
		if limit < 0 {
			return errors.New("provider model concurrency must be non-negative")
		}
	}
	for _, allowed := range policy.AllowedProviderModelTools {
		if strings.TrimSpace(allowed.ProviderID) == "" || strings.TrimSpace(allowed.ModelID) == "" || strings.TrimSpace(allowed.ToolType) == "" {
			return errors.New("allowed provider/model/tool entries require provider_id, model_id, and tool_type")
		}
	}
	return nil
}

func (r BatchRepository) ClaimRunnableChildren(ctx context.Context, policy BatchSchedulePolicy) (BatchScheduleClaim, error) {
	if r.db == nil {
		return BatchScheduleClaim{}, errors.New("batch generation database is required")
	}
	policy = normalizeBatchSchedulePolicy(policy)
	if err := ValidateBatchSchedulePolicy(policy); err != nil {
		return BatchScheduleClaim{}, err
	}
	if err := r.releaseExpiredClaimLeases(ctx, policy.TenantID); err != nil {
		return BatchScheduleClaim{}, err
	}
	tenantRunning, err := r.countRunningChildren(ctx, policy.TenantID)
	if err != nil {
		return BatchScheduleClaim{}, err
	}
	tenantAvailable := policy.Limit
	if policy.MaxTenantConcurrency > 0 {
		tenantAvailable = minInt(tenantAvailable, policy.MaxTenantConcurrency-tenantRunning)
	}
	if tenantAvailable <= 0 {
		return BatchScheduleClaim{
			TenantRunning:         tenantRunning,
			ProviderRunning:       map[string]int{},
			ProviderModelRunning:  map[string]int{},
			ProviderModelCapacity: map[string]int{},
		}, nil
	}
	providerRunning := make(map[string]int)
	providerModelRunning := make(map[string]int)
	providerModelCapacity := make(map[string]int)
	for providerID := range policy.ProviderMaxConcurrency {
		count, err := r.countRunningChildrenForProvider(ctx, policy.TenantID, providerID)
		if err != nil {
			return BatchScheduleClaim{}, err
		}
		providerRunning[providerID] = count
	}
	for key := range policy.ProviderModelConcurrency {
		parts := strings.SplitN(key, ":", 2)
		if len(parts) != 2 {
			return BatchScheduleClaim{}, fmt.Errorf("provider model concurrency key %q must be provider_id:model_id", key)
		}
		count, err := r.countRunningChildrenForProviderModel(ctx, policy.TenantID, parts[0], parts[1])
		if err != nil {
			return BatchScheduleClaim{}, err
		}
		providerModelRunning[key] = count
	}
	rows, err := r.db.Query(ctx, `
SELECT id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at
FROM generation_child_tasks
WHERE tenant_id = $1 AND status = 'queued'
ORDER BY created_at, id
LIMIT $2`,
		policy.TenantID,
		policy.Limit,
	)
	if err != nil {
		return BatchScheduleClaim{}, err
	}
	defer rows.Close()

	allowed := allowedProviderModelToolSet(policy.AllowedProviderModelTools)
	claimed := make([]GenerationChildTask, 0, tenantAvailable)
	for rows.Next() {
		child, err := scanChild(rows)
		if err != nil {
			return BatchScheduleClaim{}, err
		}
		if len(allowed) > 0 && !allowed[providerModelToolKey(child.ProviderID, child.ModelID, child.ToolType)] {
			continue
		}
		if len(claimed) >= tenantAvailable {
			break
		}
		providerLimit := policy.ProviderMaxConcurrency[child.ProviderID]
		if providerLimit > 0 && providerRunning[child.ProviderID] >= providerLimit {
			continue
		}
		modelKey := providerModelKey(child.ProviderID, child.ModelID)
		modelLimit := policy.ProviderModelConcurrency[modelKey]
		if modelLimit > 0 && providerModelRunning[modelKey] >= modelLimit {
			continue
		}
		claimedChild, err := r.claimChild(ctx, policy.TenantID, child.ID, policy.WorkerID, policy.ClaimTimeout)
		if err != nil {
			return BatchScheduleClaim{}, err
		}
		claimed = append(claimed, claimedChild)
		providerRunning[child.ProviderID]++
		providerModelRunning[modelKey]++
		if modelLimit > 0 {
			providerModelCapacity[modelKey] = modelLimit - providerModelRunning[modelKey]
		}
	}
	if err := rows.Err(); err != nil {
		return BatchScheduleClaim{}, err
	}
	return BatchScheduleClaim{
		Children:              claimed,
		TenantRunning:         tenantRunning,
		ProviderRunning:       providerRunning,
		ProviderModelRunning:  providerModelRunning,
		ProviderModelCapacity: providerModelCapacity,
	}, nil
}

func (r BatchRepository) releaseExpiredClaimLeases(ctx context.Context, tenantID string) error {
	_, err := r.db.Exec(ctx, `
UPDATE generation_child_tasks
SET status = 'queued',
	metadata = metadata || jsonb_build_object(
		'fanout_stage', 'claim_timeout_requeued',
		'claim_timeout_requeued_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		'claim_released_by', 'batch_claim_timeout',
		'claim_previous_worker_id', COALESCE(metadata->>'claimed_by_worker_id', '')
	),
	updated_at = now()
WHERE tenant_id = $1
  AND status = 'running'
  AND metadata->>'claim_expires_at' IS NOT NULL
  AND (metadata->>'claim_expires_at')::timestamptz <= now()
  AND quota_committed_units = 0
  AND quota_refunded_units = 0`,
		strings.TrimSpace(tenantID),
	)
	return err
}

func (r BatchRepository) countRunningChildren(ctx context.Context, tenantID string) (int, error) {
	return scanCount(r.db.QueryRow(ctx, `SELECT COUNT(*) FROM generation_child_tasks WHERE tenant_id = $1 AND status = 'running'`, strings.TrimSpace(tenantID)))
}

func (r BatchRepository) countRunningChildrenForProvider(ctx context.Context, tenantID, providerID string) (int, error) {
	return scanCount(r.db.QueryRow(ctx, `SELECT COUNT(*) FROM generation_child_tasks WHERE tenant_id = $1 AND provider_id = $2 AND status = 'running'`, strings.TrimSpace(tenantID), strings.TrimSpace(providerID)))
}

func (r BatchRepository) countRunningChildrenForProviderModel(ctx context.Context, tenantID, providerID, modelID string) (int, error) {
	return scanCount(r.db.QueryRow(ctx, `SELECT COUNT(*) FROM generation_child_tasks WHERE tenant_id = $1 AND provider_id = $2 AND model_id = $3 AND status = 'running'`, strings.TrimSpace(tenantID), strings.TrimSpace(providerID), strings.TrimSpace(modelID)))
}

func (r BatchRepository) claimChild(ctx context.Context, tenantID, childID, workerID string, timeout time.Duration) (GenerationChildTask, error) {
	now := time.Now().UTC()
	expiresAt := now.Add(timeout)
	child, err := scanChild(r.db.QueryRow(ctx, `
UPDATE generation_child_tasks
SET status = 'running',
	metadata = metadata || jsonb_build_object(
		'claimed_by_worker_id', $3::text,
		'fanout_stage', 'claimed_by_worker_scheduler',
		'claim_expires_at', $4::text,
		'claim_attempt', ((COALESCE(metadata->>'claim_attempt', '0'))::integer + 1)::text
	),
	updated_at = $5
WHERE tenant_id = $1 AND id = $2 AND status = 'queued'
RETURNING id, batch_id, tenant_id, status, provider_id, model_id, tool_type, seed, retry_count, max_retries, quota_estimate_units, quota_committed_units, quota_refunded_units, COALESCE(asset_id, ''), COALESCE(canvas_object_id, ''), trace_id, visible_trace_ref, failure_code, failure_message, review_reason, metadata, created_at, updated_at`,
		strings.TrimSpace(tenantID),
		strings.TrimSpace(childID),
		strings.TrimSpace(workerID),
		expiresAt.Format(time.RFC3339),
		now,
	))
	if err != nil {
		return GenerationChildTask{}, err
	}
	if err := r.refreshBatchAggregate(ctx, child.TenantID, child.BatchID); err != nil {
		return GenerationChildTask{}, err
	}
	return child, nil
}

func scanCount(row store.Row) (int, error) {
	var count int64
	if err := row.Scan(&count); err != nil {
		return 0, err
	}
	return int(count), nil
}

func normalizeBatchSchedulePolicy(policy BatchSchedulePolicy) BatchSchedulePolicy {
	policy.TenantID = strings.TrimSpace(policy.TenantID)
	policy.WorkerID = strings.TrimSpace(policy.WorkerID)
	if policy.ClaimTimeout <= 0 {
		policy.ClaimTimeout = 15 * time.Minute
	}
	policy.ProviderMaxConcurrency = normalizeIntMap(policy.ProviderMaxConcurrency)
	policy.ProviderModelConcurrency = normalizeIntMap(policy.ProviderModelConcurrency)
	allowed := make([]ProviderModelTool, 0, len(policy.AllowedProviderModelTools))
	for _, item := range policy.AllowedProviderModelTools {
		item.ProviderID = strings.TrimSpace(item.ProviderID)
		item.ModelID = strings.TrimSpace(item.ModelID)
		item.ToolType = strings.TrimSpace(item.ToolType)
		allowed = append(allowed, item)
	}
	policy.AllowedProviderModelTools = allowed
	return policy
}

func normalizeIntMap(input map[string]int) map[string]int {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]int, len(input))
	for key, value := range input {
		trimmed := strings.TrimSpace(key)
		if trimmed != "" {
			out[trimmed] = value
		}
	}
	return out
}

func allowedProviderModelToolSet(entries []ProviderModelTool) map[string]bool {
	if len(entries) == 0 {
		return nil
	}
	allowed := make(map[string]bool, len(entries))
	for _, entry := range entries {
		allowed[providerModelToolKey(entry.ProviderID, entry.ModelID, entry.ToolType)] = true
	}
	return allowed
}

func providerModelKey(providerID, modelID string) string {
	return strings.TrimSpace(providerID) + ":" + strings.TrimSpace(modelID)
}

func providerModelToolKey(providerID, modelID, toolType string) string {
	return providerModelKey(providerID, modelID) + ":" + strings.TrimSpace(toolType)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
