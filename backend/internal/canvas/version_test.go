package canvas

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestVersionSnapshotDiffAndRestorePreservesOtherObjects(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	brief := validCanvasObject()
	brief.ID = "node_brief"
	brief.Title = "Brief"
	brief.ZIndex = 1
	brief.Body = map[string]any{"text": "initial brief"}
	studio := validCanvasObject()
	studio.ID = "node_studio"
	studio.Title = "Studio"
	studio.ZIndex = 2
	studio.Body = map[string]any{"text": "old studio"}
	currentUtility := validCanvasObject()
	currentUtility.ID = "node_utility"
	currentUtility.Title = "Utility"
	currentUtility.ZIndex = 3
	currentUtility.Body = map[string]any{"text": "current-only utility"}

	version1, err := CreateVersionSnapshot("tenant_1", "workspace_1", "version_1", 1, "Initial", "user_1", []CanvasObject{brief, studio}, now)
	if err != nil {
		t.Fatalf("CreateVersionSnapshot(version1) error = %v", err)
	}

	updatedBrief := brief
	updatedBrief.Body = map[string]any{"text": "updated brief"}
	version2, err := CreateVersionSnapshot("tenant_1", "workspace_1", "version_2", 2, "Brief update", "user_1", []CanvasObject{updatedBrief, studio}, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("CreateVersionSnapshot(version2) error = %v", err)
	}

	diff, err := DiffVersionSnapshots(version1, version2)
	if err != nil {
		t.Fatalf("DiffVersionSnapshots() error = %v", err)
	}
	if strings.Join(diff.UpdatedObjectIDs, ",") != "node_brief" || strings.Join(diff.UnchangedObjectIDs, ",") != "node_studio" {
		t.Fatalf("diff = %#v, want brief updated and studio unchanged", diff)
	}

	current := []CanvasObject{updatedBrief, currentUtility}
	restored, plan, err := RestoreObjectVersions(current, version1, []string{"node_brief"}, now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("RestoreObjectVersions() error = %v", err)
	}
	if plan.VersionID != "version_1" ||
		strings.Join(plan.RestoredObjectIDs, ",") != "node_brief" ||
		strings.Join(plan.PreservedObjectIDs, ",") != "node_utility" ||
		plan.ObjectCountBefore != 2 ||
		plan.ObjectCountAfter != 2 {
		t.Fatalf("restore plan = %#v, want restore brief and preserve utility", plan)
	}
	objects := canvasObjectsByID(restored)
	if objects["node_brief"].Body["text"] != "initial brief" {
		t.Fatalf("restored brief body = %#v, want version snapshot body", objects["node_brief"].Body)
	}
	if objects["node_utility"].Body["text"] != "current-only utility" {
		t.Fatalf("utility object was not preserved: %#v", objects["node_utility"])
	}
	if _, ok := objects["node_studio"]; ok {
		t.Fatalf("object-level restore should not reintroduce unrequested studio object: %#v", objects["node_studio"])
	}
}

func TestWorkspaceVersionRestoreCanRecreateSnapshotWithoutDroppingCurrentOnlyConflicts(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	brief := validCanvasObject()
	brief.ID = "node_brief"
	brief.ZIndex = 1
	studio := validCanvasObject()
	studio.ID = "node_studio"
	studio.ZIndex = 2
	version, err := CreateVersionSnapshot("tenant_1", "workspace_1", "version_2", 2, "Full restore", "user_1", []CanvasObject{brief, studio}, now)
	if err != nil {
		t.Fatalf("CreateVersionSnapshot() error = %v", err)
	}
	currentOnly := validCanvasObject()
	currentOnly.ID = "node_current_only"
	currentOnly.ZIndex = 3
	currentOnly.Body = map[string]any{"text": "kept current"}

	restored, plan, err := RestoreWorkspaceVersion([]CanvasObject{currentOnly}, version, now.Add(time.Minute))
	if err != nil {
		t.Fatalf("RestoreWorkspaceVersion() error = %v", err)
	}
	objects := canvasObjectsByID(restored)
	for _, id := range []string{"node_brief", "node_studio", "node_current_only"} {
		if _, ok := objects[id]; !ok {
			t.Fatalf("restored workspace missing %s: %#v", id, objects)
		}
	}
	if strings.Join(plan.RestoredObjectIDs, ",") != "node_brief,node_studio" ||
		strings.Join(plan.PreservedObjectIDs, ",") != "node_current_only" {
		t.Fatalf("workspace restore plan = %#v", plan)
	}
}

func TestVersionSnapshotRejectsTenantWorkspaceAndMissingObjectErrors(t *testing.T) {
	object := validCanvasObject()
	object.TenantID = "tenant_2"
	if _, err := CreateVersionSnapshot("tenant_1", "workspace_1", "version_1", 1, "bad", "user_1", []CanvasObject{object}, time.Now()); !errors.Is(err, ErrTenantDenied) {
		t.Fatalf("CreateVersionSnapshot() error = %v, want ErrTenantDenied", err)
	}

	object = validCanvasObject()
	object.WorkspaceID = "workspace_2"
	if _, err := CreateVersionSnapshot("tenant_1", "workspace_1", "version_1", 1, "bad", "user_1", []CanvasObject{object}, time.Now()); err == nil || !strings.Contains(err.Error(), "workspace mismatch") {
		t.Fatalf("CreateVersionSnapshot() error = %v, want workspace mismatch", err)
	}

	object = validCanvasObject()
	version, err := CreateVersionSnapshot("tenant_1", "workspace_1", "version_1", 1, "ok", "user_1", []CanvasObject{object}, time.Now())
	if err != nil {
		t.Fatalf("CreateVersionSnapshot() error = %v", err)
	}
	if _, _, err := RestoreObjectVersions([]CanvasObject{object}, version, []string{"missing_node"}, time.Now()); err == nil || !IsVersionValidationError(err) {
		t.Fatalf("RestoreObjectVersions() error = %v, want validation error", err)
	}
}

func TestTenantScopedVersionSQLKeepsTenantWorkspacePredicates(t *testing.T) {
	for name, sql := range map[string]string{
		"list":   TenantScopedListVersionsSQL(),
		"create": TenantScopedCreateVersionSQL(),
	} {
		for _, want := range []string{"canvas_versions", "tenant_id", "workspace_id"} {
			if !strings.Contains(sql, want) {
				t.Fatalf("%s SQL missing %q: %s", name, want, sql)
			}
		}
	}
	if !strings.Contains(TenantScopedListVersionsSQL(), "WHERE tenant_id = $1 AND workspace_id = $2") {
		t.Fatalf("TenantScopedListVersionsSQL() missing tenant/workspace predicate: %s", TenantScopedListVersionsSQL())
	}
	if !strings.Contains(TenantScopedCreateVersionSQL(), "ON CONFLICT (workspace_id, version_number) DO NOTHING") {
		t.Fatalf("TenantScopedCreateVersionSQL() missing idempotent conflict policy: %s", TenantScopedCreateVersionSQL())
	}
}
