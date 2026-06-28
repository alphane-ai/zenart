package exportkit

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestBuildRenderPlanIncludesManifestQAProvenanceAndDisclaimer(t *testing.T) {
	plan, err := BuildRenderPlan(validManifest())
	if err != nil {
		t.Fatalf("BuildRenderPlan() error = %v", err)
	}
	if !plan.Gate.Allowed || !plan.Gate.DownloadEnabled {
		t.Fatalf("gate = %#v, want allowed download", plan.Gate)
	}
	for _, want := range []string{
		"exports/package_1/hero.png",
		"manifest.json",
		"metadata.json",
		"qa_report.json",
		"trace_provenance.json",
		"safety_disclaimer.md",
	} {
		if !contains(plan.ZipEntries, want) {
			t.Fatalf("zip entries = %#v, missing %s", plan.ZipEntries, want)
		}
	}
	if plan.Manifest.Provenance.ManifestHash == "" {
		t.Fatalf("manifest hash was not populated")
	}
	if !plan.RawPayloadSafe {
		t.Fatalf("RawPayloadSafe = false")
	}
}

func TestEvaluateGateFailsClosedForMissingQAProvenanceAndSafety(t *testing.T) {
	manifest := validManifest()
	manifest.QAReport.Checked = false
	manifest.SafetyReport.Status = "blocked"
	manifest.Provenance.TraceID = ""

	decision := EvaluateGate(manifest)
	if decision.Allowed || decision.DownloadEnabled {
		t.Fatalf("decision = %#v, want fail closed", decision)
	}
	if len(decision.BlockedReasons) == 0 {
		t.Fatalf("blocked reasons missing")
	}
	if _, err := BuildRenderPlan(manifest); !errors.Is(err, ErrExportValidation) {
		t.Fatalf("BuildRenderPlan() error = %v, want ErrExportValidation", err)
	}
}

func TestPlaceholderRenderedOutputCannotBePromotedAsFinishedExport(t *testing.T) {
	manifest := validManifest()
	manifest.Files[0].Placeholder = true

	decision := EvaluateGate(manifest)
	if decision.Allowed || !contains(decision.BlockedReasons, "placeholder_rendered_output") || !contains(decision.PlaceholderFiles, "exports/package_1/hero.png") {
		t.Fatalf("decision = %#v, want placeholder rendered output blocked", decision)
	}
	if _, err := BuildRenderPlan(manifest); err == nil || !strings.Contains(err.Error(), "placeholder") {
		t.Fatalf("BuildRenderPlan() error = %v, want placeholder rejection", err)
	}
}

func TestPSDLayerManifestIsAllowedButPlaceholderPSDManifestIsBlocked(t *testing.T) {
	manifest := validManifest()
	manifest.Files[0] = FileEntry{
		Path:        "exports/package_1/layers.psd-manifest.json",
		Role:        FileRolePSDLayerManifest,
		Format:      FileFormatPSDManifest,
		AssetID:     "asset_psd_manifest",
		ObjectKey:   "tenants/tenant_1/exports/package_1/layers.psd-manifest.json",
		ByteSize:    4096,
		Checksum:    "sha256:psdmanifest",
		Placeholder: false,
	}
	if _, err := BuildRenderPlan(manifest); err != nil {
		t.Fatalf("BuildRenderPlan() error = %v, want PSD layer manifest accepted", err)
	}
	manifest.Files[0].Placeholder = true
	if _, err := BuildRenderPlan(manifest); err == nil || !strings.Contains(err.Error(), "placeholder") {
		t.Fatalf("BuildRenderPlan() error = %v, want placeholder PSD manifest rejected", err)
	}
}

func TestValidateManifestRejectsSignedURLAndSecretLikeFields(t *testing.T) {
	manifest := validManifest()
	manifest.Files[0].ObjectKey = "tenants/tenant_1/exports/package_1/hero.png?X-Amz-Signature=abcdef"
	if err := ValidateManifest(manifest); err == nil || !strings.Contains(err.Error(), "object_key") {
		t.Fatalf("ValidateManifest() error = %v, want signed URL rejection", err)
	}

	manifest = validManifest()
	manifest.LicenseRef = "Bearer abcdefghijklmnop"
	if err := ValidateManifest(manifest); err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("ValidateManifest() error = %v, want secret-like field rejection", err)
	}
}

func validManifest() Manifest {
	now := time.Date(2026, 6, 22, 13, 0, 0, 0, time.UTC)
	return Manifest{
		ID:        "manifest_1",
		TenantID:  "tenant_1",
		ProjectID: "project_1",
		PackageID: "package_1",
		ExportID:  "export_1",
		Format:    "zip",
		Files: []FileEntry{
			{
				Path:             "exports/package_1/hero.png",
				Role:             FileRoleRenderedAsset,
				Format:           FileFormatPNG,
				AssetID:          "asset_hero",
				ObjectKey:        "tenants/tenant_1/exports/package_1/hero.png",
				ByteSize:         2048,
				Checksum:         "sha256:hero",
				Placeholder:      false,
				DerivedFromAsset: "asset_source",
			},
			{
				Path:        "metadata.json",
				Role:        FileRoleMetadata,
				Format:      FileFormatJSON,
				ObjectKey:   "tenants/tenant_1/exports/package_1/metadata.json",
				ByteSize:    256,
				Checksum:    "sha256:metadata",
				Placeholder: false,
			},
		},
		QAReport: QAReport{
			Status:     "pass",
			Checked:    true,
			ReportRef:  "qa_report.json",
			ReportHash: "sha256:qa",
		},
		SafetyReport: SafetyReport{
			Status:       "allowed",
			Checked:      true,
			DecisionID:   "safety_decision_1",
			Disclaimer:   "AI-generated content reviewed for export.",
			DisclaimerID: "safety_disclaimer.md",
		},
		Provenance: Provenance{
			TraceID:     "trace_export_1",
			PackageID:   "package_1",
			ExportID:    "export_1",
			AssetIDs:    []string{"asset_hero"},
			PromptHash:  "prompt_hash_1",
			ProviderIDs: []string{"zenari-image-sandbox"},
			GeneratedBy: "export-renderer-local-contract",
			GeneratedAt: now,
		},
		LicenseRef:    "license/default-commercial-use-v1",
		DisclaimerRef: "safety_disclaimer.md",
		TraceProjection: map[string]any{
			"trace_id":    "trace_export_1",
			"prompt_hash": "prompt_hash_1",
		},
		CreatedAt: now,
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
