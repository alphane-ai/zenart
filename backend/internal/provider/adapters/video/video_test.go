package video

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/provider"
)

func TestBuildProviderRequestRequiresDurationAspectAndFrameStorageKeys(t *testing.T) {
	input := validInput()
	input.DurationSeconds = 0
	if _, err := BuildProviderRequest(input); err == nil || !strings.Contains(err.Error(), "duration_seconds") {
		t.Fatalf("BuildProviderRequest() error = %v, want duration rejection", err)
	}

	input = validInput()
	input.AspectRatio = "21:9"
	if _, err := BuildProviderRequest(input); err == nil || !strings.Contains(err.Error(), "aspect_ratio") {
		t.Fatalf("BuildProviderRequest() error = %v, want aspect rejection", err)
	}

	input = validInput()
	input.FirstFrameObject = "https://cdn.example.test/frame.png?token=value"
	if _, err := BuildProviderRequest(input); err == nil || !strings.Contains(err.Error(), "storage key") {
		t.Fatalf("BuildProviderRequest() error = %v, want unsafe frame object rejection", err)
	}

	req, err := BuildProviderRequest(validInput())
	if err != nil {
		t.Fatalf("BuildProviderRequest() error = %v", err)
	}
	if req.Endpoint != "video.generate" || req.Payload["duration_seconds"] != 6 || req.Payload["aspect_ratio"] != "16:9" {
		t.Fatalf("request = %#v, want video.generate duration/aspect request", req)
	}
	if req.Payload["first_frame_asset_id"] != "asset_first_frame" || req.Payload["last_frame_asset_id"] != "asset_last_frame" {
		t.Fatalf("frame payload = %#v", req.Payload)
	}
	if req.Provenance.EndpointVersion != EndpointVersion || req.Provenance.RequestHash == "" {
		t.Fatalf("provenance = %#v", req.Provenance)
	}
}

func TestClientInvokeProjectsQueuedStatusWithoutRawPayload(t *testing.T) {
	req, err := BuildProviderRequest(validInput())
	if err != nil {
		t.Fatalf("BuildProviderRequest() error = %v", err)
	}
	inner := &fakeProviderClient{response: provider.Response{
		ID:        "provider_video_status_1",
		RequestID: req.ID,
		Status:    "running",
		Output: map[string]any{
			"provider_job_id":      "video_job_001",
			"status":               "running",
			"progress_percent":     42,
			"retry_after_millis":   2000,
			"raw_provider_payload": "should not be projected",
		},
		TraceID: req.TraceID,
	}}
	resp, err := (Client{Inner: inner}).Invoke(context.Background(), req)
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if inner.request.Endpoint != "video.generate" {
		t.Fatalf("inner request endpoint = %q", inner.request.Endpoint)
	}
	if resp.Status != "running" || resp.Output["kind"] != "video_generation_status" || resp.Output["provider_job_id"] != "video_job_001" {
		t.Fatalf("status output = %#v", resp.Output)
	}
	if resp.Output["raw_payload_persisted"] != false {
		t.Fatalf("raw_payload_persisted = %#v", resp.Output["raw_payload_persisted"])
	}
	if _, ok := resp.Output["raw_provider_payload"]; ok {
		t.Fatalf("raw provider payload leaked into status output: %#v", resp.Output)
	}
}

func TestClientInvokeProjectsStorageResultAssetAndPoster(t *testing.T) {
	now := time.Date(2026, 6, 22, 12, 30, 0, 0, time.UTC)
	req, err := BuildProviderRequest(validInput())
	if err != nil {
		t.Fatalf("BuildProviderRequest() error = %v", err)
	}
	inner := &fakeProviderClient{response: provider.Response{
		ID:         "provider_video_result_1",
		RequestID:  req.ID,
		ProviderID: req.ProviderID,
		ModelID:    req.ModelID,
		Status:     "succeeded",
		Output: map[string]any{
			"asset_id":             "asset_video_001",
			"object_key":           "tenants/tenant_1/assets/asset_video_001.mp4",
			"poster_asset_id":      "asset_video_001_poster",
			"poster_object_key":    "tenants/tenant_1/assets/asset_video_001_poster.jpg",
			"raw_provider_payload": "should not be projected",
		},
		Usage:   provider.Usage{CostUnits: 11},
		TraceID: req.TraceID,
	}}
	resp, err := (Client{Inner: inner, Now: func() time.Time { return now }}).Invoke(context.Background(), req)
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if resp.Output["kind"] != "video_generation_result" || resp.Output["asset_id"] != "asset_video_001" || resp.Output["poster_asset_id"] != "asset_video_001_poster" {
		t.Fatalf("result output = %#v", resp.Output)
	}
	if resp.Output["duration_seconds"] != 6 || resp.Output["aspect_ratio"] != "16:9" {
		t.Fatalf("duration/aspect output = %#v", resp.Output)
	}
	if resp.Output["first_frame_asset_id"] != "asset_first_frame" || resp.Output["last_frame_asset_id"] != "asset_last_frame" {
		t.Fatalf("frame lineage output = %#v", resp.Output)
	}
	if _, ok := resp.Output["raw_provider_payload"]; ok {
		t.Fatalf("raw provider payload leaked into result output: %#v", resp.Output)
	}
	if resp.CompletedAt.Equal(now) {
		t.Fatalf("adapter should not fabricate provider completion time from local projection")
	}
}

func TestPollStatusBuildsStatusRequestAndProjectsSafeStatus(t *testing.T) {
	inner := &fakeProviderClient{response: provider.Response{
		ID:     "provider_video_status_2",
		Status: "queued",
		Output: map[string]any{
			"provider_job_id":    "video_job_002",
			"status":             "queued",
			"progress_percent":   -10,
			"retry_after_millis": 3000,
		},
	}}
	projection, err := (Client{Inner: inner}).PollStatus(context.Background(), validPollRequest())
	if err != nil {
		t.Fatalf("PollStatus() error = %v", err)
	}
	if inner.request.Endpoint != "video.status" || inner.request.Payload["provider_job_id"] != "video_job_002" {
		t.Fatalf("poll request = %#v", inner.request)
	}
	if projection.ProviderJobID != "video_job_002" || projection.Status != PollStatusQueued || projection.ProgressPercent != 0 {
		t.Fatalf("projection = %#v", projection)
	}
	if projection.RawPayloadPersisted {
		t.Fatalf("raw payload persisted = true")
	}
}

func TestProjectResultAssetRejectsSecretLikeStorageResult(t *testing.T) {
	req, err := BuildProviderRequest(validInput())
	if err != nil {
		t.Fatalf("BuildProviderRequest() error = %v", err)
	}
	_, err = ProjectResultAsset(req, provider.Response{
		ID: "provider_video_result_1",
		Output: map[string]any{
			"asset_id":          "asset_video_001",
			"object_key":        "tenants/tenant_1/assets/asset_video_001.mp4?X-Amz-Signature=abcdef",
			"poster_asset_id":   "asset_video_001_poster",
			"poster_object_key": "tenants/tenant_1/assets/asset_video_001_poster.jpg",
		},
	}, time.Now())
	if err == nil || !strings.Contains(err.Error(), "storage keys") {
		t.Fatalf("ProjectResultAsset() error = %v, want unsafe storage result rejection", err)
	}
}

func TestCapabilitiesExposeVideoGenerateStatusAndFrameInputs(t *testing.T) {
	inner := &fakeProviderClient{capabilities: []provider.Capability{{
		ProviderID:  "zenari-video-sandbox",
		ModelID:     "video-fast-v1",
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
	for _, want := range []string{"video.generate", "video.status"} {
		if !contains(got.Endpoints, want) {
			t.Fatalf("endpoints = %#v, missing %s", got.Endpoints, want)
		}
	}
	for _, want := range []string{"first_frame", "last_frame"} {
		if !contains(got.InputTypes, want) {
			t.Fatalf("input types = %#v, missing %s", got.InputTypes, want)
		}
	}
	for _, want := range []string{"video", "thumbnail"} {
		if !contains(got.OutputTypes, want) {
			t.Fatalf("output types = %#v, missing %s", got.OutputTypes, want)
		}
	}
	if !contains(got.ToolTypes, "video.generate") {
		t.Fatalf("tool types = %#v, missing video.generate", got.ToolTypes)
	}
}

func TestValidateInputRejectsSecretLikePrompt(t *testing.T) {
	input := validInput()
	input.Prompt = "make a launch video with Bearer abcdefghijklmnop"
	if err := ValidateInput(input); err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("ValidateInput() error = %v, want secret-like prompt rejection", err)
	}
}

func validInput() Input {
	return Input{
		RequestID:          "video_provider_request_001",
		TenantID:           "tenant_1",
		TaskID:             "video_task_001",
		ProviderID:         "zenari-video-sandbox",
		ModelID:            "video-fast-v1",
		Prompt:             "Animate the product hero shot into a six second launch clip.",
		DurationSeconds:    6,
		AspectRatio:        AspectRatioLandscape,
		FirstFrameAssetID:  "asset_first_frame",
		FirstFrameObject:   "tenants/tenant_1/assets/asset_first_frame.png",
		LastFrameAssetID:   "asset_last_frame",
		LastFrameObject:    "tenants/tenant_1/assets/asset_last_frame.png",
		IdempotencyKey:     "idem_video_adapter_001",
		TraceID:            "trace_video_adapter_001",
		PollIntervalMillis: 2000,
	}
}

func validPollRequest() PollRequest {
	return PollRequest{
		RequestID:      "video_status_request_001",
		TenantID:       "tenant_1",
		TaskID:         "video_task_001",
		ProviderID:     "zenari-video-sandbox",
		ModelID:        "video-fast-v1",
		ProviderJobID:  "video_job_002",
		IdempotencyKey: "idem_video_status_001",
		TraceID:        "trace_video_adapter_001",
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
	return provider.Status{ProviderID: "zenari-video-sandbox", Available: true}
}

func (c *fakeProviderClient) Capabilities() []provider.Capability {
	return append([]provider.Capability(nil), c.capabilities...)
}
