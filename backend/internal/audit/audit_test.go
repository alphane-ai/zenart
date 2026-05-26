package audit

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestPostgresRecorderRecordRedactsMetadata(t *testing.T) {
	db := &fakeDB{}
	recorder := NewPostgresRecorder(db)

	err := recorder.Record(context.Background(), Event{
		ID:       "audit_1",
		TenantID: "tenant_1",
		ActorID:  "admin_1",
		Action:   "export.regenerate",
		Resource: "exports/export_1",
		Metadata: map[string]any{
			"reason":    "retry",
			"api_key":   "secret",
			"auth_note": "Authorization: Bearer abc123",
		},
		CreatedAt: time.Date(2026, 5, 26, 1, 2, 3, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("Record() error = %v", err)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO audit_logs") {
		t.Fatalf("audit insert not recorded: %#v", db.execs)
	}
	metadata, ok := db.execs[0].args[5].([]byte)
	if !ok {
		t.Fatalf("metadata arg = %T, want []byte", db.execs[0].args[5])
	}
	body := string(metadata)
	for _, fragment := range []string{`"reason":"retry"`, `"api_key":"` + security.Redacted + `"`, security.Redacted} {
		if !strings.Contains(body, fragment) {
			t.Fatalf("metadata = %s, missing %s", body, fragment)
		}
	}
	if strings.Contains(body, "abc123") || strings.Contains(body, "secret") {
		t.Fatalf("metadata = %s, want secret values removed", body)
	}
}

func TestPostgresRecorderSearchUsesTenantScopedFiltersAndRedactsMetadata(t *testing.T) {
	now := time.Date(2026, 5, 26, 1, 2, 3, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"audit_1",
			"tenant_1",
			"admin_1",
			"export.regenerate",
			"exports/export_1",
			[]byte(`{"reason":"retry","session_token":"secret"}`),
			now,
		}},
	}}}
	recorder := NewPostgresRecorder(db)

	page, err := recorder.Search(context.Background(), SearchFilters{
		TenantID: "tenant_1",
		ActorID:  "admin_1",
		Action:   "export.regenerate",
		Resource: "exports/export_1",
		Limit:    250,
	})
	if err != nil {
		t.Fatalf("Search() error = %v", err)
	}
	if len(db.queries) != 1 {
		t.Fatalf("query count = %d, want 1", len(db.queries))
	}
	query := db.queries[0]
	if !strings.Contains(query.sql, "WHERE tenant_id = $1") || !strings.Contains(query.sql, "ORDER BY created_at DESC") {
		t.Fatalf("query missing tenant scope/order: %s", query.sql)
	}
	wantArgs := []any{"tenant_1", "admin_1", "export.regenerate", "exports/export_1", 100}
	for i, want := range wantArgs {
		if query.args[i] != want {
			t.Fatalf("arg[%d] = %#v, want %#v", i, query.args[i], want)
		}
	}
	if len(page.Items) != 1 {
		t.Fatalf("items = %d, want 1", len(page.Items))
	}
	event := page.Items[0]
	if event.TenantID != "tenant_1" || event.ID != "audit_1" {
		t.Fatalf("event = %#v", event)
	}
	if event.Metadata["session_token"] != security.Redacted || event.Metadata["reason"] != "retry" {
		t.Fatalf("metadata = %#v, want redacted token and public reason", event.Metadata)
	}
}

type fakeDB struct {
	execs     []execCall
	queries   []queryCall
	queryRows []rowSet
}

type execCall struct {
	sql  string
	args []any
}

type queryCall struct {
	sql  string
	args []any
}

func (f *fakeDB) Exec(_ context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	f.execs = append(f.execs, execCall{sql: sql, args: arguments})
	return pgconn.CommandTag{}, nil
}

func (f *fakeDB) Query(_ context.Context, sql string, args ...any) (store.Rows, error) {
	f.queries = append(f.queries, queryCall{sql: sql, args: args})
	if len(f.queryRows) == 0 {
		return &fakeRows{}, nil
	}
	rows := f.queryRows[0]
	f.queryRows = f.queryRows[1:]
	return &fakeRows{rows: rows.rows}, nil
}

func (f *fakeDB) QueryRow(context.Context, string, ...any) store.Row {
	return fakeRow{err: pgx.ErrNoRows}
}

type rowSet struct {
	rows [][]any
}

type fakeRows struct {
	rows  [][]any
	index int
}

func (f *fakeRows) Close() {}

func (f *fakeRows) Err() error {
	return nil
}

func (f *fakeRows) Next() bool {
	return f.index < len(f.rows)
}

func (f *fakeRows) Scan(dest ...any) error {
	row := f.rows[f.index]
	f.index++
	for i := range dest {
		switch target := dest[i].(type) {
		case *string:
			*target = row[i].(string)
		case *[]byte:
			*target = row[i].([]byte)
		case *time.Time:
			*target = row[i].(time.Time)
		default:
			return pgx.ErrNoRows
		}
	}
	return nil
}

type fakeRow struct {
	err error
}

func (f fakeRow) Scan(...any) error {
	if f.err != nil {
		return f.err
	}
	return nil
}
