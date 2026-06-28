package worker

import (
	"context"
	"errors"
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/task"
)

type BatchStore interface {
	task.BatchChildExecutionStore
	ClaimRunnableChildren(ctx context.Context, policy task.BatchSchedulePolicy) (task.BatchScheduleClaim, error)
}

type BatchRunnerOptions struct {
	Policy       task.BatchSchedulePolicy
	PollInterval time.Duration
}

type BatchRunner struct {
	store    BatchStore
	executor task.BatchChildExecutor
	logger   *slog.Logger
	opts     BatchRunnerOptions
	draining atomic.Bool
}

func NewBatchRunner(store BatchStore, executor task.BatchChildExecutor, logger *slog.Logger, opts BatchRunnerOptions) BatchRunner {
	if logger == nil {
		logger = slog.Default()
	}
	return BatchRunner{store: store, executor: executor, logger: logger, opts: opts}
}

func (r *BatchRunner) Run(ctx context.Context) error {
	pollInterval := r.opts.PollInterval
	if pollInterval <= 0 {
		pollInterval = 2 * time.Second
	}
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		if err := r.RunOnce(ctx); err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			r.logger.Error("batch child runner failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (r *BatchRunner) RunOnce(ctx context.Context) error {
	if r.store == nil {
		return errors.New("batch runner store is required")
	}
	if r.draining.Load() {
		return nil
	}
	claim, err := r.store.ClaimRunnableChildren(ctx, r.opts.Policy)
	if err != nil {
		return err
	}
	for _, child := range claim.Children {
		completed, err := r.executor.ExecuteClaimedChild(ctx, r.store, child)
		if err != nil {
			r.logger.Error("batch child execution failed", "child_id", child.ID, "tenant_id", child.TenantID, "provider_id", child.ProviderID, "model_id", child.ModelID, "error", err)
			continue
		}
		r.logger.Info("batch child execution completed", "child_id", completed.ID, "tenant_id", completed.TenantID, "status", completed.Status, "provider_id", completed.ProviderID, "model_id", completed.ModelID)
	}
	return nil
}

func (r *BatchRunner) Drain() {
	if r != nil {
		r.draining.Store(true)
	}
}
