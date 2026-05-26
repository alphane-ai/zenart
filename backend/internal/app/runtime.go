package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/server"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
)

func Logger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{}))
}

func RunServer(ctx context.Context, cfg config.Config, logger *slog.Logger) error {
	pool, err := store.OpenPool(ctx, cfg.Postgres.DSN)
	if err != nil {
		return err
	}
	defer pool.Close()

	objects, err := objectstore.NewStore(cfg.ObjectStorage, http.DefaultClient)
	if err != nil {
		return err
	}
	db := store.NewPoolAdapter(pool)
	scanner := security.PlaceholderMalwareScanner{Provider: cfg.Security.MalwareScanProvider}
	stage0Service := stage0.NewService(stage0.NewRepository(db), objects, scanner)
	api := server.New(cfg, logger)
	baseHandler := api.Handler()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqCtx := task.ContextWithRepository(r.Context(), task.NewRepository(db))
		reqCtx = stage0.ContextWithService(reqCtx, stage0Service)
		baseHandler.ServeHTTP(w, r.WithContext(reqCtx))
	})
	srv := server.NewHTTPServer(cfg, handler)
	errCh := make(chan error, 1)
	var metricsSrv *http.Server
	if cfg.Observability.MetricsEnabled {
		metricsSrv = &http.Server{
			Addr:              fmt.Sprintf(":%d", cfg.Observability.MetricsPort),
			Handler:           api.MetricsHandler(),
			ReadHeaderTimeout: cfg.HTTP.ReadHeaderTimeout,
		}
		go func() {
			logger.Info("metrics listening", "addr", metricsSrv.Addr)
			if err := metricsSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				logger.Error("metrics server stopped", "error", err)
			}
		}()
	}

	go func() {
		logger.Info("server listening", "addr", cfg.HTTP.Addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if metricsSrv != nil {
			_ = metricsSrv.Shutdown(shutdownCtx)
		}
		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
		return ctx.Err()
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func SignalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
}
