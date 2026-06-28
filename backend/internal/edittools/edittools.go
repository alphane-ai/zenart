package edittools

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/assets"
	"github.com/alphane-ai/zenart/backend/internal/provider"
	"github.com/alphane-ai/zenart/backend/internal/security"
)

type ToolType string

const (
	ToolCrop             ToolType = "crop"
	ToolRotate           ToolType = "rotate"
	ToolFlip             ToolType = "flip"
	ToolRemoveBackground ToolType = "remove_background"
	ToolUpscale          ToolType = "upscale"
	ToolErase            ToolType = "erase"
	ToolExpand           ToolType = "expand"
)

type MaskKind string

const (
	MaskKindBrush MaskKind = "brush"
	MaskKindRect  MaskKind = "rect"
	MaskKindLasso MaskKind = "lasso"
)

type Rect struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type MaskInput struct {
	AssetID      string   `json:"asset_id"`
	ObjectKey    string   `json:"object_key"`
	Width        int      `json:"width"`
	Height       int      `json:"height"`
	Kind         MaskKind `json:"kind"`
	CoveragePct  float64  `json:"coverage_pct"`
	Checksum     string   `json:"checksum,omitempty"`
	SourceNodeID string   `json:"source_node_id,omitempty"`
}

type TransformMetadata struct {
	Crop   *Rect  `json:"crop,omitempty"`
	Rotate int    `json:"rotate,omitempty"`
	FlipX  bool   `json:"flip_x,omitempty"`
	FlipY  bool   `json:"flip_y,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type Request struct {
	ID             string             `json:"id"`
	TenantID       string             `json:"tenant_id"`
	ProjectID      string             `json:"project_id,omitempty"`
	UserID         string             `json:"user_id"`
	SourceAsset    assets.VisualAsset `json:"source_asset"`
	Tool           ToolType           `json:"tool"`
	Mask           *MaskInput         `json:"mask,omitempty"`
	Transform      TransformMetadata  `json:"transform,omitempty"`
	Prompt         string             `json:"prompt,omitempty"`
	ProviderID     string             `json:"provider_id,omitempty"`
	ModelID        string             `json:"model_id,omitempty"`
	TraceID        string             `json:"trace_id,omitempty"`
	IdempotencyKey string             `json:"idempotency_key,omitempty"`
	CreatedAt      time.Time          `json:"created_at"`
}

type Revision struct {
	ID                    string            `json:"id"`
	OriginalAssetID       string            `json:"original_asset_id"`
	DerivedAssetID        string            `json:"derived_asset_id"`
	Tool                  ToolType          `json:"tool"`
	NonDestructive        bool              `json:"non_destructive"`
	OriginalAssetRetained bool              `json:"original_asset_retained"`
	Transform             TransformMetadata `json:"transform,omitempty"`
	Mask                  *MaskInput        `json:"mask,omitempty"`
	Lineage               assets.Lineage    `json:"lineage"`
	ProviderRequest       *provider.Request `json:"provider_request,omitempty"`
	CreatedAt             time.Time         `json:"created_at"`
}

type UserProjection struct {
	ID                    string         `json:"id"`
	OriginalAssetID       string         `json:"original_asset_id"`
	DerivedAssetID        string         `json:"derived_asset_id"`
	Tool                  ToolType       `json:"tool"`
	NonDestructive        bool           `json:"non_destructive"`
	OriginalAssetRetained bool           `json:"original_asset_retained"`
	MaskAssetID           string         `json:"mask_asset_id,omitempty"`
	MaskKind              MaskKind       `json:"mask_kind,omitempty"`
	MaskWidth             int            `json:"mask_width,omitempty"`
	MaskHeight            int            `json:"mask_height,omitempty"`
	Lineage               assets.Lineage `json:"lineage"`
	CreatedAt             time.Time      `json:"created_at"`
}

var ErrValidation = errors.New("edit tool validation error")

func ValidateRequest(request Request) error {
	request.ID = strings.TrimSpace(request.ID)
	request.TenantID = strings.TrimSpace(request.TenantID)
	request.UserID = strings.TrimSpace(request.UserID)
	if request.ID == "" || request.TenantID == "" || request.UserID == "" {
		return fmt.Errorf("%w: id, tenant_id, and user_id are required", ErrValidation)
	}
	if !ValidToolType(request.Tool) {
		return fmt.Errorf("%w: unsupported tool %q", ErrValidation, request.Tool)
	}
	if err := assets.EnsureTenant(request.TenantID, request.SourceAsset); err != nil {
		return err
	}
	if err := assets.ValidateVisualAsset(request.SourceAsset); err != nil {
		return err
	}
	if request.SourceAsset.Status != assets.AssetStatusActive {
		return fmt.Errorf("%w: source asset must be active", ErrValidation)
	}
	if IsMaskRequired(request.Tool) {
		if request.Mask == nil {
			return fmt.Errorf("%w: mask is required for %s", ErrValidation, request.Tool)
		}
		if err := ValidateMask(*request.Mask, request.SourceAsset); err != nil {
			return err
		}
	}
	if IsAIEditTool(request.Tool) && (strings.TrimSpace(request.ProviderID) == "" || strings.TrimSpace(request.ModelID) == "") {
		return fmt.Errorf("%w: provider_id and model_id are required for AI edit tools", ErrValidation)
	}
	if findings := security.ClassifyValue(map[string]any{
		"id":              request.ID,
		"tenant_id":       request.TenantID,
		"project_id":      request.ProjectID,
		"user_id":         request.UserID,
		"tool":            string(request.Tool),
		"mask":            request.Mask,
		"transform":       request.Transform,
		"prompt":          request.Prompt,
		"provider_id":     request.ProviderID,
		"model_id":        request.ModelID,
		"trace_id":        request.TraceID,
		"idempotency_key": request.IdempotencyKey,
	}); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like edit request at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func ValidateMask(mask MaskInput, source assets.VisualAsset) error {
	if strings.TrimSpace(mask.AssetID) == "" || strings.TrimSpace(mask.ObjectKey) == "" {
		return fmt.Errorf("%w: mask asset_id and object_key are required", ErrValidation)
	}
	if !ValidMaskKind(mask.Kind) {
		return fmt.Errorf("%w: unsupported mask kind %q", ErrValidation, mask.Kind)
	}
	sourceWidth, sourceHeight := sourceDimensions(source)
	if mask.Width <= 0 || mask.Height <= 0 {
		return fmt.Errorf("%w: mask width and height must be positive", ErrValidation)
	}
	if sourceWidth > 0 && sourceHeight > 0 && (mask.Width != sourceWidth || mask.Height != sourceHeight) {
		return fmt.Errorf("%w: mask dimensions must match source asset", ErrValidation)
	}
	if mask.CoveragePct <= 0 || mask.CoveragePct > 1 || math.IsNaN(mask.CoveragePct) {
		return fmt.Errorf("%w: mask coverage must be between 0 and 1", ErrValidation)
	}
	if findings := security.ClassifyValue(map[string]any{"asset_id": mask.AssetID, "object_key": mask.ObjectKey, "checksum": mask.Checksum}); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like mask field at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func BuildRevision(request Request, derivedAsset assets.VisualAsset, now time.Time) (Revision, error) {
	if err := ValidateRequest(request); err != nil {
		return Revision{}, err
	}
	if err := assets.EnsureTenant(request.TenantID, derivedAsset); err != nil {
		return Revision{}, err
	}
	if err := assets.ValidateVisualAsset(derivedAsset); err != nil {
		return Revision{}, err
	}
	if derivedAsset.ID == request.SourceAsset.ID {
		return Revision{}, fmt.Errorf("%w: derived asset must be a new revision", ErrValidation)
	}
	if derivedAsset.Lineage.DerivedFromAssetID != request.SourceAsset.ID || derivedAsset.Lineage.OriginalAssetID != request.SourceAsset.ID {
		return Revision{}, fmt.Errorf("%w: derived asset lineage must keep original and derived_from asset ids", ErrValidation)
	}
	if derivedAsset.Lineage.RawPayloadPersisted {
		return Revision{}, fmt.Errorf("%w: raw provider payload must not be persisted", ErrValidation)
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}

	lineage := derivedAsset.Lineage
	lineage.ToolType = string(request.Tool)
	if lineage.RequestHash == "" {
		lineage.RequestHash = requestHash(request)
	}

	revision := Revision{
		ID:                    "revision_" + request.ID,
		OriginalAssetID:       request.SourceAsset.ID,
		DerivedAssetID:        derivedAsset.ID,
		Tool:                  request.Tool,
		NonDestructive:        !IsAIEditTool(request.Tool),
		OriginalAssetRetained: true,
		Transform:             request.Transform,
		Mask:                  request.Mask,
		Lineage:               lineage,
		CreatedAt:             now,
	}
	if IsAIEditTool(request.Tool) {
		providerRequest, err := BuildProviderRequest(request)
		if err != nil {
			return Revision{}, err
		}
		revision.ProviderRequest = &providerRequest
	}
	return revision, nil
}

func BuildProviderRequest(request Request) (provider.Request, error) {
	if err := ValidateRequest(request); err != nil {
		return provider.Request{}, err
	}
	if !IsAIEditTool(request.Tool) {
		return provider.Request{}, fmt.Errorf("%w: provider request is only valid for AI edit tools", ErrValidation)
	}
	payload := map[string]any{
		"tool":            string(request.Tool),
		"source_asset_id": request.SourceAsset.ID,
		"source_object":   request.SourceAsset.StorageRef.ObjectKey,
		"prompt":          request.Prompt,
	}
	if request.Mask != nil {
		payload["mask_asset_id"] = request.Mask.AssetID
		payload["mask_object"] = request.Mask.ObjectKey
		payload["mask_width"] = request.Mask.Width
		payload["mask_height"] = request.Mask.Height
		payload["mask_kind"] = string(request.Mask.Kind)
	}
	return provider.Request{
		ID:             "edit_provider_" + request.ID,
		TenantID:       request.TenantID,
		TaskID:         request.ID,
		ProviderID:     request.ProviderID,
		ModelID:        request.ModelID,
		Endpoint:       "image.edit",
		SchemaVersion:  1,
		IdempotencyKey: request.IdempotencyKey,
		Payload:        payload,
		TraceID:        request.TraceID,
		Provenance: provider.Provenance{
			ProviderID:  request.ProviderID,
			ModelID:     request.ModelID,
			RequestHash: requestHash(request),
			Parameters: map[string]any{
				"tool": string(request.Tool),
			},
		},
	}, nil
}

func ProjectRevisionForUser(revision Revision) (UserProjection, error) {
	if revision.ID == "" || revision.OriginalAssetID == "" || revision.DerivedAssetID == "" {
		return UserProjection{}, fmt.Errorf("%w: revision identity is required", ErrValidation)
	}
	if revision.Lineage.RawPayloadPersisted {
		return UserProjection{}, fmt.Errorf("%w: raw provider payload must not be projected", ErrValidation)
	}
	projection := UserProjection{
		ID:                    revision.ID,
		OriginalAssetID:       revision.OriginalAssetID,
		DerivedAssetID:        revision.DerivedAssetID,
		Tool:                  revision.Tool,
		NonDestructive:        revision.NonDestructive,
		OriginalAssetRetained: revision.OriginalAssetRetained,
		Lineage:               revision.Lineage,
		CreatedAt:             revision.CreatedAt,
	}
	if revision.Mask != nil {
		projection.MaskAssetID = revision.Mask.AssetID
		projection.MaskKind = revision.Mask.Kind
		projection.MaskWidth = revision.Mask.Width
		projection.MaskHeight = revision.Mask.Height
	}
	return projection, nil
}

func ValidToolType(tool ToolType) bool {
	switch tool {
	case ToolCrop, ToolRotate, ToolFlip, ToolRemoveBackground, ToolUpscale, ToolErase, ToolExpand:
		return true
	default:
		return false
	}
}

func IsAIEditTool(tool ToolType) bool {
	switch tool {
	case ToolRemoveBackground, ToolUpscale, ToolErase, ToolExpand:
		return true
	default:
		return false
	}
}

func IsMaskRequired(tool ToolType) bool {
	switch tool {
	case ToolErase, ToolExpand:
		return true
	default:
		return false
	}
}

func ValidMaskKind(kind MaskKind) bool {
	switch kind {
	case MaskKindBrush, MaskKindRect, MaskKindLasso:
		return true
	default:
		return false
	}
}

func sourceDimensions(source assets.VisualAsset) (int, int) {
	width, _ := intMetadata(source.ObjectMetadata.Metadata, "width")
	height, _ := intMetadata(source.ObjectMetadata.Metadata, "height")
	return width, height
}

func intMetadata(metadata map[string]any, key string) (int, bool) {
	value, ok := metadata[key]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	default:
		return 0, false
	}
}

func requestHash(request Request) string {
	parts := []string{
		request.ID,
		request.SourceAsset.ID,
		string(request.Tool),
		request.Prompt,
		request.ProviderID,
		request.ModelID,
	}
	if request.Mask != nil {
		parts = append(parts, request.Mask.AssetID, request.Mask.ObjectKey, fmt.Sprint(request.Mask.Width), fmt.Sprint(request.Mask.Height), string(request.Mask.Kind))
	}
	digest := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(digest[:])
}

func firstFindingLocation(finding security.SecretFinding) string {
	if strings.TrimSpace(finding.Location) != "" {
		return finding.Location
	}
	return finding.Signal
}
