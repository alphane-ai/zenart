package main

import (
	"context"
	"errors"
	"os"

	"github.com/alphane-ai/zenart/backend/internal/agent"
	"github.com/alphane-ai/zenart/backend/internal/app"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/health"
	"github.com/alphane-ai/zenart/backend/internal/readiness"
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
	logger.Info("worker ready", "contracts", len(contracts), "schema_version", cfg.Tasks.SchemaVersion)
	<-ctx.Done()
	if !errors.Is(ctx.Err(), context.Canceled) {
		logger.Error("worker stopped", "error", ctx.Err())
	}
}
