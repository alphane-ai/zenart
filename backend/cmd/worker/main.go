package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/agent"
	"github.com/alphane-ai/zenart/backend/internal/app"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/health"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/readiness"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/worker"
)

func main() {
	logger := app.Logger()
	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration error", "error", err)
		os.Exit(1)
	}

	ctx, stop := app.SignalContext()
	defer stop()

	report := readiness.New(health.Checks(cfg)...).Run(ctx)
	if report.Status != readiness.StatusOK {
		logger.Error("worker dependencies are not ready", "report", report)
		os.Exit(1)
	}

	contracts := agent.BaseStepContracts(cfg.Tasks.SchemaVersion)
	metrics := worker.NewMetrics()
	app.StartMetricsServer(ctx, cfg, logger, metrics.Handler())

	pool, err := store.OpenPool(ctx, cfg.Postgres.DSN)
	if err != nil {
		logger.Error("worker database open failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	runner := worker.NewRunnerWithMetrics(
		worker.NewRepository(store.NewPoolAdapter(pool)),
		logger,
		contracts,
		worker.Options{
			SchemaVersion: cfg.Tasks.SchemaVersion,
			InstanceID:    cfg.Worker.InstanceID,
			WorkerVersion: cfg.Worker.Version,
			PollInterval:  cfg.Worker.PollInterval,
			ClaimTimeout:  cfg.Worker.ClaimTimeout,
		},
		metrics,
	)
	logger.Info("worker ready", "contracts", len(contracts), "schema_version", cfg.Tasks.SchemaVersion, "worker_version", cfg.Worker.Version, "worker_instance_id", cfg.Worker.InstanceID)

	errCh := make(chan error, 1)
	go func() {
		errCh <- runner.Run(ctx)
	}()
	if cfg.Worker.CleanupInterval > 0 {
		objects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
		if err != nil {
			logger.Error("worker object store open failed", "error", err)
			os.Exit(1)
		}
		cleanupService := stage0.NewService(stage0.NewRepository(store.NewPoolAdapter(pool)), objects).WithDownloadURLTTL(cfg.ObjectStorage.DownloadURLTTL)
		go runCleanupLoop(ctx, cleanupService, logger, metrics, cfg.Worker.CleanupInterval, cfg.Worker.CleanupTimeout, cfg.Worker.CleanupBatchLimit)
	}

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil && !errors.Is(err, context.Canceled) {
			logger.Error("worker stopped", "error", err)
			os.Exit(1)
		}
	}

	drainTimeout := cfg.Worker.DrainGraceTimeout
	if drainTimeout <= 0 {
		drainTimeout = 10 * time.Second
	}
	drainCtx, cancel := context.WithTimeout(context.Background(), drainTimeout)
	defer cancel()
	drained, err := runner.Drain(drainCtx)
	if err != nil {
		logger.Error("worker drain failed", "error", err)
		os.Exit(1)
	}
	logger.Info("worker drained", "tasks", drained, "worker_version", cfg.Worker.Version, "worker_instance_id", cfg.Worker.InstanceID)
	if !errors.Is(ctx.Err(), context.Canceled) {
		logger.Error("worker stopped", "error", ctx.Err())
	}
}

type cleanupService interface {
	CleanupExpiredExportsAndOrphanedObjects(context.Context, time.Time, int) (stage0.CleanupResult, error)
}

func runCleanupLoop(ctx context.Context, service cleanupService, logger interface {
	Info(string, ...any)
	Error(string, ...any)
}, metrics *worker.Metrics, interval, timeout time.Duration, limit int) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	runCleanupOnce(ctx, service, logger, metrics, timeout, limit)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runCleanupOnce(ctx, service, logger, metrics, timeout, limit)
		}
	}
}

type slogCleanupLogger interface {
	Info(string, ...any)
	Error(string, ...any)
}

var _ slogCleanupLogger = (*slog.Logger)(nil)

func runCleanupOnce(ctx context.Context, service cleanupService, logger interface {
	Info(string, ...any)
	Error(string, ...any)
}, metrics *worker.Metrics, timeout time.Duration, limit int) {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	if limit <= 0 {
		limit = 100
	}
	cleanupCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	result, err := service.CleanupExpiredExportsAndOrphanedObjects(cleanupCtx, time.Now().UTC(), limit)
	if err != nil {
		metrics.ObserveCleanupFailure()
		if cleanupResultHasEvidence(result) {
			metrics.ObserveCleanupRun(result.ExpiredExports, result.OrphanedObjects, result.DeletedObjects, result.FailedObjects)
		}
		logger.Error("export object cleanup failed",
			"error", security.RedactString(err.Error()),
			"expired_exports", result.ExpiredExports,
			"orphaned_objects", result.OrphanedObjects,
			"deleted_objects", result.DeletedObjects,
			"failed_objects", result.FailedObjects,
			"cleanup_status", cleanupStatus(result),
			"batch_limit", limit,
		)
		return
	}
	metrics.ObserveCleanupRun(result.ExpiredExports, result.OrphanedObjects, result.DeletedObjects, result.FailedObjects)
	logger.Info("export object cleanup completed", "expired_exports", result.ExpiredExports, "orphaned_objects", result.OrphanedObjects, "deleted_objects", result.DeletedObjects, "failed_objects", result.FailedObjects, "cleanup_status", result.Status, "batch_limit", limit)
}

func cleanupResultHasEvidence(result stage0.CleanupResult) bool {
	return result.ExpiredExports > 0 || result.OrphanedObjects > 0 || result.DeletedObjects > 0 || result.FailedObjects > 0 || strings.TrimSpace(result.Status) != ""
}

func cleanupStatus(result stage0.CleanupResult) string {
	if strings.TrimSpace(result.Status) != "" {
		return result.Status
	}
	if result.FailedObjects > 0 {
		return "partial_failed"
	}
	return "failed"
}
