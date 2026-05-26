package main

import (
	"context"
	"errors"
	"os"

	"github.com/alphane-ai/zenart/backend/internal/app"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/crawler"
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

	metrics := crawler.NewMetrics()
	app.StartMetricsServer(ctx, cfg, logger, metrics.Handler())

	report := readiness.New(health.Checks(cfg)...).Run(ctx)
	metrics.ObserveReadiness(report.Status == readiness.StatusOK)
	if report.Status != readiness.StatusOK {
		logger.Error("crawler dependencies are not ready", "report", report)
		os.Exit(1)
	}

	logger.Info("crawler ready")
	<-ctx.Done()
	if !errors.Is(ctx.Err(), context.Canceled) {
		logger.Error("crawler stopped", "error", ctx.Err())
	}
}
