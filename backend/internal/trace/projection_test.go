package trace

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestBuildPromptContextPayloadCoversStage1Fields(t *testing.T) {
	payload, err := BuildPromptContextPayload(PromptContextInput{
		Text:              "Generate a product hero image with a glass desk and warm daylight.",
		SelectedObjectIDs: []string{" object_1 ", "object_2", "object_1"},
		ReferenceAssetIDs: []string{"asset_1", "asset_2"},
		BrandKitID:        "brand_kit_1",
		ModelHints:        []string{"image-fast-v1", "image-quality-v2"},
		ToolHint:          "image.generate",
	})
	if err != nil {
		t.Fatalf("BuildPromptContextPayload() error = %v", err)
	}
	if payload.Text == "" || payload.BrandKitID != "brand_kit_1" || payload.ToolHint != "image.generate" {
		t.Fatalf("payload = %#v", payload)
	}
	if got := strings.Join(payload.SelectedObjectIDs, ","); got != "object_1,object_2" {
		t.Fatalf("selected ids = %q", got)
	}
	if got := strings.Join(payload.ReferenceAssetIDs, ","); got != "asset_1,asset_2" {
		t.Fatalf("asset ids = %q", got)
	}
	if got := strings.Join(payload.ModelHints, ","); got != "image-fast-v1,image-quality-v2" {
		t.Fatalf("model hints = %q", got)
	}
}

func TestBuildTraceProjectionRedactsPromptAndRawPayloadBoundaries(t *testing.T) {
	prompt, err := BuildPromptContextPayload(PromptContextInput{
		Text:              "Make four campaign variants using the selected product frame.",
		SelectedObjectIDs: []string{"canvas_object_1"},
		ReferenceAssetIDs: []string{"asset_product_1"},
		BrandKitID:        "brand_kit_1",
		ModelHints:        []string{"image-fast-v1"},
		ToolHint:          "image.generate",
	})
	if err != nil {
		t.Fatalf("BuildPromptContextPayload() error = %v", err)
	}
	projection, err := BuildTraceProjection(TraceProjectionInput{
		TraceID:                "trace_child_1",
		VisibleTraceRef:        "trace_projection_child_1",
		BatchID:                "batch_1",
		ChildID:                "child_1",
		TaskStatus:             "succeeded",
		ProviderID:             "zenari-image-sandbox",
		ModelID:                "image-fast-v1",
		ToolType:               "image.generate",
		ProviderRequestHash:    "request_hash_1",
		ProviderResponseID:     "provider_response_1",
		ProviderResponseStatus: "succeeded",
		PromptContext:          prompt,
		AssetIDs:               []string{"asset_1"},
		CanvasObjectIDs:        []string{"canvas_node_1"},
		FinalExportAllowed:     true,
		DownloadEnabled:        true,
	})
	if err != nil {
		t.Fatalf("BuildTraceProjection() error = %v", err)
	}
	if projection.TraceID != "trace_child_1" || projection.TaskID != "child_1" || projection.Workflow != WorkflowBatchGeneration {
		t.Fatalf("projection identity = %#v", projection)
	}
	if projection.PromptContext.TextSHA256 == "" || !projection.PromptContext.TextRedacted {
		t.Fatalf("prompt projection = %#v", projection.PromptContext)
	}
	if projection.PromptContext.BrandKitID != "brand_kit_1" || projection.PromptContext.ToolHint != "image.generate" {
		t.Fatalf("prompt context projection lost stage1 refs: %#v", projection.PromptContext)
	}
	if projection.RawPromptProjected || projection.RawProviderPayloadSaved || projection.RawSafetyPayloadProjected {
		t.Fatalf("raw payload markers must be false: %#v", projection)
	}
	if !projection.UserTraceProjection.DownloadEnabled || !projection.UserTraceProjection.FailureMappingRequired {
		t.Fatalf("user projection = %#v", projection.UserTraceProjection)
	}
	if !projection.AdminTraceProjection.PayloadRedactionRequired || projection.AdminTraceProjection.RBACScope != "admin_reviewer" {
		t.Fatalf("admin projection = %#v", projection.AdminTraceProjection)
	}
	encoded, err := json.Marshal(projection.Map())
	if err != nil {
		t.Fatalf("marshal projection map: %v", err)
	}
	for _, forbidden := range []string{
		prompt.Text,
		`"provider_payload":`,
		`"internal_prompt":`,
		`"raw_safety_payload":`,
		`"agent_step_payload":`,
	} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("projection leaked %q: %s", forbidden, encoded)
		}
	}
	for _, required := range []string{
		`"raw_prompt_projected":false`,
		`"raw_provider_payload_saved":false`,
		`"raw_safety_payload_projected":false`,
	} {
		if !strings.Contains(string(encoded), required) {
			t.Fatalf("projection missing raw payload denial marker %q: %s", required, encoded)
		}
	}
}

func TestBuildTraceProjectionRejectsSecretsAndForbiddenFields(t *testing.T) {
	secretKey := strings.Repeat("a", 32) + "." + strings.Repeat("b", 20)
	if _, err := BuildPromptContextPayload(PromptContextInput{Text: "use " + secretKey}); err == nil {
		t.Fatal("BuildPromptContextPayload() error = nil, want secret rejection")
	}
	err := ValidateUserExportProjection(map[string]any{
		"trace_id":         "trace_1",
		"provider_payload": map[string]any{"prompt": "raw prompt"},
	})
	if err == nil || !strings.Contains(err.Error(), "provider_payload") {
		t.Fatalf("ValidateUserExportProjection() error = %v, want forbidden provider_payload", err)
	}
}
