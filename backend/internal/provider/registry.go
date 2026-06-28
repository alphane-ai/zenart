package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
	"github.com/alphane-ai/zenart/backend/internal/store"
)

type RegistryMode string

const (
	RegistryModeDev        RegistryMode = "dev"
	RegistryModeSandbox    RegistryMode = "sandbox"
	RegistryModeProduction RegistryMode = "production"
)

type RegistryStatus string

const (
	RegistryStatusEnabled    RegistryStatus = "enabled"
	RegistryStatusDisabled   RegistryStatus = "disabled"
	RegistryStatusKillSwitch RegistryStatus = "kill_switch"
)

type RegistryEntry struct {
	ProviderID   string            `json:"provider_id"`
	DisplayName  string            `json:"display_name"`
	Mode         RegistryMode      `json:"mode"`
	Status       RegistryStatus    `json:"status"`
	SecretRef    string            `json:"secret_ref,omitempty"`
	Capabilities []Capability      `json:"capabilities"`
	Routing      RoutingPolicy     `json:"routing"`
	Health       HealthSnapshot    `json:"health"`
	Metadata     map[string]string `json:"metadata,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
}

type RoutingPolicy struct {
	Weight              int      `json:"weight"`
	CanaryPercent       int      `json:"canary_percent"`
	MaxConcurrency      int      `json:"max_concurrency"`
	FallbackProviderIDs []string `json:"fallback_provider_ids,omitempty"`
	KillSwitch          bool     `json:"kill_switch"`
}

type StrategySelectionPolicy string

const (
	StrategySelectionWeighted StrategySelectionPolicy = "weighted"
	StrategySelectionPriority StrategySelectionPolicy = "priority"
	StrategySelectionCanary   StrategySelectionPolicy = "canary"
	StrategySelectionFailover StrategySelectionPolicy = "failover"
)

type StrategyGroupMember struct {
	ProviderID     string `json:"provider_id"`
	Weight         int    `json:"weight"`
	CanaryPercent  int    `json:"canary_percent"`
	MaxConcurrency int    `json:"max_concurrency"`
	FallbackRank   int    `json:"fallback_rank"`
	Enabled        bool   `json:"enabled"`
}

type StrategyGroup struct {
	GroupID             string                  `json:"group_id"`
	DisplayName         string                  `json:"display_name"`
	ToolType            string                  `json:"tool_type"`
	Status              RegistryStatus          `json:"status"`
	SelectionPolicy     StrategySelectionPolicy `json:"selection_policy"`
	FallbackProviderIDs []string                `json:"fallback_provider_ids,omitempty"`
	KillSwitch          bool                    `json:"kill_switch"`
	Members             []StrategyGroupMember   `json:"members"`
	Metadata            map[string]string       `json:"metadata,omitempty"`
	CreatedAt           time.Time               `json:"created_at"`
	UpdatedAt           time.Time               `json:"updated_at"`
}

type StrategyGroupPage struct {
	Items         []StrategyGroup `json:"items"`
	NextPageToken string          `json:"next_page_token,omitempty"`
	TotalCount    int             `json:"total_count"`
}

type StrategyGroupCreate struct {
	GroupID             string                  `json:"group_id"`
	DisplayName         string                  `json:"display_name"`
	ToolType            string                  `json:"tool_type"`
	Status              RegistryStatus          `json:"status"`
	SelectionPolicy     StrategySelectionPolicy `json:"selection_policy"`
	FallbackProviderIDs []string                `json:"fallback_provider_ids,omitempty"`
	KillSwitch          bool                    `json:"kill_switch"`
	Members             []StrategyGroupMember   `json:"members"`
	Metadata            map[string]string       `json:"metadata,omitempty"`
}

type StrategyGroupUpdate struct {
	GroupID             string                  `json:"group_id"`
	DisplayName         string                  `json:"display_name"`
	ToolType            string                  `json:"tool_type"`
	Status              RegistryStatus          `json:"status"`
	SelectionPolicy     StrategySelectionPolicy `json:"selection_policy"`
	FallbackProviderIDs []string                `json:"fallback_provider_ids,omitempty"`
	KillSwitch          bool                    `json:"kill_switch"`
	Members             []StrategyGroupMember   `json:"members"`
	Metadata            map[string]string       `json:"metadata,omitempty"`
}

type StrategyGroupCreateResult struct {
	Created StrategyGroup `json:"created"`
}

type StrategyGroupUpdateResult struct {
	Before StrategyGroup `json:"before"`
	After  StrategyGroup `json:"after"`
}

type HealthSnapshot struct {
	Available        bool      `json:"available"`
	LatencyMS        int64     `json:"latency_ms"`
	ErrorRatePercent int       `json:"error_rate_percent"`
	LastCheckedAt    time.Time `json:"last_checked_at"`
	Message          string    `json:"message,omitempty"`
}

type AdminRegistryProjection struct {
	ProviderID    string            `json:"provider_id"`
	DisplayName   string            `json:"display_name"`
	Mode          RegistryMode      `json:"mode"`
	Status        RegistryStatus    `json:"status"`
	SecretRef     string            `json:"secret_ref,omitempty"`
	Capabilities  []Capability      `json:"capabilities"`
	Routing       RoutingPolicy     `json:"routing"`
	Health        HealthSnapshot    `json:"health"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	SecretPresent bool              `json:"secret_present"`
	UpdatedAt     time.Time         `json:"updated_at"`
}

type PublicModelProjection struct {
	ProviderID    string   `json:"provider_id"`
	ModelID       string   `json:"model_id"`
	Endpoints     []string `json:"endpoints"`
	ToolTypes     []string `json:"tool_types,omitempty"`
	SupportsBatch bool     `json:"supports_batch"`
}

type RegistryPage struct {
	Items         []AdminRegistryProjection `json:"items"`
	NextPageToken string                    `json:"next_page_token,omitempty"`
	TotalCount    int                       `json:"total_count"`
}

type RegistryUpdate struct {
	ProviderID    string         `json:"provider_id"`
	Status        RegistryStatus `json:"status"`
	SecretRef     *string        `json:"secret_ref,omitempty"`
	Routing       RoutingPolicy  `json:"routing"`
	Capabilities  []Capability   `json:"capabilities,omitempty"`
	SetCapability bool           `json:"-"`
}

type RegistryUpdateResult struct {
	Before AdminRegistryProjection `json:"before"`
	After  AdminRegistryProjection `json:"after"`
}

type RegistryCreate struct {
	ProviderID   string            `json:"provider_id"`
	DisplayName  string            `json:"display_name"`
	Mode         RegistryMode      `json:"mode"`
	Status       RegistryStatus    `json:"status"`
	SecretRef    string            `json:"secret_ref,omitempty"`
	Routing      RoutingPolicy     `json:"routing"`
	Health       HealthSnapshot    `json:"health"`
	Capabilities []Capability      `json:"capabilities"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

type RegistryCreateResult struct {
	Created AdminRegistryProjection `json:"created"`
}

type RegistryDelete struct {
	ProviderID string `json:"provider_id"`
}

type RegistryDeleteResult struct {
	Deleted AdminRegistryProjection `json:"deleted"`
}

type RegistryHealthProbe struct {
	ProviderID string `json:"provider_id"`
	Status     Status `json:"status"`
}

type RegistryHealthProbeResult struct {
	Before AdminRegistryProjection `json:"before"`
	After  AdminRegistryProjection `json:"after"`
}

type SandboxTestCallInput struct {
	ProviderID string `json:"provider_id"`
	ModelID    string `json:"model_id"`
	ToolType   string `json:"tool_type"`
	Prompt     string `json:"prompt"`
	Rationale  string `json:"rationale"`
}

type SandboxTestCallResult struct {
	ID              string            `json:"id"`
	ProviderID      string            `json:"provider_id"`
	ModelID         string            `json:"model_id"`
	ToolType        string            `json:"tool_type"`
	Status          string            `json:"status"`
	Mode            RegistryMode      `json:"mode"`
	Capability      Capability        `json:"capability"`
	SecretRef       string            `json:"secret_ref,omitempty"`
	SecretPresent   bool              `json:"secret_present"`
	AssetPersisted  bool              `json:"asset_persisted"`
	UserVisible     bool              `json:"user_visible"`
	TraceID         string            `json:"trace_id"`
	LatencyMS       int64             `json:"latency_ms"`
	EstimatedCost   int64             `json:"estimated_cost_cents"`
	OutputPreview   map[string]string `json:"output_preview"`
	RoutingSnapshot RoutingPolicy     `json:"routing_snapshot"`
	CreatedAt       time.Time         `json:"created_at"`
}

type RegistryReader interface {
	ListAdminRegistry(ctx context.Context, limit int) (RegistryPage, error)
	CreateAdminRegistry(ctx context.Context, create RegistryCreate) (RegistryCreateResult, error)
	UpdateAdminRegistry(ctx context.Context, update RegistryUpdate) (RegistryUpdateResult, error)
	DeleteAdminRegistry(ctx context.Context, delete RegistryDelete) (RegistryDeleteResult, error)
	ProbeAdminRegistryHealth(ctx context.Context, probe RegistryHealthProbe) (RegistryHealthProbeResult, error)
	RunSandboxTestCall(ctx context.Context, input SandboxTestCallInput) (SandboxTestCallResult, error)
	ListStrategyGroups(ctx context.Context, limit int) (StrategyGroupPage, error)
	CreateStrategyGroup(ctx context.Context, create StrategyGroupCreate) (StrategyGroupCreateResult, error)
	UpdateStrategyGroup(ctx context.Context, update StrategyGroupUpdate) (StrategyGroupUpdateResult, error)
}

type registryReaderKey struct{}

func ContextWithRegistryReader(ctx context.Context, reader RegistryReader) context.Context {
	return context.WithValue(ctx, registryReaderKey{}, reader)
}

func RegistryReaderFromContext(ctx context.Context) (RegistryReader, bool) {
	reader, ok := ctx.Value(registryReaderKey{}).(RegistryReader)
	return reader, ok
}

type RegistryRepository struct {
	db store.DBTX
}

func NewRegistryRepository(db store.DBTX) RegistryRepository {
	return RegistryRepository{db: db}
}

const registryEntrySelectSQL = `
SELECT
	pr.provider_id,
	pr.display_name,
	pr.mode,
	pr.status,
	pr.secret_ref,
	pr.routing,
	pr.health,
	pr.metadata,
	pr.created_at,
	pr.updated_at,
	COALESCE(
		jsonb_agg(
			jsonb_build_object(
				'provider_id', pmc.provider_id,
				'model_id', pmc.model_id,
				'endpoints', pmc.endpoints,
				'input_types', pmc.input_types,
				'output_types', pmc.output_types,
				'tool_types', pmc.tool_types,
				'max_cost_units', pmc.max_cost_units,
				'cost_currency', pmc.cost_currency,
				'estimated_cost_cents', pmc.estimated_cost_cents,
				'supports_batch', pmc.supports_batch,
				'max_batch_size', pmc.max_batch_size,
				'supports_seed', pmc.supports_seed,
				'supports_cancel', pmc.supports_cancel,
				'supported_aspect_ratios', pmc.supported_aspect_ratios,
				'supported_qualities', pmc.supported_qualities
			)
			ORDER BY pmc.model_id
		) FILTER (WHERE pmc.id IS NOT NULL),
		'[]'::jsonb
	) AS capabilities`

const strategyGroupSelectSQL = `
SELECT
	psg.group_id,
	psg.display_name,
	psg.tool_type,
	psg.status,
	psg.selection_policy,
	psg.fallback_provider_ids,
	psg.kill_switch,
	psg.metadata,
	psg.created_at,
	psg.updated_at,
	COALESCE(
		jsonb_agg(
			jsonb_build_object(
				'provider_id', psgm.provider_id,
				'weight', psgm.weight,
				'canary_percent', psgm.canary_percent,
				'max_concurrency', psgm.max_concurrency,
				'fallback_rank', psgm.fallback_rank,
				'enabled', psgm.enabled
			)
			ORDER BY psgm.fallback_rank, psgm.provider_id
		) FILTER (WHERE psgm.id IS NOT NULL),
		'[]'::jsonb
	) AS members`

func (r RegistryRepository) ListAdminRegistry(ctx context.Context, limit int) (RegistryPage, error) {
	if r.db == nil {
		return RegistryPage{}, errors.New("provider registry database is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := r.db.Query(ctx, registryEntrySelectSQL+`,
	COUNT(*) OVER() AS total_count
FROM provider_registry pr
LEFT JOIN provider_model_capabilities pmc ON pmc.provider_registry_id = pr.id
GROUP BY pr.id
ORDER BY pr.provider_id
LIMIT $1`,
		limit,
	)
	if err != nil {
		return RegistryPage{}, err
	}
	defer rows.Close()

	items := make([]AdminRegistryProjection, 0)
	totalCount := 0
	for rows.Next() {
		entry, count, err := scanRegistryEntry(rows)
		if err != nil {
			return RegistryPage{}, err
		}
		if err := ValidateRegistryEntry(entry); err != nil {
			return RegistryPage{}, err
		}
		items = append(items, entry.AdminProjection())
		totalCount = count
	}
	if err := rows.Err(); err != nil {
		return RegistryPage{}, err
	}
	return RegistryPage{
		Items:      items,
		TotalCount: totalCount,
	}, nil
}

func (r RegistryRepository) CreateAdminRegistry(ctx context.Context, create RegistryCreate) (RegistryCreateResult, error) {
	if r.db == nil {
		return RegistryCreateResult{}, errors.New("provider registry database is required")
	}
	now := time.Now().UTC()
	entry := RegistryEntry{
		ProviderID:   strings.TrimSpace(create.ProviderID),
		DisplayName:  strings.TrimSpace(create.DisplayName),
		Mode:         create.Mode,
		Status:       create.Status,
		SecretRef:    strings.TrimSpace(create.SecretRef),
		Capabilities: normalizedCapabilities(create.ProviderID, create.Capabilities),
		Routing:      create.Routing,
		Health:       create.Health,
		Metadata:     normalizeMetadata(create.Metadata),
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if entry.Status == RegistryStatusKillSwitch {
		entry.Routing.KillSwitch = true
	}
	if entry.Routing.KillSwitch && entry.Status == RegistryStatusEnabled {
		entry.Status = RegistryStatusKillSwitch
	}
	if err := ValidateRegistryEntry(entry); err != nil {
		return RegistryCreateResult{}, err
	}
	db := r.db
	if transactor, ok := r.db.(store.Transactor); ok {
		tx, err := transactor.Begin(ctx)
		if err != nil {
			return RegistryCreateResult{}, err
		}
		defer tx.Rollback(ctx)
		db = tx
	}
	repo := RegistryRepository{db: db}
	routingJSON, err := json.Marshal(entry.Routing)
	if err != nil {
		return RegistryCreateResult{}, err
	}
	healthJSON, err := json.Marshal(entry.Health)
	if err != nil {
		return RegistryCreateResult{}, err
	}
	metadataJSON, err := json.Marshal(entry.Metadata)
	if err != nil {
		return RegistryCreateResult{}, err
	}
	tag, err := db.Exec(ctx, `
INSERT INTO provider_registry (
	id,
	provider_id,
	display_name,
	mode,
	status,
	secret_ref,
	routing,
	health,
	metadata,
	created_at,
	updated_at
) VALUES (
	$1,
	$2,
	$3,
	$4,
	$5,
	$6,
	$7::jsonb,
	$8::jsonb,
	$9::jsonb,
	now(),
	now()
)`,
		entry.ProviderID,
		entry.ProviderID,
		entry.DisplayName,
		string(entry.Mode),
		string(entry.Status),
		entry.SecretRef,
		routingJSON,
		healthJSON,
		metadataJSON,
	)
	if err != nil {
		return RegistryCreateResult{}, err
	}
	if tag.RowsAffected() == 0 {
		return RegistryCreateResult{}, errors.New("provider registry create did not insert a row")
	}
	if err := repo.replaceCapabilities(ctx, entry, entry.Capabilities); err != nil {
		return RegistryCreateResult{}, err
	}
	created, err := repo.getEntry(ctx, entry.ProviderID)
	if err != nil {
		return RegistryCreateResult{}, err
	}
	if tx, ok := db.(store.Tx); ok {
		if err := tx.Commit(ctx); err != nil {
			return RegistryCreateResult{}, err
		}
	}
	return RegistryCreateResult{Created: created.AdminProjection()}, nil
}

func (r RegistryRepository) UpdateAdminRegistry(ctx context.Context, update RegistryUpdate) (RegistryUpdateResult, error) {
	if r.db == nil {
		return RegistryUpdateResult{}, errors.New("provider registry database is required")
	}
	update.ProviderID = strings.TrimSpace(update.ProviderID)
	if update.ProviderID == "" {
		return RegistryUpdateResult{}, errors.New("provider_id is required")
	}
	if err := ValidateRegistryStatus(update.Status); err != nil {
		return RegistryUpdateResult{}, err
	}
	if err := ValidateRoutingPolicy(update.Routing); err != nil {
		return RegistryUpdateResult{}, err
	}
	if update.Status == RegistryStatusKillSwitch {
		update.Routing.KillSwitch = true
	}
	if update.Routing.KillSwitch && update.Status == RegistryStatusEnabled {
		update.Status = RegistryStatusKillSwitch
	}
	before, err := r.getEntry(ctx, update.ProviderID)
	if err != nil {
		return RegistryUpdateResult{}, err
	}
	updated := before
	updated.Status = update.Status
	updated.Routing = update.Routing
	if update.SecretRef != nil {
		updated.SecretRef = strings.TrimSpace(*update.SecretRef)
	}
	if update.SetCapability {
		updated.Capabilities = normalizedCapabilities(update.ProviderID, update.Capabilities)
	}
	if err := ValidateRegistryEntry(updated); err != nil {
		return RegistryUpdateResult{}, err
	}
	routingJSON, err := json.Marshal(update.Routing)
	if err != nil {
		return RegistryUpdateResult{}, err
	}
	tag, err := r.db.Exec(ctx, `
UPDATE provider_registry
SET status = $2, routing = $3::jsonb, secret_ref = $4, updated_at = now()
WHERE provider_id = $1`,
		update.ProviderID,
		string(update.Status),
		routingJSON,
		updated.SecretRef,
	)
	if err != nil {
		return RegistryUpdateResult{}, err
	}
	if tag.RowsAffected() == 0 {
		return RegistryUpdateResult{}, ErrRegistryNotFound
	}
	if update.SetCapability {
		if err := r.replaceCapabilities(ctx, before, updated.Capabilities); err != nil {
			return RegistryUpdateResult{}, err
		}
	}
	after, err := r.getEntry(ctx, update.ProviderID)
	if err != nil {
		return RegistryUpdateResult{}, err
	}
	return RegistryUpdateResult{
		Before: before.AdminProjection(),
		After:  after.AdminProjection(),
	}, nil
}

func (r RegistryRepository) DeleteAdminRegistry(ctx context.Context, delete RegistryDelete) (RegistryDeleteResult, error) {
	if r.db == nil {
		return RegistryDeleteResult{}, errors.New("provider registry database is required")
	}
	providerID := strings.TrimSpace(delete.ProviderID)
	if providerID == "" {
		return RegistryDeleteResult{}, errors.New("provider_id is required")
	}
	db := r.db
	if transactor, ok := r.db.(store.Transactor); ok {
		tx, err := transactor.Begin(ctx)
		if err != nil {
			return RegistryDeleteResult{}, err
		}
		defer tx.Rollback(ctx)
		db = tx
	}
	repo := RegistryRepository{db: db}
	before, err := repo.getEntry(ctx, providerID)
	if err != nil {
		return RegistryDeleteResult{}, err
	}
	if _, err := db.Exec(ctx, `DELETE FROM provider_model_capabilities WHERE provider_id = $1`, providerID); err != nil {
		return RegistryDeleteResult{}, err
	}
	tag, err := db.Exec(ctx, `DELETE FROM provider_registry WHERE provider_id = $1`, providerID)
	if err != nil {
		return RegistryDeleteResult{}, err
	}
	if tag.RowsAffected() == 0 {
		return RegistryDeleteResult{}, ErrRegistryNotFound
	}
	if tx, ok := db.(store.Tx); ok {
		if err := tx.Commit(ctx); err != nil {
			return RegistryDeleteResult{}, err
		}
	}
	return RegistryDeleteResult{Deleted: before.AdminProjection()}, nil
}

func (r RegistryRepository) ProbeAdminRegistryHealth(ctx context.Context, probe RegistryHealthProbe) (RegistryHealthProbeResult, error) {
	if r.db == nil {
		return RegistryHealthProbeResult{}, errors.New("provider registry database is required")
	}
	providerID := strings.TrimSpace(probe.ProviderID)
	if providerID == "" {
		return RegistryHealthProbeResult{}, errors.New("provider_id is required")
	}
	before, err := r.getEntry(ctx, providerID)
	if err != nil {
		return RegistryHealthProbeResult{}, err
	}
	health := HealthSnapshot{
		Available:        probe.Status.Available,
		LatencyMS:        probe.Status.LatencyMS,
		ErrorRatePercent: healthErrorRateFromStatus(probe.Status),
		LastCheckedAt:    probe.Status.CheckedAt.UTC(),
		Message:          strings.TrimSpace(security.RedactString(probe.Status.Message)),
	}
	if health.LastCheckedAt.IsZero() {
		health.LastCheckedAt = time.Now().UTC()
	}
	if strings.Contains(health.Message, security.Redacted) {
		health.Message = "provider health probe returned redacted details"
	}
	if err := ValidateHealthSnapshot(health); err != nil {
		return RegistryHealthProbeResult{}, err
	}
	healthJSON, err := json.Marshal(health)
	if err != nil {
		return RegistryHealthProbeResult{}, err
	}
	tag, err := r.db.Exec(ctx, `
UPDATE provider_registry
SET health = $2::jsonb, updated_at = now()
WHERE provider_id = $1`,
		providerID,
		healthJSON,
	)
	if err != nil {
		return RegistryHealthProbeResult{}, err
	}
	if tag.RowsAffected() == 0 {
		return RegistryHealthProbeResult{}, ErrRegistryNotFound
	}
	after, err := r.getEntry(ctx, providerID)
	if err != nil {
		return RegistryHealthProbeResult{}, err
	}
	return RegistryHealthProbeResult{
		Before: before.AdminProjection(),
		After:  after.AdminProjection(),
	}, nil
}

func (r RegistryRepository) RunSandboxTestCall(ctx context.Context, input SandboxTestCallInput) (SandboxTestCallResult, error) {
	if r.db == nil {
		return SandboxTestCallResult{}, errors.New("provider registry database is required")
	}
	if err := ValidateSandboxTestCallInput(input); err != nil {
		return SandboxTestCallResult{}, err
	}
	entry, err := r.getEntry(ctx, strings.TrimSpace(input.ProviderID))
	if err != nil {
		return SandboxTestCallResult{}, err
	}
	return BuildSandboxTestCallResult(entry, input)
}

func (r RegistryRepository) ListStrategyGroups(ctx context.Context, limit int) (StrategyGroupPage, error) {
	if r.db == nil {
		return StrategyGroupPage{}, errors.New("provider registry database is required")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	rows, err := r.db.Query(ctx, strategyGroupSelectSQL+`,
	COUNT(*) OVER() AS total_count
FROM provider_strategy_groups psg
LEFT JOIN provider_strategy_group_members psgm ON psgm.strategy_group_id = psg.id
GROUP BY psg.id
ORDER BY psg.group_id
LIMIT $1`,
		limit,
	)
	if err != nil {
		return StrategyGroupPage{}, err
	}
	defer rows.Close()

	items := make([]StrategyGroup, 0)
	totalCount := 0
	for rows.Next() {
		group, count, err := scanStrategyGroup(rows)
		if err != nil {
			return StrategyGroupPage{}, err
		}
		if err := ValidateStrategyGroup(group); err != nil {
			return StrategyGroupPage{}, err
		}
		items = append(items, group)
		totalCount = count
	}
	if err := rows.Err(); err != nil {
		return StrategyGroupPage{}, err
	}
	return StrategyGroupPage{Items: items, TotalCount: totalCount}, nil
}

func (r RegistryRepository) CreateStrategyGroup(ctx context.Context, create StrategyGroupCreate) (StrategyGroupCreateResult, error) {
	if r.db == nil {
		return StrategyGroupCreateResult{}, errors.New("provider registry database is required")
	}
	now := time.Now().UTC()
	group := StrategyGroup{
		GroupID:             strings.TrimSpace(create.GroupID),
		DisplayName:         strings.TrimSpace(create.DisplayName),
		ToolType:            strings.TrimSpace(create.ToolType),
		Status:              create.Status,
		SelectionPolicy:     create.SelectionPolicy,
		FallbackProviderIDs: normalizedStringSlice(create.FallbackProviderIDs),
		KillSwitch:          create.KillSwitch,
		Members:             normalizedStrategyGroupMembers(create.Members),
		Metadata:            normalizeMetadata(create.Metadata),
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	normalizeStrategyGroupStatus(&group)
	if err := ValidateStrategyGroup(group); err != nil {
		return StrategyGroupCreateResult{}, err
	}
	db := r.db
	if transactor, ok := r.db.(store.Transactor); ok {
		tx, err := transactor.Begin(ctx)
		if err != nil {
			return StrategyGroupCreateResult{}, err
		}
		defer tx.Rollback(ctx)
		db = tx
	}
	repo := RegistryRepository{db: db}
	fallbackJSON, err := json.Marshal(group.FallbackProviderIDs)
	if err != nil {
		return StrategyGroupCreateResult{}, err
	}
	metadataJSON, err := json.Marshal(group.Metadata)
	if err != nil {
		return StrategyGroupCreateResult{}, err
	}
	tag, err := db.Exec(ctx, `
INSERT INTO provider_strategy_groups (
	id,
	group_id,
	display_name,
	tool_type,
	status,
	selection_policy,
	fallback_provider_ids,
	kill_switch,
	metadata,
	created_at,
	updated_at
) VALUES (
	$1,
	$2,
	$3,
	$4,
	$5,
	$6,
	ARRAY(SELECT jsonb_array_elements_text($7::jsonb)),
	$8,
	$9::jsonb,
	now(),
	now()
)`,
		group.GroupID,
		group.GroupID,
		group.DisplayName,
		group.ToolType,
		string(group.Status),
		string(group.SelectionPolicy),
		fallbackJSON,
		group.KillSwitch,
		metadataJSON,
	)
	if err != nil {
		return StrategyGroupCreateResult{}, err
	}
	if tag.RowsAffected() == 0 {
		return StrategyGroupCreateResult{}, errors.New("provider strategy group create did not insert a row")
	}
	if err := repo.replaceStrategyGroupMembers(ctx, group); err != nil {
		return StrategyGroupCreateResult{}, err
	}
	created, err := repo.getStrategyGroup(ctx, group.GroupID)
	if err != nil {
		return StrategyGroupCreateResult{}, err
	}
	if tx, ok := db.(store.Tx); ok {
		if err := tx.Commit(ctx); err != nil {
			return StrategyGroupCreateResult{}, err
		}
	}
	return StrategyGroupCreateResult{Created: created}, nil
}

func (r RegistryRepository) UpdateStrategyGroup(ctx context.Context, update StrategyGroupUpdate) (StrategyGroupUpdateResult, error) {
	if r.db == nil {
		return StrategyGroupUpdateResult{}, errors.New("provider registry database is required")
	}
	groupID := strings.TrimSpace(update.GroupID)
	if groupID == "" {
		return StrategyGroupUpdateResult{}, errors.New("group_id is required")
	}
	before, err := r.getStrategyGroup(ctx, groupID)
	if err != nil {
		return StrategyGroupUpdateResult{}, err
	}
	after := StrategyGroup{
		GroupID:             groupID,
		DisplayName:         strings.TrimSpace(firstNonEmpty(update.DisplayName, before.DisplayName)),
		ToolType:            strings.TrimSpace(firstNonEmpty(update.ToolType, before.ToolType)),
		Status:              update.Status,
		SelectionPolicy:     update.SelectionPolicy,
		FallbackProviderIDs: normalizedStringSlice(update.FallbackProviderIDs),
		KillSwitch:          update.KillSwitch,
		Members:             normalizedStrategyGroupMembers(update.Members),
		Metadata:            normalizeMetadata(update.Metadata),
		CreatedAt:           before.CreatedAt,
		UpdatedAt:           time.Now().UTC(),
	}
	normalizeStrategyGroupStatus(&after)
	if err := ValidateStrategyGroup(after); err != nil {
		return StrategyGroupUpdateResult{}, err
	}
	db := r.db
	if transactor, ok := r.db.(store.Transactor); ok {
		tx, err := transactor.Begin(ctx)
		if err != nil {
			return StrategyGroupUpdateResult{}, err
		}
		defer tx.Rollback(ctx)
		db = tx
	}
	repo := RegistryRepository{db: db}
	fallbackJSON, err := json.Marshal(after.FallbackProviderIDs)
	if err != nil {
		return StrategyGroupUpdateResult{}, err
	}
	metadataJSON, err := json.Marshal(after.Metadata)
	if err != nil {
		return StrategyGroupUpdateResult{}, err
	}
	tag, err := db.Exec(ctx, `
UPDATE provider_strategy_groups
SET display_name = $2,
	tool_type = $3,
	status = $4,
	selection_policy = $5,
	fallback_provider_ids = ARRAY(SELECT jsonb_array_elements_text($6::jsonb)),
	kill_switch = $7,
	metadata = $8::jsonb,
	updated_at = now()
WHERE group_id = $1`,
		groupID,
		after.DisplayName,
		after.ToolType,
		string(after.Status),
		string(after.SelectionPolicy),
		fallbackJSON,
		after.KillSwitch,
		metadataJSON,
	)
	if err != nil {
		return StrategyGroupUpdateResult{}, err
	}
	if tag.RowsAffected() == 0 {
		return StrategyGroupUpdateResult{}, ErrRegistryNotFound
	}
	if err := repo.replaceStrategyGroupMembers(ctx, after); err != nil {
		return StrategyGroupUpdateResult{}, err
	}
	updated, err := repo.getStrategyGroup(ctx, groupID)
	if err != nil {
		return StrategyGroupUpdateResult{}, err
	}
	if tx, ok := db.(store.Tx); ok {
		if err := tx.Commit(ctx); err != nil {
			return StrategyGroupUpdateResult{}, err
		}
	}
	return StrategyGroupUpdateResult{Before: before, After: updated}, nil
}

func (r RegistryRepository) replaceCapabilities(ctx context.Context, entry RegistryEntry, capabilities []Capability) error {
	if strings.TrimSpace(entry.ProviderID) == "" {
		return errors.New("provider_id is required")
	}
	if _, err := r.db.Exec(ctx, `DELETE FROM provider_model_capabilities WHERE provider_id = $1`, entry.ProviderID); err != nil {
		return err
	}
	for _, capability := range capabilities {
		if err := ValidateCapability(capability); err != nil {
			return err
		}
		endpointsJSON, err := json.Marshal(capability.Endpoints)
		if err != nil {
			return err
		}
		inputTypesJSON, err := json.Marshal(capability.InputTypes)
		if err != nil {
			return err
		}
		outputTypesJSON, err := json.Marshal(capability.OutputTypes)
		if err != nil {
			return err
		}
		toolTypesJSON, err := json.Marshal(capability.ToolTypes)
		if err != nil {
			return err
		}
		aspectRatiosJSON, err := json.Marshal(capability.SupportedAspectRatios)
		if err != nil {
			return err
		}
		qualitiesJSON, err := json.Marshal(capability.SupportedQualities)
		if err != nil {
			return err
		}
		if _, err := r.db.Exec(ctx, `
INSERT INTO provider_model_capabilities (
	id,
	provider_registry_id,
	provider_id,
	model_id,
	endpoints,
	input_types,
	output_types,
	tool_types,
	max_cost_units,
	cost_currency,
	estimated_cost_cents,
	supports_batch,
	max_batch_size,
	supports_seed,
	supports_cancel,
	supported_aspect_ratios,
	supported_qualities,
	created_at,
	updated_at
)
SELECT
	$1,
	pr.id,
	$2,
	$3,
	ARRAY(SELECT jsonb_array_elements_text($4::jsonb)),
	ARRAY(SELECT jsonb_array_elements_text($5::jsonb)),
	ARRAY(SELECT jsonb_array_elements_text($6::jsonb)),
	ARRAY(SELECT jsonb_array_elements_text($7::jsonb)),
	$8,
	$9,
	$10,
	$11,
	$12,
	$13,
	$14,
	ARRAY(SELECT jsonb_array_elements_text($15::jsonb)),
	ARRAY(SELECT jsonb_array_elements_text($16::jsonb)),
	now(),
	now()
FROM provider_registry pr
WHERE pr.provider_id = $2`,
			entry.ProviderID+":"+capability.ModelID,
			entry.ProviderID,
			capability.ModelID,
			endpointsJSON,
			inputTypesJSON,
			outputTypesJSON,
			toolTypesJSON,
			capability.MaxCostUnits,
			capability.CostCurrency,
			capability.EstimatedCostCents,
			capability.SupportsBatch,
			normalizedMaxBatchSize(capability),
			capability.SupportsSeed,
			capability.SupportsCancel,
			aspectRatiosJSON,
			qualitiesJSON,
		); err != nil {
			return err
		}
	}
	return nil
}

func (r RegistryRepository) replaceStrategyGroupMembers(ctx context.Context, group StrategyGroup) error {
	if strings.TrimSpace(group.GroupID) == "" {
		return errors.New("group_id is required")
	}
	if _, err := r.db.Exec(ctx, `DELETE FROM provider_strategy_group_members WHERE group_id = $1`, group.GroupID); err != nil {
		return err
	}
	for _, member := range group.Members {
		if err := ValidateStrategyGroupMember(member); err != nil {
			return err
		}
		if _, err := r.db.Exec(ctx, `
INSERT INTO provider_strategy_group_members (
	id,
	strategy_group_id,
	group_id,
	provider_id,
	weight,
	canary_percent,
	max_concurrency,
	fallback_rank,
	enabled,
	created_at,
	updated_at
)
SELECT
	$1,
	psg.id,
	$2,
	$3,
	$4,
	$5,
	$6,
	$7,
	$8,
	now(),
	now()
FROM provider_strategy_groups psg
WHERE psg.group_id = $2`,
			group.GroupID+":"+member.ProviderID,
			group.GroupID,
			member.ProviderID,
			member.Weight,
			member.CanaryPercent,
			member.MaxConcurrency,
			member.FallbackRank,
			member.Enabled,
		); err != nil {
			return err
		}
	}
	return nil
}

func (r RegistryRepository) getEntry(ctx context.Context, providerID string) (RegistryEntry, error) {
	rows, err := r.db.Query(ctx, registryEntrySelectSQL+`,
	1::bigint AS total_count
FROM provider_registry pr
LEFT JOIN provider_model_capabilities pmc ON pmc.provider_registry_id = pr.id
WHERE pr.provider_id = $1
GROUP BY pr.id
LIMIT 1`,
		providerID,
	)
	if err != nil {
		return RegistryEntry{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return RegistryEntry{}, ErrRegistryNotFound
	}
	entry, _, err := scanRegistryEntry(rows)
	if err != nil {
		return RegistryEntry{}, err
	}
	if err := ValidateRegistryEntry(entry); err != nil {
		return RegistryEntry{}, err
	}
	return entry, rows.Err()
}

func (r RegistryRepository) getStrategyGroup(ctx context.Context, groupID string) (StrategyGroup, error) {
	rows, err := r.db.Query(ctx, strategyGroupSelectSQL+`,
	1::bigint AS total_count
FROM provider_strategy_groups psg
LEFT JOIN provider_strategy_group_members psgm ON psgm.strategy_group_id = psg.id
WHERE psg.group_id = $1
GROUP BY psg.id
LIMIT 1`,
		groupID,
	)
	if err != nil {
		return StrategyGroup{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return StrategyGroup{}, ErrRegistryNotFound
	}
	group, _, err := scanStrategyGroup(rows)
	if err != nil {
		return StrategyGroup{}, err
	}
	if err := ValidateStrategyGroup(group); err != nil {
		return StrategyGroup{}, err
	}
	return group, rows.Err()
}

func ValidateSandboxTestCallInput(input SandboxTestCallInput) error {
	if strings.TrimSpace(input.ProviderID) == "" {
		return errors.New("provider_id is required")
	}
	if strings.TrimSpace(input.ModelID) == "" {
		return errors.New("model_id is required")
	}
	if strings.TrimSpace(input.ToolType) == "" {
		return errors.New("tool_type is required")
	}
	if strings.TrimSpace(input.Rationale) == "" {
		return errors.New("rationale is required")
	}
	if containsSecretValue(input.ProviderID) || containsSecretValue(input.ModelID) || containsSecretValue(input.ToolType) || containsSecretValue(input.Prompt) || containsSecretValue(input.Rationale) {
		return errors.New("provider sandbox test call input must not contain secrets")
	}
	return nil
}

func BuildSandboxTestCallResult(entry RegistryEntry, input SandboxTestCallInput) (SandboxTestCallResult, error) {
	if err := ValidateRegistryEntry(entry); err != nil {
		return SandboxTestCallResult{}, err
	}
	if err := ValidateSandboxTestCallInput(input); err != nil {
		return SandboxTestCallResult{}, err
	}
	if entry.Status != RegistryStatusEnabled || entry.Routing.KillSwitch {
		return SandboxTestCallResult{}, errors.New("provider is not enabled for sandbox test calls")
	}
	capability, ok := findCapability(entry.Capabilities, strings.TrimSpace(input.ModelID), strings.TrimSpace(input.ToolType))
	if !ok {
		return SandboxTestCallResult{}, errors.New("provider capability does not support requested model/tool")
	}
	now := time.Now().UTC()
	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		prompt = "sandbox provider test call"
	}
	preview := map[string]string{
		"kind":        "sandbox_preview",
		"prompt_hash": shortDeterministicHash(prompt),
		"message":     "sandbox test call validated provider capability without persisting user assets",
	}
	return SandboxTestCallResult{
		ID:              "provider-test-" + shortDeterministicHash(entry.ProviderID+":"+capability.ModelID+":"+strings.TrimSpace(input.ToolType)+":"+prompt),
		ProviderID:      entry.ProviderID,
		ModelID:         capability.ModelID,
		ToolType:        strings.TrimSpace(input.ToolType),
		Status:          "succeeded",
		Mode:            entry.Mode,
		Capability:      capability,
		SecretRef:       entry.SecretRef,
		SecretPresent:   strings.TrimSpace(entry.SecretRef) != "",
		AssetPersisted:  false,
		UserVisible:     false,
		TraceID:         "trace_provider_test_" + shortDeterministicHash(entry.ProviderID+":"+capability.ModelID),
		LatencyMS:       entry.Health.LatencyMS,
		EstimatedCost:   capability.EstimatedCostCents,
		OutputPreview:   preview,
		RoutingSnapshot: entry.Routing,
		CreatedAt:       now,
	}, nil
}

func findCapability(capabilities []Capability, modelID, toolType string) (Capability, bool) {
	for _, capability := range capabilities {
		if capability.ModelID != modelID {
			continue
		}
		for _, supported := range capability.ToolTypes {
			if supported == toolType {
				return capability, true
			}
		}
		for _, endpoint := range capability.Endpoints {
			if endpoint == toolType {
				return capability, true
			}
		}
	}
	return Capability{}, false
}

func ValidateRegistryEntry(entry RegistryEntry) error {
	if strings.TrimSpace(entry.ProviderID) == "" {
		return errors.New("provider_id is required")
	}
	if strings.TrimSpace(entry.DisplayName) == "" {
		return errors.New("display_name is required")
	}
	switch entry.Mode {
	case RegistryModeDev, RegistryModeSandbox, RegistryModeProduction:
	default:
		return fmt.Errorf("unsupported registry mode %q", entry.Mode)
	}
	switch entry.Status {
	case RegistryStatusEnabled, RegistryStatusDisabled, RegistryStatusKillSwitch:
	default:
		return fmt.Errorf("unsupported registry status %q", entry.Status)
	}
	if entry.Mode != RegistryModeDev && strings.TrimSpace(entry.SecretRef) == "" {
		return errors.New("secret_ref is required for sandbox and production providers")
	}
	if containsSecretValue(entry.SecretRef) {
		return errors.New("secret_ref must reference a secret manager path, not a raw secret value")
	}
	if err := ValidateRoutingPolicy(entry.Routing); err != nil {
		return err
	}
	if err := ValidateHealthSnapshot(entry.Health); err != nil {
		return err
	}
	if len(entry.Capabilities) == 0 {
		return errors.New("at least one capability is required")
	}
	for _, capability := range entry.Capabilities {
		if err := ValidateCapability(capability); err != nil {
			return err
		}
		if capability.ProviderID != entry.ProviderID {
			return fmt.Errorf("capability provider_id %q must match registry provider_id %q", capability.ProviderID, entry.ProviderID)
		}
	}
	for key, value := range entry.Metadata {
		if containsSecretValue(key) || containsSecretValue(value) || security.IsSensitiveKey(key) {
			return fmt.Errorf("provider metadata key %q must not contain secrets", key)
		}
	}
	return nil
}

var ErrRegistryNotFound = errors.New("provider registry entry not found")

func ValidateStrategyGroup(group StrategyGroup) error {
	if strings.TrimSpace(group.GroupID) == "" {
		return errors.New("group_id is required")
	}
	if strings.TrimSpace(group.DisplayName) == "" {
		return errors.New("display_name is required")
	}
	if strings.TrimSpace(group.ToolType) == "" {
		return errors.New("tool_type is required")
	}
	if containsSecretValue(group.GroupID) || containsSecretValue(group.DisplayName) || containsSecretValue(group.ToolType) {
		return errors.New("provider strategy group fields must not contain secrets")
	}
	if err := ValidateRegistryStatus(group.Status); err != nil {
		return err
	}
	switch group.SelectionPolicy {
	case StrategySelectionWeighted, StrategySelectionPriority, StrategySelectionCanary, StrategySelectionFailover:
	default:
		return fmt.Errorf("unsupported strategy selection_policy %q", group.SelectionPolicy)
	}
	if group.Status == RegistryStatusKillSwitch && !group.KillSwitch {
		return errors.New("kill_switch status requires kill_switch=true")
	}
	if len(group.Members) == 0 {
		return errors.New("at least one strategy group member is required")
	}
	seen := map[string]bool{}
	for _, member := range group.Members {
		if err := ValidateStrategyGroupMember(member); err != nil {
			return err
		}
		if seen[member.ProviderID] {
			return fmt.Errorf("duplicate strategy group member provider_id %q", member.ProviderID)
		}
		seen[member.ProviderID] = true
	}
	for _, providerID := range group.FallbackProviderIDs {
		if strings.TrimSpace(providerID) == "" {
			return errors.New("fallback provider IDs must not be empty")
		}
		if containsSecretValue(providerID) {
			return errors.New("fallback provider IDs must not contain secrets")
		}
	}
	for key, value := range group.Metadata {
		if containsSecretValue(key) || containsSecretValue(value) || security.IsSensitiveKey(key) {
			return fmt.Errorf("provider strategy group metadata key %q must not contain secrets", key)
		}
	}
	return nil
}

func ValidateStrategyGroupMember(member StrategyGroupMember) error {
	if strings.TrimSpace(member.ProviderID) == "" {
		return errors.New("provider_id is required")
	}
	if containsSecretValue(member.ProviderID) {
		return errors.New("provider_id must not contain secrets")
	}
	if member.Weight < 0 {
		return errors.New("strategy member weight must be non-negative")
	}
	if member.CanaryPercent < 0 || member.CanaryPercent > 100 {
		return errors.New("strategy member canary_percent must be between 0 and 100")
	}
	if member.MaxConcurrency < 0 {
		return errors.New("strategy member max_concurrency must be non-negative")
	}
	if member.FallbackRank < 0 {
		return errors.New("strategy member fallback_rank must be non-negative")
	}
	return nil
}

func ValidateRegistryStatus(status RegistryStatus) error {
	switch status {
	case RegistryStatusEnabled, RegistryStatusDisabled, RegistryStatusKillSwitch:
		return nil
	default:
		return fmt.Errorf("unsupported registry status %q", status)
	}
}

func ValidateCapability(capability Capability) error {
	if strings.TrimSpace(capability.ProviderID) == "" || strings.TrimSpace(capability.ModelID) == "" {
		return errors.New("capability provider_id and model_id are required")
	}
	if len(capability.Endpoints) == 0 {
		return errors.New("capability endpoints are required")
	}
	if len(capability.InputTypes) == 0 || len(capability.OutputTypes) == 0 {
		return errors.New("capability input_types and output_types are required")
	}
	if capability.MaxCostUnits < 0 || capability.EstimatedCostCents < 0 {
		return errors.New("capability cost values must be non-negative")
	}
	if containsSecretValue(capability.CostCurrency) {
		return errors.New("capability cost currency must not contain secrets")
	}
	if capability.SupportsBatch && capability.MaxBatchSize < 2 {
		return errors.New("batch-capable models must declare max_batch_size >= 2")
	}
	values := append([]string{}, capability.Endpoints...)
	values = append(values, capability.InputTypes...)
	values = append(values, capability.OutputTypes...)
	values = append(values, capability.ToolTypes...)
	values = append(values, capability.SupportedAspectRatios...)
	values = append(values, capability.SupportedQualities...)
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			return errors.New("capability entries must not be empty")
		}
		if containsSecretValue(value) {
			return errors.New("capability entries must not contain secrets")
		}
	}
	return nil
}

func normalizedCapabilities(providerID string, capabilities []Capability) []Capability {
	normalized := make([]Capability, 0, len(capabilities))
	for _, capability := range capabilities {
		capability.ProviderID = strings.TrimSpace(firstNonEmpty(capability.ProviderID, providerID))
		capability.ModelID = strings.TrimSpace(capability.ModelID)
		capability.Endpoints = normalizedStringSlice(capability.Endpoints)
		capability.InputTypes = normalizedStringSlice(capability.InputTypes)
		capability.OutputTypes = normalizedStringSlice(capability.OutputTypes)
		capability.ToolTypes = normalizedStringSlice(capability.ToolTypes)
		capability.CostCurrency = strings.TrimSpace(capability.CostCurrency)
		capability.SupportedAspectRatios = normalizedStringSlice(capability.SupportedAspectRatios)
		capability.SupportedQualities = normalizedStringSlice(capability.SupportedQualities)
		if capability.MaxBatchSize == 0 {
			capability.MaxBatchSize = 1
		}
		normalized = append(normalized, capability)
	}
	return normalized
}

func normalizedStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized
}

func normalizedStrategyGroupMembers(values []StrategyGroupMember) []StrategyGroupMember {
	if len(values) == 0 {
		return nil
	}
	normalized := make([]StrategyGroupMember, 0, len(values))
	for _, value := range values {
		value.ProviderID = strings.TrimSpace(value.ProviderID)
		normalized = append(normalized, value)
	}
	return normalized
}

func normalizeStrategyGroupStatus(group *StrategyGroup) {
	if group.Status == RegistryStatusKillSwitch {
		group.KillSwitch = true
	}
	if group.KillSwitch && group.Status == RegistryStatusEnabled {
		group.Status = RegistryStatusKillSwitch
	}
}

func normalizeMetadata(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	normalized := make(map[string]string, len(values))
	for key, value := range values {
		trimmedKey := strings.TrimSpace(key)
		if trimmedKey == "" {
			continue
		}
		normalized[trimmedKey] = strings.TrimSpace(value)
	}
	return normalized
}

func normalizedMaxBatchSize(capability Capability) int {
	if capability.MaxBatchSize > 0 {
		return capability.MaxBatchSize
	}
	return 1
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func ValidateRoutingPolicy(policy RoutingPolicy) error {
	if policy.Weight < 0 {
		return errors.New("routing weight must be non-negative")
	}
	if policy.CanaryPercent < 0 || policy.CanaryPercent > 100 {
		return errors.New("canary_percent must be between 0 and 100")
	}
	if policy.MaxConcurrency < 0 {
		return errors.New("max_concurrency must be non-negative")
	}
	for _, providerID := range policy.FallbackProviderIDs {
		if strings.TrimSpace(providerID) == "" {
			return errors.New("fallback provider IDs must not be empty")
		}
	}
	return nil
}

func ValidateHealthSnapshot(health HealthSnapshot) error {
	if health.LatencyMS < 0 {
		return errors.New("health latency_ms must be non-negative")
	}
	if health.ErrorRatePercent < 0 || health.ErrorRatePercent > 100 {
		return errors.New("health error_rate_percent must be between 0 and 100")
	}
	return nil
}

func healthErrorRateFromStatus(status Status) int {
	if status.Available {
		return 0
	}
	return 100
}

func (entry RegistryEntry) AdminProjection() AdminRegistryProjection {
	return AdminRegistryProjection{
		ProviderID:    entry.ProviderID,
		DisplayName:   entry.DisplayName,
		Mode:          entry.Mode,
		Status:        entry.Status,
		SecretRef:     entry.SecretRef,
		Capabilities:  append([]Capability(nil), entry.Capabilities...),
		Routing:       entry.Routing,
		Health:        entry.Health,
		Metadata:      normalizeMetadata(entry.Metadata),
		SecretPresent: strings.TrimSpace(entry.SecretRef) != "",
		UpdatedAt:     entry.UpdatedAt,
	}
}

func ValidateAdminProjection(projection AdminRegistryProjection) error {
	if strings.TrimSpace(projection.ProviderID) == "" {
		return errors.New("provider_id is required")
	}
	if containsSecretValue(projection.SecretRef) {
		return errors.New("secret_ref must reference a secret manager path, not a raw secret value")
	}
	for _, capability := range projection.Capabilities {
		if err := ValidateCapability(capability); err != nil {
			return err
		}
		if capability.ProviderID != projection.ProviderID {
			return fmt.Errorf("capability provider_id %q must match registry provider_id %q", capability.ProviderID, projection.ProviderID)
		}
	}
	for key, value := range projection.Metadata {
		if containsSecretValue(key) || containsSecretValue(value) || security.IsSensitiveKey(key) {
			return fmt.Errorf("provider metadata key %q must not contain secrets", key)
		}
	}
	return nil
}

func PublicModelProjections(entries []RegistryEntry) []PublicModelProjection {
	projections := make([]PublicModelProjection, 0)
	for _, entry := range entries {
		if entry.Status != RegistryStatusEnabled || entry.Routing.KillSwitch {
			continue
		}
		for _, capability := range entry.Capabilities {
			projections = append(projections, PublicModelProjection{
				ProviderID:    capability.ProviderID,
				ModelID:       capability.ModelID,
				Endpoints:     append([]string(nil), capability.Endpoints...),
				ToolTypes:     append([]string(nil), capability.ToolTypes...),
				SupportsBatch: capability.SupportsBatch,
			})
		}
	}
	return projections
}

func containsSecretValue(value string) bool {
	return len(security.ClassifyString(value)) > 0 || strings.Contains(security.RedactString(value), security.Redacted)
}

func shortDeterministicHash(value string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(sum[:])[:16]
}

func scanRegistryEntry(row store.Rows) (RegistryEntry, int, error) {
	var entry RegistryEntry
	var routingJSON []byte
	var healthJSON []byte
	var metadataJSON []byte
	var capabilitiesJSON []byte
	var totalCount int64
	if err := row.Scan(
		&entry.ProviderID,
		&entry.DisplayName,
		&entry.Mode,
		&entry.Status,
		&entry.SecretRef,
		&routingJSON,
		&healthJSON,
		&metadataJSON,
		&entry.CreatedAt,
		&entry.UpdatedAt,
		&capabilitiesJSON,
		&totalCount,
	); err != nil {
		return RegistryEntry{}, 0, err
	}
	if err := decodeRegistryJSON(routingJSON, &entry.Routing); err != nil {
		return RegistryEntry{}, 0, fmt.Errorf("decode provider routing for %s: %w", entry.ProviderID, err)
	}
	if err := decodeRegistryJSON(healthJSON, &entry.Health); err != nil {
		return RegistryEntry{}, 0, fmt.Errorf("decode provider health for %s: %w", entry.ProviderID, err)
	}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &entry.Metadata); err != nil {
			return RegistryEntry{}, 0, fmt.Errorf("decode provider metadata for %s: %w", entry.ProviderID, err)
		}
	}
	if err := decodeRegistryJSON(capabilitiesJSON, &entry.Capabilities); err != nil {
		return RegistryEntry{}, 0, fmt.Errorf("decode provider capabilities for %s: %w", entry.ProviderID, err)
	}
	return entry, int(totalCount), nil
}

func scanStrategyGroup(row store.Rows) (StrategyGroup, int, error) {
	var group StrategyGroup
	var fallbackProviderIDs []string
	var metadataJSON []byte
	var membersJSON []byte
	var totalCount int64
	if err := row.Scan(
		&group.GroupID,
		&group.DisplayName,
		&group.ToolType,
		&group.Status,
		&group.SelectionPolicy,
		&fallbackProviderIDs,
		&group.KillSwitch,
		&metadataJSON,
		&group.CreatedAt,
		&group.UpdatedAt,
		&membersJSON,
		&totalCount,
	); err != nil {
		return StrategyGroup{}, 0, err
	}
	group.FallbackProviderIDs = normalizedStringSlice(fallbackProviderIDs)
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &group.Metadata); err != nil {
			return StrategyGroup{}, 0, fmt.Errorf("decode provider strategy metadata for %s: %w", group.GroupID, err)
		}
	}
	if err := decodeRegistryJSON(membersJSON, &group.Members); err != nil {
		return StrategyGroup{}, 0, fmt.Errorf("decode provider strategy members for %s: %w", group.GroupID, err)
	}
	return group, int(totalCount), nil
}

func decodeRegistryJSON(data []byte, target any) error {
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, target)
}
