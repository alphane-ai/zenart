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
	"github.com/alphane-ai/zenart/backend/internal/billing"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/health"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/provider"
	"github.com/alphane-ai/zenart/backend/internal/readiness"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
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
	var batchRunner *worker.BatchRunner
	if cfg.Worker.BatchEnabled {
		batchObjects, err := objectstore.NewStore(cfg.ObjectStorage, nil)
		if err != nil {
			logger.Error("worker batch object store open failed", "error", err)
			os.Exit(1)
		}
		providerRegistry := provider.NewRegistryRepository(store.NewPoolAdapter(pool))
		runner := worker.NewBatchRunner(
			task.NewBatchRepository(store.NewPoolAdapter(pool)).
				WithQuotaLedger(task.NewPostgresBatchQuotaLedger(store.NewPoolAdapter(pool))).
				WithStrategyGroupReader(providerRegistry),
			task.BatchChildExecutor{
				Providers:     batchProviderClientsFromConfig(cfg),
				ResultSink:    task.NewPostgresBatchResultSink(store.NewPoolAdapter(pool), batchObjects),
				UsageRecorder: billingQuotaRecorder(store.NewPoolAdapter(pool)),
			},
			logger,
			worker.BatchRunnerOptions{
				Policy:       batchPolicyFromConfig(cfg),
				PollInterval: cfg.Worker.BatchPollInterval,
			},
		)
		batchRunner = &runner
		go func() {
			if err := batchRunner.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
				errCh <- err
			}
		}()
		logger.Info("batch child worker enabled", "tenant_id", cfg.Worker.BatchTenantID, "claim_limit", cfg.Worker.BatchClaimLimit, "worker_instance_id", cfg.Worker.InstanceID)
	}
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
	if batchRunner != nil {
		batchRunner.Drain()
		logger.Info("batch child worker drained", "worker_instance_id", cfg.Worker.InstanceID)
	}
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

func batchPolicyFromConfig(cfg config.Config) task.BatchSchedulePolicy {
	return task.BatchSchedulePolicy{
		TenantID:                  cfg.Worker.BatchTenantID,
		WorkerID:                  cfg.Worker.InstanceID,
		Limit:                     cfg.Worker.BatchClaimLimit,
		ClaimTimeout:              cfg.Worker.BatchClaimTimeout,
		MaxTenantConcurrency:      cfg.Worker.BatchMaxTenantConcurrency,
		ProviderMaxConcurrency:    cfg.Worker.BatchProviderMaxConcurrency,
		ProviderModelConcurrency:  cfg.Worker.BatchProviderModelMaxConcurrency,
		AllowedProviderModelTools: allowedProviderModelToolsFromConfig(cfg.Worker.BatchAllowedProviderModelToolTypes),
	}
}

func batchProviderClientsFromConfig(cfg config.Config) task.ProviderClientMap {
	devProvider := provider.DevProvider{}
	clients := task.ProviderClientMap{
		"dev":                  devProvider,
		"zenari-image-sandbox": devProvider,
	}
	if cfg.LLM.EnableLiveCalls && strings.EqualFold(strings.TrimSpace(cfg.LLM.Provider), "openai-compatible") {
		clients["zenari-image-sandbox"] = provider.OpenAICompatibleProvider{Config: provider.OpenAICompatibleConfig{
			ProviderID:       "zenari-image-sandbox",
			BaseURL:          cfg.LLM.OpenAIBaseURL,
			APIKey:           cfg.LLM.OpenAIAPIKey,
			ModelID:          cfg.LLM.OpenAIModel,
			Timeout:          cfg.LLM.RequestTimeout,
			LiveCallsEnabled: true,
		}}
	}
	return clients
}

func allowedProviderModelToolsFromConfig(entries []string) []task.ProviderModelTool {
	tools := make([]task.ProviderModelTool, 0, len(entries))
	for _, entry := range entries {
		parts := strings.Split(entry, ":")
		if len(parts) != 3 {
			continue
		}
		tools = append(tools, task.ProviderModelTool{
			ProviderID: strings.TrimSpace(parts[0]),
			ModelID:    strings.TrimSpace(parts[1]),
			ToolType:   strings.TrimSpace(parts[2]),
		})
	}
	return tools
}

func billingQuotaRecorder(db store.DBTX) task.ProviderUsageRecorder {
	return billingProviderUsageRecorder{db: db}
}

type billingProviderUsageRecorder struct {
	db store.DBTX
}

func (r billingProviderUsageRecorder) RecordProviderUsage(ctx context.Context, usage billing.ProviderUsageLog) error {
	return billing.NewQuotaRepository(r.db).RecordProviderUsage(ctx, usage)
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
