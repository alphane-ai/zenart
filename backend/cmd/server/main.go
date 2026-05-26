package main

import (
	"context"
	"errors"
	"log/slog"
	"os"

	"github.com/alphane-ai/zenart/backend/internal/app"
	"github.com/alphane-ai/zenart/backend/internal/config"
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

	if err := app.RunServer(ctx, cfg, logger); err != nil && !errors.Is(err, context.Canceled) {
		logger.Error("server stopped", slog.Any("error", err))
		os.Exit(1)
	}
}
