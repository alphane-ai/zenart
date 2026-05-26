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

type Tx interface {
	DBTX
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
}

type Transactor interface {
	Begin(ctx context.Context) (Tx, error)
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

func (a PoolAdapter) Begin(ctx context.Context) (Tx, error) {
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return pgxTx{tx: tx}, nil
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

type pgxTx struct {
	tx pgx.Tx
}

func (t pgxTx) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return t.tx.Exec(ctx, sql, arguments...)
}

func (t pgxTx) Query(ctx context.Context, sql string, args ...any) (Rows, error) {
	rows, err := t.tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgxRows{rows: rows}, nil
}

func (t pgxTx) QueryRow(ctx context.Context, sql string, args ...any) Row {
	return t.tx.QueryRow(ctx, sql, args...)
}

func (t pgxTx) Commit(ctx context.Context) error {
	return t.tx.Commit(ctx)
}

func (t pgxTx) Rollback(ctx context.Context) error {
	return t.tx.Rollback(ctx)
}
