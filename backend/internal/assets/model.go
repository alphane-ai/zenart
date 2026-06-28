package assets

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

type AssetType string

const (
	AssetTypeImage          AssetType = "image"
	AssetTypeVideo          AssetType = "video"
	AssetTypeAudio          AssetType = "audio"
	AssetTypeFont           AssetType = "font"
	AssetTypeSVG            AssetType = "svg"
	AssetTypePDF            AssetType = "pdf"
	AssetTypePPTX           AssetType = "pptx"
	AssetTypePSDManifest    AssetType = "psd_manifest"
	AssetTypeGeneratedImage AssetType = "generated_image"
	AssetTypeThumbnail      AssetType = "thumbnail"
)

type AssetStatus string

const (
	AssetStatusPending  AssetStatus = "pending"
	AssetStatusActive   AssetStatus = "active"
	AssetStatusBlocked  AssetStatus = "blocked"
	AssetStatusArchived AssetStatus = "archived"
)

type ObjectMetadata struct {
	ID                  string         `json:"id"`
	TenantID            string         `json:"tenant_id"`
	ProjectID           string         `json:"project_id,omitempty"`
	OwnerID             string         `json:"owner_id,omitempty"`
	AssetType           AssetType      `json:"asset_type"`
	Bucket              string         `json:"bucket"`
	ObjectKey           string         `json:"object_key"`
	ContentType         string         `json:"content_type"`
	ByteSize            int64          `json:"byte_size"`
	Checksum            string         `json:"checksum"`
	Provider            string         `json:"provider,omitempty"`
	RetentionState      string         `json:"retention_state,omitempty"`
	RetentionUntil      *time.Time     `json:"retention_until,omitempty"`
	DerivedFromObjectID string         `json:"derived_from_object_id,omitempty"`
	Metadata            map[string]any `json:"metadata,omitempty"`
	CreatedAt           time.Time      `json:"created_at"`
}

type StorageRef struct {
	Bucket      string `json:"bucket"`
	ObjectKey   string `json:"object_key"`
	ContentType string `json:"content_type"`
	ByteSize    int64  `json:"byte_size"`
	Checksum    string `json:"checksum"`
}

type SourceRef struct {
	Kind     string `json:"kind"`
	UploadID string `json:"upload_id,omitempty"`
	TaskID   string `json:"task_id,omitempty"`
	BatchID  string `json:"batch_id,omitempty"`
	TraceID  string `json:"trace_id,omitempty"`
	Provider string `json:"provider,omitempty"`
	ModelID  string `json:"model_id,omitempty"`
}

type Lineage struct {
	Source              SourceRef `json:"source"`
	OriginalAssetID     string    `json:"original_asset_id,omitempty"`
	DerivedFromAssetID  string    `json:"derived_from_asset_id,omitempty"`
	ObjectMetadataID    string    `json:"object_metadata_id"`
	ThumbnailMetadataID string    `json:"thumbnail_metadata_id,omitempty"`
	ToolType            string    `json:"tool_type,omitempty"`
	RequestHash         string    `json:"request_hash,omitempty"`
	RawPayloadPersisted bool      `json:"raw_payload_persisted"`
}

type VisualAsset struct {
	ID               string         `json:"id"`
	TenantID         string         `json:"tenant_id"`
	ProjectID        string         `json:"project_id,omitempty"`
	ObjectMetadataID string         `json:"object_metadata_id"`
	CandidateAssetID string         `json:"candidate_asset_id,omitempty"`
	AssetType        AssetType      `json:"asset_type"`
	Status           AssetStatus    `json:"status"`
	ObjectMetadata   ObjectMetadata `json:"object_metadata"`
	StorageRef       StorageRef     `json:"storage_ref"`
	ThumbnailRef     *StorageRef    `json:"thumbnail_ref,omitempty"`
	Lineage          Lineage        `json:"lineage"`
	Provenance       map[string]any `json:"provenance,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

type VisualAssetProjection struct {
	ID           string      `json:"id"`
	ProjectID    string      `json:"project_id,omitempty"`
	AssetType    AssetType   `json:"asset_type"`
	Status       AssetStatus `json:"status"`
	StorageRef   StorageRef  `json:"storage_ref"`
	ThumbnailRef *StorageRef `json:"thumbnail_ref,omitempty"`
	Lineage      Lineage     `json:"lineage"`
	CreatedAt    time.Time   `json:"created_at"`
	UpdatedAt    time.Time   `json:"updated_at"`
}

var (
	ErrValidation   = errors.New("asset validation error")
	ErrTenantDenied = errors.New("asset tenant denied")
)

func ValidateVisualAsset(asset VisualAsset) error {
	asset.ID = strings.TrimSpace(asset.ID)
	asset.TenantID = strings.TrimSpace(asset.TenantID)
	asset.ObjectMetadataID = strings.TrimSpace(asset.ObjectMetadataID)
	if asset.ID == "" || asset.TenantID == "" || asset.ObjectMetadataID == "" {
		return fmt.Errorf("%w: id, tenant_id, and object_metadata_id are required", ErrValidation)
	}
	if !ValidAssetType(asset.AssetType) {
		return fmt.Errorf("%w: unsupported asset_type %q", ErrValidation, asset.AssetType)
	}
	if !ValidAssetStatus(asset.Status) {
		return fmt.Errorf("%w: unsupported status %q", ErrValidation, asset.Status)
	}
	if asset.ObjectMetadata.ID == "" {
		return fmt.Errorf("%w: object_metadata is required", ErrValidation)
	}
	if asset.ObjectMetadata.TenantID != asset.TenantID {
		return fmt.Errorf("%w: object metadata tenant must match asset tenant", ErrValidation)
	}
	if asset.ObjectMetadata.ID != asset.ObjectMetadataID {
		return fmt.Errorf("%w: object metadata id must match asset object_metadata_id", ErrValidation)
	}
	if asset.StorageRef.ObjectKey == "" {
		asset.StorageRef = StorageRefFromObject(asset.ObjectMetadata)
	}
	if err := ValidateStorageRef(asset.StorageRef); err != nil {
		return err
	}
	if asset.ThumbnailRef != nil {
		if err := ValidateStorageRef(*asset.ThumbnailRef); err != nil {
			return err
		}
	}
	if asset.Lineage.ObjectMetadataID == "" {
		return fmt.Errorf("%w: lineage.object_metadata_id is required", ErrValidation)
	}
	if asset.Lineage.RawPayloadPersisted {
		return fmt.Errorf("%w: raw provider payload must not be persisted", ErrValidation)
	}
	if findings := classifyVisualAsset(asset); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like asset field at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func ValidateStorageRef(ref StorageRef) error {
	ref.Bucket = strings.TrimSpace(ref.Bucket)
	ref.ObjectKey = strings.TrimSpace(ref.ObjectKey)
	if ref.Bucket == "" || ref.ObjectKey == "" {
		return fmt.Errorf("%w: storage bucket and object_key are required", ErrValidation)
	}
	if strings.ContainsAny(ref.ObjectKey, "?#") {
		return fmt.Errorf("%w: object_key must not contain query or fragment", ErrValidation)
	}
	if parsed, err := url.Parse(ref.ObjectKey); err == nil && parsed.Scheme != "" {
		return fmt.Errorf("%w: object_key must be a storage key, not a URL", ErrValidation)
	}
	if ref.ByteSize < 0 {
		return fmt.Errorf("%w: byte_size must be non-negative", ErrValidation)
	}
	if findings := security.ClassifyValue(map[string]any{"bucket": ref.Bucket, "object_key": ref.ObjectKey, "checksum": ref.Checksum}); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like storage ref at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func EnsureTenant(tenantID string, asset VisualAsset) error {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(asset.TenantID) == "" {
		return fmt.Errorf("%w: tenant_id is required", ErrTenantDenied)
	}
	if strings.TrimSpace(tenantID) != strings.TrimSpace(asset.TenantID) {
		return ErrTenantDenied
	}
	return nil
}

func UserProjection(tenantID string, asset VisualAsset) (VisualAssetProjection, error) {
	if err := EnsureTenant(tenantID, asset); err != nil {
		return VisualAssetProjection{}, err
	}
	if err := ValidateVisualAsset(asset); err != nil {
		return VisualAssetProjection{}, err
	}
	return VisualAssetProjection{
		ID:           asset.ID,
		ProjectID:    asset.ProjectID,
		AssetType:    asset.AssetType,
		Status:       asset.Status,
		StorageRef:   asset.StorageRef,
		ThumbnailRef: asset.ThumbnailRef,
		Lineage:      asset.Lineage,
		CreatedAt:    asset.CreatedAt,
		UpdatedAt:    asset.UpdatedAt,
	}, nil
}

func StorageRefFromObject(object ObjectMetadata) StorageRef {
	return StorageRef{
		Bucket:      object.Bucket,
		ObjectKey:   object.ObjectKey,
		ContentType: object.ContentType,
		ByteSize:    object.ByteSize,
		Checksum:    object.Checksum,
	}
}

func TenantScopedListAssetsSQL() string {
	return `
SELECT a.id, a.tenant_id, COALESCE(a.project_id, ''), a.object_metadata_id, COALESCE(a.candidate_asset_id, ''), a.asset_type, a.status, a.provenance, a.created_at, a.updated_at,
       o.id, o.tenant_id, COALESCE(o.project_id, ''), COALESCE(o.owner_id, ''), o.asset_type, o.bucket, o.object_key, o.content_type, o.byte_size, o.checksum, o.provider, o.retention_state, o.retention_until, COALESCE(o.derived_from_object_id, ''), o.metadata, o.created_at
FROM assets a
JOIN object_metadata o ON o.tenant_id = a.tenant_id AND o.id = a.object_metadata_id
WHERE a.tenant_id = $1 AND ($2 = '' OR a.project_id = $2)
ORDER BY a.updated_at DESC, a.id
LIMIT $3`
}

func ValidAssetType(value AssetType) bool {
	switch value {
	case AssetTypeImage, AssetTypeVideo, AssetTypeAudio, AssetTypeFont, AssetTypeSVG, AssetTypePDF, AssetTypePPTX, AssetTypePSDManifest, AssetTypeGeneratedImage, AssetTypeThumbnail:
		return true
	default:
		return false
	}
}

func ValidAssetStatus(value AssetStatus) bool {
	switch value {
	case AssetStatusPending, AssetStatusActive, AssetStatusBlocked, AssetStatusArchived:
		return true
	default:
		return false
	}
}

func classifyVisualAsset(asset VisualAsset) []security.SecretFinding {
	value := map[string]any{
		"id":                 asset.ID,
		"tenant_id":          asset.TenantID,
		"project_id":         asset.ProjectID,
		"object_metadata_id": asset.ObjectMetadataID,
		"asset_type":         string(asset.AssetType),
		"status":             string(asset.Status),
		"storage_ref": map[string]any{
			"bucket":       asset.StorageRef.Bucket,
			"object_key":   asset.StorageRef.ObjectKey,
			"content_type": asset.StorageRef.ContentType,
			"byte_size":    asset.StorageRef.ByteSize,
			"checksum":     asset.StorageRef.Checksum,
		},
		"lineage": map[string]any{
			"source_kind":           asset.Lineage.Source.Kind,
			"source_upload_id":      asset.Lineage.Source.UploadID,
			"source_task_id":        asset.Lineage.Source.TaskID,
			"source_batch_id":       asset.Lineage.Source.BatchID,
			"source_trace_id":       asset.Lineage.Source.TraceID,
			"source_provider":       asset.Lineage.Source.Provider,
			"source_model_id":       asset.Lineage.Source.ModelID,
			"original_asset_id":     asset.Lineage.OriginalAssetID,
			"derived_from_asset_id": asset.Lineage.DerivedFromAssetID,
			"object_metadata_id":    asset.Lineage.ObjectMetadataID,
			"thumbnail_metadata_id": asset.Lineage.ThumbnailMetadataID,
			"tool_type":             asset.Lineage.ToolType,
			"request_hash":          asset.Lineage.RequestHash,
		},
		"provenance": asset.Provenance,
		"metadata":   asset.ObjectMetadata.Metadata,
	}
	return security.ClassifyValue(value)
}

func firstFindingLocation(finding security.SecretFinding) string {
	if strings.TrimSpace(finding.Location) != "" {
		return finding.Location
	}
	return finding.Signal
}
