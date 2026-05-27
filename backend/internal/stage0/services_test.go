package stage0

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
)

func TestCreateSupportTicketPersistsTenantUserAndLinks(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	ticket, err := repo.CreateSupportTicket(context.Background(), "tenant_1", "user_1", SupportTicketCreate{
		ProjectID:      "project_1",
		TaskID:         "task_1",
		TraceID:        "trace_1",
		AssetID:        "asset_1",
		Category:       "export_failure",
		Body:           "The export failed.",
		LinkedExportID: "export_1",
		QuotaBucketID:  "quota_1",
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
	if ticket.TaskID == nil || *ticket.TaskID != "task_1" {
		t.Fatalf("ticket TaskID = %v", ticket.TaskID)
	}
	if ticket.TraceID == nil || *ticket.TraceID != "trace_1" {
		t.Fatalf("ticket TraceID = %v", ticket.TraceID)
	}
	if ticket.AssetID == nil || *ticket.AssetID != "asset_1" {
		t.Fatalf("ticket AssetID = %v", ticket.AssetID)
	}
	if ticket.QuotaBucketID == nil || *ticket.QuotaBucketID != "quota_1" {
		t.Fatalf("ticket QuotaBucketID = %v", ticket.QuotaBucketID)
	}
	if ticket.Metadata["api_key"] != "[REDACTED]" {
		t.Fatalf("ticket api_key metadata = %v, want redacted", ticket.Metadata["api_key"])
	}
	if len(db.execs) != 2 || !strings.Contains(db.execs[0].sql, "INSERT INTO support_tickets") {
		t.Fatalf("support ticket insert not recorded: %#v", db.execs)
	}
	for _, column := range []string{"task_id", "trace_id", "asset_id", "linked_export_id", "quota_bucket_id"} {
		if !strings.Contains(db.execs[0].sql, column) {
			t.Fatalf("support ticket insert missing evidence column %s: %s", column, db.execs[0].sql)
		}
	}
	if !strings.Contains(db.execs[1].sql, "INSERT INTO analytics_events") {
		t.Fatalf("support ticket analytics event not recorded: %s", db.execs[1].sql)
	}
}

func TestCreateSupportTicketRequiresRev2EvidenceLinks(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	_, err := repo.CreateSupportTicket(context.Background(), "tenant_1", "user_1", SupportTicketCreate{
		ProjectID:      "project_1",
		TaskID:         "task_1",
		TraceID:        "trace_1",
		AssetID:        "asset_1",
		Category:       "export_failure",
		Body:           "The export failed.",
		LinkedExportID: "export_1",
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("CreateSupportTicket() error = %v, want ErrValidation", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("invalid support ticket should not write rows: %#v", db.execs)
	}
}

func TestListSupportTicketsReturnsEvidenceLinks(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"support_1",
			"tenant_1",
			"user_1",
			"project_1",
			"task_1",
			"trace_1",
			"asset_1",
			"export_failure",
			"open",
			"The export failed.",
			"export_1",
			"quota_1",
			[]byte(`{"source":"report_problem"}`),
			now,
			now,
		}},
	}, {
		rows: [][]any{{"crawler_doc_1"}},
	}}}
	repo := NewRepository(db)

	page, err := repo.ListSupportTickets(context.Background(), "tenant_1", "open", 50)
	if err != nil {
		t.Fatalf("ListSupportTickets() error = %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("ticket count = %d, want 1", len(page.Items))
	}
	ticket := page.Items[0]
	if ticket.TaskID == nil || *ticket.TaskID != "task_1" {
		t.Fatalf("TaskID = %v, want task_1", ticket.TaskID)
	}
	if ticket.TraceID == nil || *ticket.TraceID != "trace_1" {
		t.Fatalf("TraceID = %v, want trace_1", ticket.TraceID)
	}
	if ticket.AssetID == nil || *ticket.AssetID != "asset_1" {
		t.Fatalf("AssetID = %v, want asset_1", ticket.AssetID)
	}
	if ticket.LinkedExportID == nil || *ticket.LinkedExportID != "export_1" {
		t.Fatalf("LinkedExportID = %v, want export_1", ticket.LinkedExportID)
	}
	if ticket.QuotaBucketID == nil || *ticket.QuotaBucketID != "quota_1" {
		t.Fatalf("QuotaBucketID = %v, want quota_1", ticket.QuotaBucketID)
	}
}

func TestListSupportTicketsRedactsStoredSecrets(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"support_1",
			"tenant_1",
			"user_1",
			"project_1",
			"task_1",
			"trace_1",
			"asset_1",
			"export_failure",
			"open",
			"provider failed with Bearer abcdefghijklmnop",
			"export_1",
			"quota_1",
			[]byte(`{"download_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","api_key":"secret"}`),
			now,
			now,
		}},
	}}}
	repo := NewRepository(db)

	page, err := repo.ListSupportTickets(context.Background(), "tenant_1", "open", 50)
	if err != nil {
		t.Fatalf("ListSupportTickets() error = %v", err)
	}
	body, err := json.Marshal(page.Items[0])
	if err != nil {
		t.Fatalf("marshal ticket: %v", err)
	}
	for _, leaked := range []string{"abcdefghijklmnop", "abcdef", "secret"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("support ticket = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), security.Redacted) {
		t.Fatalf("support ticket = %s, want redaction marker", string(body))
	}
}

func TestCreateExportBlocksWhenQAHasBlockingResult(t *testing.T) {
	db := &fakeDB{
		queryRows: []rowSet{{
			rows: [][]any{{"project_1", "user_1", "workflow_1"}},
		}, {
			rows: [][]any{{"block", "blocking"}},
		}},
	}
	repo := NewRepository(db)

	_, err := repo.CreateExport(context.Background(), "tenant_1", "user_1", "package_1", ExportCreate{Format: "zip"}, 1)
	if !errors.Is(err, ErrSafetyBlocked) {
		t.Fatalf("CreateExport() error = %v, want ErrSafetyBlocked", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("blocked export should not write rows: %#v", db.execs)
	}
}

func TestCreateExportCreatesTaskAndExport(t *testing.T) {
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{"project_1", "user_1", "workflow_1"}},
	}, {}}}
	repo := NewRepository(db)

	task, err := repo.CreateExport(context.Background(), "tenant_1", "user_1", "package_1", ExportCreate{Format: "zip"}, 7)
	if err != nil {
		t.Fatalf("CreateExport() error = %v", err)
	}
	if task.SchemaVersion != 7 || task.Type != "package_export_builder" {
		t.Fatalf("task = %#v", task)
	}
	if task.Metadata["project_id"] != "project_1" || task.Metadata["workflow_id"] != "workflow_1" {
		t.Fatalf("task metadata = %#v, want project/workflow analytics context", task.Metadata)
	}
	if len(db.execs) != 9 {
		t.Fatalf("exec count = %d, want 9", len(db.execs))
	}
	assertSafetyDecision(t, db.execs[0], SafetyPointBrief, "project")
	assertSafetyAnalytics(t, db.execs[1])
	assertSafetyDecision(t, db.execs[2], SafetyPointQA, "package")
	assertSafetyAnalytics(t, db.execs[3])
	assertSafetyDecision(t, db.execs[4], SafetyPointExport, "export")
	assertSafetyAnalytics(t, db.execs[5])
	if !strings.Contains(db.execs[6].sql, "INSERT INTO agent_tasks") {
		t.Fatalf("seventh exec should create task: %s", db.execs[6].sql)
	}
	if !strings.Contains(db.execs[7].sql, "INSERT INTO exports") || !strings.Contains(db.execs[7].sql, "project_id") {
		t.Fatalf("eighth exec should create export: %s", db.execs[7].sql)
	}
	if !strings.Contains(db.execs[8].sql, "INSERT INTO analytics_events") {
		t.Fatalf("ninth exec should create export analytics event: %s", db.execs[8].sql)
	}
}

func TestCreateExportBlocksWhenExportSafetyRuleBlocks(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{"project_1", "user_1", "workflow_1"}},
	}, {}, {}, {}, {
		rows: [][]any{{
			"rule_1",
			nil,
			"export_block",
			"1",
			"exports",
			"critical",
			"block",
			[]byte(`["export"]`),
			"active",
			now,
		}},
	}}}
	repo := NewRepository(db)

	_, err := repo.CreateExport(context.Background(), "tenant_1", "user_1", "package_1", ExportCreate{Format: "zip"}, 7)
	if !errors.Is(err, ErrSafetyBlocked) {
		t.Fatalf("CreateExport() error = %v, want ErrSafetyBlocked", err)
	}
	if len(db.execs) != 6 {
		t.Fatalf("exec count = %d, want brief/QA/export safety decisions and analytics only", len(db.execs))
	}
	assertSafetyDecision(t, db.execs[0], SafetyPointBrief, "project")
	assertSafetyDecision(t, db.execs[2], SafetyPointQA, "package")
	assertSafetyDecision(t, db.execs[4], SafetyPointExport, "export")
	if db.execs[4].args[6] != "block" {
		t.Fatalf("blocking export safety decision not recorded: %#v", db.execs[4])
	}
	for _, call := range db.execs {
		if strings.Contains(call.sql, "INSERT INTO agent_tasks") {
			t.Fatalf("blocked export should not create task: %#v", db.execs)
		}
	}
}

func TestRunRuntimeSafetyPolicyCoversAllRev2RuntimePoints(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	result, err := repo.RunRuntimeSafetyPolicy(context.Background(), RuntimeSafetyPolicyInput{
		TenantID:        "tenant_1",
		ProjectID:       "project_1",
		TaskID:          "task_1",
		QASubjectType:   "asset",
		QASubjectID:     "asset_1",
		ExportID:        "export_1",
		IncludeProvider: true,
	})
	if err != nil {
		t.Fatalf("RunRuntimeSafetyPolicy() error = %v", err)
	}
	if len(result.Decisions) != 5 {
		t.Fatalf("decision count = %d, want 5", len(result.Decisions))
	}
	want := []struct {
		point       string
		subjectType string
	}{
		{SafetyPointBrief, "project"},
		{SafetyPointProviderRequest, "agent_task"},
		{SafetyPointProviderResponse, "agent_task"},
		{SafetyPointQA, "asset"},
		{SafetyPointExport, "export"},
	}
	for i, expected := range want {
		if result.Decisions[i].EnforcementPoint != expected.point || result.Decisions[i].SubjectType != expected.subjectType {
			t.Fatalf("decision[%d] = %#v, want %s/%s", i, result.Decisions[i], expected.point, expected.subjectType)
		}
		assertSafetyDecision(t, db.execs[i*2], expected.point, expected.subjectType)
		assertSafetyAnalytics(t, db.execs[i*2+1])
	}
}

func TestRunRuntimeSafetyPolicyRequiresAtLeastOneSubject(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	_, err := repo.RunRuntimeSafetyPolicy(context.Background(), RuntimeSafetyPolicyInput{TenantID: "tenant_1"})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("RunRuntimeSafetyPolicy() error = %v, want ErrValidation", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("blocked export should not create task: %#v", db.execs)
	}
}

func TestCreateExportRequiresTenantScopedPackage(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	_, err := repo.CreateExport(context.Background(), "tenant_1", "user_1", "package_cross_tenant", ExportCreate{Format: "zip"}, 7)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("CreateExport() error = %v, want ErrNotFound", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("cross-tenant package should not write rows: %#v", db.execs)
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
		MalwareScanner: security.PlaceholderMalwareScanner{
			Provider: "stage0-test",
			Now: func() time.Time {
				return time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
			},
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
	scanMetadata, ok := upload.Metadata["malware_scan"].(map[string]any)
	if !ok {
		t.Fatalf("upload metadata missing malware_scan result: %#v", upload.Metadata)
	}
	if scanMetadata["status"] != string(security.MalwareScanStatusUnavailable) || scanMetadata["provider"] != "stage0-test" {
		t.Fatalf("malware scan metadata = %#v, want unavailable stage0-test", scanMetadata)
	}
	if scanMetadata["definition"] != "placeholder-v1" {
		t.Fatalf("malware scan definition = %#v, want placeholder-v1", scanMetadata["definition"])
	}
	if len(db.execs) != 3 {
		t.Fatalf("exec count = %d, want 3", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO uploads") {
		t.Fatalf("first exec should create upload: %s", db.execs[0].sql)
	}
	if !strings.Contains(db.execs[1].sql, "INSERT INTO object_metadata") {
		t.Fatalf("second exec should create object metadata: %s", db.execs[1].sql)
	}
	if !strings.Contains(db.execs[1].sql, "project_id, owner_id, asset_type") {
		t.Fatalf("object metadata insert missing ownership fields: %s", db.execs[1].sql)
	}
	objectMetadataJSON, ok := db.execs[1].args[12].([]byte)
	if !ok {
		t.Fatalf("object metadata arg type = %T, want []byte", db.execs[1].args[12])
	}
	if !strings.Contains(string(objectMetadataJSON), `"malware_scan"`) || strings.Contains(string(objectMetadataJSON), "secret") {
		t.Fatalf("object metadata JSON = %s, want scan result and redacted secrets", string(objectMetadataJSON))
	}
	if !strings.Contains(db.execs[2].sql, "INSERT INTO analytics_events") {
		t.Fatalf("upload analytics event not recorded: %s", db.execs[2].sql)
	}
}

func TestCreateUploadBlocksSuspiciousMalwareScan(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)
	signed := false

	_, err := repo.CreateUpload(context.Background(), UploadOptions{
		TenantID:            "tenant_1",
		UserID:              "user_1",
		AllowedContentTypes: []string{"image/png"},
		MaxBytes:            1024,
		URLTTL:              5 * time.Minute,
		Input: UploadCreate{
			Filename:    "Logo.png",
			ContentType: "image/png",
			ByteSize:    512,
			Metadata:    map[string]any{"stage0_force_malware_status": "suspicious", "api_key": "secret"},
		},
		SignURL: func(_ string, objectKey string, _ time.Duration) (string, time.Time) {
			signed = true
			return "/signed/" + objectKey, time.Now().UTC().Add(5 * time.Minute)
		},
		MalwareScanner: security.PlaceholderMalwareScanner{Provider: "stage0-test"},
	})
	if !errors.Is(err, ErrMalwareBlocked) {
		t.Fatalf("CreateUpload() error = %v, want ErrMalwareBlocked", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("suspicious upload should not write rows: %#v", db.execs)
	}
	if signed {
		t.Fatal("suspicious upload should not issue a signed upload URL")
	}
}

func TestCreateUploadRedactsMalwareScannerBoundary(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)
	scanner := captureScanner{
		result: security.MalwareScanResult{
			Status:    security.MalwareScanStatusClean,
			Provider:  "scanner hf_abcdefghijklmnopqrstuvwxyz123456",
			Signature: "sig sk-ant-abcdefghijklmnopqrstuvwxyz123456",
			Rationale: "looked up with Bearer abcdefghijklmnop",
			Metadata: map[string]string{
				"api_key": "secret",
				"note":    "https://storage.local/file.zip?X-Amz-Signature=abcdef",
			},
		},
	}

	upload, err := repo.CreateUpload(context.Background(), UploadOptions{
		TenantID:            "tenant_1",
		UserID:              "user_1",
		AllowedContentTypes: []string{"image/png"},
		MaxBytes:            1024,
		URLTTL:              5 * time.Minute,
		Input: UploadCreate{
			Filename:    "Logo.png",
			ContentType: "image/png",
			ByteSize:    512,
			Metadata: map[string]any{
				"slot":    "reference",
				"api_key": "secret",
			},
		},
		SignURL: func(_ string, objectKey string, _ time.Duration) (string, time.Time) {
			return "/signed/" + objectKey, time.Now().UTC().Add(5 * time.Minute)
		},
		MalwareScanner: &scanner,
	})
	if err != nil {
		t.Fatalf("CreateUpload() error = %v", err)
	}
	if scanner.target.Metadata["api_key"] != security.Redacted {
		t.Fatalf("scanner target metadata = %#v, want redacted external scanner input", scanner.target.Metadata)
	}
	body, err := json.Marshal(upload.Metadata["malware_scan"])
	if err != nil {
		t.Fatalf("marshal malware metadata: %v", err)
	}
	for _, leaked := range []string{
		"hf_abcdefghijklmnopqrstuvwxyz123456",
		"sk-ant-abcdefghijklmnopqrstuvwxyz123456",
		"abcdefghijklmnop",
		"secret",
		"abcdef",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("malware metadata = %s, leaked %s", string(body), leaked)
		}
	}
}

func TestCreateUploadRejectsUnsupportedMalwareStatus(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)
	signed := false

	_, err := repo.CreateUpload(context.Background(), UploadOptions{
		TenantID:            "tenant_1",
		UserID:              "user_1",
		AllowedContentTypes: []string{"image/png"},
		MaxBytes:            1024,
		URLTTL:              5 * time.Minute,
		Input: UploadCreate{
			Filename:    "Logo.png",
			ContentType: "image/png",
			ByteSize:    512,
		},
		SignURL: func(_ string, objectKey string, _ time.Duration) (string, time.Time) {
			signed = true
			return "/signed/" + objectKey, time.Now().UTC().Add(5 * time.Minute)
		},
		MalwareScanner: &captureScanner{result: security.MalwareScanResult{Status: "infected"}},
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("CreateUpload() error = %v, want ErrValidation", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("unsupported malware status should not write rows: %#v", db.execs)
	}
	if signed {
		t.Fatal("unsupported malware status should not issue a signed upload URL")
	}
}

func TestCreateUploadFailClosedBlocksUnavailableMalwareScan(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)
	signed := false

	_, err := repo.CreateUpload(context.Background(), UploadOptions{
		TenantID:            "tenant_1",
		UserID:              "user_1",
		AllowedContentTypes: []string{"image/png"},
		MaxBytes:            1024,
		URLTTL:              5 * time.Minute,
		Input: UploadCreate{
			Filename:    "Logo.png",
			ContentType: "image/png",
			ByteSize:    512,
		},
		SignURL: func(_ string, objectKey string, _ time.Duration) (string, time.Time) {
			signed = true
			return "/signed/" + objectKey, time.Now().UTC().Add(5 * time.Minute)
		},
		MalwareScanner:    security.PlaceholderMalwareScanner{Provider: "stage0-test"},
		MalwareFailClosed: true,
	})
	if !errors.Is(err, ErrMalwareBlocked) {
		t.Fatalf("CreateUpload() error = %v, want ErrMalwareBlocked", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("fail-closed unavailable scan should not write rows: %#v", db.execs)
	}
	if signed {
		t.Fatal("fail-closed unavailable scan should not issue a signed upload URL")
	}
}

func TestCreateUploadFailClosedBlocksMalwareScannerError(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)
	signed := false

	_, err := repo.CreateUpload(context.Background(), UploadOptions{
		TenantID:            "tenant_1",
		UserID:              "user_1",
		AllowedContentTypes: []string{"image/png"},
		MaxBytes:            1024,
		URLTTL:              5 * time.Minute,
		Input: UploadCreate{
			Filename:    "Logo.png",
			ContentType: "image/png",
			ByteSize:    512,
		},
		SignURL: func(_ string, objectKey string, _ time.Duration) (string, time.Time) {
			signed = true
			return "/signed/" + objectKey, time.Now().UTC().Add(5 * time.Minute)
		},
		MalwareScanner:    &captureScanner{err: errors.New("scanner failed with Bearer abcdefghijklmnop")},
		MalwareFailClosed: true,
	})
	if !errors.Is(err, ErrMalwareBlocked) {
		t.Fatalf("CreateUpload() error = %v, want ErrMalwareBlocked", err)
	}
	if strings.Contains(err.Error(), "abcdefghijklmnop") {
		t.Fatalf("CreateUpload() error leaked scanner secret: %v", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("fail-closed scanner error should not write rows: %#v", db.execs)
	}
	if signed {
		t.Fatal("fail-closed scanner error should not issue a signed upload URL")
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

func TestRecordExportArtifactPersistsObjectMetadataAndDeliveryDescriptors(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{
		queryRows: []rowSet{{}, {}, {}, {
			rows: [][]any{{
				"export_1",
				"tenant_1",
				"package_1",
				"project_1",
				nil,
				"zip",
				"ready",
				"passed",
				"object_1",
				[]byte(`{"package_id":"package_1","project_id":"project_1"}`),
				[]byte(`{"ppt_ready":{"status":"placeholder"},"figma_ready":{"status":"ready","schema":"zenart.figma_layout_spec.v1","layout":{"schema":"zenart.figma_layout_spec.v1"}},"thumbnail":{"status":"ready"}}`),
				nil,
				now,
				now,
				[]byte(`{"id":"object_1","tenant_id":"tenant_1","project_id":"project_1","owner_id":"user_1","asset_type":"export","bucket":"exports-test","object_key":"tenants/tenant_1/exports/export_1.zip","content_type":"application/zip","byte_size":12,"checksum":"sha256:abc","provider":"local","retention_state":"active","metadata":{},"created_at":"2026-05-26T00:00:00Z"}`),
			}},
		}},
	}
	repo := NewRepository(db)

	export, err := repo.RecordExportArtifact(context.Background(), ExportArtifact{
		ExportID:        "export_1",
		TenantID:        "tenant_1",
		ProjectID:       "project_1",
		OwnerID:         "user_1",
		Bucket:          "exports-test",
		ObjectKey:       "exports/export_1.zip",
		Format:          "zip",
		ByteSize:        12,
		Checksum:        "sha256:abc",
		StorageProvider: "local",
		Manifest: map[string]any{
			"package_id": "package_1",
			"project_id": "project_1",
			"items": []any{
				map[string]any{"id": "asset_1", "title": "Hero asset", "type": "candidate"},
			},
		},
		QAReport:   map[string]any{"status": "passed"},
		Provenance: map[string]any{"provider": "dev"},
	})
	if err != nil {
		t.Fatalf("RecordExportArtifact() error = %v", err)
	}
	if export.Object == nil || export.Object.AssetType != "export" {
		t.Fatalf("export object metadata = %#v, want export metadata", export.Object)
	}
	if export.Delivery["ppt_ready"] == nil || export.Delivery["figma_ready"] == nil {
		t.Fatalf("delivery metadata missing PPT/Figma descriptors: %#v", export.Delivery)
	}
	figmaReady := export.Delivery["figma_ready"].(map[string]any)
	if figmaReady["status"] != "ready" || figmaReady["schema"] != "zenart.figma_layout_spec.v1" {
		t.Fatalf("figma ready descriptor = %#v, want ready v1 layout spec", figmaReady)
	}
	if export.Delivery["thumbnail"] == nil {
		t.Fatalf("delivery metadata missing thumbnail descriptor: %#v", export.Delivery)
	}
	if len(db.execs) != 10 {
		t.Fatalf("exec count = %d, want runtime safety decisions, object metadata, export update, and analytics event", len(db.execs))
	}
	assertSafetyDecision(t, db.execs[0], SafetyPointBrief, "project")
	assertSafetyAnalytics(t, db.execs[1])
	assertSafetyDecision(t, db.execs[2], SafetyPointQA, "export")
	assertSafetyAnalytics(t, db.execs[3])
	assertSafetyDecision(t, db.execs[4], SafetyPointExport, "export")
	assertSafetyAnalytics(t, db.execs[5])
	if !strings.Contains(db.execs[6].sql, "INSERT INTO object_metadata") || !strings.Contains(db.execs[6].sql, "derived_from_object_id") {
		t.Fatalf("seventh exec missing rich object metadata insert: %s", db.execs[6].sql)
	}
	if objectKey, ok := db.execs[6].args[5].(string); !ok || objectKey != "tenants/tenant_1/exports/export_1.zip" {
		t.Fatalf("object key arg = %#v, want tenant-scoped export key", db.execs[6].args[5])
	}
	if !strings.Contains(db.execs[7].sql, "'thumbnail'") {
		t.Fatalf("eighth exec should create thumbnail metadata: %s", db.execs[7].sql)
	}
	if objectKey, ok := db.execs[7].args[5].(string); !ok || objectKey != "tenants/tenant_1/thumbnails/export_1.zip.svg" {
		t.Fatalf("thumbnail key arg = %#v, want tenant-scoped thumbnail key", db.execs[7].args[5])
	}
	if !strings.Contains(db.execs[8].sql, "delivery_metadata") {
		t.Fatalf("ninth exec should update export delivery metadata: %s", db.execs[8].sql)
	}
	if !strings.Contains(db.execs[9].sql, "INSERT INTO analytics_events") {
		t.Fatalf("tenth exec should create export completion analytics event: %s", db.execs[9].sql)
	}
}

func TestRecordExportArtifactBlocksWhenExportSafetyRuleBlocks(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{}, {}, {
		rows: [][]any{{
			"rule_1",
			nil,
			"export_block",
			"1",
			"exports",
			"critical",
			"block",
			[]byte(`["export"]`),
			"active",
			now,
		}},
	}}}
	repo := NewRepository(db)

	_, err := repo.RecordExportArtifact(context.Background(), ExportArtifact{
		ExportID:  "export_1",
		TenantID:  "tenant_1",
		ProjectID: "project_1",
		ObjectKey: "exports/export_1.zip",
		Format:    "zip",
	})
	if !errors.Is(err, ErrSafetyBlocked) {
		t.Fatalf("RecordExportArtifact() error = %v, want ErrSafetyBlocked", err)
	}
	if len(db.execs) != 6 {
		t.Fatalf("exec count = %d, want runtime safety decisions and analytics only", len(db.execs))
	}
	assertSafetyDecision(t, db.execs[0], SafetyPointBrief, "project")
	assertSafetyDecision(t, db.execs[2], SafetyPointQA, "export")
	assertSafetyDecision(t, db.execs[4], SafetyPointExport, "export")
	if db.execs[4].args[6] != "block" {
		t.Fatalf("blocking safety decision not recorded: %#v", db.execs[4])
	}
}

func TestGetExportRedactsStoredSecretMetadata(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryRows: []rowSet{{
			rows: [][]any{{
				"export_1",
				"tenant_1",
				"package_1",
				"project_1",
				nil,
				"zip",
				"failed",
				"failed",
				"object_1",
				[]byte(`{"package_id":"package_1","provider_key":"sk-ant-abcdefghijklmnopqrstuvwxyz123456"}`),
				[]byte(`{"download_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","ppt_ready":{"status":"ready"}}`),
				[]byte(`{"message":"provider failed with Bearer abcdefghijklmnop"}`),
				now,
				now,
				[]byte(`{"id":"object_1","tenant_id":"tenant_1","project_id":"project_1","owner_id":"user_1","asset_type":"export","bucket":"exports-test","object_key":"tenants/tenant_1/exports/export_1.zip","content_type":"application/zip","byte_size":12,"checksum":"sha256:abc","provider":"local","retention_state":"active","metadata":{"signed_url":"https://storage.local/export.zip?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=abcdef"},"created_at":"2026-05-26T00:00:00Z"}`),
			}},
		}},
	}
	repo := NewRepository(db)

	export, err := repo.GetExport(context.Background(), "tenant_1", "export_1")
	if err != nil {
		t.Fatalf("GetExport() error = %v", err)
	}
	body, err := json.Marshal(export)
	if err != nil {
		t.Fatalf("marshal export: %v", err)
	}
	for _, leaked := range []string{
		"sk-ant-abcdefghijklmnopqrstuvwxyz123456",
		"abcdef",
		"abcdefghijklmnop",
		"AKIAIOSFODNN7EXAMPLE",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("export = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), security.Redacted) {
		t.Fatalf("export = %s, want redaction marker", string(body))
	}
}

func TestServiceRecordExportArtifactGeneratesAndStoresThumbnail(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{
		queryRows: []rowSet{{}, {}, {}, {
			rows: [][]any{{
				"export_1",
				"tenant_1",
				"package_1",
				"project_1",
				nil,
				"zip",
				"ready",
				"passed",
				"object_1",
				[]byte(`{"package_id":"package_1","project_id":"project_1"}`),
				[]byte(`{"thumbnail":{"status":"ready"},"figma_ready":{"status":"ready","layout":{"schema":"zenart.figma_layout_spec.v1"}}}`),
				nil,
				now,
				now,
				[]byte(`{"id":"object_1","tenant_id":"tenant_1","project_id":"project_1","owner_id":"user_1","asset_type":"export","bucket":"exports-test","object_key":"tenants/tenant_1/exports/export_1.zip","content_type":"application/zip","byte_size":12,"checksum":"sha256:abc","provider":"local","retention_state":"active","metadata":{},"created_at":"2026-05-26T00:00:00Z"}`),
			}},
		}},
	}
	objects, err := objectstore.NewLocalStore(t.TempDir(), "exports-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	service := NewService(NewRepository(db), objects)

	_, err = service.RecordExportArtifact(context.Background(), ExportArtifact{
		ExportID:        "export_1",
		TenantID:        "tenant_1",
		ProjectID:       "project_1",
		OwnerID:         "user_1",
		Bucket:          "exports-test",
		ObjectKey:       "exports/export_1.zip",
		Format:          "zip",
		ByteSize:        12,
		Checksum:        "sha256:abc",
		StorageProvider: "local",
		Manifest: map[string]any{
			"package_id": "package_1",
			"project_id": "project_1",
			"items": []any{
				map[string]any{"id": "asset_1", "title": "Hero asset", "type": "candidate"},
			},
		},
		QAReport:   map[string]any{"status": "passed"},
		Provenance: map[string]any{"provider": "dev"},
	})
	if err != nil {
		t.Fatalf("RecordExportArtifact() error = %v", err)
	}
	reader, err := objects.Get(context.Background(), "tenant_1", "thumbnails/export_1.zip.svg")
	if err != nil {
		t.Fatalf("stored thumbnail Get() error = %v", err)
	}
	defer reader.Body.Close()
	data, err := io.ReadAll(reader.Body)
	if err != nil {
		t.Fatalf("read stored thumbnail error = %v", err)
	}
	if !strings.Contains(string(data), "<svg") || !strings.Contains(string(data), "project_1 ZIP package, 1 items") {
		t.Fatalf("stored thumbnail body = %q", string(data))
	}
}

func TestServiceGetExportSignsPersistedObjectKey(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryRows: []rowSet{{
			rows: [][]any{{
				"export_1",
				"tenant_1",
				"package_1",
				"project_1",
				nil,
				"zip",
				"ready",
				"passed",
				"object_1",
				[]byte(`{"package_id":"package_1"}`),
				[]byte(`{"download":{"status":"ready"}}`),
				nil,
				now,
				now,
				[]byte(`{"id":"object_1","tenant_id":"tenant_1","project_id":"project_1","owner_id":"user_1","asset_type":"export","bucket":"exports-test","object_key":"tenants/tenant_1/exports/custom-export-object.zip","content_type":"application/zip","byte_size":12,"checksum":"sha256:abc","provider":"local","retention_state":"active","metadata":{},"created_at":"2026-05-26T00:00:00Z"}`),
			}},
		}},
	}
	objects, err := objectstore.NewLocalStore(t.TempDir(), "exports-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	service := NewService(NewRepository(db), objects)

	export, err := service.GetExport(context.Background(), "tenant_1", "export_1")
	if err != nil {
		t.Fatalf("GetExport() error = %v", err)
	}
	if export.DownloadURL == "" {
		t.Fatal("DownloadURL should be signed for ready object metadata")
	}
	if !strings.Contains(export.DownloadURL, "custom-export-object.zip") {
		t.Fatalf("DownloadURL = %q, want persisted object key", export.DownloadURL)
	}
	if strings.Contains(export.DownloadURL, "exports%2Fexport_1.zip") {
		t.Fatalf("DownloadURL = %q, should not use reconstructed export id path", export.DownloadURL)
	}
}

func TestServiceGetExportDoesNotSignExpiredObject(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryRows: []rowSet{{
			rows: [][]any{{
				"export_1",
				"tenant_1",
				"package_1",
				"project_1",
				nil,
				"zip",
				"expired",
				"passed",
				"object_1",
				[]byte(`{"package_id":"package_1"}`),
				[]byte(`{"download":{"status":"expired"}}`),
				nil,
				now,
				now,
				[]byte(`{"id":"object_1","tenant_id":"tenant_1","project_id":"project_1","owner_id":"user_1","asset_type":"export","bucket":"exports-test","object_key":"tenants/tenant_1/exports/export_1.zip","content_type":"application/zip","byte_size":12,"checksum":"sha256:abc","provider":"local","retention_state":"expired","retention_until":"2026-05-25T00:00:00Z","metadata":{},"created_at":"2026-05-24T00:00:00Z"}`),
			}},
		}},
	}
	objects, err := objectstore.NewLocalStore(t.TempDir(), "exports-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	service := NewService(NewRepository(db), objects)

	export, err := service.GetExport(context.Background(), "tenant_1", "export_1")
	if err != nil {
		t.Fatalf("GetExport() error = %v", err)
	}
	if export.DownloadURL != "" {
		t.Fatalf("DownloadURL = %q, want empty for expired object metadata", export.DownloadURL)
	}
	if export.Object == nil || export.Object.Retention != "expired" || export.Object.RetentionUntil == nil {
		t.Fatalf("object retention metadata = %#v, want expired with retention_until", export.Object)
	}
}

func TestServiceGetExportSignsWithConfiguredTTL(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		queryRows: []rowSet{{
			rows: [][]any{{
				"export_1",
				"tenant_1",
				"package_1",
				"project_1",
				nil,
				"zip",
				"ready",
				"passed",
				"object_1",
				[]byte(`{"package_id":"package_1"}`),
				[]byte(`{"download":{"status":"ready"}}`),
				nil,
				now,
				now,
				[]byte(`{"id":"object_1","tenant_id":"tenant_1","project_id":"project_1","owner_id":"user_1","asset_type":"export","bucket":"exports-test","object_key":"tenants/tenant_1/exports/export_1.zip","content_type":"application/zip","byte_size":12,"checksum":"sha256:abc","provider":"local","retention_state":"active","metadata":{},"created_at":"2026-05-26T00:00:00Z"}`),
			}},
		}},
	}
	objects := &recordingObjectStore{signedURL: "https://storage.local/signed-export.zip"}
	service := NewService(NewRepository(db), objects).WithDownloadURLTTL(2 * time.Minute)

	export, err := service.GetExport(context.Background(), "tenant_1", "export_1")
	if err != nil {
		t.Fatalf("GetExport() error = %v", err)
	}
	if export.DownloadURL != objects.signedURL {
		t.Fatalf("DownloadURL = %q, want signed URL", export.DownloadURL)
	}
	if objects.signTTL != 2*time.Minute {
		t.Fatalf("SignGetURL ttl = %s, want configured 2m", objects.signTTL)
	}
	if objects.signTenantID != "tenant_1" || objects.signKey != "tenants/tenant_1/exports/export_1.zip" {
		t.Fatalf("SignGetURL tenant/key = %q/%q", objects.signTenantID, objects.signKey)
	}
}

func TestRequireDownloadableObjectEnforcesRetentionStateAndExpiry(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{"object_1"}}}}}
	repo := NewRepository(db)

	if err := repo.RequireDownloadableObject(context.Background(), "tenant_1", "exports/export_1.zip", now); err != nil {
		t.Fatalf("RequireDownloadableObject() error = %v", err)
	}
	query := db.queryRowsUsed[0]
	for _, fragment := range []string{
		"FROM object_metadata",
		"tenant_id = $1",
		"object_key = $2",
		"asset_type IN ('export', 'thumbnail')",
		"retention_state = 'active'",
		"retention_until > $3",
	} {
		if !strings.Contains(query.sql, fragment) {
			t.Fatalf("download guard query = %s, missing %s", query.sql, fragment)
		}
	}
	if query.args[0] != "tenant_1" || query.args[1] != "tenants/tenant_1/exports/export_1.zip" || query.args[2] != now {
		t.Fatalf("download guard args = %#v", query.args)
	}

	db = &fakeDB{}
	repo = NewRepository(db)
	if err := repo.RequireDownloadableObject(context.Background(), "tenant_1", "exports/expired.zip", now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("RequireDownloadableObject() error = %v, want ErrNotFound for expired/missing metadata", err)
	}
}

func TestDownloadTTLForObjectUsesConfiguredTTLAndIsCappedByRetentionUntil(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	retentionUntil := now.Add(90 * time.Second)

	if ttl := downloadTTLForObject(ObjectMetadata{RetentionUntil: &retentionUntil}, now, 5*time.Minute); ttl != 90*time.Second {
		t.Fatalf("downloadTTLForObject() = %s, want retention-limited 90s", ttl)
	}
	retentionUntil = now.Add(30 * time.Minute)
	if ttl := downloadTTLForObject(ObjectMetadata{RetentionUntil: &retentionUntil}, now, 5*time.Minute); ttl != 5*time.Minute {
		t.Fatalf("downloadTTLForObject() = %s, want configured 5m cap", ttl)
	}
	if ttl := downloadTTLForObject(ObjectMetadata{}, now, 0); ttl != 10*time.Minute {
		t.Fatalf("downloadTTLForObject() = %s, want default 10m fallback", ttl)
	}
}

func TestCleanupExpiredExportsAndOrphanedObjects(t *testing.T) {
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 2"),
			pgconn.NewCommandTag("UPDATE 3"),
		},
	}
	repo := NewRepository(db)
	cleanupCalled := false

	result, err := repo.CleanupExpiredExportsAndOrphanedObjects(context.Background(), time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC), func(_ context.Context, _ time.Time) (int, error) {
		cleanupCalled = true
		return 4, nil
	})
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjects() error = %v", err)
	}
	if !cleanupCalled {
		t.Fatal("object cleanup callback was not called")
	}
	if result.ExpiredExports != 2 || result.OrphanedObjects != 3 || result.DeletedObjects != 4 {
		t.Fatalf("cleanup result = %#v", result)
	}
	if len(db.execs) != 3 {
		t.Fatalf("exec count = %d, want 3", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "retention_until") || !strings.Contains(db.execs[0].sql, "status = 'expired'") {
		t.Fatalf("expired export cleanup SQL missing retention/status: %s", db.execs[0].sql)
	}
	if !strings.Contains(db.execs[0].sql, "expired_objects") || !strings.Contains(db.execs[0].sql, "retention_state = 'expired'") || !strings.Contains(db.execs[0].sql, "retention_until <= $1") {
		t.Fatalf("expired export cleanup SQL should mark expired object metadata: %s", db.execs[0].sql)
	}
	if !strings.Contains(db.execs[0].sql, "expired_sources") || !strings.Contains(db.execs[0].sql, "o.derived_from_object_id = source.id") {
		t.Fatalf("expired export cleanup SQL should mark derived thumbnail metadata expired: %s", db.execs[0].sql)
	}
	if !strings.Contains(db.execs[1].sql, "retention_state = 'orphaned'") || !strings.Contains(db.execs[1].sql, "updated_at = $1") {
		t.Fatalf("orphan cleanup SQL missing orphaned retention state: %s", db.execs[1].sql)
	}
	if !strings.Contains(db.execs[1].sql, "orphaned_sources") || !strings.Contains(db.execs[1].sql, "o.derived_from_object_id = source.id") {
		t.Fatalf("orphan cleanup SQL should cascade orphaned state to derived thumbnail metadata: %s", db.execs[1].sql)
	}
	if !strings.Contains(db.execs[2].sql, "INSERT INTO analytics_events") || !strings.Contains(db.execs[2].sql, "'export_expired'") || !strings.Contains(db.execs[2].sql, "'object_orphaned'") {
		t.Fatalf("cleanup analytics SQL missing export/object lifecycle events: %s", db.execs[2].sql)
	}
}

func TestListCleanupObjectsSelectsExpiredAndOrphanedObjects(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"object_1",
			"tenant_1",
			"tenants/tenant_1/exports/export_1.zip",
		}, {
			"object_2",
			"tenant_1",
			"tenants/tenant_1/thumbnails/export_1.zip.svg",
		}},
	}}}
	repo := NewRepository(db)

	objects, err := repo.ListCleanupObjects(context.Background(), now, 25)
	if err != nil {
		t.Fatalf("ListCleanupObjects() error = %v", err)
	}
	if len(objects) != 2 {
		t.Fatalf("cleanup object count = %d, want 2", len(objects))
	}
	if objects[0].TenantID != "tenant_1" || objects[0].Key != "tenants/tenant_1/exports/export_1.zip" {
		t.Fatalf("cleanup object = %#v", objects[0])
	}
	if objects[1].TenantID != "tenant_1" || objects[1].Key != "tenants/tenant_1/thumbnails/export_1.zip.svg" {
		t.Fatalf("cleanup derived object = %#v", objects[1])
	}
	if !strings.Contains(db.queryRowsUsed[0].sql, "retention_state IN ('expired', 'orphaned')") || !strings.Contains(db.queryRowsUsed[0].sql, "LIMIT $2") {
		t.Fatalf("cleanup selection SQL missing retention/limit guard: %s", db.queryRowsUsed[0].sql)
	}
	if db.queryRowsUsed[0].args[1] != 25 {
		t.Fatalf("cleanup limit arg = %#v, want 25", db.queryRowsUsed[0].args[1])
	}
}

func TestMarkCleanupObjectsDeleted(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 2")}}
	repo := NewRepository(db)

	deleted, err := repo.MarkCleanupObjectsDeleted(context.Background(), []CleanupObject{
		{ID: "object_1", TenantID: "tenant_1", Key: "tenants/tenant_1/exports/export_1.zip"},
		{ID: "object_2", TenantID: "tenant_1", Key: "tenants/tenant_1/thumbnails/export_1.zip.svg"},
	}, now)
	if err != nil {
		t.Fatalf("MarkCleanupObjectsDeleted() error = %v", err)
	}
	if deleted != 2 {
		t.Fatalf("deleted = %d, want 2", deleted)
	}
	for _, fragment := range []string{
		"jsonb_to_recordset($1::jsonb)",
		"object_metadata.tenant_id = deleted_candidates.tenant_id",
		"object_metadata.object_key = deleted_candidates.object_key",
		"retention_state = 'deleted'",
		"deleted_at",
		"cleanup_ack_scope",
	} {
		if !strings.Contains(db.execs[0].sql, fragment) {
			t.Fatalf("mark deleted SQL missing %s: %s", fragment, db.execs[0].sql)
		}
	}
	payload, ok := db.execs[0].args[0].([]byte)
	if !ok {
		t.Fatalf("cleanup payload arg type = %T, want []byte", db.execs[0].args[0])
	}
	for _, want := range []string{`"tenant_id":"tenant_1"`, `"object_key":"tenants/tenant_1/exports/export_1.zip"`} {
		if !strings.Contains(string(payload), want) {
			t.Fatalf("cleanup payload = %s, missing %s", string(payload), want)
		}
	}
	for _, fragment := range []string{
		"INSERT INTO analytics_events",
		"'object_deleted'",
		"deleted_candidates.tenant_id = o.tenant_id",
		"deleted_candidates.object_key = o.object_key",
		"'cleanup_ack_scope'",
		"ON CONFLICT (id) DO NOTHING",
	} {
		if !strings.Contains(db.execs[1].sql, fragment) {
			t.Fatalf("mark deleted SQL missing object deletion analytics fragment %s: %s", fragment, db.execs[1].sql)
		}
	}
}

func TestServiceCleanupDeletesMarkedObjectsAndMarksRowsDeleted(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("UPDATE 2"),
		},
		queryRows: []rowSet{{
			rows: [][]any{
				{"object_1", "tenant_1", "tenants/tenant_1/exports/export_1.zip"},
				{"object_2", "tenant_1", "tenants/tenant_1/thumbnails/export_1.zip.svg"},
			},
		}},
	}
	objects, err := objectstore.NewLocalStore(t.TempDir(), "zenart-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	for _, key := range []string{"exports/export_1.zip", "thumbnails/export_1.zip.svg"} {
		if _, err := objects.Put(context.Background(), objectstore.Object{
			TenantID: "tenant_1",
			Key:      key,
		}, strings.NewReader("data")); err != nil {
			t.Fatalf("Put(%s) error = %v", key, err)
		}
	}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjects(context.Background(), now, 50)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjects() error = %v", err)
	}
	if result.ExpiredExports != 1 || result.OrphanedObjects != 1 || result.DeletedObjects != 2 {
		t.Fatalf("cleanup result = %#v, want 1/1/2", result)
	}
	if len(db.execs) != 5 {
		t.Fatalf("exec count = %d, want repository mark, orphan mark, cleanup analytics, deleted mark, deletion analytics", len(db.execs))
	}
	if !strings.Contains(db.execs[2].sql, "'export_expired'") || !strings.Contains(db.execs[2].sql, "'object_orphaned'") {
		t.Fatalf("third exec should emit cleanup lifecycle analytics: %s", db.execs[2].sql)
	}
	if !strings.Contains(db.execs[3].sql, "retention_state = 'deleted'") {
		t.Fatalf("fourth exec should mark object metadata deleted: %s", db.execs[3].sql)
	}
	if !strings.Contains(db.execs[4].sql, "'object_deleted'") {
		t.Fatalf("fifth exec should emit object deletion analytics: %s", db.execs[4].sql)
	}
}

func TestServiceCleanupMarksMissingExpiredObjectsDeleted(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("UPDATE 2"),
		},
		queryRows: []rowSet{{
			rows: [][]any{
				{"object_1", "tenant_1", "tenants/tenant_1/exports/missing.zip"},
				{"object_2", "tenant_1", "tenants/tenant_1/thumbnails/missing.zip.svg"},
			},
		}},
	}
	objects, err := objectstore.NewLocalStore(t.TempDir(), "zenart-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjects(context.Background(), now, 50)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjects() error = %v", err)
	}
	if result.DeletedObjects != 2 {
		t.Fatalf("deleted objects = %d, want metadata rows marked deleted after missing storage objects", result.DeletedObjects)
	}
	if len(db.execs) != 5 {
		t.Fatalf("exec count = %d, want repository mark, orphan mark, cleanup analytics, deleted mark, deletion analytics", len(db.execs))
	}
	if !strings.Contains(db.execs[2].sql, "'export_expired'") || !strings.Contains(db.execs[2].sql, "'object_orphaned'") {
		t.Fatalf("third exec should emit cleanup lifecycle analytics: %s", db.execs[2].sql)
	}
	if !strings.Contains(db.execs[3].sql, "retention_state = 'deleted'") {
		t.Fatalf("fourth exec should mark missing object metadata deleted: %s", db.execs[3].sql)
	}
	if !strings.Contains(db.execs[4].sql, "'object_deleted'") {
		t.Fatalf("fifth exec should emit object deletion analytics: %s", db.execs[4].sql)
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
	if len(db.execs) != 2 || !strings.Contains(db.execs[0].sql, "INSERT INTO safety_decisions") {
		t.Fatalf("safety decision insert not recorded: %#v", db.execs)
	}
	if !strings.Contains(db.execs[1].sql, "INSERT INTO analytics_events") {
		t.Fatalf("safety decision analytics event not recorded: %s", db.execs[1].sql)
	}
}

func TestEnforceSafetyRecordsWarnConfirmationAndAdminReviewDecisions(t *testing.T) {
	now := time.Now().UTC()
	for _, tc := range []struct {
		name     string
		action   string
		severity string
	}{
		{name: "warn", action: "warn", severity: "medium"},
		{name: "confirmation", action: "require_user_confirmation", severity: "high"},
		{name: "admin review", action: "require_admin_review", severity: "high"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := &fakeDB{queryRows: []rowSet{{
				rows: [][]any{{
					"rule_" + tc.action,
					nil,
					"runtime_" + tc.action,
					"1",
					"stage0",
					tc.severity,
					tc.action,
					[]byte(`["brief","provider_request","provider_response","qa","export"]`),
					"active",
					now,
				}},
			}}}
			repo := NewRepository(db)

			decision, err := repo.EnforceSafety(context.Background(), "tenant_1", "project", "project_1", SafetyPointBrief)
			if err != nil {
				t.Fatalf("EnforceSafety() error = %v", err)
			}
			if decision.Decision != tc.action || decision.RuleID == nil || *decision.RuleID != "rule_"+tc.action {
				t.Fatalf("decision = %#v, want action %s", decision, tc.action)
			}
			if len(db.execs) != 2 || !strings.Contains(db.execs[0].sql, "INSERT INTO safety_decisions") {
				t.Fatalf("safety decision insert not recorded: %#v", db.execs)
			}
		})
	}
}

func TestRequireSafetyAllowedHoldsForConfirmationAndAdminReview(t *testing.T) {
	now := time.Now().UTC()
	for _, action := range []string{"require_user_confirmation", "require_admin_review"} {
		t.Run(action, func(t *testing.T) {
			db := &fakeDB{queryRows: []rowSet{{
				rows: [][]any{{
					"rule_" + action,
					nil,
					"runtime_" + action,
					"1",
					"stage0",
					"high",
					action,
					[]byte(`["export"]`),
					"active",
					now,
				}},
			}}}
			repo := NewRepository(db)

			decision, err := repo.RequireSafetyAllowed(context.Background(), "tenant_1", "export", "export_1", SafetyPointExport)
			if !errors.Is(err, ErrSafetyReviewHold) {
				t.Fatalf("RequireSafetyAllowed() error = %v, want ErrSafetyReviewHold", err)
			}
			if decision.Decision != action {
				t.Fatalf("decision = %#v, want %s", decision, action)
			}
		})
	}
}

func TestSafetyEnforcementHelpersCoverRev2RuntimePoints(t *testing.T) {
	for name, run := range map[string]func(Repository) (SafetyDecision, error){
		SafetyPointBrief: func(repo Repository) (SafetyDecision, error) {
			return repo.EnforceBriefSafety(context.Background(), "tenant_1", "project_1")
		},
		SafetyPointProviderRequest: func(repo Repository) (SafetyDecision, error) {
			return repo.EnforceProviderRequestSafety(context.Background(), "tenant_1", "task_1")
		},
		SafetyPointProviderResponse: func(repo Repository) (SafetyDecision, error) {
			return repo.EnforceProviderResponseSafety(context.Background(), "tenant_1", "task_1")
		},
		SafetyPointQA: func(repo Repository) (SafetyDecision, error) {
			return repo.EnforceQASafety(context.Background(), "tenant_1", "asset", "asset_1")
		},
		SafetyPointExport: func(repo Repository) (SafetyDecision, error) {
			return repo.EnforceExportSafety(context.Background(), "tenant_1", "export_1")
		},
	} {
		t.Run(name, func(t *testing.T) {
			db := &fakeDB{}
			repo := NewRepository(db)
			decision, err := run(repo)
			if err != nil {
				t.Fatalf("safety helper error = %v", err)
			}
			if decision.EnforcementPoint != name || decision.Decision != "allow" {
				t.Fatalf("decision = %#v, want allow at %s", decision, name)
			}
			if len(db.execs) != 2 || !strings.Contains(db.execs[0].sql, "INSERT INTO safety_decisions") {
				t.Fatalf("safety helper did not persist decision: %#v", db.execs)
			}
		})
	}
}

func TestRecordAnalyticsEventRedactsProperties(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	err := repo.RecordAnalyticsEvent(context.Background(), AnalyticsEvent{
		ID:          "analytics_1",
		TenantID:    "tenant_1",
		UserID:      "user_1",
		ProjectID:   "project_1",
		WorkflowID:  "workflow_1",
		EventName:   "export_started",
		SubjectType: "export",
		SubjectID:   "export_1",
		Properties: map[string]any{
			"format":  "zip",
			"api_key": "secret",
		},
	})
	if err != nil {
		t.Fatalf("RecordAnalyticsEvent() error = %v", err)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO analytics_events") {
		t.Fatalf("analytics insert not recorded: %#v", db.execs)
	}
	properties, ok := db.execs[0].args[8].([]byte)
	if !ok {
		t.Fatalf("properties arg type = %T, want []byte", db.execs[0].args[8])
	}
	if !strings.Contains(string(properties), `"api_key":"[REDACTED]"`) {
		t.Fatalf("properties = %s, want redacted api_key", string(properties))
	}
}

func TestListAnalyticsEventsUsesTenantScopedFiltersAndRedactsProperties(t *testing.T) {
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{
		"analytics_1",
		"tenant_1",
		"user_1",
		"project_1",
		"workflow_1",
		"export_completed",
		"export",
		"export_1",
		[]byte(`{"format":"zip","api_key":"secret"}`),
		now,
	}}}}}
	repo := NewRepository(db)

	page, err := repo.ListAnalyticsEvents(context.Background(), AnalyticsEventFilters{
		TenantID:    "tenant_1",
		EventName:   "export_completed",
		WorkflowID:  "workflow_1",
		SubjectType: "export",
		SubjectID:   "export_1",
		Limit:       25,
	})
	if err != nil {
		t.Fatalf("ListAnalyticsEvents() error = %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != "analytics_1" {
		t.Fatalf("analytics events = %#v, want analytics_1", page.Items)
	}
	if page.Items[0].Properties["api_key"] != security.Redacted {
		t.Fatalf("analytics properties = %#v, want api_key redacted", page.Items[0].Properties)
	}
	query := db.queryRowsUsed[0]
	for _, fragment := range []string{"WHERE tenant_id = $1", "event_name =", "workflow_id =", "subject_type =", "subject_id =", "ORDER BY created_at DESC"} {
		if !strings.Contains(query.sql, fragment) {
			t.Fatalf("analytics query = %s, missing %s", query.sql, fragment)
		}
	}
	wantArgs := []any{"tenant_1", 25, "export_completed", "workflow_1", "export", "export_1"}
	if len(query.args) != len(wantArgs) {
		t.Fatalf("query args = %#v, want %#v", query.args, wantArgs)
	}
	for i, want := range wantArgs {
		if query.args[i] != want {
			t.Fatalf("query args[%d] = %#v, want %#v", i, query.args[i], want)
		}
	}
}

func TestListAnalyticsReportsUsesTenantScopedWeeklyAggregation(t *testing.T) {
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{
		"export_completion_rate",
		[]string{"export_started", "export_completed", "export_failed"},
		[]string{"tenant_id", "workflow_id", "format"},
		true,
		"weekly",
		float64(0.95),
		[]byte(`{"started":20,"completed":19,"api_key":"secret"}`),
	}}}}}
	repo := NewRepository(db)

	page, err := repo.ListAnalyticsReports(context.Background(), "tenant_1", 10, now)
	if err != nil {
		t.Fatalf("ListAnalyticsReports() error = %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].MetricName != "export_completion_rate" {
		t.Fatalf("analytics reports = %#v, want export_completion_rate", page.Items)
	}
	report := page.Items[0]
	if report.ID != "analytics_report_export_completion_rate" || report.Window != "weekly" || report.Value != 0.95 || !report.GoNoGoSignal {
		t.Fatalf("report = %#v, want computed weekly pass report", report)
	}
	if report.Dimensions["api_key"] != security.Redacted {
		t.Fatalf("report dimensions = %#v, want api_key redacted", report.Dimensions)
	}
	query := db.queryRowsUsed[0]
	if !strings.Contains(query.sql, "FROM analytics_events") || !strings.Contains(query.sql, "WHERE tenant_id = $1") {
		t.Fatalf("analytics reports query missing tenant scoped event aggregation: %s", query.sql)
	}
	for _, fragment := range []string{
		"workflow_started",
		"candidate_set_created",
		"four_candidates_ready",
		"direction_selected",
		"package_item_added",
		"first_prompt_to_four_candidates",
		"selection_rate",
		"package_export_completion",
		"export_object_cleanup",
		"export_expired",
		"object_orphaned",
		"object_deleted",
	} {
		if !strings.Contains(query.sql, fragment) {
			t.Fatalf("analytics reports query missing core workflow event/report %q: %s", fragment, query.sql)
		}
	}
	if query.args[0] != "tenant_1" || query.args[2] != 10 {
		t.Fatalf("query args = %#v, want tenant_1 weekly window limit 10", query.args)
	}
	if since, ok := query.args[1].(time.Time); !ok || !since.Equal(now.AddDate(0, 0, -7)) {
		t.Fatalf("weekly window arg = %#v, want %s", query.args[1], now.AddDate(0, 0, -7))
	}
}

func TestListCrawlerSourcesUsesTenantScopedFilters(t *testing.T) {
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	tenantID := "tenant_1"
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{
		"crawler_source_1",
		&tenantID,
		"Tenant Source",
		"https://example.com/docs",
		"approved",
		[]byte(`{"license":"permissive","owner":"Example"}`),
		[]byte(`{"robots":"allowed"}`),
		now,
		now,
	}}}}}
	repo := NewRepository(db)

	page, err := repo.ListCrawlerSources(context.Background(), "tenant_1", "approved", 25)
	if err != nil {
		t.Fatalf("ListCrawlerSources() error = %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != "crawler_source_1" {
		t.Fatalf("crawler sources = %#v, want crawler_source_1", page.Items)
	}
	query := db.queryRowsUsed[0]
	if !strings.Contains(query.sql, "(tenant_id IS NULL OR tenant_id = $1)") || !strings.Contains(query.sql, "approval_status = $3") || !strings.Contains(query.sql, "LIMIT $2") {
		t.Fatalf("crawler source query missing tenant/status/limit guard: %s", query.sql)
	}
	wantArgs := []any{"tenant_1", 25, "approved"}
	if len(query.args) != len(wantArgs) {
		t.Fatalf("query args = %#v, want %#v", query.args, wantArgs)
	}
	for i, want := range wantArgs {
		if query.args[i] != want {
			t.Fatalf("query args[%d] = %#v, want %#v", i, query.args[i], want)
		}
	}
}

func TestListCrawlerSourcesRedactsStoredURLAndMetadataSecrets(t *testing.T) {
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	tenantID := "tenant_1"
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{
		"crawler_source_1",
		&tenantID,
		"Tenant Source",
		"https://user:pass@example.com/docs?token=secret-token",
		"approved",
		[]byte(`{"license":"permissive","owner":"Example","api_key":"secret"}`),
		[]byte(`{"robots":"allowed","signed_url":"https://storage.local/raw.html?X-Amz-Signature=abcdef"}`),
		now,
		now,
	}}}}}
	repo := NewRepository(db)

	page, err := repo.ListCrawlerSources(context.Background(), "tenant_1", "approved", 25)
	if err != nil {
		t.Fatalf("ListCrawlerSources() error = %v", err)
	}
	body, err := json.Marshal(page.Items[0])
	if err != nil {
		t.Fatalf("marshal crawler source: %v", err)
	}
	for _, leaked := range []string{"user:pass", "secret-token", "secret", "abcdef"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("crawler source = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), security.Redacted) {
		t.Fatalf("crawler source = %s, want redaction marker", string(body))
	}
}

func TestListCrawlerFindingsUsesTenantScopedFilters(t *testing.T) {
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	tenantID := "tenant_1"
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{
		"crawler_finding_1",
		&tenantID,
		"crawler_doc_1",
		"layout_pattern",
		"pending_review",
		[]byte(`{"kind":"grid"}`),
		[]byte(`{"source_url":"https://example.com/docs"}`),
		now,
	}}}}}
	repo := NewRepository(db)

	page, err := repo.ListCrawlerFindings(context.Background(), "tenant_1", "pending_review", 25)
	if err != nil {
		t.Fatalf("ListCrawlerFindings() error = %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != "crawler_finding_1" {
		t.Fatalf("crawler findings = %#v, want crawler_finding_1", page.Items)
	}
	query := db.queryRowsUsed[0]
	if !strings.Contains(query.sql, "(tenant_id IS NULL OR tenant_id = $1)") || !strings.Contains(query.sql, "status = $3") || !strings.Contains(query.sql, "LIMIT $2") {
		t.Fatalf("crawler finding query missing tenant/status/limit guard: %s", query.sql)
	}
	wantArgs := []any{"tenant_1", 25, "pending_review"}
	if len(query.args) != len(wantArgs) {
		t.Fatalf("query args = %#v, want %#v", query.args, wantArgs)
	}
	for i, want := range wantArgs {
		if query.args[i] != want {
			t.Fatalf("query args[%d] = %#v, want %#v", i, query.args[i], want)
		}
	}
}

func TestListCrawlerFindingsRedactsStoredPayloadAndProvenanceSecrets(t *testing.T) {
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	tenantID := "tenant_1"
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{
		"crawler_finding_1",
		&tenantID,
		"crawler_doc_1",
		"layout_pattern",
		"pending_review",
		[]byte(`{"kind":"grid","authorization":"Bearer abcdefghijklmnop"}`),
		[]byte(`{"source_url":"https://user:pass@example.com/docs?token=secret-token","download_url":"https://storage.local/raw.html?X-Amz-Signature=abcdef"}`),
		now,
	}}}}}
	repo := NewRepository(db)

	page, err := repo.ListCrawlerFindings(context.Background(), "tenant_1", "pending_review", 25)
	if err != nil {
		t.Fatalf("ListCrawlerFindings() error = %v", err)
	}
	body, err := json.Marshal(page.Items[0])
	if err != nil {
		t.Fatalf("marshal crawler finding: %v", err)
	}
	for _, leaked := range []string{"abcdefghijklmnop", "user:pass", "secret-token", "abcdef"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("crawler finding = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), security.Redacted) {
		t.Fatalf("crawler finding = %s, want redaction marker", string(body))
	}
}

func TestListSafetyRulesUsesTenantScopedFilters(t *testing.T) {
	now := time.Date(2026, 5, 27, 8, 0, 0, 0, time.UTC)
	tenantID := "tenant_1"
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{
		"safety_rule_1",
		&tenantID,
		"export_block",
		"1",
		"exports",
		"critical",
		"block",
		[]byte(`["export"]`),
		"active",
		now,
	}}}}}
	repo := NewRepository(db)

	page, err := repo.ListSafetyRules(context.Background(), "tenant_1", "active", 25)
	if err != nil {
		t.Fatalf("ListSafetyRules() error = %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != "safety_rule_1" {
		t.Fatalf("safety rules = %#v, want safety_rule_1", page.Items)
	}
	query := db.queryRowsUsed[0]
	if !strings.Contains(query.sql, "(tenant_id IS NULL OR tenant_id = $1)") || !strings.Contains(query.sql, "status = $3") || !strings.Contains(query.sql, "LIMIT $2") {
		t.Fatalf("safety rules query missing tenant/status/limit guard: %s", query.sql)
	}
	wantArgs := []any{"tenant_1", 25, "active"}
	if len(query.args) != len(wantArgs) {
		t.Fatalf("query args = %#v, want %#v", query.args, wantArgs)
	}
	for i, want := range wantArgs {
		if query.args[i] != want {
			t.Fatalf("query args[%d] = %#v, want %#v", i, query.args[i], want)
		}
	}
}

func TestStartCrawlerRunRequiresApprovalRobotsLegalAndRatePolicy(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"crawler_source_1",
			nil,
			"Allowed Source",
			"https://example.com/docs",
			"approved",
			[]byte(`{"license":"permissive","owner":"Example"}`),
			[]byte(`{"robots":"allowed","direct_activation_allowed":false}`),
			now,
			now,
		}},
	}, {
		rows: [][]any{{0, 0}},
	}}}
	repo := NewRepository(db)

	run, err := repo.StartCrawlerRun(context.Background(), "tenant_1", "crawler_source_1", CrawlerPolicy{
		Enabled:          true,
		UserAgent:        "ZenArtStage0Bot/0.1",
		GlobalRPS:        0.2,
		SourceRPS:        0.1,
		RawRetentionDays: 14,
		BlocklistHosts:   []string{"localhost", "169.254.169.254"},
		ResolveHost:      publicTestResolver,
	})
	if err != nil {
		t.Fatalf("StartCrawlerRun() error = %v", err)
	}
	if run.SourceID != "crawler_source_1" || run.Status != "running" {
		t.Fatalf("run = %#v", run)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO crawler_runs") {
		t.Fatalf("crawler run insert not recorded: %#v", db.execs)
	}
	sourceLookup := db.queryRowsUsed[0]
	if !strings.Contains(sourceLookup.sql, "(tenant_id IS NULL OR tenant_id = $2)") {
		t.Fatalf("crawler source lookup missing tenant guard: %s", sourceLookup.sql)
	}
	if sourceLookup.args[1] != "tenant_1" {
		t.Fatalf("crawler source tenant arg = %#v, want tenant_1", sourceLookup.args[1])
	}
	summary, ok := db.execs[0].args[4].([]byte)
	if !ok {
		t.Fatalf("summary arg type = %T, want []byte", db.execs[0].args[4])
	}
	for _, fragment := range []string{`"user_agent":"ZenArtStage0Bot/0.1"`, `"global_rps":0.2`, `"source_rps":0.1`, `"raw_retention_days":14`, `"robots_policy"`} {
		if !strings.Contains(string(summary), fragment) {
			t.Fatalf("summary = %s, missing %s", string(summary), fragment)
		}
	}
}

func TestStartCrawlerRunRejectsCrossTenantSource(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	_, err := repo.StartCrawlerRun(context.Background(), "tenant_1", "crawler_source_cross_tenant", CrawlerPolicy{
		Enabled:          true,
		UserAgent:        "ZenArtStage0Bot/0.1",
		GlobalRPS:        0.2,
		SourceRPS:        0.1,
		RawRetentionDays: 14,
		ResolveHost:      publicTestResolver,
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("StartCrawlerRun() error = %v, want ErrNotFound", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("cross-tenant crawler source should not write rows: %#v", db.execs)
	}
	if len(db.queryRowsUsed) != 1 || !strings.Contains(db.queryRowsUsed[0].sql, "(tenant_id IS NULL OR tenant_id = $2)") {
		t.Fatalf("source lookup should use tenant guard: %#v", db.queryRowsUsed)
	}
	if db.queryRowsUsed[0].args[1] != "tenant_1" {
		t.Fatalf("source lookup tenant arg = %#v, want tenant_1", db.queryRowsUsed[0].args[1])
	}
}

func TestStartCrawlerRunBlocksUnapprovedRobotsDeniedAndPrivateHosts(t *testing.T) {
	now := time.Now().UTC()
	policy := CrawlerPolicy{
		Enabled:          true,
		UserAgent:        "ZenArtStage0Bot/0.1",
		GlobalRPS:        0.2,
		SourceRPS:        0.1,
		RawRetentionDays: 14,
		BlocklistHosts:   []string{"blocked.example"},
		ResolveHost:      publicTestResolver,
	}
	for _, tc := range []struct {
		name     string
		url      string
		status   string
		legal    []byte
		robots   []byte
		wantExec bool
	}{
		{
			name:   "unapproved",
			url:    "https://example.com/docs",
			status: "pending",
			legal:  []byte(`{"license":"permissive","owner":"Example"}`),
			robots: []byte(`{"robots":"allowed","direct_activation_allowed":false}`),
		},
		{
			name:   "robots denied",
			url:    "https://example.com/docs",
			status: "approved",
			legal:  []byte(`{"license":"permissive","owner":"Example"}`),
			robots: []byte(`{"robots":"denied","direct_activation_allowed":false}`),
		},
		{
			name:   "private host",
			url:    "http://127.0.0.1/docs",
			status: "approved",
			legal:  []byte(`{"license":"permissive","owner":"Example"}`),
			robots: []byte(`{"robots":"allowed","direct_activation_allowed":false}`),
		},
		{
			name:   "source blocklist",
			url:    "https://blocked.example/docs",
			status: "approved",
			legal:  []byte(`{"license":"permissive","owner":"Example"}`),
			robots: []byte(`{"robots":"allowed","direct_activation_allowed":false}`),
		},
		{
			name:   "missing legal metadata",
			url:    "https://example.com/docs",
			status: "approved",
			legal:  []byte(`{"license":"permissive"}`),
			robots: []byte(`{"robots":"allowed","direct_activation_allowed":false}`),
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := &fakeDB{queryRows: []rowSet{{
				rows: [][]any{{
					"crawler_source_1",
					nil,
					"Source",
					tc.url,
					tc.status,
					tc.legal,
					tc.robots,
					now,
					now,
				}},
			}}}
			repo := NewRepository(db)
			_, err := repo.StartCrawlerRun(context.Background(), "tenant_1", "crawler_source_1", policy)
			if !errors.Is(err, ErrCrawlerBlocked) {
				t.Fatalf("StartCrawlerRun() error = %v, want ErrCrawlerBlocked", err)
			}
			if len(db.execs) != 0 {
				t.Fatalf("blocked crawler run should not write rows: %#v", db.execs)
			}
		})
	}
}

func TestStartCrawlerRunBlocksDNSRebindingToPrivateIP(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"crawler_source_1",
			nil,
			"Allowed Source",
			"https://example.com/docs",
			"approved",
			[]byte(`{"license":"permissive","owner":"Example"}`),
			[]byte(`{"robots":"allowed","direct_activation_allowed":false}`),
			now,
			now,
		}},
	}}}
	repo := NewRepository(db)

	_, err := repo.StartCrawlerRun(context.Background(), "tenant_1", "crawler_source_1", CrawlerPolicy{
		Enabled:          true,
		UserAgent:        "ZenArtStage0Bot/0.1",
		GlobalRPS:        0.2,
		SourceRPS:        0.1,
		RawRetentionDays: 14,
		ResolveHost: func(context.Context, string) ([]net.IP, error) {
			return []net.IP{net.ParseIP("10.0.0.5")}, nil
		},
	})
	if !errors.Is(err, ErrCrawlerBlocked) {
		t.Fatalf("StartCrawlerRun() error = %v, want ErrCrawlerBlocked", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("DNS-rebound crawler run should not write rows: %#v", db.execs)
	}
}

func TestStartCrawlerRunBlocksWhenRateLimitExceeded(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"crawler_source_1",
			nil,
			"Allowed Source",
			"https://example.com/docs",
			"approved",
			[]byte(`{"license":"permissive","owner":"Example"}`),
			[]byte(`{"robots":"allowed","direct_activation_allowed":false}`),
			now,
			now,
		}},
	}, {
		rows: [][]any{{1, 0}},
	}}}
	repo := NewRepository(db)

	_, err := repo.StartCrawlerRun(context.Background(), "tenant_1", "crawler_source_1", CrawlerPolicy{
		Enabled:          true,
		UserAgent:        "ZenArtStage0Bot/0.1",
		GlobalRPS:        0.2,
		SourceRPS:        0.1,
		RawRetentionDays: 14,
		ResolveHost:      publicTestResolver,
	})
	if !errors.Is(err, ErrCrawlerBlocked) {
		t.Fatalf("StartCrawlerRun() error = %v, want ErrCrawlerBlocked", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("rate-limited crawler run should not write rows: %#v", db.execs)
	}
}

func TestImportCrawlerFindingRequiresProvenanceRetentionAndExactTextWarning(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"crawler_source_1",
			nil,
			"Allowed Source",
			"https://example.com/docs",
			"approved",
			[]byte(`{"license":"permissive","owner":"Example"}`),
			[]byte(`{"robots":"allowed","direct_activation_allowed":false}`),
			now,
			now,
		}},
	}, {
		rows: [][]any{{"crawler_doc_1"}},
	}}}
	repo := NewRepository(db)

	result, err := repo.ImportCrawlerFinding(context.Background(), CrawlerImport{
		TenantID:    "tenant_1",
		RunID:       "crawler_run_1",
		SourceID:    "crawler_source_1",
		DocumentURL: "https://example.com/docs/page",
		ContentHash: "sha256:abc",
		Metadata: map[string]any{
			"raw_secret_token": "secret",
		},
		FindingType: "exact_text",
		FindingPayload: map[string]any{
			"excerpt": "Original source text",
		},
		Provenance: map[string]any{
			"source_url":    "https://example.com/docs/page",
			"fetched_at":    "2026-05-26T00:00:00Z",
			"content_hash":  "sha256:abc",
			"robots_policy": map[string]any{"robots": "allowed"},
		},
	}, CrawlerPolicy{
		Enabled:          true,
		UserAgent:        "ZenArtStage0Bot/0.1",
		GlobalRPS:        0.2,
		SourceRPS:        0.1,
		RawRetentionDays: 14,
		ResolveHost:      publicTestResolver,
	})
	if err != nil {
		t.Fatalf("ImportCrawlerFinding() error = %v", err)
	}
	if result.DocumentID == "" || result.FindingID == "" || result.RetentionUntil.IsZero() {
		t.Fatalf("result = %#v", result)
	}
	if len(db.execs) != 1 {
		t.Fatalf("exec count = %d, want finding insert after document upsert", len(db.execs))
	}
	if len(db.queryRows) != 0 {
		t.Fatalf("document upsert row was not consumed")
	}
	documentUpsert := db.queryRowsUsed[1]
	if !strings.Contains(documentUpsert.sql, "INSERT INTO crawler_documents") || !strings.Contains(documentUpsert.sql, "retention_until") || !strings.Contains(documentUpsert.sql, "RETURNING id") {
		t.Fatalf("document upsert missing retention/returning id: %s", documentUpsert.sql)
	}
	metadata, ok := documentUpsert.args[7].([]byte)
	if !ok {
		t.Fatalf("metadata arg type = %T, want []byte", documentUpsert.args[7])
	}
	if !strings.Contains(string(metadata), `"raw_secret_token":"[REDACTED]"`) {
		t.Fatalf("metadata = %s, want redacted secret metadata", string(metadata))
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO crawler_findings") {
		t.Fatalf("finding insert not recorded: %s", db.execs[0].sql)
	}
	payload, ok := db.execs[0].args[5].([]byte)
	if !ok {
		t.Fatalf("payload arg type = %T, want []byte", db.execs[0].args[5])
	}
	if !strings.Contains(string(payload), "exact-text import requires review") {
		t.Fatalf("payload = %s, want exact-text warning", string(payload))
	}
	provenance, ok := db.execs[0].args[6].([]byte)
	if !ok {
		t.Fatalf("provenance arg type = %T, want []byte", db.execs[0].args[6])
	}
	if !strings.Contains(string(provenance), `"robots_policy"`) || !strings.Contains(string(provenance), `"content_hash":"sha256:abc"`) {
		t.Fatalf("provenance = %s, want robots and content hash evidence", string(provenance))
	}
}

func TestImportCrawlerFindingRejectsOffSourceHost(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"crawler_source_1",
			nil,
			"Allowed Source",
			"https://example.com/docs",
			"approved",
			[]byte(`{"license":"permissive","owner":"Example"}`),
			[]byte(`{"robots":"allowed","direct_activation_allowed":false}`),
			now,
			now,
		}},
	}}}
	repo := NewRepository(db)

	_, err := repo.ImportCrawlerFinding(context.Background(), CrawlerImport{
		RunID:       "crawler_run_1",
		SourceID:    "crawler_source_1",
		DocumentURL: "https://evil.example/docs/page",
		ContentHash: "sha256:abc",
		FindingType: "layout_pattern",
		Provenance: map[string]any{
			"source_url":    "https://evil.example/docs/page",
			"fetched_at":    "2026-05-26T00:00:00Z",
			"content_hash":  "sha256:abc",
			"robots_policy": map[string]any{"robots": "allowed"},
		},
	}, CrawlerPolicy{
		Enabled:          true,
		UserAgent:        "ZenArtStage0Bot/0.1",
		GlobalRPS:        0.2,
		SourceRPS:        0.1,
		RawRetentionDays: 14,
		ResolveHost:      publicTestResolver,
	})
	if !errors.Is(err, ErrCrawlerBlocked) {
		t.Fatalf("ImportCrawlerFinding() error = %v, want ErrCrawlerBlocked", err)
	}
	if len(db.execs) != 0 || len(db.queryRows) != 0 {
		t.Fatalf("off-host crawler import should not write rows or upsert documents: execs=%#v queryRows=%#v", db.execs, db.queryRows)
	}
}

func TestImportCrawlerFindingRejectsMissingProvenance(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	_, err := repo.ImportCrawlerFinding(context.Background(), CrawlerImport{
		RunID:       "crawler_run_1",
		SourceID:    "crawler_source_1",
		DocumentURL: "https://example.com/docs/page",
		ContentHash: "sha256:abc",
		FindingType: "exact_text",
		Provenance: map[string]any{
			"source_url": "https://example.com/docs/page",
		},
	}, CrawlerPolicy{
		Enabled:          true,
		UserAgent:        "ZenArtStage0Bot/0.1",
		GlobalRPS:        0.2,
		SourceRPS:        0.1,
		RawRetentionDays: 14,
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("ImportCrawlerFinding() error = %v, want ErrValidation", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("invalid crawler import should not write rows: %#v", db.execs)
	}
}

func TestImportCrawlerFindingRejectsMismatchedProvenance(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	_, err := repo.ImportCrawlerFinding(context.Background(), CrawlerImport{
		RunID:       "crawler_run_1",
		SourceID:    "crawler_source_1",
		DocumentURL: "https://example.com/docs/page",
		ContentHash: "sha256:abc",
		FindingType: "layout_pattern",
		Provenance: map[string]any{
			"source_url":    "https://example.com/docs/other",
			"fetched_at":    "2026-05-26T00:00:00Z",
			"content_hash":  "sha256:def",
			"robots_policy": map[string]any{"robots": "allowed"},
		},
	}, CrawlerPolicy{
		Enabled:          true,
		UserAgent:        "ZenArtStage0Bot/0.1",
		GlobalRPS:        0.2,
		SourceRPS:        0.1,
		RawRetentionDays: 14,
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("ImportCrawlerFinding() error = %v, want ErrValidation", err)
	}
	if len(db.execs) != 0 || len(db.queryRowsUsed) != 0 {
		t.Fatalf("mismatched provenance should fail before storage access: execs=%#v queries=%#v", db.execs, db.queryRowsUsed)
	}
}

func publicTestResolver(_ context.Context, _ string) ([]net.IP, error) {
	return []net.IP{net.ParseIP("93.184.216.34")}, nil
}

func assertSafetyDecision(t *testing.T, call execCall, point, subjectType string) {
	t.Helper()
	if !strings.Contains(call.sql, "INSERT INTO safety_decisions") {
		t.Fatalf("call should record safety decision: %s", call.sql)
	}
	if call.args[3] != subjectType || call.args[5] != point {
		t.Fatalf("safety decision args = %#v, want subject_type=%s point=%s", call.args, subjectType, point)
	}
}

func assertSafetyAnalytics(t *testing.T, call execCall) {
	t.Helper()
	if !strings.Contains(call.sql, "INSERT INTO analytics_events") {
		t.Fatalf("call should record safety analytics event: %s", call.sql)
	}
	if call.args[5] != "safety_decision_recorded" {
		t.Fatalf("analytics event name = %#v, want safety_decision_recorded", call.args[5])
	}
}

type captureScanner struct {
	target security.MalwareScanTarget
	result security.MalwareScanResult
	err    error
}

func (s *captureScanner) Scan(_ context.Context, target security.MalwareScanTarget) (security.MalwareScanResult, error) {
	s.target = target
	if s.err != nil {
		return security.MalwareScanResult{}, s.err
	}
	return s.result, nil
}

type fakeDB struct {
	execs         []execCall
	execTags      []pgconn.CommandTag
	queryRows     []rowSet
	queryRowsUsed []queryCall
	queryErr      error
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
	if len(f.execTags) == 0 {
		return pgconn.CommandTag{}, nil
	}
	tag := f.execTags[0]
	f.execTags = f.execTags[1:]
	return tag, nil
}

func (f *fakeDB) Query(_ context.Context, sql string, args ...any) (store.Rows, error) {
	f.queryRowsUsed = append(f.queryRowsUsed, queryCall{sql: sql, args: args})
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

func (f *fakeDB) QueryRow(_ context.Context, sql string, args ...any) store.Row {
	f.queryRowsUsed = append(f.queryRowsUsed, queryCall{sql: sql, args: args})
	if len(f.queryRows) > 0 && len(f.queryRows[0].rows) > 0 {
		row := f.queryRows[0].rows[0]
		f.queryRows = f.queryRows[1:]
		return fakeRow{row: row}
	}
	return fakeRow{err: pgx.ErrNoRows}
}

type rowSet struct {
	rows [][]any
}

type recordingObjectStore struct {
	signedURL    string
	signTenantID string
	signKey      string
	signTTL      time.Duration
}

func (s *recordingObjectStore) Put(_ context.Context, object objectstore.Object, _ io.Reader) (objectstore.Object, error) {
	return object, nil
}

func (s *recordingObjectStore) Get(_ context.Context, _ string, _ string) (objectstore.Reader, error) {
	return objectstore.Reader{}, objectstore.ErrNotFound
}

func (s *recordingObjectStore) SignGetURL(_ context.Context, tenantID, key string, ttl time.Duration) (string, error) {
	s.signTenantID = tenantID
	s.signKey = key
	s.signTTL = ttl
	return s.signedURL, nil
}

func (s *recordingObjectStore) Delete(_ context.Context, _ string, _ string) error {
	return nil
}

func (s *recordingObjectStore) CleanupExpired(_ context.Context, _ time.Time) (int, error) {
	return 0, nil
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
	row []any
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	for i := range dest {
		assign(dest[i], r.row[i])
	}
	return nil
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
		switch v := value.(type) {
		case string:
			*ptr = &v
		case *string:
			*ptr = v
		default:
			panic("unsupported nullable string scan value")
		}
	case *[]byte:
		if value == nil {
			*ptr = nil
			return
		}
		*ptr = value.([]byte)
	case *int:
		*ptr = value.(int)
	case *float64:
		*ptr = value.(float64)
	case *bool:
		*ptr = value.(bool)
	case *[]string:
		*ptr = value.([]string)
	case *time.Time:
		*ptr = value.(time.Time)
	default:
		panic("unsupported scan destination")
	}
}
