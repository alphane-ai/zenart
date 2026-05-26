package main

import (
	"context"
	"errors"
	"os"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/agent"
	"github.com/alphane-ai/zenart/backend/internal/app"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/health"
	"github.com/alphane-ai/zenart/backend/internal/readiness"
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
