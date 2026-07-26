package edit

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/provider"
)

func TestBuildProviderRequestRequiresAlignedMaskForErase(t *testing.T) {
	input := validInput()
	input.MaskWidth = 512

	_, err := BuildProviderRequest(input)
	if err == nil || !strings.Contains(err.Error(), "mask dimensions") {
		t.Fatalf("BuildProviderRequest() error = %v, want mask alignment rejection", err)
	}

	input = validInput()
	req, err := BuildProviderRequest(input)
	if err != nil {
		t.Fatalf("BuildProviderRequest() error = %v", err)
	}
	if req.Endpoint != "image.edit" || req.Payload["tool"] != "erase" {
		t.Fatalf("request = %#v, want image.edit erase request", req)
	}
	if req.Payload["mask_width"] != 1024 || req.Payload["mask_height"] != 768 || req.Payload["mask_kind"] != "brush" {
		t.Fatalf("mask payload = %#v", req.Payload)
	}
	if req.Provenance.EndpointVersion != EndpointVersion || req.Provenance.RequestHash == "" {
		t.Fatalf("provenance = %#v", req.Provenance)
	}
}

func TestBuildProviderRequestForRemoveBackgroundDoesNotRequireMask(t *testing.T) {
	input := validInput()
	input.Tool = ToolRemoveBackground
	input.MaskAssetID = ""
	input.MaskObjectKey = ""
	input.MaskWidth = 0
	input.MaskHeight = 0
	input.MaskKind = ""

	req, err := BuildProviderRequest(input)
	if err != nil {
		t.Fatalf("BuildProviderRequest() error = %v", err)
	}
	if _, ok := req.Payload["mask_asset_id"]; ok {
		t.Fatalf("remove background payload unexpectedly includes mask: %#v", req.Payload)
	}
	if req.Payload["tool"] != string(ToolRemoveBackground) {
		t.Fatalf("tool = %#v", req.Payload["tool"])
	}
}

func TestClientInvokeProjectsSafeDerivedAssetAndDropsRawProviderPayload(t *testing.T) {
	now := time.Date(2026, 6, 22, 12, 0, 0, 0, time.UTC)
	req, err := BuildProviderRequest(validInput())
	if err != nil {
		t.Fatalf("BuildProviderRequest() error = %v", err)
	}
	inner := &fakeProviderClient{response: provider.Response{
		ID:         "provider_resp_1",
		RequestID:  req.ID,
		ProviderID: req.ProviderID,
		ModelID:    req.ModelID,
		Status:     "succeeded",
		Output: map[string]any{
			"asset_id":             "asset-edit-provider-001",
			"object_key":           "tenants/tenant_1/assets/asset-edit-provider-001.png",
			"raw_provider_payload": "should not be projected",
		},
		Usage:   provider.Usage{CostUnits: 7},
		TraceID: req.TraceID,
	}}

	resp, err := (Client{Inner: inner, Now: func() time.Time { return now }}).Invoke(context.Background(), req)
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if inner.request.Endpoint != "image.edit" {
		t.Fatalf("inner request endpoint = %q", inner.request.Endpoint)
	}
	if resp.Provenance.EndpointVersion != EndpointVersion || resp.Provenance.RequestHash != req.Provenance.RequestHash {
		t.Fatalf("response provenance = %#v", resp.Provenance)
	}
	if resp.Output["asset_id"] != "asset-edit-provider-001" || resp.Output["original_asset_id"] != "asset_original" || resp.Output["derived_from_asset_id"] != "asset_original" {
		t.Fatalf("response output = %#v", resp.Output)
	}
	if resp.Output["raw_payload_persisted"] != false {
		t.Fatalf("raw_payload_persisted = %#v", resp.Output["raw_payload_persisted"])
	}
	if _, ok := resp.Output["raw_provider_payload"]; ok {
		t.Fatalf("raw provider payload leaked into safe output: %#v", resp.Output)
	}
	if resp.CompletedAt.Equal(now) {
		t.Fatalf("adapter should not fabricate provider completion time from local projection")
	}
}

func TestProjectResultAssetRejectsSecretLikeResultObjectKey(t *testing.T) {
	req, err := BuildProviderRequest(validInput())
	if err != nil {
		t.Fatalf("BuildProviderRequest() error = %v", err)
	}
	_, err = ProjectResultAsset(req, provider.Response{
		ID: "provider_resp_1",
		Output: map[string]any{
			"asset_id":   "asset-edit-provider-001",
			"object_key": "tenants/tenant_1/assets/asset-edit-provider-001.png?token=value",
		},
	}, time.Now())
	if err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("ProjectResultAsset() error = %v, want secret-like result rejection", err)
	}
}

func TestCapabilitiesExposeEditToolsAndMaskInput(t *testing.T) {
	inner := &fakeProviderClient{capabilities: []provider.Capability{{
		ProviderID:  "zenari-image-sandbox",
		ModelID:     "image-edit-v1",
		Endpoints:   []string{"image.generate"},
		InputTypes:  []string{"prompt"},
		OutputTypes: []string{"json"},
		ToolTypes:   []string{"generate"},
	}}}
	capabilities := (Client{Inner: inner}).Capabilities()
	if len(capabilities) != 1 {
		t.Fatalf("capabilities = %#v", capabilities)
	}
	got := capabilities[0]
	for _, want := range []string{"image.edit"} {
		if !contains(got.Endpoints, want) {
			t.Fatalf("endpoints = %#v, missing %s", got.Endpoints, want)
		}
	}
	for _, want := range []string{"remove_background", "upscale", "erase", "expand"} {
		if !contains(got.ToolTypes, want) {
			t.Fatalf("tools = %#v, missing %s", got.ToolTypes, want)
		}
	}
	if !contains(got.InputTypes, "mask") || !contains(got.OutputTypes, "image") {
		t.Fatalf("capability input/output = %#v/%#v", got.InputTypes, got.OutputTypes)
	}
}

func TestValidateInputRejectsSecretLikePrompt(t *testing.T) {
	input := validInput()
	input.Prompt = "remove the logo using Bearer abcdefghijklmnop"
	if err := ValidateInput(input); err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("ValidateInput() error = %v, want secret-like prompt rejection", err)
	}
}

func validInput() Input {
	return Input{
		RequestID:       "edit_provider_request_001",
		TenantID:        "tenant_1",
		TaskID:          "edit_task_001",
		ProviderID:      "zenari-image-sandbox",
		ModelID:         "image-edit-v1",
		Tool:            ToolErase,
		Prompt:          "Remove the glare from the product label.",
		SourceAssetID:   "asset_original",
		SourceObjectKey: "tenants/tenant_1/assets/asset_original.png",
		SourceWidth:     1024,
		SourceHeight:    768,
		MaskAssetID:     "mask_001",
		MaskObjectKey:   "tenants/tenant_1/masks/mask_001.png",
		MaskWidth:       1024,
		MaskHeight:      768,
		MaskKind:        MaskBrush,
		IdempotencyKey:  "idem_edit_adapter_001",
		TraceID:         "trace_edit_adapter_001",
	}
}

type fakeProviderClient struct {
	request      provider.Request
	response     provider.Response
	capabilities []provider.Capability
	err          error
}

func (c *fakeProviderClient) Invoke(_ context.Context, req provider.Request) (provider.Response, error) {
	c.request = req
	if c.err != nil {
		return provider.Response{}, c.err
	}
	return c.response, nil
}

func (c *fakeProviderClient) Status(context.Context) provider.Status {
	return provider.Status{ProviderID: "zenari-image-sandbox", Available: true}
}

func (c *fakeProviderClient) Capabilities() []provider.Capability {
	return append([]provider.Capability(nil), c.capabilities...)
}
