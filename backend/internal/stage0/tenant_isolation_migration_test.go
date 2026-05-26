package stage0

import (
	"os"
	"strings"
	"testing"
)

func TestTenantIsolationMigrationCoversRev2BackendSurfaces(t *testing.T) {
	data, err := os.ReadFile("../../migrations/0005_tenant_isolation_constraints.sql")
	if err != nil {
		t.Fatalf("read tenant isolation migration: %v", err)
	}
	sql := string(data)

	required := map[string][]string{
		"projects": {
			"SELECT add_tenant_fk_if_missing('fk_projects_tenant_owner', 'projects', 'tenant_id, owner_id', 'users', 'tenant_id, id');",
		},
		"workspaces": {
			"SELECT add_tenant_fk_if_missing('fk_workspaces_tenant_project', 'workspaces', 'tenant_id, project_id', 'projects', 'tenant_id, id');",
		},
		"chat": {
			"fk_chat_sessions_tenant_project",
			"fk_chat_sessions_tenant_user",
			"fk_chat_messages_tenant_session",
		},
		"canvas": {
			"fk_canvas_versions_tenant_workspace",
			"fk_canvas_frames_tenant_workspace",
			"fk_canvas_nodes_tenant_workspace",
			"fk_canvas_edges_tenant_from_node",
			"fk_canvas_edges_tenant_to_node",
		},
		"assets": {
			"fk_uploads_tenant_project",
			"fk_object_metadata_tenant_upload",
			"fk_object_metadata_tenant_project",
			"fk_assets_tenant_object",
			"fk_assets_tenant_candidate_asset",
		},
		"packages": {
			"fk_packages_tenant_project",
			"fk_package_items_tenant_package",
			"fk_package_items_tenant_asset",
		},
		"exports": {
			"fk_exports_tenant_package",
			"fk_exports_tenant_task",
			"fk_exports_tenant_object",
			"fk_exports_tenant_project",
		},
		"quota": {
			"fk_quota_transactions_tenant_bucket",
		},
		"feedback": {
			"fk_feedback_events_tenant_user",
			"fk_feedback_events_tenant_project",
			"fk_feedback_labels_tenant_event",
		},
		"support": {
			"fk_support_tickets_tenant_user",
			"fk_support_tickets_tenant_project",
			"fk_support_tickets_tenant_export",
		},
		"traces": {
			"fk_agent_traces_tenant_task",
			"fk_candidate_assets_tenant_trace",
			"fk_provider_usage_logs_tenant_task",
		},
	}

	for surface, needles := range required {
		for _, needle := range needles {
			if !strings.Contains(sql, needle) {
				t.Fatalf("tenant isolation migration missing %s coverage token %q", surface, needle)
			}
		}
	}
	if !strings.Contains(sql, "NOT VALID") {
		t.Fatal("tenant isolation constraints should be deploy-safe NOT VALID constraints")
	}
}

func TestSupportTicketEvidenceMigrationAddsRev2Links(t *testing.T) {
	data, err := os.ReadFile("../../migrations/0006_support_ticket_evidence_links.sql")
	if err != nil {
		t.Fatalf("read support ticket evidence migration: %v", err)
	}
	sql := string(data)
	for _, needle := range []string{
		"ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS task_id text;",
		"ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS trace_id text;",
		"ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS asset_id text;",
		"ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS quota_bucket_id text;",
		"idx_support_tickets_tenant_task",
		"idx_support_tickets_tenant_trace",
		"idx_support_tickets_tenant_asset",
		"idx_support_tickets_tenant_quota",
		"fk_support_tickets_tenant_task",
		"fk_support_tickets_tenant_trace",
		"fk_support_tickets_tenant_asset",
		"fk_support_tickets_tenant_quota",
		"NOT VALID",
	} {
		if !strings.Contains(sql, needle) {
			t.Fatalf("support ticket evidence migration missing %q", needle)
		}
	}
}

func TestSupportTicketRequiredEvidenceMigrationGuardsNewWrites(t *testing.T) {
	data, err := os.ReadFile("../../migrations/0007_support_ticket_required_evidence.sql")
	if err != nil {
		t.Fatalf("read support ticket required evidence migration: %v", err)
	}
	sql := string(data)
	for _, needle := range []string{
		"chk_support_tickets_required_evidence",
		"tenant_id <> ''",
		"user_id <> ''",
		"project_id IS NOT NULL",
		"task_id IS NOT NULL",
		"trace_id IS NOT NULL",
		"asset_id IS NOT NULL",
		"linked_export_id IS NOT NULL",
		"quota_bucket_id IS NOT NULL",
		"NOT VALID",
	} {
		if !strings.Contains(sql, needle) {
			t.Fatalf("support ticket required evidence migration missing %q", needle)
		}
	}
}

func TestDomainMigrationSeedsRuntimeSafetyPolicy(t *testing.T) {
	data, err := os.ReadFile("../../migrations/0002_stage0_rev2_domains.sql")
	if err != nil {
		t.Fatalf("read domain migration: %v", err)
	}
	sql := string(data)
	for _, needle := range []string{
		"safety_stage0_runtime_allow_v1",
		`"brief"`,
		`"provider_request"`,
		`"provider_response"`,
		`"qa"`,
		`"export"`,
		"'active'",
	} {
		if !strings.Contains(sql, needle) {
			t.Fatalf("runtime safety policy seed missing %q", needle)
		}
	}
}

func TestWorkflowAnalyticsTriggerMigrationCapturesCoreFunnelEvents(t *testing.T) {
	data, err := os.ReadFile("../../migrations/0009_server_side_workflow_analytics_triggers.sql")
	if err != nil {
		t.Fatalf("read workflow analytics trigger migration: %v", err)
	}
	sql := string(data)
	for _, needle := range []string{
		"projects_stage0_analytics_insert",
		"candidate_sets_stage0_analytics_insert",
		"candidate_sets_stage0_ready_analytics_update",
		"candidate_assets_stage0_analytics_insert",
		"selected_directions_stage0_analytics_insert",
		"package_items_stage0_analytics_insert",
		"'workflow_started'",
		"'candidate_set_created'",
		"'four_candidates_ready'",
		"'direction_selected'",
		"'package_item_added'",
		"candidate_count < 4",
		"is_iteration",
		"backfilled",
		"NOT EXISTS",
		"HAVING COUNT(ca.id) >= 4",
		"subject_type = 'candidate_set'",
		"jsonb_build_object",
	} {
		if !strings.Contains(sql, needle) {
			t.Fatalf("workflow analytics trigger migration missing %q", needle)
		}
	}
	for _, forbidden := range []string{
		"NEW.brief",
		"chat_messages",
		"body",
		"rationale",
	} {
		if strings.Contains(sql, forbidden) {
			t.Fatalf("workflow analytics trigger migration should not persist free-text payload token %q", forbidden)
		}
	}
}
