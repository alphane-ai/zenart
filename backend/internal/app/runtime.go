package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
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

	localObjects, err := objectstore.NewLocalStore(cfg.ObjectStorage.LocalRoot, cfg.ObjectStorage.Bucket, cfg.ObjectStorage.SigningKey)
	if err != nil {
		return err
	}
	db := store.NewPoolAdapter(pool)
	stage0Service := stage0.NewService(stage0.NewRepository(db), localObjects)
	baseHandler := server.New(cfg, logger).Handler()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqCtx := task.ContextWithRepository(r.Context(), task.NewRepository(db))
		reqCtx = stage0.ContextWithService(reqCtx, stage0Service)
		baseHandler.ServeHTTP(w, r.WithContext(reqCtx))
	})
	srv := server.NewHTTPServer(cfg, handler)
	errCh := make(chan error, 1)

	go func() {
		logger.Info("server listening", "addr", cfg.HTTP.Addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
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
