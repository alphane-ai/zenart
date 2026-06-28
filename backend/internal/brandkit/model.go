package brandkit

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/assets"
	"github.com/alphane-ai/zenart/backend/internal/security"
)

type BrandKitStatus string

const (
	BrandKitStatusDraft    BrandKitStatus = "draft"
	BrandKitStatusActive   BrandKitStatus = "active"
	BrandKitStatusArchived BrandKitStatus = "archived"
)

type LogoAssetRef struct {
	AssetID          string `json:"asset_id"`
	ObjectMetadataID string `json:"object_metadata_id,omitempty"`
	Usage            string `json:"usage,omitempty"`
}

type ColorSwatch struct {
	Name string `json:"name"`
	Hex  string `json:"hex"`
	Role string `json:"role,omitempty"`
}

type FontRef struct {
	Family  string `json:"family"`
	AssetID string `json:"asset_id,omitempty"`
	Role    string `json:"role,omitempty"`
}

type Guideline struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Body     string `json:"body"`
	Severity string `json:"severity,omitempty"`
}

type SourceRef struct {
	Kind             string `json:"kind"`
	AssetID          string `json:"asset_id,omitempty"`
	ObjectMetadataID string `json:"object_metadata_id,omitempty"`
	UploadID         string `json:"upload_id,omitempty"`
	TraceID          string `json:"trace_id,omitempty"`
}

type ProjectBinding struct {
	ProjectID string `json:"project_id"`
	Default   bool   `json:"default"`
}

type BrandKit struct {
	ID              string           `json:"id"`
	TenantID        string           `json:"tenant_id"`
	Name            string           `json:"name"`
	Status          BrandKitStatus   `json:"status"`
	Logos           []LogoAssetRef   `json:"logos"`
	Palette         []ColorSwatch    `json:"palette"`
	Fonts           []FontRef        `json:"fonts"`
	Guidelines      []Guideline      `json:"guidelines"`
	SourceRefs      []SourceRef      `json:"source_refs,omitempty"`
	ProjectBindings []ProjectBinding `json:"project_bindings,omitempty"`
	CreatedBy       string           `json:"created_by"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
}

type BrandKitProjection struct {
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Status          BrandKitStatus   `json:"status"`
	Logos           []LogoAssetRef   `json:"logos"`
	Palette         []ColorSwatch    `json:"palette"`
	Fonts           []FontRef        `json:"fonts"`
	Guidelines      []Guideline      `json:"guidelines"`
	SourceRefs      []SourceRef      `json:"source_refs,omitempty"`
	ProjectBindings []ProjectBinding `json:"project_bindings,omitempty"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
}

type PromptContextRef struct {
	BrandKitID   string        `json:"brand_kit_id"`
	LogoIDs      []string      `json:"logo_ids"`
	Palette      []ColorSwatch `json:"palette"`
	FontFamilies []string      `json:"font_families"`
	Guidelines   []string      `json:"guidelines"`
}

var (
	ErrValidation   = errors.New("brand kit validation error")
	ErrTenantDenied = errors.New("brand kit tenant denied")

	hexColorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
)

func ValidateBrandKit(kit BrandKit) error {
	kit.ID = strings.TrimSpace(kit.ID)
	kit.TenantID = strings.TrimSpace(kit.TenantID)
	kit.Name = strings.TrimSpace(kit.Name)
	if kit.ID == "" || kit.TenantID == "" || kit.Name == "" {
		return fmt.Errorf("%w: id, tenant_id, and name are required", ErrValidation)
	}
	if !ValidStatus(kit.Status) {
		return fmt.Errorf("%w: unsupported status %q", ErrValidation, kit.Status)
	}
	if len(kit.Logos) == 0 {
		return fmt.Errorf("%w: at least one logo asset is required", ErrValidation)
	}
	if len(kit.Palette) == 0 {
		return fmt.Errorf("%w: at least one color swatch is required", ErrValidation)
	}
	for _, logo := range kit.Logos {
		if strings.TrimSpace(logo.AssetID) == "" {
			return fmt.Errorf("%w: logo asset_id is required", ErrValidation)
		}
	}
	for _, swatch := range kit.Palette {
		if !hexColorPattern.MatchString(strings.TrimSpace(swatch.Hex)) {
			return fmt.Errorf("%w: palette color must be #RRGGBB", ErrValidation)
		}
	}
	for _, font := range kit.Fonts {
		if strings.TrimSpace(font.Family) == "" {
			return fmt.Errorf("%w: font family is required", ErrValidation)
		}
	}
	for _, binding := range kit.ProjectBindings {
		if strings.TrimSpace(binding.ProjectID) == "" {
			return fmt.Errorf("%w: project binding project_id is required", ErrValidation)
		}
	}
	if findings := security.ClassifyValue(map[string]any{
		"id":          kit.ID,
		"tenant_id":   kit.TenantID,
		"name":        kit.Name,
		"created_by":  kit.CreatedBy,
		"logos":       kit.Logos,
		"palette":     kit.Palette,
		"fonts":       kit.Fonts,
		"guidelines":  kit.Guidelines,
		"source_refs": kit.SourceRefs,
	}); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like brand kit field at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func EnsureTenant(tenantID string, kit BrandKit) error {
	if strings.TrimSpace(tenantID) == "" || strings.TrimSpace(kit.TenantID) == "" {
		return fmt.Errorf("%w: tenant_id is required", ErrTenantDenied)
	}
	if strings.TrimSpace(tenantID) != strings.TrimSpace(kit.TenantID) {
		return ErrTenantDenied
	}
	return nil
}

func UserProjection(tenantID string, kit BrandKit) (BrandKitProjection, error) {
	if err := EnsureTenant(tenantID, kit); err != nil {
		return BrandKitProjection{}, err
	}
	if err := ValidateBrandKit(kit); err != nil {
		return BrandKitProjection{}, err
	}
	return BrandKitProjection{
		ID:              kit.ID,
		Name:            security.RedactString(kit.Name),
		Status:          kit.Status,
		Logos:           append([]LogoAssetRef(nil), kit.Logos...),
		Palette:         append([]ColorSwatch(nil), kit.Palette...),
		Fonts:           append([]FontRef(nil), kit.Fonts...),
		Guidelines:      redactGuidelines(kit.Guidelines),
		SourceRefs:      append([]SourceRef(nil), kit.SourceRefs...),
		ProjectBindings: append([]ProjectBinding(nil), kit.ProjectBindings...),
		CreatedAt:       kit.CreatedAt,
		UpdatedAt:       kit.UpdatedAt,
	}, nil
}

func PromptContextProjection(tenantID string, kit BrandKit) (PromptContextRef, error) {
	projection, err := UserProjection(tenantID, kit)
	if err != nil {
		return PromptContextRef{}, err
	}
	if projection.Status != BrandKitStatusActive {
		return PromptContextRef{}, fmt.Errorf("%w: brand kit must be active for prompt context", ErrValidation)
	}
	ref := PromptContextRef{
		BrandKitID: projection.ID,
		Palette:    append([]ColorSwatch(nil), projection.Palette...),
	}
	for _, logo := range projection.Logos {
		ref.LogoIDs = append(ref.LogoIDs, logo.AssetID)
	}
	for _, font := range projection.Fonts {
		ref.FontFamilies = append(ref.FontFamilies, font.Family)
	}
	for _, guideline := range projection.Guidelines {
		ref.Guidelines = append(ref.Guidelines, guideline.Body)
	}
	return ref, nil
}

func ValidateLogoAssets(tenantID string, kit BrandKit, assetByID map[string]assets.VisualAsset) error {
	if err := EnsureTenant(tenantID, kit); err != nil {
		return err
	}
	for _, logo := range kit.Logos {
		asset, ok := assetByID[logo.AssetID]
		if !ok {
			return fmt.Errorf("%w: logo asset %q not found", ErrValidation, logo.AssetID)
		}
		if err := assets.EnsureTenant(tenantID, asset); err != nil {
			return err
		}
		if err := assets.ValidateVisualAsset(asset); err != nil {
			return err
		}
	}
	return nil
}

func ProjectDefault(tenantID string, projectID string, kits []BrandKit) (BrandKitProjection, error) {
	for _, kit := range kits {
		if err := EnsureTenant(tenantID, kit); err != nil {
			return BrandKitProjection{}, err
		}
		for _, binding := range kit.ProjectBindings {
			if strings.TrimSpace(binding.ProjectID) == strings.TrimSpace(projectID) && binding.Default {
				return UserProjection(tenantID, kit)
			}
		}
	}
	return BrandKitProjection{}, fmt.Errorf("%w: project default brand kit not found", ErrValidation)
}

func TenantScopedListBrandKitsSQL() string {
	return `
SELECT id, tenant_id, name, status, logo_asset_refs, palette, fonts, guidelines, source_refs, project_bindings, created_by, created_at, updated_at
FROM brand_kits
WHERE tenant_id = $1 AND ($2 = '' OR project_bindings @> jsonb_build_array(jsonb_build_object('project_id', $2)))
ORDER BY updated_at DESC, id
LIMIT $3`
}

func ValidStatus(value BrandKitStatus) bool {
	switch value {
	case BrandKitStatusDraft, BrandKitStatusActive, BrandKitStatusArchived:
		return true
	default:
		return false
	}
}

func redactGuidelines(guidelines []Guideline) []Guideline {
	out := make([]Guideline, 0, len(guidelines))
	for _, guideline := range guidelines {
		guideline.Title = security.RedactString(guideline.Title)
		guideline.Body = security.RedactString(guideline.Body)
		out = append(out, guideline)
	}
	return out
}

func firstFindingLocation(finding security.SecretFinding) string {
	if strings.TrimSpace(finding.Location) != "" {
		return finding.Location
	}
	return finding.Signal
}
