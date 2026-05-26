package store

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) Row
}

type Row interface {
	Scan(dest ...any) error
}

type Rows interface {
	Close()
	Err() error
	Next() bool
	Scan(dest ...any) error
}

func OpenPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	return pgxpool.New(ctx, dsn)
}

type PoolAdapter struct {
	pool *pgxpool.Pool
}

func NewPoolAdapter(pool *pgxpool.Pool) PoolAdapter {
	return PoolAdapter{pool: pool}
}

func (a PoolAdapter) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return a.pool.Exec(ctx, sql, arguments...)
}

func (a PoolAdapter) Query(ctx context.Context, sql string, args ...any) (Rows, error) {
	rows, err := a.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgxRows{rows: rows}, nil
}

func (a PoolAdapter) QueryRow(ctx context.Context, sql string, args ...any) Row {
	return a.pool.QueryRow(ctx, sql, args...)
}

type pgxRows struct {
	rows pgx.Rows
}

func (r pgxRows) Close() {
	r.rows.Close()
}

func (r pgxRows) Err() error {
	return r.rows.Err()
}

func (r pgxRows) Next() bool {
	return r.rows.Next()
}

func (r pgxRows) Scan(dest ...any) error {
	return r.rows.Scan(dest...)
}
