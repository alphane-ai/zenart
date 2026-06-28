package exportkit

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

type FileRole string

const (
	FileRoleRenderedAsset    FileRole = "rendered_asset"
	FileRoleManifest         FileRole = "manifest"
	FileRoleQAReport         FileRole = "qa_report"
	FileRoleMetadata         FileRole = "metadata"
	FileRoleTraceProvenance  FileRole = "trace_provenance"
	FileRoleSafetyDisclaimer FileRole = "safety_disclaimer"
	FileRolePSDLayerManifest FileRole = "psd_layer_manifest"
)

type FileFormat string

const (
	FileFormatPNG         FileFormat = "png"
	FileFormatSVG         FileFormat = "svg"
	FileFormatPDF         FileFormat = "pdf"
	FileFormatPSDManifest FileFormat = "psd_manifest"
	FileFormatJSON        FileFormat = "json"
	FileFormatMarkdown    FileFormat = "md"
)

type FileEntry struct {
	Path             string     `json:"path"`
	Role             FileRole   `json:"role"`
	Format           FileFormat `json:"format"`
	AssetID          string     `json:"asset_id,omitempty"`
	ObjectKey        string     `json:"object_key,omitempty"`
	ByteSize         int64      `json:"byte_size"`
	Checksum         string     `json:"checksum,omitempty"`
	Placeholder      bool       `json:"placeholder"`
	DerivedFromAsset string     `json:"derived_from_asset,omitempty"`
}

type QAReport struct {
	Status     string   `json:"status"`
	Checked    bool     `json:"checked"`
	Findings   []string `json:"findings,omitempty"`
	ReportRef  string   `json:"report_ref,omitempty"`
	ReportHash string   `json:"report_hash,omitempty"`
}

type SafetyReport struct {
	Status       string `json:"status"`
	Checked      bool   `json:"checked"`
	DecisionID   string `json:"decision_id,omitempty"`
	Disclaimer   string `json:"disclaimer,omitempty"`
	DisclaimerID string `json:"disclaimer_id,omitempty"`
}

type Provenance struct {
	TraceID      string    `json:"trace_id"`
	PackageID    string    `json:"package_id"`
	ExportID     string    `json:"export_id"`
	AssetIDs     []string  `json:"asset_ids"`
	PromptHash   string    `json:"prompt_hash,omitempty"`
	ProviderIDs  []string  `json:"provider_ids,omitempty"`
	ManifestHash string    `json:"manifest_hash,omitempty"`
	GeneratedBy  string    `json:"generated_by,omitempty"`
	GeneratedAt  time.Time `json:"generated_at"`
}

type Manifest struct {
	ID              string         `json:"id"`
	TenantID        string         `json:"tenant_id"`
	ProjectID       string         `json:"project_id"`
	PackageID       string         `json:"package_id"`
	ExportID        string         `json:"export_id"`
	Format          string         `json:"format"`
	Files           []FileEntry    `json:"files"`
	QAReport        QAReport       `json:"qa_report"`
	SafetyReport    SafetyReport   `json:"safety_report"`
	Provenance      Provenance     `json:"provenance"`
	LicenseRef      string         `json:"license_ref"`
	DisclaimerRef   string         `json:"disclaimer_ref"`
	TraceProjection map[string]any `json:"trace_projection,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
}

type GateDecision struct {
	Allowed          bool     `json:"allowed"`
	DownloadEnabled  bool     `json:"download_enabled"`
	BlockedReasons   []string `json:"blocked_reasons,omitempty"`
	RequiredFiles    []string `json:"required_files"`
	RetainedOnBlock  []string `json:"retained_on_block"`
	PlaceholderFiles []string `json:"placeholder_files,omitempty"`
}

type RenderPlan struct {
	Manifest       Manifest     `json:"manifest"`
	Files          []FileEntry  `json:"files"`
	Gate           GateDecision `json:"gate"`
	ZipEntries     []string     `json:"zip_entries"`
	RawPayloadSafe bool         `json:"raw_payload_safe"`
}

var (
	ErrExportValidation = errors.New("export manifest validation error")
)

func ValidateManifest(manifest Manifest) error {
	if strings.TrimSpace(manifest.ID) == "" || strings.TrimSpace(manifest.TenantID) == "" || strings.TrimSpace(manifest.ProjectID) == "" || strings.TrimSpace(manifest.PackageID) == "" || strings.TrimSpace(manifest.ExportID) == "" {
		return fmt.Errorf("%w: id, tenant_id, project_id, package_id, and export_id are required", ErrExportValidation)
	}
	if strings.TrimSpace(manifest.Format) == "" {
		return fmt.Errorf("%w: format is required", ErrExportValidation)
	}
	if len(manifest.Files) == 0 {
		return fmt.Errorf("%w: manifest files are required", ErrExportValidation)
	}
	seenPaths := map[string]bool{}
	renderedCount := 0
	for _, file := range manifest.Files {
		if err := ValidateFileEntry(file); err != nil {
			return err
		}
		if seenPaths[file.Path] {
			return fmt.Errorf("%w: duplicate file path %q", ErrExportValidation, file.Path)
		}
		seenPaths[file.Path] = true
		if file.Role == FileRoleRenderedAsset || file.Role == FileRolePSDLayerManifest {
			renderedCount++
			if file.Placeholder {
				return fmt.Errorf("%w: placeholder file %q cannot be promoted as rendered output", ErrExportValidation, file.Path)
			}
		}
	}
	if renderedCount == 0 {
		return fmt.Errorf("%w: at least one rendered asset or PSD layer manifest is required", ErrExportValidation)
	}
	if !manifest.QAReport.Checked || strings.TrimSpace(manifest.QAReport.Status) == "" {
		return fmt.Errorf("%w: QA report is required", ErrExportValidation)
	}
	if !manifest.SafetyReport.Checked || strings.TrimSpace(manifest.SafetyReport.Status) == "" {
		return fmt.Errorf("%w: safety report is required", ErrExportValidation)
	}
	if strings.TrimSpace(manifest.Provenance.TraceID) == "" || strings.TrimSpace(manifest.Provenance.ExportID) == "" || len(manifest.Provenance.AssetIDs) == 0 {
		return fmt.Errorf("%w: trace provenance is required", ErrExportValidation)
	}
	if strings.TrimSpace(manifest.LicenseRef) == "" || strings.TrimSpace(manifest.DisclaimerRef) == "" {
		return fmt.Errorf("%w: license and disclaimer refs are required", ErrExportValidation)
	}
	if findings := security.ClassifyValue(manifest); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like export manifest field at %s", ErrExportValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func ValidateFileEntry(file FileEntry) error {
	file.Path = strings.TrimSpace(file.Path)
	if file.Path == "" || strings.HasPrefix(file.Path, "/") || strings.Contains(file.Path, "..") || path.Clean(file.Path) != file.Path {
		return fmt.Errorf("%w: safe relative file path is required", ErrExportValidation)
	}
	if !ValidFileRole(file.Role) {
		return fmt.Errorf("%w: unsupported file role %q", ErrExportValidation, file.Role)
	}
	if !ValidFileFormat(file.Format) {
		return fmt.Errorf("%w: unsupported file format %q", ErrExportValidation, file.Format)
	}
	if file.ByteSize < 0 {
		return fmt.Errorf("%w: byte_size must be non-negative", ErrExportValidation)
	}
	if strings.ContainsAny(file.ObjectKey, "?#") || strings.Contains(file.ObjectKey, "://") {
		return fmt.Errorf("%w: object_key must be a storage key without query or fragment", ErrExportValidation)
	}
	if findings := security.ClassifyValue(map[string]any{
		"path":       file.Path,
		"asset_id":   file.AssetID,
		"object_key": file.ObjectKey,
		"checksum":   file.Checksum,
	}); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like export file field at %s", ErrExportValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func EvaluateGate(manifest Manifest) GateDecision {
	decision := GateDecision{
		Allowed:         true,
		DownloadEnabled: true,
		RequiredFiles: []string{
			"manifest.json",
			"qa_report.json",
			"metadata.json",
			"trace_provenance.json",
			"safety_disclaimer.md",
		},
		RetainedOnBlock: []string{
			"qa_report.json",
			"trace_provenance.json",
			"safety_disclaimer.md",
		},
	}
	if err := ValidateManifest(manifest); err != nil {
		decision.Allowed = false
		decision.DownloadEnabled = false
		decision.BlockedReasons = append(decision.BlockedReasons, err.Error())
	}
	if !strings.EqualFold(strings.TrimSpace(manifest.QAReport.Status), "pass") {
		decision.Allowed = false
		decision.DownloadEnabled = false
		decision.BlockedReasons = append(decision.BlockedReasons, "qa_report_not_pass")
	}
	if !strings.EqualFold(strings.TrimSpace(manifest.SafetyReport.Status), "allowed") {
		decision.Allowed = false
		decision.DownloadEnabled = false
		decision.BlockedReasons = append(decision.BlockedReasons, "safety_not_allowed")
	}
	for _, file := range manifest.Files {
		if file.Placeholder {
			decision.PlaceholderFiles = append(decision.PlaceholderFiles, file.Path)
			if file.Role == FileRoleRenderedAsset || file.Role == FileRolePSDLayerManifest {
				decision.Allowed = false
				decision.DownloadEnabled = false
				decision.BlockedReasons = append(decision.BlockedReasons, "placeholder_rendered_output")
			}
		}
	}
	decision.BlockedReasons = uniqueSorted(decision.BlockedReasons)
	decision.PlaceholderFiles = uniqueSorted(decision.PlaceholderFiles)
	return decision
}

func BuildRenderPlan(manifest Manifest) (RenderPlan, error) {
	if err := ValidateManifest(manifest); err != nil {
		return RenderPlan{}, err
	}
	gate := EvaluateGate(manifest)
	if !gate.Allowed {
		return RenderPlan{Manifest: manifest, Files: append([]FileEntry(nil), manifest.Files...), Gate: gate, RawPayloadSafe: true}, fmt.Errorf("%w: export gate blocked: %s", ErrExportValidation, strings.Join(gate.BlockedReasons, ","))
	}
	files := append([]FileEntry(nil), manifest.Files...)
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	zipEntries := make([]string, 0, len(files)+len(gate.RequiredFiles))
	for _, file := range files {
		zipEntries = append(zipEntries, file.Path)
	}
	zipEntries = append(zipEntries, gate.RequiredFiles...)
	zipEntries = uniqueSorted(zipEntries)
	return RenderPlan{
		Manifest:       withManifestHash(manifest),
		Files:          files,
		Gate:           gate,
		ZipEntries:     zipEntries,
		RawPayloadSafe: true,
	}, nil
}

func ValidFileRole(role FileRole) bool {
	switch role {
	case FileRoleRenderedAsset, FileRoleManifest, FileRoleQAReport, FileRoleMetadata, FileRoleTraceProvenance, FileRoleSafetyDisclaimer, FileRolePSDLayerManifest:
		return true
	default:
		return false
	}
}

func ValidFileFormat(format FileFormat) bool {
	switch format {
	case FileFormatPNG, FileFormatSVG, FileFormatPDF, FileFormatPSDManifest, FileFormatJSON, FileFormatMarkdown:
		return true
	default:
		return false
	}
}

func withManifestHash(manifest Manifest) Manifest {
	if strings.TrimSpace(manifest.Provenance.ManifestHash) != "" {
		return manifest
	}
	manifest.Provenance.ManifestHash = StableHash(map[string]any{
		"id":         manifest.ID,
		"export_id":  manifest.ExportID,
		"package_id": manifest.PackageID,
		"files":      manifest.Files,
	})
	return manifest
}

func StableHash(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		encoded = []byte(fmt.Sprintf("%#v", value))
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:])
}

func uniqueSorted(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func firstFindingLocation(finding security.SecretFinding) string {
	if strings.TrimSpace(finding.Location) != "" {
		return finding.Location
	}
	return string(finding.Kind)
}
