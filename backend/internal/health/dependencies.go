package health

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/readiness"
)

func Checks(cfg config.Config) []readiness.Check {
	return []readiness.Check{
		{
			Name:    "postgres",
			Timeout: cfg.Postgres.CheckTimeout,
			Run: func(ctx context.Context) error {
				conn, err := pgx.Connect(ctx, cfg.Postgres.DSN)
				if err != nil {
					return readiness.Required("postgres", err)
				}
				defer conn.Close(context.Background())
				return readiness.Required("postgres", conn.Ping(ctx))
			},
		},
		{
			Name:    "redis",
			Timeout: cfg.Redis.CheckTimeout,
			Run: func(ctx context.Context) error {
				client := redis.NewClient(&redis.Options{
					Addr:     cfg.Redis.Addr,
					Password: cfg.Redis.Password,
					DB:       cfg.Redis.DB,
				})
				defer client.Close()
				return readiness.Required("redis", client.Ping(ctx).Err())
			},
		},
		{
			Name:    "object_storage",
			Timeout: cfg.ObjectStorage.CheckTimeout,
			Run: func(ctx context.Context) error {
				client := objectstore.NewHTTPProbe(http.DefaultClient, cfg.ObjectStorage)
				return readiness.Required("object_storage", client.Check(ctx))
			},
		},
	}
}

func StartupContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 30*time.Second)
}
