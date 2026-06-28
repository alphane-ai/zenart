package assets

import (
	"fmt"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

type LibraryAction string

const (
	LibraryActionInsertCanvas LibraryAction = "insert_canvas"
	LibraryActionAttachPrompt LibraryAction = "attach_prompt"
	LibraryActionFavorite     LibraryAction = "favorite"
	LibraryActionArchive      LibraryAction = "archive"
	LibraryActionReuseProject LibraryAction = "reuse_project"
)

type LibraryVisibility string

const (
	LibraryVisibilityProject LibraryVisibility = "project"
	LibraryVisibilityTenant  LibraryVisibility = "tenant"
	LibraryVisibilityPrivate LibraryVisibility = "private"
)

type LibraryEntry struct {
	ID              string            `json:"id"`
	TenantID        string            `json:"tenant_id"`
	Asset           VisualAsset       `json:"asset"`
	Visibility      LibraryVisibility `json:"visibility"`
	Favorite        bool              `json:"favorite"`
	Archived        bool              `json:"archived"`
	Reusable        bool              `json:"reusable"`
	AllowedProjects []string          `json:"allowed_projects,omitempty"`
	Tags            []string          `json:"tags,omitempty"`
	CreatedBy       string            `json:"created_by"`
	CreatedAt       time.Time         `json:"created_at"`
	UpdatedAt       time.Time         `json:"updated_at"`
}

type LibraryEntryProjection struct {
	ID              string                `json:"id"`
	Asset           VisualAssetProjection `json:"asset"`
	Visibility      LibraryVisibility     `json:"visibility"`
	Favorite        bool                  `json:"favorite"`
	Archived        bool                  `json:"archived"`
	Reusable        bool                  `json:"reusable"`
	AllowedProjects []string              `json:"allowed_projects,omitempty"`
	Tags            []string              `json:"tags,omitempty"`
	CreatedAt       time.Time             `json:"created_at"`
	UpdatedAt       time.Time             `json:"updated_at"`
}

type LibraryActionRequest struct {
	TenantID  string         `json:"tenant_id"`
	ProjectID string         `json:"project_id,omitempty"`
	Action    LibraryAction  `json:"action"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type PromptAttachment struct {
	AssetID      string `json:"asset_id"`
	StorageKey   string `json:"storage_key"`
	ThumbnailKey string `json:"thumbnail_key,omitempty"`
	TraceID      string `json:"trace_id,omitempty"`
}

type CanvasInsertion struct {
	AssetID    string            `json:"asset_id"`
	CanvasBody map[string]any    `json:"canvas_body"`
	LineageRef map[string]string `json:"lineage_ref"`
}

func ValidateLibraryEntry(entry LibraryEntry) error {
	entry.ID = strings.TrimSpace(entry.ID)
	entry.TenantID = strings.TrimSpace(entry.TenantID)
	if entry.ID == "" || entry.TenantID == "" {
		return fmt.Errorf("%w: library entry id and tenant_id are required", ErrValidation)
	}
	if entry.Asset.ID == "" {
		return fmt.Errorf("%w: library entry asset is required", ErrValidation)
	}
	if err := EnsureTenant(entry.TenantID, entry.Asset); err != nil {
		return err
	}
	if err := ValidateVisualAsset(entry.Asset); err != nil {
		return err
	}
	if !ValidLibraryVisibility(entry.Visibility) {
		return fmt.Errorf("%w: unsupported library visibility %q", ErrValidation, entry.Visibility)
	}
	if entry.Archived && entry.Favorite {
		return fmt.Errorf("%w: archived library entry cannot remain favorite", ErrValidation)
	}
	if entry.Visibility == LibraryVisibilityPrivate && entry.Reusable {
		return fmt.Errorf("%w: private library entry cannot be cross-project reusable", ErrValidation)
	}
	if entry.Visibility == LibraryVisibilityProject && len(entry.AllowedProjects) == 0 && strings.TrimSpace(entry.Asset.ProjectID) == "" {
		return fmt.Errorf("%w: project library entry requires project scope", ErrValidation)
	}
	if findings := security.ClassifyValue(map[string]any{
		"id":               entry.ID,
		"tenant_id":        entry.TenantID,
		"created_by":       entry.CreatedBy,
		"allowed_projects": entry.AllowedProjects,
		"tags":             entry.Tags,
	}); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like library field at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func LibraryUserProjection(tenantID string, entry LibraryEntry) (LibraryEntryProjection, error) {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(entry.TenantID) != strings.TrimSpace(tenantID) {
		return LibraryEntryProjection{}, ErrTenantDenied
	}
	if err := ValidateLibraryEntry(entry); err != nil {
		return LibraryEntryProjection{}, err
	}
	asset, err := UserProjection(tenantID, entry.Asset)
	if err != nil {
		return LibraryEntryProjection{}, err
	}
	return LibraryEntryProjection{
		ID:              entry.ID,
		Asset:           asset,
		Visibility:      entry.Visibility,
		Favorite:        entry.Favorite,
		Archived:        entry.Archived,
		Reusable:        entry.Reusable,
		AllowedProjects: append([]string(nil), entry.AllowedProjects...),
		Tags:            append([]string(nil), entry.Tags...),
		CreatedAt:       entry.CreatedAt,
		UpdatedAt:       entry.UpdatedAt,
	}, nil
}

func BuildPromptAttachment(tenantID string, entry LibraryEntry) (PromptAttachment, error) {
	projection, err := LibraryUserProjection(tenantID, entry)
	if err != nil {
		return PromptAttachment{}, err
	}
	if projection.Archived {
		return PromptAttachment{}, fmt.Errorf("%w: archived library entry cannot be attached to prompt", ErrValidation)
	}
	attachment := PromptAttachment{
		AssetID:    projection.Asset.ID,
		StorageKey: projection.Asset.StorageRef.ObjectKey,
		TraceID:    projection.Asset.Lineage.Source.TraceID,
	}
	if projection.Asset.ThumbnailRef != nil {
		attachment.ThumbnailKey = projection.Asset.ThumbnailRef.ObjectKey
	}
	return attachment, nil
}

func BuildCanvasInsertion(tenantID string, entry LibraryEntry) (CanvasInsertion, error) {
	projection, err := LibraryUserProjection(tenantID, entry)
	if err != nil {
		return CanvasInsertion{}, err
	}
	if projection.Archived {
		return CanvasInsertion{}, fmt.Errorf("%w: archived library entry cannot be inserted into canvas", ErrValidation)
	}
	return CanvasInsertion{
		AssetID: projection.Asset.ID,
		CanvasBody: map[string]any{
			"asset_id":        projection.Asset.ID,
			"storage_key":     projection.Asset.StorageRef.ObjectKey,
			"thumbnail_key":   thumbnailKey(projection.Asset.ThumbnailRef),
			"asset_type":      string(projection.Asset.AssetType),
			"source_trace_id": projection.Asset.Lineage.Source.TraceID,
		},
		LineageRef: map[string]string{
			"source":   "asset_library",
			"asset_id": projection.Asset.ID,
			"trace_id": projection.Asset.Lineage.Source.TraceID,
			"model_id": projection.Asset.Lineage.Source.ModelID,
			"provider": projection.Asset.Lineage.Source.Provider,
		},
	}, nil
}

func ValidateLibraryAction(entry LibraryEntry, request LibraryActionRequest) error {
	if err := ValidateLibraryEntry(entry); err != nil {
		return err
	}
	if strings.TrimSpace(request.TenantID) == "" || strings.TrimSpace(request.TenantID) != strings.TrimSpace(entry.TenantID) {
		return ErrTenantDenied
	}
	if !ValidLibraryAction(request.Action) {
		return fmt.Errorf("%w: unsupported library action %q", ErrValidation, request.Action)
	}
	if request.Action == LibraryActionReuseProject && !entry.Reusable {
		return fmt.Errorf("%w: library entry is not reusable", ErrValidation)
	}
	if strings.TrimSpace(request.ProjectID) != "" && !LibraryAllowsProject(entry, request.ProjectID) {
		return ErrTenantDenied
	}
	if findings := security.ClassifyValue(request.Metadata); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like library action metadata at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func LibraryAllowsProject(entry LibraryEntry, projectID string) bool {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return false
	}
	if entry.Visibility == LibraryVisibilityTenant {
		return true
	}
	if strings.TrimSpace(entry.Asset.ProjectID) == projectID {
		return true
	}
	for _, allowed := range entry.AllowedProjects {
		if strings.TrimSpace(allowed) == projectID {
			return true
		}
	}
	return false
}

func ValidLibraryVisibility(value LibraryVisibility) bool {
	switch value {
	case LibraryVisibilityProject, LibraryVisibilityTenant, LibraryVisibilityPrivate:
		return true
	default:
		return false
	}
}

func ValidLibraryAction(value LibraryAction) bool {
	switch value {
	case LibraryActionInsertCanvas, LibraryActionAttachPrompt, LibraryActionFavorite, LibraryActionArchive, LibraryActionReuseProject:
		return true
	default:
		return false
	}
}

func TenantScopedListLibrarySQL() string {
	return `
SELECT l.id, l.tenant_id, l.asset_id, l.visibility, l.favorite, l.archived, l.reusable, l.allowed_project_ids, l.tags, l.created_by, l.created_at, l.updated_at
FROM asset_library_entries l
JOIN assets a ON a.tenant_id = l.tenant_id AND a.id = l.asset_id
WHERE l.tenant_id = $1 AND ($2 = '' OR a.project_id = $2 OR $2 = ANY(l.allowed_project_ids) OR l.visibility = 'tenant')
ORDER BY l.updated_at DESC, l.id
LIMIT $3`
}

func thumbnailKey(ref *StorageRef) string {
	if ref == nil {
		return ""
	}
	return ref.ObjectKey
}
