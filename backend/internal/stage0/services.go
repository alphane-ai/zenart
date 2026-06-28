package stage0

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/alphane-ai/zenart/backend/internal/id"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/alphane-ai/zenart/backend/internal/support"
	"github.com/alphane-ai/zenart/backend/internal/task"
)

type serviceKey struct{}

func ContextWithService(ctx context.Context, service Service) context.Context {
	return context.WithValue(ctx, serviceKey{}, service)
}

func ServiceFromContext(ctx context.Context) (Service, bool) {
	service, ok := ctx.Value(serviceKey{}).(Service)
	return service, ok
}

var (
	ErrNotFound          = errors.New("stage0 record not found")
	ErrValidation        = errors.New("stage0 validation failed")
	ErrSafetyBlocked     = errors.New("export blocked by safety or QA")
	ErrSafetyReviewHold  = errors.New("operation held by safety policy")
	ErrMalwareBlocked    = errors.New("upload blocked by malware scan")
	ErrCrawlerBlocked    = errors.New("crawler runtime policy blocked")
	ErrMissingRepository = errors.New("stage0 repository missing")
	ErrTenantDenied      = errors.New("stage0 tenant denied")
)

var cleanupTenantIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
var analyticsReferencePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

var analyticsEventTaxonomy = map[string]struct{}{
	"signup":                    {},
	"onboarding_completed":      {},
	"project_created":           {},
	"first_chat":                {},
	"workflow_started":          {},
	"candidate_set_created":     {},
	"four_candidates_ready":     {},
	"candidate_selected":        {},
	"direction_selected":        {},
	"iteration_requested":       {},
	"package_item_added":        {},
	"export_started":            {},
	"export_completed":          {},
	"export_failed":             {},
	"qa_warning_block":          {},
	"billing_viewed":            {},
	"subscription_started":      {},
	"subscription_cancelled":    {},
	"support_ticket_opened":     {},
	"support_ticket_created":    {},
	"safety_block":              {},
	"safety_decision_recorded":  {},
	"upload_created":            {},
	"object_downloaded":         {},
	"export_regenerated":        {},
	"export_expired":            {},
	"object_orphaned":           {},
	"object_deleted":            {},
	"export_object_cleanup_run": {},
}

var analyticsSubjectTypeTaxonomy = map[string]struct{}{
	"account":         {},
	"agent_task":      {},
	"asset":           {},
	"billing":         {},
	"candidate":       {},
	"candidate_set":   {},
	"export":          {},
	"object_metadata": {},
	"package":         {},
	"package_item":    {},
	"project":         {},
	"quota_bucket":    {},
	"safety_decision": {},
	"subscription":    {},
	"support_ticket":  {},
	"tenant":          {},
	"upload":          {},
	"user":            {},
	"workflow":        {},
}

const (
	SafetyPointBrief            = "brief"
	SafetyPointProviderRequest  = "provider_request"
	SafetyPointProviderResponse = "provider_response"
	SafetyPointQA               = "qa"
	SafetyPointExport           = "export"
)

type Page[T any] struct {
	Items         []T    `json:"items"`
	NextPageToken string `json:"next_page_token,omitempty"`
}

type Skill struct {
	ID            string    `json:"id"`
	TenantID      *string   `json:"tenant_id,omitempty"`
	Name          string    `json:"name"`
	Domain        string    `json:"domain"`
	Owner         string    `json:"owner"`
	RiskLevel     string    `json:"risk_level"`
	Status        string    `json:"status"`
	ActiveVersion string    `json:"active_version,omitempty"`
	CreatedAt     time.Time `json:"created_at,omitempty"`
	UpdatedAt     time.Time `json:"updated_at,omitempty"`
}

type SkillVersion struct {
	ID                      string                  `json:"id"`
	SkillID                 string                  `json:"skill_id"`
	Version                 string                  `json:"version"`
	Status                  string                  `json:"status"`
	EvalSuiteID             *string                 `json:"eval_suite_id"`
	ReleaseGate             SkillVersionReleaseGate `json:"release_gate"`
	ReleaseNotes            string                  `json:"release_notes"`
	RollbackTargetVersionID *string                 `json:"rollback_target_version_id,omitempty"`
	CreatedAt               time.Time               `json:"created_at,omitempty"`
}

type SkillVersionReleaseGate struct {
	RequiresEvalPass          bool    `json:"requires_eval_pass"`
	EligibleForCanary         bool    `json:"eligible_for_canary"`
	EligibleForActive         bool    `json:"eligible_for_active"`
	BlockingReason            string  `json:"blocking_reason"`
	LastEvalResultID          *string `json:"last_eval_result_id"`
	LastEvalStatus            *string `json:"last_eval_status"`
	EvalContractComplete      bool    `json:"eval_contract_complete"`
	CriticalSafetyRegressions int     `json:"critical_safety_regressions"`
}

type EvalSubject struct {
	SubjectType              string `json:"subject_type"`
	SubjectID                string `json:"subject_id"`
	Version                  string `json:"version"`
	CandidateStatusAfterEval string `json:"candidate_status_after_eval"`
}

type EvalResult struct {
	ResultID        string         `json:"result_id"`
	TenantID        string         `json:"tenant_id,omitempty"`
	SuiteID         string         `json:"suite_id"`
	Subject         EvalSubject    `json:"subject"`
	Status          string         `json:"status"`
	CompletedAt     time.Time      `json:"completed_at"`
	CreatedAt       time.Time      `json:"created_at"`
	Summary         map[string]any `json:"summary"`
	FixtureResults  []any          `json:"fixture_results"`
	RunnerContract  map[string]any `json:"runner_contract"`
	StorageContract map[string]any `json:"storage_contract"`
}

type EvalResultFilters struct {
	TenantID       string
	SuiteID        string
	Status         string
	SubjectType    string
	SubjectID      string
	SubjectVersion string
	CompletedAfter time.Time
	LatestOnly     bool
	Limit          int
}

type EvalResultArtifact struct {
	ResultID      string         `json:"result_id"`
	TenantID      string         `json:"tenant_id"`
	SuiteID       string         `json:"suite_id"`
	Subject       EvalSubject    `json:"subject"`
	Status        string         `json:"status"`
	CompletedAt   time.Time      `json:"completed_at"`
	ObjectKey     string         `json:"object_key"`
	ContentType   string         `json:"content_type"`
	SHA256        string         `json:"sha256"`
	ArtifactLinks []string       `json:"artifact_links"`
	DownloadURL   string         `json:"download_url"`
	ExpiresAt     time.Time      `json:"expires_at"`
	AccessPolicy  map[string]any `json:"access_policy"`
	AuditRequired bool           `json:"audit_required"`
}

type Export struct {
	ID            string          `json:"id"`
	TenantID      string          `json:"tenant_id,omitempty"`
	PackageID     string          `json:"package_id"`
	ProjectID     *string         `json:"project_id,omitempty"`
	TaskID        *string         `json:"task_id,omitempty"`
	Format        string          `json:"format"`
	Status        string          `json:"status"`
	QAStatus      string          `json:"qa_status"`
	ObjectID      *string         `json:"object_metadata_id,omitempty"`
	Object        *ObjectMetadata `json:"object_metadata,omitempty"`
	Manifest      map[string]any  `json:"manifest,omitempty"`
	Delivery      map[string]any  `json:"delivery,omitempty"`
	DownloadURL   string          `json:"download_url,omitempty"`
	Error         map[string]any  `json:"error,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
	RegeneratedAt *time.Time      `json:"regenerated_at,omitempty"`
}

type ExportCreate struct {
	Format string `json:"format"`
}

type PackageItemCreate map[string]any

type PackageCreate struct {
	Items    []PackageItemCreate `json:"items"`
	Manifest map[string]any      `json:"manifest,omitempty"`
}

type PackageItem struct {
	ID            string         `json:"id"`
	AssetID       *string        `json:"asset_id,omitempty"`
	CanvasFrameID *string        `json:"canvas_frame_id,omitempty"`
	Type          string         `json:"type"`
	SortOrder     int            `json:"sort_order"`
	Provenance    map[string]any `json:"provenance,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
}

type Package struct {
	ID         string         `json:"id"`
	TenantID   string         `json:"tenant_id,omitempty"`
	ProjectID  string         `json:"project_id"`
	Status     string         `json:"status"`
	Manifest   map[string]any `json:"manifest"`
	QAReport   map[string]any `json:"qa_report"`
	Provenance map[string]any `json:"provenance"`
	Items      []PackageItem  `json:"items,omitempty"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at,omitempty"`
}

type SupportTicket struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id"`
	UserID         string         `json:"user_id"`
	ProjectID      *string        `json:"project_id,omitempty"`
	TaskID         *string        `json:"task_id,omitempty"`
	BatchID        *string        `json:"batch_id,omitempty"`
	TraceID        *string        `json:"trace_id,omitempty"`
	AssetID        *string        `json:"asset_id,omitempty"`
	Category       string         `json:"category"`
	Status         string         `json:"status"`
	Body           string         `json:"body"`
	LinkedExportID *string        `json:"linked_export_id,omitempty"`
	QuotaBucketID  *string        `json:"quota_bucket_id,omitempty"`
	BillingRefID   *string        `json:"billing_reference_id,omitempty"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type SupportTicketCreate struct {
	ProjectID      string         `json:"project_id"`
	TaskID         string         `json:"task_id"`
	BatchID        string         `json:"batch_id"`
	TraceID        string         `json:"trace_id"`
	AssetID        string         `json:"asset_id"`
	Category       string         `json:"category"`
	Body           string         `json:"body"`
	LinkedExportID string         `json:"linked_export_id"`
	QuotaBucketID  string         `json:"quota_bucket_id"`
	BillingRefID   string         `json:"billing_reference_id"`
	Metadata       map[string]any `json:"metadata"`
}

type UploadCreate struct {
	ProjectID   string         `json:"project_id,omitempty"`
	Filename    string         `json:"filename"`
	ContentType string         `json:"content_type"`
	ByteSize    int64          `json:"byte_size"`
	UploadType  string         `json:"upload_type,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type UploadOptions struct {
	TenantID            string
	UserID              string
	Bucket              string
	Input               UploadCreate
	AllowedContentTypes []string
	MaxBytes            int64
	URLTTL              time.Duration
	SignURL             func(tenantID, objectKey string, ttl time.Duration) (string, time.Time)
	MalwareScanner      security.MalwareScanner
	MalwareFailClosed   bool
}

type Upload struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id,omitempty"`
	ProjectID      *string        `json:"project_id,omitempty"`
	UserID         string         `json:"user_id,omitempty"`
	Status         string         `json:"status"`
	UploadType     string         `json:"upload_type"`
	OriginalName   string         `json:"filename"`
	ContentType    string         `json:"content_type"`
	ByteSize       int64          `json:"byte_size"`
	ObjectKey      string         `json:"object_key"`
	UploadURL      string         `json:"upload_url"`
	ExpiresAt      time.Time      `json:"expires_at"`
	ObjectMetadata ObjectMetadata `json:"object_metadata"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type ObjectMetadata struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id,omitempty"`
	ProjectID      *string        `json:"project_id,omitempty"`
	OwnerID        *string        `json:"owner_id,omitempty"`
	AssetType      string         `json:"asset_type"`
	Bucket         string         `json:"bucket"`
	ObjectKey      string         `json:"object_key"`
	ContentType    string         `json:"content_type"`
	ByteSize       int64          `json:"byte_size"`
	Checksum       string         `json:"checksum"`
	Provider       string         `json:"provider"`
	Retention      string         `json:"retention_state"`
	RetentionUntil *time.Time     `json:"retention_until,omitempty"`
	DerivedFrom    *string        `json:"derived_from_object_id,omitempty"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
}

type AssetLibraryEntry struct {
	ID              string         `json:"id"`
	Asset           map[string]any `json:"asset"`
	Visibility      string         `json:"visibility"`
	Favorite        bool           `json:"favorite"`
	Archived        bool           `json:"archived"`
	Reusable        bool           `json:"reusable"`
	AllowedProjects []string       `json:"allowed_projects,omitempty"`
	Tags            []string       `json:"tags,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

type AssetLibraryEntryCreate struct {
	AssetID         string   `json:"asset_id"`
	ProjectID       string   `json:"project_id,omitempty"`
	Visibility      string   `json:"visibility"`
	Favorite        bool     `json:"favorite,omitempty"`
	Reusable        bool     `json:"reusable,omitempty"`
	AllowedProjects []string `json:"allowed_projects,omitempty"`
	Tags            []string `json:"tags,omitempty"`
}

type AssetLibraryEntryUpdate struct {
	Visibility      *string  `json:"visibility,omitempty"`
	Favorite        *bool    `json:"favorite,omitempty"`
	Archived        *bool    `json:"archived,omitempty"`
	Reusable        *bool    `json:"reusable,omitempty"`
	AllowedProjects []string `json:"allowed_projects,omitempty"`
	Tags            []string `json:"tags,omitempty"`
}

type BrandKit struct {
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Status          string           `json:"status"`
	Logos           []map[string]any `json:"logos"`
	Palette         []map[string]any `json:"palette"`
	Fonts           []map[string]any `json:"fonts"`
	Guidelines      []map[string]any `json:"guidelines"`
	SourceRefs      []map[string]any `json:"source_refs,omitempty"`
	ProjectBindings []map[string]any `json:"project_bindings,omitempty"`
	CreatedAt       time.Time        `json:"created_at"`
	UpdatedAt       time.Time        `json:"updated_at"`
}

type BrandKitCreate struct {
	Name            string           `json:"name"`
	Status          string           `json:"status,omitempty"`
	Logos           []map[string]any `json:"logos"`
	Palette         []map[string]any `json:"palette"`
	Fonts           []map[string]any `json:"fonts,omitempty"`
	Guidelines      []map[string]any `json:"guidelines,omitempty"`
	SourceRefs      []map[string]any `json:"source_refs,omitempty"`
	ProjectBindings []map[string]any `json:"project_bindings,omitempty"`
}

type BrandKitUpdate struct {
	Name            *string          `json:"name,omitempty"`
	Status          *string          `json:"status,omitempty"`
	Logos           []map[string]any `json:"logos,omitempty"`
	Palette         []map[string]any `json:"palette,omitempty"`
	Fonts           []map[string]any `json:"fonts,omitempty"`
	Guidelines      []map[string]any `json:"guidelines,omitempty"`
	SourceRefs      []map[string]any `json:"source_refs,omitempty"`
	ProjectBindings []map[string]any `json:"project_bindings,omitempty"`
}

type ProjectDefaultBrandKitSet struct {
	BrandKitID string `json:"brand_kit_id"`
}

type ExportArtifact struct {
	ExportID        string
	TenantID        string
	ProjectID       string
	OwnerID         string
	Bucket          string
	ObjectKey       string
	Format          string
	ContentType     string
	ByteSize        int64
	Checksum        string
	StorageProvider string
	RetentionUntil  *time.Time
	Manifest        map[string]any
	QAReport        map[string]any
	Provenance      map[string]any
	Delivery        map[string]any
	DerivedFromID   string
	Thumbnail       *ThumbnailArtifact
}

type ThumbnailArtifact struct {
	ObjectKey   string         `json:"object_key"`
	ContentType string         `json:"content_type"`
	Width       int            `json:"width"`
	Height      int            `json:"height"`
	ByteSize    int64          `json:"byte_size"`
	Checksum    string         `json:"checksum"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	Data        []byte         `json:"-"`
}

type CleanupResult struct {
	ExpiredExports  int    `json:"expired_exports"`
	OrphanedObjects int    `json:"orphaned_objects"`
	DeletedObjects  int    `json:"deleted_objects"`
	FailedObjects   int    `json:"failed_objects"`
	PreviewObjects  int    `json:"preview_objects,omitempty"`
	DryRun          bool   `json:"dry_run,omitempty"`
	Status          string `json:"status"`
}

type CleanupMode string

const (
	CleanupModeCombined       CleanupMode = "combined"
	CleanupModeExpiredExports CleanupMode = "expired_export_cleanup"
	CleanupModeOrphans        CleanupMode = "orphan_cleanup"
)

type AnalyticsEvent struct {
	ID          string         `json:"id"`
	TenantID    string         `json:"tenant_id"`
	UserID      string         `json:"user_id,omitempty"`
	ProjectID   string         `json:"project_id,omitempty"`
	WorkflowID  string         `json:"workflow_id,omitempty"`
	EventName   string         `json:"event_name"`
	SubjectType string         `json:"subject_type"`
	SubjectID   string         `json:"subject_id"`
	Properties  map[string]any `json:"properties,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
}

type AnalyticsEventFilters struct {
	TenantID    string
	EventName   string
	WorkflowID  string
	SubjectType string
	SubjectID   string
	Limit       int
}

type AnalyticsReport struct {
	ID                 string         `json:"id"`
	MetricName         string         `json:"metric_name"`
	SourceEvents       []string       `json:"source_events"`
	RequiredDimensions []string       `json:"required_dimensions"`
	GoNoGoSignal       bool           `json:"go_no_go_signal"`
	Window             string         `json:"window"`
	Value              float64        `json:"value"`
	Dimensions         map[string]any `json:"dimensions,omitempty"`
	ComputedAt         time.Time      `json:"computed_at"`
}

type CrawlerSource struct {
	ID             string         `json:"id"`
	TenantID       *string        `json:"tenant_id,omitempty"`
	Name           string         `json:"name"`
	URL            string         `json:"url"`
	ApprovalStatus string         `json:"approval_status"`
	LegalMetadata  map[string]any `json:"legal_metadata"`
	RobotsPolicy   map[string]any `json:"robots_policy"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type CrawlerFinding struct {
	ID          string         `json:"id"`
	TenantID    *string        `json:"tenant_id,omitempty"`
	DocumentID  string         `json:"document_id"`
	FindingType string         `json:"finding_type"`
	Status      string         `json:"status"`
	Payload     map[string]any `json:"payload"`
	Provenance  map[string]any `json:"provenance"`
	CreatedAt   time.Time      `json:"created_at"`
}

type CrawlerPolicy struct {
	Enabled          bool
	UserAgent        string
	GlobalRPS        float64
	SourceRPS        float64
	RawRetentionDays int
	BlocklistHosts   []string
	ResolveHost      func(context.Context, string) ([]net.IP, error) `json:"-"`
}

type CrawlerRun struct {
	ID        string         `json:"id"`
	TenantID  *string        `json:"tenant_id,omitempty"`
	SourceID  string         `json:"source_id"`
	Status    string         `json:"status"`
	Summary   map[string]any `json:"summary"`
	StartedAt time.Time      `json:"started_at"`
	CreatedAt time.Time      `json:"created_at"`
}

type CrawlerImport struct {
	TenantID       string         `json:"tenant_id,omitempty"`
	RunID          string         `json:"run_id"`
	SourceID       string         `json:"source_id"`
	DocumentURL    string         `json:"url"`
	ContentHash    string         `json:"content_hash"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	FindingType    string         `json:"finding_type"`
	FindingPayload map[string]any `json:"payload,omitempty"`
	Provenance     map[string]any `json:"provenance"`
}

type CrawlerImportResult struct {
	DocumentID     string    `json:"document_id"`
	FindingID      string    `json:"finding_id"`
	RetentionUntil time.Time `json:"retention_until"`
}

type SafetyRule struct {
	ID                string    `json:"id"`
	TenantID          *string   `json:"tenant_id,omitempty"`
	RuleKey           string    `json:"rule_key"`
	Version           string    `json:"version"`
	Domain            string    `json:"domain"`
	Severity          string    `json:"severity"`
	Action            string    `json:"action"`
	EnforcementPoints []string  `json:"enforcement_points"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"created_at"`
}

type SafetyDecision struct {
	ID               string    `json:"id"`
	TenantID         string    `json:"tenant_id"`
	RuleID           *string   `json:"rule_id,omitempty"`
	SubjectType      string    `json:"subject_type"`
	SubjectID        string    `json:"subject_id"`
	EnforcementPoint string    `json:"enforcement_point"`
	Decision         string    `json:"decision"`
	Rationale        string    `json:"rationale"`
	CreatedAt        time.Time `json:"created_at"`
}

type SafetyReviewItem struct {
	ID                 string         `json:"id"`
	TenantID           string         `json:"tenant_id,omitempty"`
	SafetyDecisionID   string         `json:"safety_decision_id"`
	SubjectType        string         `json:"subject_type"`
	SubjectID          string         `json:"subject_id"`
	EnforcementPoint   string         `json:"enforcement_point"`
	SafetyDecision     string         `json:"safety_decision"`
	SafetyRationale    string         `json:"safety_rationale"`
	RuleID             *string        `json:"rule_id,omitempty"`
	RuleKey            string         `json:"rule_key,omitempty"`
	RuleVersion        string         `json:"rule_version,omitempty"`
	Severity           string         `json:"severity"`
	OverrideEligible   bool           `json:"override_eligible"`
	AuditRequired      bool           `json:"audit_required"`
	ReviewStatus       string         `json:"review_status"`
	ReviewDecision     string         `json:"review_decision,omitempty"`
	ReviewerID         string         `json:"reviewer_id,omitempty"`
	ReviewRationale    string         `json:"review_rationale,omitempty"`
	AuditRef           string         `json:"audit_ref,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
	ReviewedAt         *time.Time     `json:"reviewed_at,omitempty"`
	SafeProjection     map[string]any `json:"safe_projection"`
	RequiredEvidence   []string       `json:"required_evidence_refs"`
	UserVisibleOutcome string         `json:"user_visible_outcome"`
}

type ExportOverrideDecisionInput struct {
	TenantID       string         `json:"tenant_id"`
	ExportID       string         `json:"export_id"`
	SourceType     string         `json:"source_type"`
	SourceID       string         `json:"source_id"`
	TraceID        string         `json:"trace_id"`
	RequestedBy    string         `json:"requested_by"`
	RequestedRole  string         `json:"requested_by_role"`
	ResolvedBy     string         `json:"resolved_by"`
	ResolvedRole   string         `json:"resolved_by_role"`
	Outcome        string         `json:"outcome"`
	DenialReason   string         `json:"denial_reason"`
	Rationale      string         `json:"rationale"`
	AuditLogID     string         `json:"audit_log_id"`
	IdempotencyKey string         `json:"idempotency_key"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

type ExportOverrideDecision struct {
	ID                 string         `json:"id"`
	TenantID           string         `json:"tenant_id"`
	ExportID           string         `json:"export_id"`
	SourceType         string         `json:"source_type"`
	SourceID           string         `json:"source_id"`
	TraceID            string         `json:"trace_id"`
	RequestedByRole    string         `json:"requested_by_role"`
	ResolvedByRole     string         `json:"resolved_by_role"`
	Outcome            string         `json:"outcome"`
	DenialReason       *string        `json:"denial_reason"`
	SourceGateResolved bool           `json:"source_gate_resolved"`
	FinalExportAllowed bool           `json:"final_export_allowed"`
	AuditLogID         string         `json:"audit_log_id"`
	IdempotencyKey     string         `json:"idempotency_key,omitempty"`
	Metadata           map[string]any `json:"metadata,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
}

type SafetyReviewDecisionInput struct {
	TenantID         string
	SafetyDecisionID string
	ReviewerID       string
	Decision         string
	Rationale        string
	AuditRef         string
	IdempotencyKey   string
	Metadata         map[string]any
	CreatedAt        time.Time
}

type SafetyReviewDecision struct {
	ID                 string         `json:"id"`
	TenantID           string         `json:"tenant_id,omitempty"`
	SafetyDecisionID   string         `json:"safety_decision_id"`
	ReviewerID         string         `json:"reviewer_id"`
	Decision           string         `json:"decision"`
	Rationale          string         `json:"rationale"`
	AuditRef           string         `json:"audit_ref"`
	IdempotencyKey     string         `json:"idempotency_key"`
	Metadata           map[string]any `json:"metadata,omitempty"`
	CreatedAt          time.Time      `json:"created_at"`
	UserVisibleOutcome string         `json:"user_visible_outcome"`
}

type RuntimeSafetyPolicyInput struct {
	TenantID        string
	ProjectID       string
	TaskID          string
	QASubjectType   string
	QASubjectID     string
	ExportID        string
	IncludeProvider bool
}

type RuntimeSafetyPolicyResult struct {
	Decisions []SafetyDecision `json:"decisions"`
}

type Repository struct {
	db store.DBTX
}

func NewRepository(db store.DBTX) Repository {
	return Repository{db: db}
}

func (r Repository) ListSkills(ctx context.Context, tenantID, status string, limit int) (Page[Skill], error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return Page[Skill]{}, errors.Join(ErrValidation, errors.New("tenant_id is required"))
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{tenantID, limit}
	query := `
SELECT
	s.id,
	s.tenant_id,
	s.name,
	s.domain,
	s.owner,
	s.risk_level,
	s.status,
	COALESCE(active.version, ''),
	s.created_at,
	s.updated_at
FROM skills s
LEFT JOIN skill_release_channels channel
	ON channel.skill_id = s.id
	AND channel.channel = 'production'
LEFT JOIN skill_versions active
	ON active.id = channel.active_version_id
WHERE (s.tenant_id IS NULL OR s.tenant_id = $1)`
	if strings.TrimSpace(status) != "" {
		args = append(args, strings.TrimSpace(status))
		query += fmt.Sprintf(" AND s.status = $%d", len(args))
	}
	query += " ORDER BY s.updated_at DESC, s.created_at DESC LIMIT $2"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[Skill]{}, err
	}
	defer rows.Close()

	var page Page[Skill]
	for rows.Next() {
		var skill Skill
		if err := rows.Scan(
			&skill.ID,
			&skill.TenantID,
			&skill.Name,
			&skill.Domain,
			&skill.Owner,
			&skill.RiskLevel,
			&skill.Status,
			&skill.ActiveVersion,
			&skill.CreatedAt,
			&skill.UpdatedAt,
		); err != nil {
			return Page[Skill]{}, err
		}
		page.Items = append(page.Items, skill)
	}
	return page, rows.Err()
}

func (r Repository) ListSkillVersions(ctx context.Context, tenantID, skillID string, limit int) (Page[SkillVersion], error) {
	tenantID = strings.TrimSpace(tenantID)
	skillID = strings.TrimSpace(skillID)
	if tenantID == "" || skillID == "" {
		return Page[SkillVersion]{}, errors.Join(ErrValidation, errors.New("tenant_id and skill_id are required"))
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
SELECT
	sv.id,
	sv.skill_id,
	sv.version,
	sv.status,
	sv.eval_suite_id,
	COALESCE(latest_eval.id, ''),
	COALESCE(latest_eval.status, ''),
	COALESCE((latest_eval.summary->>'trace_complete')::boolean, (latest_eval.summary->'summary'->>'trace_complete')::boolean, false),
	COALESCE((latest_eval.summary->>'export_contract_complete')::boolean, (latest_eval.summary->'summary'->>'export_contract_complete')::boolean, false),
	COALESCE((latest_eval.summary->>'qa_fixture_coverage_complete')::boolean, (latest_eval.summary->'summary'->>'qa_fixture_coverage_complete')::boolean, false),
	COALESCE((latest_eval.summary->>'critical_safety_regressions')::int, (latest_eval.summary->'summary'->>'critical_safety_regressions')::int, 0),
	sv.release_notes,
	sv.rollback_target_version_id,
	sv.created_at
FROM skill_versions sv
JOIN skills s ON s.id = sv.skill_id
LEFT JOIN LATERAL (
	SELECT er.id, er.status, er.summary
	FROM eval_results er
	WHERE er.tenant_id = $1
	  AND er.subject_type = 'skill_version'
	  AND er.subject_id = sv.id
	  AND er.subject_version = sv.version
	  AND (sv.eval_suite_id IS NULL OR er.eval_suite_id = sv.eval_suite_id)
	ORDER BY er.completed_at DESC, er.created_at DESC
	LIMIT 1
) latest_eval ON true
WHERE sv.skill_id = $2
  AND (s.tenant_id IS NULL OR s.tenant_id = $1)
ORDER BY sv.created_at DESC
LIMIT $3`,
		tenantID,
		skillID,
		limit,
	)
	if err != nil {
		return Page[SkillVersion]{}, err
	}
	defer rows.Close()

	var page Page[SkillVersion]
	for rows.Next() {
		var version SkillVersion
		var lastEvalResultID, lastEvalStatus string
		var traceComplete, exportContractComplete, qaCoverageComplete bool
		if err := rows.Scan(
			&version.ID,
			&version.SkillID,
			&version.Version,
			&version.Status,
			&version.EvalSuiteID,
			&lastEvalResultID,
			&lastEvalStatus,
			&traceComplete,
			&exportContractComplete,
			&qaCoverageComplete,
			&version.ReleaseGate.CriticalSafetyRegressions,
			&version.ReleaseNotes,
			&version.RollbackTargetVersionID,
			&version.CreatedAt,
		); err != nil {
			return Page[SkillVersion]{}, err
		}
		version.ReleaseGate = skillVersionReleaseGate(version.Status, nullableString(lastEvalResultID), nullableString(lastEvalStatus), traceComplete, exportContractComplete, qaCoverageComplete, version.ReleaseGate.CriticalSafetyRegressions)
		page.Items = append(page.Items, version)
	}
	return page, rows.Err()
}

func (r Repository) ListEvalResults(ctx context.Context, filters EvalResultFilters) (Page[EvalResult], error) {
	filters.TenantID = strings.TrimSpace(filters.TenantID)
	if filters.TenantID == "" {
		return Page[EvalResult]{}, errors.Join(ErrValidation, errors.New("tenant_id is required"))
	}
	if filters.Limit <= 0 || filters.Limit > 100 {
		filters.Limit = 50
	}
	args := []any{filters.TenantID, filters.Limit}
	query := `
SELECT id, tenant_id, eval_suite_id, subject_type, subject_id, subject_version, status, summary, runner, runner_sha256, completed_at, created_at
FROM eval_results
WHERE tenant_id = $1`
	addFilter := func(column, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		args = append(args, value)
		query += fmt.Sprintf(" AND %s = $%d", column, len(args))
	}
	addFilter("eval_suite_id", filters.SuiteID)
	addFilter("status", filters.Status)
	addFilter("subject_type", filters.SubjectType)
	addFilter("subject_id", filters.SubjectID)
	addFilter("subject_version", filters.SubjectVersion)
	if !filters.CompletedAfter.IsZero() {
		args = append(args, filters.CompletedAfter.UTC())
		query += fmt.Sprintf(" AND completed_at >= $%d", len(args))
	}
	if filters.LatestOnly {
		query = `
SELECT DISTINCT ON (subject_type, subject_id, subject_version)
	id, tenant_id, eval_suite_id, subject_type, subject_id, subject_version, status, summary, runner, runner_sha256, completed_at, created_at
FROM (` + query + `
) filtered
ORDER BY subject_type, subject_id, subject_version, completed_at DESC, created_at DESC
LIMIT $2`
	} else {
		query += " ORDER BY completed_at DESC, created_at DESC LIMIT $2"
	}
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[EvalResult]{}, err
	}
	defer rows.Close()

	var page Page[EvalResult]
	for rows.Next() {
		result, err := scanEvalResult(rows)
		if err != nil {
			return Page[EvalResult]{}, err
		}
		page.Items = append(page.Items, result)
	}
	return page, rows.Err()
}

func (r Repository) GetEvalResultArtifact(ctx context.Context, tenantID, resultID string, now time.Time) (EvalResultArtifact, error) {
	tenantID = strings.TrimSpace(tenantID)
	resultID = strings.TrimSpace(resultID)
	if tenantID == "" || resultID == "" {
		return EvalResultArtifact{}, errors.Join(ErrValidation, errors.New("tenant_id and result_id are required"))
	}
	var result EvalResult
	var summaryJSON []byte
	var runner, runnerSHA256 string
	err := r.db.QueryRow(ctx, `
SELECT id, tenant_id, eval_suite_id, subject_type, subject_id, subject_version, status, summary, runner, runner_sha256, completed_at, created_at
FROM eval_results
WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		resultID,
	).Scan(
		&result.ResultID,
		&result.TenantID,
		&result.SuiteID,
		&result.Subject.SubjectType,
		&result.Subject.SubjectID,
		&result.Subject.Version,
		&result.Status,
		&summaryJSON,
		&runner,
		&runnerSHA256,
		&result.CompletedAt,
		&result.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return EvalResultArtifact{}, ErrNotFound
	}
	if err != nil {
		return EvalResultArtifact{}, err
	}
	result.Summary, result.FixtureResults, result.RunnerContract, result.StorageContract = evalProjectionFromSummary(summaryJSON, runner, runnerSHA256)
	result.Subject.CandidateStatusAfterEval = evalCandidateStatus(result.Status)
	if now.IsZero() {
		now = time.Now().UTC()
	}
	objectKey := "tenants/" + tenantID + "/eval-results/" + result.ResultID + ".json"
	artifactBytes := jsonValue(map[string]any{
		"result_id":        result.ResultID,
		"tenant_id":        result.TenantID,
		"suite_id":         result.SuiteID,
		"subject":          result.Subject,
		"status":           result.Status,
		"completed_at":     result.CompletedAt,
		"created_at":       result.CreatedAt,
		"summary":          result.Summary,
		"fixture_results":  result.FixtureResults,
		"runner_contract":  result.RunnerContract,
		"storage_contract": result.StorageContract,
	})
	sum := sha256.Sum256(artifactBytes)
	expiresAt := now.Add(15 * time.Minute)
	return EvalResultArtifact{
		ResultID:      result.ResultID,
		TenantID:      result.TenantID,
		SuiteID:       result.SuiteID,
		Subject:       result.Subject,
		Status:        result.Status,
		CompletedAt:   result.CompletedAt,
		ObjectKey:     objectKey,
		ContentType:   "application/json",
		SHA256:        hex.EncodeToString(sum[:]),
		ArtifactLinks: evalArtifactLinks(result),
		DownloadURL:   "/api/admin/v1/eval/results/" + url.PathEscape(result.ResultID) + "/artifact?tenant_id=" + url.QueryEscape(tenantID) + "&expires_at=" + url.QueryEscape(expiresAt.Format(time.RFC3339)),
		ExpiresAt:     expiresAt,
		AccessPolicy: map[string]any{
			"direct_object_access_allowed": false,
			"audit_access_required":        true,
			"max_expires_in_seconds":       900,
		},
		AuditRequired: true,
	}, nil
}

func scanEvalResult(rows store.Rows) (EvalResult, error) {
	var result EvalResult
	var summaryJSON []byte
	var runner, runnerSHA256 string
	if err := rows.Scan(
		&result.ResultID,
		&result.TenantID,
		&result.SuiteID,
		&result.Subject.SubjectType,
		&result.Subject.SubjectID,
		&result.Subject.Version,
		&result.Status,
		&summaryJSON,
		&runner,
		&runnerSHA256,
		&result.CompletedAt,
		&result.CreatedAt,
	); err != nil {
		return EvalResult{}, err
	}
	result.Subject.CandidateStatusAfterEval = evalCandidateStatus(result.Status)
	result.Summary, result.FixtureResults, result.RunnerContract, result.StorageContract = evalProjectionFromSummary(summaryJSON, runner, runnerSHA256)
	return result, nil
}

func skillVersionReleaseGate(status string, resultID, resultStatus *string, traceComplete, exportContractComplete, qaCoverageComplete bool, criticalSafetyRegressions int) SkillVersionReleaseGate {
	evalStatus := stringValue(resultStatus)
	evalContractComplete := traceComplete && exportContractComplete && qaCoverageComplete
	eligibleForCanary := evalStatus == "pass" && evalContractComplete && criticalSafetyRegressions == 0
	eligibleForActive := eligibleForCanary && (status == "internal_canary" || status == "allowlist_canary" || status == "percent_canary" || status == "active")
	blockingReason := ""
	switch {
	case resultID == nil:
		blockingReason = "missing_eval_result"
	case evalStatus != "pass":
		blockingReason = "latest_eval_status_" + firstNonEmpty(evalStatus, "unknown")
	case !traceComplete:
		blockingReason = "trace_contract_incomplete"
	case !exportContractComplete:
		blockingReason = "export_contract_incomplete"
	case !qaCoverageComplete:
		blockingReason = "qa_fixture_coverage_incomplete"
	case criticalSafetyRegressions > 0:
		blockingReason = "critical_safety_regressions"
	case !eligibleForActive:
		blockingReason = "not_in_active_release_state"
	}
	return SkillVersionReleaseGate{
		RequiresEvalPass:          true,
		EligibleForCanary:         eligibleForCanary,
		EligibleForActive:         eligibleForActive,
		BlockingReason:            blockingReason,
		LastEvalResultID:          resultID,
		LastEvalStatus:            resultStatus,
		EvalContractComplete:      evalContractComplete,
		CriticalSafetyRegressions: criticalSafetyRegressions,
	}
}

func evalProjectionFromSummary(summaryJSON []byte, runner, runnerSHA256 string) (map[string]any, []any, map[string]any, map[string]any) {
	var raw map[string]any
	_ = json.Unmarshal(summaryJSON, &raw)
	raw = security.RedactMap(raw)
	if raw == nil {
		raw = map[string]any{}
	}
	summary := raw
	if nested, ok := raw["summary"].(map[string]any); ok {
		summary = security.RedactMap(nested)
	}
	fixtureResults := evalArray(raw, "fixture_results")
	if len(fixtureResults) == 0 {
		fixtureResults = evalArray(summary, "fixture_results")
	}
	delete(summary, "fixture_results")
	runnerContract := evalMap(raw, "runner_contract")
	if len(runnerContract) == 0 {
		runnerContract = evalMap(raw, "runner")
	}
	if len(runnerContract) == 0 {
		runnerContract = map[string]any{}
	}
	runner = strings.TrimSpace(firstNonEmpty(runner, stringFromMap(runnerContract, "runner", "")))
	runnerSHA256 = strings.TrimSpace(firstNonEmpty(runnerSHA256, stringFromMap(runnerContract, "runner_sha256", "")))
	if runner != "" {
		runnerContract["runner"] = runner
	}
	if runnerSHA256 != "" {
		runnerContract["runner_sha256"] = runnerSHA256
	}
	if _, ok := runnerContract["deterministic_replay_command"]; !ok {
		runnerContract["deterministic_replay_command"] = "python3 scripts/run_stage0_eval.py --check"
	}
	if _, ok := runnerContract["writes_stored_fixture"]; !ok {
		runnerContract["writes_stored_fixture"] = true
	}
	if _, ok := runnerContract["check_mode_compares_exact_json"]; !ok {
		runnerContract["check_mode_compares_exact_json"] = true
	}
	if _, ok := runnerContract["source_fixture_digests"]; !ok {
		runnerContract["source_fixture_digests"] = []any{}
	}
	storageContract := evalMap(raw, "storage_contract")
	if len(storageContract) == 0 {
		storageContract = map[string]any{}
	}
	storageContract = evalStorageContractDefaults(storageContract)
	return security.RedactMap(summary), redactArray(fixtureResults), security.RedactMap(runnerContract), security.RedactMap(storageContract)
}

func evalMap(values map[string]any, key string) map[string]any {
	value, ok := values[key].(map[string]any)
	if !ok || value == nil {
		return map[string]any{}
	}
	return security.RedactMap(value)
}

func evalArray(values map[string]any, key string) []any {
	items, ok := values[key].([]any)
	if !ok {
		return nil
	}
	return redactArray(items)
}

func redactArray(items []any) []any {
	if len(items) == 0 {
		return nil
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, security.RedactValue(item))
	}
	return out
}

func evalStorageContractDefaults(contract map[string]any) map[string]any {
	defaults := map[string]any{
		"table":                                 "eval_results",
		"tenant_scoped":                         true,
		"subject_scoped":                        true,
		"summary_json_contains_fixture_results": true,
		"admin_read_projection_required":        true,
		"read_without_eval_rerun":               true,
		"latest_result_resolvable":              true,
		"immutable_rows":                        true,
		"no_public_delete_operation":            true,
	}
	for key, value := range defaults {
		if _, ok := contract[key]; !ok {
			contract[key] = value
		}
	}
	return security.RedactMap(contract)
}

func evalCandidateStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "pass":
		return "eligible_for_active"
	case "fail":
		return "blocked"
	case "blocked":
		return "blocked"
	default:
		return "draft"
	}
}

func evalArtifactLinks(result EvalResult) []string {
	links := []string{
		"eval_result_json",
		"summary_json",
		"fixture_results_json",
		"source_fixture_digests_json",
		"runner_manifest_json",
	}
	if len(result.FixtureResults) > 0 {
		links = append(links, "qa_results_json", "safety_decisions_json", "trace_export_gate_matrix_json")
	}
	return links
}

func (r Repository) ListPackages(ctx context.Context, tenantID, projectID, status string, limit int) (Page[Package], error) {
	tenantID = strings.TrimSpace(tenantID)
	projectID = strings.TrimSpace(projectID)
	if tenantID == "" || projectID == "" {
		return Page[Package]{}, errors.Join(ErrValidation, errors.New("tenant_id and project_id are required"))
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{tenantID, projectID, limit}
	query := `
SELECT id, tenant_id, project_id, status, manifest, created_at, updated_at
FROM packages
WHERE tenant_id = $1 AND project_id = $2`
	if strings.TrimSpace(status) != "" {
		args = append(args, strings.TrimSpace(status))
		query += fmt.Sprintf(" AND status = $%d", len(args))
	}
	query += " ORDER BY updated_at DESC, created_at DESC LIMIT $3"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[Package]{}, err
	}
	defer rows.Close()

	var page Page[Package]
	for rows.Next() {
		pkg, err := scanPackageRows(rows)
		if err != nil {
			return Page[Package]{}, err
		}
		items, err := r.listPackageItems(ctx, tenantID, pkg.ID)
		if err != nil {
			return Page[Package]{}, err
		}
		pkg.Items = items
		page.Items = append(page.Items, pkg)
	}
	return page, rows.Err()
}

func (r Repository) CreatePackage(ctx context.Context, tenantID, userID, projectID string, input PackageCreate) (Package, error) {
	tenantID = strings.TrimSpace(tenantID)
	userID = strings.TrimSpace(userID)
	projectID = strings.TrimSpace(projectID)
	if tenantID == "" || userID == "" || projectID == "" {
		return Package{}, errors.Join(ErrValidation, errors.New("tenant_id, user_id, and project_id are required"))
	}
	if len(input.Items) == 0 {
		return Package{}, errors.Join(ErrValidation, errors.New("items are required"))
	}
	workflowID, err := r.projectWorkflowID(ctx, tenantID, projectID)
	if err != nil {
		return Package{}, err
	}
	items := make([]PackageItem, 0, len(input.Items))
	for idx, rawItem := range input.Items {
		item, err := normalizePackageItemCreate(rawItem, idx)
		if err != nil {
			return Package{}, err
		}
		items = append(items, item)
	}
	now := time.Now().UTC()
	packageID := id.New("package")
	manifest := security.RedactMap(input.Manifest)
	if manifest == nil {
		manifest = map[string]any{}
	}
	manifest["package_id"] = packageID
	manifest["project_id"] = projectID
	if workflowID != "" {
		manifest["workflow_id"] = workflowID
	}
	manifest["item_count"] = len(input.Items)
	if _, err := r.db.Exec(ctx, `
INSERT INTO packages(id, tenant_id, project_id, created_by, status, manifest, created_at, updated_at)
VALUES($1, $2, $3, $4, 'draft', $5, $6, $6)`,
		packageID,
		tenantID,
		projectID,
		userID,
		jsonObject(manifest),
		now,
	); err != nil {
		return Package{}, err
	}

	for idx := range items {
		item := items[idx]
		item.ID = id.New("package_item")
		item.CreatedAt = now
		_, err = r.db.Exec(ctx, `
INSERT INTO package_items(id, tenant_id, package_id, asset_id, canvas_frame_id, item_type, sort_order, provenance, created_at)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			item.ID,
			tenantID,
			packageID,
			item.AssetID,
			item.CanvasFrameID,
			item.Type,
			item.SortOrder,
			jsonObject(item.Provenance),
			now,
		)
		if err != nil {
			return Package{}, err
		}
		items[idx] = item
	}
	return Package{
		ID:         packageID,
		TenantID:   tenantID,
		ProjectID:  projectID,
		Status:     "draft",
		Manifest:   manifest,
		QAReport:   map[string]any{},
		Provenance: map[string]any{},
		Items:      items,
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}

func (r Repository) projectWorkflowID(ctx context.Context, tenantID, projectID string) (string, error) {
	var workflowID string
	err := r.db.QueryRow(ctx, `
SELECT COALESCE(workflow_id, '')
FROM projects
WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		projectID,
	).Scan(&workflowID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return workflowID, nil
}

func (r Repository) listPackageItems(ctx context.Context, tenantID, packageID string) ([]PackageItem, error) {
	rows, err := r.db.Query(ctx, `
SELECT id, asset_id, canvas_frame_id, item_type, sort_order, provenance, created_at
FROM package_items
WHERE tenant_id = $1 AND package_id = $2
ORDER BY sort_order ASC, created_at ASC`,
		tenantID,
		packageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []PackageItem{}
	for rows.Next() {
		item, err := scanPackageItemRows(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanPackageRows(row interface{ Scan(dest ...any) error }) (Package, error) {
	var pkg Package
	var manifestJSON []byte
	if err := row.Scan(&pkg.ID, &pkg.TenantID, &pkg.ProjectID, &pkg.Status, &manifestJSON, &pkg.CreatedAt, &pkg.UpdatedAt); err != nil {
		return Package{}, err
	}
	_ = json.Unmarshal(manifestJSON, &pkg.Manifest)
	pkg.Manifest = security.RedactMap(pkg.Manifest)
	pkg.QAReport = map[string]any{}
	pkg.Provenance = map[string]any{}
	if value, ok := pkg.Manifest["qa_report"].(map[string]any); ok {
		pkg.QAReport = security.RedactMap(value)
	}
	if value, ok := pkg.Manifest["provenance"].(map[string]any); ok {
		pkg.Provenance = security.RedactMap(value)
	}
	return pkg, nil
}

func scanPackageItemRows(row interface{ Scan(dest ...any) error }) (PackageItem, error) {
	var item PackageItem
	var provenanceJSON []byte
	if err := row.Scan(&item.ID, &item.AssetID, &item.CanvasFrameID, &item.Type, &item.SortOrder, &provenanceJSON, &item.CreatedAt); err != nil {
		return PackageItem{}, err
	}
	_ = json.Unmarshal(provenanceJSON, &item.Provenance)
	item.Provenance = security.RedactMap(item.Provenance)
	return item, nil
}

func normalizePackageItemCreate(raw PackageItemCreate, index int) (PackageItem, error) {
	input := map[string]any(raw)
	provenance := map[string]any{}
	if value, ok := input["provenance"].(map[string]any); ok {
		provenance = security.RedactMap(value)
	}
	for key, value := range input {
		switch key {
		case "asset_id", "assetId", "canvas_frame_id", "canvasFrameId", "type", "item_type", "itemType", "sort_order", "sortOrder", "provenance":
			continue
		default:
			provenance[key] = security.RedactValue(value)
		}
	}
	itemType := firstNonEmpty(packageItemString(input, "type"), packageItemString(input, "item_type"), packageItemString(input, "itemType"))
	if itemType == "" {
		itemType = "reference"
	}
	switch itemType {
	case "candidate", "canvas-frame", "canvas_frame", "reference", "asset":
	default:
		return PackageItem{}, errors.Join(ErrValidation, fmt.Errorf("unsupported package item type %q", itemType))
	}
	if itemType == "canvas_frame" {
		itemType = "canvas-frame"
	}
	assetID := firstNonEmpty(packageItemString(input, "asset_id"), packageItemString(input, "assetId"))
	canvasFrameID := firstNonEmpty(packageItemString(input, "canvas_frame_id"), packageItemString(input, "canvasFrameId"))
	if assetID == "" && canvasFrameID == "" {
		if sourceID := packageItemString(input, "source_id"); sourceID != "" {
			provenance["source_id"] = sourceID
		} else if sourceID := packageItemString(input, "sourceId"); sourceID != "" {
			provenance["source_id"] = sourceID
		} else {
			return PackageItem{}, errors.Join(ErrValidation, errors.New("package item requires asset_id, canvas_frame_id, or source_id"))
		}
	}
	sortOrder := packageItemInt(input, "sort_order", index)
	sortOrder = packageItemInt(input, "sortOrder", sortOrder)
	item := PackageItem{
		Type:       itemType,
		SortOrder:  sortOrder,
		Provenance: provenance,
	}
	if assetID != "" {
		item.AssetID = &assetID
	}
	if canvasFrameID != "" {
		item.CanvasFrameID = &canvasFrameID
	}
	return item, nil
}

func packageItemString(input map[string]any, key string) string {
	value, ok := input[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(security.RedactString(typed))
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func packageItemInt(input map[string]any, key string, fallback int) int {
	value, ok := input[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return int(parsed)
		}
	case string:
		var parsed int
		if _, err := fmt.Sscanf(strings.TrimSpace(typed), "%d", &parsed); err == nil {
			return parsed
		}
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (r Repository) CreateExport(ctx context.Context, tenantID, userID, packageID string, input ExportCreate, schemaVersion int) (task.Task, error) {
	format := strings.TrimSpace(input.Format)
	if format == "" {
		format = "zip"
	}
	if format != "zip" && format != "pdf" {
		return task.Task{}, errors.Join(ErrValidation, errors.New("format must be zip or pdf"))
	}
	pkg, err := r.packageContext(ctx, tenantID, packageID)
	if err != nil {
		return task.Task{}, err
	}
	blocked, err := r.hasBlockingExportQA(ctx, tenantID, packageID)
	if err != nil {
		return task.Task{}, err
	}
	if blocked {
		return task.Task{}, ErrSafetyBlocked
	}
	exportID := id.New("export")
	if _, err := r.RunRuntimeSafetyPolicy(ctx, RuntimeSafetyPolicyInput{
		TenantID:      tenantID,
		ProjectID:     pkg.ProjectID,
		QASubjectType: "package",
		QASubjectID:   packageID,
		ExportID:      exportID,
	}); err != nil {
		return task.Task{}, err
	}

	now := time.Now().UTC()
	taskID := id.New("task")
	_, err = r.db.Exec(ctx, `
INSERT INTO agent_tasks(id, tenant_id, type, schema_version, status, user_status, progress, user_message, app_version, worker_version, metadata, created_at, updated_at)
VALUES($1, $2, 'package_export_builder', $3, 'pending', 'pending', 0, 'Export queued', 'stage0-local', 'stage0-local', $4, $5, $5)`,
		taskID,
		tenantID,
		schemaVersion,
		jsonObject(map[string]any{"package_id": packageID, "project_id": pkg.ProjectID, "workflow_id": pkg.WorkflowID, "format": format, "export_id": exportID}),
		now,
	)
	if err != nil {
		return task.Task{}, err
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO exports(id, tenant_id, package_id, project_id, task_id, format, status, qa_status, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, $6, 'pending', 'pending', $7, $7)`,
		exportID,
		tenantID,
		packageID,
		pkg.ProjectID,
		taskID,
		format,
		now,
	)
	if err != nil {
		return task.Task{}, err
	}
	if err := r.RecordAnalyticsEvent(ctx, AnalyticsEvent{
		TenantID:    tenantID,
		UserID:      userID,
		ProjectID:   pkg.ProjectID,
		WorkflowID:  pkg.WorkflowID,
		EventName:   "export_started",
		SubjectType: "export",
		SubjectID:   exportID,
		Properties: map[string]any{
			"package_id": packageID,
			"task_id":    taskID,
			"format":     format,
		},
		CreatedAt: now,
	}); err != nil {
		return task.Task{}, err
	}
	return task.Task{
		ID:            taskID,
		TenantID:      tenantID,
		Type:          "package_export_builder",
		SchemaVersion: schemaVersion,
		Status:        task.StatusPending,
		UserStatus:    "pending",
		Progress:      0,
		UserMessage:   "Export queued",
		AppVersion:    "stage0-local",
		WorkerVersion: "stage0-local",
		Metadata:      map[string]any{"package_id": packageID, "project_id": pkg.ProjectID, "workflow_id": pkg.WorkflowID, "format": format, "export_id": exportID},
		CreatedAt:     now,
		UpdatedAt:     now,
	}, nil
}

func (r Repository) CreateUpload(ctx context.Context, opts UploadOptions) (Upload, error) {
	filename := cleanFilename(opts.Input.Filename)
	contentType := strings.ToLower(strings.TrimSpace(opts.Input.ContentType))
	uploadType := strings.TrimSpace(opts.Input.UploadType)
	if uploadType == "" {
		uploadType = "reference"
	}
	if strings.TrimSpace(opts.TenantID) == "" || strings.TrimSpace(opts.UserID) == "" {
		return Upload{}, errors.Join(ErrValidation, errors.New("tenant_id and user_id are required"))
	}
	if filename == "" {
		return Upload{}, errors.Join(ErrValidation, errors.New("filename is required"))
	}
	if contentType == "" {
		return Upload{}, errors.Join(ErrValidation, errors.New("content_type is required"))
	}
	if opts.Input.ByteSize <= 0 {
		return Upload{}, errors.Join(ErrValidation, errors.New("byte_size must be positive"))
	}
	if opts.MaxBytes > 0 && opts.Input.ByteSize > opts.MaxBytes {
		return Upload{}, errors.Join(ErrValidation, errors.New("byte_size exceeds configured upload limit"))
	}
	if !contentTypeAllowed(contentType, opts.AllowedContentTypes) {
		return Upload{}, errors.Join(ErrValidation, errors.New("content_type is not allowed"))
	}
	if uploadType != "reference" && uploadType != "brief_attachment" {
		return Upload{}, errors.Join(ErrValidation, errors.New("upload_type must be reference or brief_attachment"))
	}
	if opts.URLTTL <= 0 {
		opts.URLTTL = 10 * time.Minute
	}
	if strings.TrimSpace(opts.Bucket) == "" {
		opts.Bucket = "zenari-local"
	}
	if opts.SignURL == nil {
		return Upload{}, errors.New("upload URL signer is required")
	}

	now := time.Now().UTC()
	uploadID := id.New("upload")
	objectID := id.New("object")
	objectKey := "uploads/" + uploadID + "/" + filename
	metadata := sanitizeUploadMetadata(opts.Input.Metadata)
	scanResult, err := scanUpload(ctx, opts.MalwareScanner, security.MalwareScanTarget{
		TenantID:    opts.TenantID,
		ObjectKey:   objectKey,
		ContentType: contentType,
		ByteSize:    opts.Input.ByteSize,
		Metadata:    malwareScanMetadata(metadata),
	})
	if err != nil {
		if opts.MalwareFailClosed {
			return Upload{}, ErrMalwareBlocked
		}
		return Upload{}, err
	}
	metadata["malware_scan"] = malwareScanMetadataValue(scanResult)
	if scanResult.Status == security.MalwareScanStatusSuspicious || (opts.MalwareFailClosed && scanResult.Status != security.MalwareScanStatusClean) {
		return Upload{}, ErrMalwareBlocked
	}
	uploadURL, expiresAt := opts.SignURL(opts.TenantID, objectKey, opts.URLTTL)
	upload := Upload{
		ID:           uploadID,
		TenantID:     opts.TenantID,
		UserID:       opts.UserID,
		Status:       "pending",
		UploadType:   uploadType,
		OriginalName: filename,
		ContentType:  contentType,
		ByteSize:     opts.Input.ByteSize,
		ObjectKey:    objectKey,
		UploadURL:    uploadURL,
		ExpiresAt:    expiresAt,
		Metadata:     metadata,
		CreatedAt:    now,
		UpdatedAt:    now,
		ObjectMetadata: ObjectMetadata{
			ID:          objectID,
			TenantID:    opts.TenantID,
			ProjectID:   nil,
			OwnerID:     &opts.UserID,
			AssetType:   "upload:" + uploadType,
			Bucket:      opts.Bucket,
			ObjectKey:   "tenants/" + opts.TenantID + "/" + objectKey,
			ContentType: contentType,
			ByteSize:    opts.Input.ByteSize,
			Provider:    "configured",
			Retention:   "active",
			Metadata:    metadata,
			CreatedAt:   now,
		},
	}
	if strings.TrimSpace(opts.Input.ProjectID) != "" {
		projectID := strings.TrimSpace(opts.Input.ProjectID)
		upload.ProjectID = &projectID
		upload.ObjectMetadata.ProjectID = &projectID
	}

	_, err = r.db.Exec(ctx, `
INSERT INTO uploads(id, tenant_id, project_id, user_id, upload_type, status, original_filename, content_type, byte_size, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $9)`,
		upload.ID,
		upload.TenantID,
		upload.ProjectID,
		upload.UserID,
		upload.UploadType,
		upload.OriginalName,
		upload.ContentType,
		upload.ByteSize,
		now,
	)
	if err != nil {
		return Upload{}, err
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO object_metadata(id, tenant_id, upload_id, project_id, owner_id, asset_type, bucket, object_key, content_type, byte_size, checksum, provider, retention_state, metadata, created_at)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '', $11, $12, $13, $14)`,
		upload.ObjectMetadata.ID,
		upload.TenantID,
		upload.ID,
		upload.ProjectID,
		upload.UserID,
		upload.ObjectMetadata.AssetType,
		upload.ObjectMetadata.Bucket,
		upload.ObjectMetadata.ObjectKey,
		upload.ObjectMetadata.ContentType,
		upload.ObjectMetadata.ByteSize,
		upload.ObjectMetadata.Provider,
		upload.ObjectMetadata.Retention,
		jsonObject(metadata),
		now,
	)
	if err != nil {
		return Upload{}, err
	}
	if err := r.RecordAnalyticsEvent(ctx, AnalyticsEvent{
		TenantID:    opts.TenantID,
		UserID:      opts.UserID,
		ProjectID:   stringValue(upload.ProjectID),
		EventName:   "upload_created",
		SubjectType: "upload",
		SubjectID:   upload.ID,
		Properties: map[string]any{
			"upload_type":  upload.UploadType,
			"content_type": upload.ContentType,
			"byte_size":    upload.ByteSize,
			"object_id":    upload.ObjectMetadata.ID,
		},
		CreatedAt: now,
	}); err != nil {
		return Upload{}, err
	}
	return upload, nil
}

func (r Repository) RecordUploadedObjectScan(ctx context.Context, tenantID, objectKey string, stored objectstore.Object, result security.MalwareScanResult) error {
	var err error
	tenantID, err = normalizeCleanupTenantID(tenantID)
	if err != nil {
		return err
	}
	rawObjectKey := strings.Trim(strings.TrimSpace(objectKey), "/")
	if strings.HasPrefix(rawObjectKey, "tenants/") && !strings.HasPrefix(rawObjectKey, "tenants/"+tenantID+"/") {
		return errors.Join(ErrTenantDenied, errors.New("object key is not available for this tenant"))
	}
	rawStoredKey := strings.Trim(strings.TrimSpace(stored.Key), "/")
	if strings.HasPrefix(rawStoredKey, "tenants/") && !strings.HasPrefix(rawStoredKey, "tenants/"+tenantID+"/") {
		return errors.Join(ErrTenantDenied, errors.New("stored object key is not available for this tenant"))
	}
	objectKey = tenantScopedObjectKey(tenantID, objectKey)
	storedKey := tenantScopedObjectKey(tenantID, stored.Key)
	if tenantID == "" || objectKey == "" || storedKey == "" {
		return errors.Join(ErrValidation, errors.New("tenant_id and object_key are required"))
	}
	if stored.TenantID != "" && strings.TrimSpace(stored.TenantID) != tenantID {
		return errors.Join(ErrTenantDenied, errors.New("stored object tenant does not match upload tenant"))
	}
	if objectKey != storedKey {
		return errors.Join(ErrTenantDenied, errors.New("stored object key does not match signed upload key"))
	}
	if cleanupKeyHasUnsafeSegment(objectKey) || strings.Contains(objectKey, "\\") {
		return errors.Join(ErrValidation, errors.New("object key is invalid"))
	}
	expectedPrefix := "tenants/" + tenantID + "/"
	if !strings.HasPrefix(objectKey, expectedPrefix) {
		return errors.Join(ErrValidation, errors.New("object key must match tenant scope"))
	}
	if stored.ByteSize <= 0 {
		return errors.Join(ErrValidation, errors.New("stored object byte_size must be positive"))
	}
	now := time.Now().UTC()
	scanMetadata := malwareScanMetadataValue(result)
	metadataPatch := security.RedactMap(map[string]any{
		"stored_object": map[string]any{
			"malware_scan": scanMetadata,
			"checksum":     stored.Checksum,
			"byte_size":    stored.ByteSize,
			"content_type": stored.ContentType,
			"verified_at":  now.Format(time.RFC3339),
		},
	})
	tag, err := r.db.Exec(ctx, `
UPDATE object_metadata
SET checksum = $4,
    byte_size = $5,
    content_type = COALESCE(NULLIF($6, ''), content_type),
    metadata = metadata || $7::jsonb,
    updated_at = $8
WHERE tenant_id = $1
  AND object_key = $2
  AND upload_id IS NOT NULL
  AND retention_state = 'active'
  AND object_key = $3`,
		tenantID,
		objectKey,
		storedKey,
		stored.Checksum,
		stored.ByteSize,
		strings.ToLower(strings.TrimSpace(stored.ContentType)),
		jsonObject(metadataPatch),
		now,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r Repository) RecordExportArtifact(ctx context.Context, artifact ExportArtifact) (Export, error) {
	artifact.TenantID = strings.TrimSpace(artifact.TenantID)
	artifact.ExportID = strings.TrimSpace(artifact.ExportID)
	artifact.ProjectID = strings.TrimSpace(artifact.ProjectID)
	artifact.ObjectKey = strings.Trim(strings.TrimSpace(artifact.ObjectKey), "/")
	artifact.Format = strings.TrimSpace(artifact.Format)
	artifact.ContentType = strings.TrimSpace(artifact.ContentType)
	if artifact.TenantID == "" || artifact.ExportID == "" || artifact.ProjectID == "" {
		return Export{}, errors.Join(ErrValidation, errors.New("tenant_id, export_id, and project_id are required"))
	}
	if artifact.ObjectKey == "" {
		return Export{}, errors.Join(ErrValidation, errors.New("object_key is required"))
	}
	if artifact.Format == "" {
		artifact.Format = "zip"
	}
	if artifact.ContentType == "" {
		artifact.ContentType = contentTypeForExport(artifact.Format)
	}
	if artifact.StorageProvider == "" {
		artifact.StorageProvider = "configured"
	}
	if artifact.Bucket == "" {
		artifact.Bucket = "zenari-local"
	}
	if artifact.Manifest == nil {
		artifact.Manifest = map[string]any{}
	}
	if artifact.QAReport == nil {
		artifact.QAReport = map[string]any{}
	}
	if artifact.Provenance == nil {
		artifact.Provenance = map[string]any{}
	}
	if _, err := r.RunRuntimeSafetyPolicy(ctx, RuntimeSafetyPolicyInput{
		TenantID:      artifact.TenantID,
		ProjectID:     artifact.ProjectID,
		QASubjectType: "export",
		QASubjectID:   artifact.ExportID,
		ExportID:      artifact.ExportID,
	}); err != nil {
		return Export{}, err
	}
	if artifact.Thumbnail == nil {
		thumbnail := BuildExportThumbnail(artifact.ExportID, artifact.Format, artifact.Manifest)
		artifact.Thumbnail = &thumbnail
	}
	delivery := exportDeliveryMetadata(artifact.Format, artifact.Manifest, artifact.Delivery)
	if artifact.Thumbnail != nil {
		delivery["thumbnail"] = map[string]any{
			"status":       "ready",
			"object_key":   tenantScopedObjectKey(artifact.TenantID, artifact.Thumbnail.ObjectKey),
			"content_type": artifact.Thumbnail.ContentType,
			"width":        artifact.Thumbnail.Width,
			"height":       artifact.Thumbnail.Height,
			"byte_size":    artifact.Thumbnail.ByteSize,
			"checksum":     artifact.Thumbnail.Checksum,
		}
	}
	objectID := id.New("object")
	now := time.Now().UTC()
	retentionState := "active"
	if artifact.RetentionUntil != nil && !artifact.RetentionUntil.After(now) {
		retentionState = "expired"
	}
	metadata := security.RedactMap(map[string]any{
		"format":     artifact.Format,
		"manifest":   artifact.Manifest,
		"qa_report":  artifact.QAReport,
		"provenance": artifact.Provenance,
		"delivery":   delivery,
	})
	var derivedFrom *string
	if strings.TrimSpace(artifact.DerivedFromID) != "" {
		value := strings.TrimSpace(artifact.DerivedFromID)
		derivedFrom = &value
	}
	_, err := r.db.Exec(ctx, `
INSERT INTO object_metadata(id, tenant_id, project_id, owner_id, asset_type, bucket, object_key, content_type, byte_size, checksum, provider, retention_state, retention_until, derived_from_object_id, metadata, created_at)
VALUES($1, $2, $3, $4, 'export', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		objectID,
		artifact.TenantID,
		artifact.ProjectID,
		nullableString(artifact.OwnerID),
		artifact.Bucket,
		tenantScopedObjectKey(artifact.TenantID, artifact.ObjectKey),
		artifact.ContentType,
		artifact.ByteSize,
		artifact.Checksum,
		artifact.StorageProvider,
		retentionState,
		artifact.RetentionUntil,
		derivedFrom,
		jsonObject(metadata),
		now,
	)
	if err != nil {
		return Export{}, err
	}
	if artifact.Thumbnail != nil {
		_, err = r.db.Exec(ctx, `
INSERT INTO object_metadata(id, tenant_id, project_id, owner_id, asset_type, bucket, object_key, content_type, byte_size, checksum, provider, retention_state, retention_until, derived_from_object_id, metadata, created_at)
VALUES($1, $2, $3, $4, 'thumbnail', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			id.New("object"),
			artifact.TenantID,
			artifact.ProjectID,
			nullableString(artifact.OwnerID),
			artifact.Bucket,
			tenantScopedObjectKey(artifact.TenantID, artifact.Thumbnail.ObjectKey),
			artifact.Thumbnail.ContentType,
			artifact.Thumbnail.ByteSize,
			artifact.Thumbnail.Checksum,
			artifact.StorageProvider,
			retentionState,
			artifact.RetentionUntil,
			objectID,
			jsonObject(security.RedactMap(map[string]any{
				"thumbnail": artifact.Thumbnail,
				"format":    artifact.Format,
			})),
			now,
		)
		if err != nil {
			return Export{}, err
		}
	}
	_, err = r.db.Exec(ctx, `
UPDATE exports
SET project_id = $3,
    object_metadata_id = $4,
    manifest = $5,
    delivery_metadata = $6,
    status = 'ready',
    qa_status = CASE WHEN qa_status = 'pending' THEN 'passed' ELSE qa_status END,
    updated_at = $7
WHERE tenant_id = $1 AND id = $2`,
		artifact.TenantID,
		artifact.ExportID,
		artifact.ProjectID,
		objectID,
		jsonObject(security.RedactMap(artifact.Manifest)),
		jsonObject(delivery),
		now,
	)
	if err != nil {
		return Export{}, err
	}
	if err := r.RecordAnalyticsEvent(ctx, AnalyticsEvent{
		TenantID:    artifact.TenantID,
		UserID:      artifact.OwnerID,
		ProjectID:   artifact.ProjectID,
		WorkflowID:  stringFromMap(artifact.Manifest, "workflow_id", ""),
		EventName:   "export_completed",
		SubjectType: "export",
		SubjectID:   artifact.ExportID,
		Properties: map[string]any{
			"format":             artifact.Format,
			"byte_size":          artifact.ByteSize,
			"object_metadata_id": objectID,
			"qa_report":          artifact.QAReport,
			"delivery":           delivery,
		},
		CreatedAt: now,
	}); err != nil {
		return Export{}, err
	}
	return r.GetExport(ctx, artifact.TenantID, artifact.ExportID)
}

func (r Repository) GetExport(ctx context.Context, tenantID, exportID string) (Export, error) {
	var export Export
	var errorJSON, manifestJSON, deliveryJSON, objectMetadataJSON []byte
	err := r.db.QueryRow(ctx, `
SELECT e.id, e.tenant_id, e.package_id, e.project_id, e.task_id, e.format, e.status, e.qa_status,
       e.object_metadata_id, e.manifest, e.delivery_metadata, e.error, e.created_at, e.updated_at,
       COALESCE(
         jsonb_build_object(
           'id', o.id,
           'tenant_id', o.tenant_id,
           'project_id', o.project_id,
           'owner_id', o.owner_id,
           'asset_type', o.asset_type,
           'bucket', o.bucket,
           'object_key', o.object_key,
           'content_type', o.content_type,
           'byte_size', o.byte_size,
           'checksum', o.checksum,
           'provider', o.provider,
           'retention_state', o.retention_state,
           'retention_until', o.retention_until,
           'derived_from_object_id', o.derived_from_object_id,
           'metadata', o.metadata,
           'created_at', o.created_at
         ),
         '{}'::jsonb
       )
FROM exports e
LEFT JOIN object_metadata o ON o.tenant_id = e.tenant_id AND o.id = e.object_metadata_id
WHERE e.tenant_id = $1 AND e.id = $2`,
		tenantID,
		exportID,
	).Scan(
		&export.ID,
		&export.TenantID,
		&export.PackageID,
		&export.ProjectID,
		&export.TaskID,
		&export.Format,
		&export.Status,
		&export.QAStatus,
		&export.ObjectID,
		&manifestJSON,
		&deliveryJSON,
		&errorJSON,
		&export.CreatedAt,
		&export.UpdatedAt,
		&objectMetadataJSON,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Export{}, ErrNotFound
	}
	if err != nil {
		return Export{}, err
	}
	_ = json.Unmarshal(manifestJSON, &export.Manifest)
	_ = json.Unmarshal(deliveryJSON, &export.Delivery)
	export.Manifest = security.RedactMap(export.Manifest)
	export.Delivery = security.RedactMap(export.Delivery)
	if len(errorJSON) > 0 {
		_ = json.Unmarshal(errorJSON, &export.Error)
		export.Error = security.RedactMap(export.Error)
	}
	if export.ObjectID != nil && len(objectMetadataJSON) > 0 && string(objectMetadataJSON) != "{}" {
		var object ObjectMetadata
		if err := json.Unmarshal(objectMetadataJSON, &object); err == nil {
			object.Metadata = security.RedactMap(object.Metadata)
			export.Object = &object
		}
	}
	return export, nil
}

func (r Repository) RequireDownloadableObject(ctx context.Context, tenantID, objectKey string, now time.Time) error {
	_, err := r.DownloadableObjectMetadata(ctx, tenantID, objectKey, now)
	return err
}

func (r Repository) DownloadableObjectMetadata(ctx context.Context, tenantID, objectKey string, now time.Time) (ObjectMetadata, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" || objectKey == "" {
		return ObjectMetadata{}, errors.Join(ErrValidation, errors.New("tenant_id and object_key are required"))
	}
	objectKey = tenantScopedObjectKey(tenantID, objectKey)
	if now.IsZero() {
		now = time.Now().UTC()
	}
	var object ObjectMetadata
	var metadataJSON []byte
	err := r.db.QueryRow(ctx, `
SELECT id, tenant_id, project_id, owner_id, asset_type, bucket, object_key, content_type, byte_size,
       checksum, provider, retention_state, retention_until, derived_from_object_id, metadata, created_at
FROM object_metadata
WHERE tenant_id = $1
  AND object_key = $2
  AND asset_type IN ('export', 'thumbnail')
  AND retention_state = 'active'
  AND (
    retention_until IS NULL
    OR retention_until > $3
  )`,
		tenantID,
		objectKey,
		now,
	).Scan(
		&object.ID,
		&object.TenantID,
		&object.ProjectID,
		&object.OwnerID,
		&object.AssetType,
		&object.Bucket,
		&object.ObjectKey,
		&object.ContentType,
		&object.ByteSize,
		&object.Checksum,
		&object.Provider,
		&object.Retention,
		&object.RetentionUntil,
		&object.DerivedFrom,
		&metadataJSON,
		&object.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ObjectMetadata{}, ErrNotFound
	}
	if err != nil {
		return ObjectMetadata{}, err
	}
	_ = json.Unmarshal(metadataJSON, &object.Metadata)
	object.Metadata = security.RedactMap(object.Metadata)
	return object, nil
}

func (r Repository) ListExports(ctx context.Context, tenantID, status string, limit int) (Page[Export], error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{tenantID, limit}
	query := `
SELECT id, tenant_id, package_id, project_id, task_id, format, status, qa_status, object_metadata_id, manifest, delivery_metadata, error, created_at, updated_at
FROM exports
WHERE tenant_id = $1`
	if strings.TrimSpace(status) != "" {
		query += " AND status = $3"
		args = append(args, strings.TrimSpace(status))
	}
	query += " ORDER BY updated_at DESC LIMIT $2"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[Export]{}, err
	}
	defer rows.Close()

	var page Page[Export]
	for rows.Next() {
		var export Export
		var errorJSON, manifestJSON, deliveryJSON []byte
		if err := rows.Scan(&export.ID, &export.TenantID, &export.PackageID, &export.ProjectID, &export.TaskID, &export.Format, &export.Status, &export.QAStatus, &export.ObjectID, &manifestJSON, &deliveryJSON, &errorJSON, &export.CreatedAt, &export.UpdatedAt); err != nil {
			return Page[Export]{}, err
		}
		_ = json.Unmarshal(manifestJSON, &export.Manifest)
		_ = json.Unmarshal(deliveryJSON, &export.Delivery)
		export.Manifest = security.RedactMap(export.Manifest)
		export.Delivery = security.RedactMap(export.Delivery)
		if len(errorJSON) > 0 {
			_ = json.Unmarshal(errorJSON, &export.Error)
			export.Error = security.RedactMap(export.Error)
		}
		page.Items = append(page.Items, export)
	}
	return page, rows.Err()
}

func (r Repository) ListAssetLibrary(ctx context.Context, tenantID, projectID, status string, limit int) (Page[AssetLibraryEntry], error) {
	tenantID = strings.TrimSpace(tenantID)
	projectID = strings.TrimSpace(projectID)
	if tenantID == "" {
		return Page[AssetLibraryEntry]{}, errors.Join(ErrValidation, errors.New("tenant_id is required"))
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{tenantID, projectID, limit}
	query := `
SELECT
	l.id,
	COALESCE(
		jsonb_build_object(
			'id', a.id,
			'asset_type', a.asset_type,
			'status', a.status,
			'object_metadata', jsonb_build_object(
				'id', o.id,
				'bucket', o.bucket,
				'object_key', o.object_key,
				'content_type', o.content_type,
				'byte_size', o.byte_size,
				'checksum', o.checksum,
				'created_at', o.created_at
			),
			'storage_ref', jsonb_build_object(
				'bucket', o.bucket,
				'object_key', o.object_key,
				'content_type', o.content_type,
				'byte_size', o.byte_size,
				'checksum', o.checksum
			),
			'thumbnail_ref', a.provenance->'thumbnail_ref',
			'lineage', COALESCE(a.provenance->'lineage', jsonb_build_object(
				'source', jsonb_build_object('kind', 'asset_library'),
				'object_metadata_id', a.object_metadata_id,
				'raw_payload_persisted', false
			)),
			'provenance', COALESCE(a.provenance, '{}'::jsonb),
			'created_at', a.created_at
		),
		'{}'::jsonb
	),
	l.visibility,
	l.favorite,
	l.archived,
	l.reusable,
	l.allowed_project_ids,
	l.tags,
	l.created_at,
	l.updated_at
FROM asset_library_entries l
JOIN assets a ON a.tenant_id = l.tenant_id AND a.id = l.asset_id
JOIN object_metadata o ON o.tenant_id = a.tenant_id AND o.id = a.object_metadata_id
WHERE l.tenant_id = $1
  AND ($2 = '' OR a.project_id = $2 OR $2 = ANY(l.allowed_project_ids) OR l.visibility = 'tenant')`
	if strings.TrimSpace(status) != "" {
		args = append(args, strings.TrimSpace(status))
		query += fmt.Sprintf(" AND a.status = $%d", len(args))
	}
	query += " ORDER BY l.updated_at DESC, l.id LIMIT $3"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[AssetLibraryEntry]{}, err
	}
	defer rows.Close()

	var page Page[AssetLibraryEntry]
	for rows.Next() {
		var entry AssetLibraryEntry
		var assetJSON []byte
		if err := rows.Scan(
			&entry.ID,
			&assetJSON,
			&entry.Visibility,
			&entry.Favorite,
			&entry.Archived,
			&entry.Reusable,
			&entry.AllowedProjects,
			&entry.Tags,
			&entry.CreatedAt,
			&entry.UpdatedAt,
		); err != nil {
			return Page[AssetLibraryEntry]{}, err
		}
		_ = json.Unmarshal(assetJSON, &entry.Asset)
		entry.Asset = security.RedactMap(entry.Asset)
		page.Items = append(page.Items, entry)
	}
	return page, rows.Err()
}

func (r Repository) CreateAssetLibraryEntry(ctx context.Context, tenantID, userID string, input AssetLibraryEntryCreate) (AssetLibraryEntry, error) {
	tenantID = strings.TrimSpace(tenantID)
	userID = strings.TrimSpace(userID)
	input.AssetID = strings.TrimSpace(input.AssetID)
	input.ProjectID = strings.TrimSpace(input.ProjectID)
	input.Visibility = normalizeAssetLibraryVisibility(input.Visibility)
	input.AllowedProjects = normalizeStringList(input.AllowedProjects)
	input.Tags = normalizeStringList(input.Tags)
	if tenantID == "" || userID == "" || input.AssetID == "" {
		return AssetLibraryEntry{}, errors.Join(ErrValidation, errors.New("tenant_id, user_id, and asset_id are required"))
	}
	if err := validateAssetLibraryWrite(input.Visibility, input.Reusable, input.AllowedProjects, input.Tags); err != nil {
		return AssetLibraryEntry{}, err
	}
	if input.Visibility == "project" && input.ProjectID == "" && len(input.AllowedProjects) == 0 {
		return AssetLibraryEntry{}, errors.Join(ErrValidation, errors.New("project visibility requires project_id or allowed_projects"))
	}
	now := time.Now().UTC()
	entryID := id.New("asset_library")
	_, err := r.db.Exec(ctx, `
INSERT INTO asset_library_entries(id, tenant_id, asset_id, visibility, favorite, archived, reusable, allowed_project_ids, tags, created_by, created_at, updated_at)
SELECT $1, $2, a.id, $4, $5, false, $6, $7, $8, $9, $10, $10
FROM assets a
WHERE a.tenant_id = $2
  AND a.id = $3
  AND ($11 = '' OR a.project_id = $11 OR $11 = ANY($7) OR $4 = 'tenant')
ON CONFLICT (tenant_id, id) DO UPDATE
SET visibility = EXCLUDED.visibility,
    favorite = EXCLUDED.favorite,
    archived = false,
    reusable = EXCLUDED.reusable,
    allowed_project_ids = EXCLUDED.allowed_project_ids,
    tags = EXCLUDED.tags,
    updated_at = EXCLUDED.updated_at`,
		entryID,
		tenantID,
		input.AssetID,
		input.Visibility,
		input.Favorite,
		input.Reusable,
		input.AllowedProjects,
		input.Tags,
		userID,
		now,
		input.ProjectID,
	)
	if err != nil {
		return AssetLibraryEntry{}, err
	}
	entry, err := r.GetAssetLibraryEntry(ctx, tenantID, entryID)
	if err != nil {
		return AssetLibraryEntry{}, err
	}
	return entry, nil
}

func (r Repository) GetAssetLibraryEntry(ctx context.Context, tenantID, entryID string) (AssetLibraryEntry, error) {
	tenantID = strings.TrimSpace(tenantID)
	entryID = strings.TrimSpace(entryID)
	if tenantID == "" || entryID == "" {
		return AssetLibraryEntry{}, errors.Join(ErrValidation, errors.New("tenant_id and entry_id are required"))
	}
	row := r.db.QueryRow(ctx, `
SELECT
	l.id,
	COALESCE(
		jsonb_build_object(
			'id', a.id,
			'asset_type', a.asset_type,
			'status', a.status,
			'object_metadata', jsonb_build_object(
				'id', o.id,
				'bucket', o.bucket,
				'object_key', o.object_key,
				'content_type', o.content_type,
				'byte_size', o.byte_size,
				'checksum', o.checksum,
				'created_at', o.created_at
			),
			'storage_ref', jsonb_build_object(
				'bucket', o.bucket,
				'object_key', o.object_key,
				'content_type', o.content_type,
				'byte_size', o.byte_size,
				'checksum', o.checksum
			),
			'thumbnail_ref', a.provenance->'thumbnail_ref',
			'lineage', COALESCE(a.provenance->'lineage', jsonb_build_object(
				'source', jsonb_build_object('kind', 'asset_library'),
				'object_metadata_id', a.object_metadata_id,
				'raw_payload_persisted', false
			)),
			'provenance', COALESCE(a.provenance, '{}'::jsonb),
			'created_at', a.created_at
		),
		'{}'::jsonb
	),
	l.visibility,
	l.favorite,
	l.archived,
	l.reusable,
	l.allowed_project_ids,
	l.tags,
	l.created_at,
	l.updated_at
FROM asset_library_entries l
JOIN assets a ON a.tenant_id = l.tenant_id AND a.id = l.asset_id
JOIN object_metadata o ON o.tenant_id = a.tenant_id AND o.id = a.object_metadata_id
WHERE l.tenant_id = $1 AND l.id = $2`,
		tenantID,
		entryID,
	)
	entry, err := scanAssetLibraryEntryRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return AssetLibraryEntry{}, ErrNotFound
	}
	return entry, err
}

func (r Repository) UpdateAssetLibraryEntry(ctx context.Context, tenantID, userID, entryID string, input AssetLibraryEntryUpdate) (AssetLibraryEntry, error) {
	tenantID = strings.TrimSpace(tenantID)
	userID = strings.TrimSpace(userID)
	entryID = strings.TrimSpace(entryID)
	if tenantID == "" || userID == "" || entryID == "" {
		return AssetLibraryEntry{}, errors.Join(ErrValidation, errors.New("tenant_id, user_id, and entry_id are required"))
	}
	current, err := r.GetAssetLibraryEntry(ctx, tenantID, entryID)
	if err != nil {
		return AssetLibraryEntry{}, err
	}
	visibility := current.Visibility
	if input.Visibility != nil {
		visibility = normalizeAssetLibraryVisibility(*input.Visibility)
	}
	favorite := current.Favorite
	if input.Favorite != nil {
		favorite = *input.Favorite
	}
	archived := current.Archived
	if input.Archived != nil {
		archived = *input.Archived
	}
	reusable := current.Reusable
	if input.Reusable != nil {
		reusable = *input.Reusable
	}
	allowedProjects := current.AllowedProjects
	if input.AllowedProjects != nil {
		allowedProjects = normalizeStringList(input.AllowedProjects)
	}
	tags := current.Tags
	if input.Tags != nil {
		tags = normalizeStringList(input.Tags)
	}
	if archived {
		favorite = false
	}
	if err := validateAssetLibraryWrite(visibility, reusable, allowedProjects, tags); err != nil {
		return AssetLibraryEntry{}, err
	}
	now := time.Now().UTC()
	tag, err := r.db.Exec(ctx, `
UPDATE asset_library_entries
SET visibility = $3,
    favorite = $4,
    archived = $5,
    reusable = $6,
    allowed_project_ids = $7,
    tags = $8,
    updated_at = $9
WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		entryID,
		visibility,
		favorite,
		archived,
		reusable,
		allowedProjects,
		tags,
		now,
	)
	if err != nil {
		return AssetLibraryEntry{}, err
	}
	if tag.RowsAffected() == 0 {
		return AssetLibraryEntry{}, ErrNotFound
	}
	entry, err := r.GetAssetLibraryEntry(ctx, tenantID, entryID)
	if err != nil {
		return AssetLibraryEntry{}, err
	}
	return entry, nil
}

func (r Repository) ListBrandKits(ctx context.Context, tenantID, projectID, status string, limit int) (Page[BrandKit], error) {
	tenantID = strings.TrimSpace(tenantID)
	projectID = strings.TrimSpace(projectID)
	if tenantID == "" {
		return Page[BrandKit]{}, errors.Join(ErrValidation, errors.New("tenant_id is required"))
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{tenantID, projectID, limit}
	query := `
SELECT id, name, status, logo_asset_refs, palette, fonts, guidelines, source_refs, project_bindings, created_at, updated_at
FROM brand_kits
WHERE tenant_id = $1
  AND ($2 = '' OR project_bindings @> jsonb_build_array(jsonb_build_object('project_id', $2)))`
	if strings.TrimSpace(status) != "" {
		args = append(args, strings.TrimSpace(status))
		query += fmt.Sprintf(" AND status = $%d", len(args))
	}
	query += " ORDER BY updated_at DESC, id LIMIT $3"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[BrandKit]{}, err
	}
	defer rows.Close()

	var page Page[BrandKit]
	for rows.Next() {
		kit, err := scanBrandKitRows(rows)
		if err != nil {
			return Page[BrandKit]{}, err
		}
		page.Items = append(page.Items, kit)
	}
	return page, rows.Err()
}

func (r Repository) GetProjectDefaultBrandKit(ctx context.Context, tenantID, projectID string) (BrandKit, error) {
	tenantID = strings.TrimSpace(tenantID)
	projectID = strings.TrimSpace(projectID)
	if tenantID == "" || projectID == "" {
		return BrandKit{}, errors.Join(ErrValidation, errors.New("tenant_id and project_id are required"))
	}
	row := r.db.QueryRow(ctx, `
SELECT id, name, status, logo_asset_refs, palette, fonts, guidelines, source_refs, project_bindings, created_at, updated_at
FROM brand_kits
WHERE tenant_id = $1
  AND status = 'active'
  AND project_bindings @> jsonb_build_array(jsonb_build_object('project_id', $2, 'default', true))
ORDER BY updated_at DESC, id
LIMIT 1`,
		tenantID,
		projectID,
	)
	kit, err := scanBrandKitRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return BrandKit{}, ErrNotFound
	}
	if err != nil {
		return BrandKit{}, err
	}
	return kit, nil
}

func (r Repository) CreateBrandKit(ctx context.Context, tenantID, userID string, input BrandKitCreate) (BrandKit, error) {
	tenantID = strings.TrimSpace(tenantID)
	userID = strings.TrimSpace(userID)
	input.Name = strings.TrimSpace(input.Name)
	input.Status = normalizeBrandKitStatus(input.Status)
	input.ProjectBindings = normalizeProjectBindings(input.ProjectBindings)
	if tenantID == "" || userID == "" || input.Name == "" {
		return BrandKit{}, errors.Join(ErrValidation, errors.New("tenant_id, user_id, and name are required"))
	}
	if err := validateBrandKitWrite(input.Name, input.Status, input.Logos, input.Palette, input.Fonts, input.Guidelines, input.SourceRefs, input.ProjectBindings); err != nil {
		return BrandKit{}, err
	}
	input.Name = security.RedactString(input.Name)
	input.Logos = redactMapSlice(input.Logos)
	input.Palette = redactMapSlice(input.Palette)
	input.Fonts = redactMapSlice(input.Fonts)
	input.Guidelines = redactMapSlice(input.Guidelines)
	input.SourceRefs = redactMapSlice(input.SourceRefs)
	input.ProjectBindings = redactMapSlice(input.ProjectBindings)
	now := time.Now().UTC()
	kitID := id.New("brand_kit")
	_, err := r.db.Exec(ctx, `
INSERT INTO brand_kits(id, tenant_id, name, status, logo_asset_refs, palette, fonts, guidelines, source_refs, project_bindings, created_by, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
		kitID,
		tenantID,
		input.Name,
		input.Status,
		jsonValue(input.Logos),
		jsonValue(input.Palette),
		jsonValue(input.Fonts),
		jsonValue(input.Guidelines),
		jsonValue(input.SourceRefs),
		jsonValue(input.ProjectBindings),
		userID,
		now,
	)
	if err != nil {
		return BrandKit{}, err
	}
	kit, err := r.GetBrandKit(ctx, tenantID, kitID)
	if err != nil {
		return BrandKit{}, err
	}
	return kit, nil
}

func (r Repository) GetBrandKit(ctx context.Context, tenantID, kitID string) (BrandKit, error) {
	tenantID = strings.TrimSpace(tenantID)
	kitID = strings.TrimSpace(kitID)
	if tenantID == "" || kitID == "" {
		return BrandKit{}, errors.Join(ErrValidation, errors.New("tenant_id and brand_kit_id are required"))
	}
	row := r.db.QueryRow(ctx, `
SELECT id, name, status, logo_asset_refs, palette, fonts, guidelines, source_refs, project_bindings, created_at, updated_at
FROM brand_kits
WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		kitID,
	)
	kit, err := scanBrandKitRow(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return BrandKit{}, ErrNotFound
	}
	return kit, err
}

func (r Repository) UpdateBrandKit(ctx context.Context, tenantID, userID, kitID string, input BrandKitUpdate) (BrandKit, error) {
	tenantID = strings.TrimSpace(tenantID)
	userID = strings.TrimSpace(userID)
	kitID = strings.TrimSpace(kitID)
	if tenantID == "" || userID == "" || kitID == "" {
		return BrandKit{}, errors.Join(ErrValidation, errors.New("tenant_id, user_id, and brand_kit_id are required"))
	}
	current, err := r.GetBrandKit(ctx, tenantID, kitID)
	if err != nil {
		return BrandKit{}, err
	}
	name := current.Name
	if input.Name != nil {
		name = strings.TrimSpace(*input.Name)
	}
	status := current.Status
	if input.Status != nil {
		status = normalizeBrandKitStatus(*input.Status)
	}
	logos := current.Logos
	if input.Logos != nil {
		logos = input.Logos
	}
	palette := current.Palette
	if input.Palette != nil {
		palette = input.Palette
	}
	fonts := current.Fonts
	if input.Fonts != nil {
		fonts = input.Fonts
	}
	guidelines := current.Guidelines
	if input.Guidelines != nil {
		guidelines = input.Guidelines
	}
	sourceRefs := current.SourceRefs
	if input.SourceRefs != nil {
		sourceRefs = input.SourceRefs
	}
	projectBindings := current.ProjectBindings
	if input.ProjectBindings != nil {
		projectBindings = normalizeProjectBindings(input.ProjectBindings)
	}
	if name == "" {
		return BrandKit{}, errors.Join(ErrValidation, errors.New("name is required"))
	}
	if err := validateBrandKitWrite(name, status, logos, palette, fonts, guidelines, sourceRefs, projectBindings); err != nil {
		return BrandKit{}, err
	}
	name = security.RedactString(name)
	logos = redactMapSlice(logos)
	palette = redactMapSlice(palette)
	fonts = redactMapSlice(fonts)
	guidelines = redactMapSlice(guidelines)
	sourceRefs = redactMapSlice(sourceRefs)
	projectBindings = redactMapSlice(projectBindings)
	now := time.Now().UTC()
	tag, err := r.db.Exec(ctx, `
UPDATE brand_kits
SET name = $3,
    status = $4,
    logo_asset_refs = $5,
    palette = $6,
    fonts = $7,
    guidelines = $8,
    source_refs = $9,
    project_bindings = $10,
    updated_at = $11
WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		kitID,
		name,
		status,
		jsonValue(logos),
		jsonValue(palette),
		jsonValue(fonts),
		jsonValue(guidelines),
		jsonValue(sourceRefs),
		jsonValue(projectBindings),
		now,
	)
	if err != nil {
		return BrandKit{}, err
	}
	if tag.RowsAffected() == 0 {
		return BrandKit{}, ErrNotFound
	}
	kit, err := r.GetBrandKit(ctx, tenantID, kitID)
	if err != nil {
		return BrandKit{}, err
	}
	return kit, nil
}

func (r Repository) SetProjectDefaultBrandKit(ctx context.Context, tenantID, userID, projectID string, input ProjectDefaultBrandKitSet) (BrandKit, error) {
	tenantID = strings.TrimSpace(tenantID)
	userID = strings.TrimSpace(userID)
	projectID = strings.TrimSpace(projectID)
	input.BrandKitID = strings.TrimSpace(input.BrandKitID)
	if tenantID == "" || userID == "" || projectID == "" || input.BrandKitID == "" {
		return BrandKit{}, errors.Join(ErrValidation, errors.New("tenant_id, user_id, project_id, and brand_kit_id are required"))
	}
	if _, err := r.GetBrandKit(ctx, tenantID, input.BrandKitID); err != nil {
		return BrandKit{}, err
	}
	now := time.Now().UTC()
	if _, err := r.db.Exec(ctx, `
UPDATE brand_kits
SET project_bindings = COALESCE((
	SELECT jsonb_agg(
		CASE
			WHEN binding->>'project_id' = $2 THEN jsonb_set(binding, '{default}', 'false'::jsonb, true)
			ELSE binding
		END
	)
	FROM jsonb_array_elements(project_bindings) AS binding
), '[]'::jsonb),
updated_at = $4
WHERE tenant_id = $1
  AND project_bindings @> jsonb_build_array(jsonb_build_object('project_id', $2, 'default', true))`,
		tenantID,
		projectID,
		input.BrandKitID,
		now,
	); err != nil {
		return BrandKit{}, err
	}
	tag, err := r.db.Exec(ctx, `
UPDATE brand_kits
SET project_bindings = CASE
	WHEN project_bindings @> jsonb_build_array(jsonb_build_object('project_id', $2))
	THEN (
		SELECT jsonb_agg(
			CASE
				WHEN binding->>'project_id' = $2 THEN jsonb_set(binding, '{default}', 'true'::jsonb, true)
				ELSE binding
			END
		)
		FROM jsonb_array_elements(project_bindings) AS binding
	)
	ELSE project_bindings || jsonb_build_array(jsonb_build_object('project_id', $2, 'default', true))
END,
status = CASE WHEN status = 'archived' THEN 'active' ELSE status END,
updated_at = $4
WHERE tenant_id = $1 AND id = $3`,
		tenantID,
		projectID,
		input.BrandKitID,
		now,
	)
	if err != nil {
		return BrandKit{}, err
	}
	if tag.RowsAffected() == 0 {
		return BrandKit{}, ErrNotFound
	}
	kit, err := r.GetBrandKit(ctx, tenantID, input.BrandKitID)
	if err != nil {
		return BrandKit{}, err
	}
	return kit, nil
}

func scanAssetLibraryEntryRow(row store.Row) (AssetLibraryEntry, error) {
	var entry AssetLibraryEntry
	var assetJSON []byte
	if err := row.Scan(
		&entry.ID,
		&assetJSON,
		&entry.Visibility,
		&entry.Favorite,
		&entry.Archived,
		&entry.Reusable,
		&entry.AllowedProjects,
		&entry.Tags,
		&entry.CreatedAt,
		&entry.UpdatedAt,
	); err != nil {
		return AssetLibraryEntry{}, err
	}
	_ = json.Unmarshal(assetJSON, &entry.Asset)
	entry.Asset = security.RedactMap(entry.Asset)
	return entry, nil
}

func normalizeAssetLibraryVisibility(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "tenant":
		return "tenant"
	case "private":
		return "private"
	default:
		return "project"
	}
}

func validateAssetLibraryWrite(visibility string, reusable bool, allowedProjects []string, tags []string) error {
	switch visibility {
	case "project", "tenant", "private":
	default:
		return errors.Join(ErrValidation, errors.New("visibility must be project, tenant, or private"))
	}
	if visibility == "private" && reusable {
		return errors.Join(ErrValidation, errors.New("private library entry cannot be reusable"))
	}
	if findings := security.ClassifyValue(map[string]any{
		"allowed_projects": allowedProjects,
		"tags":             tags,
	}); len(findings) > 0 {
		return errors.Join(ErrValidation, errors.New("asset library metadata contains secret-like material"))
	}
	return nil
}

func normalizeBrandKitStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "active":
		return "active"
	case "archived":
		return "archived"
	default:
		return "draft"
	}
}

func validateBrandKitWrite(name, status string, logos, palette, fonts, guidelines, sourceRefs, projectBindings []map[string]any) error {
	switch status {
	case "draft", "active", "archived":
	default:
		return errors.Join(ErrValidation, errors.New("status must be draft, active, or archived"))
	}
	if len(logos) == 0 {
		return errors.Join(ErrValidation, errors.New("at least one logo asset is required"))
	}
	if len(palette) == 0 {
		return errors.Join(ErrValidation, errors.New("at least one palette color is required"))
	}
	if findings := security.ClassifyValue(map[string]any{
		"name":             name,
		"logos":            logos,
		"palette":          palette,
		"fonts":            fonts,
		"guidelines":       guidelines,
		"source_refs":      sourceRefs,
		"project_bindings": projectBindings,
	}); len(findings) > 0 {
		return errors.Join(ErrValidation, errors.New("brand kit contains secret-like material"))
	}
	for _, logo := range logos {
		if strings.TrimSpace(stringFromMap(logo, "asset_id", "")) == "" {
			return errors.Join(ErrValidation, errors.New("logo asset_id is required"))
		}
	}
	for _, swatch := range palette {
		if !regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`).MatchString(strings.TrimSpace(stringFromMap(swatch, "hex", ""))) {
			return errors.Join(ErrValidation, errors.New("palette color must be #RRGGBB"))
		}
	}
	for _, font := range fonts {
		if strings.TrimSpace(stringFromMap(font, "family", "")) == "" {
			return errors.Join(ErrValidation, errors.New("font family is required"))
		}
	}
	for _, binding := range projectBindings {
		if strings.TrimSpace(stringFromMap(binding, "project_id", "")) == "" {
			return errors.Join(ErrValidation, errors.New("project binding project_id is required"))
		}
	}
	return nil
}

func normalizeProjectBindings(bindings []map[string]any) []map[string]any {
	seenDefault := map[string]bool{}
	out := make([]map[string]any, 0, len(bindings))
	for _, binding := range bindings {
		projectID := strings.TrimSpace(stringFromMap(binding, "project_id", ""))
		if projectID == "" {
			out = append(out, binding)
			continue
		}
		next := map[string]any{}
		for key, value := range binding {
			next[key] = value
		}
		next["project_id"] = projectID
		if boolFromMap(binding, "default") {
			if seenDefault[projectID] {
				next["default"] = false
			} else {
				next["default"] = true
				seenDefault[projectID] = true
			}
		}
		out = append(out, next)
	}
	return out
}

func normalizeStringList(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func scanBrandKitRows(rows store.Rows) (BrandKit, error) {
	var kit BrandKit
	var logosJSON, paletteJSON, fontsJSON, guidelinesJSON, sourceRefsJSON, projectBindingsJSON []byte
	if err := rows.Scan(
		&kit.ID,
		&kit.Name,
		&kit.Status,
		&logosJSON,
		&paletteJSON,
		&fontsJSON,
		&guidelinesJSON,
		&sourceRefsJSON,
		&projectBindingsJSON,
		&kit.CreatedAt,
		&kit.UpdatedAt,
	); err != nil {
		return BrandKit{}, err
	}
	return decodeBrandKitJSON(kit, logosJSON, paletteJSON, fontsJSON, guidelinesJSON, sourceRefsJSON, projectBindingsJSON), nil
}

func scanBrandKitRow(row store.Row) (BrandKit, error) {
	var kit BrandKit
	var logosJSON, paletteJSON, fontsJSON, guidelinesJSON, sourceRefsJSON, projectBindingsJSON []byte
	if err := row.Scan(
		&kit.ID,
		&kit.Name,
		&kit.Status,
		&logosJSON,
		&paletteJSON,
		&fontsJSON,
		&guidelinesJSON,
		&sourceRefsJSON,
		&projectBindingsJSON,
		&kit.CreatedAt,
		&kit.UpdatedAt,
	); err != nil {
		return BrandKit{}, err
	}
	return decodeBrandKitJSON(kit, logosJSON, paletteJSON, fontsJSON, guidelinesJSON, sourceRefsJSON, projectBindingsJSON), nil
}

func decodeBrandKitJSON(kit BrandKit, logosJSON, paletteJSON, fontsJSON, guidelinesJSON, sourceRefsJSON, projectBindingsJSON []byte) BrandKit {
	_ = json.Unmarshal(logosJSON, &kit.Logos)
	_ = json.Unmarshal(paletteJSON, &kit.Palette)
	_ = json.Unmarshal(fontsJSON, &kit.Fonts)
	_ = json.Unmarshal(guidelinesJSON, &kit.Guidelines)
	_ = json.Unmarshal(sourceRefsJSON, &kit.SourceRefs)
	_ = json.Unmarshal(projectBindingsJSON, &kit.ProjectBindings)
	kit.Name = security.RedactString(kit.Name)
	kit.Logos = redactMapSlice(kit.Logos)
	kit.Palette = redactMapSlice(kit.Palette)
	kit.Fonts = redactMapSlice(kit.Fonts)
	kit.Guidelines = redactMapSlice(kit.Guidelines)
	kit.SourceRefs = redactMapSlice(kit.SourceRefs)
	kit.ProjectBindings = redactMapSlice(kit.ProjectBindings)
	return kit
}

func redactMapSlice(values []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(values))
	for _, value := range values {
		out = append(out, security.RedactMap(value))
	}
	return out
}

func (r Repository) CleanupExpiredExportsAndOrphanedObjects(ctx context.Context, now time.Time, objectCleanup func(context.Context, time.Time) (int, error)) (CleanupResult, error) {
	return r.cleanupExpiredExportsAndOrphanedObjects(ctx, "", now, CleanupModeCombined, objectCleanup)
}

func (r Repository) CleanupExpiredExportsAndOrphanedObjectsForTenant(ctx context.Context, tenantID string, now time.Time, objectCleanup func(context.Context, time.Time) (int, error)) (CleanupResult, error) {
	return r.CleanupExpiredExportsAndOrphanedObjectsForTenantMode(ctx, tenantID, now, CleanupModeCombined, objectCleanup)
}

func (r Repository) CleanupExpiredExportsAndOrphanedObjectsForTenantMode(ctx context.Context, tenantID string, now time.Time, mode CleanupMode, objectCleanup func(context.Context, time.Time) (int, error)) (CleanupResult, error) {
	normalizedTenantID, err := normalizeCleanupTenantID(tenantID)
	if err != nil {
		return CleanupResult{}, err
	}
	return r.cleanupExpiredExportsAndOrphanedObjects(ctx, normalizedTenantID, now, mode, objectCleanup)
}

func (r Repository) cleanupExpiredExportsAndOrphanedObjects(ctx context.Context, tenantID string, now time.Time, mode CleanupMode, objectCleanup func(context.Context, time.Time) (int, error)) (CleanupResult, error) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	runExpired, runOrphan, err := cleanupModeFlags(mode)
	if err != nil {
		return CleanupResult{}, err
	}
	var expiredTag pgconn.CommandTag
	if runExpired {
		expiredTag, err = r.db.Exec(ctx, `
WITH expired AS (
	SELECT e.id, e.tenant_id, e.object_metadata_id
	FROM exports e
	JOIN object_metadata o ON o.tenant_id = e.tenant_id AND o.id = e.object_metadata_id
	WHERE e.status IN ('ready', 'failed', 'pending')
	  AND ($2 = '' OR e.tenant_id = $2)
	  AND o.retention_until IS NOT NULL
	  AND o.retention_until <= $1
),
expired_sources AS (
	SELECT id, tenant_id, retention_until
	FROM object_metadata
	WHERE retention_until IS NOT NULL
	  AND ($2 = '' OR tenant_id = $2)
	  AND retention_until <= $1
	  AND retention_state IN ('active', 'expired')
),
expired_objects AS (
	UPDATE object_metadata o
	SET retention_state = 'expired',
	    retention_until = COALESCE(o.retention_until, source.retention_until),
	    updated_at = $1
	FROM expired_sources source
	WHERE o.retention_state = 'active'
	  AND (
	    (o.id = source.id AND o.tenant_id = source.tenant_id)
	    OR (o.derived_from_object_id = source.id AND o.tenant_id = source.tenant_id)
	  )
	RETURNING o.id
)
UPDATE exports e
SET status = 'expired',
    delivery_metadata = delivery_metadata || jsonb_build_object('expired_at', $1::timestamptz),
    updated_at = $1
FROM expired
WHERE e.tenant_id = expired.tenant_id AND e.id = expired.id`,
			now,
			tenantID,
		)
		if err != nil {
			return CleanupResult{}, err
		}
	}
	var orphanedTag pgconn.CommandTag
	if runOrphan {
		orphanedTag, err = r.db.Exec(ctx, `
WITH orphaned_sources AS (
	SELECT o.id, o.tenant_id
	FROM object_metadata o
	WHERE o.retention_state = 'active'
	  AND o.asset_type = 'export'
	  AND ($2 = '' OR o.tenant_id = $2)
	  AND NOT EXISTS (
	    SELECT 1
	    FROM exports e
	    WHERE e.tenant_id = o.tenant_id AND e.object_metadata_id = o.id
	  )
)
UPDATE object_metadata o
SET retention_state = 'orphaned',
    updated_at = $1
FROM orphaned_sources source
WHERE o.retention_state = 'active'
  AND (
    (o.id = source.id AND o.tenant_id = source.tenant_id)
    OR (o.derived_from_object_id = source.id AND o.tenant_id = source.tenant_id)
  )`,
			now,
			tenantID,
		)
		if err != nil {
			return CleanupResult{}, err
		}
	}
	result := CleanupResult{
		ExpiredExports:  int(expiredTag.RowsAffected()),
		OrphanedObjects: int(orphanedTag.RowsAffected()),
	}
	if err := r.recordCleanupLifecycleAnalytics(ctx, now, tenantID); err != nil {
		return CleanupResult{}, err
	}
	if objectCleanup != nil {
		deleted, err := objectCleanup(ctx, now)
		if err != nil {
			return CleanupResult{}, err
		}
		result.DeletedObjects = deleted
		if err := r.recordCleanupRunAnalyticsForTenant(ctx, now, tenantID, result); err != nil {
			return CleanupResult{}, err
		}
		if err := r.recordCleanupRunAuditRefsForTenant(ctx, now, tenantID, result); err != nil {
			return CleanupResult{}, err
		}
	}
	result.Status = cleanupResultStatus(result, nil)
	return result, nil
}

func cleanupResultStatus(result CleanupResult, err error) string {
	if err != nil || result.FailedObjects > 0 {
		return "partial_failed"
	}
	return "completed"
}

func cleanupModeFlags(mode CleanupMode) (expiredExports bool, orphanedObjects bool, err error) {
	switch mode {
	case "", CleanupModeCombined:
		return true, true, nil
	case CleanupModeExpiredExports:
		return true, false, nil
	case CleanupModeOrphans:
		return false, true, nil
	default:
		return false, false, errors.Join(ErrValidation, fmt.Errorf("unsupported cleanup mode %q", mode))
	}
}

type CleanupObject struct {
	ID       string
	TenantID string
	Key      string
}

func (o CleanupObject) normalized() (CleanupObject, error) {
	object := CleanupObject{
		ID:       strings.TrimSpace(o.ID),
		TenantID: strings.TrimSpace(o.TenantID),
		Key:      strings.Trim(strings.TrimSpace(o.Key), "/"),
	}
	if object.ID == "" || object.TenantID == "" || object.Key == "" {
		return CleanupObject{}, errors.Join(ErrValidation, errors.New("cleanup object id, tenant_id, and object_key are required"))
	}
	if object.TenantID != strings.Trim(object.TenantID, "/") ||
		strings.ContainsAny(object.TenantID, `/\`) ||
		object.TenantID == "." ||
		object.TenantID == ".." ||
		!cleanupTenantIDPattern.MatchString(object.TenantID) {
		return CleanupObject{}, errors.Join(ErrValidation, errors.New("cleanup tenant_id is invalid"))
	}
	if strings.Contains(object.Key, "\\") || cleanupKeyHasUnsafeSegment(object.Key) {
		return CleanupObject{}, errors.Join(ErrValidation, errors.New("cleanup object key is invalid"))
	}
	expectedPrefix := "tenants/" + object.TenantID + "/"
	if !strings.HasPrefix(object.Key, expectedPrefix) {
		return CleanupObject{}, errors.Join(ErrValidation, errors.New("cleanup object key must match tenant scope"))
	}
	return object, nil
}

func cleanupKeyHasUnsafeSegment(key string) bool {
	for _, segment := range strings.Split(key, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return true
		}
	}
	return false
}

func normalizeCleanupTenantID(tenantID string) (string, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return "", errors.Join(ErrValidation, errors.New("tenant_id is required"))
	}
	if tenantID != strings.Trim(tenantID, "/") ||
		strings.ContainsAny(tenantID, `/\`) ||
		tenantID == "." ||
		tenantID == ".." ||
		!cleanupTenantIDPattern.MatchString(tenantID) {
		return "", errors.Join(ErrValidation, errors.New("tenant_id is invalid"))
	}
	return tenantID, nil
}

func (r Repository) ListCleanupObjects(ctx context.Context, now time.Time, limit int) ([]CleanupObject, error) {
	return r.listCleanupObjects(ctx, "", now, limit, CleanupModeCombined)
}

func (r Repository) ListCleanupObjectsForTenant(ctx context.Context, tenantID string, now time.Time, limit int) ([]CleanupObject, error) {
	return r.ListCleanupObjectsForTenantMode(ctx, tenantID, now, limit, CleanupModeCombined)
}

func (r Repository) ListCleanupObjectsForTenantMode(ctx context.Context, tenantID string, now time.Time, limit int, mode CleanupMode) ([]CleanupObject, error) {
	normalizedTenantID, err := normalizeCleanupTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	return r.listCleanupObjects(ctx, normalizedTenantID, now, limit, mode)
}

func (r Repository) PreviewCleanupObjectsForTenant(ctx context.Context, tenantID string, now time.Time, limit int) ([]CleanupObject, error) {
	return r.PreviewCleanupObjectsForTenantMode(ctx, tenantID, now, limit, CleanupModeCombined)
}

func (r Repository) PreviewCleanupObjectsForTenantMode(ctx context.Context, tenantID string, now time.Time, limit int, mode CleanupMode) ([]CleanupObject, error) {
	normalizedTenantID, err := normalizeCleanupTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	return r.previewCleanupObjects(ctx, normalizedTenantID, now, limit, mode)
}

func (r Repository) PreviewCleanupCountsForTenant(ctx context.Context, tenantID string, now time.Time) (expiredExports, orphanedObjects int, err error) {
	return r.PreviewCleanupCountsForTenantMode(ctx, tenantID, now, CleanupModeCombined)
}

func (r Repository) PreviewCleanupCountsForTenantMode(ctx context.Context, tenantID string, now time.Time, mode CleanupMode) (expiredExports, orphanedObjects int, err error) {
	normalizedTenantID, err := normalizeCleanupTenantID(tenantID)
	if err != nil {
		return 0, 0, err
	}
	modeValue, err := cleanupModeQueryValue(mode)
	if err != nil {
		return 0, 0, err
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	err = r.db.QueryRow(ctx, `
WITH expired_exports AS (
	SELECT e.id
	FROM exports e
	JOIN object_metadata o ON o.tenant_id = e.tenant_id AND o.id = e.object_metadata_id
	WHERE e.status IN ('ready', 'failed', 'pending')
	  AND e.tenant_id = $2
	  AND $3 IN ('combined', 'expired_export_cleanup')
	  AND o.retention_until IS NOT NULL
	  AND o.retention_until <= $1
),
orphaned_sources AS (
	SELECT o.id, o.tenant_id
	FROM object_metadata o
	WHERE o.retention_state = 'active'
	  AND o.asset_type = 'export'
	  AND o.tenant_id = $2
	  AND $3 IN ('combined', 'orphan_cleanup')
	  AND NOT EXISTS (
	    SELECT 1
	    FROM exports e
	    WHERE e.tenant_id = o.tenant_id AND e.object_metadata_id = o.id
	  )
),
orphaned_objects AS (
	SELECT o.id
	FROM object_metadata o
	JOIN orphaned_sources source ON (
	  (o.id = source.id AND o.tenant_id = source.tenant_id)
	  OR (o.derived_from_object_id = source.id AND o.tenant_id = source.tenant_id)
	)
	WHERE o.retention_state = 'active'
)
SELECT (SELECT COUNT(*) FROM expired_exports), (SELECT COUNT(*) FROM orphaned_objects)`,
		now,
		normalizedTenantID,
		modeValue,
	).Scan(&expiredExports, &orphanedObjects)
	return expiredExports, orphanedObjects, err
}

func (r Repository) listCleanupObjects(ctx context.Context, tenantID string, now time.Time, limit int, mode CleanupMode) ([]CleanupObject, error) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if limit <= 0 {
		limit = 100
	}
	modeValue, err := cleanupModeQueryValue(mode)
	if err != nil {
		return nil, err
	}
	rows, err := r.db.Query(ctx, `
SELECT id, tenant_id, object_key
FROM object_metadata
WHERE (
    ($4 = 'combined' AND retention_state IN ('expired', 'orphaned'))
    OR ($4 = 'expired_export_cleanup' AND retention_state = 'expired')
    OR ($4 = 'orphan_cleanup' AND retention_state = 'orphaned')
  )
  AND ($3 = '' OR tenant_id = $3)
  AND (
    retention_until IS NULL
    OR retention_until <= $1
  )
ORDER BY created_at ASC
LIMIT $2`,
		now,
		limit,
		tenantID,
		modeValue,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	objects := make([]CleanupObject, 0, limit)
	for rows.Next() {
		var object CleanupObject
		if err := rows.Scan(&object.ID, &object.TenantID, &object.Key); err != nil {
			return nil, err
		}
		normalized, err := object.normalized()
		if err != nil {
			return nil, err
		}
		objects = append(objects, normalized)
	}
	return objects, rows.Err()
}

func (r Repository) previewCleanupObjects(ctx context.Context, tenantID string, now time.Time, limit int, mode CleanupMode) ([]CleanupObject, error) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if limit <= 0 {
		limit = 100
	}
	modeValue, err := cleanupModeQueryValue(mode)
	if err != nil {
		return nil, err
	}
	rows, err := r.db.Query(ctx, `
WITH expired_sources AS (
	SELECT id, tenant_id
	FROM object_metadata
	WHERE retention_until IS NOT NULL
	  AND tenant_id = $3
	  AND $4 IN ('combined', 'expired_export_cleanup')
	  AND retention_until <= $1
	  AND retention_state IN ('active', 'expired')
),
orphaned_sources AS (
	SELECT o.id, o.tenant_id
	FROM object_metadata o
	WHERE o.retention_state = 'active'
	  AND o.asset_type = 'export'
	  AND o.tenant_id = $3
	  AND $4 IN ('combined', 'orphan_cleanup')
	  AND NOT EXISTS (
	    SELECT 1
	    FROM exports e
	    WHERE e.tenant_id = o.tenant_id AND e.object_metadata_id = o.id
	  )
),
cleanup_candidates AS (
	SELECT o.id, o.tenant_id, o.object_key
	FROM object_metadata o
	JOIN expired_sources source ON (
	  (o.id = source.id AND o.tenant_id = source.tenant_id)
	  OR (o.derived_from_object_id = source.id AND o.tenant_id = source.tenant_id)
	)
	WHERE o.retention_state IN ('active', 'expired')
	UNION
	SELECT o.id, o.tenant_id, o.object_key
	FROM object_metadata o
	JOIN orphaned_sources source ON (
	  (o.id = source.id AND o.tenant_id = source.tenant_id)
	  OR (o.derived_from_object_id = source.id AND o.tenant_id = source.tenant_id)
	)
	WHERE o.retention_state = 'active'
)
SELECT id, tenant_id, object_key
FROM cleanup_candidates
ORDER BY id ASC
LIMIT $2`,
		now,
		limit,
		tenantID,
		modeValue,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	objects := make([]CleanupObject, 0, limit)
	for rows.Next() {
		var object CleanupObject
		if err := rows.Scan(&object.ID, &object.TenantID, &object.Key); err != nil {
			return nil, err
		}
		normalized, err := object.normalized()
		if err != nil {
			return nil, err
		}
		objects = append(objects, normalized)
	}
	return objects, rows.Err()
}

func cleanupModeQueryValue(mode CleanupMode) (string, error) {
	switch mode {
	case "", CleanupModeCombined:
		return string(CleanupModeCombined), nil
	case CleanupModeExpiredExports, CleanupModeOrphans:
		return string(mode), nil
	default:
		return "", errors.Join(ErrValidation, fmt.Errorf("unsupported cleanup mode %q", mode))
	}
}

func (r Repository) MarkCleanupObjectsDeleted(ctx context.Context, objects []CleanupObject, now time.Time) (int, error) {
	if len(objects) == 0 {
		return 0, nil
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	payload := make([]map[string]string, 0, len(objects))
	for _, object := range objects {
		normalized, err := object.normalized()
		if err != nil {
			return 0, err
		}
		payload = append(payload, map[string]string{
			"id":         normalized.ID,
			"tenant_id":  normalized.TenantID,
			"object_key": normalized.Key,
		})
	}
	tag, err := r.db.Exec(ctx, `
WITH deleted_candidates AS (
	SELECT id, tenant_id, object_key
	FROM jsonb_to_recordset($1::jsonb) AS item(id text, tenant_id text, object_key text)
)
UPDATE object_metadata
SET retention_state = 'deleted',
    metadata = metadata || jsonb_build_object(
      'deleted_at', $2::timestamptz,
      'cleanup_ack_scope', 'tenant_id+object_key'
    ),
    updated_at = $2
FROM deleted_candidates
WHERE object_metadata.id = deleted_candidates.id
  AND object_metadata.tenant_id = deleted_candidates.tenant_id
  AND object_metadata.object_key = deleted_candidates.object_key
  AND retention_state IN ('expired', 'orphaned')`,
		jsonValue(payload),
		now,
	)
	if err != nil {
		return 0, err
	}
	deleted := int(tag.RowsAffected())
	if err := r.recordDeletedObjectAnalytics(ctx, objects, now); err != nil {
		return 0, err
	}
	return deleted, nil
}

func (r Repository) recordCleanupLifecycleAnalytics(ctx context.Context, now time.Time, tenantID string) error {
	_, err := r.db.Exec(ctx, `
WITH expired_export_events AS (
	INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
	SELECT
		'analytics_' || md5(e.tenant_id || ':' || e.id || ':export_expired'),
		e.tenant_id,
		p.created_by,
		e.project_id,
		COALESCE(pr.workflow_id, ''),
		'export_expired',
		'export',
		e.id,
		jsonb_build_object(
			'package_id', e.package_id,
			'object_metadata_id', COALESCE(e.object_metadata_id, ''),
			'format', e.format,
			'retention_state', 'expired'
		),
		$1
	FROM exports e
	LEFT JOIN packages p ON p.tenant_id = e.tenant_id AND p.id = e.package_id
	LEFT JOIN projects pr ON pr.tenant_id = e.tenant_id AND pr.id = e.project_id
	WHERE e.status = 'expired'
	  AND e.updated_at = $1
	  AND ($2 = '' OR e.tenant_id = $2)
	ON CONFLICT (id) DO NOTHING
	RETURNING 1
),
orphaned_object_events AS (
	INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
	SELECT
		'analytics_' || md5(o.tenant_id || ':' || o.id || ':object_orphaned'),
		o.tenant_id,
		o.owner_id,
		o.project_id,
		COALESCE(pr.workflow_id, ''),
		'object_orphaned',
		'object_metadata',
		o.id,
		jsonb_build_object(
			'asset_type', o.asset_type,
			'bucket', o.bucket,
			'retention_state', o.retention_state,
			'derived_from_object_id', COALESCE(o.derived_from_object_id, '')
		),
		$1
	FROM object_metadata o
	LEFT JOIN projects pr ON pr.tenant_id = o.tenant_id AND pr.id = o.project_id
	WHERE o.retention_state = 'orphaned'
	  AND o.updated_at = $1
	  AND ($2 = '' OR o.tenant_id = $2)
	ON CONFLICT (id) DO NOTHING
	RETURNING 1
)
SELECT 1`, now, tenantID)
	return err
}

func (r Repository) recordDeletedObjectAnalytics(ctx context.Context, objects []CleanupObject, now time.Time) error {
	if len(objects) == 0 {
		return nil
	}
	payload := make([]map[string]string, 0, len(objects))
	for _, object := range objects {
		payload = append(payload, map[string]string{
			"id":         strings.TrimSpace(object.ID),
			"tenant_id":  strings.TrimSpace(object.TenantID),
			"object_key": strings.TrimSpace(object.Key),
		})
	}
	_, err := r.db.Exec(ctx, `
WITH deleted_candidates AS (
	SELECT id, tenant_id, object_key
	FROM jsonb_to_recordset($1::jsonb) AS item(id text, tenant_id text, object_key text)
)
INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
SELECT
	'analytics_' || md5(o.tenant_id || ':' || o.id || ':object_deleted'),
	o.tenant_id,
	o.owner_id,
	o.project_id,
	COALESCE(pr.workflow_id, ''),
	'object_deleted',
	'object_metadata',
	o.id,
	jsonb_build_object(
		'asset_type', o.asset_type,
		'bucket', o.bucket,
		'object_key', o.object_key,
		'retention_state', o.retention_state,
		'derived_from_object_id', COALESCE(o.derived_from_object_id, ''),
		'cleanup_ack_scope', 'tenant_id+object_key'
	),
	$2
FROM object_metadata o
LEFT JOIN projects pr ON pr.tenant_id = o.tenant_id AND pr.id = o.project_id
JOIN deleted_candidates ON deleted_candidates.id = o.id
  AND deleted_candidates.tenant_id = o.tenant_id
  AND deleted_candidates.object_key = o.object_key
WHERE o.retention_state = 'deleted'
  AND o.updated_at = $2
ON CONFLICT (id) DO NOTHING`,
		jsonValue(payload),
		now,
	)
	return err
}

func (r Repository) recordCleanupRunAnalytics(ctx context.Context, now time.Time, result CleanupResult) error {
	return r.recordCleanupRunAnalyticsForTenant(ctx, now, "", result)
}

func (r Repository) recordCleanupRunAnalyticsForTenant(ctx context.Context, now time.Time, tenantID string, result CleanupResult) error {
	if result.ExpiredExports == 0 && result.OrphanedObjects == 0 && result.DeletedObjects == 0 && result.FailedObjects == 0 {
		return nil
	}
	status := cleanupResultStatus(result, nil)
	_, err := r.db.Exec(ctx, `
WITH cleanup_counts AS (
	SELECT
		tenant_id,
		COUNT(*) FILTER (WHERE event_name = 'export_expired') AS export_expired,
		COUNT(*) FILTER (WHERE event_name = 'object_orphaned') AS object_orphaned,
		COUNT(*) FILTER (WHERE event_name = 'object_deleted') AS object_deleted
	FROM analytics_events
	WHERE created_at = $1
	  AND event_name IN ('export_expired', 'object_orphaned', 'object_deleted')
	  AND ($7 = '' OR tenant_id = $7)
	GROUP BY tenant_id
),
cleanup_scope AS (
	SELECT tenant_id, export_expired, object_orphaned, object_deleted
	FROM cleanup_counts
	UNION ALL
	SELECT $7, 0, 0, $4
	WHERE ($4 > 0 OR $5 > 0)
	  AND $7 <> ''
	  AND NOT EXISTS (SELECT 1 FROM cleanup_counts WHERE tenant_id = $7)
)
INSERT INTO analytics_events(id, tenant_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
SELECT
	'analytics_' || md5(tenant_id || ':' || $1::text || ':export_object_cleanup_run'),
	tenant_id,
	'',
	'export_object_cleanup_run',
	'object_retention_cleanup',
	'cleanup_' || md5(tenant_id || ':' || $1::text),
	jsonb_build_object(
		'cleanup_status', $6,
		'expired_exports', export_expired,
		'orphaned_objects', object_orphaned,
		'deleted_objects', object_deleted,
		'failed_objects', $5,
		'worker_batch_expired_exports', $2,
		'worker_batch_orphaned_objects', $3,
		'worker_batch_deleted_objects', $4
	),
	$1
FROM cleanup_scope
WHERE export_expired > 0 OR object_orphaned > 0 OR object_deleted > 0 OR $5 > 0
ON CONFLICT (id) DO NOTHING`,
		now,
		result.ExpiredExports,
		result.OrphanedObjects,
		result.DeletedObjects,
		result.FailedObjects,
		status,
		tenantID,
	)
	return err
}

func (r Repository) recordCleanupRunAuditRefsForTenant(ctx context.Context, now time.Time, tenantID string, result CleanupResult) error {
	if result.ExpiredExports == 0 && result.OrphanedObjects == 0 && result.DeletedObjects == 0 && result.FailedObjects == 0 {
		return nil
	}
	status := cleanupResultStatus(result, nil)
	_, err := r.db.Exec(ctx, `
WITH cleanup_counts AS (
	SELECT
		tenant_id,
		COUNT(*) FILTER (WHERE event_name = 'export_expired') AS export_expired,
		COUNT(*) FILTER (WHERE event_name = 'object_orphaned') AS object_orphaned,
		COUNT(*) FILTER (WHERE event_name = 'object_deleted') AS object_deleted
	FROM analytics_events
	WHERE created_at = $1
	  AND event_name IN ('export_expired', 'object_orphaned', 'object_deleted')
	  AND ($7 = '' OR tenant_id = $7)
	GROUP BY tenant_id
),
cleanup_scope AS (
	SELECT tenant_id, export_expired, object_orphaned, object_deleted
	FROM cleanup_counts
	UNION ALL
	SELECT $7, 0, 0, $4
	WHERE ($4 > 0 OR $5 > 0)
	  AND $7 <> ''
	  AND NOT EXISTS (SELECT 1 FROM cleanup_counts WHERE tenant_id = $7)
)
INSERT INTO audit_logs(id, tenant_id, actor_id, action, resource, metadata, created_at)
SELECT
	'audit_' || md5(tenant_id || ':' || $1::text || ':export_object_cleanup_run'),
	tenant_id,
	'system:object-retention-cleanup',
	'export.cleanup',
	'object_retention_cleanup',
	jsonb_build_object(
		'audit_ref_kind', 'object_retention_cleanup_run',
		'cleanup_status', $6,
		'expired_exports', export_expired,
		'orphaned_objects', object_orphaned,
		'deleted_objects', object_deleted,
		'failed_objects', $5,
		'worker_batch_expired_exports', $2,
		'worker_batch_orphaned_objects', $3,
		'worker_batch_deleted_objects', $4,
		'cleanup_ack_scope', 'tenant_id+object_key'
	),
	$1
FROM cleanup_scope
WHERE export_expired > 0 OR object_orphaned > 0 OR object_deleted > 0 OR $5 > 0
ON CONFLICT (id) DO NOTHING`,
		now,
		result.ExpiredExports,
		result.OrphanedObjects,
		result.DeletedObjects,
		result.FailedObjects,
		status,
		tenantID,
	)
	return err
}

func (r Repository) RegenerateExport(ctx context.Context, tenantID, exportID string) (Export, error) {
	export, err := r.GetExport(ctx, tenantID, exportID)
	if err != nil {
		return Export{}, err
	}
	blocked, err := r.hasBlockingExportQA(ctx, tenantID, export.PackageID)
	if err != nil {
		return Export{}, err
	}
	if blocked {
		return Export{}, ErrSafetyBlocked
	}
	if _, err := r.RunRuntimeSafetyPolicy(ctx, RuntimeSafetyPolicyInput{
		TenantID:      tenantID,
		ProjectID:     stringValue(export.ProjectID),
		QASubjectType: "package",
		QASubjectID:   export.PackageID,
		ExportID:      exportID,
	}); err != nil {
		return Export{}, err
	}
	now := time.Now().UTC()
	_, err = r.db.Exec(ctx, `
UPDATE exports
SET status = 'pending', qa_status = 'pending', error = NULL, updated_at = $3
WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		exportID,
		now,
	)
	if err != nil {
		return Export{}, err
	}
	if err := r.RecordAnalyticsEvent(ctx, AnalyticsEvent{
		TenantID:    tenantID,
		ProjectID:   stringValue(export.ProjectID),
		EventName:   "export_regenerated",
		SubjectType: "export",
		SubjectID:   exportID,
		Properties: map[string]any{
			"package_id": export.PackageID,
			"format":     export.Format,
		},
		CreatedAt: now,
	}); err != nil {
		return Export{}, err
	}
	export.Status = "pending"
	export.QAStatus = "pending"
	export.Error = nil
	export.UpdatedAt = now
	export.RegeneratedAt = &now
	return export, nil
}

func (r Repository) CreateSupportTicket(ctx context.Context, tenantID, userID string, input SupportTicketCreate) (SupportTicket, error) {
	tenantID = strings.TrimSpace(tenantID)
	userID = strings.TrimSpace(userID)
	if tenantID == "" || userID == "" {
		return SupportTicket{}, errors.Join(ErrValidation, errors.New("tenant_id and user_id are required"))
	}
	normalized, err := support.NormalizeAndRedact(input.Category, input.Body, support.TicketEvidence{
		ProjectID:          input.ProjectID,
		TaskID:             input.TaskID,
		BatchID:            input.BatchID,
		TraceID:            input.TraceID,
		AssetID:            input.AssetID,
		LinkedExportID:     input.LinkedExportID,
		QuotaBucketID:      input.QuotaBucketID,
		BillingReferenceID: input.BillingRefID,
	}, input.Metadata)
	if err != nil {
		if errors.Is(err, support.ErrMissingEvidence) {
			return SupportTicket{}, errors.Join(ErrValidation, errors.New("project_id, task_id, batch_id, trace_id, asset_id, linked_export_id, quota_bucket_id, and billing_reference_id are required"))
		}
		return SupportTicket{}, err
	}
	if normalized.Category == "" || normalized.Body == "" {
		return SupportTicket{}, errors.Join(ErrValidation, errors.New("category and body are required"))
	}
	now := time.Now().UTC()
	ticket := SupportTicket{
		ID:        id.New("support"),
		TenantID:  tenantID,
		UserID:    userID,
		Category:  normalized.Category,
		Status:    "open",
		Body:      normalized.Body,
		Metadata:  normalized.Metadata,
		CreatedAt: now,
		UpdatedAt: now,
	}
	projectID := normalized.Evidence.ProjectID
	taskID := normalized.Evidence.TaskID
	batchID := normalized.Evidence.BatchID
	traceID := normalized.Evidence.TraceID
	assetID := normalized.Evidence.AssetID
	exportID := normalized.Evidence.LinkedExportID
	quotaBucketID := normalized.Evidence.QuotaBucketID
	billingRefID := normalized.Evidence.BillingReferenceID
	ticket.ProjectID = &projectID
	ticket.TaskID = &taskID
	ticket.BatchID = &batchID
	ticket.TraceID = &traceID
	ticket.AssetID = &assetID
	ticket.LinkedExportID = &exportID
	ticket.QuotaBucketID = &quotaBucketID
	ticket.BillingRefID = &billingRefID
	_, err = r.db.Exec(ctx, `
INSERT INTO support_tickets(id, tenant_id, user_id, project_id, task_id, batch_id, trace_id, asset_id, category, status, body, linked_export_id, quota_bucket_id, billing_reference_id, metadata, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
		ticket.ID,
		ticket.TenantID,
		ticket.UserID,
		ticket.ProjectID,
		ticket.TaskID,
		ticket.BatchID,
		ticket.TraceID,
		ticket.AssetID,
		ticket.Category,
		ticket.Status,
		ticket.Body,
		ticket.LinkedExportID,
		ticket.QuotaBucketID,
		ticket.BillingRefID,
		jsonObject(ticket.Metadata),
		now,
	)
	if err != nil {
		return SupportTicket{}, err
	}
	analyticsProperties := normalized.Evidence.AnalyticsProperties(ticket.Metadata)
	analyticsProperties["category"] = ticket.Category
	if err := r.RecordAnalyticsEvent(ctx, AnalyticsEvent{
		TenantID:    tenantID,
		UserID:      userID,
		ProjectID:   stringValue(ticket.ProjectID),
		EventName:   "support_ticket_created",
		SubjectType: "support_ticket",
		SubjectID:   ticket.ID,
		Properties:  analyticsProperties,
		CreatedAt:   now,
	}); err != nil {
		return SupportTicket{}, err
	}
	return ticket, nil
}

func (r Repository) ListSupportTickets(ctx context.Context, tenantID, status string, limit int) (Page[SupportTicket], error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{tenantID, limit}
	query := `
SELECT id, tenant_id, user_id, project_id, task_id, batch_id, trace_id, asset_id, category, status, body, linked_export_id, quota_bucket_id, billing_reference_id, metadata, created_at, updated_at
FROM support_tickets
WHERE tenant_id = $1`
	if strings.TrimSpace(status) != "" {
		query += " AND status = $3"
		args = append(args, strings.TrimSpace(status))
	}
	query += " ORDER BY updated_at DESC LIMIT $2"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[SupportTicket]{}, err
	}
	defer rows.Close()

	var page Page[SupportTicket]
	for rows.Next() {
		var ticket SupportTicket
		var metadataJSON []byte
		if err := rows.Scan(&ticket.ID, &ticket.TenantID, &ticket.UserID, &ticket.ProjectID, &ticket.TaskID, &ticket.BatchID, &ticket.TraceID, &ticket.AssetID, &ticket.Category, &ticket.Status, &ticket.Body, &ticket.LinkedExportID, &ticket.QuotaBucketID, &ticket.BillingRefID, &metadataJSON, &ticket.CreatedAt, &ticket.UpdatedAt); err != nil {
			return Page[SupportTicket]{}, err
		}
		_ = json.Unmarshal(metadataJSON, &ticket.Metadata)
		ticket.Body = security.RedactString(ticket.Body)
		ticket.Metadata = security.RedactMap(ticket.Metadata)
		page.Items = append(page.Items, ticket)
	}
	return page, rows.Err()
}

func (r Repository) ListCrawlerSources(ctx context.Context, tenantID, status string, limit int) (Page[CrawlerSource], error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{strings.TrimSpace(tenantID), limit}
	query := `
SELECT id, tenant_id, name, url, approval_status, legal_metadata, robots_policy, created_at, updated_at
FROM crawler_sources
WHERE (tenant_id IS NULL OR tenant_id = $1)`
	if strings.TrimSpace(status) != "" {
		query += " AND approval_status = $3"
		args = append(args, strings.TrimSpace(status))
	}
	query += " ORDER BY updated_at DESC LIMIT $2"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[CrawlerSource]{}, err
	}
	defer rows.Close()

	var page Page[CrawlerSource]
	for rows.Next() {
		var source CrawlerSource
		var legalJSON, robotsJSON []byte
		if err := rows.Scan(&source.ID, &source.TenantID, &source.Name, &source.URL, &source.ApprovalStatus, &legalJSON, &robotsJSON, &source.CreatedAt, &source.UpdatedAt); err != nil {
			return Page[CrawlerSource]{}, err
		}
		source.URL = security.RedactString(source.URL)
		_ = json.Unmarshal(legalJSON, &source.LegalMetadata)
		_ = json.Unmarshal(robotsJSON, &source.RobotsPolicy)
		source.LegalMetadata = security.RedactMap(source.LegalMetadata)
		source.RobotsPolicy = security.RedactMap(source.RobotsPolicy)
		page.Items = append(page.Items, source)
	}
	return page, rows.Err()
}

func (r Repository) ListCrawlerFindings(ctx context.Context, tenantID, status string, limit int) (Page[CrawlerFinding], error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{strings.TrimSpace(tenantID), limit}
	query := `
SELECT id, tenant_id, document_id, finding_type, status, payload, provenance, created_at
FROM crawler_findings
WHERE (tenant_id IS NULL OR tenant_id = $1)`
	if strings.TrimSpace(status) != "" {
		query += " AND status = $3"
		args = append(args, strings.TrimSpace(status))
	}
	query += " ORDER BY created_at DESC LIMIT $2"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[CrawlerFinding]{}, err
	}
	defer rows.Close()

	var page Page[CrawlerFinding]
	for rows.Next() {
		var finding CrawlerFinding
		var payloadJSON, provenanceJSON []byte
		if err := rows.Scan(&finding.ID, &finding.TenantID, &finding.DocumentID, &finding.FindingType, &finding.Status, &payloadJSON, &provenanceJSON, &finding.CreatedAt); err != nil {
			return Page[CrawlerFinding]{}, err
		}
		_ = json.Unmarshal(payloadJSON, &finding.Payload)
		_ = json.Unmarshal(provenanceJSON, &finding.Provenance)
		finding.Payload = security.RedactMap(finding.Payload)
		finding.Provenance = security.RedactMap(finding.Provenance)
		page.Items = append(page.Items, finding)
	}
	return page, rows.Err()
}

func (r Repository) StartCrawlerRun(ctx context.Context, tenantID, sourceID string, policy CrawlerPolicy) (CrawlerRun, error) {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return CrawlerRun{}, errors.Join(ErrValidation, errors.New("source_id is required"))
	}
	if err := validateCrawlerPolicy(policy); err != nil {
		return CrawlerRun{}, err
	}
	source, err := r.getCrawlerSource(ctx, tenantID, sourceID)
	if err != nil {
		return CrawlerRun{}, err
	}
	now := time.Now().UTC()
	if err := enforceCrawlerSourcePolicy(ctx, source, policy); err != nil {
		return CrawlerRun{}, err
	}
	if err := r.enforceCrawlerRateLimit(ctx, source.ID, policy, now); err != nil {
		return CrawlerRun{}, err
	}
	run := CrawlerRun{
		ID:        id.New("crawler_run"),
		TenantID:  source.TenantID,
		SourceID:  source.ID,
		Status:    "running",
		StartedAt: now,
		CreatedAt: now,
		Summary: security.RedactMap(map[string]any{
			"user_agent":         policy.UserAgent,
			"global_rps":         policy.GlobalRPS,
			"source_rps":         policy.SourceRPS,
			"raw_retention_days": policy.RawRetentionDays,
			"robots_policy":      source.RobotsPolicy,
		}),
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO crawler_runs(id, tenant_id, source_id, status, started_at, summary, created_at)
VALUES($1, $2, $3, 'running', $4, $5, $4)`,
		run.ID,
		run.TenantID,
		run.SourceID,
		run.StartedAt,
		jsonObject(run.Summary),
	)
	if err != nil {
		return CrawlerRun{}, err
	}
	return run, nil
}

func (r Repository) ImportCrawlerFinding(ctx context.Context, input CrawlerImport, policy CrawlerPolicy) (CrawlerImportResult, error) {
	if err := validateCrawlerPolicy(policy); err != nil {
		return CrawlerImportResult{}, err
	}
	runID := strings.TrimSpace(input.RunID)
	sourceID := strings.TrimSpace(input.SourceID)
	documentURL := strings.TrimSpace(input.DocumentURL)
	contentHash := strings.TrimSpace(input.ContentHash)
	findingType := strings.TrimSpace(input.FindingType)
	if runID == "" || sourceID == "" || documentURL == "" || contentHash == "" || findingType == "" {
		return CrawlerImportResult{}, errors.Join(ErrValidation, errors.New("run_id, source_id, url, content_hash, and finding_type are required"))
	}
	if policy.RawRetentionDays <= 0 {
		return CrawlerImportResult{}, errors.Join(ErrValidation, errors.New("raw retention policy is required"))
	}
	provenance := security.RedactMap(input.Provenance)
	if !crawlerProvenanceComplete(provenance) {
		return CrawlerImportResult{}, errors.Join(ErrValidation, errors.New("crawler import provenance must include source_url, fetched_at, robots_policy, and content_hash"))
	}
	if !crawlerProvenanceMatchesImport(provenance, documentURL, contentHash) {
		return CrawlerImportResult{}, errors.Join(ErrValidation, errors.New("crawler import provenance must match the imported document URL and content hash"))
	}
	source, err := r.getCrawlerSource(ctx, input.TenantID, sourceID)
	if err != nil {
		return CrawlerImportResult{}, err
	}
	if err := enforceCrawlerSourcePolicy(ctx, source, policy); err != nil {
		return CrawlerImportResult{}, err
	}
	if err := enforceCrawlerDocumentURL(ctx, source, documentURL, policy); err != nil {
		return CrawlerImportResult{}, err
	}
	payload := security.RedactMap(input.FindingPayload)
	status := "pending_review"
	if findingType == "exact_text" {
		payload["warning"] = "exact-text import requires review before use"
	}
	now := time.Now().UTC()
	retentionUntil := now.Add(time.Duration(policy.RawRetentionDays) * 24 * time.Hour)
	documentID := id.New("crawler_doc")
	findingID := id.New("crawler_finding")
	err = r.db.QueryRow(ctx, `
INSERT INTO crawler_documents(id, tenant_id, run_id, source_id, url, content_hash, retention_until, metadata, created_at)
VALUES($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (source_id, content_hash) DO UPDATE
SET retention_until = LEAST(COALESCE(crawler_documents.retention_until, EXCLUDED.retention_until), EXCLUDED.retention_until),
    metadata = crawler_documents.metadata || EXCLUDED.metadata
RETURNING id`,
		documentID,
		strings.TrimSpace(input.TenantID),
		runID,
		sourceID,
		documentURL,
		contentHash,
		retentionUntil,
		jsonObject(security.RedactMap(input.Metadata)),
		now,
	).Scan(&documentID)
	if err != nil {
		return CrawlerImportResult{}, err
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO crawler_findings(id, tenant_id, document_id, finding_type, status, payload, provenance, created_at)
VALUES($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8)`,
		findingID,
		strings.TrimSpace(input.TenantID),
		documentID,
		findingType,
		status,
		jsonObject(payload),
		jsonObject(provenance),
		now,
	)
	if err != nil {
		return CrawlerImportResult{}, err
	}
	return CrawlerImportResult{DocumentID: documentID, FindingID: findingID, RetentionUntil: retentionUntil}, nil
}

func (r Repository) ListSafetyRules(ctx context.Context, tenantID, status string, limit int) (Page[SafetyRule], error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{strings.TrimSpace(tenantID), limit}
	query := `
SELECT id, tenant_id, rule_key, version, domain, severity, action, enforcement_points, status, created_at
FROM safety_rules
WHERE (tenant_id IS NULL OR tenant_id = $1)`
	if strings.TrimSpace(status) != "" {
		query += " AND status = $3"
		args = append(args, strings.TrimSpace(status))
	}
	query += " ORDER BY created_at DESC LIMIT $2"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[SafetyRule]{}, err
	}
	defer rows.Close()

	var page Page[SafetyRule]
	for rows.Next() {
		var rule SafetyRule
		var pointsJSON []byte
		if err := rows.Scan(&rule.ID, &rule.TenantID, &rule.RuleKey, &rule.Version, &rule.Domain, &rule.Severity, &rule.Action, &pointsJSON, &rule.Status, &rule.CreatedAt); err != nil {
			return Page[SafetyRule]{}, err
		}
		_ = json.Unmarshal(pointsJSON, &rule.EnforcementPoints)
		page.Items = append(page.Items, rule)
	}
	return page, rows.Err()
}

func (r Repository) ListSafetyReviewQueue(ctx context.Context, tenantID, status string, limit int) (Page[SafetyReviewItem], error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return Page[SafetyReviewItem]{}, errors.Join(ErrValidation, errors.New("tenant_id is required"))
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	status = strings.TrimSpace(status)
	rows, err := r.db.Query(ctx, `
SELECT
	sd.id,
	sd.tenant_id,
	sd.rule_id,
	sd.subject_type,
	sd.subject_id,
	sd.enforcement_point,
	sd.decision,
	sd.rationale,
	COALESCE(sr.rule_key, ''),
	COALESCE(sr.version, ''),
	COALESCE(sr.severity, CASE sd.decision WHEN 'block' THEN 'high' WHEN 'require_admin_review' THEN 'medium' ELSE 'low' END),
	COALESCE(review.decision, 'pending') AS review_status,
	COALESCE(review.decision, '') AS review_decision,
	COALESCE(review.reviewer_id, '') AS reviewer_id,
	COALESCE(review.rationale, '') AS review_rationale,
	COALESCE(review.audit_ref, '') AS audit_ref,
	sd.created_at,
	review.created_at AS reviewed_at
FROM safety_decisions sd
LEFT JOIN safety_rules sr ON sr.id = sd.rule_id
LEFT JOIN LATERAL (
	SELECT decision, reviewer_id, rationale, audit_ref, created_at
	FROM safety_review_decisions
	WHERE tenant_id = sd.tenant_id AND safety_decision_id = sd.id
	ORDER BY created_at DESC, id DESC
	LIMIT 1
) review ON true
WHERE sd.tenant_id = $1
  AND sd.decision IN ('warn', 'require_admin_review', 'block')
  AND ($3 = '' OR COALESCE(review.decision, 'pending') = $3)
ORDER BY sd.created_at DESC, sd.id DESC
LIMIT $2`,
		tenantID,
		limit,
		status,
	)
	if err != nil {
		return Page[SafetyReviewItem]{}, err
	}
	defer rows.Close()

	page := Page[SafetyReviewItem]{Items: []SafetyReviewItem{}}
	for rows.Next() {
		var item SafetyReviewItem
		var reviewedAt *time.Time
		if err := rows.Scan(
			&item.SafetyDecisionID,
			&item.TenantID,
			&item.RuleID,
			&item.SubjectType,
			&item.SubjectID,
			&item.EnforcementPoint,
			&item.SafetyDecision,
			&item.SafetyRationale,
			&item.RuleKey,
			&item.RuleVersion,
			&item.Severity,
			&item.ReviewStatus,
			&item.ReviewDecision,
			&item.ReviewerID,
			&item.ReviewRationale,
			&item.AuditRef,
			&item.CreatedAt,
			&reviewedAt,
		); err != nil {
			return Page[SafetyReviewItem]{}, err
		}
		item.ID = "safety_review_" + item.SafetyDecisionID
		item.ReviewedAt = reviewedAt
		item.OverrideEligible = safetyReviewOverrideEligible(item.SafetyDecision)
		item.AuditRequired = true
		item.RequiredEvidence = safetyReviewRequiredEvidenceRefs(item)
		item.UserVisibleOutcome = safetyReviewUserVisibleOutcome(item.SafetyDecision, item.ReviewStatus)
		item.SafeProjection = safetyReviewSafeProjection(item)
		page.Items = append(page.Items, item)
	}
	return page, rows.Err()
}

func (r Repository) RecordSafetyReviewDecision(ctx context.Context, input SafetyReviewDecisionInput) (SafetyReviewDecision, error) {
	input.normalize()
	if err := input.validate(); err != nil {
		return SafetyReviewDecision{}, err
	}
	if existing, ok, err := r.existingSafetyReviewDecision(ctx, input.TenantID, input.IdempotencyKey); err != nil || ok {
		return existing, err
	}
	if err := r.ensureSafetyDecisionBelongsToTenant(ctx, input.TenantID, input.SafetyDecisionID); err != nil {
		return SafetyReviewDecision{}, err
	}
	metadata := security.RedactMap(input.Metadata)
	encoded, err := json.Marshal(metadata)
	if err != nil {
		return SafetyReviewDecision{}, err
	}
	record := SafetyReviewDecision{
		ID:                 id.New("safety_review"),
		TenantID:           input.TenantID,
		SafetyDecisionID:   input.SafetyDecisionID,
		ReviewerID:         input.ReviewerID,
		Decision:           input.Decision,
		Rationale:          input.Rationale,
		AuditRef:           input.AuditRef,
		IdempotencyKey:     input.IdempotencyKey,
		Metadata:           metadata,
		CreatedAt:          input.CreatedAt,
		UserVisibleOutcome: safetyReviewUserVisibleOutcomeForDecision(input.Decision),
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO safety_review_decisions(id, tenant_id, safety_decision_id, reviewer_id, decision, rationale, audit_ref, idempotency_key, metadata, created_at)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		record.ID,
		record.TenantID,
		record.SafetyDecisionID,
		record.ReviewerID,
		record.Decision,
		record.Rationale,
		record.AuditRef,
		record.IdempotencyKey,
		encoded,
		record.CreatedAt,
	)
	if err != nil {
		return SafetyReviewDecision{}, err
	}
	return record, nil
}

func (r Repository) EnforceSafety(ctx context.Context, tenantID, subjectType, subjectID, point string) (SafetyDecision, error) {
	tenantID = strings.TrimSpace(tenantID)
	subjectType = strings.TrimSpace(subjectType)
	subjectID = strings.TrimSpace(subjectID)
	point = normalizeSafetyPoint(point)
	if tenantID == "" || subjectType == "" || subjectID == "" || point == "" {
		return SafetyDecision{}, errors.Join(ErrValidation, errors.New("subject_type, subject_id, and enforcement_point are required"))
	}
	rule, ok, err := r.findActiveSafetyRule(ctx, tenantID, point)
	if err != nil {
		return SafetyDecision{}, err
	}
	decision := "allow"
	rationale := "no active safety rule matched"
	var ruleID *string
	if ok {
		decision = rule.Action
		rationale = "active safety rule matched enforcement point"
		ruleID = &rule.ID
	}
	record := SafetyDecision{
		ID:               id.New("safety_decision"),
		TenantID:         tenantID,
		RuleID:           ruleID,
		SubjectType:      subjectType,
		SubjectID:        subjectID,
		EnforcementPoint: point,
		Decision:         decision,
		Rationale:        rationale,
		CreatedAt:        time.Now().UTC(),
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO safety_decisions(id, tenant_id, rule_id, subject_type, subject_id, enforcement_point, decision, rationale, created_at)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		record.ID,
		record.TenantID,
		record.RuleID,
		record.SubjectType,
		record.SubjectID,
		record.EnforcementPoint,
		record.Decision,
		record.Rationale,
		record.CreatedAt,
	)
	if err != nil {
		return SafetyDecision{}, err
	}
	if err := r.RecordAnalyticsEvent(ctx, AnalyticsEvent{
		TenantID:    tenantID,
		EventName:   "safety_decision_recorded",
		SubjectType: subjectType,
		SubjectID:   subjectID,
		Properties: map[string]any{
			"enforcement_point": point,
			"decision":          decision,
			"rule_id":           stringValue(ruleID),
		},
		CreatedAt: record.CreatedAt,
	}); err != nil {
		return SafetyDecision{}, err
	}
	return record, nil
}

func (r Repository) RequireSafetyAllowed(ctx context.Context, tenantID, subjectType, subjectID, point string) (SafetyDecision, error) {
	decision, err := r.EnforceSafety(ctx, tenantID, subjectType, subjectID, point)
	if err != nil {
		return SafetyDecision{}, err
	}
	if decision.Decision == "block" {
		return decision, ErrSafetyBlocked
	}
	switch decision.Decision {
	case "require_user_confirmation", "require_admin_review":
		return decision, ErrSafetyReviewHold
	}
	return decision, nil
}

func safetyReviewOverrideEligible(decision string) bool {
	switch strings.TrimSpace(decision) {
	case "require_admin_review", "warn":
		return true
	default:
		return false
	}
}

func safetyReviewRequiredEvidenceRefs(item SafetyReviewItem) []string {
	refs := []string{
		"safety_decisions/" + item.SafetyDecisionID,
		"audit_logs/safety.review",
	}
	if item.RuleID != nil && strings.TrimSpace(*item.RuleID) != "" {
		refs = append(refs, "safety_rules/"+strings.TrimSpace(*item.RuleID))
	}
	if item.SubjectType != "" && item.SubjectID != "" {
		refs = append(refs, item.SubjectType+"s/"+item.SubjectID)
	}
	return refs
}

func safetyReviewUserVisibleOutcome(decision, reviewStatus string) string {
	switch strings.TrimSpace(reviewStatus) {
	case "approved":
		return "safety_review_approved"
	case "rejected":
		return "safety_review_rejected"
	case "escalated":
		return "safety_review_escalated"
	case "blocked":
		return "safety_review_blocked"
	}
	switch strings.TrimSpace(decision) {
	case "block":
		return "blocked_until_policy_change"
	case "require_admin_review":
		return "held_until_admin_review"
	case "warn":
		return "warning_visible_with_audit"
	default:
		return "pending_safety_review"
	}
}

func safetyReviewUserVisibleOutcomeForDecision(decision string) string {
	switch strings.TrimSpace(decision) {
	case "approved":
		return "safety_review_approved"
	case "rejected":
		return "safety_review_rejected"
	case "escalated":
		return "safety_review_escalated"
	case "blocked":
		return "safety_review_blocked"
	default:
		return "pending_safety_review"
	}
}

func safetyReviewSafeProjection(item SafetyReviewItem) map[string]any {
	return map[string]any{
		"raw_prompt_persisted":           false,
		"raw_provider_payload_persisted": false,
		"raw_safety_payload_persisted":   false,
		"secret_material_persisted":      false,
		"tenant_scoped":                  item.TenantID != "",
		"admin_only":                     true,
	}
}

func (input *SafetyReviewDecisionInput) normalize() {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.SafetyDecisionID = strings.TrimSpace(input.SafetyDecisionID)
	input.ReviewerID = strings.TrimSpace(input.ReviewerID)
	input.Decision = strings.TrimSpace(input.Decision)
	input.Rationale = security.RedactString(strings.TrimSpace(input.Rationale))
	input.AuditRef = strings.TrimSpace(input.AuditRef)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.Metadata = security.RedactMap(input.Metadata)
	if input.CreatedAt.IsZero() {
		input.CreatedAt = time.Now().UTC()
	} else {
		input.CreatedAt = input.CreatedAt.UTC()
	}
}

func (input SafetyReviewDecisionInput) validate() error {
	if input.TenantID == "" || input.SafetyDecisionID == "" || input.ReviewerID == "" || input.IdempotencyKey == "" {
		return errors.Join(ErrValidation, errors.New("tenant_id, safety_decision_id, reviewer_id, and idempotency_key are required"))
	}
	switch input.Decision {
	case "approved", "rejected", "escalated", "blocked":
	default:
		return errors.Join(ErrValidation, errors.New("decision must be approved, rejected, escalated, or blocked"))
	}
	if input.Rationale == "" || input.Rationale == security.Redacted {
		return errors.Join(ErrValidation, errors.New("non-secret review rationale is required"))
	}
	if input.AuditRef == "" {
		return errors.Join(ErrValidation, errors.New("audit_ref is required"))
	}
	return nil
}

func (input *ExportOverrideDecisionInput) normalize() {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.ExportID = strings.TrimSpace(input.ExportID)
	input.SourceType = strings.TrimSpace(input.SourceType)
	input.SourceID = strings.TrimSpace(input.SourceID)
	input.TraceID = strings.TrimSpace(input.TraceID)
	input.RequestedBy = strings.TrimSpace(input.RequestedBy)
	input.RequestedRole = strings.TrimSpace(input.RequestedRole)
	input.ResolvedBy = strings.TrimSpace(input.ResolvedBy)
	input.ResolvedRole = strings.TrimSpace(input.ResolvedRole)
	input.Outcome = strings.TrimSpace(input.Outcome)
	input.DenialReason = strings.TrimSpace(input.DenialReason)
	input.Rationale = security.RedactString(strings.TrimSpace(input.Rationale))
	input.AuditLogID = strings.TrimSpace(input.AuditLogID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	input.Metadata = security.RedactMap(input.Metadata)
	if input.CreatedAt.IsZero() {
		input.CreatedAt = time.Now().UTC()
	} else {
		input.CreatedAt = input.CreatedAt.UTC()
	}
}

func (input ExportOverrideDecisionInput) validate() error {
	if input.TenantID == "" || input.ExportID == "" || input.SourceID == "" || input.TraceID == "" || input.RequestedBy == "" || input.ResolvedBy == "" || input.IdempotencyKey == "" {
		return errors.Join(ErrValidation, errors.New("tenant_id, export_id, source_id, trace_id, requester, resolver, and idempotency_key are required"))
	}
	switch input.SourceType {
	case "qa_result", "safety_decision", "export_contract":
	default:
		return errors.Join(ErrValidation, errors.New("source_type must be qa_result, safety_decision, or export_contract"))
	}
	switch input.Outcome {
	case "approved", "denied":
	default:
		return errors.Join(ErrValidation, errors.New("decision must be approved or denied"))
	}
	if input.Outcome == "denied" && input.DenialReason == "" {
		return errors.Join(ErrValidation, errors.New("denied export override requires denial_reason"))
	}
	if input.DenialReason != "" {
		switch input.DenialReason {
		case "source_not_override_eligible", "critical_safety_rule", "incomplete_export_artifacts", "missing_approval_audit":
		default:
			return errors.Join(ErrValidation, errors.New("denial_reason is not supported"))
		}
	}
	if input.Rationale == "" || input.Rationale == security.Redacted {
		return errors.Join(ErrValidation, errors.New("non-secret export override rationale is required"))
	}
	if input.AuditLogID == "" {
		return errors.Join(ErrValidation, errors.New("audit_log_id is required"))
	}
	return nil
}

func (input ExportOverrideDecisionInput) sourceGateResolved() bool {
	if input.Outcome != "approved" || input.DenialReason != "" {
		return false
	}
	return input.SourceType == "qa_result"
}

func (r Repository) RecordExportOverrideDecision(ctx context.Context, input ExportOverrideDecisionInput) (ExportOverrideDecision, error) {
	input.normalize()
	if err := input.validate(); err != nil {
		return ExportOverrideDecision{}, err
	}
	if existing, ok, err := r.existingExportOverrideDecision(ctx, input.TenantID, input.IdempotencyKey); err != nil || ok {
		return existing, err
	}
	if _, err := r.GetExport(ctx, input.TenantID, input.ExportID); err != nil {
		return ExportOverrideDecision{}, err
	}
	metadataJSON, err := json.Marshal(input.Metadata)
	if err != nil {
		return ExportOverrideDecision{}, err
	}
	overrideID := id.New("export_override")
	sourceGateResolved := input.sourceGateResolved()
	denialReason := any(nil)
	if input.DenialReason != "" {
		denialReason = input.DenialReason
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO export_override_decisions (
	id, tenant_id, export_id, source_type, source_id, trace_id, requested_by, requested_by_role,
	resolved_by, resolved_by_role, outcome, denial_reason, source_gate_resolved, final_export_allowed,
	rationale, audit_log_id, idempotency_key, metadata, created_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, $14, $15, $16, $17, $18)`,
		overrideID,
		input.TenantID,
		input.ExportID,
		input.SourceType,
		input.SourceID,
		input.TraceID,
		input.RequestedBy,
		input.RequestedRole,
		input.ResolvedBy,
		input.ResolvedRole,
		input.Outcome,
		denialReason,
		sourceGateResolved,
		input.Rationale,
		input.AuditLogID,
		input.IdempotencyKey,
		metadataJSON,
		input.CreatedAt,
	)
	if err != nil {
		return ExportOverrideDecision{}, err
	}
	return ExportOverrideDecision{
		ID:                 overrideID,
		TenantID:           input.TenantID,
		ExportID:           input.ExportID,
		SourceType:         input.SourceType,
		SourceID:           input.SourceID,
		TraceID:            input.TraceID,
		RequestedByRole:    input.RequestedRole,
		ResolvedByRole:     input.ResolvedRole,
		Outcome:            input.Outcome,
		DenialReason:       stringPtrOrNil(input.DenialReason),
		SourceGateResolved: sourceGateResolved,
		FinalExportAllowed: false,
		AuditLogID:         input.AuditLogID,
		IdempotencyKey:     input.IdempotencyKey,
		Metadata:           input.Metadata,
		CreatedAt:          input.CreatedAt,
	}, nil
}

func (r Repository) existingExportOverrideDecision(ctx context.Context, tenantID, idempotencyKey string) (ExportOverrideDecision, bool, error) {
	var record ExportOverrideDecision
	var denialReason *string
	var metadataJSON []byte
	err := r.db.QueryRow(ctx, `
SELECT id, tenant_id, export_id, source_type, source_id, trace_id, requested_by_role, resolved_by_role,
       outcome, denial_reason, source_gate_resolved, final_export_allowed, audit_log_id, idempotency_key, metadata, created_at
FROM export_override_decisions
WHERE tenant_id = $1 AND idempotency_key = $2`,
		tenantID,
		idempotencyKey,
	).Scan(
		&record.ID,
		&record.TenantID,
		&record.ExportID,
		&record.SourceType,
		&record.SourceID,
		&record.TraceID,
		&record.RequestedByRole,
		&record.ResolvedByRole,
		&record.Outcome,
		&denialReason,
		&record.SourceGateResolved,
		&record.FinalExportAllowed,
		&record.AuditLogID,
		&record.IdempotencyKey,
		&metadataJSON,
		&record.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return ExportOverrideDecision{}, false, nil
	}
	if err != nil {
		return ExportOverrideDecision{}, false, err
	}
	record.DenialReason = denialReason
	if len(metadataJSON) > 0 {
		_ = json.Unmarshal(metadataJSON, &record.Metadata)
		record.Metadata = security.RedactMap(record.Metadata)
	}
	return record, true, nil
}

func stringPtrOrNil(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	normalized := strings.TrimSpace(value)
	return &normalized
}

func (r Repository) existingSafetyReviewDecision(ctx context.Context, tenantID, idempotencyKey string) (SafetyReviewDecision, bool, error) {
	var record SafetyReviewDecision
	var metadataJSON []byte
	err := r.db.QueryRow(ctx, `
SELECT id, tenant_id, safety_decision_id, reviewer_id, decision, rationale, audit_ref, idempotency_key, metadata, created_at
FROM safety_review_decisions
WHERE tenant_id = $1 AND idempotency_key = $2`,
		tenantID,
		idempotencyKey,
	).Scan(
		&record.ID,
		&record.TenantID,
		&record.SafetyDecisionID,
		&record.ReviewerID,
		&record.Decision,
		&record.Rationale,
		&record.AuditRef,
		&record.IdempotencyKey,
		&metadataJSON,
		&record.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return SafetyReviewDecision{}, false, nil
	}
	if err != nil {
		return SafetyReviewDecision{}, false, err
	}
	_ = json.Unmarshal(metadataJSON, &record.Metadata)
	record.Metadata = security.RedactMap(record.Metadata)
	record.UserVisibleOutcome = safetyReviewUserVisibleOutcomeForDecision(record.Decision)
	return record, true, nil
}

func (r Repository) ensureSafetyDecisionBelongsToTenant(ctx context.Context, tenantID, safetyDecisionID string) error {
	var found string
	err := r.db.QueryRow(ctx, `
SELECT id
FROM safety_decisions
WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		safetyDecisionID,
	).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (r Repository) EnforceBriefSafety(ctx context.Context, tenantID, projectID string) (SafetyDecision, error) {
	return r.RequireSafetyAllowed(ctx, tenantID, "project", projectID, SafetyPointBrief)
}

func (r Repository) EnforceProviderRequestSafety(ctx context.Context, tenantID, taskID string) (SafetyDecision, error) {
	return r.RequireSafetyAllowed(ctx, tenantID, "agent_task", taskID, SafetyPointProviderRequest)
}

func (r Repository) EnforceProviderResponseSafety(ctx context.Context, tenantID, taskID string) (SafetyDecision, error) {
	return r.RequireSafetyAllowed(ctx, tenantID, "agent_task", taskID, SafetyPointProviderResponse)
}

func (r Repository) EnforceQASafety(ctx context.Context, tenantID, subjectType, subjectID string) (SafetyDecision, error) {
	return r.RequireSafetyAllowed(ctx, tenantID, subjectType, subjectID, SafetyPointQA)
}

func (r Repository) EnforceExportSafety(ctx context.Context, tenantID, exportID string) (SafetyDecision, error) {
	return r.RequireSafetyAllowed(ctx, tenantID, "export", exportID, SafetyPointExport)
}

func (r Repository) RunRuntimeSafetyPolicy(ctx context.Context, input RuntimeSafetyPolicyInput) (RuntimeSafetyPolicyResult, error) {
	input.TenantID = strings.TrimSpace(input.TenantID)
	input.ProjectID = strings.TrimSpace(input.ProjectID)
	input.TaskID = strings.TrimSpace(input.TaskID)
	input.QASubjectType = strings.TrimSpace(input.QASubjectType)
	input.QASubjectID = strings.TrimSpace(input.QASubjectID)
	input.ExportID = strings.TrimSpace(input.ExportID)
	if input.TenantID == "" {
		return RuntimeSafetyPolicyResult{}, errors.Join(ErrValidation, errors.New("tenant_id is required for runtime safety policy"))
	}

	var result RuntimeSafetyPolicyResult
	appendDecision := func(decision SafetyDecision, err error) error {
		if err != nil {
			return err
		}
		result.Decisions = append(result.Decisions, decision)
		return nil
	}
	if input.ProjectID != "" {
		if err := appendDecision(r.EnforceBriefSafety(ctx, input.TenantID, input.ProjectID)); err != nil {
			return result, err
		}
	}
	if input.IncludeProvider && input.TaskID != "" {
		if err := appendDecision(r.EnforceProviderRequestSafety(ctx, input.TenantID, input.TaskID)); err != nil {
			return result, err
		}
		if err := appendDecision(r.EnforceProviderResponseSafety(ctx, input.TenantID, input.TaskID)); err != nil {
			return result, err
		}
	}
	if input.QASubjectType != "" && input.QASubjectID != "" {
		if err := appendDecision(r.EnforceQASafety(ctx, input.TenantID, input.QASubjectType, input.QASubjectID)); err != nil {
			return result, err
		}
	}
	if input.ExportID != "" {
		if err := appendDecision(r.EnforceExportSafety(ctx, input.TenantID, input.ExportID)); err != nil {
			return result, err
		}
	}
	if len(result.Decisions) == 0 {
		return RuntimeSafetyPolicyResult{}, errors.Join(ErrValidation, errors.New("at least one runtime safety subject is required"))
	}
	return result, nil
}

func (r Repository) RecordAnalyticsEvent(ctx context.Context, event AnalyticsEvent) error {
	var err error
	event.TenantID, event.UserID, event.ProjectID, event.WorkflowID, event.EventName, event.SubjectType, event.SubjectID, err = normalizeAnalyticsEventScope(event)
	if err != nil {
		return err
	}
	if event.TenantID == "" || event.EventName == "" || event.SubjectType == "" || event.SubjectID == "" {
		return errors.Join(ErrValidation, errors.New("tenant_id, event_name, subject_type, and subject_id are required"))
	}
	if event.ID == "" {
		event.ID = id.New("analytics")
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = time.Now().UTC()
	}
	properties := security.RedactMap(event.Properties)
	if properties == nil {
		properties = map[string]any{}
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO analytics_events(id, tenant_id, user_id, project_id, workflow_id, event_name, subject_type, subject_id, properties, created_at)
VALUES($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, $7, $8, $9, $10)`,
		event.ID,
		event.TenantID,
		event.UserID,
		event.ProjectID,
		event.WorkflowID,
		event.EventName,
		event.SubjectType,
		event.SubjectID,
		jsonObject(properties),
		event.CreatedAt.UTC(),
	)
	return err
}

func (r Repository) ListAnalyticsEvents(ctx context.Context, filters AnalyticsEventFilters) (Page[AnalyticsEvent], error) {
	filters.TenantID = strings.TrimSpace(filters.TenantID)
	if filters.TenantID == "" {
		return Page[AnalyticsEvent]{}, errors.Join(ErrValidation, errors.New("tenant_id is required"))
	}
	var err error
	filters.EventName, err = normalizeAnalyticsTaxonomyValue("event_name", filters.EventName, analyticsEventTaxonomy, true)
	if err != nil {
		return Page[AnalyticsEvent]{}, err
	}
	filters.SubjectType, err = normalizeAnalyticsTaxonomyValue("subject_type", filters.SubjectType, analyticsSubjectTypeTaxonomy, true)
	if err != nil {
		return Page[AnalyticsEvent]{}, err
	}
	filters.WorkflowID, err = normalizeAnalyticsReferenceValue("workflow_id", filters.WorkflowID, true)
	if err != nil {
		return Page[AnalyticsEvent]{}, err
	}
	filters.SubjectID, err = normalizeAnalyticsReferenceValue("subject_id", filters.SubjectID, true)
	if err != nil {
		return Page[AnalyticsEvent]{}, err
	}
	if filters.Limit <= 0 || filters.Limit > 100 {
		filters.Limit = 50
	}
	args := []any{filters.TenantID, filters.Limit}
	query := `
SELECT id, tenant_id, COALESCE(user_id, ''), COALESCE(project_id, ''), workflow_id, event_name, subject_type, subject_id, properties, created_at
FROM analytics_events
WHERE tenant_id = $1`
	addFilter := func(column, value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		args = append(args, value)
		query += fmt.Sprintf(" AND %s = $%d", column, len(args))
	}
	addFilter("event_name", filters.EventName)
	addFilter("workflow_id", filters.WorkflowID)
	addFilter("subject_type", filters.SubjectType)
	addFilter("subject_id", filters.SubjectID)
	query += " ORDER BY created_at DESC LIMIT $2"
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return Page[AnalyticsEvent]{}, err
	}
	defer rows.Close()

	var page Page[AnalyticsEvent]
	for rows.Next() {
		var event AnalyticsEvent
		var propertiesJSON []byte
		if err := rows.Scan(&event.ID, &event.TenantID, &event.UserID, &event.ProjectID, &event.WorkflowID, &event.EventName, &event.SubjectType, &event.SubjectID, &propertiesJSON, &event.CreatedAt); err != nil {
			return Page[AnalyticsEvent]{}, err
		}
		_ = json.Unmarshal(propertiesJSON, &event.Properties)
		event.Properties = security.RedactMap(event.Properties)
		page.Items = append(page.Items, event)
	}
	return page, rows.Err()
}

func normalizeAnalyticsEventScope(event AnalyticsEvent) (tenantID, userID, projectID, workflowID, eventName, subjectType, subjectID string, err error) {
	tenantID = strings.TrimSpace(event.TenantID)
	userID, err = normalizeAnalyticsReferenceValue("user_id", event.UserID, true)
	if err != nil {
		return "", "", "", "", "", "", "", err
	}
	projectID, err = normalizeAnalyticsReferenceValue("project_id", event.ProjectID, true)
	if err != nil {
		return "", "", "", "", "", "", "", err
	}
	workflowID, err = normalizeAnalyticsReferenceValue("workflow_id", event.WorkflowID, true)
	if err != nil {
		return "", "", "", "", "", "", "", err
	}
	eventName, err = normalizeAnalyticsTaxonomyValue("event_name", event.EventName, analyticsEventTaxonomy, false)
	if err != nil {
		return "", "", "", "", "", "", "", err
	}
	subjectType, err = normalizeAnalyticsTaxonomyValue("subject_type", event.SubjectType, analyticsSubjectTypeTaxonomy, false)
	if err != nil {
		return "", "", "", "", "", "", "", err
	}
	subjectID, err = normalizeAnalyticsReferenceValue("subject_id", event.SubjectID, false)
	if err != nil {
		return "", "", "", "", "", "", "", err
	}
	return tenantID, userID, projectID, workflowID, eventName, subjectType, subjectID, nil
}

func normalizeAnalyticsTaxonomyValue(field, value string, allowed map[string]struct{}, optional bool) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		if optional {
			return "", nil
		}
		return "", errors.Join(ErrValidation, fmt.Errorf("%s is required", field))
	}
	if _, ok := allowed[normalized]; !ok {
		return "", errors.Join(ErrValidation, fmt.Errorf("unsupported analytics %s %q", field, security.RedactString(normalized)))
	}
	return normalized, nil
}

func normalizeAnalyticsReferenceValue(field, value string, optional bool) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		if optional {
			return "", nil
		}
		return "", errors.Join(ErrValidation, fmt.Errorf("%s is required", field))
	}
	if !analyticsReferencePattern.MatchString(normalized) || strings.ContainsAny(normalized, `/\`) || strings.Contains(normalized, "..") {
		return "", errors.Join(ErrValidation, fmt.Errorf("analytics %s is invalid", field))
	}
	return normalized, nil
}

func (r Repository) ListAnalyticsReports(ctx context.Context, tenantID string, limit int, now time.Time) (Page[AnalyticsReport], error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return Page[AnalyticsReport]{}, errors.Join(ErrValidation, errors.New("tenant_id is required"))
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	rows, err := r.db.Query(ctx, `
WITH event_counts AS (
	SELECT
		COUNT(*) FILTER (WHERE event_name = 'workflow_started') AS workflow_started,
		COUNT(*) FILTER (WHERE event_name = 'candidate_set_created') AS candidate_set_created,
		COUNT(*) FILTER (WHERE event_name = 'candidate_set_created' AND lower(COALESCE(properties->>'is_iteration', 'false')) IN ('true', 't', '1', 'yes')) AS workflow_iterations,
		COUNT(*) FILTER (WHERE event_name = 'four_candidates_ready') AS four_candidates_ready,
		COUNT(*) FILTER (WHERE event_name = 'direction_selected') AS direction_selected,
		COUNT(*) FILTER (WHERE event_name = 'package_item_added') AS package_item_added,
		COUNT(*) FILTER (WHERE event_name = 'export_started') AS export_started,
		COUNT(*) FILTER (WHERE event_name = 'export_completed') AS export_completed,
		COUNT(*) FILTER (WHERE event_name = 'export_failed') AS export_failed,
		COUNT(*) FILTER (WHERE event_name = 'support_ticket_created') AS support_ticket_created,
		COUNT(*) FILTER (WHERE event_name = 'safety_decision_recorded') AS safety_decision_recorded,
		COUNT(*) FILTER (WHERE event_name = 'export_regenerated') AS export_regenerated,
		COUNT(*) FILTER (WHERE event_name = 'export_expired') AS export_expired,
		COUNT(*) FILTER (WHERE event_name = 'object_orphaned') AS object_orphaned,
		COUNT(*) FILTER (WHERE event_name = 'object_deleted') AS object_deleted,
		COUNT(*) FILTER (WHERE event_name = 'export_object_cleanup_run') AS export_object_cleanup_run
	FROM analytics_events
	WHERE tenant_id = $1
	  AND created_at >= $2
),
weekly_return_counts AS (
	WITH current_users AS (
		SELECT DISTINCT user_id
		FROM analytics_events
		WHERE tenant_id = $1
		  AND created_at >= $2
		  AND NULLIF(user_id, '') IS NOT NULL
	),
	previous_users AS (
		SELECT DISTINCT user_id
		FROM analytics_events
		WHERE tenant_id = $1
		  AND created_at >= $2 - interval '7 days'
		  AND created_at < $2
		  AND NULLIF(user_id, '') IS NOT NULL
	)
	SELECT
		(SELECT COUNT(*) FROM current_users) AS current_active_users,
		(SELECT COUNT(*) FROM previous_users) AS previous_active_users,
		(SELECT COUNT(*) FROM current_users JOIN previous_users USING (user_id)) AS returning_users
),
cost_counts AS (
	SELECT
		COALESCE(SUM(cost_cents), 0) AS provider_cost_cents,
		COALESCE(SUM(usage_units), 0) AS provider_usage_units
	FROM provider_usage_logs
	WHERE tenant_id = $1
	  AND created_at >= $2
	  AND status IN ('recorded', 'succeeded', 'success')
),
successful_package_counts AS (
	SELECT
		COUNT(DISTINCT NULLIF(properties->>'package_id', '')) AS successful_packages
	FROM analytics_events
	WHERE tenant_id = $1
	  AND created_at >= $2
	  AND event_name = 'export_completed'
),
package_asset_counts AS (
	SELECT
		COUNT(DISTINCT p.id) AS package_count,
		COUNT(pi.id) AS package_assets
	FROM packages p
	LEFT JOIN package_items pi ON pi.tenant_id = p.tenant_id AND pi.package_id = p.id
	WHERE p.tenant_id = $1
	  AND p.created_at >= $2
)
SELECT metric_name, source_events, required_dimensions, go_no_go_signal, window_name, metric_value, dimensions
FROM (
	SELECT 1 AS ord,
	       'export_completion_rate' AS metric_name,
	       ARRAY['export_started','export_completed','export_failed']::text[] AS source_events,
	       ARRAY['tenant_id','workflow_id','format']::text[] AS required_dimensions,
	       (CASE WHEN export_started = 0 THEN true ELSE export_completed::numeric / NULLIF(export_started, 0) >= 0.95 END) AS go_no_go_signal,
	       'weekly' AS window_name,
	       CASE WHEN export_started = 0 THEN 0 ELSE export_completed::numeric / NULLIF(export_started, 0) END AS metric_value,
	       jsonb_build_object('started', export_started, 'completed', export_completed, 'failed', export_failed) AS dimensions
	FROM event_counts
	UNION ALL
	SELECT 2,
	       'failed_export_rate',
	       ARRAY['export_started','export_failed']::text[],
	       ARRAY['tenant_id','workflow_id','format']::text[],
	       (CASE WHEN export_started = 0 THEN true ELSE export_failed::numeric / NULLIF(export_started, 0) <= 0.05 END),
	       'weekly',
	       CASE WHEN export_started = 0 THEN 0 ELSE export_failed::numeric / NULLIF(export_started, 0) END,
	       jsonb_build_object('started', export_started, 'failed', export_failed)
	FROM event_counts
	UNION ALL
	SELECT 3,
	       'support_ticket_rate',
	       ARRAY['support_ticket_created','export_started']::text[],
	       ARRAY['tenant_id','category']::text[],
	       (support_ticket_created <= 5),
	       'weekly',
	       support_ticket_created::numeric,
	       jsonb_build_object('support_tickets', support_ticket_created)
	FROM event_counts
	UNION ALL
	SELECT 4,
	       'qa_warning_block_rate',
	       ARRAY['safety_decision_recorded']::text[],
	       ARRAY['tenant_id','enforcement_point','decision']::text[],
	       (safety_decision_recorded <= 10),
	       'weekly',
	       safety_decision_recorded::numeric,
	       jsonb_build_object('safety_decisions', safety_decision_recorded)
	FROM event_counts
	UNION ALL
	SELECT 5,
	       'package_add_rate',
	       ARRAY['package_item_added','direction_selected']::text[],
	       ARRAY['tenant_id','workflow_id','package_id','item_type']::text[],
	       true,
	       'weekly',
	       CASE WHEN direction_selected = 0 THEN package_item_added::numeric ELSE package_item_added::numeric / NULLIF(direction_selected, 0) END,
	       jsonb_build_object('package_items_added', package_item_added, 'directions_selected', direction_selected)
	FROM event_counts
	UNION ALL
	SELECT 6,
	       'iteration_rate',
	       ARRAY['candidate_set_created','export_regenerated']::text[],
	       ARRAY['tenant_id','workflow_id','is_iteration']::text[],
	       true,
	       'weekly',
	       CASE WHEN candidate_set_created = 0 THEN 0 ELSE workflow_iterations::numeric / NULLIF(candidate_set_created, 0) END,
	       jsonb_build_object('candidate_sets', candidate_set_created, 'iterations', workflow_iterations, 'regenerated_exports', export_regenerated)
	FROM event_counts
	UNION ALL
	SELECT 7,
	       'first_prompt_to_four_candidates',
	       ARRAY['workflow_started','four_candidates_ready']::text[],
	       ARRAY['tenant_id','workflow_id','candidate_count']::text[],
	       (CASE WHEN workflow_started = 0 THEN true ELSE four_candidates_ready >= workflow_started END),
	       'weekly',
	       CASE WHEN workflow_started = 0 THEN 0 ELSE four_candidates_ready::numeric / NULLIF(workflow_started, 0) END,
	       jsonb_build_object('workflow_started', workflow_started, 'four_candidates_ready', four_candidates_ready)
	FROM event_counts
	UNION ALL
	SELECT 8,
	       'selection_rate',
	       ARRAY['four_candidates_ready','direction_selected']::text[],
	       ARRAY['tenant_id','workflow_id','candidate_set_id']::text[],
	       true,
	       'weekly',
	       CASE WHEN four_candidates_ready = 0 THEN 0 ELSE direction_selected::numeric / NULLIF(four_candidates_ready, 0) END,
	       jsonb_build_object('four_candidates_ready', four_candidates_ready, 'directions_selected', direction_selected)
	FROM event_counts
	UNION ALL
	SELECT 9,
	       'package_export_completion',
	       ARRAY['package_item_added','export_completed']::text[],
	       ARRAY['tenant_id','workflow_id','package_id','format']::text[],
	       true,
	       'weekly',
	       CASE WHEN package_item_added = 0 THEN export_completed::numeric ELSE export_completed::numeric / NULLIF(package_item_added, 0) END,
	       jsonb_build_object('package_items_added', package_item_added, 'exports_completed', export_completed)
	FROM event_counts
	UNION ALL
	SELECT 10,
	       'average_assets_per_package',
	       ARRAY['packages','package_items']::text[],
	       ARRAY['tenant_id','package_id','item_type']::text[],
	       true,
	       'weekly',
	       CASE WHEN package_count = 0 THEN 0 ELSE package_assets::numeric / NULLIF(package_count, 0) END,
	       jsonb_build_object('packages', package_count, 'package_assets', package_assets)
	FROM package_asset_counts
	UNION ALL
	SELECT 11,
	       'export_object_cleanup',
	       ARRAY['export_expired','object_orphaned','object_deleted','export_object_cleanup_run']::text[],
	       ARRAY['tenant_id','project_id','asset_type','retention_state']::text[],
	       (object_deleted >= object_orphaned),
	       'weekly',
	       object_deleted::numeric,
	       jsonb_build_object('export_expired', export_expired, 'object_orphaned', object_orphaned, 'object_deleted', object_deleted, 'cleanup_runs', export_object_cleanup_run)
	FROM event_counts
	UNION ALL
	SELECT 12,
	       'weekly_return',
	       ARRAY['analytics_events']::text[],
	       ARRAY['tenant_id','user_id','created_at']::text[],
	       true,
	       'weekly',
	       CASE WHEN previous_active_users = 0 THEN 0 ELSE returning_users::numeric / NULLIF(previous_active_users, 0) END,
	       jsonb_build_object('current_active_users', current_active_users, 'previous_active_users', previous_active_users, 'returning_users', returning_users)
	FROM weekly_return_counts
	UNION ALL
	SELECT 13,
	       'cost_per_successful_package',
	       ARRAY['provider_usage_logs','export_completed']::text[],
	       ARRAY['tenant_id','cost_cents','usage_units','package_id']::text[],
	       (CASE WHEN successful_packages = 0 THEN true ELSE provider_cost_cents::numeric / NULLIF(successful_packages, 0) <= 500 END),
	       'weekly',
	       CASE WHEN successful_packages = 0 THEN 0 ELSE provider_cost_cents::numeric / NULLIF(successful_packages, 0) END,
	       jsonb_build_object('provider_cost_cents', provider_cost_cents, 'provider_usage_units', provider_usage_units, 'successful_packages', successful_packages)
	FROM cost_counts CROSS JOIN successful_package_counts
) reports
ORDER BY ord
LIMIT $3`,
		tenantID,
		now.UTC().AddDate(0, 0, -7),
		limit,
	)
	if err != nil {
		return Page[AnalyticsReport]{}, err
	}
	defer rows.Close()

	var page Page[AnalyticsReport]
	for rows.Next() {
		var report AnalyticsReport
		var dimensionsJSON []byte
		var value float64
		if err := rows.Scan(&report.MetricName, &report.SourceEvents, &report.RequiredDimensions, &report.GoNoGoSignal, &report.Window, &value, &dimensionsJSON); err != nil {
			return Page[AnalyticsReport]{}, err
		}
		report.ID = "analytics_report_" + report.MetricName
		report.Value = value
		report.ComputedAt = now.UTC()
		_ = json.Unmarshal(dimensionsJSON, &report.Dimensions)
		report.Dimensions = security.RedactMap(report.Dimensions)
		page.Items = append(page.Items, report)
	}
	return page, rows.Err()
}

func scanUpload(ctx context.Context, scanner security.MalwareScanner, target security.MalwareScanTarget) (security.MalwareScanResult, error) {
	if scanner == nil {
		scanner = security.PlaceholderMalwareScanner{}
	}
	target.Metadata = security.RedactStringMap(target.Metadata)
	result, err := scanner.Scan(ctx, target)
	if err != nil {
		return security.MalwareScanResult{}, err
	}
	status, ok := security.NormalizeMalwareScanStatus(result.Status)
	if !ok {
		return security.MalwareScanResult{}, errors.Join(ErrValidation, fmt.Errorf("malware scan returned unsupported status %q", security.RedactString(string(result.Status))))
	}
	result.Status = status
	if result.ScannedAt.IsZero() {
		result.ScannedAt = time.Now().UTC()
	}
	result.Provider = security.RedactString(strings.TrimSpace(result.Provider))
	if result.Provider == "" {
		result.Provider = "unknown"
	}
	result.Signature = security.RedactString(strings.TrimSpace(result.Signature))
	result.Rationale = security.RedactString(result.Rationale)
	result.Metadata = security.RedactStringMap(result.Metadata)
	if result.Signature == "" {
		result.Signature = "unspecified"
	}
	return result, nil
}

var malwareScanMetadataAllowlist = map[string]struct{}{
	"asset_role":     {},
	"reference_role": {},
	"slot":           {},
	"source":         {},
	"workflow_id":    {},
}

var uploadReservedMalwareMetadataKeys = map[string]struct{}{
	"definition":                  {},
	"malware_scan":                {},
	"provider":                    {},
	"scan_status":                 {},
	"stage0_force_malware_status": {},
	"status":                      {},
}

func sanitizeUploadMetadata(input map[string]any) map[string]any {
	metadata := security.RedactMap(input)
	for key := range metadata {
		if _, reserved := uploadReservedMalwareMetadataKeys[strings.ToLower(strings.TrimSpace(key))]; reserved {
			delete(metadata, key)
		}
	}
	return metadata
}

func malwareScanMetadata(input map[string]any) map[string]string {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]string, len(malwareScanMetadataAllowlist))
	for key, value := range input {
		key = strings.ToLower(strings.TrimSpace(key))
		if _, ok := malwareScanMetadataAllowlist[key]; !ok {
			continue
		}
		if stringValue, ok := value.(string); ok {
			redacted := security.RedactString(strings.TrimSpace(stringValue))
			if redacted != "" && redacted != security.Redacted {
				out[key] = redacted
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func malwareScanMetadataValue(result security.MalwareScanResult) map[string]any {
	value := map[string]any{
		"status":     string(result.Status),
		"provider":   result.Provider,
		"definition": result.Signature,
		"rationale":  result.Rationale,
		"scanned_at": result.ScannedAt.UTC().Format(time.RFC3339),
	}
	if len(result.Metadata) > 0 {
		value["metadata"] = result.Metadata
	}
	return security.RedactMap(value)
}

type packageContext struct {
	ProjectID  string
	CreatedBy  string
	WorkflowID string
}

func (r Repository) packageContext(ctx context.Context, tenantID, packageID string) (packageContext, error) {
	var pkg packageContext
	err := r.db.QueryRow(ctx, `
SELECT p.project_id, p.created_by, COALESCE(pr.workflow_id, '')
FROM packages p
LEFT JOIN projects pr ON pr.tenant_id = p.tenant_id AND pr.id = p.project_id
WHERE p.tenant_id = $1 AND p.id = $2`,
		tenantID,
		packageID,
	).Scan(&pkg.ProjectID, &pkg.CreatedBy, &pkg.WorkflowID)
	if errors.Is(err, pgx.ErrNoRows) {
		return packageContext{}, ErrNotFound
	}
	if err != nil {
		return packageContext{}, err
	}
	return pkg, nil
}

func (r Repository) findActiveSafetyRule(ctx context.Context, tenantID, point string) (SafetyRule, bool, error) {
	rows, err := r.db.Query(ctx, `
SELECT id, tenant_id, rule_key, version, domain, severity, action, enforcement_points, status, created_at
FROM safety_rules
WHERE status = 'active'
  AND (tenant_id IS NULL OR tenant_id = $1)
ORDER BY
  CASE action WHEN 'block' THEN 0 WHEN 'review' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END,
  tenant_id NULLS LAST,
  created_at DESC`,
		tenantID,
	)
	if err != nil {
		return SafetyRule{}, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var rule SafetyRule
		var pointsJSON []byte
		if err := rows.Scan(&rule.ID, &rule.TenantID, &rule.RuleKey, &rule.Version, &rule.Domain, &rule.Severity, &rule.Action, &pointsJSON, &rule.Status, &rule.CreatedAt); err != nil {
			return SafetyRule{}, false, err
		}
		_ = json.Unmarshal(pointsJSON, &rule.EnforcementPoints)
		for _, enforcementPoint := range rule.EnforcementPoints {
			if enforcementPoint == point {
				return rule, true, nil
			}
		}
	}
	return SafetyRule{}, false, rows.Err()
}

func normalizeSafetyPoint(point string) string {
	switch strings.TrimSpace(point) {
	case SafetyPointBrief:
		return SafetyPointBrief
	case SafetyPointProviderRequest:
		return SafetyPointProviderRequest
	case SafetyPointProviderResponse:
		return SafetyPointProviderResponse
	case SafetyPointQA:
		return SafetyPointQA
	case SafetyPointExport:
		return SafetyPointExport
	default:
		return strings.TrimSpace(point)
	}
}

func (r Repository) hasBlockingExportQA(ctx context.Context, tenantID, packageID string) (bool, error) {
	rows, err := r.db.Query(ctx, `
SELECT q.status, q.severity
FROM qa_results q
JOIN packages p ON p.tenant_id = q.tenant_id AND p.id = $2
WHERE q.tenant_id = $1
  AND q.project_id = p.project_id
  AND q.subject_type IN ('asset', 'package', 'export')
ORDER BY q.created_at DESC`,
		tenantID,
		packageID,
	)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var status, severity string
		if err := rows.Scan(&status, &severity); err != nil {
			return false, err
		}
		if status == "block" || severity == "blocking" {
			return true, nil
		}
	}
	return false, rows.Err()
}

func (r Repository) getCrawlerSource(ctx context.Context, tenantID, sourceID string) (CrawlerSource, error) {
	var source CrawlerSource
	var legalJSON, robotsJSON []byte
	err := r.db.QueryRow(ctx, `
SELECT id, tenant_id, name, url, approval_status, legal_metadata, robots_policy, created_at, updated_at
FROM crawler_sources
WHERE id = $1
  AND (tenant_id IS NULL OR tenant_id = $2)`,
		sourceID,
		strings.TrimSpace(tenantID),
	).Scan(&source.ID, &source.TenantID, &source.Name, &source.URL, &source.ApprovalStatus, &legalJSON, &robotsJSON, &source.CreatedAt, &source.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return CrawlerSource{}, ErrNotFound
	}
	if err != nil {
		return CrawlerSource{}, err
	}
	_ = json.Unmarshal(legalJSON, &source.LegalMetadata)
	_ = json.Unmarshal(robotsJSON, &source.RobotsPolicy)
	return source, nil
}

func validateCrawlerPolicy(policy CrawlerPolicy) error {
	if !policy.Enabled {
		return errors.Join(ErrCrawlerBlocked, errors.New("crawler is disabled"))
	}
	if strings.TrimSpace(policy.UserAgent) == "" {
		return errors.Join(ErrValidation, errors.New("crawler user agent is required"))
	}
	if policy.GlobalRPS <= 0 || policy.SourceRPS <= 0 {
		return errors.Join(ErrValidation, errors.New("crawler global and source rate limits must be positive"))
	}
	if policy.RawRetentionDays <= 0 || policy.RawRetentionDays > 30 {
		return errors.Join(ErrValidation, errors.New("crawler raw retention must be between 1 and 30 days"))
	}
	return nil
}

func (r Repository) enforceCrawlerRateLimit(ctx context.Context, sourceID string, policy CrawlerPolicy, now time.Time) error {
	if policy.GlobalRPS <= 0 || policy.SourceRPS <= 0 {
		return errors.Join(ErrValidation, errors.New("crawler global and source rate limits must be positive"))
	}
	var globalCount, sourceCount int
	globalWindow := now.Add(-crawlerRateWindow(policy.GlobalRPS))
	sourceWindow := now.Add(-crawlerRateWindow(policy.SourceRPS))
	err := r.db.QueryRow(ctx, `
SELECT
	COUNT(*) FILTER (WHERE started_at >= $1),
	COUNT(*) FILTER (WHERE source_id = $2 AND started_at >= $3)
FROM crawler_runs
WHERE started_at >= LEAST($1, $3)`,
		globalWindow,
		sourceID,
		sourceWindow,
	).Scan(&globalCount, &sourceCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if globalCount >= crawlerRateBurst(policy.GlobalRPS) {
		return errors.Join(ErrCrawlerBlocked, errors.New("crawler global rate limit exceeded"))
	}
	if sourceCount >= crawlerRateBurst(policy.SourceRPS) {
		return errors.Join(ErrCrawlerBlocked, errors.New("crawler source rate limit exceeded"))
	}
	return nil
}

func crawlerRateWindow(rps float64) time.Duration {
	if rps >= 1 {
		return time.Second
	}
	return time.Duration(float64(time.Second) / rps)
}

func crawlerRateBurst(rps float64) int {
	if rps < 1 {
		return 1
	}
	return int(rps)
}

func enforceCrawlerSourcePolicy(ctx context.Context, source CrawlerSource, policy CrawlerPolicy) error {
	if !strings.EqualFold(strings.TrimSpace(source.ApprovalStatus), "approved") {
		return errors.Join(ErrCrawlerBlocked, errors.New("crawler source approval is required"))
	}
	if _, err := validateCrawlerURL(ctx, source.URL, policy); err != nil {
		return err
	}
	if !crawlerRobotsAllowed(source.RobotsPolicy) {
		return errors.Join(ErrCrawlerBlocked, errors.New("crawler robots evidence does not allow fetch"))
	}
	if !crawlerLegalMetadataComplete(source.LegalMetadata) {
		return errors.Join(ErrCrawlerBlocked, errors.New("crawler source legal metadata is incomplete"))
	}
	return nil
}

func enforceCrawlerDocumentURL(ctx context.Context, source CrawlerSource, documentURL string, policy CrawlerPolicy) error {
	sourceParsed, err := validateCrawlerURL(ctx, source.URL, policy)
	if err != nil {
		return err
	}
	documentParsed, err := validateCrawlerURL(ctx, documentURL, policy)
	if err != nil {
		return err
	}
	if !strings.EqualFold(sourceParsed.Hostname(), documentParsed.Hostname()) {
		return errors.Join(ErrCrawlerBlocked, errors.New("crawler document URL must stay on the approved source host"))
	}
	return nil
}

func validateCrawlerURL(ctx context.Context, rawURL string, policy CrawlerPolicy) (*url.URL, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.Join(ErrValidation, errors.New("crawler URL must be absolute"))
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.Join(ErrCrawlerBlocked, errors.New("crawler URL scheme is not allowed"))
	}
	host := strings.ToLower(strings.Trim(parsed.Hostname(), "[]"))
	for _, blocked := range policy.BlocklistHosts {
		if strings.EqualFold(strings.TrimSpace(blocked), host) {
			return nil, errors.Join(ErrCrawlerBlocked, errors.New("crawler URL host is blocklisted"))
		}
	}
	if isPrivateCrawlerHost(host) {
		return nil, errors.Join(ErrCrawlerBlocked, errors.New("crawler URL host is private or local"))
	}
	ips, err := resolveCrawlerHost(ctx, host, policy)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if isBlockedCrawlerIP(ip) {
			return nil, errors.Join(ErrCrawlerBlocked, errors.New("crawler URL resolved to a private or local address"))
		}
	}
	return parsed, nil
}

func resolveCrawlerHost(ctx context.Context, host string, policy CrawlerPolicy) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		return []net.IP{ip}, nil
	}
	if policy.ResolveHost != nil {
		ips, err := policy.ResolveHost(ctx, host)
		if err != nil {
			return nil, err
		}
		return ips, nil
	}
	resolver := net.DefaultResolver
	addrs, err := resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, errors.Join(ErrCrawlerBlocked, fmt.Errorf("crawler URL host resolution failed: %w", err))
	}
	ips := make([]net.IP, 0, len(addrs))
	for _, addr := range addrs {
		ips = append(ips, addr.IP)
	}
	return ips, nil
}

func isPrivateCrawlerHost(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return isBlockedCrawlerIP(ip)
}

func isBlockedCrawlerIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

func crawlerRobotsAllowed(policy map[string]any) bool {
	if len(policy) == 0 {
		return false
	}
	robots := strings.ToLower(strings.TrimSpace(stringFromMap(policy, "robots", "")))
	if robots != "allowed" && robots != "allow" {
		return false
	}
	if allowed, ok := policy["direct_activation_allowed"].(bool); ok && allowed {
		return false
	}
	return true
}

func crawlerLegalMetadataComplete(metadata map[string]any) bool {
	return stringFromMap(metadata, "license", "") != "" && stringFromMap(metadata, "owner", "") != ""
}

func crawlerProvenanceComplete(provenance map[string]any) bool {
	return stringFromMap(provenance, "source_url", "") != "" &&
		stringFromMap(provenance, "fetched_at", "") != "" &&
		stringFromMap(provenance, "content_hash", "") != "" &&
		provenance["robots_policy"] != nil
}

func crawlerProvenanceMatchesImport(provenance map[string]any, documentURL, contentHash string) bool {
	return strings.TrimSpace(stringFromMap(provenance, "source_url", "")) == strings.TrimSpace(documentURL) &&
		strings.TrimSpace(stringFromMap(provenance, "content_hash", "")) == strings.TrimSpace(contentHash)
}

func jsonObject(value map[string]any) []byte {
	if value == nil {
		value = map[string]any{}
	}
	data, _ := json.Marshal(value)
	return data
}

func jsonValue(value any) []byte {
	data, _ := json.Marshal(value)
	if len(data) == 0 {
		return []byte("null")
	}
	return data
}

func cleanFilename(filename string) string {
	filename = strings.TrimSpace(strings.ReplaceAll(filename, "\\", "/"))
	parts := strings.Split(filename, "/")
	filename = strings.TrimSpace(parts[len(parts)-1])
	if filename == "." || filename == ".." || strings.Contains(filename, "\x00") {
		return ""
	}
	filename = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		case r == '.', r == '-', r == '_':
			return r
		default:
			return '_'
		}
	}, filename)
	return strings.Trim(filename, ".")
}

func contentTypeAllowed(contentType string, allowed []string) bool {
	for _, candidate := range allowed {
		if strings.EqualFold(strings.TrimSpace(candidate), contentType) {
			return true
		}
	}
	return false
}

func contentTypeForExport(format string) string {
	switch strings.TrimSpace(format) {
	case "pdf":
		return "application/pdf"
	default:
		return "application/zip"
	}
}

func BuildExportThumbnail(exportID, format string, manifest map[string]any) ThumbnailArtifact {
	if strings.TrimSpace(exportID) == "" {
		exportID = "export"
	}
	if strings.TrimSpace(format) == "" {
		format = "zip"
	}
	projectID, _ := manifest["project_id"].(string)
	itemCount := len(manifestItems(manifest))
	svg := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#f7f4ee"/><rect x="32" y="32" width="576" height="296" rx="16" fill="#ffffff" stroke="#202124" stroke-width="4"/><rect x="64" y="74" width="256" height="28" fill="#0f766e"/><rect x="64" y="126" width="420" height="18" fill="#d97706"/><rect x="64" y="164" width="352" height="18" fill="#2563eb"/><rect x="64" y="222" width="128" height="72" fill="#111827"/><rect x="216" y="222" width="128" height="72" fill="#6d28d9"/><rect x="368" y="222" width="128" height="72" fill="#be123c"/><text x="64" y="314" font-family="Arial, sans-serif" font-size="20" fill="#202124">%s %s package, %d items</text></svg>`, xmlEscape(projectID), strings.ToUpper(strings.TrimSpace(format)), itemCount)
	data := []byte(svg)
	sum := sha256.Sum256(data)
	return ThumbnailArtifact{
		ObjectKey:   "thumbnails/" + cleanFilename(exportID+"."+format+".svg"),
		ContentType: "image/svg+xml",
		Width:       640,
		Height:      360,
		ByteSize:    int64(len(data)),
		Checksum:    "sha256:" + hex.EncodeToString(sum[:]),
		Data:        data,
		Metadata: map[string]any{
			"generator":  "stage0_export_thumbnail_svg",
			"project_id": projectID,
			"item_count": itemCount,
		},
	}
}

func exportDeliveryMetadata(format string, manifest map[string]any, extra map[string]any) map[string]any {
	layoutSpec := figmaLayoutSpec(manifest)
	delivery := map[string]any{
		"format":                    format,
		"deterministic_file_naming": true,
		"manifest_embedded":         true,
		"qa_report_embedded":        true,
		"ppt_ready": map[string]any{
			"status":        "placeholder",
			"descriptor":    "slide_manifest",
			"frames_key":    "ppt/frames.json",
			"assets_prefix": "assets/",
		},
		"figma_ready": map[string]any{
			"status":        "ready",
			"descriptor":    "layout_spec",
			"schema":        "zenari.figma_layout_spec.v1",
			"spec_key":      "figma/layout.json",
			"assets_prefix": "assets/",
			"layout":        layoutSpec,
		},
	}
	if projectID, ok := manifest["project_id"].(string); ok && projectID != "" {
		delivery["project_id"] = projectID
	}
	for key, value := range extra {
		delivery[key] = value
	}
	return security.RedactMap(delivery)
}

func figmaLayoutSpec(manifest map[string]any) map[string]any {
	projectID, _ := manifest["project_id"].(string)
	packageID, _ := manifest["package_id"].(string)
	items := manifestItems(manifest)
	frames := make([]map[string]any, 0, len(items))
	for index, item := range items {
		itemID := stringFromMap(item, "id", fmt.Sprintf("item_%02d", index+1))
		title := stringFromMap(item, "title", itemID)
		itemType := stringFromMap(item, "type", "asset")
		x := (index % 2) * 1224
		y := (index / 2) * 844
		frames = append(frames, map[string]any{
			"id":          "frame_" + cleanFilename(itemID),
			"name":        title,
			"source_id":   itemID,
			"source_type": itemType,
			"x":           x,
			"y":           y,
			"width":       1080,
			"height":      720,
			"constraints": map[string]any{
				"horizontal": "scale",
				"vertical":   "scale",
			},
			"asset_ref": "assets/" + cleanFilename(itemID) + ".png",
		})
	}
	if len(frames) == 0 {
		frames = append(frames, map[string]any{
			"id":          "frame_empty_package",
			"name":        "Empty package handoff",
			"source_id":   "",
			"source_type": "placeholder",
			"x":           0,
			"y":           0,
			"width":       1080,
			"height":      720,
			"constraints": map[string]any{"horizontal": "scale", "vertical": "scale"},
			"asset_ref":   "",
		})
	}
	return map[string]any{
		"schema":     "zenari.figma_layout_spec.v1",
		"project_id": projectID,
		"package_id": packageID,
		"document": map[string]any{
			"name":          "Zenari Export " + packageID,
			"color_profile": "srgb",
			"units":         "px",
		},
		"pages": []map[string]any{{
			"id":     "page_export",
			"name":   "Export handoff",
			"frames": frames,
		}},
		"tokens": map[string]any{
			"layout_grid": 8,
			"frame_gap":   144,
		},
	}
}

func manifestItems(manifest map[string]any) []map[string]any {
	raw, ok := manifest["items"].([]map[string]any)
	if ok {
		return raw
	}
	values, ok := manifest["items"].([]any)
	if !ok {
		return nil
	}
	items := make([]map[string]any, 0, len(values))
	for _, value := range values {
		item, ok := value.(map[string]any)
		if ok {
			items = append(items, item)
		}
	}
	return items
}

func stringFromMap(values map[string]any, key, fallback string) string {
	if value, ok := values[key].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func boolFromMap(values map[string]any, key string) bool {
	if value, ok := values[key].(bool); ok {
		return value
	}
	return false
}

func xmlEscape(value string) string {
	value = strings.ReplaceAll(value, "&", "&amp;")
	value = strings.ReplaceAll(value, "<", "&lt;")
	value = strings.ReplaceAll(value, ">", "&gt;")
	value = strings.ReplaceAll(value, `"`, "&quot;")
	return value
}

func nullableString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func tenantScopedObjectKey(tenantID, key string) string {
	prefix := "tenants/" + strings.Trim(strings.TrimSpace(tenantID), "/") + "/"
	key = strings.Trim(strings.TrimSpace(key), "/")
	if strings.HasPrefix(key, prefix) {
		return key
	}
	return prefix + key
}

type Service struct {
	repo           Repository
	objects        objectstore.Store
	scanner        security.MalwareScanner
	downloadURLTTL time.Duration
	downloadSigner func(context.Context, string, string, time.Duration) (string, error)
}

func NewService(repo Repository, objects objectstore.Store, scanners ...security.MalwareScanner) Service {
	var scanner security.MalwareScanner
	if len(scanners) > 0 {
		scanner = scanners[0]
	}
	return Service{
		repo:           repo,
		objects:        objects,
		scanner:        scanner,
		downloadURLTTL: 10 * time.Minute,
	}
}

func (s Service) WithDownloadURLTTL(ttl time.Duration) Service {
	if ttl > 0 {
		s.downloadURLTTL = ttl
	}
	return s
}

func (s Service) WithDownloadURLSigner(signer func(context.Context, string, string, time.Duration) (string, error)) Service {
	if signer != nil {
		s.downloadSigner = signer
	}
	return s
}

func (s Service) Repository() Repository {
	return s.repo
}

func (s Service) PutObject(ctx context.Context, object objectstore.Object, body io.Reader) (objectstore.Object, error) {
	if s.objects == nil {
		return objectstore.Object{}, ErrMissingRepository
	}
	return s.objects.Put(ctx, object, body)
}

func (s Service) PutUploadedObject(ctx context.Context, object objectstore.Object, body io.Reader, failClosed bool) (objectstore.Object, security.MalwareScanResult, error) {
	uploadKey := object.Key
	stored, err := s.PutObject(ctx, object, body)
	if err != nil {
		return objectstore.Object{}, security.MalwareScanResult{}, err
	}
	result, scanErr := scanUpload(ctx, s.scanner, security.MalwareScanTarget{
		TenantID:    stored.TenantID,
		ObjectKey:   stored.Key,
		ContentType: stored.ContentType,
		ByteSize:    stored.ByteSize,
		Checksum:    stored.Checksum,
		Metadata: map[string]string{
			"source": "signed_upload_put",
		},
	})
	if scanErr != nil {
		_ = s.objects.Delete(ctx, stored.TenantID, stored.Key)
		if failClosed {
			return objectstore.Object{}, security.MalwareScanResult{}, ErrMalwareBlocked
		}
		return objectstore.Object{}, security.MalwareScanResult{}, scanErr
	}
	if result.Status == security.MalwareScanStatusSuspicious || (failClosed && result.Status != security.MalwareScanStatusClean) {
		_ = s.objects.Delete(ctx, stored.TenantID, stored.Key)
		return objectstore.Object{}, result, ErrMalwareBlocked
	}
	if err := s.repo.RecordUploadedObjectScan(ctx, object.TenantID, uploadKey, stored, result); err != nil {
		_ = s.objects.Delete(ctx, stored.TenantID, stored.Key)
		return objectstore.Object{}, result, err
	}
	return stored, result, nil
}

func (s Service) GetObject(ctx context.Context, tenantID, key string) (objectstore.Reader, error) {
	reader, _, err := s.GetDownloadableObject(ctx, tenantID, key)
	return reader, err
}

func (s Service) GetDownloadableObject(ctx context.Context, tenantID, key string) (objectstore.Reader, ObjectMetadata, error) {
	if s.objects == nil {
		return objectstore.Reader{}, ObjectMetadata{}, ErrMissingRepository
	}
	metadata, err := s.repo.DownloadableObjectMetadata(ctx, tenantID, key, time.Now().UTC())
	if err != nil {
		return objectstore.Reader{}, ObjectMetadata{}, err
	}
	reader, err := s.objects.Get(ctx, tenantID, key)
	if err != nil {
		return objectstore.Reader{}, ObjectMetadata{}, err
	}
	return reader, metadata, nil
}

func (s Service) CreateUpload(ctx context.Context, opts UploadOptions) (Upload, error) {
	if opts.MalwareScanner == nil {
		opts.MalwareScanner = s.scanner
	}
	return s.repo.CreateUpload(ctx, opts)
}

func (s Service) CreateExport(ctx context.Context, tenantID, userID, packageID string, input ExportCreate, schemaVersion int) (task.Task, error) {
	return s.repo.CreateExport(ctx, tenantID, userID, packageID, input, schemaVersion)
}

func (s Service) EnforceBriefSafety(ctx context.Context, tenantID, projectID string) (SafetyDecision, error) {
	return s.repo.EnforceBriefSafety(ctx, tenantID, projectID)
}

func (s Service) EnforceProviderRequestSafety(ctx context.Context, tenantID, taskID string) (SafetyDecision, error) {
	return s.repo.EnforceProviderRequestSafety(ctx, tenantID, taskID)
}

func (s Service) RequireProviderRequestSafety(ctx context.Context, tenantID, taskID string) error {
	_, err := s.EnforceProviderRequestSafety(ctx, tenantID, taskID)
	return err
}

func (s Service) EnforceProviderResponseSafety(ctx context.Context, tenantID, taskID string) (SafetyDecision, error) {
	return s.repo.EnforceProviderResponseSafety(ctx, tenantID, taskID)
}

func (s Service) RequireProviderResponseSafety(ctx context.Context, tenantID, taskID string) error {
	_, err := s.EnforceProviderResponseSafety(ctx, tenantID, taskID)
	return err
}

func (s Service) EnforceQASafety(ctx context.Context, tenantID, subjectType, subjectID string) (SafetyDecision, error) {
	return s.repo.EnforceQASafety(ctx, tenantID, subjectType, subjectID)
}

func (s Service) EnforceExportSafety(ctx context.Context, tenantID, exportID string) (SafetyDecision, error) {
	return s.repo.EnforceExportSafety(ctx, tenantID, exportID)
}

func (s Service) RunRuntimeSafetyPolicy(ctx context.Context, input RuntimeSafetyPolicyInput) (RuntimeSafetyPolicyResult, error) {
	return s.repo.RunRuntimeSafetyPolicy(ctx, input)
}

func (s Service) StartCrawlerRun(ctx context.Context, tenantID, sourceID string, policy CrawlerPolicy) (CrawlerRun, error) {
	return s.repo.StartCrawlerRun(ctx, tenantID, sourceID, policy)
}

func (s Service) ImportCrawlerFinding(ctx context.Context, input CrawlerImport, policy CrawlerPolicy) (CrawlerImportResult, error) {
	return s.repo.ImportCrawlerFinding(ctx, input, policy)
}

func (s Service) RecordExportArtifact(ctx context.Context, artifact ExportArtifact) (Export, error) {
	if artifact.Thumbnail == nil {
		thumbnail := BuildExportThumbnail(artifact.ExportID, artifact.Format, artifact.Manifest)
		artifact.Thumbnail = &thumbnail
	}
	if s.objects != nil && artifact.Thumbnail != nil && len(artifact.Thumbnail.Data) > 0 {
		stored, err := s.objects.Put(ctx, objectstore.Object{
			TenantID:       artifact.TenantID,
			Bucket:         artifact.Bucket,
			Key:            artifact.Thumbnail.ObjectKey,
			ContentType:    artifact.Thumbnail.ContentType,
			RetentionUntil: artifact.RetentionUntil,
			Metadata:       artifact.Thumbnail.Metadata,
		}, bytes.NewReader(artifact.Thumbnail.Data))
		if err != nil {
			return Export{}, err
		}
		artifact.Thumbnail.ObjectKey = stored.Key
		artifact.Thumbnail.ByteSize = stored.ByteSize
		artifact.Thumbnail.Checksum = stored.Checksum
		if stored.Bucket != "" {
			artifact.Bucket = stored.Bucket
		}
	}
	return s.repo.RecordExportArtifact(ctx, artifact)
}

func (s Service) GetExport(ctx context.Context, tenantID, exportID string) (Export, error) {
	export, err := s.repo.GetExport(ctx, tenantID, exportID)
	if err != nil {
		return Export{}, err
	}
	now := time.Now().UTC()
	if s.objects != nil && s.downloadSigner != nil && export.ObjectID != nil && export.Object != nil && objectDownloadable(*export.Object, now) {
		objectKey := "exports/" + export.ID + "." + export.Format
		if strings.TrimSpace(export.Object.ObjectKey) != "" {
			objectKey = export.Object.ObjectKey
		}
		if signed, err := s.downloadSigner(ctx, tenantID, objectKey, downloadTTLForObject(*export.Object, now, s.downloadURLTTL)); err == nil {
			export.DownloadURL = signed
		}
	}
	return export, nil
}

func objectDownloadable(object ObjectMetadata, now time.Time) bool {
	if !strings.EqualFold(strings.TrimSpace(object.Retention), "active") {
		return false
	}
	return object.RetentionUntil == nil || object.RetentionUntil.After(now)
}

func downloadTTLForObject(object ObjectMetadata, now time.Time, configuredTTL time.Duration) time.Duration {
	if configuredTTL <= 0 {
		configuredTTL = 10 * time.Minute
	}
	if object.RetentionUntil == nil {
		return configuredTTL
	}
	remaining := object.RetentionUntil.Sub(now)
	if remaining <= 0 || remaining > configuredTTL {
		return configuredTTL
	}
	return remaining
}

func (s Service) CleanupExpiredExportsAndOrphanedObjects(ctx context.Context, now time.Time, limit int) (CleanupResult, error) {
	result, err := s.repo.CleanupExpiredExportsAndOrphanedObjects(ctx, now, nil)
	return s.cleanupExpiredExportsAndOrphanedObjects(ctx, "", now, limit, CleanupModeCombined, result, err)
}

func (s Service) CleanupExpiredExportsAndOrphanedObjectsForTenant(ctx context.Context, tenantID string, now time.Time, limit int) (CleanupResult, error) {
	return s.CleanupExpiredExportsAndOrphanedObjectsForTenantMode(ctx, tenantID, now, limit, CleanupModeCombined)
}

func (s Service) CleanupExpiredExportsAndOrphanedObjectsForTenantMode(ctx context.Context, tenantID string, now time.Time, limit int, mode CleanupMode) (CleanupResult, error) {
	normalizedTenantID, err := normalizeCleanupTenantID(tenantID)
	if err != nil {
		return CleanupResult{}, err
	}
	result, err := s.repo.CleanupExpiredExportsAndOrphanedObjectsForTenantMode(ctx, normalizedTenantID, now, mode, nil)
	return s.cleanupExpiredExportsAndOrphanedObjects(ctx, normalizedTenantID, now, limit, mode, result, err)
}

func (s Service) PreviewExpiredExportsAndOrphanedObjectsForTenant(ctx context.Context, tenantID string, now time.Time, limit int) (CleanupResult, error) {
	return s.PreviewExpiredExportsAndOrphanedObjectsForTenantMode(ctx, tenantID, now, limit, CleanupModeCombined)
}

func (s Service) PreviewExpiredExportsAndOrphanedObjectsForTenantMode(ctx context.Context, tenantID string, now time.Time, limit int, mode CleanupMode) (CleanupResult, error) {
	normalizedTenantID, err := normalizeCleanupTenantID(tenantID)
	if err != nil {
		return CleanupResult{}, err
	}
	expiredExports, orphanedObjects, err := s.repo.PreviewCleanupCountsForTenantMode(ctx, normalizedTenantID, now, mode)
	if err != nil {
		return CleanupResult{}, err
	}
	objects, err := s.repo.PreviewCleanupObjectsForTenantMode(ctx, normalizedTenantID, now, limit, mode)
	if err != nil {
		return CleanupResult{}, err
	}
	return CleanupResult{
		ExpiredExports:  expiredExports,
		OrphanedObjects: orphanedObjects,
		PreviewObjects:  len(objects),
		DryRun:          true,
		Status:          "preview",
	}, nil
}

func (s Service) cleanupExpiredExportsAndOrphanedObjects(ctx context.Context, tenantID string, now time.Time, limit int, mode CleanupMode, result CleanupResult, err error) (CleanupResult, error) {
	if err != nil {
		return CleanupResult{}, err
	}
	if s.objects == nil {
		return result, nil
	}
	var objects []CleanupObject
	if tenantID == "" {
		objects, err = s.repo.listCleanupObjects(ctx, "", now, limit, CleanupModeCombined)
	} else {
		objects, err = s.repo.ListCleanupObjectsForTenantMode(ctx, tenantID, now, limit, mode)
	}
	if err != nil {
		return CleanupResult{}, err
	}
	deletedObjects := make([]CleanupObject, 0, len(objects))
	var deleteErr error
	for _, object := range objects {
		if tenantID != "" && object.TenantID != tenantID {
			return result, errors.Join(ErrValidation, fmt.Errorf("cleanup object tenant %q does not match requested tenant %q", object.TenantID, tenantID))
		}
		if err := s.objects.Delete(ctx, object.TenantID, object.Key); err != nil {
			if !errors.Is(err, objectstore.ErrNotFound) {
				deleteErr = errors.Join(deleteErr, err)
				result.FailedObjects++
				continue
			}
		}
		deletedObjects = append(deletedObjects, object)
	}
	deleted, err := s.repo.MarkCleanupObjectsDeleted(ctx, deletedObjects, now)
	if err != nil {
		result.FailedObjects += len(deletedObjects)
		result.Status = cleanupResultStatus(result, err)
		analyticsErr := s.repo.recordCleanupRunAnalyticsForTenant(ctx, now, tenantID, result)
		auditErr := s.repo.recordCleanupRunAuditRefsForTenant(ctx, now, tenantID, result)
		return result, errors.Join(err, analyticsErr, auditErr)
	}
	result.DeletedObjects = deleted
	if deleted < len(deletedObjects) {
		missingAcks := len(deletedObjects) - deleted
		result.FailedObjects += missingAcks
		deleteErr = errors.Join(deleteErr, fmt.Errorf("cleanup metadata acknowledgement missing for %d object(s)", missingAcks))
	}
	var markerDeleted int
	var markerErr error
	runExpiredMarkers, _, modeErr := cleanupModeFlags(mode)
	if modeErr != nil {
		return CleanupResult{}, modeErr
	}
	if runExpiredMarkers {
		if tenantID == "" {
			markerDeleted, markerErr = s.objects.CleanupExpired(ctx, now)
		} else {
			markerDeleted, markerErr = s.objects.CleanupExpiredForTenant(ctx, tenantID, now)
		}
	}
	result.DeletedObjects += markerDeleted
	if markerErr != nil {
		result.FailedObjects++
		deleteErr = errors.Join(deleteErr, markerErr)
	}
	result.Status = cleanupResultStatus(result, deleteErr)
	if err := s.repo.recordCleanupRunAnalyticsForTenant(ctx, now, tenantID, result); err != nil {
		return CleanupResult{}, err
	}
	if err := s.repo.recordCleanupRunAuditRefsForTenant(ctx, now, tenantID, result); err != nil {
		return CleanupResult{}, err
	}
	if deleteErr != nil {
		return result, deleteErr
	}
	return result, nil
}
