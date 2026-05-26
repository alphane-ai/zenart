package stage0

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alphane-ai/zenart/backend/internal/id"
	"github.com/alphane-ai/zenart/backend/internal/objectstore"
	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
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
	ErrMissingRepository = errors.New("stage0 repository missing")
)

type Page[T any] struct {
	Items         []T    `json:"items"`
	NextPageToken string `json:"next_page_token,omitempty"`
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

type SupportTicket struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id"`
	UserID         string         `json:"user_id"`
	ProjectID      *string        `json:"project_id,omitempty"`
	Category       string         `json:"category"`
	Status         string         `json:"status"`
	Body           string         `json:"body"`
	LinkedExportID *string        `json:"linked_export_id,omitempty"`
	Metadata       map[string]any `json:"metadata"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type SupportTicketCreate struct {
	ProjectID      string         `json:"project_id"`
	Category       string         `json:"category"`
	Body           string         `json:"body"`
	LinkedExportID string         `json:"linked_export_id"`
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
	ID          string         `json:"id"`
	TenantID    string         `json:"tenant_id,omitempty"`
	ProjectID   *string        `json:"project_id,omitempty"`
	OwnerID     *string        `json:"owner_id,omitempty"`
	AssetType   string         `json:"asset_type"`
	Bucket      string         `json:"bucket"`
	ObjectKey   string         `json:"object_key"`
	ContentType string         `json:"content_type"`
	ByteSize    int64          `json:"byte_size"`
	Checksum    string         `json:"checksum"`
	Provider    string         `json:"provider"`
	Retention   string         `json:"retention_state"`
	DerivedFrom *string        `json:"derived_from_object_id,omitempty"`
	Metadata    map[string]any `json:"metadata"`
	CreatedAt   time.Time      `json:"created_at"`
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
}

type CleanupResult struct {
	ExpiredExports  int `json:"expired_exports"`
	OrphanedObjects int `json:"orphaned_objects"`
	DeletedObjects  int `json:"deleted_objects"`
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

type Repository struct {
	db store.DBTX
}

func NewRepository(db store.DBTX) Repository {
	return Repository{db: db}
}

func (r Repository) CreateExport(ctx context.Context, tenantID, packageID string, input ExportCreate, schemaVersion int) (task.Task, error) {
	format := strings.TrimSpace(input.Format)
	if format == "" {
		format = "zip"
	}
	if format != "zip" && format != "pdf" {
		return task.Task{}, errors.Join(ErrValidation, errors.New("format must be zip or pdf"))
	}
	blocked, err := r.hasBlockingExportQA(ctx, tenantID, packageID)
	if err != nil {
		return task.Task{}, err
	}
	if blocked {
		return task.Task{}, ErrSafetyBlocked
	}

	now := time.Now().UTC()
	taskID := id.New("task")
	exportID := id.New("export")
	_, err = r.db.Exec(ctx, `
INSERT INTO agent_tasks(id, tenant_id, type, schema_version, status, user_status, progress, user_message, app_version, worker_version, metadata, created_at, updated_at)
VALUES($1, $2, 'package_export_builder', $3, 'pending', 'pending', 0, 'Export queued', 'stage0-local', 'stage0-local', $4, $5, $5)`,
		taskID,
		tenantID,
		schemaVersion,
		jsonObject(map[string]any{"package_id": packageID, "format": format, "export_id": exportID}),
		now,
	)
	if err != nil {
		return task.Task{}, err
	}
	_, err = r.db.Exec(ctx, `
INSERT INTO exports(id, tenant_id, package_id, task_id, format, status, qa_status, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, 'pending', 'pending', $6, $6)`,
		exportID,
		tenantID,
		packageID,
		taskID,
		format,
		now,
	)
	if err != nil {
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
		Metadata:      map[string]any{"package_id": packageID, "format": format, "export_id": exportID},
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
		opts.Bucket = "zenart-local"
	}
	if opts.SignURL == nil {
		return Upload{}, errors.New("upload URL signer is required")
	}

	now := time.Now().UTC()
	uploadID := id.New("upload")
	objectID := id.New("object")
	objectKey := "uploads/" + uploadID + "/" + filename
	uploadURL, expiresAt := opts.SignURL(opts.TenantID, objectKey, opts.URLTTL)
	metadata := security.RedactMap(opts.Input.Metadata)
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

	_, err := r.db.Exec(ctx, `
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
	return upload, nil
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
		artifact.Bucket = "zenart-local"
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
	delivery := exportDeliveryMetadata(artifact.Format, artifact.Manifest, artifact.Delivery)
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
	if len(errorJSON) > 0 {
		_ = json.Unmarshal(errorJSON, &export.Error)
	}
	if export.ObjectID != nil && len(objectMetadataJSON) > 0 && string(objectMetadataJSON) != "{}" {
		var object ObjectMetadata
		if err := json.Unmarshal(objectMetadataJSON, &object); err == nil {
			export.Object = &object
		}
	}
	return export, nil
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
		if len(errorJSON) > 0 {
			_ = json.Unmarshal(errorJSON, &export.Error)
		}
		page.Items = append(page.Items, export)
	}
	return page, rows.Err()
}

func (r Repository) CleanupExpiredExportsAndOrphanedObjects(ctx context.Context, now time.Time, objectCleanup func(context.Context, time.Time) (int, error)) (CleanupResult, error) {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	expiredTag, err := r.db.Exec(ctx, `
WITH expired AS (
	SELECT e.id, e.tenant_id, e.object_metadata_id
	FROM exports e
	JOIN object_metadata o ON o.tenant_id = e.tenant_id AND o.id = e.object_metadata_id
	WHERE e.status IN ('ready', 'failed', 'pending')
	  AND o.retention_until IS NOT NULL
	  AND o.retention_until <= $1
)
UPDATE exports e
SET status = 'expired',
    delivery_metadata = delivery_metadata || jsonb_build_object('expired_at', $1::timestamptz),
    updated_at = $1
FROM expired
WHERE e.tenant_id = expired.tenant_id AND e.id = expired.id`,
		now,
	)
	if err != nil {
		return CleanupResult{}, err
	}
	orphanedTag, err := r.db.Exec(ctx, `
UPDATE object_metadata o
SET retention_state = 'orphaned'
WHERE o.retention_state = 'active'
  AND o.asset_type = 'export'
  AND NOT EXISTS (
    SELECT 1
    FROM exports e
    WHERE e.tenant_id = o.tenant_id AND e.object_metadata_id = o.id
  )`,
	)
	if err != nil {
		return CleanupResult{}, err
	}
	result := CleanupResult{
		ExpiredExports:  int(expiredTag.RowsAffected()),
		OrphanedObjects: int(orphanedTag.RowsAffected()),
	}
	if objectCleanup != nil {
		deleted, err := objectCleanup(ctx, now)
		if err != nil {
			return CleanupResult{}, err
		}
		result.DeletedObjects = deleted
	}
	return result, nil
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
	export.Status = "pending"
	export.QAStatus = "pending"
	export.Error = nil
	export.UpdatedAt = now
	export.RegeneratedAt = &now
	return export, nil
}

func (r Repository) CreateSupportTicket(ctx context.Context, tenantID, userID string, input SupportTicketCreate) (SupportTicket, error) {
	category := strings.TrimSpace(input.Category)
	body := security.RedactString(strings.TrimSpace(input.Body))
	if category == "" || body == "" {
		return SupportTicket{}, errors.Join(ErrValidation, errors.New("category and body are required"))
	}
	now := time.Now().UTC()
	ticket := SupportTicket{
		ID:        id.New("support"),
		TenantID:  tenantID,
		UserID:    userID,
		Category:  category,
		Status:    "open",
		Body:      body,
		Metadata:  security.RedactMap(input.Metadata),
		CreatedAt: now,
		UpdatedAt: now,
	}
	if ticket.Metadata == nil {
		ticket.Metadata = map[string]any{}
	}
	if strings.TrimSpace(input.ProjectID) != "" {
		projectID := strings.TrimSpace(input.ProjectID)
		ticket.ProjectID = &projectID
	}
	if strings.TrimSpace(input.LinkedExportID) != "" {
		exportID := strings.TrimSpace(input.LinkedExportID)
		ticket.LinkedExportID = &exportID
	}
	_, err := r.db.Exec(ctx, `
INSERT INTO support_tickets(id, tenant_id, user_id, project_id, category, status, body, linked_export_id, metadata, created_at, updated_at)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
		ticket.ID,
		ticket.TenantID,
		ticket.UserID,
		ticket.ProjectID,
		ticket.Category,
		ticket.Status,
		ticket.Body,
		ticket.LinkedExportID,
		jsonObject(ticket.Metadata),
		now,
	)
	if err != nil {
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
SELECT id, tenant_id, user_id, project_id, category, status, body, linked_export_id, metadata, created_at, updated_at
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
		if err := rows.Scan(&ticket.ID, &ticket.TenantID, &ticket.UserID, &ticket.ProjectID, &ticket.Category, &ticket.Status, &ticket.Body, &ticket.LinkedExportID, &metadataJSON, &ticket.CreatedAt, &ticket.UpdatedAt); err != nil {
			return Page[SupportTicket]{}, err
		}
		_ = json.Unmarshal(metadataJSON, &ticket.Metadata)
		page.Items = append(page.Items, ticket)
	}
	return page, rows.Err()
}

func (r Repository) ListCrawlerSources(ctx context.Context, status string, limit int) (Page[CrawlerSource], error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{limit}
	query := `
SELECT id, tenant_id, name, url, approval_status, legal_metadata, robots_policy, created_at, updated_at
FROM crawler_sources
WHERE TRUE`
	if strings.TrimSpace(status) != "" {
		query += " AND approval_status = $2"
		args = append(args, strings.TrimSpace(status))
	}
	query += " ORDER BY updated_at DESC LIMIT $1"
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
		_ = json.Unmarshal(legalJSON, &source.LegalMetadata)
		_ = json.Unmarshal(robotsJSON, &source.RobotsPolicy)
		page.Items = append(page.Items, source)
	}
	return page, rows.Err()
}

func (r Repository) ListCrawlerFindings(ctx context.Context, status string, limit int) (Page[CrawlerFinding], error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{limit}
	query := `
SELECT id, tenant_id, document_id, finding_type, status, payload, provenance, created_at
FROM crawler_findings
WHERE TRUE`
	if strings.TrimSpace(status) != "" {
		query += " AND status = $2"
		args = append(args, strings.TrimSpace(status))
	}
	query += " ORDER BY created_at DESC LIMIT $1"
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
		page.Items = append(page.Items, finding)
	}
	return page, rows.Err()
}

func (r Repository) ListSafetyRules(ctx context.Context, status string, limit int) (Page[SafetyRule], error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{limit}
	query := `
SELECT id, tenant_id, rule_key, version, domain, severity, action, enforcement_points, status, created_at
FROM safety_rules
WHERE TRUE`
	if strings.TrimSpace(status) != "" {
		query += " AND status = $2"
		args = append(args, strings.TrimSpace(status))
	}
	query += " ORDER BY created_at DESC LIMIT $1"
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

func (r Repository) EnforceSafety(ctx context.Context, tenantID, subjectType, subjectID, point string) (SafetyDecision, error) {
	if strings.TrimSpace(subjectType) == "" || strings.TrimSpace(subjectID) == "" || strings.TrimSpace(point) == "" {
		return SafetyDecision{}, errors.Join(ErrValidation, errors.New("subject_type, subject_id, and enforcement_point are required"))
	}
	rule, ok, err := r.findBlockingRule(ctx, point)
	if err != nil {
		return SafetyDecision{}, err
	}
	decision := "allow"
	rationale := "no active blocking rule matched"
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
	return record, nil
}

func (r Repository) findBlockingRule(ctx context.Context, point string) (SafetyRule, bool, error) {
	rows, err := r.db.Query(ctx, `
SELECT id, tenant_id, rule_key, version, domain, severity, action, enforcement_points, status, created_at
FROM safety_rules
WHERE status = 'active' AND action = 'block'
ORDER BY created_at DESC`)
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

func jsonObject(value map[string]any) []byte {
	if value == nil {
		value = map[string]any{}
	}
	data, _ := json.Marshal(value)
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

func exportDeliveryMetadata(format string, manifest map[string]any, extra map[string]any) map[string]any {
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
			"status":        "placeholder",
			"descriptor":    "layout_spec",
			"spec_key":      "figma/layout.json",
			"assets_prefix": "assets/",
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

func nullableString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
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
	repo    Repository
	objects objectstore.Store
}

func NewService(repo Repository, objects objectstore.Store) Service {
	return Service{repo: repo, objects: objects}
}

func (s Service) Repository() Repository {
	return s.repo
}

func (s Service) CreateExport(ctx context.Context, tenantID, packageID string, input ExportCreate, schemaVersion int) (task.Task, error) {
	return s.repo.CreateExport(ctx, tenantID, packageID, input, schemaVersion)
}

func (s Service) GetExport(ctx context.Context, tenantID, exportID string) (Export, error) {
	export, err := s.repo.GetExport(ctx, tenantID, exportID)
	if err != nil {
		return Export{}, err
	}
	if s.objects != nil && export.ObjectID != nil {
		if signed, err := s.objects.SignGetURL(ctx, tenantID, "exports/"+export.ID+"."+export.Format, 10*time.Minute); err == nil {
			export.DownloadURL = signed
		}
	}
	return export, nil
}
