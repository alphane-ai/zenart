package stage0

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/store"
)

func TestCreateSupportTicketPersistsTenantUserAndLinks(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	ticket, err := repo.CreateSupportTicket(context.Background(), "tenant_1", "user_1", SupportTicketCreate{
		ProjectID:      "project_1",
		Category:       "export_failure",
		Body:           "The export failed.",
		LinkedExportID: "export_1",
		Metadata:       map[string]any{"trace_id": "trace_1", "api_key": "secret"},
	})
	if err != nil {
		t.Fatalf("CreateSupportTicket() error = %v", err)
	}
	if ticket.TenantID != "tenant_1" || ticket.UserID != "user_1" {
		t.Fatalf("ticket tenant/user = %s/%s", ticket.TenantID, ticket.UserID)
	}
	if ticket.ProjectID == nil || *ticket.ProjectID != "project_1" {
		t.Fatalf("ticket ProjectID = %v", ticket.ProjectID)
	}
	if ticket.LinkedExportID == nil || *ticket.LinkedExportID != "export_1" {
		t.Fatalf("ticket LinkedExportID = %v", ticket.LinkedExportID)
	}
	if ticket.Metadata["api_key"] != "[REDACTED]" {
		t.Fatalf("ticket api_key metadata = %v, want redacted", ticket.Metadata["api_key"])
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO support_tickets") {
		t.Fatalf("support ticket insert not recorded: %#v", db.execs)
	}
}

func TestCreateExportBlocksWhenQAHasBlockingResult(t *testing.T) {
	db := &fakeDB{
		queryRows: []rowSet{{
			rows: [][]any{{"block", "blocking"}},
		}},
	}
	repo := NewRepository(db)

	_, err := repo.CreateExport(context.Background(), "tenant_1", "package_1", ExportCreate{Format: "zip"}, 1)
	if !errors.Is(err, ErrSafetyBlocked) {
		t.Fatalf("CreateExport() error = %v, want ErrSafetyBlocked", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("blocked export should not write rows: %#v", db.execs)
	}
}

func TestCreateExportCreatesTaskAndExport(t *testing.T) {
	db := &fakeDB{queryRows: []rowSet{{}}}
	repo := NewRepository(db)

	task, err := repo.CreateExport(context.Background(), "tenant_1", "package_1", ExportCreate{Format: "zip"}, 7)
	if err != nil {
		t.Fatalf("CreateExport() error = %v", err)
	}
	if task.SchemaVersion != 7 || task.Type != "package_export_builder" {
		t.Fatalf("task = %#v", task)
	}
	if len(db.execs) != 2 {
		t.Fatalf("exec count = %d, want 2", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO agent_tasks") {
		t.Fatalf("first exec should create task: %s", db.execs[0].sql)
	}
	if !strings.Contains(db.execs[1].sql, "INSERT INTO exports") {
		t.Fatalf("second exec should create export: %s", db.execs[1].sql)
	}
}

func TestCreateUploadValidatesAndPersistsMetadata(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	upload, err := repo.CreateUpload(context.Background(), UploadOptions{
		TenantID:            "tenant_1",
		UserID:              "user_1",
		Bucket:              "uploads-test",
		AllowedContentTypes: []string{"image/png"},
		MaxBytes:            1024,
		URLTTL:              5 * time.Minute,
		Input: UploadCreate{
			Filename:    "../Logo Draft.png",
			ContentType: "IMAGE/PNG",
			ByteSize:    512,
			UploadType:  "reference",
			Metadata:    map[string]any{"slot": "reference", "session_token": "secret"},
		},
		SignURL: func(_ string, objectKey string, _ time.Duration) (string, time.Time) {
			return "/signed/" + objectKey, time.Now().UTC().Add(5 * time.Minute)
		},
	})
	if err != nil {
		t.Fatalf("CreateUpload() error = %v", err)
	}
	if upload.OriginalName != "Logo_Draft.png" {
		t.Fatalf("filename = %q, want sanitized basename", upload.OriginalName)
	}
	if upload.ContentType != "image/png" {
		t.Fatalf("content type = %q, want image/png", upload.ContentType)
	}
	if upload.ObjectMetadata.Bucket != "uploads-test" {
		t.Fatalf("bucket = %q, want uploads-test", upload.ObjectMetadata.Bucket)
	}
	if upload.Metadata["session_token"] != "[REDACTED]" {
		t.Fatalf("upload session token metadata = %v, want redacted", upload.Metadata["session_token"])
	}
	if len(db.execs) != 2 {
		t.Fatalf("exec count = %d, want 2", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO uploads") {
		t.Fatalf("first exec should create upload: %s", db.execs[0].sql)
	}
	if !strings.Contains(db.execs[1].sql, "INSERT INTO object_metadata") {
		t.Fatalf("second exec should create object metadata: %s", db.execs[1].sql)
	}
}

func TestCreateUploadRejectsUnsupportedContentTypeAndOversize(t *testing.T) {
	repo := NewRepository(&fakeDB{})
	base := UploadOptions{
		TenantID:            "tenant_1",
		UserID:              "user_1",
		AllowedContentTypes: []string{"image/png"},
		MaxBytes:            10,
		URLTTL:              time.Minute,
		Input: UploadCreate{
			Filename:    "file.exe",
			ContentType: "application/octet-stream",
			ByteSize:    8,
		},
		SignURL: func(_ string, _ string, _ time.Duration) (string, time.Time) {
			return "/signed", time.Now().UTC()
		},
	}

	if _, err := repo.CreateUpload(context.Background(), base); !errors.Is(err, ErrValidation) {
		t.Fatalf("CreateUpload() error = %v, want validation for content type", err)
	}
	base.Input.ContentType = "image/png"
	base.Input.ByteSize = 11
	if _, err := repo.CreateUpload(context.Background(), base); !errors.Is(err, ErrValidation) {
		t.Fatalf("CreateUpload() error = %v, want validation for oversize upload", err)
	}
}

func TestEnforceSafetyRecordsBlockDecisionForActiveRule(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"rule_1",
			nil,
			"export_block",
			"1",
			"ip_brand",
			"critical",
			"block",
			[]byte(`["brief","provider_request","provider_response","qa","export"]`),
			"active",
			now,
		}},
	}}}
	repo := NewRepository(db)

	decision, err := repo.EnforceSafety(context.Background(), "tenant_1", "export", "export_1", "export")
	if err != nil {
		t.Fatalf("EnforceSafety() error = %v", err)
	}
	if decision.Decision != "block" || decision.RuleID == nil || *decision.RuleID != "rule_1" {
		t.Fatalf("decision = %#v", decision)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO safety_decisions") {
		t.Fatalf("safety decision insert not recorded: %#v", db.execs)
	}
}

type fakeDB struct {
	execs     []execCall
	queryRows []rowSet
	queryErr  error
}

type execCall struct {
	sql  string
	args []any
}

func (f *fakeDB) Exec(_ context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	f.execs = append(f.execs, execCall{sql: sql, args: arguments})
	return pgconn.CommandTag{}, nil
}

func (f *fakeDB) Query(_ context.Context, _ string, _ ...any) (store.Rows, error) {
	if f.queryErr != nil {
		return nil, f.queryErr
	}
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
	rows   [][]any
	index  int
	closed bool
	err    error
}

func (r *fakeRows) Close() {
	r.closed = true
}

func (r *fakeRows) Err() error {
	return r.err
}

func (r *fakeRows) Next() bool {
	if r.index >= len(r.rows) {
		return false
	}
	r.index++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	row := r.rows[r.index-1]
	for i := range dest {
		assign(dest[i], row[i])
	}
	return nil
}

type fakeRow struct {
	err error
}

func (r fakeRow) Scan(...any) error {
	return r.err
}

func assign(dest any, value any) {
	switch ptr := dest.(type) {
	case *string:
		*ptr = value.(string)
	case **string:
		if value == nil {
			*ptr = nil
			return
		}
		v := value.(string)
		*ptr = &v
	case *[]byte:
		*ptr = value.([]byte)
	case *time.Time:
		*ptr = value.(time.Time)
	default:
		panic("unsupported scan destination")
	}
}
