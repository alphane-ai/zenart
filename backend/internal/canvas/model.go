package canvas

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

type ObjectType string

const (
	ObjectTypeImage          ObjectType = "image"
	ObjectTypeVideo          ObjectType = "video"
	ObjectTypeText           ObjectType = "text"
	ObjectTypeShape          ObjectType = "shape"
	ObjectTypeFrame          ObjectType = "frame"
	ObjectTypeGroup          ObjectType = "group"
	ObjectTypeVector         ObjectType = "vector"
	ObjectTypeGeneratedLayer ObjectType = "generated_layer"
)

type Transform struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Rotation float64 `json:"rotation"`
	ScaleX   float64 `json:"scale_x"`
	ScaleY   float64 `json:"scale_y"`
}

type AssetRef struct {
	AssetID          string `json:"asset_id"`
	ObjectMetadataID string `json:"object_metadata_id,omitempty"`
	ThumbnailID      string `json:"thumbnail_id,omitempty"`
}

type LineageRef struct {
	Source       string `json:"source"`
	TaskID       string `json:"task_id,omitempty"`
	BatchID      string `json:"batch_id,omitempty"`
	TraceID      string `json:"trace_id,omitempty"`
	ProviderID   string `json:"provider_id,omitempty"`
	ModelID      string `json:"model_id,omitempty"`
	RequestHash  string `json:"request_hash,omitempty"`
	AssetID      string `json:"asset_id,omitempty"`
	CanvasNodeID string `json:"canvas_node_id,omitempty"`
}

type CanvasObject struct {
	ID          string         `json:"id"`
	TenantID    string         `json:"tenant_id"`
	WorkspaceID string         `json:"workspace_id"`
	FrameID     string         `json:"frame_id,omitempty"`
	VersionID   string         `json:"version_id,omitempty"`
	ObjectType  ObjectType     `json:"object_type"`
	Title       string         `json:"title,omitempty"`
	Body        map[string]any `json:"body"`
	Transform   Transform      `json:"transform"`
	ZIndex      int            `json:"z_index"`
	Locked      bool           `json:"locked"`
	Hidden      bool           `json:"hidden"`
	AssetRef    AssetRef       `json:"asset_ref,omitempty"`
	LineageRef  LineageRef     `json:"lineage_ref,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type CanvasObjectProjection struct {
	ID          string         `json:"id"`
	WorkspaceID string         `json:"workspace_id"`
	FrameID     string         `json:"frame_id,omitempty"`
	VersionID   string         `json:"version_id,omitempty"`
	ObjectType  ObjectType     `json:"object_type"`
	Title       string         `json:"title,omitempty"`
	Body        map[string]any `json:"body"`
	Transform   Transform      `json:"transform"`
	ZIndex      int            `json:"z_index"`
	Locked      bool           `json:"locked"`
	Hidden      bool           `json:"hidden"`
	AssetRef    AssetRef       `json:"asset_ref,omitempty"`
	LineageRef  LineageRef     `json:"lineage_ref,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

var (
	ErrValidation   = errors.New("canvas validation error")
	ErrTenantDenied = errors.New("canvas tenant denied")
)

func ValidateCanvasObject(object CanvasObject) error {
	object.ID = strings.TrimSpace(object.ID)
	object.TenantID = strings.TrimSpace(object.TenantID)
	object.WorkspaceID = strings.TrimSpace(object.WorkspaceID)
	if object.ID == "" || object.TenantID == "" || object.WorkspaceID == "" {
		return fmt.Errorf("%w: id, tenant_id, and workspace_id are required", ErrValidation)
	}
	if !ValidObjectType(object.ObjectType) {
		return fmt.Errorf("%w: unsupported object_type %q", ErrValidation, object.ObjectType)
	}
	if object.Body == nil {
		return fmt.Errorf("%w: body is required", ErrValidation)
	}
	if object.Transform.ScaleX == 0 {
		object.Transform.ScaleX = 1
	}
	if object.Transform.ScaleY == 0 {
		object.Transform.ScaleY = 1
	}
	if object.Transform.Width < 0 || object.Transform.Height < 0 {
		return fmt.Errorf("%w: transform width and height must be non-negative", ErrValidation)
	}
	if object.AssetRef.AssetID != "" && strings.TrimSpace(object.AssetRef.AssetID) == "" {
		return fmt.Errorf("%w: asset_ref.asset_id is invalid", ErrValidation)
	}
	if object.LineageRef.Source != "" && strings.TrimSpace(object.LineageRef.Source) == "" {
		return fmt.Errorf("%w: lineage_ref.source is invalid", ErrValidation)
	}
	if findings := classifyCanvasObject(object); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like canvas field at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func EnsureTenant(tenantID string, object CanvasObject) error {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(object.TenantID) == "" {
		return fmt.Errorf("%w: tenant_id is required", ErrTenantDenied)
	}
	if strings.TrimSpace(tenantID) != strings.TrimSpace(object.TenantID) {
		return ErrTenantDenied
	}
	return nil
}

func UserProjection(tenantID string, object CanvasObject) (CanvasObjectProjection, error) {
	if err := EnsureTenant(tenantID, object); err != nil {
		return CanvasObjectProjection{}, err
	}
	if err := ValidateCanvasObject(object); err != nil {
		return CanvasObjectProjection{}, err
	}
	return CanvasObjectProjection{
		ID:          object.ID,
		WorkspaceID: object.WorkspaceID,
		FrameID:     object.FrameID,
		VersionID:   object.VersionID,
		ObjectType:  object.ObjectType,
		Title:       security.RedactString(object.Title),
		Body:        security.RedactMap(object.Body),
		Transform:   object.Transform,
		ZIndex:      object.ZIndex,
		Locked:      object.Locked,
		Hidden:      object.Hidden,
		AssetRef:    object.AssetRef,
		LineageRef:  object.LineageRef,
		CreatedAt:   object.CreatedAt,
		UpdatedAt:   object.UpdatedAt,
	}, nil
}

func TenantScopedListNodesSQL() string {
	return `
SELECT id, tenant_id, workspace_id, COALESCE(frame_id, ''), COALESCE(version_id, ''), node_type, title, body, x, y, metadata, created_at, updated_at
FROM canvas_nodes
WHERE tenant_id = $1 AND workspace_id = $2
ORDER BY updated_at DESC, id
LIMIT $3`
}

func ValidObjectType(value ObjectType) bool {
	switch value {
	case ObjectTypeImage, ObjectTypeVideo, ObjectTypeText, ObjectTypeShape, ObjectTypeFrame, ObjectTypeGroup, ObjectTypeVector, ObjectTypeGeneratedLayer:
		return true
	default:
		return false
	}
}

func classifyCanvasObject(object CanvasObject) []security.SecretFinding {
	value := map[string]any{
		"id":           object.ID,
		"tenant_id":    object.TenantID,
		"workspace_id": object.WorkspaceID,
		"frame_id":     object.FrameID,
		"version_id":   object.VersionID,
		"object_type":  string(object.ObjectType),
		"title":        object.Title,
		"body":         object.Body,
		"asset_ref": map[string]any{
			"asset_id":           object.AssetRef.AssetID,
			"object_metadata_id": object.AssetRef.ObjectMetadataID,
			"thumbnail_id":       object.AssetRef.ThumbnailID,
		},
		"lineage_ref": map[string]any{
			"source":         object.LineageRef.Source,
			"task_id":        object.LineageRef.TaskID,
			"batch_id":       object.LineageRef.BatchID,
			"trace_id":       object.LineageRef.TraceID,
			"provider_id":    object.LineageRef.ProviderID,
			"model_id":       object.LineageRef.ModelID,
			"request_hash":   object.LineageRef.RequestHash,
			"asset_id":       object.LineageRef.AssetID,
			"canvas_node_id": object.LineageRef.CanvasNodeID,
		},
		"metadata": object.Metadata,
	}
	return security.ClassifyValue(value)
}

func firstFindingLocation(finding security.SecretFinding) string {
	if strings.TrimSpace(finding.Location) != "" {
		return finding.Location
	}
	return finding.Signal
}
