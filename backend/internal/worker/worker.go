package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/agent"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
)

var ErrNoTask = errors.New("worker task not found")

type Repository struct {
	db store.DBTX
}

func NewRepository(db store.DBTX) Repository {
	return Repository{db: db}
}

type ClaimOptions struct {
	SchemaVersion int
	InstanceID    string
	WorkerVersion string
	Timeout       time.Duration
	TaskTypes     []string
}

func (r Repository) ClaimNext(ctx context.Context, opts ClaimOptions) (task.Task, error) {
	if opts.SchemaVersion < 1 {
		return task.Task{}, errors.New("schema version must be >= 1")
	}
	if opts.WorkerVersion == "" {
		return task.Task{}, errors.New("worker version is required")
	}
	if opts.InstanceID == "" {
		return task.Task{}, errors.New("worker instance id is required")
	}
	if opts.Timeout <= 0 {
		return task.Task{}, errors.New("claim timeout must be > 0")
	}
	if len(opts.TaskTypes) == 0 {
		return task.Task{}, errors.New("at least one task type is required")
	}

	now := time.Now().UTC()
	timeoutAt := now.Add(opts.Timeout)
	var claimed task.Task
	var metadataJSON []byte
	var errorJSON []byte
	err := r.db.QueryRow(ctx, `
WITH next_task AS (
	SELECT id
	FROM agent_tasks
	WHERE status = 'pending'
	  AND schema_version <= $1
	  AND type = ANY($5)
	ORDER BY created_at ASC
	FOR UPDATE SKIP LOCKED
	LIMIT 1
)
UPDATE agent_tasks
SET status = 'running',
    user_status = 'running',
    progress = CASE WHEN progress < 1 THEN 1 ELSE progress END,
    user_message = 'Worker claimed task',
    worker_version = $2,
    timeout_at = $3,
    metadata = metadata || $6,
    started_at = COALESCE(started_at, $4),
    updated_at = $4
WHERE id IN (SELECT id FROM next_task)
RETURNING id, tenant_id, type, schema_version, status, user_status, idempotency_key, progress, retry_count, timeout_at, user_message, app_version, worker_version, error, metadata, created_at, updated_at`,
		opts.SchemaVersion,
		opts.WorkerVersion,
		timeoutAt,
		now,
		opts.TaskTypes,
		jsonObject(map[string]any{"worker_instance_id": opts.InstanceID}),
	).Scan(
		&claimed.ID,
		&claimed.TenantID,
		&claimed.Type,
		&claimed.SchemaVersion,
		&claimed.Status,
		&claimed.UserStatus,
		&claimed.IdempotencyKey,
		&claimed.Progress,
		&claimed.RetryCount,
		&claimed.TimeoutAt,
		&claimed.UserMessage,
		&claimed.AppVersion,
		&claimed.WorkerVersion,
		&errorJSON,
		&metadataJSON,
		&claimed.CreatedAt,
		&claimed.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return task.Task{}, ErrNoTask
	}
	if err != nil {
		return task.Task{}, err
	}
	if len(errorJSON) > 0 {
		var taskError task.TaskError
		if err := json.Unmarshal(errorJSON, &taskError); err != nil {
			return task.Task{}, err
		}
		claimed.Error = &taskError
	}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &claimed.Metadata); err != nil {
			return task.Task{}, err
		}
	}
	return claimed, nil
}

func (r Repository) DrainOwned(ctx context.Context, workerVersion, instanceID string) (int64, error) {
	if workerVersion == "" {
		return 0, errors.New("worker version is required")
	}
	if instanceID == "" {
		return 0, errors.New("worker instance id is required")
	}
	completedAt := time.Now().UTC()
	taskError := task.TaskError{
		Code:    "worker_drained",
		Message: "worker drained before task completion",
	}
	var drained int64
	err := r.db.QueryRow(ctx, `
WITH drained_tasks AS (
	UPDATE agent_tasks
SET status = 'failed',
    user_status = 'failed',
    progress = CASE WHEN progress > 0 THEN progress ELSE 1 END,
    user_message = 'Worker drained before completion',
    error = $2,
    completed_at = COALESCE(completed_at, $3),
    updated_at = $3
WHERE status = 'running'
  AND worker_version = $1
  AND metadata->>'worker_instance_id' = $4
	RETURNING id, tenant_id, type, error, metadata, completed_at
),
failed_exports AS (
	UPDATE exports e
	SET status = 'failed',
	    qa_status = CASE WHEN e.qa_status = 'pending' THEN 'failed' ELSE e.qa_status END,
	    error = drained_tasks.error,
	    delivery_metadata = e.delivery_metadata || jsonb_build_object('failed_at', $3::timestamptz),
	    updated_at = $3
	FROM drained_tasks
	WHERE e.tenant_id = drained_tasks.tenant_id
	  AND e.task_id = drained_tasks.id
	  AND drained_tasks.type = 'package_export_builder'
	  AND e.status IN ('pending', 'running')
	RETURNING e.id, e.tenant_id, e.package_id, e.project_id, e.format, drained_tasks.id AS task_id, drained_tasks.metadata
),
export_failure_analytics AS (
	INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
	SELECT
		'analytics_' || md5(failed_exports.tenant_id || ':' || failed_exports.id || ':export_failed:' || $3::text),
		failed_exports.tenant_id,
		NULL,
		failed_exports.project_id,
		COALESCE(failed_exports.metadata->>'workflow_id', ''),
		'export_failed',
		'export',
		failed_exports.id,
		jsonb_build_object(
			'package_id', failed_exports.package_id,
			'task_id', failed_exports.task_id,
			'worker_version', $1,
			'worker_instance_id', $4,
			'format', failed_exports.format,
			'failure_code', 'worker_drained'
		),
		$3
	FROM failed_exports
	ON CONFLICT (id) DO NOTHING
)
SELECT count(*) FROM drained_tasks`,
		workerVersion,
		jsonObject(taskError),
		completedAt,
		instanceID,
	).Scan(&drained)
	if err != nil {
		return 0, fmt.Errorf("drain owned worker tasks: %w", err)
	}
	return drained, nil
}

type Runner struct {
	repo      Repository
	logger    *slog.Logger
	metrics   *Metrics
	contracts map[string]agent.StepContract
	taskTypes []string
	opts      Options
}

type Options struct {
	SchemaVersion int
	InstanceID    string
	WorkerVersion string
	PollInterval  time.Duration
	ClaimTimeout  time.Duration
}

func NewRunner(repo Repository, logger *slog.Logger, contracts []agent.StepContract, opts Options) Runner {
	return NewRunnerWithMetrics(repo, logger, contracts, opts, nil)
}

func NewRunnerWithMetrics(repo Repository, logger *slog.Logger, contracts []agent.StepContract, opts Options, metrics *Metrics) Runner {
	contractMap := make(map[string]agent.StepContract, len(contracts))
	taskTypes := make([]string, 0, len(contracts))
	for _, contract := range contracts {
		contractMap[contract.Name] = contract
		if contract.SchemaVersion <= opts.SchemaVersion {
			taskTypes = append(taskTypes, contract.Name)
		}
	}
	if logger == nil {
		logger = slog.Default()
	}
	return Runner{repo: repo, logger: logger, metrics: metrics, contracts: contractMap, taskTypes: taskTypes, opts: opts}
}

func (r Runner) Run(ctx context.Context) error {
	pollInterval := r.opts.PollInterval
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		claimStartedAt := time.Now()
		claimed, err := r.repo.ClaimNext(ctx, ClaimOptions{
			SchemaVersion: r.opts.SchemaVersion,
			InstanceID:    r.opts.InstanceID,
			WorkerVersion: r.opts.WorkerVersion,
			Timeout:       r.opts.ClaimTimeout,
			TaskTypes:     r.taskTypes,
		})
		switch {
		case err == nil:
			r.metrics.ObserveClaim(claimed.Type, time.Since(claimStartedAt))
			if _, ok := r.contracts[claimed.Type]; !ok {
				r.metrics.ObserveUnsupportedTask()
				r.logger.Warn("claimed unsupported task type", "task_id", claimed.ID, "task_type", claimed.Type, "schema_version", claimed.SchemaVersion)
				continue
			}
			r.logger.Info("claimed task", "task_id", claimed.ID, "task_type", claimed.Type, "schema_version", claimed.SchemaVersion)
			continue
		case errors.Is(err, ErrNoTask):
			r.metrics.ObserveEmptyPoll()
		case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
			return err
		default:
			r.metrics.ObserveClaimError()
			r.logger.Error("worker claim failed", "error", err)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (r Runner) Drain(ctx context.Context) (int64, error) {
	drained, err := r.repo.DrainOwned(ctx, r.opts.WorkerVersion, r.opts.InstanceID)
	if err == nil {
		r.metrics.ObserveDrain(drained)
	}
	return drained, err
}

func jsonObject(value any) []byte {
	data, _ := json.Marshal(value)
	return data
}
