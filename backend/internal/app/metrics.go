package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
)

func StartMetricsServer(ctx context.Context, cfg config.Config, logger *slog.Logger, handler http.Handler) *http.Server {
	if !cfg.Observability.MetricsEnabled || handler == nil {
		return nil
	}
	if logger == nil {
		logger = slog.Default()
	}
	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Observability.MetricsPort),
		Handler:           handler,
		ReadHeaderTimeout: cfg.HTTP.ReadHeaderTimeout,
	}
	go func() {
		logger.Info("metrics listening", "addr", srv.Addr, "service", cfg.App.ServiceName)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("metrics server stopped", "error", err, "service", cfg.App.ServiceName)
		}
	}()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	return srv
}
