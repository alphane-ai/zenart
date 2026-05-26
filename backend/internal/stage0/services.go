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
	ID            string         `json:"id"`
	TenantID      string         `json:"tenant_id,omitempty"`
	PackageID     string         `json:"package_id"`
	TaskID        *string        `json:"task_id,omitempty"`
	Format        string         `json:"format"`
	Status        string         `json:"status"`
	QAStatus      string         `json:"qa_status"`
	ObjectID      *string        `json:"object_metadata_id,omitempty"`
	DownloadURL   string         `json:"download_url,omitempty"`
	Error         map[string]any `json:"error,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
	RegeneratedAt *time.Time     `json:"regenerated_at,omitempty"`
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

func (r Repository) GetExport(ctx context.Context, tenantID, exportID string) (Export, error) {
	var export Export
	var errorJSON []byte
	err := r.db.QueryRow(ctx, `
SELECT id, tenant_id, package_id, task_id, format, status, qa_status, object_metadata_id, error, created_at, updated_at
FROM exports
WHERE tenant_id = $1 AND id = $2`,
		tenantID,
		exportID,
	).Scan(
		&export.ID,
		&export.TenantID,
		&export.PackageID,
		&export.TaskID,
		&export.Format,
		&export.Status,
		&export.QAStatus,
		&export.ObjectID,
		&errorJSON,
		&export.CreatedAt,
		&export.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Export{}, ErrNotFound
	}
	if err != nil {
		return Export{}, err
	}
	if len(errorJSON) > 0 {
		_ = json.Unmarshal(errorJSON, &export.Error)
	}
	return export, nil
}

func (r Repository) ListExports(ctx context.Context, tenantID, status string, limit int) (Page[Export], error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{tenantID, limit}
	query := `
SELECT id, tenant_id, package_id, task_id, format, status, qa_status, object_metadata_id, error, created_at, updated_at
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
		var errorJSON []byte
		if err := rows.Scan(&export.ID, &export.TenantID, &export.PackageID, &export.TaskID, &export.Format, &export.Status, &export.QAStatus, &export.ObjectID, &errorJSON, &export.CreatedAt, &export.UpdatedAt); err != nil {
			return Page[Export]{}, err
		}
		if len(errorJSON) > 0 {
			_ = json.Unmarshal(errorJSON, &export.Error)
		}
		page.Items = append(page.Items, export)
	}
	return page, rows.Err()
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
	body := strings.TrimSpace(input.Body)
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
		Metadata:  input.Metadata,
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
