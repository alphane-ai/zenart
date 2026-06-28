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

const stage0StripeSecretFixture = "sk_test_" + "abcdefghijklmnopqrstuvwxyz123456"
const stage0ProviderSecretFixture = "sk-ant-" + "abcdefghijklmnopqrstuvwxyz123456"

func TestCreateSupportTicketPersistsTenantUserAndLinks(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	ticket, err := repo.CreateSupportTicket(context.Background(), "tenant_1", "user_1", SupportTicketCreate{
		ProjectID:      "project_1",
		TaskID:         "task_1",
		BatchID:        "batch_1",
		TraceID:        "trace_1",
		AssetID:        "asset_1",
		Category:       "export_failure",
		Body:           "The export failed.",
		LinkedExportID: "export_1",
		QuotaBucketID:  "quota_1",
		BillingRefID:   "billing:stripe:in_1",
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
	if ticket.BatchID == nil || *ticket.BatchID != "batch_1" {
		t.Fatalf("ticket BatchID = %v", ticket.BatchID)
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
	if ticket.BillingRefID == nil || *ticket.BillingRefID != "billing:stripe:in_1" {
		t.Fatalf("ticket BillingRefID = %v", ticket.BillingRefID)
	}
	if ticket.Metadata["api_key"] != "[REDACTED]" {
		t.Fatalf("ticket api_key metadata = %v, want redacted", ticket.Metadata["api_key"])
	}
	if len(db.execs) != 2 || !strings.Contains(db.execs[0].sql, "INSERT INTO support_tickets") {
		t.Fatalf("support ticket insert not recorded: %#v", db.execs)
	}
	for _, column := range []string{"task_id", "batch_id", "trace_id", "asset_id", "linked_export_id", "quota_bucket_id", "billing_reference_id"} {
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
		BatchID:        "batch_1",
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
			"batch_1",
			"trace_1",
			"asset_1",
			"export_failure",
			"open",
			"The export failed.",
			"export_1",
			"quota_1",
			"billing:stripe:in_1",
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
	if ticket.BatchID == nil || *ticket.BatchID != "batch_1" {
		t.Fatalf("BatchID = %v, want batch_1", ticket.BatchID)
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
	if ticket.BillingRefID == nil || *ticket.BillingRefID != "billing:stripe:in_1" {
		t.Fatalf("BillingRefID = %v, want billing:stripe:in_1", ticket.BillingRefID)
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
			"batch_1",
			"trace_1",
			"asset_1",
			"export_failure",
			"open",
			"provider failed with Bearer abcdefghijklmnop",
			"export_1",
			"quota_1",
			"billing:stripe:in_1",
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

func TestCreatePackagePersistsItemsAndRedactsManifest(t *testing.T) {
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{"ecommerce_growth_pack"}}}}}
	repo := NewRepository(db)

	pkg, err := repo.CreatePackage(context.Background(), "tenant_1", "user_1", "project_1", PackageCreate{
		Manifest: map[string]any{"download_url": "https://storage.local/export.zip?X-Amz-Signature=abcdef"},
		Items: []PackageItemCreate{{
			"sourceId": "candidate_1",
			"title":    "Hero option",
			"type":     "candidate",
			"provenance": map[string]any{
				"api_key": "secret-value",
			},
		}},
	})
	if err != nil {
		t.Fatalf("CreatePackage() error = %v", err)
	}
	if pkg.TenantID != "tenant_1" || pkg.ProjectID != "project_1" || pkg.Status != "draft" {
		t.Fatalf("package = %#v, want principal tenant project draft", pkg)
	}
	if len(pkg.Items) != 1 || pkg.Items[0].Type != "candidate" || pkg.Items[0].Provenance["source_id"] != "candidate_1" {
		t.Fatalf("items = %#v, want candidate source item", pkg.Items)
	}
	body, err := json.Marshal(pkg)
	if err != nil {
		t.Fatalf("marshal package: %v", err)
	}
	for _, leaked := range []string{"X-Amz-Signature=abcdef", "secret-value"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("package = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), security.Redacted) {
		t.Fatalf("package = %s, want redaction marker", string(body))
	}
	if len(db.queryRowsUsed) != 1 || !strings.Contains(db.queryRowsUsed[0].sql, "FROM projects") {
		t.Fatalf("project tenant query not recorded: %#v", db.queryRowsUsed)
	}
	if len(db.execs) != 2 {
		t.Fatalf("exec count = %d, want package and item inserts", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO packages") || db.execs[0].args[1] != "tenant_1" || db.execs[0].args[3] != "user_1" {
		t.Fatalf("package insert = %#v, want principal tenant/user", db.execs[0])
	}
	if !strings.Contains(db.execs[1].sql, "INSERT INTO package_items") || db.execs[1].args[1] != "tenant_1" || db.execs[1].args[5] != "candidate" {
		t.Fatalf("package item insert = %#v, want tenant candidate item", db.execs[1])
	}
}

func TestListPackagesReturnsItemsAndSafeProjection(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{
		{rows: [][]any{{
			"package_1",
			"tenant_1",
			"project_1",
			"draft",
			[]byte(`{"download_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","qa_report":{"status":"pass"},"provenance":{"api_key":"secret-value"}}`),
			now,
			now,
		}}},
		{rows: [][]any{{
			"package_item_1",
			"asset_1",
			nil,
			"asset",
			0,
			[]byte(`{"source":"local","secret":"secret-value"}`),
			now,
		}}},
	}}
	repo := NewRepository(db)

	page, err := repo.ListPackages(context.Background(), "tenant_1", "project_1", "draft", 25)
	if err != nil {
		t.Fatalf("ListPackages() error = %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("package count = %d, want 1", len(page.Items))
	}
	pkg := page.Items[0]
	if len(pkg.Items) != 1 || pkg.Items[0].AssetID == nil || *pkg.Items[0].AssetID != "asset_1" {
		t.Fatalf("package items = %#v, want asset item", pkg.Items)
	}
	body, err := json.Marshal(pkg)
	if err != nil {
		t.Fatalf("marshal package: %v", err)
	}
	for _, leaked := range []string{"X-Amz-Signature=abcdef", "secret-value"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("package = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), security.Redacted) {
		t.Fatalf("package = %s, want redaction marker", string(body))
	}
	if len(db.queryRowsUsed) != 2 {
		t.Fatalf("query count = %d, want package and item queries", len(db.queryRowsUsed))
	}
	if db.queryRowsUsed[0].args[0] != "tenant_1" || db.queryRowsUsed[0].args[1] != "project_1" || db.queryRowsUsed[0].args[2] != 25 || db.queryRowsUsed[0].args[3] != "draft" {
		t.Fatalf("package query args = %#v, want tenant, project, limit, status", db.queryRowsUsed[0].args)
	}
}

func TestListSkillsUsesTenantOrGlobalScope(t *testing.T) {
	now := time.Now().UTC()
	tenantID := "tenant_1"
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"skill_1",
			&tenantID,
			"Tenant Skill",
			"design",
			"platform",
			"medium",
			"active",
			"1.0.0",
			now,
			now,
		}},
	}}}
	repo := NewRepository(db)

	page, err := repo.ListSkills(context.Background(), "tenant_1", "active", 25)
	if err != nil {
		t.Fatalf("ListSkills() error = %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != "skill_1" || page.Items[0].ActiveVersion != "1.0.0" {
		t.Fatalf("skills = %#v, want tenant skill with active version", page.Items)
	}
	query := db.queryRowsUsed[0]
	if !strings.Contains(query.sql, "(s.tenant_id IS NULL OR s.tenant_id = $1)") || !strings.Contains(query.sql, "skill_release_channels") {
		t.Fatalf("skill query missing tenant/global or active channel joins: %s", query.sql)
	}
	if query.args[0] != "tenant_1" || query.args[1] != 25 || query.args[2] != "active" {
		t.Fatalf("query args = %#v, want tenant, limit, status", query.args)
	}
}

func TestListSkillVersionsBuildsReleaseGateFromLatestEval(t *testing.T) {
	now := time.Now().UTC()
	evalSuiteID := "eval_suite_1"
	rollbackID := "skillver_rollback"
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"skillver_1",
			"skill_1",
			"1.0.0",
			"active",
			&evalSuiteID,
			"eval_result_1",
			"pass",
			true,
			true,
			true,
			0,
			"Release notes",
			&rollbackID,
			now,
		}},
	}}}
	repo := NewRepository(db)

	page, err := repo.ListSkillVersions(context.Background(), "tenant_1", "skill_1", 25)
	if err != nil {
		t.Fatalf("ListSkillVersions() error = %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("version count = %d, want 1", len(page.Items))
	}
	version := page.Items[0]
	if !version.ReleaseGate.EligibleForCanary || !version.ReleaseGate.EligibleForActive || !version.ReleaseGate.EvalContractComplete {
		t.Fatalf("release gate = %#v, want canary/active eligible complete gate", version.ReleaseGate)
	}
	if version.ReleaseGate.LastEvalResultID == nil || *version.ReleaseGate.LastEvalResultID != "eval_result_1" {
		t.Fatalf("last eval result = %#v, want eval_result_1", version.ReleaseGate.LastEvalResultID)
	}
	query := db.queryRowsUsed[0]
	for _, snippet := range []string{"LEFT JOIN LATERAL", "er.tenant_id = $1", "er.subject_type = 'skill_version'", "(s.tenant_id IS NULL OR s.tenant_id = $1)"} {
		if !strings.Contains(query.sql, snippet) {
			t.Fatalf("skill version query missing %q: %s", snippet, query.sql)
		}
	}
}

func TestListEvalResultsFiltersLatestAndRedactsSummary(t *testing.T) {
	now := time.Now().UTC()
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"eval_result_1",
			"tenant_1",
			"eval_suite_1",
			"skill_version",
			"skillver_1",
			"1.0.0",
			"blocked",
			[]byte(`{"summary":{"total_fixtures":1,"trace_complete":true,"download_url":"https://storage.local/eval.json?X-Amz-Signature=abcdef"},"fixture_results":[{"fixture_id":"fx_1","api_key":"secret"}],"runner_contract":{"runner":"scripts/run_stage0_eval.py","runner_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"storage_contract":{"table":"eval_results"}}`),
			"scripts/run_stage0_eval.py",
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			now,
			now,
		}},
	}}}
	repo := NewRepository(db)

	page, err := repo.ListEvalResults(context.Background(), EvalResultFilters{
		TenantID:       "tenant_1",
		SuiteID:        "eval_suite_1",
		Status:         "blocked",
		SubjectType:    "skill_version",
		SubjectID:      "skillver_1",
		SubjectVersion: "1.0.0",
		LatestOnly:     true,
		Limit:          25,
	})
	if err != nil {
		t.Fatalf("ListEvalResults() error = %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("eval result count = %d, want 1", len(page.Items))
	}
	result := page.Items[0]
	if result.Subject.CandidateStatusAfterEval != "blocked" || len(result.FixtureResults) != 1 {
		t.Fatalf("result = %#v, want blocked result with fixture projection", result)
	}
	body, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal eval result: %v", err)
	}
	for _, leaked := range []string{"X-Amz-Signature=abcdef", `"api_key":"secret"`} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("eval result = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), security.Redacted) {
		t.Fatalf("eval result = %s, want redaction marker", string(body))
	}
	query := db.queryRowsUsed[0]
	for _, snippet := range []string{"tenant_id = $1", "eval_suite_id", "subject_type", "subject_id", "subject_version", "DISTINCT ON"} {
		if !strings.Contains(query.sql, snippet) {
			t.Fatalf("eval query missing %q: %s", snippet, query.sql)
		}
	}
	if query.args[0] != "tenant_1" || query.args[1] != 25 {
		t.Fatalf("query args = %#v, want tenant and limit first", query.args)
	}
}

func TestGetEvalResultArtifactReturnsSafeAdminRetrievalMetadata(t *testing.T) {
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"eval_result_1",
			"tenant_1",
			"eval_suite_1",
			"skill_version",
			"skillver_1",
			"1.0.0",
			"pass",
			[]byte(`{"summary":{"total_fixtures":1,"trace_complete":true},"fixture_results":[{"fixture_id":"fx_1"}],"runner_contract":{"runner_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"storage_contract":{"table":"eval_results"}}`),
			"scripts/run_stage0_eval.py",
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			now,
			now,
		}},
	}}}
	repo := NewRepository(db)

	artifact, err := repo.GetEvalResultArtifact(context.Background(), "tenant_1", "eval_result_1", now)
	if err != nil {
		t.Fatalf("GetEvalResultArtifact() error = %v", err)
	}
	if artifact.ObjectKey != "tenants/tenant_1/eval-results/eval_result_1.json" || artifact.ContentType != "application/json" {
		t.Fatalf("artifact object = %#v, want tenant-scoped JSON object", artifact)
	}
	if artifact.AccessPolicy["direct_object_access_allowed"] != false || artifact.AccessPolicy["audit_access_required"] != true || artifact.AuditRequired != true {
		t.Fatalf("artifact access policy = %#v audit=%v, want admin audited indirect access", artifact.AccessPolicy, artifact.AuditRequired)
	}
	if artifact.DownloadURL == "" || strings.Contains(artifact.DownloadURL, "secret") || strings.Contains(artifact.DownloadURL, "Signature") {
		t.Fatalf("download URL = %q, want safe admin retrieval URL without signed object secrets", artifact.DownloadURL)
	}
	if artifact.ExpiresAt.Sub(now) != 15*time.Minute {
		t.Fatalf("expires = %v, want 15 minute TTL", artifact.ExpiresAt.Sub(now))
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

func TestListSafetyReviewQueueUsesTenantStatusAndSafeProjection(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	ruleID := "safety_rule_1"
	db := &fakeDB{queryRows: []rowSet{{rows: [][]any{{
		"safety_decision_1",
		"tenant_1",
		ruleID,
		"export",
		"export_1",
		SafetyPointExport,
		"require_admin_review",
		"active safety rule matched enforcement point",
		"financial-claim-review:v1",
		"v1",
		"medium",
		"pending",
		"",
		"",
		"",
		"",
		now,
		nil,
	}}}}}
	repo := NewRepository(db)

	page, err := repo.ListSafetyReviewQueue(context.Background(), "tenant_1", "pending", 25)
	if err != nil {
		t.Fatalf("ListSafetyReviewQueue() error = %v", err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("items = %d, want 1", len(page.Items))
	}
	query := db.queryRowsUsed[0]
	if query.args[0] != "tenant_1" || query.args[1] != 25 || query.args[2] != "pending" {
		t.Fatalf("query args = %#v, want tenant/status scoped", query.args)
	}
	item := page.Items[0]
	if item.ID != "safety_review_safety_decision_1" || !item.OverrideEligible || !item.AuditRequired {
		t.Fatalf("review item = %#v, want eligible audited review item", item)
	}
	if item.SafeProjection["raw_prompt_persisted"] != false || item.SafeProjection["secret_material_persisted"] != false || item.SafeProjection["admin_only"] != true {
		t.Fatalf("safe projection = %#v", item.SafeProjection)
	}
	if !containsString(item.RequiredEvidence, "safety_decisions/safety_decision_1") || !containsString(item.RequiredEvidence, "safety_rules/safety_rule_1") {
		t.Fatalf("required evidence = %#v", item.RequiredEvidence)
	}
}

func TestRecordSafetyReviewDecisionRedactsMetadataAndChecksTenant(t *testing.T) {
	now := time.Date(2026, 6, 22, 11, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{
		{rows: nil},
		{rows: [][]any{{"safety_decision_1"}}},
	}}
	repo := NewRepository(db)

	result, err := repo.RecordSafetyReviewDecision(context.Background(), SafetyReviewDecisionInput{
		TenantID:         "tenant_1",
		SafetyDecisionID: "safety_decision_1",
		ReviewerID:       "admin_reviewer_1",
		Decision:         "approved",
		Rationale:        "reviewed masked export warning",
		AuditRef:         "audit_1",
		IdempotencyKey:   "review-1",
		Metadata:         map[string]any{"ticket_id": "sup_1", "api_key": stage0StripeSecretFixture},
		CreatedAt:        now,
	})
	if err != nil {
		t.Fatalf("RecordSafetyReviewDecision() error = %v", err)
	}
	if result.Decision != "approved" || result.UserVisibleOutcome != "safety_review_approved" {
		t.Fatalf("result = %#v", result)
	}
	if len(db.queryRowsUsed) != 2 || db.queryRowsUsed[1].args[0] != "tenant_1" || db.queryRowsUsed[1].args[1] != "safety_decision_1" {
		t.Fatalf("tenant ownership query = %#v", db.queryRowsUsed)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO safety_review_decisions") {
		t.Fatalf("execs = %#v, want safety review insert", db.execs)
	}
	metadata, ok := db.execs[0].args[8].([]byte)
	if !ok {
		t.Fatalf("metadata arg = %T, want []byte", db.execs[0].args[8])
	}
	if strings.Contains(string(metadata), "sk_test_") || !strings.Contains(string(metadata), security.Redacted) {
		t.Fatalf("metadata = %s, want redacted secret", string(metadata))
	}
}

func TestRecordExportOverrideDecisionRedactsChecksTenantAndIsIdempotent(t *testing.T) {
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{
		{rows: nil},
		{rows: [][]any{{
			"export_1",
			"tenant_1",
			"package_1",
			"project_1",
			nil,
			"zip",
			"failed",
			"failed",
			nil,
			[]byte(`{"trace_id":"trace_1"}`),
			[]byte(`{"retention_until":"2026-07-01T00:00:00Z"}`),
			[]byte(`{"message":"failed"}`),
			now,
			now,
			[]byte(`{}`),
		}}},
	}}
	repo := NewRepository(db)

	result, err := repo.RecordExportOverrideDecision(context.Background(), ExportOverrideDecisionInput{
		TenantID:       "tenant_1",
		ExportID:       "export_1",
		SourceType:     "qa_result",
		SourceID:       "qa_1",
		TraceID:        "trace_1",
		RequestedBy:    "admin_reviewer_1",
		RequestedRole:  "admin_reviewer",
		ResolvedBy:     "admin_reviewer_1",
		ResolvedRole:   "admin_reviewer",
		Outcome:        "approved",
		Rationale:      "approved after reviewing ticket",
		AuditLogID:     "audit_1",
		IdempotencyKey: "override-1",
		Metadata:       map[string]any{"ticket_id": "sup_1", "api_key": stage0StripeSecretFixture},
		CreatedAt:      now,
	})
	if err != nil {
		t.Fatalf("RecordExportOverrideDecision() error = %v", err)
	}
	if result.Outcome != "approved" || !result.SourceGateResolved || result.FinalExportAllowed {
		t.Fatalf("result = %#v, want approved source gate without final export opening", result)
	}
	if len(db.queryRowsUsed) != 2 || !strings.Contains(db.queryRowsUsed[1].sql, "FROM exports") || db.queryRowsUsed[1].args[0] != "tenant_1" || db.queryRowsUsed[1].args[1] != "export_1" {
		t.Fatalf("queries = %#v, want idempotency then tenant-scoped export lookup", db.queryRowsUsed)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "INSERT INTO export_override_decisions") {
		t.Fatalf("execs = %#v, want export override insert", db.execs)
	}
	metadata := string(db.execs[0].args[16].([]byte))
	if strings.Contains(metadata, "sk_test_") || !strings.Contains(metadata, security.Redacted) {
		t.Fatalf("metadata = %s, want redacted secret", metadata)
	}

	existingDB := &fakeDB{queryRows: []rowSet{{rows: [][]any{{
		"export_override_1",
		"tenant_1",
		"export_1",
		"qa_result",
		"qa_1",
		"trace_1",
		"admin_reviewer",
		"admin_reviewer",
		"denied",
		"missing_approval_audit",
		false,
		false,
		"audit_1",
		"override-1",
		[]byte(`{"ticket_id":"sup_1"}`),
		now,
	}}}}}
	existing, err := NewRepository(existingDB).RecordExportOverrideDecision(context.Background(), ExportOverrideDecisionInput{
		TenantID:       "tenant_1",
		ExportID:       "export_1",
		SourceType:     "qa_result",
		SourceID:       "qa_1",
		TraceID:        "trace_1",
		RequestedBy:    "admin_reviewer_1",
		RequestedRole:  "admin_reviewer",
		ResolvedBy:     "admin_reviewer_1",
		ResolvedRole:   "admin_reviewer",
		Outcome:        "denied",
		DenialReason:   "missing_approval_audit",
		Rationale:      "denied until audit is attached",
		AuditLogID:     "audit_1",
		IdempotencyKey: "override-1",
	})
	if err != nil {
		t.Fatalf("idempotent RecordExportOverrideDecision() error = %v", err)
	}
	if existing.ID != "export_override_1" || existing.Outcome != "denied" || existing.DenialReason == nil || *existing.DenialReason != "missing_approval_audit" {
		t.Fatalf("existing = %#v, want stored idempotent decision", existing)
	}
	if len(existingDB.execs) != 0 || len(existingDB.queryRowsUsed) != 1 {
		t.Fatalf("idempotent replay should not touch export or insert: queries=%#v execs=%#v", existingDB.queryRowsUsed, existingDB.execs)
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

func TestCreateUploadDoesNotLetUserMetadataForcePlaceholderMalwareStatus(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

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
			Metadata:    map[string]any{"stage0_force_malware_status": "suspicious", "api_key": "secret"},
		},
		SignURL: func(_ string, objectKey string, _ time.Duration) (string, time.Time) {
			return "/signed/" + objectKey, time.Now().UTC().Add(5 * time.Minute)
		},
		MalwareScanner: security.PlaceholderMalwareScanner{Provider: "stage0-test"},
	})
	if err != nil {
		t.Fatalf("CreateUpload() error = %v", err)
	}
	scanMetadata, ok := upload.Metadata["malware_scan"].(map[string]any)
	if !ok {
		t.Fatalf("upload metadata missing malware_scan result: %#v", upload.Metadata)
	}
	if scanMetadata["status"] != string(security.MalwareScanStatusUnavailable) {
		t.Fatalf("malware scan status = %#v, want unavailable placeholder", scanMetadata["status"])
	}
	if _, ok := scanMetadata["metadata"]; ok {
		t.Fatalf("malware scan metadata = %#v, user-supplied scanner control should not be persisted", scanMetadata)
	}
}

func TestCreateUploadRedactsMalwareScannerBoundary(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)
	scanner := captureScanner{
		result: security.MalwareScanResult{
			Status:    security.MalwareScanStatusClean,
			Provider:  "scanner hf_abcdefghijklmnopqrstuvwxyz123456",
			Signature: "sig " + stage0ProviderSecretFixture,
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
				"slot":                        "reference",
				"api_key":                     "secret",
				"stage0_force_malware_status": "suspicious",
				"provider":                    "fake-clean-scanner",
				"definition":                  "forged-definition",
				"scan_status":                 "clean",
				"workflow_id":                 "workflow_1",
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
	if scanner.target.Metadata["slot"] != "reference" || scanner.target.Metadata["workflow_id"] != "workflow_1" {
		t.Fatalf("scanner target metadata = %#v, want allowlisted context", scanner.target.Metadata)
	}
	for _, blocked := range []string{"api_key", "stage0_force_malware_status", "provider", "definition", "scan_status"} {
		if _, ok := scanner.target.Metadata[blocked]; ok {
			t.Fatalf("scanner target metadata = %#v, want blocked user-controlled key %q removed", scanner.target.Metadata, blocked)
		}
	}
	body, err := json.Marshal(upload.Metadata["malware_scan"])
	if err != nil {
		t.Fatalf("marshal malware metadata: %v", err)
	}
	for _, leaked := range []string{
		"hf_abcdefghijklmnopqrstuvwxyz123456",
		stage0ProviderSecretFixture,
		"abcdefghijklmnop",
		"secret",
		"abcdef",
		"fake-clean-scanner",
		"forged-definition",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("malware metadata = %s, leaked %s", string(body), leaked)
		}
	}
}

func TestCreateUploadRejectsUnsupportedMalwareStatusWithRedactedError(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)
	signed := false
	secretStatus := "infected " + stage0ProviderSecretFixture

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
		MalwareScanner: &captureScanner{result: security.MalwareScanResult{Status: security.MalwareScanStatus(secretStatus)}},
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("CreateUpload() error = %v, want ErrValidation", err)
	}
	if strings.Contains(err.Error(), stage0ProviderSecretFixture) || strings.Contains(err.Error(), secretStatus) {
		t.Fatalf("CreateUpload() error = %q, leaked scanner-supplied unsupported status secret", err.Error())
	}
	if !strings.Contains(err.Error(), security.Redacted) {
		t.Fatalf("CreateUpload() error = %q, want redaction marker", err.Error())
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

func TestPutUploadedObjectBlocksAndDeletesSuspiciousStoredObject(t *testing.T) {
	objects := &recordingObjectStore{}
	scanner := &captureScanner{result: security.MalwareScanResult{
		Status:    security.MalwareScanStatusSuspicious,
		Provider:  "stage0-test",
		Signature: "scanner-v1",
	}}
	service := NewService(NewRepository(&fakeDB{}), objects, scanner)

	_, result, err := service.PutUploadedObject(context.Background(), objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "uploads/upload_1/logo.png",
		ContentType: "image/png",
		ByteSize:    1,
		Checksum:    "sha256:old",
	}, strings.NewReader("png-bytes"), false)
	if !errors.Is(err, ErrMalwareBlocked) {
		t.Fatalf("PutUploadedObject() error = %v, want ErrMalwareBlocked", err)
	}
	if result.Status != security.MalwareScanStatusSuspicious {
		t.Fatalf("scan status = %q, want suspicious", result.Status)
	}
	if len(objects.deletedObjects) != 1 {
		t.Fatalf("deleted objects = %#v, want one cleanup delete", objects.deletedObjects)
	}
	deleted := objects.deletedObjects[0]
	if deleted.tenantID != "tenant_1" || deleted.key != "uploads/upload_1/logo.png" {
		t.Fatalf("deleted object = %#v, want tenant-scoped upload key cleanup", deleted)
	}
	if scanner.target.Checksum != "sha256:stored" || scanner.target.ByteSize != int64(len("png-bytes")) {
		t.Fatalf("scanner target = %#v, want stored checksum and byte size", scanner.target)
	}
}

func TestPutUploadedObjectPersistsStoredScanEvidence(t *testing.T) {
	objects := &recordingObjectStore{}
	scanner := &captureScanner{result: security.MalwareScanResult{
		Status:    security.MalwareScanStatusClean,
		Provider:  "scanner hf_abcdefghijklmnopqrstuvwxyz123456",
		Signature: "scanner-v1",
		Rationale: "clean via Bearer abcdefghijklmnop",
		Metadata: map[string]string{
			"note": "https://storage.local/file.zip?X-Amz-Signature=abcdef",
		},
	}}
	db := &fakeDB{execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 1")}}
	service := NewService(NewRepository(db), objects, scanner)

	stored, result, err := service.PutUploadedObject(context.Background(), objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "uploads/upload_1/logo.png",
		ContentType: "image/png",
	}, strings.NewReader("png-bytes"), false)
	if err != nil {
		t.Fatalf("PutUploadedObject() error = %v", err)
	}
	if result.Status != security.MalwareScanStatusClean {
		t.Fatalf("scan status = %q, want clean", result.Status)
	}
	if stored.Key != "uploads/upload_1/logo.png" {
		t.Fatalf("stored key = %q, want upload key from object store", stored.Key)
	}
	if len(db.execs) != 1 {
		t.Fatalf("exec count = %d, want object metadata scan update", len(db.execs))
	}
	call := db.execs[0]
	for _, fragment := range []string{"UPDATE object_metadata", "upload_id IS NOT NULL", "tenant_id = $1", "object_key = $2", "object_key = $3"} {
		if !strings.Contains(call.sql, fragment) {
			t.Fatalf("scan evidence update SQL = %s, missing %s", call.sql, fragment)
		}
	}
	if call.args[0] != "tenant_1" || call.args[1] != "tenants/tenant_1/uploads/upload_1/logo.png" || call.args[2] != "tenants/tenant_1/uploads/upload_1/logo.png" {
		t.Fatalf("scan evidence update args = %#v, want tenant-scoped object key guards", call.args[:3])
	}
	if call.args[3] != "sha256:stored" || call.args[4] != int64(len("png-bytes")) || call.args[5] != "image/png" {
		t.Fatalf("scan evidence update object args = %#v, want stored checksum/size/content type", call.args[3:6])
	}
	body, ok := call.args[6].([]byte)
	if !ok {
		t.Fatalf("metadata patch arg type = %T, want []byte", call.args[6])
	}
	for _, leaked := range []string{"hf_abcdefghijklmnopqrstuvwxyz123456", "abcdefghijklmnop", "abcdef"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("metadata patch = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"stored_object"`, `"malware_scan"`, `"checksum":"sha256:stored"`, security.Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("metadata patch = %s, missing %s", string(body), fragment)
		}
	}
}

func TestPutUploadedObjectDeletesStoredObjectWhenScanEvidenceUpdateFails(t *testing.T) {
	objects := &recordingObjectStore{}
	scanner := &captureScanner{result: security.MalwareScanResult{
		Status:    security.MalwareScanStatusClean,
		Provider:  "stage0-test",
		Signature: "scanner-v1",
	}}
	db := &fakeDB{execTags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 0")}}
	service := NewService(NewRepository(db), objects, scanner)

	_, _, err := service.PutUploadedObject(context.Background(), objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "uploads/upload_1/logo.png",
		ContentType: "image/png",
	}, strings.NewReader("png-bytes"), false)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("PutUploadedObject() error = %v, want ErrNotFound", err)
	}
	if len(objects.deletedObjects) != 1 {
		t.Fatalf("deleted objects = %#v, want stored object cleanup after metadata failure", objects.deletedObjects)
	}
}

func TestRecordUploadedObjectScanRejectsCrossTenantStoredObject(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	err := repo.RecordUploadedObjectScan(context.Background(), "tenant_1", "uploads/upload_1/logo.png", objectstore.Object{
		TenantID:    "tenant_2",
		Key:         "uploads/upload_1/logo.png",
		ContentType: "image/png",
		ByteSize:    9,
		Checksum:    "sha256:stored",
	}, security.MalwareScanResult{Status: security.MalwareScanStatusClean})
	if !errors.Is(err, ErrTenantDenied) {
		t.Fatalf("RecordUploadedObjectScan() error = %v, want ErrTenantDenied", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("cross-tenant scan update should not write rows: %#v", db.execs)
	}
}

func TestRecordUploadedObjectScanRejectsCrossTenantStoredObjectKey(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	err := repo.RecordUploadedObjectScan(context.Background(), "tenant_1", "uploads/upload_1/logo.png", objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "tenants/tenant_2/uploads/upload_1/logo.png",
		ContentType: "image/png",
		ByteSize:    9,
		Checksum:    "sha256:stored",
	}, security.MalwareScanResult{Status: security.MalwareScanStatusClean})
	if !errors.Is(err, ErrTenantDenied) {
		t.Fatalf("RecordUploadedObjectScan() error = %v, want ErrTenantDenied", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("cross-tenant scan update should not write rows: %#v", db.execs)
	}
}

func TestPutUploadedObjectFailClosedDeletesUnavailableStoredObject(t *testing.T) {
	objects := &recordingObjectStore{}
	scanner := &captureScanner{result: security.MalwareScanResult{
		Status:    security.MalwareScanStatusUnavailable,
		Provider:  "stage0-test",
		Signature: "scanner-v1",
	}}
	service := NewService(NewRepository(&fakeDB{}), objects, scanner)

	_, _, err := service.PutUploadedObject(context.Background(), objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "uploads/upload_1/logo.png",
		ContentType: "image/png",
	}, strings.NewReader("png-bytes"), true)
	if !errors.Is(err, ErrMalwareBlocked) {
		t.Fatalf("PutUploadedObject() error = %v, want ErrMalwareBlocked", err)
	}
	if len(objects.deletedObjects) != 1 {
		t.Fatalf("deleted objects = %#v, want one cleanup delete", objects.deletedObjects)
	}
}

func TestPutUploadedObjectDeletesStoredObjectOnScannerError(t *testing.T) {
	objects := &recordingObjectStore{}
	scanner := &captureScanner{err: errors.New("scanner failed with Bearer abcdefghijklmnop")}
	service := NewService(NewRepository(&fakeDB{}), objects, scanner)

	_, _, err := service.PutUploadedObject(context.Background(), objectstore.Object{
		TenantID:    "tenant_1",
		Key:         "uploads/upload_1/logo.png",
		ContentType: "image/png",
	}, strings.NewReader("png-bytes"), false)
	if err == nil {
		t.Fatal("PutUploadedObject() error = nil, want scanner error")
	}
	if len(objects.deletedObjects) != 1 {
		t.Fatalf("deleted objects = %#v, want one cleanup delete", objects.deletedObjects)
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
				[]byte(`{"ppt_ready":{"status":"placeholder"},"figma_ready":{"status":"ready","schema":"zenari.figma_layout_spec.v1","layout":{"schema":"zenari.figma_layout_spec.v1"}},"thumbnail":{"status":"ready"}}`),
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
	if figmaReady["status"] != "ready" || figmaReady["schema"] != "zenari.figma_layout_spec.v1" {
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
				[]byte(`{"package_id":"package_1","provider_key":"` + stage0ProviderSecretFixture + `"}`),
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
		stage0ProviderSecretFixture,
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
				[]byte(`{"thumbnail":{"status":"ready"},"figma_ready":{"status":"ready","layout":{"schema":"zenari.figma_layout_spec.v1"}}}`),
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

func TestServiceGetExportSignsPersistedObjectKeyThroughBackendSigner(t *testing.T) {
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
	objects := &recordingObjectStore{signedURL: "https://storage.example.test/direct-s3-url"}
	var signerKey string
	service := NewService(NewRepository(db), objects).
		WithDownloadURLSigner(func(_ context.Context, _ string, key string, _ time.Duration) (string, error) {
			signerKey = key
			return "/api/v1/objects/download?key=tenants%2Ftenant_1%2Fexports%2Fcustom-export-object.zip&expires=1&sig=server", nil
		})

	export, err := service.GetExport(context.Background(), "tenant_1", "export_1")
	if err != nil {
		t.Fatalf("GetExport() error = %v", err)
	}
	if !strings.Contains(export.DownloadURL, "custom-export-object.zip") {
		t.Fatalf("DownloadURL = %q, want persisted object key", export.DownloadURL)
	}
	if strings.Contains(export.DownloadURL, "exports%2Fexport_1.zip") {
		t.Fatalf("DownloadURL = %q, should not use reconstructed export id path", export.DownloadURL)
	}
	if signerKey != "tenants/tenant_1/exports/custom-export-object.zip" {
		t.Fatalf("signer key = %q, want persisted object key", signerKey)
	}
	if objects.signKey != "" {
		t.Fatalf("object store SignGetURL should not be used for export downloads: %q", objects.signKey)
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

func TestServiceGetExportRequiresBackendMediatedDownloadSigner(t *testing.T) {
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
	if export.DownloadURL != "" {
		t.Fatalf("DownloadURL = %q, want empty without backend signer", export.DownloadURL)
	}
	if objects.signKey != "" || objects.signTenantID != "" || objects.signTTL != 0 {
		t.Fatalf("object store SignGetURL should not be used without backend signer: tenant/key/ttl = %q/%q/%s", objects.signTenantID, objects.signKey, objects.signTTL)
	}
}

func TestServiceGetExportUsesConfiguredDownloadSigner(t *testing.T) {
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
				[]byte(`{"id":"object_1","tenant_id":"tenant_1","project_id":"project_1","owner_id":"user_1","asset_type":"export","bucket":"exports-test","object_key":"tenants/tenant_1/exports/export_1.zip","content_type":"application/zip","byte_size":12,"checksum":"sha256:abc","provider":"s3-compatible","retention_state":"active","metadata":{},"created_at":"2026-05-26T00:00:00Z"}`),
			}},
		}},
	}
	objects := &recordingObjectStore{signedURL: "https://storage.example.test/direct-s3-url"}
	var signerTenantID, signerKey string
	var signerTTL time.Duration
	service := NewService(NewRepository(db), objects).
		WithDownloadURLTTL(2 * time.Minute).
		WithDownloadURLSigner(func(_ context.Context, tenantID, key string, ttl time.Duration) (string, error) {
			signerTenantID = tenantID
			signerKey = key
			signerTTL = ttl
			return "/api/v1/objects/download?key=tenants%2Ftenant_1%2Fexports%2Fexport_1.zip&expires=1&sig=server", nil
		})

	export, err := service.GetExport(context.Background(), "tenant_1", "export_1")
	if err != nil {
		t.Fatalf("GetExport() error = %v", err)
	}
	if export.DownloadURL != "/api/v1/objects/download?key=tenants%2Ftenant_1%2Fexports%2Fexport_1.zip&expires=1&sig=server" {
		t.Fatalf("DownloadURL = %q, want server-mediated signed URL", export.DownloadURL)
	}
	if signerTenantID != "tenant_1" || signerKey != "tenants/tenant_1/exports/export_1.zip" || signerTTL != 2*time.Minute {
		t.Fatalf("signer input tenant/key/ttl = %q/%q/%s", signerTenantID, signerKey, signerTTL)
	}
	if objects.signKey != "" {
		t.Fatalf("object store SignGetURL should not be used when server signer is configured: %q", objects.signKey)
	}
}

func TestRequireDownloadableObjectEnforcesRetentionStateAndExpiry(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	retentionUntil := now.Add(time.Hour)
	downloadableRow := []any{
		"object_1",
		"tenant_1",
		"project_1",
		"user_1",
		"export",
		"exports-test",
		"tenants/tenant_1/exports/export_1.zip",
		"application/zip",
		int64(12),
		"sha256:abc",
		"local",
		"active",
		retentionUntil,
		nil,
		[]byte(`{"download_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","public":"ok"}`),
		now.Add(-time.Minute),
	}
	db := &fakeDB{queryRows: []rowSet{
		{rows: [][]any{downloadableRow}},
		{rows: [][]any{downloadableRow}},
	}}
	repo := NewRepository(db)

	if err := repo.RequireDownloadableObject(context.Background(), "tenant_1", "exports/export_1.zip", now); err != nil {
		t.Fatalf("RequireDownloadableObject() error = %v", err)
	}
	metadata, err := repo.DownloadableObjectMetadata(context.Background(), "tenant_1", "exports/export_1.zip", now)
	if err != nil {
		t.Fatalf("DownloadableObjectMetadata() error = %v", err)
	}
	if metadata.ID != "object_1" || metadata.ProjectID == nil || *metadata.ProjectID != "project_1" || metadata.OwnerID == nil || *metadata.OwnerID != "user_1" {
		t.Fatalf("DownloadableObjectMetadata() = %#v, want object/project/owner context", metadata)
	}
	metadataBody, err := json.Marshal(metadata.Metadata)
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}
	if metadata.Metadata["public"] != "ok" || strings.Contains(string(metadataBody), "abcdef") {
		t.Fatalf("download metadata = %#v, want redacted signed URL secret and public field", metadata.Metadata)
	}
	query := db.queryRowsUsed[0]
	for _, fragment := range []string{
		"FROM object_metadata",
		"SELECT id, tenant_id, project_id, owner_id, asset_type",
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
	if result.Status != "completed" || result.FailedObjects != 0 {
		t.Fatalf("cleanup status = %q failed_objects = %d, want completed/0", result.Status, result.FailedObjects)
	}
	if len(db.execs) != 5 {
		t.Fatalf("exec count = %d, want lifecycle, lifecycle analytics, run analytics, and run audit refs", len(db.execs))
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
	if !strings.Contains(db.execs[3].sql, "'export_object_cleanup_run'") || !strings.Contains(db.execs[3].sql, "worker_batch_deleted_objects") || !strings.Contains(db.execs[3].sql, "'cleanup_status'") || !strings.Contains(db.execs[3].sql, "'failed_objects'") || !strings.Contains(db.execs[3].sql, "cleanup_scope") {
		t.Fatalf("cleanup run analytics SQL missing aggregate cleanup event: %s", db.execs[3].sql)
	}
	if db.execs[3].args[1] != result.ExpiredExports || db.execs[3].args[2] != result.OrphanedObjects || db.execs[3].args[3] != result.DeletedObjects || db.execs[3].args[4] != result.FailedObjects || db.execs[3].args[5] != "completed" {
		t.Fatalf("cleanup run analytics args = %#v, want result counts", db.execs[3].args)
	}
	if !strings.Contains(db.execs[4].sql, "INSERT INTO audit_logs") || !strings.Contains(db.execs[4].sql, "'object_retention_cleanup_run'") || !strings.Contains(db.execs[4].sql, "'system:object-retention-cleanup'") || !strings.Contains(db.execs[4].sql, "'cleanup_status'") || !strings.Contains(db.execs[4].sql, "'failed_objects'") || !strings.Contains(db.execs[4].sql, "cleanup_scope") {
		t.Fatalf("cleanup run audit SQL missing immutable audit ref: %s", db.execs[4].sql)
	}
	if db.execs[4].args[1] != result.ExpiredExports || db.execs[4].args[2] != result.OrphanedObjects || db.execs[4].args[3] != result.DeletedObjects || db.execs[4].args[4] != result.FailedObjects || db.execs[4].args[5] != "completed" {
		t.Fatalf("cleanup run audit args = %#v, want result counts", db.execs[4].args)
	}
}

func TestCleanupExpiredExportsAndOrphanedObjectsForTenantScopesLifecycle(t *testing.T) {
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("UPDATE 2"),
		},
	}
	repo := NewRepository(db)
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)

	result, err := repo.CleanupExpiredExportsAndOrphanedObjectsForTenant(context.Background(), "tenant_1", now, func(_ context.Context, _ time.Time) (int, error) {
		return 3, nil
	})
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenant() error = %v", err)
	}
	if result.ExpiredExports != 1 || result.OrphanedObjects != 2 || result.DeletedObjects != 3 {
		t.Fatalf("cleanup result = %#v, want 1/2/3", result)
	}
	if len(db.execs) != 5 {
		t.Fatalf("exec count = %d, want scoped lifecycle, run analytics, and audit refs", len(db.execs))
	}
	for i, call := range db.execs {
		if call.args[len(call.args)-1] != "tenant_1" {
			t.Fatalf("exec[%d] args = %#v, want tenant_1 scope as final arg", i, call.args)
		}
	}
	for _, fragment := range []string{"($2 = '' OR e.tenant_id = $2)", "($2 = '' OR tenant_id = $2)"} {
		if !strings.Contains(db.execs[0].sql, fragment) {
			t.Fatalf("expired cleanup SQL missing tenant guard %s: %s", fragment, db.execs[0].sql)
		}
	}
	if !strings.Contains(db.execs[1].sql, "($2 = '' OR o.tenant_id = $2)") {
		t.Fatalf("orphan cleanup SQL missing tenant guard: %s", db.execs[1].sql)
	}
	if !strings.Contains(db.execs[2].sql, "($2 = '' OR e.tenant_id = $2)") || !strings.Contains(db.execs[2].sql, "($2 = '' OR o.tenant_id = $2)") {
		t.Fatalf("cleanup lifecycle analytics missing tenant guard: %s", db.execs[2].sql)
	}
	if !strings.Contains(db.execs[3].sql, "($7 = '' OR tenant_id = $7)") {
		t.Fatalf("cleanup run analytics missing tenant guard: %s", db.execs[3].sql)
	}
	if !strings.Contains(db.execs[4].sql, "($7 = '' OR tenant_id = $7)") || !strings.Contains(db.execs[4].sql, "INSERT INTO audit_logs") {
		t.Fatalf("cleanup run audit refs missing tenant guard: %s", db.execs[4].sql)
	}
}

func TestCleanupExpiredExportsModeOnlyMarksExpiredExports(t *testing.T) {
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 2"),
			pgconn.NewCommandTag("SELECT 1"),
		},
	}
	repo := NewRepository(db)
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)

	result, err := repo.CleanupExpiredExportsAndOrphanedObjectsForTenantMode(context.Background(), "tenant_1", now, CleanupModeExpiredExports, nil)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenantMode(expired) error = %v", err)
	}
	if result.ExpiredExports != 2 || result.OrphanedObjects != 0 || result.Status != "completed" {
		t.Fatalf("expired-only cleanup result = %#v, want 2 expired and 0 orphaned", result)
	}
	if len(db.execs) != 2 {
		t.Fatalf("exec count = %d, want expired mutation and lifecycle analytics only", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "UPDATE exports") || strings.Contains(db.execs[0].sql, "orphaned_sources") {
		t.Fatalf("expired-only cleanup first exec = %s, want no orphan mutation", db.execs[0].sql)
	}
}

func TestCleanupOrphanModeOnlyMarksOrphanedObjects(t *testing.T) {
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 3"),
			pgconn.NewCommandTag("SELECT 1"),
		},
	}
	repo := NewRepository(db)
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)

	result, err := repo.CleanupExpiredExportsAndOrphanedObjectsForTenantMode(context.Background(), "tenant_1", now, CleanupModeOrphans, nil)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenantMode(orphan) error = %v", err)
	}
	if result.ExpiredExports != 0 || result.OrphanedObjects != 3 || result.Status != "completed" {
		t.Fatalf("orphan-only cleanup result = %#v, want 0 expired and 3 orphaned", result)
	}
	if len(db.execs) != 2 {
		t.Fatalf("exec count = %d, want orphan mutation and lifecycle analytics only", len(db.execs))
	}
	if !strings.Contains(db.execs[0].sql, "orphaned_sources") || strings.Contains(db.execs[0].sql, "UPDATE exports") {
		t.Fatalf("orphan-only cleanup first exec = %s, want no expired export mutation", db.execs[0].sql)
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
	if db.queryRowsUsed[0].args[2] != "" {
		t.Fatalf("cleanup tenant scope arg = %#v, want global empty scope", db.queryRowsUsed[0].args[2])
	}
}

func TestListCleanupObjectsForTenantAppliesTenantScope(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"object_1",
			"tenant_1",
			"tenants/tenant_1/exports/export_1.zip",
		}},
	}}}
	repo := NewRepository(db)

	objects, err := repo.ListCleanupObjectsForTenant(context.Background(), "tenant_1", now, 25)
	if err != nil {
		t.Fatalf("ListCleanupObjectsForTenant() error = %v", err)
	}
	if len(objects) != 1 {
		t.Fatalf("cleanup object count = %d, want 1", len(objects))
	}
	if !strings.Contains(db.queryRowsUsed[0].sql, "($3 = '' OR tenant_id = $3)") {
		t.Fatalf("cleanup selection SQL missing tenant guard: %s", db.queryRowsUsed[0].sql)
	}
	if db.queryRowsUsed[0].args[2] != "tenant_1" {
		t.Fatalf("cleanup tenant scope arg = %#v, want tenant_1", db.queryRowsUsed[0].args[2])
	}
}

func TestListCleanupObjectsForTenantModeRestrictsRetentionState(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"object_1",
			"tenant_1",
			"tenants/tenant_1/exports/export_1.zip",
		}},
	}}}
	repo := NewRepository(db)

	objects, err := repo.ListCleanupObjectsForTenantMode(context.Background(), "tenant_1", now, 25, CleanupModeExpiredExports)
	if err != nil {
		t.Fatalf("ListCleanupObjectsForTenantMode() error = %v", err)
	}
	if len(objects) != 1 {
		t.Fatalf("cleanup object count = %d, want 1", len(objects))
	}
	query := db.queryRowsUsed[0]
	for _, fragment := range []string{
		"$4 = 'expired_export_cleanup' AND retention_state = 'expired'",
		"$4 = 'orphan_cleanup' AND retention_state = 'orphaned'",
		"($3 = '' OR tenant_id = $3)",
	} {
		if !strings.Contains(query.sql, fragment) {
			t.Fatalf("mode cleanup selection SQL missing %s: %s", fragment, query.sql)
		}
	}
	if query.args[0] != now || query.args[1] != 25 || query.args[2] != "tenant_1" || query.args[3] != string(CleanupModeExpiredExports) {
		t.Fatalf("mode cleanup args = %#v, want now/25/tenant_1/expired_export_cleanup", query.args)
	}
}

func TestPreviewCleanupObjectsForTenantSelectsExpiredAndOrphanedWithoutMutation(t *testing.T) {
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

	objects, err := repo.PreviewCleanupObjectsForTenant(context.Background(), "tenant_1", now, 25)
	if err != nil {
		t.Fatalf("PreviewCleanupObjectsForTenant() error = %v", err)
	}
	if len(objects) != 2 {
		t.Fatalf("preview object count = %d, want 2", len(objects))
	}
	if len(db.execs) != 0 {
		t.Fatalf("preview should not mutate DB: %#v", db.execs)
	}
	query := db.queryRowsUsed[0]
	for _, fragment := range []string{
		"WITH expired_sources AS",
		"orphaned_sources AS",
		"cleanup_candidates AS",
		"o.derived_from_object_id = source.id",
		"tenant_id = $3",
		"LIMIT $2",
	} {
		if !strings.Contains(query.sql, fragment) {
			t.Fatalf("preview cleanup SQL missing %s: %s", fragment, query.sql)
		}
	}
	if query.args[0] != now || query.args[1] != 25 || query.args[2] != "tenant_1" {
		t.Fatalf("preview cleanup args = %#v, want now/25/tenant_1", query.args)
	}
}

func TestPreviewCleanupObjectsForTenantModeRestrictsCandidates(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"object_1",
			"tenant_1",
			"tenants/tenant_1/exports/orphan.zip",
		}},
	}}}
	repo := NewRepository(db)

	objects, err := repo.PreviewCleanupObjectsForTenantMode(context.Background(), "tenant_1", now, 25, CleanupModeOrphans)
	if err != nil {
		t.Fatalf("PreviewCleanupObjectsForTenantMode() error = %v", err)
	}
	if len(objects) != 1 {
		t.Fatalf("preview object count = %d, want 1", len(objects))
	}
	query := db.queryRowsUsed[0]
	for _, fragment := range []string{
		"$4 IN ('combined', 'expired_export_cleanup')",
		"$4 IN ('combined', 'orphan_cleanup')",
	} {
		if !strings.Contains(query.sql, fragment) {
			t.Fatalf("mode preview SQL missing %s: %s", fragment, query.sql)
		}
	}
	if query.args[0] != now || query.args[1] != 25 || query.args[2] != "tenant_1" || query.args[3] != string(CleanupModeOrphans) {
		t.Fatalf("mode preview args = %#v, want now/25/tenant_1/orphan_cleanup", query.args)
	}
}

func TestPreviewCleanupCountsForTenantCountsExpiredExportsAndOrphanedObjectsWithoutMutation(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{3, 2}},
	}}}
	repo := NewRepository(db)

	expiredExports, orphanedObjects, err := repo.PreviewCleanupCountsForTenant(context.Background(), "tenant_1", now)
	if err != nil {
		t.Fatalf("PreviewCleanupCountsForTenant() error = %v", err)
	}
	if expiredExports != 3 || orphanedObjects != 2 {
		t.Fatalf("preview counts = %d/%d, want 3 expired exports and 2 orphaned objects", expiredExports, orphanedObjects)
	}
	if len(db.execs) != 0 {
		t.Fatalf("preview counts should not mutate DB: %#v", db.execs)
	}
	query := db.queryRowsUsed[0]
	for _, fragment := range []string{
		"WITH expired_exports AS",
		"orphaned_sources AS",
		"orphaned_objects AS",
		"SELECT (SELECT COUNT(*) FROM expired_exports), (SELECT COUNT(*) FROM orphaned_objects)",
		"e.tenant_id = $2",
		"o.tenant_id = $2",
	} {
		if !strings.Contains(query.sql, fragment) {
			t.Fatalf("preview counts SQL missing %s: %s", fragment, query.sql)
		}
	}
	if query.args[0] != now || query.args[1] != "tenant_1" {
		t.Fatalf("preview counts args = %#v, want now/tenant_1", query.args)
	}
}

func TestPreviewCleanupCountsForTenantModeRestrictsCounts(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{3, 0}},
	}}}
	repo := NewRepository(db)

	expiredExports, orphanedObjects, err := repo.PreviewCleanupCountsForTenantMode(context.Background(), "tenant_1", now, CleanupModeExpiredExports)
	if err != nil {
		t.Fatalf("PreviewCleanupCountsForTenantMode() error = %v", err)
	}
	if expiredExports != 3 || orphanedObjects != 0 {
		t.Fatalf("preview counts = %d/%d, want 3 expired exports and 0 orphaned objects", expiredExports, orphanedObjects)
	}
	query := db.queryRowsUsed[0]
	for _, fragment := range []string{
		"$3 IN ('combined', 'expired_export_cleanup')",
		"$3 IN ('combined', 'orphan_cleanup')",
	} {
		if !strings.Contains(query.sql, fragment) {
			t.Fatalf("mode preview counts SQL missing %s: %s", fragment, query.sql)
		}
	}
	if query.args[0] != now || query.args[1] != "tenant_1" || query.args[2] != string(CleanupModeExpiredExports) {
		t.Fatalf("mode preview counts args = %#v, want now/tenant_1/expired_export_cleanup", query.args)
	}
}

func TestTenantCleanupEntryPointsRejectUnsafeTenantIDBeforeDB(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	for _, tenantID := range []string{"../tenant_1", "tenant_1/../../tenant_2", `tenant_1\tenant_2`, "tenant 1", "."} {
		t.Run(tenantID, func(t *testing.T) {
			db := &fakeDB{}
			repo := NewRepository(db)

			if _, err := repo.CleanupExpiredExportsAndOrphanedObjectsForTenant(context.Background(), tenantID, now, nil); !errors.Is(err, ErrValidation) {
				t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenant() error = %v, want ErrValidation", err)
			}
			if _, err := repo.ListCleanupObjectsForTenant(context.Background(), tenantID, now, 25); !errors.Is(err, ErrValidation) {
				t.Fatalf("ListCleanupObjectsForTenant() error = %v, want ErrValidation", err)
			}
			service := NewService(repo, &recordingObjectStore{})
			if _, err := service.CleanupExpiredExportsAndOrphanedObjectsForTenant(context.Background(), tenantID, now, 25); !errors.Is(err, ErrValidation) {
				t.Fatalf("Service CleanupExpiredExportsAndOrphanedObjectsForTenant() error = %v, want ErrValidation", err)
			}
			if _, err := service.PreviewExpiredExportsAndOrphanedObjectsForTenant(context.Background(), tenantID, now, 25); !errors.Is(err, ErrValidation) {
				t.Fatalf("Service PreviewExpiredExportsAndOrphanedObjectsForTenant() error = %v, want ErrValidation", err)
			}
			if _, _, err := repo.PreviewCleanupCountsForTenant(context.Background(), tenantID, now); !errors.Is(err, ErrValidation) {
				t.Fatalf("PreviewCleanupCountsForTenant() error = %v, want ErrValidation", err)
			}
			if len(db.execs) != 0 || len(db.queryRowsUsed) != 0 {
				t.Fatalf("invalid tenant cleanup should not touch DB: execs=%#v queries=%#v", db.execs, db.queryRowsUsed)
			}
		})
	}
}

func TestListCleanupObjectsRejectsCrossTenantScopedKeys(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{{
		rows: [][]any{{
			"object_1",
			"tenant_1",
			"tenants/tenant_2/exports/export_1.zip",
		}},
	}}}
	repo := NewRepository(db)

	_, err := repo.ListCleanupObjects(context.Background(), now, 25)
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("ListCleanupObjects() error = %v, want ErrValidation", err)
	}
}

func TestListCleanupObjectsRejectsUnsafeScopedKeys(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	for _, row := range []struct {
		name     string
		tenantID string
		key      string
	}{
		{
			name:     "path traversal",
			tenantID: "tenant_1",
			key:      "tenants/tenant_1/exports/../escape.zip",
		},
		{
			name:     "empty segment",
			tenantID: "tenant_1",
			key:      "tenants/tenant_1/exports//escape.zip",
		},
		{
			name:     "backslash",
			tenantID: "tenant_1",
			key:      `tenants/tenant_1/exports\escape.zip`,
		},
		{
			name:     "unsafe tenant",
			tenantID: "tenant_1/../tenant_2",
			key:      "tenants/tenant_1/../tenant_2/exports/escape.zip",
		},
		{
			name:     "space tenant",
			tenantID: "tenant 1",
			key:      "tenants/tenant 1/exports/escape.zip",
		},
	} {
		t.Run(row.name, func(t *testing.T) {
			db := &fakeDB{queryRows: []rowSet{{
				rows: [][]any{{
					"object_1",
					row.tenantID,
					row.key,
				}},
			}}}
			repo := NewRepository(db)

			_, err := repo.ListCleanupObjects(context.Background(), now, 25)
			if !errors.Is(err, ErrValidation) {
				t.Fatalf("ListCleanupObjects() error = %v, want ErrValidation", err)
			}
		})
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

func TestMarkCleanupObjectsDeletedRejectsCrossTenantScopedKeys(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{}
	repo := NewRepository(db)

	_, err := repo.MarkCleanupObjectsDeleted(context.Background(), []CleanupObject{
		{ID: "object_1", TenantID: "tenant_1", Key: "tenants/tenant_2/exports/export_1.zip"},
	}, now)
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("MarkCleanupObjectsDeleted() error = %v, want ErrValidation", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("invalid cleanup object should not write rows: %#v", db.execs)
	}
}

func TestMarkCleanupObjectsDeletedRejectsUnsafeScopedKeys(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	for _, object := range []CleanupObject{
		{ID: "object_1", TenantID: "tenant_1", Key: "tenants/tenant_1/exports/../escape.zip"},
		{ID: "object_1", TenantID: "tenant_1", Key: "tenants/tenant_1/exports//escape.zip"},
		{ID: "object_1", TenantID: "tenant_1", Key: `tenants/tenant_1/exports\escape.zip`},
		{ID: "object_1", TenantID: "tenant_1/../tenant_2", Key: "tenants/tenant_1/../tenant_2/exports/escape.zip"},
		{ID: "object_1", TenantID: "tenant 1", Key: "tenants/tenant 1/exports/escape.zip"},
	} {
		db := &fakeDB{}
		repo := NewRepository(db)

		_, err := repo.MarkCleanupObjectsDeleted(context.Background(), []CleanupObject{object}, now)
		if !errors.Is(err, ErrValidation) {
			t.Fatalf("MarkCleanupObjectsDeleted(%#v) error = %v, want ErrValidation", object, err)
		}
		if len(db.execs) != 0 {
			t.Fatalf("invalid cleanup object should not write rows: %#v", db.execs)
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
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{
			rows: [][]any{
				{"object_1", "tenant_1", "tenants/tenant_1/exports/export_1.zip"},
				{"object_2", "tenant_1", "tenants/tenant_1/thumbnails/export_1.zip.svg"},
			},
		}},
	}
	objects, err := objectstore.NewLocalStore(t.TempDir(), "zenari-test", "secret")
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
	markerOnlyExpiry := now.Add(-time.Minute)
	if _, err := objects.Put(context.Background(), objectstore.Object{
		TenantID:       "tenant_1",
		Key:            "exports/stale-marker-only.zip",
		RetentionUntil: &markerOnlyExpiry,
	}, strings.NewReader("stale data")); err != nil {
		t.Fatalf("Put(stale marker-only object) error = %v", err)
	}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjects(context.Background(), now, 50)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjects() error = %v", err)
	}
	if result.ExpiredExports != 1 || result.OrphanedObjects != 1 || result.DeletedObjects != 3 {
		t.Fatalf("cleanup result = %#v, want 1/1/3", result)
	}
	if result.Status != "completed" || result.FailedObjects != 0 {
		t.Fatalf("cleanup status = %q failed_objects = %d, want completed/0", result.Status, result.FailedObjects)
	}
	if _, err := objects.Get(context.Background(), "tenant_1", "exports/stale-marker-only.zip"); !errors.Is(err, objectstore.ErrNotFound) {
		t.Fatalf("stale marker-only object lookup error = %v, want ErrNotFound", err)
	}
	if len(db.execs) != 7 {
		t.Fatalf("exec count = %d, want repository mark, orphan mark, cleanup analytics, deleted mark, deletion analytics, cleanup run analytics, cleanup audit refs", len(db.execs))
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
	if !strings.Contains(db.execs[5].sql, "'export_object_cleanup_run'") || !strings.Contains(db.execs[5].sql, "ON CONFLICT (id) DO NOTHING") || !strings.Contains(db.execs[5].sql, "'cleanup_status'") || !strings.Contains(db.execs[5].sql, "'failed_objects'") {
		t.Fatalf("sixth exec should emit idempotent cleanup run analytics: %s", db.execs[5].sql)
	}
	if db.execs[5].args[1] != result.ExpiredExports || db.execs[5].args[2] != result.OrphanedObjects || db.execs[5].args[3] != result.DeletedObjects || db.execs[5].args[4] != result.FailedObjects || db.execs[5].args[5] != "completed" {
		t.Fatalf("cleanup run analytics args = %#v, want result counts", db.execs[5].args)
	}
	if !strings.Contains(db.execs[6].sql, "INSERT INTO audit_logs") || !strings.Contains(db.execs[6].sql, "'cleanup_ack_scope'") || !strings.Contains(db.execs[6].sql, "'cleanup_status'") || !strings.Contains(db.execs[6].sql, "'failed_objects'") {
		t.Fatalf("seventh exec should emit cleanup audit refs: %s", db.execs[6].sql)
	}
}

func TestTenantScopedServiceCleanupDoesNotSweepGlobalObjectStoreMarkers(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{}},
	}
	objects := &recordingObjectStore{}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjectsForTenant(context.Background(), "tenant_1", now, 50)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenant() error = %v", err)
	}
	if result.DeletedObjects != 0 || result.FailedObjects != 0 || result.Status != "completed" {
		t.Fatalf("tenant cleanup result = %#v, want empty completed result", result)
	}
	if objects.cleanupExpiredCalled {
		t.Fatal("tenant-scoped admin cleanup must not run global object-store marker cleanup")
	}
	if !objects.cleanupExpiredForTenantCalled || objects.cleanupExpiredTenantID != "tenant_1" {
		t.Fatalf("tenant cleanup marker sweep = %v/%q, want tenant_1", objects.cleanupExpiredForTenantCalled, objects.cleanupExpiredTenantID)
	}
	if len(db.execs) != 3 {
		t.Fatalf("exec count = %d, want repository mark, orphan mark, cleanup lifecycle analytics only", len(db.execs))
	}
}

func TestTenantScopedServiceCleanupDeletesTenantExpiredMarkers(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{}},
	}
	objects := &recordingObjectStore{cleanupExpiredForTenantCount: 2}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjectsForTenant(context.Background(), "tenant_1", now, 50)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenant() error = %v", err)
	}
	if result.DeletedObjects != 2 || result.FailedObjects != 0 || result.Status != "completed" {
		t.Fatalf("tenant cleanup result = %#v, want two scoped marker deletes", result)
	}
	if objects.cleanupExpiredCalled {
		t.Fatal("tenant-scoped admin cleanup must not run global object-store marker cleanup")
	}
	if !objects.cleanupExpiredForTenantCalled || objects.cleanupExpiredTenantID != "tenant_1" {
		t.Fatalf("tenant cleanup marker sweep = %v/%q, want tenant_1", objects.cleanupExpiredForTenantCalled, objects.cleanupExpiredTenantID)
	}
	if len(db.execs) != 5 {
		t.Fatalf("exec count = %d, want lifecycle, cleanup run analytics, cleanup audit refs", len(db.execs))
	}
	if !strings.Contains(db.execs[3].sql, "'export_object_cleanup_run'") || db.execs[3].args[3] != result.DeletedObjects {
		t.Fatalf("cleanup run analytics args/sql = %#v / %s, want scoped marker delete count", db.execs[3].args, db.execs[3].sql)
	}
	if !strings.Contains(db.execs[3].sql, "SELECT $7, 0, 0, $4") || !strings.Contains(db.execs[3].sql, "($4 > 0 OR $5 > 0)") {
		t.Fatalf("cleanup run analytics should create scoped marker-only evidence row: %s", db.execs[3].sql)
	}
	if !strings.Contains(db.execs[4].sql, "INSERT INTO audit_logs") || db.execs[4].args[3] != result.DeletedObjects {
		t.Fatalf("cleanup run audit args/sql = %#v / %s, want scoped marker delete count", db.execs[4].args, db.execs[4].sql)
	}
	if !strings.Contains(db.execs[4].sql, "SELECT $7, 0, 0, $4") || !strings.Contains(db.execs[4].sql, "($4 > 0 OR $5 > 0)") {
		t.Fatalf("cleanup run audit should create scoped marker-only evidence row: %s", db.execs[4].sql)
	}
}

func TestTenantScopedServiceCleanupModeOnlyDeletesMatchingRepositoryRows(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{
			rows: [][]any{{
				"object_expired",
				"tenant_1",
				"tenants/tenant_1/exports/expired.zip",
			}},
		}},
	}
	objects := &recordingObjectStore{}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjectsForTenantMode(context.Background(), "tenant_1", now, 25, CleanupModeExpiredExports)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenantMode() error = %v", err)
	}
	if result.ExpiredExports != 1 || result.OrphanedObjects != 0 || result.DeletedObjects != 1 || result.Status != "completed" {
		t.Fatalf("expired-only cleanup result = %#v, want one expired delete and no orphan delete", result)
	}
	if len(objects.deletedObjects) != 1 || objects.deletedObjects[0].key != "tenants/tenant_1/exports/expired.zip" {
		t.Fatalf("deleted objects = %#v, want only expired candidate", objects.deletedObjects)
	}
	if objects.cleanupExpiredCalled || !objects.cleanupExpiredForTenantCalled || objects.cleanupExpiredTenantID != "tenant_1" {
		t.Fatalf("marker cleanup scope global=%v tenant=%v/%q", objects.cleanupExpiredCalled, objects.cleanupExpiredForTenantCalled, objects.cleanupExpiredTenantID)
	}
	if len(db.execs) != 6 {
		t.Fatalf("exec count = %d, want expired mutation, lifecycle analytics, delete ack, delete analytics, run analytics, audit refs", len(db.execs))
	}
	if strings.Contains(db.execs[0].sql, "orphaned_sources") {
		t.Fatalf("expired-only mutation must not mark orphaned objects: %s", db.execs[0].sql)
	}
	if len(db.queryRowsUsed) != 1 {
		t.Fatalf("cleanup query count = %d, want one mode-scoped object list", len(db.queryRowsUsed))
	}
	query := db.queryRowsUsed[0]
	if query.args[3] != string(CleanupModeExpiredExports) {
		t.Fatalf("cleanup object list mode arg = %#v, want expired_export_cleanup", query.args[3])
	}
	if !strings.Contains(query.sql, "$4 = 'expired_export_cleanup' AND retention_state = 'expired'") {
		t.Fatalf("cleanup object list must be mode-scoped: %s", query.sql)
	}
}

func TestTenantScopedOrphanCleanupModeDoesNotSweepExpiredMarkers(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{
			rows: [][]any{{
				"object_orphan",
				"tenant_1",
				"tenants/tenant_1/exports/orphan.zip",
			}},
		}},
	}
	objects := &recordingObjectStore{cleanupExpiredForTenantCount: 5}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjectsForTenantMode(context.Background(), "tenant_1", now, 25, CleanupModeOrphans)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenantMode(orphan) error = %v", err)
	}
	if result.ExpiredExports != 0 || result.OrphanedObjects != 1 || result.DeletedObjects != 1 || result.Status != "completed" {
		t.Fatalf("orphan-only cleanup result = %#v, want one orphan delete and no expired marker sweep", result)
	}
	if len(objects.deletedObjects) != 1 || objects.deletedObjects[0].key != "tenants/tenant_1/exports/orphan.zip" {
		t.Fatalf("deleted objects = %#v, want only orphan candidate", objects.deletedObjects)
	}
	if objects.cleanupExpiredCalled || objects.cleanupExpiredForTenantCalled {
		t.Fatalf("orphan-only cleanup must not sweep expired object-store markers: %#v", objects)
	}
	query := db.queryRowsUsed[0]
	if query.args[3] != string(CleanupModeOrphans) {
		t.Fatalf("cleanup object list mode arg = %#v, want orphan_cleanup", query.args[3])
	}
	if !strings.Contains(query.sql, "$4 = 'orphan_cleanup' AND retention_state = 'orphaned'") {
		t.Fatalf("cleanup object list must be orphan-scoped: %s", query.sql)
	}
}

func TestServicePreviewCleanupDoesNotDeleteStorageOrMutateRows(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{
		{rows: [][]any{{1, 2}}},
		{rows: [][]any{
			{"object_1", "tenant_1", "tenants/tenant_1/exports/export_1.zip"},
			{"object_2", "tenant_1", "tenants/tenant_1/thumbnails/export_1.zip.svg"},
		}},
	}}
	objects := &recordingObjectStore{cleanupExpiredForTenantCount: 2}
	service := NewService(NewRepository(db), objects)

	result, err := service.PreviewExpiredExportsAndOrphanedObjectsForTenant(context.Background(), "tenant_1", now, 50)
	if err != nil {
		t.Fatalf("PreviewExpiredExportsAndOrphanedObjectsForTenant() error = %v", err)
	}
	if !result.DryRun || result.Status != "preview" || result.ExpiredExports != 1 || result.OrphanedObjects != 2 || result.PreviewObjects != 2 || result.DeletedObjects != 0 || result.FailedObjects != 0 {
		t.Fatalf("preview result = %#v, want dry-run preview with 2 candidate objects", result)
	}
	if len(db.execs) != 0 {
		t.Fatalf("preview should not mutate repository rows: %#v", db.execs)
	}
	if len(objects.deletedKeys) != 0 || objects.cleanupExpiredCalled || objects.cleanupExpiredForTenantCalled {
		t.Fatalf("preview should not touch object storage deletes/marker cleanup: %#v", objects)
	}
}

func TestServicePreviewCleanupModeOnlyCountsAndListsSelectedClass(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{queryRows: []rowSet{
		{rows: [][]any{{0, 2}}},
		{rows: [][]any{
			{"object_1", "tenant_1", "tenants/tenant_1/exports/orphan_1.zip"},
			{"object_2", "tenant_1", "tenants/tenant_1/thumbnails/orphan_1.zip.svg"},
		}},
	}}
	objects := &recordingObjectStore{}
	service := NewService(NewRepository(db), objects)

	result, err := service.PreviewExpiredExportsAndOrphanedObjectsForTenantMode(context.Background(), "tenant_1", now, 50, CleanupModeOrphans)
	if err != nil {
		t.Fatalf("PreviewExpiredExportsAndOrphanedObjectsForTenantMode() error = %v", err)
	}
	if !result.DryRun || result.Status != "preview" || result.ExpiredExports != 0 || result.OrphanedObjects != 2 || result.PreviewObjects != 2 || result.DeletedObjects != 0 {
		t.Fatalf("orphan preview result = %#v, want orphan-only dry-run preview", result)
	}
	if len(db.execs) != 0 {
		t.Fatalf("preview should not mutate repository rows: %#v", db.execs)
	}
	if len(objects.deletedKeys) != 0 || objects.cleanupExpiredCalled || objects.cleanupExpiredForTenantCalled {
		t.Fatalf("preview should not touch object storage: %#v", objects)
	}
	if len(db.queryRowsUsed) != 2 {
		t.Fatalf("preview query count = %d, want counts and candidate list", len(db.queryRowsUsed))
	}
	if db.queryRowsUsed[0].args[2] != string(CleanupModeOrphans) || db.queryRowsUsed[1].args[3] != string(CleanupModeOrphans) {
		t.Fatalf("preview mode args = %#v / %#v, want orphan_cleanup", db.queryRowsUsed[0].args, db.queryRowsUsed[1].args)
	}
}

func TestTenantScopedServiceCleanupDeletesObjectsWithRowTenantScope(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{
			rows: [][]any{{
				"object_1",
				"tenant_1",
				"tenants/tenant_1/exports/export_1.zip",
			}},
		}},
	}
	objects := &recordingObjectStore{}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjectsForTenant(context.Background(), "tenant_1", now, 25)
	if err != nil {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenant() error = %v", err)
	}
	if result.DeletedObjects != 1 || result.FailedObjects != 0 || result.Status != "completed" {
		t.Fatalf("tenant cleanup result = %#v, want one deleted object", result)
	}
	if len(objects.deletedObjects) != 1 {
		t.Fatalf("deleted objects = %#v, want one object", objects.deletedObjects)
	}
	deleted := objects.deletedObjects[0]
	if deleted.tenantID != "tenant_1" || deleted.key != "tenants/tenant_1/exports/export_1.zip" {
		t.Fatalf("deleted object = %#v, want tenant-scoped key", deleted)
	}
	if !objects.cleanupExpiredForTenantCalled || objects.cleanupExpiredTenantID != "tenant_1" || objects.cleanupExpiredCalled {
		t.Fatalf("marker cleanup scope global=%v tenant=%v/%q", objects.cleanupExpiredCalled, objects.cleanupExpiredForTenantCalled, objects.cleanupExpiredTenantID)
	}
}

func TestTenantScopedServiceCleanupRejectsRepositoryRowsForOtherTenantBeforeDelete(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{
			rows: [][]any{{
				"object_2",
				"tenant_2",
				"tenants/tenant_2/exports/export_2.zip",
			}},
		}},
	}
	objects := &recordingObjectStore{}
	service := NewService(NewRepository(db), objects)

	_, err := service.CleanupExpiredExportsAndOrphanedObjectsForTenant(context.Background(), "tenant_1", now, 25)
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjectsForTenant() error = %v, want ErrValidation", err)
	}
	if len(objects.deletedKeys) != 0 || objects.cleanupExpiredCalled || objects.cleanupExpiredForTenantCalled {
		t.Fatalf("cross-tenant cleanup row must not touch object storage: %#v", objects)
	}
	if len(db.execs) != 3 {
		t.Fatalf("exec count = %d, want lifecycle analytics before validation failure only", len(db.execs))
	}
	for _, call := range db.execs {
		if strings.Contains(call.sql, "retention_state = 'deleted'") || strings.Contains(call.sql, "'object_deleted'") || strings.Contains(call.sql, "'export_object_cleanup_run'") {
			t.Fatalf("cross-tenant row should not be marked or audited as deleted: %#v", db.execs)
		}
	}
}

func TestServiceCleanupRejectsCrossTenantRowsBeforeObjectDelete(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{
			rows: [][]any{
				{"object_1", "tenant_1", "tenants/tenant_2/exports/export_1.zip"},
			},
		}},
	}
	objects, err := objectstore.NewLocalStore(t.TempDir(), "zenari-test", "secret")
	if err != nil {
		t.Fatalf("NewLocalStore() error = %v", err)
	}
	service := NewService(NewRepository(db), objects)

	_, err = service.CleanupExpiredExportsAndOrphanedObjects(context.Background(), now, 50)
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjects() error = %v, want ErrValidation", err)
	}
	if len(db.execs) != 3 {
		t.Fatalf("exec count = %d, want repository mark, orphan mark, cleanup analytics only", len(db.execs))
	}
	for _, call := range db.execs {
		if strings.Contains(call.sql, "retention_state = 'deleted'") || strings.Contains(call.sql, "'object_deleted'") {
			t.Fatalf("cross-tenant cleanup row should not be marked deleted: %#v", db.execs)
		}
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
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{
			rows: [][]any{
				{"object_1", "tenant_1", "tenants/tenant_1/exports/missing.zip"},
				{"object_2", "tenant_1", "tenants/tenant_1/thumbnails/missing.zip.svg"},
			},
		}},
	}
	objects, err := objectstore.NewLocalStore(t.TempDir(), "zenari-test", "secret")
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
	if len(db.execs) != 7 {
		t.Fatalf("exec count = %d, want repository mark, orphan mark, cleanup analytics, deleted mark, deletion analytics, cleanup run analytics, cleanup audit refs", len(db.execs))
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
	if !strings.Contains(db.execs[5].sql, "'export_object_cleanup_run'") {
		t.Fatalf("sixth exec should emit cleanup run analytics: %s", db.execs[5].sql)
	}
	if !strings.Contains(db.execs[6].sql, "INSERT INTO audit_logs") || !strings.Contains(db.execs[6].sql, "'object_retention_cleanup_run'") {
		t.Fatalf("seventh exec should emit cleanup audit refs: %s", db.execs[6].sql)
	}
}

func TestServiceCleanupMarksSuccessfulDeletesBeforeReturningStorageError(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{
			rows: [][]any{
				{"object_1", "tenant_1", "tenants/tenant_1/exports/export_1.zip"},
				{"object_2", "tenant_1", "tenants/tenant_1/thumbnails/export_1.zip.svg"},
			},
		}},
	}
	objects := &recordingObjectStore{
		deleteErrors: map[string]error{
			"tenants/tenant_1/thumbnails/export_1.zip.svg": errors.New("s3 delete throttled"),
		},
	}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjects(context.Background(), now, 50)
	if err == nil || !strings.Contains(err.Error(), "s3 delete throttled") {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjects() error = %v, want storage delete error", err)
	}
	if result.DeletedObjects != 1 {
		t.Fatalf("deleted objects = %d, want one successfully deleted row marked before error return", result.DeletedObjects)
	}
	if result.FailedObjects != 1 || result.Status != "partial_failed" {
		t.Fatalf("cleanup failed/status = %d/%q, want 1/partial_failed", result.FailedObjects, result.Status)
	}
	if len(objects.deletedKeys) != 2 {
		t.Fatalf("deleted key attempts = %#v, want both cleanup objects attempted", objects.deletedKeys)
	}
	if len(db.execs) != 7 {
		t.Fatalf("exec count = %d, want lifecycle, partial deleted mark, deletion analytics, cleanup run analytics, cleanup audit refs", len(db.execs))
	}
	payload, ok := db.execs[3].args[0].([]byte)
	if !ok {
		t.Fatalf("partial cleanup payload type = %T, want []byte", db.execs[3].args[0])
	}
	if !strings.Contains(string(payload), `"object_key":"tenants/tenant_1/exports/export_1.zip"`) {
		t.Fatalf("partial cleanup payload = %s, missing successful delete", string(payload))
	}
	if strings.Contains(string(payload), "thumbnails/export_1.zip.svg") {
		t.Fatalf("partial cleanup payload = %s, should not mark failed delete", string(payload))
	}
	if !strings.Contains(db.execs[5].sql, "'export_object_cleanup_run'") {
		t.Fatalf("cleanup run analytics should still be emitted for partial success: %s", db.execs[5].sql)
	}
	if db.execs[5].args[3] != result.DeletedObjects || db.execs[5].args[4] != result.FailedObjects || db.execs[5].args[5] != "partial_failed" {
		t.Fatalf("cleanup run analytics args = %#v, want partial failure counts/status", db.execs[5].args)
	}
	if !strings.Contains(db.execs[6].sql, "INSERT INTO audit_logs") || db.execs[6].args[4] != result.FailedObjects || db.execs[6].args[5] != "partial_failed" {
		t.Fatalf("cleanup run audit refs should still be emitted for partial success: %s", db.execs[6].sql)
	}
}

func TestServiceCleanupTreatsMissingMetadataAckAsPartialFailure(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("SELECT 1"),
			pgconn.NewCommandTag("UPDATE 1"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		queryRows: []rowSet{{
			rows: [][]any{
				{"object_1", "tenant_1", "tenants/tenant_1/exports/export_1.zip"},
				{"object_2", "tenant_1", "tenants/tenant_1/thumbnails/export_1.zip.svg"},
			},
		}},
	}
	objects := &recordingObjectStore{}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjects(context.Background(), now, 50)
	if err == nil || !strings.Contains(err.Error(), "metadata acknowledgement missing") {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjects() error = %v, want missing metadata ack error", err)
	}
	if result.DeletedObjects != 1 || result.FailedObjects != 1 || result.Status != "partial_failed" {
		t.Fatalf("cleanup result = %#v, want one deleted ack and one partial failure", result)
	}
	if len(objects.deletedKeys) != 2 {
		t.Fatalf("deleted key attempts = %#v, want both cleanup objects attempted", objects.deletedKeys)
	}
	if len(db.execs) != 7 {
		t.Fatalf("exec count = %d, want lifecycle, partial deleted mark, deletion analytics, cleanup run analytics, cleanup audit refs", len(db.execs))
	}
	if !strings.Contains(db.execs[5].sql, "'export_object_cleanup_run'") || db.execs[5].args[3] != result.DeletedObjects || db.execs[5].args[4] != result.FailedObjects || db.execs[5].args[5] != "partial_failed" {
		t.Fatalf("cleanup run analytics args/sql = %#v / %s, want partial ack failure", db.execs[5].args, db.execs[5].sql)
	}
	if !strings.Contains(db.execs[6].sql, "INSERT INTO audit_logs") || db.execs[6].args[3] != result.DeletedObjects || db.execs[6].args[4] != result.FailedObjects || db.execs[6].args[5] != "partial_failed" {
		t.Fatalf("cleanup run audit args/sql = %#v / %s, want partial ack failure", db.execs[6].args, db.execs[6].sql)
	}
}

func TestServiceCleanupAuditsMetadataAckWriteFailure(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	db := &fakeDB{
		execTags: []pgconn.CommandTag{
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("UPDATE 0"),
			pgconn.NewCommandTag("SELECT 1"),
		},
		execErrs: []error{
			nil,
			nil,
			nil,
			errors.New("metadata ack write failed"),
		},
		queryRows: []rowSet{{
			rows: [][]any{
				{"object_1", "tenant_1", "tenants/tenant_1/exports/export_1.zip"},
				{"object_2", "tenant_1", "tenants/tenant_1/thumbnails/export_1.zip.svg"},
			},
		}},
	}
	objects := &recordingObjectStore{}
	service := NewService(NewRepository(db), objects)

	result, err := service.CleanupExpiredExportsAndOrphanedObjects(context.Background(), now, 50)
	if err == nil || !strings.Contains(err.Error(), "metadata ack write failed") {
		t.Fatalf("CleanupExpiredExportsAndOrphanedObjects() error = %v, want metadata ack write failure", err)
	}
	if result.DeletedObjects != 0 || result.FailedObjects != 2 || result.Status != "partial_failed" {
		t.Fatalf("cleanup result = %#v, want no acked deletes and two failed objects", result)
	}
	if len(objects.deletedKeys) != 2 {
		t.Fatalf("deleted key attempts = %#v, want both cleanup objects attempted", objects.deletedKeys)
	}
	if len(db.execs) != 6 {
		t.Fatalf("exec count = %d, want lifecycle, failed mark, cleanup run analytics, cleanup audit refs", len(db.execs))
	}
	if !strings.Contains(db.execs[3].sql, "retention_state = 'deleted'") {
		t.Fatalf("fourth exec should attempt metadata delete acknowledgement: %s", db.execs[3].sql)
	}
	if !strings.Contains(db.execs[4].sql, "'export_object_cleanup_run'") || db.execs[4].args[3] != result.DeletedObjects || db.execs[4].args[4] != result.FailedObjects || db.execs[4].args[5] != "partial_failed" {
		t.Fatalf("cleanup run analytics args/sql = %#v / %s, want partial ack-write failure", db.execs[4].args, db.execs[4].sql)
	}
	if !strings.Contains(db.execs[5].sql, "INSERT INTO audit_logs") || db.execs[5].args[3] != result.DeletedObjects || db.execs[5].args[4] != result.FailedObjects || db.execs[5].args[5] != "partial_failed" {
		t.Fatalf("cleanup run audit args/sql = %#v / %s, want partial ack-write failure", db.execs[5].args, db.execs[5].sql)
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

func TestRecordAnalyticsEventNormalizesTaxonomyAndRejectsUnknownEvents(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	err := repo.RecordAnalyticsEvent(context.Background(), AnalyticsEvent{
		ID:          "analytics_1",
		TenantID:    "tenant_1",
		UserID:      " user_1 ",
		ProjectID:   " project_1 ",
		WorkflowID:  " workflow_1 ",
		EventName:   " Export_Completed ",
		SubjectType: " Export ",
		SubjectID:   " export_1 ",
		Properties:  map[string]any{"format": "zip"},
	})
	if err != nil {
		t.Fatalf("RecordAnalyticsEvent() error = %v", err)
	}
	if len(db.execs) != 1 {
		t.Fatalf("exec count = %d, want normalized analytics insert", len(db.execs))
	}
	if db.execs[0].args[3] != "project_1" || db.execs[0].args[4] != "workflow_1" || db.execs[0].args[5] != "export_completed" || db.execs[0].args[6] != "export" || db.execs[0].args[7] != "export_1" {
		t.Fatalf("analytics args = %#v, want normalized taxonomy/scope", db.execs[0].args)
	}

	beforeUnknown := len(db.execs)
	err = repo.RecordAnalyticsEvent(context.Background(), AnalyticsEvent{
		TenantID:    "tenant_1",
		EventName:   "secret_event",
		SubjectType: "export",
		SubjectID:   "export_1",
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("RecordAnalyticsEvent() error = %v, want ErrValidation for unknown event", err)
	}
	if len(db.execs) != beforeUnknown {
		t.Fatalf("unknown analytics event should not write rows: %#v", db.execs)
	}
}

func TestRecordAnalyticsEventRejectsUnsafeScopeReferences(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	err := repo.RecordAnalyticsEvent(context.Background(), AnalyticsEvent{
		TenantID:    "tenant_1",
		WorkflowID:  "../tenant_2/workflow",
		EventName:   "export_completed",
		SubjectType: "export",
		SubjectID:   "export_1",
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("RecordAnalyticsEvent() error = %v, want ErrValidation for unsafe workflow_id", err)
	}
	if len(db.execs) != 0 {
		t.Fatalf("unsafe analytics scope should not write rows: %#v", db.execs)
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

func TestListAnalyticsEventsRejectsUnsupportedFiltersBeforeQuery(t *testing.T) {
	db := &fakeDB{}
	repo := NewRepository(db)

	_, err := repo.ListAnalyticsEvents(context.Background(), AnalyticsEventFilters{
		TenantID:    "tenant_1",
		EventName:   "unknown_event",
		SubjectType: "export",
		SubjectID:   "export_1",
		Limit:       25,
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("ListAnalyticsEvents() error = %v, want ErrValidation", err)
	}
	if len(db.queryRowsUsed) != 0 {
		t.Fatalf("unsupported analytics filter should not query storage: %#v", db.queryRowsUsed)
	}

	_, err = repo.ListAnalyticsEvents(context.Background(), AnalyticsEventFilters{
		TenantID:    "tenant_1",
		EventName:   "export_completed",
		SubjectType: "export/../../tenant_2",
		SubjectID:   "export_1",
		Limit:       25,
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("ListAnalyticsEvents() unsafe subject_type error = %v, want ErrValidation", err)
	}
	if len(db.queryRowsUsed) != 0 {
		t.Fatalf("unsafe analytics filter should not query storage: %#v", db.queryRowsUsed)
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
		"package_asset_counts",
		"average_assets_per_package",
		"COUNT(pi.id) AS package_assets",
		"ARRAY['tenant_id','package_id','item_type']",
		"export_object_cleanup",
		"export_expired",
		"object_orphaned",
		"object_deleted",
		"export_object_cleanup_run",
		"weekly_return",
		"current_active_users",
		"previous_active_users",
		"returning_users",
		"cost_per_successful_package",
		"provider_usage_logs",
		"provider_cost_cents",
		"successful_packages",
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
		UserAgent:        "ZenariStage0Bot/0.1",
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
	for _, fragment := range []string{`"user_agent":"ZenariStage0Bot/0.1"`, `"global_rps":0.2`, `"source_rps":0.1`, `"raw_retention_days":14`, `"robots_policy"`} {
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
		UserAgent:        "ZenariStage0Bot/0.1",
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
		UserAgent:        "ZenariStage0Bot/0.1",
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
		UserAgent:        "ZenariStage0Bot/0.1",
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
		UserAgent:        "ZenariStage0Bot/0.1",
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
		UserAgent:        "ZenariStage0Bot/0.1",
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
		UserAgent:        "ZenariStage0Bot/0.1",
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
		UserAgent:        "ZenariStage0Bot/0.1",
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
		UserAgent:        "ZenariStage0Bot/0.1",
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
	execErrs      []error
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
	var err error
	if len(f.execErrs) > 0 {
		err = f.execErrs[0]
		f.execErrs = f.execErrs[1:]
	}
	if len(f.execTags) == 0 {
		return pgconn.CommandTag{}, err
	}
	tag := f.execTags[0]
	f.execTags = f.execTags[1:]
	return tag, err
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
	if len(f.queryRows) > 0 {
		rows := f.queryRows[0]
		f.queryRows = f.queryRows[1:]
		if len(rows.rows) > 0 {
			return fakeRow{row: rows.rows[0]}
		}
	}
	return fakeRow{err: pgx.ErrNoRows}
}

type rowSet struct {
	rows [][]any
}

type recordingObjectStore struct {
	signedURL                     string
	signTenantID                  string
	signKey                       string
	signTTL                       time.Duration
	deleteErrors                  map[string]error
	deletedKeys                   []string
	deletedObjects                []deletedObject
	cleanupExpiredCalled          bool
	cleanupExpiredCount           int
	cleanupExpiredError           error
	cleanupExpiredForTenantCalled bool
	cleanupExpiredTenantID        string
	cleanupExpiredForTenantCount  int
	cleanupExpiredForTenantError  error
}

type deletedObject struct {
	tenantID string
	key      string
}

func (s *recordingObjectStore) Put(_ context.Context, object objectstore.Object, _ io.Reader) (objectstore.Object, error) {
	object.ByteSize = int64(len("png-bytes"))
	if object.Checksum == "" || object.Checksum == "sha256:old" {
		object.Checksum = "sha256:stored"
	}
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

func (s *recordingObjectStore) Delete(_ context.Context, tenantID string, key string) error {
	s.deletedObjects = append(s.deletedObjects, deletedObject{tenantID: tenantID, key: key})
	s.deletedKeys = append(s.deletedKeys, key)
	if s.deleteErrors != nil {
		if err := s.deleteErrors[key]; err != nil {
			return err
		}
	}
	return nil
}

func (s *recordingObjectStore) CleanupExpired(_ context.Context, _ time.Time) (int, error) {
	s.cleanupExpiredCalled = true
	return s.cleanupExpiredCount, s.cleanupExpiredError
}

func (s *recordingObjectStore) CleanupExpiredForTenant(_ context.Context, tenantID string, _ time.Time) (int, error) {
	s.cleanupExpiredForTenantCalled = true
	s.cleanupExpiredTenantID = tenantID
	return s.cleanupExpiredForTenantCount, s.cleanupExpiredForTenantError
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
	case *int64:
		*ptr = value.(int64)
	case *float64:
		*ptr = value.(float64)
	case *bool:
		*ptr = value.(bool)
	case *[]string:
		*ptr = value.([]string)
	case *time.Time:
		*ptr = value.(time.Time)
	case **time.Time:
		if value == nil {
			*ptr = nil
			return
		}
		switch v := value.(type) {
		case time.Time:
			*ptr = &v
		case *time.Time:
			*ptr = v
		default:
			panic("unsupported nullable time scan value")
		}
	default:
		panic("unsupported scan destination")
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
