package stage0

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/objectstore"
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
	if !strings.Contains(db.execs[2].sql, "INSERT INTO analytics_events") {
		t.Fatalf("upload analytics event not recorded: %s", db.execs[2].sql)
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
	if len(db.execs) != 2 {
		t.Fatalf("exec count = %d, want 2", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "retention_until") || !strings.Contains(db.execs[0].sql, "status = 'expired'") {
		t.Fatalf("expired export cleanup SQL missing retention/status: %s", db.execs[0].sql)
	}
	if !strings.Contains(db.execs[1].sql, "retention_state = 'orphaned'") {
		t.Fatalf("orphan cleanup SQL missing orphaned retention state: %s", db.execs[1].sql)
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

type fakeDB struct {
	execs     []execCall
	execTags  []pgconn.CommandTag
	queryRows []rowSet
	queryErr  error
}

type execCall struct {
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
		v := value.(string)
		*ptr = &v
	case *[]byte:
		if value == nil {
			*ptr = nil
			return
		}
		*ptr = value.([]byte)
	case *time.Time:
		*ptr = value.(time.Time)
	default:
		panic("unsupported scan destination")
	}
}
