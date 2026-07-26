package video

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/provider"
	"github.com/alphane-ai/zenart/backend/internal/security"
)

const EndpointVersion = "zenari_video_generate_adapter_v1"

type AspectRatio string

const (
	AspectRatioSquare    AspectRatio = "1:1"
	AspectRatioLandscape AspectRatio = "16:9"
	AspectRatioPortrait  AspectRatio = "9:16"
)

type PollStatus string

const (
	PollStatusQueued    PollStatus = "queued"
	PollStatusRunning   PollStatus = "running"
	PollStatusSucceeded PollStatus = "succeeded"
	PollStatusFailed    PollStatus = "failed"
	PollStatusCancelled PollStatus = "cancelled"
)

type Input struct {
	RequestID          string      `json:"request_id"`
	TenantID           string      `json:"tenant_id"`
	TaskID             string      `json:"task_id"`
	ProviderID         string      `json:"provider_id"`
	ModelID            string      `json:"model_id"`
	Prompt             string      `json:"prompt"`
	DurationSeconds    int         `json:"duration_seconds"`
	AspectRatio        AspectRatio `json:"aspect_ratio"`
	FirstFrameAssetID  string      `json:"first_frame_asset_id,omitempty"`
	FirstFrameObject   string      `json:"first_frame_object,omitempty"`
	LastFrameAssetID   string      `json:"last_frame_asset_id,omitempty"`
	LastFrameObject    string      `json:"last_frame_object,omitempty"`
	IdempotencyKey     string      `json:"idempotency_key"`
	TraceID            string      `json:"trace_id"`
	ResultAssetID      string      `json:"result_asset_id,omitempty"`
	ResultObjectKey    string      `json:"result_object_key,omitempty"`
	PosterAssetID      string      `json:"poster_asset_id,omitempty"`
	PosterObjectKey    string      `json:"poster_object_key,omitempty"`
	PollIntervalMillis int         `json:"poll_interval_millis,omitempty"`
}

type PollRequest struct {
	RequestID      string `json:"request_id"`
	TenantID       string `json:"tenant_id"`
	TaskID         string `json:"task_id"`
	ProviderID     string `json:"provider_id"`
	ModelID        string `json:"model_id"`
	ProviderJobID  string `json:"provider_job_id"`
	IdempotencyKey string `json:"idempotency_key"`
	TraceID        string `json:"trace_id"`
}

type StatusProjection struct {
	ProviderJobID        string     `json:"provider_job_id"`
	Status               PollStatus `json:"status"`
	ProgressPercent      int        `json:"progress_percent"`
	RetryAfterMillis     int        `json:"retry_after_millis,omitempty"`
	ProviderResponseID   string     `json:"provider_response_id"`
	ProviderStatusDigest string     `json:"provider_status_digest"`
	RawPayloadPersisted  bool       `json:"raw_payload_persisted"`
}

type ResultAsset struct {
	AssetID              string      `json:"asset_id"`
	ObjectKey            string      `json:"object_key"`
	PosterAssetID        string      `json:"poster_asset_id"`
	PosterObjectKey      string      `json:"poster_object_key"`
	ProviderID           string      `json:"provider_id"`
	ModelID              string      `json:"model_id"`
	DurationSeconds      int         `json:"duration_seconds"`
	AspectRatio          AspectRatio `json:"aspect_ratio"`
	FirstFrameAssetID    string      `json:"first_frame_asset_id,omitempty"`
	LastFrameAssetID     string      `json:"last_frame_asset_id,omitempty"`
	RequestHash          string      `json:"request_hash"`
	ProviderResponseID   string      `json:"provider_response_id"`
	ProviderOutputDigest string      `json:"provider_output_digest"`
	RawPayloadPersisted  bool        `json:"raw_payload_persisted"`
	CreatedAt            time.Time   `json:"created_at"`
}

type Client struct {
	Inner provider.Client
	Now   func() time.Time
}

func BuildProviderRequest(input Input) (provider.Request, error) {
	if err := ValidateInput(input); err != nil {
		return provider.Request{}, err
	}
	payload := map[string]any{
		"prompt":                  security.RedactString(strings.TrimSpace(input.Prompt)),
		"duration_seconds":        input.DurationSeconds,
		"aspect_ratio":            string(input.AspectRatio),
		"provider_schema_name":    "zenari.video_generate.v1",
		"raw_payload_allowed":     false,
		"poll_interval_millis":    normalizedPollInterval(input.PollIntervalMillis),
		"result_asset_id":         strings.TrimSpace(input.ResultAssetID),
		"result_object_key":       strings.TrimSpace(input.ResultObjectKey),
		"poster_asset_id":         strings.TrimSpace(input.PosterAssetID),
		"poster_object_key":       strings.TrimSpace(input.PosterObjectKey),
		"storage_result_required": true,
	}
	if strings.TrimSpace(input.FirstFrameAssetID) != "" {
		payload["first_frame_asset_id"] = strings.TrimSpace(input.FirstFrameAssetID)
		payload["first_frame_object"] = strings.TrimSpace(input.FirstFrameObject)
	}
	if strings.TrimSpace(input.LastFrameAssetID) != "" {
		payload["last_frame_asset_id"] = strings.TrimSpace(input.LastFrameAssetID)
		payload["last_frame_object"] = strings.TrimSpace(input.LastFrameObject)
	}
	requestHash := StableHash(payload)
	req := provider.Request{
		ID:             strings.TrimSpace(input.RequestID),
		TenantID:       strings.TrimSpace(input.TenantID),
		TaskID:         strings.TrimSpace(input.TaskID),
		ProviderID:     strings.TrimSpace(input.ProviderID),
		ModelID:        strings.TrimSpace(input.ModelID),
		Endpoint:       "video.generate",
		SchemaVersion:  1,
		IdempotencyKey: strings.TrimSpace(input.IdempotencyKey),
		Payload:        payload,
		TraceID:        strings.TrimSpace(input.TraceID),
		Provenance: provider.Provenance{
			ProviderID:      strings.TrimSpace(input.ProviderID),
			ModelID:         strings.TrimSpace(input.ModelID),
			EndpointVersion: EndpointVersion,
			RequestHash:     requestHash,
			Parameters: map[string]any{
				"duration_seconds": input.DurationSeconds,
				"aspect_ratio":     string(input.AspectRatio),
				"first_frame":      strings.TrimSpace(input.FirstFrameAssetID) != "",
				"last_frame":       strings.TrimSpace(input.LastFrameAssetID) != "",
			},
		},
	}
	if err := provider.ValidateRequest(req); err != nil {
		return provider.Request{}, err
	}
	return req, nil
}

func (c Client) Invoke(ctx context.Context, req provider.Request) (provider.Response, error) {
	if c.Inner == nil {
		return provider.Response{}, errors.New("video adapter inner provider client is required")
	}
	if err := ValidateRequest(req); err != nil {
		return provider.Response{}, err
	}
	resp, err := c.Inner.Invoke(ctx, req)
	if err != nil {
		return provider.Response{}, err
	}
	status := stringPayload(resp.Output, "status")
	if status == "" {
		status = resp.Status
	}
	if status == "" {
		status = string(PollStatusSucceeded)
	}
	normalized, ok := NormalizePollStatus(status)
	if !ok {
		return provider.Response{}, fmt.Errorf("unsupported video provider status %q", status)
	}
	resp.ProviderID = firstNonEmpty(resp.ProviderID, req.ProviderID)
	resp.ModelID = firstNonEmpty(resp.ModelID, req.ModelID)
	resp.TraceID = firstNonEmpty(resp.TraceID, req.TraceID)
	resp.Status = string(normalized)
	resp.Provenance.ProviderID = firstNonEmpty(resp.Provenance.ProviderID, req.ProviderID)
	resp.Provenance.ModelID = firstNonEmpty(resp.Provenance.ModelID, req.ModelID)
	resp.Provenance.EndpointVersion = EndpointVersion
	resp.Provenance.RequestHash = req.Provenance.RequestHash
	if normalized != PollStatusSucceeded {
		projection, err := ProjectStatus(req, resp)
		if err != nil {
			return provider.Response{}, err
		}
		resp.Output = map[string]any{
			"kind":                   "video_generation_status",
			"provider_job_id":        projection.ProviderJobID,
			"status":                 string(projection.Status),
			"progress_percent":       projection.ProgressPercent,
			"retry_after_millis":     projection.RetryAfterMillis,
			"provider_response_id":   projection.ProviderResponseID,
			"provider_status_digest": projection.ProviderStatusDigest,
			"raw_payload_persisted":  false,
		}
		return resp, nil
	}
	result, err := ProjectResultAsset(req, resp, c.now())
	if err != nil {
		return provider.Response{}, err
	}
	resp.Output = map[string]any{
		"kind":                   "video_generation_result",
		"asset_id":               result.AssetID,
		"object_key":             result.ObjectKey,
		"poster_asset_id":        result.PosterAssetID,
		"poster_object_key":      result.PosterObjectKey,
		"duration_seconds":       result.DurationSeconds,
		"aspect_ratio":           string(result.AspectRatio),
		"first_frame_asset_id":   result.FirstFrameAssetID,
		"last_frame_asset_id":    result.LastFrameAssetID,
		"provider_response_id":   result.ProviderResponseID,
		"provider_output_digest": result.ProviderOutputDigest,
		"request_hash":           result.RequestHash,
		"raw_payload_persisted":  false,
	}
	return resp, nil
}

func (c Client) PollStatus(ctx context.Context, poll PollRequest) (StatusProjection, error) {
	if c.Inner == nil {
		return StatusProjection{}, errors.New("video adapter inner provider client is required")
	}
	req, err := BuildStatusRequest(poll)
	if err != nil {
		return StatusProjection{}, err
	}
	resp, err := c.Inner.Invoke(ctx, req)
	if err != nil {
		return StatusProjection{}, err
	}
	return ProjectStatus(req, resp)
}

func BuildStatusRequest(poll PollRequest) (provider.Request, error) {
	required := map[string]string{
		"request_id":      poll.RequestID,
		"tenant_id":       poll.TenantID,
		"task_id":         poll.TaskID,
		"provider_id":     poll.ProviderID,
		"model_id":        poll.ModelID,
		"provider_job_id": poll.ProviderJobID,
		"idempotency_key": poll.IdempotencyKey,
		"trace_id":        poll.TraceID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return provider.Request{}, fmt.Errorf("%s is required", field)
		}
	}
	payload := map[string]any{
		"provider_job_id":        strings.TrimSpace(poll.ProviderJobID),
		"provider_schema_name":   "zenari.video_status.v1",
		"raw_payload_allowed":    false,
		"storage_result_allowed": true,
	}
	if findings := security.ClassifyValue(payload); len(findings) > 0 {
		return provider.Request{}, fmt.Errorf("secret-like video status payload at %s", firstFindingLocation(findings[0]))
	}
	req := provider.Request{
		ID:             strings.TrimSpace(poll.RequestID),
		TenantID:       strings.TrimSpace(poll.TenantID),
		TaskID:         strings.TrimSpace(poll.TaskID),
		ProviderID:     strings.TrimSpace(poll.ProviderID),
		ModelID:        strings.TrimSpace(poll.ModelID),
		Endpoint:       "video.status",
		SchemaVersion:  1,
		IdempotencyKey: strings.TrimSpace(poll.IdempotencyKey),
		Payload:        payload,
		TraceID:        strings.TrimSpace(poll.TraceID),
		Provenance: provider.Provenance{
			ProviderID:      strings.TrimSpace(poll.ProviderID),
			ModelID:         strings.TrimSpace(poll.ModelID),
			EndpointVersion: EndpointVersion,
			RequestHash:     StableHash(payload),
			Parameters: map[string]any{
				"provider_job_id": strings.TrimSpace(poll.ProviderJobID),
				"poll":            true,
			},
		},
	}
	if err := provider.ValidateRequest(req); err != nil {
		return provider.Request{}, err
	}
	return req, nil
}

func (c Client) Status(ctx context.Context) provider.Status {
	if c.Inner == nil {
		return provider.Status{ProviderID: "video-adapter", Available: false, CheckedAt: c.now(), Message: "inner provider client is required"}
	}
	status := c.Inner.Status(ctx)
	status.Message = security.RedactString(status.Message)
	return status
}

func (c Client) Capabilities() []provider.Capability {
	if c.Inner == nil {
		return nil
	}
	capabilities := c.Inner.Capabilities()
	for idx := range capabilities {
		for _, endpoint := range []string{"video.generate", "video.status"} {
			if !contains(capabilities[idx].Endpoints, endpoint) {
				capabilities[idx].Endpoints = append(capabilities[idx].Endpoints, endpoint)
			}
		}
		for _, inputType := range []string{"prompt", "first_frame", "last_frame", "json"} {
			if !contains(capabilities[idx].InputTypes, inputType) {
				capabilities[idx].InputTypes = append(capabilities[idx].InputTypes, inputType)
			}
		}
		if !contains(capabilities[idx].OutputTypes, "video") {
			capabilities[idx].OutputTypes = append(capabilities[idx].OutputTypes, "video")
		}
		if !contains(capabilities[idx].OutputTypes, "thumbnail") {
			capabilities[idx].OutputTypes = append(capabilities[idx].OutputTypes, "thumbnail")
		}
		if !contains(capabilities[idx].ToolTypes, "video.generate") {
			capabilities[idx].ToolTypes = append(capabilities[idx].ToolTypes, "video.generate")
		}
	}
	return capabilities
}

func ValidateInput(input Input) error {
	required := map[string]string{
		"request_id":      input.RequestID,
		"tenant_id":       input.TenantID,
		"task_id":         input.TaskID,
		"provider_id":     input.ProviderID,
		"model_id":        input.ModelID,
		"prompt":          input.Prompt,
		"idempotency_key": input.IdempotencyKey,
		"trace_id":        input.TraceID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required", field)
		}
	}
	if input.DurationSeconds < 1 || input.DurationSeconds > 30 {
		return errors.New("duration_seconds must be between 1 and 30")
	}
	if !ValidAspectRatio(input.AspectRatio) {
		return fmt.Errorf("unsupported aspect_ratio %q", input.AspectRatio)
	}
	if strings.TrimSpace(input.FirstFrameAssetID) != "" && strings.TrimSpace(input.FirstFrameObject) == "" {
		return errors.New("first_frame_object is required when first_frame_asset_id is set")
	}
	if strings.TrimSpace(input.LastFrameAssetID) != "" && strings.TrimSpace(input.LastFrameObject) == "" {
		return errors.New("last_frame_object is required when last_frame_asset_id is set")
	}
	if strings.TrimSpace(input.FirstFrameObject) != "" && !safeStorageObject(input.FirstFrameObject) {
		return errors.New("first_frame_object must be a storage key without query or fragment")
	}
	if strings.TrimSpace(input.LastFrameObject) != "" && !safeStorageObject(input.LastFrameObject) {
		return errors.New("last_frame_object must be a storage key without query or fragment")
	}
	if findings := security.ClassifyValue(map[string]any{
		"request_id":           input.RequestID,
		"tenant_id":            input.TenantID,
		"task_id":              input.TaskID,
		"provider_id":          input.ProviderID,
		"model_id":             input.ModelID,
		"prompt":               input.Prompt,
		"first_frame_asset_id": input.FirstFrameAssetID,
		"first_frame_object":   input.FirstFrameObject,
		"last_frame_asset_id":  input.LastFrameAssetID,
		"last_frame_object":    input.LastFrameObject,
		"idempotency_key":      input.IdempotencyKey,
		"trace_id":             input.TraceID,
		"result_asset_id":      input.ResultAssetID,
		"result_object_key":    input.ResultObjectKey,
		"poster_asset_id":      input.PosterAssetID,
		"poster_object_key":    input.PosterObjectKey,
	}); len(findings) > 0 {
		return fmt.Errorf("secret-like video adapter input at %s", firstFindingLocation(findings[0]))
	}
	return nil
}

func ValidateRequest(req provider.Request) error {
	if err := provider.ValidateRequest(req); err != nil {
		return err
	}
	if req.Endpoint != "video.generate" {
		return fmt.Errorf("video adapter requires video.generate endpoint, got %q", req.Endpoint)
	}
	duration := intPayload(req.Payload, "duration_seconds")
	if duration < 1 || duration > 30 {
		return errors.New("duration_seconds must be between 1 and 30")
	}
	if !ValidAspectRatio(AspectRatio(stringPayload(req.Payload, "aspect_ratio"))) {
		return fmt.Errorf("unsupported aspect_ratio %q", stringPayload(req.Payload, "aspect_ratio"))
	}
	if firstFrame := stringPayload(req.Payload, "first_frame_object"); firstFrame != "" && !safeStorageObject(firstFrame) {
		return errors.New("first_frame_object must be a storage key without query or fragment")
	}
	if lastFrame := stringPayload(req.Payload, "last_frame_object"); lastFrame != "" && !safeStorageObject(lastFrame) {
		return errors.New("last_frame_object must be a storage key without query or fragment")
	}
	if req.Provenance.RequestHash == "" {
		return errors.New("request provenance hash is required")
	}
	if findings := security.ClassifyValue(req.Payload); len(findings) > 0 {
		return fmt.Errorf("secret-like video adapter payload at %s", firstFindingLocation(findings[0]))
	}
	return nil
}

func ProjectStatus(req provider.Request, resp provider.Response) (StatusProjection, error) {
	if req.Endpoint != "video.status" && req.Endpoint != "video.generate" {
		return StatusProjection{}, fmt.Errorf("video status projection requires video endpoint, got %q", req.Endpoint)
	}
	if err := provider.ValidateRequest(req); err != nil {
		return StatusProjection{}, err
	}
	output := resp.Output
	if output == nil {
		output = map[string]any{}
	}
	status, ok := NormalizePollStatus(firstNonEmpty(stringPayload(output, "status"), resp.Status, string(PollStatusRunning)))
	if !ok {
		return StatusProjection{}, fmt.Errorf("unsupported video provider status %q", stringPayload(output, "status"))
	}
	jobID := firstNonEmpty(stringPayload(output, "provider_job_id"), stringPayload(req.Payload, "provider_job_id"), "video-job-"+shortHash(req.ID+":"+resp.ID))
	if findings := security.ClassifyValue(map[string]any{"provider_job_id": jobID, "status": string(status)}); len(findings) > 0 {
		return StatusProjection{}, fmt.Errorf("secret-like video status field at %s", firstFindingLocation(findings[0]))
	}
	progress := intPayload(output, "progress_percent")
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	if status == PollStatusSucceeded {
		progress = 100
	}
	return StatusProjection{
		ProviderJobID:        jobID,
		Status:               status,
		ProgressPercent:      progress,
		RetryAfterMillis:     intPayload(output, "retry_after_millis"),
		ProviderResponseID:   resp.ID,
		ProviderStatusDigest: StableHash(security.RedactMap(output)),
		RawPayloadPersisted:  false,
	}, nil
}

func ProjectResultAsset(req provider.Request, resp provider.Response, now time.Time) (ResultAsset, error) {
	if err := ValidateRequest(req); err != nil {
		return ResultAsset{}, err
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	output := resp.Output
	if output == nil {
		output = map[string]any{}
	}
	assetID := firstNonEmpty(stringPayload(output, "asset_id"), stringPayload(req.Payload, "result_asset_id"), "asset-video-"+shortHash(req.ID+":"+resp.ID))
	objectKey := firstNonEmpty(stringPayload(output, "object_key"), stringPayload(req.Payload, "result_object_key"), "tenants/"+req.TenantID+"/assets/"+assetID+".mp4")
	posterAssetID := firstNonEmpty(stringPayload(output, "poster_asset_id"), stringPayload(req.Payload, "poster_asset_id"), assetID+"-poster")
	posterObjectKey := firstNonEmpty(stringPayload(output, "poster_object_key"), stringPayload(req.Payload, "poster_object_key"), "tenants/"+req.TenantID+"/assets/"+posterAssetID+".jpg")
	if !safeStorageObject(objectKey) || !safeStorageObject(posterObjectKey) {
		return ResultAsset{}, errors.New("video result object keys must be storage keys without query or fragment")
	}
	if findings := security.ClassifyValue(map[string]any{
		"asset_id":          assetID,
		"object_key":        objectKey,
		"poster_asset_id":   posterAssetID,
		"poster_object_key": posterObjectKey,
	}); len(findings) > 0 {
		return ResultAsset{}, fmt.Errorf("secret-like video result field at %s", firstFindingLocation(findings[0]))
	}
	return ResultAsset{
		AssetID:              assetID,
		ObjectKey:            objectKey,
		PosterAssetID:        posterAssetID,
		PosterObjectKey:      posterObjectKey,
		ProviderID:           firstNonEmpty(resp.ProviderID, req.ProviderID),
		ModelID:              firstNonEmpty(resp.ModelID, req.ModelID),
		DurationSeconds:      intPayload(req.Payload, "duration_seconds"),
		AspectRatio:          AspectRatio(stringPayload(req.Payload, "aspect_ratio")),
		FirstFrameAssetID:    stringPayload(req.Payload, "first_frame_asset_id"),
		LastFrameAssetID:     stringPayload(req.Payload, "last_frame_asset_id"),
		RequestHash:          req.Provenance.RequestHash,
		ProviderResponseID:   resp.ID,
		ProviderOutputDigest: StableHash(security.RedactMap(output)),
		RawPayloadPersisted:  false,
		CreatedAt:            now.UTC(),
	}, nil
}

func ValidAspectRatio(ratio AspectRatio) bool {
	switch ratio {
	case AspectRatioSquare, AspectRatioLandscape, AspectRatioPortrait:
		return true
	default:
		return false
	}
}

func NormalizePollStatus(status string) (PollStatus, bool) {
	switch PollStatus(strings.ToLower(strings.TrimSpace(status))) {
	case PollStatusQueued:
		return PollStatusQueued, true
	case PollStatusRunning, "":
		return PollStatusRunning, true
	case PollStatusSucceeded:
		return PollStatusSucceeded, true
	case PollStatusFailed:
		return PollStatusFailed, true
	case PollStatusCancelled:
		return PollStatusCancelled, true
	default:
		return "", false
	}
}

func StableHash(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		encoded = []byte(fmt.Sprintf("%#v", value))
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func normalizedPollInterval(value int) int {
	if value <= 0 {
		return 2000
	}
	if value < 500 {
		return 500
	}
	if value > 30000 {
		return 30000
	}
	return value
}

func (c Client) now() time.Time {
	if c.Now != nil {
		return c.Now().UTC()
	}
	return time.Now().UTC()
}

func safeStorageObject(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && !strings.ContainsAny(value, "?#") && !strings.Contains(value, "://")
}

func stringPayload(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func intPayload(payload map[string]any, key string) int {
	if payload == nil {
		return 0
	}
	switch typed := payload[key].(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func shortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:8])
}

func firstFindingLocation(finding security.SecretFinding) string {
	if strings.TrimSpace(finding.Location) != "" {
		return finding.Location
	}
	return string(finding.Kind)
}
