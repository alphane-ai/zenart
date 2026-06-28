package canvas

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestValidateCanvasObjectCoversStage1Fields(t *testing.T) {
	object := validCanvasObject()
	if err := ValidateCanvasObject(object); err != nil {
		t.Fatalf("ValidateCanvasObject() error = %v", err)
	}
	if object.ObjectType != ObjectTypeGeneratedLayer ||
		object.AssetRef.AssetID != "asset_1" ||
		object.LineageRef.BatchID != "batch_1" ||
		object.ZIndex != 10 ||
		!object.Locked ||
		object.Hidden {
		t.Fatalf("object lost Stage 1 fields: %#v", object)
	}
}

func TestCanvasObjectUserProjectionIsTenantScopedAndRedacted(t *testing.T) {
	object := validCanvasObject()
	object.Body["caption"] = "public copy"
	object.Metadata = map[string]any{"public": "ok"}
	projection, err := UserProjection("tenant_1", object)
	if err != nil {
		t.Fatalf("UserProjection() error = %v", err)
	}
	if projection.ID != object.ID || projection.WorkspaceID != object.WorkspaceID {
		t.Fatalf("projection identity = %#v", projection)
	}
	if projection.AssetRef.AssetID != "asset_1" || projection.LineageRef.TraceID != "trace_1" {
		t.Fatalf("projection refs = %#v", projection)
	}
	if _, ok := projection.Body["caption"]; !ok {
		t.Fatalf("projection body = %#v", projection.Body)
	}
	if err := EnsureTenant("tenant_2", object); !errors.Is(err, ErrTenantDenied) {
		t.Fatalf("EnsureTenant() error = %v, want ErrTenantDenied", err)
	}
}

func TestCanvasObjectRejectsSecretsAndUnsupportedTypes(t *testing.T) {
	object := validCanvasObject()
	object.Body["provider_payload"] = map[string]any{"api_key": "secret-value"}
	if err := ValidateCanvasObject(object); err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("ValidateCanvasObject() error = %v, want secret rejection", err)
	}

	object = validCanvasObject()
	object.ObjectType = "unsupported"
	if err := ValidateCanvasObject(object); err == nil || !strings.Contains(err.Error(), "unsupported object_type") {
		t.Fatalf("ValidateCanvasObject() error = %v, want unsupported type", err)
	}
}

func TestTenantScopedListNodesSQLKeepsTenantPredicate(t *testing.T) {
	sql := TenantScopedListNodesSQL()
	for _, want := range []string{
		"FROM canvas_nodes",
		"WHERE tenant_id = $1 AND workspace_id = $2",
		"ORDER BY updated_at DESC, id",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("TenantScopedListNodesSQL() missing %q: %s", want, sql)
		}
	}
}

func validCanvasObject() CanvasObject {
	now := time.Date(2026, 6, 22, 9, 0, 0, 0, time.UTC)
	return CanvasObject{
		ID:          "canvas_node_1",
		TenantID:    "tenant_1",
		WorkspaceID: "workspace_1",
		FrameID:     "frame_1",
		VersionID:   "canvas_version_1",
		ObjectType:  ObjectTypeGeneratedLayer,
		Title:       "Generated Layer",
		Body: map[string]any{
			"asset_id": "asset_1",
		},
		Transform: Transform{
			X:        10,
			Y:        20,
			Width:    1024,
			Height:   768,
			Rotation: 2,
			ScaleX:   1,
			ScaleY:   1,
		},
		ZIndex: 10,
		Locked: true,
		Hidden: false,
		AssetRef: AssetRef{
			AssetID:          "asset_1",
			ObjectMetadataID: "object_1",
			ThumbnailID:      "object_thumb_1",
		},
		LineageRef: LineageRef{
			Source:       "batch_child_provider_result",
			TaskID:       "child_1",
			BatchID:      "batch_1",
			TraceID:      "trace_1",
			ProviderID:   "zenari-image-sandbox",
			ModelID:      "image-fast-v1",
			RequestHash:  "request_hash_1",
			AssetID:      "asset_1",
			CanvasNodeID: "canvas_node_1",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
}
