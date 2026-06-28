package assets

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestValidateVisualAssetCoversStorageThumbnailAndLineage(t *testing.T) {
	asset := validVisualAsset()
	if err := ValidateVisualAsset(asset); err != nil {
		t.Fatalf("ValidateVisualAsset() error = %v", err)
	}
	if asset.AssetType != AssetTypeGeneratedImage ||
		asset.StorageRef.ObjectKey == "" ||
		asset.ThumbnailRef == nil ||
		asset.Lineage.Source.BatchID != "batch_1" ||
		asset.Lineage.RawPayloadPersisted {
		t.Fatalf("asset lost Stage 1 fields: %#v", asset)
	}
}

func TestVisualAssetProjectionIsTenantScoped(t *testing.T) {
	asset := validVisualAsset()
	projection, err := UserProjection("tenant_1", asset)
	if err != nil {
		t.Fatalf("UserProjection() error = %v", err)
	}
	if projection.ID != asset.ID || projection.StorageRef.ObjectKey != asset.StorageRef.ObjectKey {
		t.Fatalf("projection = %#v", projection)
	}
	if projection.ThumbnailRef == nil || projection.ThumbnailRef.ObjectKey == "" {
		t.Fatalf("projection thumbnail ref = %#v", projection.ThumbnailRef)
	}
	if projection.Lineage.RawPayloadPersisted {
		t.Fatalf("projection lineage persisted raw payload: %#v", projection.Lineage)
	}
	if err := EnsureTenant("tenant_2", asset); !errors.Is(err, ErrTenantDenied) {
		t.Fatalf("EnsureTenant() error = %v, want ErrTenantDenied", err)
	}
}

func TestVisualAssetRejectsUnsafeStorageRefsSecretsAndRawPayload(t *testing.T) {
	asset := validVisualAsset()
	asset.StorageRef.ObjectKey = "tenants/tenant_1/assets/image.png?sig=secret"
	if err := ValidateVisualAsset(asset); err == nil || !strings.Contains(err.Error(), "query or fragment") {
		t.Fatalf("ValidateVisualAsset() error = %v, want query rejection", err)
	}

	asset = validVisualAsset()
	asset.Provenance = map[string]any{"provider_payload": map[string]any{"api_key": "secret-value"}}
	if err := ValidateVisualAsset(asset); err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("ValidateVisualAsset() error = %v, want secret rejection", err)
	}

	asset = validVisualAsset()
	asset.Lineage.RawPayloadPersisted = true
	if err := ValidateVisualAsset(asset); err == nil || !strings.Contains(err.Error(), "raw provider payload") {
		t.Fatalf("ValidateVisualAsset() error = %v, want raw payload rejection", err)
	}
}

func TestTenantScopedListAssetsSQLKeepsTenantJoin(t *testing.T) {
	sql := TenantScopedListAssetsSQL()
	for _, want := range []string{
		"FROM assets a",
		"JOIN object_metadata o ON o.tenant_id = a.tenant_id AND o.id = a.object_metadata_id",
		"WHERE a.tenant_id = $1",
		"ORDER BY a.updated_at DESC, a.id",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("TenantScopedListAssetsSQL() missing %q: %s", want, sql)
		}
	}
}

func validVisualAsset() VisualAsset {
	now := time.Date(2026, 6, 22, 9, 30, 0, 0, time.UTC)
	object := ObjectMetadata{
		ID:             "object_1",
		TenantID:       "tenant_1",
		ProjectID:      "project_1",
		OwnerID:        "user_1",
		AssetType:      AssetTypeGeneratedImage,
		Bucket:         "zenari-stage1-results",
		ObjectKey:      "tenants/tenant_1/batch-results/batch_1/child_1/result-manifest.json",
		ContentType:    "application/vnd.zenari.batch-result+json",
		ByteSize:       512,
		Checksum:       "sha256:abc123",
		Provider:       "object-store",
		RetentionState: "active",
		Metadata:       map[string]any{"public": "ok"},
		CreatedAt:      now,
	}
	thumbnail := StorageRef{
		Bucket:      "zenari-stage1-results",
		ObjectKey:   "tenants/tenant_1/thumbnails/batch_1/child_1/thumbnail-manifest.json",
		ContentType: "application/vnd.zenari.thumbnail+json",
		ByteSize:    128,
		Checksum:    "sha256:def456",
	}
	return VisualAsset{
		ID:               "asset_1",
		TenantID:         "tenant_1",
		ProjectID:        "project_1",
		ObjectMetadataID: object.ID,
		AssetType:        AssetTypeGeneratedImage,
		Status:           AssetStatusActive,
		ObjectMetadata:   object,
		StorageRef:       StorageRefFromObject(object),
		ThumbnailRef:     &thumbnail,
		Lineage: Lineage{
			Source: SourceRef{
				Kind:     "batch_child_provider_result",
				TaskID:   "child_1",
				BatchID:  "batch_1",
				TraceID:  "trace_1",
				Provider: "zenari-image-sandbox",
				ModelID:  "image-fast-v1",
			},
			ObjectMetadataID:    object.ID,
			ThumbnailMetadataID: "object_thumb_1",
			ToolType:            "image.generate",
			RequestHash:         "request_hash_1",
			RawPayloadPersisted: false,
		},
		Provenance: map[string]any{"trace_id": "trace_1"},
		CreatedAt:  now,
		UpdatedAt:  now,
	}
}
