package edit

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

const EndpointVersion = "zenari_image_edit_adapter_v1"

type ToolType string

const (
	ToolRemoveBackground ToolType = "remove_background"
	ToolUpscale          ToolType = "upscale"
	ToolErase            ToolType = "erase"
	ToolExpand           ToolType = "expand"
)

type MaskKind string

const (
	MaskBrush MaskKind = "brush"
	MaskRect  MaskKind = "rect"
	MaskLasso MaskKind = "lasso"
)

type Input struct {
	RequestID        string   `json:"request_id"`
	TenantID         string   `json:"tenant_id"`
	TaskID           string   `json:"task_id"`
	ProviderID       string   `json:"provider_id"`
	ModelID          string   `json:"model_id"`
	Tool             ToolType `json:"tool"`
	Prompt           string   `json:"prompt,omitempty"`
	SourceAssetID    string   `json:"source_asset_id"`
	SourceObjectKey  string   `json:"source_object_key"`
	SourceWidth      int      `json:"source_width"`
	SourceHeight     int      `json:"source_height"`
	MaskAssetID      string   `json:"mask_asset_id,omitempty"`
	MaskObjectKey    string   `json:"mask_object_key,omitempty"`
	MaskWidth        int      `json:"mask_width,omitempty"`
	MaskHeight       int      `json:"mask_height,omitempty"`
	MaskKind         MaskKind `json:"mask_kind,omitempty"`
	IdempotencyKey   string   `json:"idempotency_key"`
	TraceID          string   `json:"trace_id"`
	DerivedAssetID   string   `json:"derived_asset_id,omitempty"`
	DerivedObjectKey string   `json:"derived_object_key,omitempty"`
}

type EditResultAsset struct {
	AssetID              string    `json:"asset_id"`
	ObjectKey            string    `json:"object_key"`
	OriginalAssetID      string    `json:"original_asset_id"`
	DerivedFromAssetID   string    `json:"derived_from_asset_id"`
	ProviderID           string    `json:"provider_id"`
	ModelID              string    `json:"model_id"`
	Tool                 ToolType  `json:"tool"`
	MaskAssetID          string    `json:"mask_asset_id,omitempty"`
	MaskKind             MaskKind  `json:"mask_kind,omitempty"`
	RequestHash          string    `json:"request_hash"`
	ProviderResponseID   string    `json:"provider_response_id"`
	ProviderOutputDigest string    `json:"provider_output_digest"`
	RawPayloadPersisted  bool      `json:"raw_payload_persisted"`
	CreatedAt            time.Time `json:"created_at"`
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
		"tool":                 string(input.Tool),
		"prompt":               security.RedactString(strings.TrimSpace(input.Prompt)),
		"source_asset_id":      strings.TrimSpace(input.SourceAssetID),
		"source_object":        strings.TrimSpace(input.SourceObjectKey),
		"source_width":         input.SourceWidth,
		"source_height":        input.SourceHeight,
		"provider_schema_name": "zenari.image_edit.v1",
		"raw_payload_allowed":  false,
	}
	if maskRequired(input.Tool) {
		payload["mask_asset_id"] = strings.TrimSpace(input.MaskAssetID)
		payload["mask_object"] = strings.TrimSpace(input.MaskObjectKey)
		payload["mask_width"] = input.MaskWidth
		payload["mask_height"] = input.MaskHeight
		payload["mask_kind"] = string(input.MaskKind)
	}
	requestHash := StableRequestHash(payload)
	req := provider.Request{
		ID:             strings.TrimSpace(input.RequestID),
		TenantID:       strings.TrimSpace(input.TenantID),
		TaskID:         strings.TrimSpace(input.TaskID),
		ProviderID:     strings.TrimSpace(input.ProviderID),
		ModelID:        strings.TrimSpace(input.ModelID),
		Endpoint:       "image.edit",
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
				"tool":         string(input.Tool),
				"mask_present": maskRequired(input.Tool),
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
		return provider.Response{}, errors.New("edit adapter inner provider client is required")
	}
	if err := ValidateRequest(req); err != nil {
		return provider.Response{}, err
	}
	resp, err := c.Inner.Invoke(ctx, req)
	if err != nil {
		return provider.Response{}, err
	}
	if resp.Output == nil {
		resp.Output = map[string]any{}
	}
	result, err := ProjectResultAsset(req, resp, c.now())
	if err != nil {
		return provider.Response{}, err
	}
	resp.ProviderID = firstNonEmpty(resp.ProviderID, req.ProviderID)
	resp.ModelID = firstNonEmpty(resp.ModelID, req.ModelID)
	resp.TraceID = firstNonEmpty(resp.TraceID, req.TraceID)
	resp.Status = firstNonEmpty(resp.Status, "succeeded")
	resp.Provenance.ProviderID = firstNonEmpty(resp.Provenance.ProviderID, req.ProviderID)
	resp.Provenance.ModelID = firstNonEmpty(resp.Provenance.ModelID, req.ModelID)
	resp.Provenance.EndpointVersion = EndpointVersion
	resp.Provenance.RequestHash = req.Provenance.RequestHash
	resp.Output = map[string]any{
		"kind":                   "image_edit_result",
		"asset_id":               result.AssetID,
		"object_key":             result.ObjectKey,
		"original_asset_id":      result.OriginalAssetID,
		"derived_from_asset_id":  result.DerivedFromAssetID,
		"tool":                   string(result.Tool),
		"mask_asset_id":          result.MaskAssetID,
		"mask_kind":              string(result.MaskKind),
		"provider_response_id":   result.ProviderResponseID,
		"provider_output_digest": result.ProviderOutputDigest,
		"request_hash":           result.RequestHash,
		"raw_payload_persisted":  false,
	}
	return resp, nil
}

func (c Client) Status(ctx context.Context) provider.Status {
	if c.Inner == nil {
		return provider.Status{ProviderID: "edit-adapter", Available: false, CheckedAt: c.now(), Message: "inner provider client is required"}
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
		if !contains(capabilities[idx].Endpoints, "image.edit") {
			capabilities[idx].Endpoints = append(capabilities[idx].Endpoints, "image.edit")
		}
		for _, tool := range []string{string(ToolRemoveBackground), string(ToolUpscale), string(ToolErase), string(ToolExpand)} {
			if !contains(capabilities[idx].ToolTypes, tool) {
				capabilities[idx].ToolTypes = append(capabilities[idx].ToolTypes, tool)
			}
		}
		if !contains(capabilities[idx].InputTypes, "mask") {
			capabilities[idx].InputTypes = append(capabilities[idx].InputTypes, "mask")
		}
		if !contains(capabilities[idx].OutputTypes, "image") {
			capabilities[idx].OutputTypes = append(capabilities[idx].OutputTypes, "image")
		}
	}
	return capabilities
}

func ValidateInput(input Input) error {
	required := map[string]string{
		"request_id":        input.RequestID,
		"tenant_id":         input.TenantID,
		"task_id":           input.TaskID,
		"provider_id":       input.ProviderID,
		"model_id":          input.ModelID,
		"source_asset_id":   input.SourceAssetID,
		"source_object_key": input.SourceObjectKey,
		"idempotency_key":   input.IdempotencyKey,
		"trace_id":          input.TraceID,
	}
	for field, value := range required {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required", field)
		}
	}
	if !validTool(input.Tool) {
		return fmt.Errorf("unsupported edit tool %q", input.Tool)
	}
	if input.SourceWidth <= 0 || input.SourceHeight <= 0 {
		return errors.New("source dimensions must be positive")
	}
	if maskRequired(input.Tool) {
		if strings.TrimSpace(input.MaskAssetID) == "" || strings.TrimSpace(input.MaskObjectKey) == "" {
			return fmt.Errorf("mask asset and object are required for %s", input.Tool)
		}
		if !validMaskKind(input.MaskKind) {
			return fmt.Errorf("unsupported mask kind %q", input.MaskKind)
		}
		if input.MaskWidth != input.SourceWidth || input.MaskHeight != input.SourceHeight {
			return errors.New("mask dimensions must match source dimensions")
		}
	}
	if findings := security.ClassifyValue(map[string]any{
		"request_id":         input.RequestID,
		"tenant_id":          input.TenantID,
		"task_id":            input.TaskID,
		"provider_id":        input.ProviderID,
		"model_id":           input.ModelID,
		"tool":               string(input.Tool),
		"prompt":             input.Prompt,
		"source_asset_id":    input.SourceAssetID,
		"source_object_key":  input.SourceObjectKey,
		"mask_asset_id":      input.MaskAssetID,
		"mask_object_key":    input.MaskObjectKey,
		"idempotency_key":    input.IdempotencyKey,
		"trace_id":           input.TraceID,
		"derived_asset_id":   input.DerivedAssetID,
		"derived_object_key": input.DerivedObjectKey,
	}); len(findings) > 0 {
		return fmt.Errorf("secret-like edit adapter input at %s", firstFindingLocation(findings[0]))
	}
	return nil
}

func ValidateRequest(req provider.Request) error {
	if err := provider.ValidateRequest(req); err != nil {
		return err
	}
	if req.Endpoint != "image.edit" {
		return fmt.Errorf("edit adapter requires image.edit endpoint, got %q", req.Endpoint)
	}
	tool := ToolType(stringPayload(req.Payload, "tool"))
	if !validTool(tool) {
		return fmt.Errorf("unsupported edit tool %q", tool)
	}
	sourceAssetID := stringPayload(req.Payload, "source_asset_id")
	sourceObjectKey := stringPayload(req.Payload, "source_object")
	sourceWidth, sourceHeight := intPayload(req.Payload, "source_width"), intPayload(req.Payload, "source_height")
	if sourceAssetID == "" || sourceObjectKey == "" || sourceWidth <= 0 || sourceHeight <= 0 {
		return errors.New("source asset, object, and dimensions are required")
	}
	if maskRequired(tool) {
		maskAssetID := stringPayload(req.Payload, "mask_asset_id")
		maskObjectKey := stringPayload(req.Payload, "mask_object")
		maskWidth, maskHeight := intPayload(req.Payload, "mask_width"), intPayload(req.Payload, "mask_height")
		if maskAssetID == "" || maskObjectKey == "" || !validMaskKind(MaskKind(stringPayload(req.Payload, "mask_kind"))) {
			return fmt.Errorf("mask fields are required for %s", tool)
		}
		if maskWidth != sourceWidth || maskHeight != sourceHeight {
			return errors.New("mask dimensions must match source dimensions")
		}
	}
	if req.Provenance.RequestHash == "" {
		return errors.New("request provenance hash is required")
	}
	if findings := security.ClassifyValue(req.Payload); len(findings) > 0 {
		return fmt.Errorf("secret-like edit adapter payload at %s", firstFindingLocation(findings[0]))
	}
	return nil
}

func ProjectResultAsset(req provider.Request, resp provider.Response, now time.Time) (EditResultAsset, error) {
	if err := ValidateRequest(req); err != nil {
		return EditResultAsset{}, err
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	output := resp.Output
	if output == nil {
		output = map[string]any{}
	}
	assetID := firstNonEmpty(stringPayload(output, "asset_id"), "asset-edit-"+shortHash(req.ID+":"+resp.ID))
	objectKey := firstNonEmpty(stringPayload(output, "object_key"), "tenants/"+req.TenantID+"/assets/"+assetID+".png")
	if strings.TrimSpace(assetID) == "" || strings.TrimSpace(objectKey) == "" {
		return EditResultAsset{}, errors.New("result asset id and object key are required")
	}
	if findings := security.ClassifyValue(map[string]any{"asset_id": assetID, "object_key": objectKey}); len(findings) > 0 {
		return EditResultAsset{}, fmt.Errorf("secret-like edit result field at %s", firstFindingLocation(findings[0]))
	}
	return EditResultAsset{
		AssetID:              assetID,
		ObjectKey:            objectKey,
		OriginalAssetID:      stringPayload(req.Payload, "source_asset_id"),
		DerivedFromAssetID:   stringPayload(req.Payload, "source_asset_id"),
		ProviderID:           firstNonEmpty(resp.ProviderID, req.ProviderID),
		ModelID:              firstNonEmpty(resp.ModelID, req.ModelID),
		Tool:                 ToolType(stringPayload(req.Payload, "tool")),
		MaskAssetID:          stringPayload(req.Payload, "mask_asset_id"),
		MaskKind:             MaskKind(stringPayload(req.Payload, "mask_kind")),
		RequestHash:          req.Provenance.RequestHash,
		ProviderResponseID:   resp.ID,
		ProviderOutputDigest: StableRequestHash(security.RedactMap(output)),
		RawPayloadPersisted:  false,
		CreatedAt:            now.UTC(),
	}, nil
}

func StableRequestHash(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		encoded = []byte(fmt.Sprintf("%#v", value))
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func (c Client) now() time.Time {
	if c.Now != nil {
		return c.Now().UTC()
	}
	return time.Now().UTC()
}

func validTool(tool ToolType) bool {
	switch tool {
	case ToolRemoveBackground, ToolUpscale, ToolErase, ToolExpand:
		return true
	default:
		return false
	}
}

func maskRequired(tool ToolType) bool {
	switch tool {
	case ToolErase, ToolExpand:
		return true
	default:
		return false
	}
}

func validMaskKind(kind MaskKind) bool {
	switch kind {
	case MaskBrush, MaskRect, MaskLasso:
		return true
	default:
		return false
	}
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
