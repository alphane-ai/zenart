package edittools

import (
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/assets"
)

func TestBuildRevisionKeepsOriginalAssetForNonDestructiveTransforms(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	source := validAsset("asset_original", "object_original")
	derived := validAsset("asset_crop_revision", "object_crop_revision")
	derived.Lineage.OriginalAssetID = source.ID
	derived.Lineage.DerivedFromAssetID = source.ID
	request := Request{
		ID:          "edit_001",
		TenantID:    "tenant_1",
		ProjectID:   "project_1",
		UserID:      "user_1",
		SourceAsset: source,
		Tool:        ToolCrop,
		Transform: TransformMetadata{
			Crop:   &Rect{X: 10, Y: 20, Width: 640, Height: 480},
			Reason: "tighten composition",
		},
		TraceID:        "trace_edit_001",
		IdempotencyKey: "idem_edit_001",
		CreatedAt:      now,
	}

	revision, err := BuildRevision(request, derived, now)
	if err != nil {
		t.Fatalf("BuildRevision() error = %v", err)
	}
	if revision.OriginalAssetID != source.ID || revision.DerivedAssetID != derived.ID {
		t.Fatalf("revision ids = %#v, want original source and derived revision", revision)
	}
	if !revision.NonDestructive || !revision.OriginalAssetRetained {
		t.Fatalf("revision destructive flags = %#v", revision)
	}
	if revision.ProviderRequest != nil {
		t.Fatalf("crop should not create provider request: %#v", revision.ProviderRequest)
	}
	if revision.Lineage.ToolType != string(ToolCrop) || revision.Lineage.RawPayloadPersisted {
		t.Fatalf("revision lineage = %#v", revision.Lineage)
	}
}

func TestAIEditRevisionRequiresAlignedMaskAndBuildsProviderRequest(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	source := validAsset("asset_original", "object_original")
	derived := validAsset("asset_erase_revision", "object_erase_revision")
	derived.Lineage.OriginalAssetID = source.ID
	derived.Lineage.DerivedFromAssetID = source.ID
	request := Request{
		ID:          "edit_002",
		TenantID:    "tenant_1",
		ProjectID:   "project_1",
		UserID:      "user_1",
		SourceAsset: source,
		Tool:        ToolErase,
		Mask: &MaskInput{
			AssetID:     "mask_001",
			ObjectKey:   "tenants/tenant_1/masks/mask_001.png",
			Width:       1024,
			Height:      768,
			Kind:        MaskKindBrush,
			CoveragePct: 0.18,
			Checksum:    "sha256:mask",
		},
		Prompt:         "Remove the label glare only.",
		ProviderID:     "zenari-image-sandbox",
		ModelID:        "image-edit-v1",
		TraceID:        "trace_edit_002",
		IdempotencyKey: "idem_edit_002",
		CreatedAt:      now,
	}

	revision, err := BuildRevision(request, derived, now)
	if err != nil {
		t.Fatalf("BuildRevision() error = %v", err)
	}
	if revision.NonDestructive || !revision.OriginalAssetRetained {
		t.Fatalf("AI edit should create derived revision and retain original: %#v", revision)
	}
	if revision.ProviderRequest == nil {
		t.Fatalf("AI edit did not build provider request")
	}
	if revision.ProviderRequest.Endpoint != "image.edit" || revision.ProviderRequest.Payload["mask_width"] != 1024 || revision.ProviderRequest.Payload["mask_height"] != 768 {
		t.Fatalf("provider request = %#v", revision.ProviderRequest)
	}
	projection, err := ProjectRevisionForUser(revision)
	if err != nil {
		t.Fatalf("ProjectRevisionForUser() error = %v", err)
	}
	if projection.MaskAssetID != "mask_001" || projection.MaskWidth != 1024 || projection.MaskHeight != 768 {
		t.Fatalf("projection mask = %#v", projection)
	}
}

func TestEditToolRejectsMismatchedMaskSecretAndRawPayload(t *testing.T) {
	source := validAsset("asset_original", "object_original")
	request := Request{
		ID:          "edit_003",
		TenantID:    "tenant_1",
		UserID:      "user_1",
		SourceAsset: source,
		Tool:        ToolErase,
		Mask: &MaskInput{
			AssetID:     "mask_001",
			ObjectKey:   "tenants/tenant_1/masks/mask_001.png",
			Width:       512,
			Height:      768,
			Kind:        MaskKindBrush,
			CoveragePct: 0.2,
		},
		ProviderID: "zenari-image-sandbox",
		ModelID:    "image-edit-v1",
	}
	if err := ValidateRequest(request); err == nil || !strings.Contains(err.Error(), "mask dimensions") {
		t.Fatalf("ValidateRequest() error = %v, want mask dimension rejection", err)
	}

	request.Mask.Width = 1024
	request.Mask.ObjectKey = "tenants/tenant_1/masks/secret?token=value"
	if err := ValidateRequest(request); err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("ValidateRequest() error = %v, want secret-like mask rejection", err)
	}

	derived := validAsset("asset_erase_revision", "object_erase_revision")
	derived.Lineage.OriginalAssetID = source.ID
	derived.Lineage.DerivedFromAssetID = source.ID
	derived.Lineage.RawPayloadPersisted = true
	request.Mask.ObjectKey = "tenants/tenant_1/masks/mask_001.png"
	if _, err := BuildRevision(request, derived, time.Now()); err == nil || !strings.Contains(err.Error(), "raw provider payload") {
		t.Fatalf("BuildRevision() error = %v, want raw payload rejection", err)
	}
}

func TestRemoveBackgroundAndUpscaleBuildProviderRequestsWithoutMask(t *testing.T) {
	source := validAsset("asset_original", "object_original")
	for _, tool := range []ToolType{ToolRemoveBackground, ToolUpscale} {
		request := Request{
			ID:             "edit_" + string(tool),
			TenantID:       "tenant_1",
			UserID:         "user_1",
			SourceAsset:    source,
			Tool:           tool,
			ProviderID:     "zenari-image-sandbox",
			ModelID:        "image-edit-v1",
			IdempotencyKey: "idem_" + string(tool),
		}
		providerRequest, err := BuildProviderRequest(request)
		if err != nil {
			t.Fatalf("BuildProviderRequest(%s) error = %v", tool, err)
		}
		if providerRequest.Endpoint != "image.edit" || providerRequest.Payload["tool"] != string(tool) {
			t.Fatalf("provider request for %s = %#v", tool, providerRequest)
		}
		if _, ok := providerRequest.Payload["mask_asset_id"]; ok {
			t.Fatalf("provider request for %s unexpectedly includes mask: %#v", tool, providerRequest.Payload)
		}
	}
}

func validAsset(assetID, objectID string) assets.VisualAsset {
	now := time.Date(2026, 6, 22, 9, 0, 0, 0, time.UTC)
	object := assets.ObjectMetadata{
		ID:          objectID,
		TenantID:    "tenant_1",
		ProjectID:   "project_1",
		OwnerID:     "user_1",
		AssetType:   assets.AssetTypeImage,
		Bucket:      "zenari-test",
		ObjectKey:   "tenants/tenant_1/assets/" + objectID + ".png",
		ContentType: "image/png",
		ByteSize:    2048,
		Checksum:    "sha256:" + objectID,
		Metadata: map[string]any{
			"width":  1024,
			"height": 768,
		},
		CreatedAt: now,
	}
	return assets.VisualAsset{
		ID:               assetID,
		TenantID:         "tenant_1",
		ProjectID:        "project_1",
		ObjectMetadataID: object.ID,
		AssetType:        assets.AssetTypeImage,
		Status:           assets.AssetStatusActive,
		ObjectMetadata:   object,
		StorageRef:       assets.StorageRefFromObject(object),
		Lineage: assets.Lineage{
			Source: assets.SourceRef{
				Kind:    "asset_library",
				TraceID: "trace_original",
			},
			OriginalAssetID:     assetID,
			DerivedFromAssetID:  "",
			ObjectMetadataID:    object.ID,
			RawPayloadPersisted: false,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
}
