package assets

import (
	"errors"
	"strings"
	"testing"
)

func TestLibraryEntryProjectionAndPromptAttachmentAreTenantScoped(t *testing.T) {
	entry := validLibraryEntry()
	projection, err := LibraryUserProjection("tenant_1", entry)
	if err != nil {
		t.Fatalf("LibraryUserProjection() error = %v", err)
	}
	if projection.Asset.ID != entry.Asset.ID || projection.Visibility != LibraryVisibilityTenant {
		t.Fatalf("projection = %#v", projection)
	}

	attachment, err := BuildPromptAttachment("tenant_1", entry)
	if err != nil {
		t.Fatalf("BuildPromptAttachment() error = %v", err)
	}
	if attachment.AssetID != "asset_1" || attachment.StorageKey == "" || attachment.TraceID != "trace_1" {
		t.Fatalf("attachment = %#v", attachment)
	}
	if _, err := LibraryUserProjection("tenant_2", entry); !errors.Is(err, ErrTenantDenied) {
		t.Fatalf("LibraryUserProjection() cross tenant error = %v, want ErrTenantDenied", err)
	}
}

func TestLibraryCanvasInsertionUsesSafeAssetProjection(t *testing.T) {
	entry := validLibraryEntry()
	insertion, err := BuildCanvasInsertion("tenant_1", entry)
	if err != nil {
		t.Fatalf("BuildCanvasInsertion() error = %v", err)
	}
	if insertion.AssetID != "asset_1" || insertion.CanvasBody["storage_key"] == "" {
		t.Fatalf("insertion = %#v", insertion)
	}
	if insertion.LineageRef["source"] != "asset_library" || insertion.LineageRef["trace_id"] != "trace_1" {
		t.Fatalf("lineage ref = %#v", insertion.LineageRef)
	}
}

func TestLibraryEntryRejectsUnsafeReuseSecretsAndArchivedActions(t *testing.T) {
	entry := validLibraryEntry()
	entry.Visibility = LibraryVisibilityPrivate
	entry.Reusable = true
	if err := ValidateLibraryEntry(entry); err == nil || !strings.Contains(err.Error(), "private library entry") {
		t.Fatalf("ValidateLibraryEntry() error = %v, want private reusable rejection", err)
	}

	entry = validLibraryEntry()
	entry.Archived = true
	if _, err := BuildPromptAttachment("tenant_1", entry); err == nil || !strings.Contains(err.Error(), "archived") {
		t.Fatalf("BuildPromptAttachment() error = %v, want archived rejection", err)
	}

	entry = validLibraryEntry()
	request := LibraryActionRequest{
		TenantID:  "tenant_1",
		ProjectID: "project_2",
		Action:    LibraryActionAttachPrompt,
		Metadata:  map[string]any{"api_key": "secret-value"},
	}
	if err := ValidateLibraryAction(entry, request); err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("ValidateLibraryAction() error = %v, want secret metadata rejection", err)
	}
}

func TestTenantScopedListLibrarySQLKeepsTenantAndProjectPredicates(t *testing.T) {
	sql := TenantScopedListLibrarySQL()
	for _, want := range []string{
		"FROM asset_library_entries l",
		"JOIN assets a ON a.tenant_id = l.tenant_id AND a.id = l.asset_id",
		"WHERE l.tenant_id = $1",
		"$2 = ANY(l.allowed_project_ids)",
		"ORDER BY l.updated_at DESC, l.id",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("TenantScopedListLibrarySQL() missing %q: %s", want, sql)
		}
	}
}

func validLibraryEntry() LibraryEntry {
	asset := validVisualAsset()
	return LibraryEntry{
		ID:              "library_entry_1",
		TenantID:        "tenant_1",
		Asset:           asset,
		Visibility:      LibraryVisibilityTenant,
		Favorite:        true,
		Archived:        false,
		Reusable:        true,
		AllowedProjects: []string{"project_1", "project_2"},
		Tags:            []string{"campaign", "approved"},
		CreatedBy:       "user_1",
		CreatedAt:       asset.CreatedAt,
		UpdatedAt:       asset.UpdatedAt,
	}
}
