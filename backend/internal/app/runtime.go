package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/audit"
	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/server"
	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/task"
)

func Logger() *slog.Logger {
	return slog.New(security.NewRedactingSlogHandler(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{})))
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
	scanner := malwareScannerFromConfig(cfg, http.DefaultClient)
	stage0Service := stage0.NewService(stage0.NewRepository(db), objects, scanner).WithDownloadURLTTL(cfg.ObjectStorage.DownloadURLTTL)
	api := server.New(cfg, logger, server.WithMalwareScanner(scanner))
	baseHandler := api.Handler()
	auditStore := audit.NewPostgresRecorder(db)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqCtx := task.ContextWithRepository(r.Context(), task.NewRepository(db))
		reqCtx = stage0.ContextWithService(reqCtx, stage0Service)
		reqCtx = audit.ContextWithSearcher(reqCtx, auditStore)
		reqCtx = audit.ContextWithRecorder(reqCtx, auditStore)
		baseHandler.ServeHTTP(w, r.WithContext(reqCtx))
	})
	srv := server.NewHTTPServer(cfg, handler)
	errCh := make(chan error, 1)
	metricsSrv := StartMetricsServer(ctx, cfg, logger, api.MetricsHandler())

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

func malwareScannerFromConfig(cfg config.Config, client *http.Client) security.MalwareScanner {
	provider := strings.ToLower(strings.TrimSpace(cfg.Security.MalwareScanProvider))
	switch provider {
	case "http":
		return security.HTTPMalwareScanner{
			Endpoint: cfg.Security.MalwareScanEndpoint,
			APIKey:   cfg.Security.MalwareScanAPIKey,
			Provider: "http",
			Client:   client,
			Timeout:  cfg.Security.MalwareScanTimeout,
		}
	default:
		return security.PlaceholderMalwareScanner{Provider: provider}
	}
}

func SignalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
}
