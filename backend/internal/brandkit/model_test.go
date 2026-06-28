package brandkit

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/assets"
)

func TestBrandKitProjectionAndPromptContextAreTenantScoped(t *testing.T) {
	kit := validBrandKit()
	projection, err := UserProjection("tenant_1", kit)
	if err != nil {
		t.Fatalf("UserProjection() error = %v", err)
	}
	if projection.ID != kit.ID || len(projection.Logos) != 1 || len(projection.Palette) != 2 {
		t.Fatalf("projection = %#v", projection)
	}

	promptRef, err := PromptContextProjection("tenant_1", kit)
	if err != nil {
		t.Fatalf("PromptContextProjection() error = %v", err)
	}
	if promptRef.BrandKitID != "brand_kit_1" || promptRef.LogoIDs[0] != "asset_logo_1" || promptRef.FontFamilies[0] != "Inter" {
		t.Fatalf("prompt ref = %#v", promptRef)
	}
	if _, err := UserProjection("tenant_2", kit); !errors.Is(err, ErrTenantDenied) {
		t.Fatalf("UserProjection() cross tenant error = %v, want ErrTenantDenied", err)
	}
}

func TestBrandKitValidatesLogoAssetsProjectDefaultAndSecrets(t *testing.T) {
	kit := validBrandKit()
	logoAsset := validLogoAsset()
	if err := ValidateLogoAssets("tenant_1", kit, map[string]assets.VisualAsset{"asset_logo_1": logoAsset}); err != nil {
		t.Fatalf("ValidateLogoAssets() error = %v", err)
	}

	defaultKit, err := ProjectDefault("tenant_1", "project_1", []BrandKit{kit})
	if err != nil {
		t.Fatalf("ProjectDefault() error = %v", err)
	}
	if defaultKit.ID != kit.ID {
		t.Fatalf("default kit = %#v", defaultKit)
	}

	kit = validBrandKit()
	kit.Guidelines[0].Body = "Keep API key api_key=secret-value out of brand books."
	if err := ValidateBrandKit(kit); err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("ValidateBrandKit() error = %v, want secret-like rejection", err)
	}
}

func TestBrandKitRejectsInvalidPaletteAndInactivePromptContext(t *testing.T) {
	kit := validBrandKit()
	kit.Palette[0].Hex = "blue"
	if err := ValidateBrandKit(kit); err == nil || !strings.Contains(err.Error(), "#RRGGBB") {
		t.Fatalf("ValidateBrandKit() error = %v, want palette rejection", err)
	}

	kit = validBrandKit()
	kit.Status = BrandKitStatusDraft
	if _, err := PromptContextProjection("tenant_1", kit); err == nil || !strings.Contains(err.Error(), "active") {
		t.Fatalf("PromptContextProjection() error = %v, want active rejection", err)
	}
}

func TestTenantScopedListBrandKitsSQLKeepsTenantAndProjectPredicates(t *testing.T) {
	sql := TenantScopedListBrandKitsSQL()
	for _, want := range []string{
		"FROM brand_kits",
		"WHERE tenant_id = $1",
		"project_bindings @> jsonb_build_array",
		"ORDER BY updated_at DESC, id",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("TenantScopedListBrandKitsSQL() missing %q: %s", want, sql)
		}
	}
}

func validBrandKit() BrandKit {
	now := time.Date(2026, 6, 22, 10, 30, 0, 0, time.UTC)
	return BrandKit{
		ID:       "brand_kit_1",
		TenantID: "tenant_1",
		Name:     "Aurora Retail",
		Status:   BrandKitStatusActive,
		Logos: []LogoAssetRef{{
			AssetID:          "asset_logo_1",
			ObjectMetadataID: "object_logo_1",
			Usage:            "primary",
		}},
		Palette: []ColorSwatch{
			{Name: "Ink", Hex: "#111827", Role: "primary"},
			{Name: "Signal", Hex: "#2563EB", Role: "accent"},
		},
		Fonts: []FontRef{{
			Family:  "Inter",
			AssetID: "asset_font_1",
			Role:    "body",
		}},
		Guidelines: []Guideline{{
			ID:       "guideline_1",
			Title:    "Logo Clear Space",
			Body:     "Keep the primary logo on high contrast backgrounds.",
			Severity: "required",
		}},
		SourceRefs: []SourceRef{{
			Kind:             "asset_library",
			AssetID:          "asset_logo_1",
			ObjectMetadataID: "object_logo_1",
			TraceID:          "trace_1",
		}},
		ProjectBindings: []ProjectBinding{{
			ProjectID: "project_1",
			Default:   true,
		}},
		CreatedBy: "user_1",
		CreatedAt: now,
		UpdatedAt: now,
	}
}

func validLogoAsset() assets.VisualAsset {
	now := time.Date(2026, 6, 22, 10, 31, 0, 0, time.UTC)
	object := assets.ObjectMetadata{
		ID:          "object_logo_1",
		TenantID:    "tenant_1",
		ProjectID:   "project_1",
		OwnerID:     "user_1",
		AssetType:   assets.AssetTypeSVG,
		Bucket:      "zenari-stage1-brand",
		ObjectKey:   "tenants/tenant_1/brand-kits/brand_kit_1/logo.svg",
		ContentType: "image/svg+xml",
		ByteSize:    256,
		Checksum:    "sha256:logo",
		Provider:    "object-store",
		CreatedAt:   now,
	}
	return assets.VisualAsset{
		ID:               "asset_logo_1",
		TenantID:         "tenant_1",
		ProjectID:        "project_1",
		ObjectMetadataID: object.ID,
		AssetType:        assets.AssetTypeSVG,
		Status:           assets.AssetStatusActive,
		ObjectMetadata:   object,
		StorageRef:       assets.StorageRefFromObject(object),
		Lineage: assets.Lineage{
			Source: assets.SourceRef{
				Kind:    "upload",
				TraceID: "trace_1",
			},
			ObjectMetadataID:    object.ID,
			RawPayloadPersisted: false,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
}
