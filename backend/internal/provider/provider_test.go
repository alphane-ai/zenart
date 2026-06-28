package provider

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/store"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDevProviderInvoke(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	resp, err := (DevProvider{Now: func() time.Time { return now }}).Invoke(context.Background(), Request{
		ID:             "req_1",
		TenantID:       "tenant_1",
		TaskID:         "task_1",
		ProviderID:     "dev",
		ModelID:        "dev-echo-v1",
		Endpoint:       "text",
		SchemaVersion:  1,
		IdempotencyKey: "idem_1",
		Payload:        map[string]any{"prompt": "test"},
		TraceID:        "trace_1",
		Provenance:     Provenance{ProviderID: "dev", ModelID: "dev-echo-v1", EndpointVersion: "v1", RequestHash: "hash"},
	})
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if resp.Status != "succeeded" {
		t.Fatalf("Status = %q, want succeeded", resp.Status)
	}
	if resp.ProviderID != "dev" || resp.ModelID != "dev-echo-v1" || resp.Provenance.ProviderID != "dev" || resp.Provenance.ModelID != "dev-echo-v1" {
		t.Fatalf("provider/model projection = %#v provenance=%#v", resp, resp.Provenance)
	}
	if resp.Usage.CostUnits != 1 {
		t.Fatalf("Usage.CostUnits = %d, want local minimum usage unit", resp.Usage.CostUnits)
	}
	if !resp.CompletedAt.Equal(now) {
		t.Fatalf("CompletedAt = %v, want %v", resp.CompletedAt, now)
	}
}

func TestDevProviderPreservesSandboxRequestProvider(t *testing.T) {
	resp, err := (DevProvider{}).Invoke(context.Background(), Request{
		ID:             "req_1",
		TenantID:       "tenant_1",
		TaskID:         "task_1",
		ProviderID:     "zenari-image-sandbox",
		ModelID:        "glm-5.2",
		Endpoint:       "image.generate",
		SchemaVersion:  1,
		IdempotencyKey: "idem_1",
		Payload:        map[string]any{"prompt": "test"},
		TraceID:        "trace_1",
		Provenance:     Provenance{EndpointVersion: "batch_child_v1", RequestHash: "hash"},
	})
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if resp.ProviderID != "zenari-image-sandbox" || resp.Provenance.ProviderID != "zenari-image-sandbox" {
		t.Fatalf("ProviderID = %q provenance=%#v, want sandbox request provider preserved", resp.ProviderID, resp.Provenance)
	}
	if resp.ModelID != "glm-5.2" || resp.Provenance.ModelID != "glm-5.2" {
		t.Fatalf("ModelID = %q provenance=%#v, want request model preserved", resp.ModelID, resp.Provenance)
	}
	if resp.Usage.CostUnits != 1 {
		t.Fatalf("Usage.CostUnits = %d, want local minimum usage unit", resp.Usage.CostUnits)
	}
}

func TestValidateRequestRequiresTraceAndIdempotency(t *testing.T) {
	err := ValidateRequest(Request{ID: "req_1", TenantID: "tenant_1", TaskID: "task_1", ProviderID: "dev", ModelID: "dev-echo-v1", SchemaVersion: 1})
	if err == nil {
		t.Fatal("ValidateRequest() error = nil, want missing trace/idempotency error")
	}
}

func TestSafetyClientEnforcesProviderRequestAndResponse(t *testing.T) {
	enforcer := &fakeSafetyEnforcer{}
	client := SafetyClient{Inner: DevProvider{}, Hooks: enforcer.hooks()}

	_, err := client.Invoke(context.Background(), validRequest())
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if len(enforcer.calls) != 2 || enforcer.calls[0] != "provider_request:tenant_1:task_1" || enforcer.calls[1] != "provider_response:tenant_1:task_1" {
		t.Fatalf("safety calls = %#v, want request then response enforcement", enforcer.calls)
	}
}

func TestSafetyClientBlocksBeforeProviderInvoke(t *testing.T) {
	wantErr := errors.New("safety blocked")
	enforcer := &fakeSafetyEnforcer{requestErr: wantErr}
	inner := countingClient{response: Response{Status: "succeeded"}}
	client := SafetyClient{Inner: &inner, Hooks: enforcer.hooks()}

	_, err := client.Invoke(context.Background(), validRequest())
	if !errors.Is(err, wantErr) {
		t.Fatalf("Invoke() error = %v, want request safety error", err)
	}
	if inner.invokes != 0 {
		t.Fatalf("inner invokes = %d, want blocked before provider call", inner.invokes)
	}
}

func TestSelectFallback(t *testing.T) {
	capability, ok := SelectFallback(
		[]Status{{ProviderID: "primary", Available: false}, {ProviderID: "dev", Available: true}},
		[]Capability{
			{ProviderID: "primary", ModelID: "primary-v1", Endpoints: []string{"text"}},
			{ProviderID: "dev", ModelID: "dev-echo-v1", Endpoints: []string{"text"}},
		},
		"text",
	)
	if !ok {
		t.Fatal("SelectFallback() did not find available provider")
	}
	if capability.ProviderID != "dev" {
		t.Fatalf("ProviderID = %q, want dev", capability.ProviderID)
	}
}

func TestValidateRegistryEntryRequiresSecretRefNotRawSecret(t *testing.T) {
	entry := validRegistryEntry()
	entry.SecretRef = "sk-" + "proj-" + "abcdefghijklmnopqrstuvwxyz123456"

	if err := ValidateRegistryEntry(entry); err == nil {
		t.Fatal("ValidateRegistryEntry() error = nil, want raw secret rejection")
	}
}

func TestValidateRegistryEntryRejectsBatchCapabilityWithoutMaxBatchSize(t *testing.T) {
	entry := validRegistryEntry()
	entry.Capabilities[0].MaxBatchSize = 0

	if err := ValidateRegistryEntry(entry); err == nil {
		t.Fatal("ValidateRegistryEntry() error = nil, want max_batch_size validation")
	}
}

func TestRegistryAdminProjectionKeepsSecretReferenceOnly(t *testing.T) {
	entry := validRegistryEntry()

	projection := entry.AdminProjection()
	if projection.SecretRef != "secrets/provider/zenari-image-sandbox" || !projection.SecretPresent {
		t.Fatalf("projection = %#v, want secret reference presence only", projection)
	}
	if len(projection.Capabilities) != 1 || projection.Capabilities[0].ModelID != "image-fast-v1" {
		t.Fatalf("capabilities = %#v, want registry capabilities", projection.Capabilities)
	}
	if projection.Metadata["adapter"] != "openai-compatible" || projection.Metadata["adapter_endpoint_version"] != "openai_compatible_chat_completions_v1" {
		t.Fatalf("metadata = %#v, want public-safe openai-compatible adapter projection", projection.Metadata)
	}
}

func TestPublicModelProjectionsHideAdminOnlyRoutingAndSecrets(t *testing.T) {
	enabled := validRegistryEntry()
	disabled := validRegistryEntry()
	disabled.ProviderID = "disabled"
	disabled.SecretRef = "secrets/provider/disabled"
	disabled.Status = RegistryStatusDisabled
	disabled.Capabilities[0].ProviderID = "disabled"
	disabled.Capabilities[0].ModelID = "disabled-v1"
	killed := validRegistryEntry()
	killed.ProviderID = "killed"
	killed.SecretRef = "secrets/provider/killed"
	killed.Routing.KillSwitch = true
	killed.Capabilities[0].ProviderID = "killed"
	killed.Capabilities[0].ModelID = "killed-v1"

	projections := PublicModelProjections([]RegistryEntry{enabled, disabled, killed})
	if len(projections) != 1 {
		t.Fatalf("projections = %#v, want only enabled non-killed provider", projections)
	}
	if projections[0].ProviderID != "zenari-image-sandbox" || projections[0].ModelID != "image-fast-v1" {
		t.Fatalf("projection = %#v", projections[0])
	}
}

func TestRegistryRepositoryListsAdminProjectionFromDatabase(t *testing.T) {
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	db := &providerFakeDB{rows: [][]any{{
		"zenari-image-sandbox",
		"Zenari image sandbox",
		"sandbox",
		"enabled",
		"secrets/provider/zenari-image-sandbox",
		[]byte(`{"weight":100,"canary_percent":0,"max_concurrency":4,"fallback_provider_ids":["dev"],"kill_switch":false}`),
		[]byte(`{"available":true,"latency_ms":420,"error_rate_percent":1,"last_checked_at":"2026-06-21T10:00:00Z","message":"sandbox healthy"}`),
		[]byte(`{"region":"sandbox-us","adapter":"openai-compatible","adapter_endpoint_version":"openai_compatible_chat_completions_v1"}`),
		now,
		now,
		[]byte(`[{"provider_id":"zenari-image-sandbox","model_id":"image-fast-v1","endpoints":["image.generate","image.edit"],"input_types":["prompt","reference_image","mask"],"output_types":["image"],"tool_types":["generate","remove_background","upscale","erase","expand"],"max_cost_units":8,"cost_currency":"USD","estimated_cost_cents":12,"supports_batch":true,"max_batch_size":20,"supports_seed":true,"supports_cancel":true,"supported_aspect_ratios":["1:1","16:9","9:16"],"supported_qualities":["draft","standard","high"]}]`),
		int64(1),
	}}}

	page, err := NewRegistryRepository(db).ListAdminRegistry(context.Background(), 500)
	if err != nil {
		t.Fatalf("ListAdminRegistry() error = %v", err)
	}
	if len(page.Items) != 1 || page.TotalCount != 1 {
		t.Fatalf("page = %#v, want one registry item", page)
	}
	item := page.Items[0]
	if item.ProviderID != "zenari-image-sandbox" || item.SecretRef != "secrets/provider/zenari-image-sandbox" || !item.SecretPresent {
		t.Fatalf("item = %#v, want sandbox provider with secret ref presence", item)
	}
	if len(item.Capabilities) != 1 || item.Capabilities[0].ModelID != "image-fast-v1" || !item.Capabilities[0].SupportsBatch {
		t.Fatalf("capabilities = %#v, want image-fast-v1 batch capability", item.Capabilities)
	}
	if !item.Health.LastCheckedAt.Equal(now) {
		t.Fatalf("health last checked = %s, want %s", item.Health.LastCheckedAt, now)
	}
	if item.Metadata["adapter"] != "openai-compatible" || item.Metadata["region"] != "sandbox-us" {
		t.Fatalf("metadata = %#v, want adapter and region from database", item.Metadata)
	}
	if len(db.queries) != 1 {
		t.Fatalf("queries = %#v, want one query", db.queries)
	}
	if gotLimit := db.queries[0].args[0].(int); gotLimit != 100 {
		t.Fatalf("limit = %d, want clamp to 100", gotLimit)
	}
	if !strings.Contains(db.queries[0].sql, "provider_model_capabilities") {
		t.Fatalf("query = %s, want capability join", db.queries[0].sql)
	}
}

func TestRegistryRepositoryListsStrategyGroupsFromDatabase(t *testing.T) {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	db := &providerFakeDB{rows: [][]any{strategyGroupDBRow(t, StrategyGroup{
		GroupID:             "image-generation-default",
		DisplayName:         "Image generation default",
		ToolType:            "generate",
		Status:              RegistryStatusEnabled,
		SelectionPolicy:     StrategySelectionWeighted,
		FallbackProviderIDs: []string{"dev"},
		Members: []StrategyGroupMember{{
			ProviderID:     "zenari-image-sandbox",
			Weight:         90,
			CanaryPercent:  10,
			MaxConcurrency: 4,
			FallbackRank:   0,
			Enabled:        true,
		}},
		Metadata:  map[string]string{"routing_surface": "batch_generation"},
		CreatedAt: now,
		UpdatedAt: now,
	}, 1)}}

	page, err := NewRegistryRepository(db).ListStrategyGroups(context.Background(), 500)
	if err != nil {
		t.Fatalf("ListStrategyGroups() error = %v", err)
	}
	if len(page.Items) != 1 || page.TotalCount != 1 {
		t.Fatalf("page = %#v, want one strategy group", page)
	}
	item := page.Items[0]
	if item.GroupID != "image-generation-default" || item.SelectionPolicy != StrategySelectionWeighted || len(item.Members) != 1 {
		t.Fatalf("item = %#v, want weighted image strategy group", item)
	}
	if gotLimit := db.queries[0].args[0].(int); gotLimit != 100 {
		t.Fatalf("limit = %d, want clamp to 100", gotLimit)
	}
	if !strings.Contains(db.queries[0].sql, "provider_strategy_groups") || !strings.Contains(db.queries[0].sql, "provider_strategy_group_members") {
		t.Fatalf("query = %s, want strategy group member join", db.queries[0].sql)
	}
}

func TestRegistryRepositoryListsStrategyGroupsPostgresSmoke(t *testing.T) {
	dsn := os.Getenv("ZENARI_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set ZENARI_TEST_DATABASE_URL to run postgres provider strategy group smoke")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect postgres: %v", err)
	}
	defer pool.Close()

	page, err := NewRegistryRepository(store.NewPoolAdapter(pool)).ListStrategyGroups(ctx, 50)
	if err != nil {
		t.Fatalf("ListStrategyGroups() error = %T %v", err, err)
	}
	if page.TotalCount < len(page.Items) {
		t.Fatalf("page = %#v, total count should cover items", page)
	}
	for _, item := range page.Items {
		if err := ValidateStrategyGroup(item); err != nil {
			t.Fatalf("strategy group %q invalid after postgres scan: %v", item.GroupID, err)
		}
	}
}

func TestValidateAdminProjectionRejectsRawSecretRef(t *testing.T) {
	projection := validRegistryEntry().AdminProjection()
	projection.SecretRef = providerRawSecretFixture()

	if err := ValidateAdminProjection(projection); err == nil {
		t.Fatal("ValidateAdminProjection() error = nil, want raw secret rejection")
	}
}

func TestValidateAdminProjectionRejectsSecretMetadata(t *testing.T) {
	projection := validRegistryEntry().AdminProjection()
	projection.Metadata["api_key"] = "visible"

	if err := ValidateAdminProjection(projection); err == nil {
		t.Fatal("ValidateAdminProjection() error = nil, want sensitive metadata key rejection")
	}

	projection = validRegistryEntry().AdminProjection()
	projection.Metadata["adapter"] = providerRawSecretFixture()
	if err := ValidateAdminProjection(projection); err == nil {
		t.Fatal("ValidateAdminProjection() error = nil, want raw secret metadata value rejection")
	}
}

func TestRegistryRepositoryCreatesStrategyGroupWithMembersInTransaction(t *testing.T) {
	group := validStrategyGroup()
	db := &providerFakeDB{rowSets: [][][]any{
		{strategyGroupDBRow(t, group, 1)},
	}}

	result, err := NewRegistryRepository(db).CreateStrategyGroup(context.Background(), StrategyGroupCreate{
		GroupID:             group.GroupID,
		DisplayName:         group.DisplayName,
		ToolType:            group.ToolType,
		Status:              group.Status,
		SelectionPolicy:     group.SelectionPolicy,
		FallbackProviderIDs: group.FallbackProviderIDs,
		Members:             group.Members,
		Metadata:            group.Metadata,
	})
	if err != nil {
		t.Fatalf("CreateStrategyGroup() error = %v", err)
	}
	if result.Created.GroupID != group.GroupID || len(result.Created.Members) != 1 {
		t.Fatalf("result = %#v, want created strategy group with members", result.Created)
	}
	if !db.begun || !db.committed || db.rolledBack {
		t.Fatalf("transaction state = begun:%v committed:%v rolledBack:%v, want committed transaction", db.begun, db.committed, db.rolledBack)
	}
	if len(db.execs) != 3 {
		t.Fatalf("execs = %#v, want group insert, member delete, member insert", db.execs)
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO provider_strategy_groups") || db.execs[0].args[1] != group.GroupID {
		t.Fatalf("group insert exec = %#v, want strategy group insert", db.execs[0])
	}
	if !strings.Contains(db.execs[1].sql, "DELETE FROM provider_strategy_group_members") {
		t.Fatalf("second exec = %s, want defensive member delete", db.execs[1].sql)
	}
	if !strings.Contains(db.execs[2].sql, "INSERT INTO provider_strategy_group_members") || db.execs[2].args[2] != "zenari-image-sandbox" {
		t.Fatalf("member insert exec = %#v, want sandbox provider member insert", db.execs[2])
	}
}

func TestRegistryRepositoryUpdatesStrategyGroupKillSwitch(t *testing.T) {
	before := validStrategyGroup()
	after := before
	after.Status = RegistryStatusKillSwitch
	after.SelectionPolicy = StrategySelectionFailover
	after.KillSwitch = true
	after.FallbackProviderIDs = []string{"dev"}
	after.Members = []StrategyGroupMember{{
		ProviderID:     "dev",
		Weight:         100,
		MaxConcurrency: 2,
		Enabled:        true,
	}}
	db := &providerFakeDB{rowSets: [][][]any{
		{strategyGroupDBRow(t, before, 1)},
		{strategyGroupDBRow(t, after, 1)},
	}}

	result, err := NewRegistryRepository(db).UpdateStrategyGroup(context.Background(), StrategyGroupUpdate{
		GroupID:             before.GroupID,
		DisplayName:         after.DisplayName,
		ToolType:            after.ToolType,
		Status:              RegistryStatusKillSwitch,
		SelectionPolicy:     StrategySelectionFailover,
		FallbackProviderIDs: after.FallbackProviderIDs,
		KillSwitch:          true,
		Members:             after.Members,
		Metadata:            after.Metadata,
	})
	if err != nil {
		t.Fatalf("UpdateStrategyGroup() error = %v", err)
	}
	if result.Before.Status != RegistryStatusEnabled || result.After.Status != RegistryStatusKillSwitch || !result.After.KillSwitch {
		t.Fatalf("result = %#v, want enabled before and kill_switch after", result)
	}
	if len(db.execs) != 3 {
		t.Fatalf("execs = %#v, want group update, member delete, member insert", db.execs)
	}
	if !strings.Contains(db.execs[0].sql, "UPDATE provider_strategy_groups") || db.execs[0].args[0] != before.GroupID || db.execs[0].args[3] != string(RegistryStatusKillSwitch) {
		t.Fatalf("strategy update exec = %#v, want kill_switch update", db.execs[0])
	}
}

func TestValidateStrategyGroupRejectsSecretAndDuplicateMember(t *testing.T) {
	group := validStrategyGroup()
	group.Metadata = map[string]string{"api_key": "visible"}
	if err := ValidateStrategyGroup(group); err == nil {
		t.Fatal("ValidateStrategyGroup() error = nil, want sensitive metadata key rejection")
	}
	group = validStrategyGroup()
	group.Members = append(group.Members, group.Members[0])
	if err := ValidateStrategyGroup(group); err == nil {
		t.Fatal("ValidateStrategyGroup() error = nil, want duplicate member rejection")
	}
}

func TestRegistryRepositoryCreatesProviderWithCapabilitiesInTransaction(t *testing.T) {
	entry := validRegistryEntry()
	entry.ProviderID = "zenari-video-sandbox"
	entry.DisplayName = "Zenari video sandbox"
	entry.SecretRef = "secrets/provider/zenari-video-sandbox"
	entry.Capabilities[0].ProviderID = entry.ProviderID
	entry.Capabilities[0].ModelID = "video-fast-v1"
	entry.Capabilities[0].Endpoints = []string{"video.generate"}
	entry.Capabilities[0].OutputTypes = []string{"video"}
	entry.Capabilities[0].ToolTypes = []string{"generate"}
	inputCapabilities := append([]Capability(nil), entry.Capabilities...)
	inputCapabilities[0].ProviderID = ""
	db := &providerFakeDB{rowSets: [][][]any{
		{registryDBRow(t, entry, 1)},
	}}

	result, err := NewRegistryRepository(db).CreateAdminRegistry(context.Background(), RegistryCreate{
		ProviderID:   entry.ProviderID,
		DisplayName:  entry.DisplayName,
		Mode:         entry.Mode,
		Status:       entry.Status,
		SecretRef:    entry.SecretRef,
		Routing:      entry.Routing,
		Health:       entry.Health,
		Capabilities: inputCapabilities,
		Metadata:     entry.Metadata,
	})
	if err != nil {
		t.Fatalf("CreateAdminRegistry() error = %v", err)
	}
	if result.Created.ProviderID != entry.ProviderID || len(result.Created.Capabilities) != 1 || result.Created.Capabilities[0].ProviderID != entry.ProviderID {
		t.Fatalf("result = %#v, want created provider with normalized capability provider", result.Created)
	}
	if !db.begun || !db.committed || db.rolledBack {
		t.Fatalf("transaction state = begun:%v committed:%v rolledBack:%v, want committed transaction", db.begun, db.committed, db.rolledBack)
	}
	if len(db.execs) != 3 {
		t.Fatalf("execs = %#v, want registry insert, capability delete, capability insert", db.execs)
	}
	if !strings.Contains(db.execs[0].sql, "INSERT INTO provider_registry") || db.execs[0].args[1] != entry.ProviderID || db.execs[0].args[2] != entry.DisplayName {
		t.Fatalf("registry insert exec = %#v, want provider registry insert", db.execs[0])
	}
	if !strings.Contains(db.execs[1].sql, "DELETE FROM provider_model_capabilities") {
		t.Fatalf("second exec = %s, want defensive capability delete", db.execs[1].sql)
	}
	if !strings.Contains(db.execs[2].sql, "INSERT INTO provider_model_capabilities") || db.execs[2].args[1] != entry.ProviderID || db.execs[2].args[2] != "video-fast-v1" {
		t.Fatalf("capability insert exec = %#v, want video capability insert", db.execs[2])
	}
}

func TestRegistryRepositoryDeletesProviderAndCapabilitiesInTransaction(t *testing.T) {
	entry := validRegistryEntry()
	db := &providerFakeDB{rowSets: [][][]any{
		{registryDBRow(t, entry, 1)},
	}}

	result, err := NewRegistryRepository(db).DeleteAdminRegistry(context.Background(), RegistryDelete{ProviderID: entry.ProviderID})
	if err != nil {
		t.Fatalf("DeleteAdminRegistry() error = %v", err)
	}
	if result.Deleted.ProviderID != entry.ProviderID || len(result.Deleted.Capabilities) != 1 {
		t.Fatalf("result = %#v, want deleted provider projection", result.Deleted)
	}
	if !db.begun || !db.committed || db.rolledBack {
		t.Fatalf("transaction state = begun:%v committed:%v rolledBack:%v, want committed transaction", db.begun, db.committed, db.rolledBack)
	}
	if len(db.execs) != 2 {
		t.Fatalf("execs = %#v, want capability delete then registry delete", db.execs)
	}
	if !strings.Contains(db.execs[0].sql, "DELETE FROM provider_model_capabilities") || db.execs[0].args[0] != entry.ProviderID {
		t.Fatalf("first exec = %#v, want capability delete", db.execs[0])
	}
	if !strings.Contains(db.execs[1].sql, "DELETE FROM provider_registry") || db.execs[1].args[0] != entry.ProviderID {
		t.Fatalf("second exec = %#v, want registry delete", db.execs[1])
	}
}

func TestRegistryRepositoryProbesProviderHealth(t *testing.T) {
	before := validRegistryEntry()
	after := before
	after.Health = HealthSnapshot{
		Available:        false,
		LatencyMS:        830,
		ErrorRatePercent: 100,
		LastCheckedAt:    time.Date(2026, 6, 21, 11, 0, 0, 0, time.UTC),
		Message:          "openai-compatible health probe returned HTTP status 503",
	}
	db := &providerFakeDB{rowSets: [][][]any{
		{registryDBRow(t, before, 1)},
		{registryDBRow(t, after, 1)},
	}}

	result, err := NewRegistryRepository(db).ProbeAdminRegistryHealth(context.Background(), RegistryHealthProbe{
		ProviderID: before.ProviderID,
		Status: Status{
			ProviderID: before.ProviderID,
			Available:  false,
			LatencyMS:  830,
			CheckedAt:  after.Health.LastCheckedAt,
			Message:    "openai-compatible health probe returned HTTP status 503",
		},
	})
	if err != nil {
		t.Fatalf("ProbeAdminRegistryHealth() error = %v", err)
	}
	if !result.Before.Health.Available || result.After.Health.Available || result.After.Health.ErrorRatePercent != 100 || result.After.Health.Message != after.Health.Message {
		t.Fatalf("result = %#v, want unavailable health transition", result)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "UPDATE provider_registry") || !strings.Contains(db.execs[0].sql, "health = $2::jsonb") {
		t.Fatalf("execs = %#v, want provider health update", db.execs)
	}
	healthJSON, ok := db.execs[0].args[1].([]byte)
	if !ok || !strings.Contains(string(healthJSON), `"error_rate_percent":100`) || !strings.Contains(string(healthJSON), `"latency_ms":830`) {
		t.Fatalf("health arg = %#v, want serialized health snapshot", db.execs[0].args[1])
	}
}

func TestRegistryRepositoryUpdatesStatusAndRouting(t *testing.T) {
	before := validRegistryEntry()
	after := before
	after.Status = RegistryStatusKillSwitch
	after.Routing = RoutingPolicy{
		Weight:              0,
		CanaryPercent:       0,
		MaxConcurrency:      0,
		FallbackProviderIDs: []string{"dev"},
		KillSwitch:          true,
	}
	db := &providerFakeDB{rowSets: [][][]any{
		{registryDBRow(t, before, 1)},
		{registryDBRow(t, after, 1)},
	}}

	result, err := NewRegistryRepository(db).UpdateAdminRegistry(context.Background(), RegistryUpdate{
		ProviderID: before.ProviderID,
		Status:     RegistryStatusKillSwitch,
		Routing: RoutingPolicy{
			Weight:              0,
			CanaryPercent:       0,
			MaxConcurrency:      0,
			FallbackProviderIDs: []string{"dev"},
		},
	})
	if err != nil {
		t.Fatalf("UpdateAdminRegistry() error = %v", err)
	}
	if result.Before.Status != RegistryStatusEnabled || result.After.Status != RegistryStatusKillSwitch || !result.After.Routing.KillSwitch {
		t.Fatalf("update result = %#v, want enabled before and kill_switch after", result)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0].sql, "UPDATE provider_registry") {
		t.Fatalf("execs = %#v, want provider registry update", db.execs)
	}
	if db.execs[0].args[0] != before.ProviderID || db.execs[0].args[1] != string(RegistryStatusKillSwitch) {
		t.Fatalf("exec args = %#v, want provider id and kill switch status", db.execs[0].args)
	}
	routingJSON, ok := db.execs[0].args[2].([]byte)
	if !ok || !strings.Contains(string(routingJSON), `"kill_switch":true`) {
		t.Fatalf("routing arg = %#v, want kill_switch true JSON", db.execs[0].args[2])
	}
	if db.execs[0].args[3] != before.SecretRef {
		t.Fatalf("secret ref arg = %#v, want unchanged secret ref", db.execs[0].args[3])
	}
}

func TestRegistryRepositoryUpdatesSecretRefCapabilitiesAndCosts(t *testing.T) {
	before := validRegistryEntry()
	secretRef := "vault/providers/zenari-image-sandbox"
	updatedCapabilities := []Capability{{
		ModelID:               "image-quality-v2",
		Endpoints:             []string{" image.generate "},
		InputTypes:            []string{"prompt"},
		OutputTypes:           []string{"image"},
		ToolTypes:             []string{"generate"},
		MaxCostUnits:          15,
		CostCurrency:          "USD",
		EstimatedCostCents:    24,
		SupportsBatch:         true,
		MaxBatchSize:          12,
		SupportsSeed:          true,
		SupportsCancel:        true,
		SupportedAspectRatios: []string{"1:1", "4:5"},
		SupportedQualities:    []string{"standard", "high"},
	}}
	after := before
	after.SecretRef = secretRef
	after.Capabilities = normalizedCapabilities(before.ProviderID, updatedCapabilities)
	db := &providerFakeDB{rowSets: [][][]any{
		{registryDBRow(t, before, 1)},
		{registryDBRow(t, after, 1)},
	}}

	result, err := NewRegistryRepository(db).UpdateAdminRegistry(context.Background(), RegistryUpdate{
		ProviderID:    before.ProviderID,
		Status:        RegistryStatusEnabled,
		SecretRef:     &secretRef,
		Routing:       before.Routing,
		Capabilities:  updatedCapabilities,
		SetCapability: true,
	})
	if err != nil {
		t.Fatalf("UpdateAdminRegistry() error = %v", err)
	}
	if result.After.SecretRef != secretRef || len(result.After.Capabilities) != 1 {
		t.Fatalf("result = %#v, want updated secret ref and one capability", result.After)
	}
	capability := result.After.Capabilities[0]
	if capability.ProviderID != before.ProviderID || capability.ModelID != "image-quality-v2" || capability.EstimatedCostCents != 24 || capability.MaxCostUnits != 15 {
		t.Fatalf("capability = %#v, want updated provider/cost fields", capability)
	}
	if len(db.execs) != 3 {
		t.Fatalf("execs = %#v, want registry update, delete capabilities, insert capability", db.execs)
	}
	if !strings.Contains(db.execs[0].sql, "secret_ref = $4") || db.execs[0].args[3] != secretRef {
		t.Fatalf("registry update exec = %#v, want secret ref update", db.execs[0])
	}
	if !strings.Contains(db.execs[1].sql, "DELETE FROM provider_model_capabilities") {
		t.Fatalf("second exec = %s, want capability delete", db.execs[1].sql)
	}
	if !strings.Contains(db.execs[2].sql, "INSERT INTO provider_model_capabilities") {
		t.Fatalf("third exec = %s, want capability insert", db.execs[2].sql)
	}
	if db.execs[2].args[1] != before.ProviderID || db.execs[2].args[2] != "image-quality-v2" || db.execs[2].args[7] != int64(15) || db.execs[2].args[9] != int64(24) {
		t.Fatalf("capability insert args = %#v, want provider/model/cost values", db.execs[2].args)
	}
}

func TestRegistryRepositoryRejectsRawSecretCapabilityUpdate(t *testing.T) {
	before := validRegistryEntry()
	secretRef := providerRawSecretFixture()
	db := &providerFakeDB{rows: [][]any{registryDBRow(t, before, 1)}}

	_, err := NewRegistryRepository(db).UpdateAdminRegistry(context.Background(), RegistryUpdate{
		ProviderID:    before.ProviderID,
		Status:        RegistryStatusEnabled,
		SecretRef:     &secretRef,
		Routing:       before.Routing,
		Capabilities:  before.Capabilities,
		SetCapability: true,
	})
	if err == nil {
		t.Fatal("UpdateAdminRegistry() error = nil, want raw secret rejection")
	}
	if len(db.execs) != 0 {
		t.Fatalf("execs = %#v, want no mutation after validation failure", db.execs)
	}
}

func TestRegistryRepositoryRejectsInvalidRoutingUpdate(t *testing.T) {
	_, err := NewRegistryRepository(&providerFakeDB{}).UpdateAdminRegistry(context.Background(), RegistryUpdate{
		ProviderID: "zenari-image-sandbox",
		Status:     RegistryStatusEnabled,
		Routing:    RoutingPolicy{Weight: -1},
	})
	if err == nil {
		t.Fatal("UpdateAdminRegistry() error = nil, want invalid routing rejection")
	}
}

func TestBuildSandboxTestCallResultValidatesCapabilityWithoutPersistingAssets(t *testing.T) {
	entry := validRegistryEntry()

	result, err := BuildSandboxTestCallResult(entry, SandboxTestCallInput{
		ProviderID: entry.ProviderID,
		ModelID:    "image-fast-v1",
		ToolType:   "generate",
		Prompt:     "test provider routing",
		Rationale:  "verify sandbox provider before canary",
	})
	if err != nil {
		t.Fatalf("BuildSandboxTestCallResult() error = %v", err)
	}
	if result.ProviderID != entry.ProviderID || result.ModelID != "image-fast-v1" || result.ToolType != "generate" || result.Status != "succeeded" {
		t.Fatalf("result = %#v, want successful test call result", result)
	}
	if result.AssetPersisted || result.UserVisible {
		t.Fatalf("result persisted asset or became user visible: %#v", result)
	}
	if result.SecretRef != entry.SecretRef || !result.SecretPresent {
		t.Fatalf("secret projection = %q/%v, want secret ref presence only", result.SecretRef, result.SecretPresent)
	}
	if strings.Contains(result.OutputPreview["prompt_hash"], "test provider routing") {
		t.Fatalf("output preview leaked raw prompt: %#v", result.OutputPreview)
	}
}

func TestBuildSandboxTestCallResultRejectsDisabledOrUnsupportedProvider(t *testing.T) {
	entry := validRegistryEntry()
	entry.Routing.KillSwitch = true

	_, err := BuildSandboxTestCallResult(entry, SandboxTestCallInput{
		ProviderID: entry.ProviderID,
		ModelID:    "image-fast-v1",
		ToolType:   "generate",
		Rationale:  "verify sandbox provider before canary",
	})
	if err == nil || !strings.Contains(err.Error(), "not enabled") {
		t.Fatalf("BuildSandboxTestCallResult() error = %v, want not enabled rejection", err)
	}

	entry.Routing.KillSwitch = false
	_, err = BuildSandboxTestCallResult(entry, SandboxTestCallInput{
		ProviderID: entry.ProviderID,
		ModelID:    "image-fast-v1",
		ToolType:   "video.generate",
		Rationale:  "verify unsupported provider tool",
	})
	if err == nil || !strings.Contains(err.Error(), "does not support") {
		t.Fatalf("BuildSandboxTestCallResult() error = %v, want unsupported tool rejection", err)
	}
}

func TestValidateSandboxTestCallInputRejectsRawSecrets(t *testing.T) {
	err := ValidateSandboxTestCallInput(SandboxTestCallInput{
		ProviderID: "zenari-image-sandbox",
		ModelID:    "image-fast-v1",
		ToolType:   "generate",
		Prompt:     "use key " + providerRawSecretFixture(),
		Rationale:  "verify sandbox provider",
	})
	if err == nil {
		t.Fatal("ValidateSandboxTestCallInput() error = nil, want secret rejection")
	}
}

func providerRawSecretFixture() string {
	return "sk-" + "proj-" + "abcdefghijklmnopqrstuvwxyz123456"
}

func TestRegistryRepositoryRunsSandboxTestCallFromDatabase(t *testing.T) {
	entry := validRegistryEntry()
	db := &providerFakeDB{rows: [][]any{registryDBRow(t, entry, 1)}}

	result, err := NewRegistryRepository(db).RunSandboxTestCall(context.Background(), SandboxTestCallInput{
		ProviderID: entry.ProviderID,
		ModelID:    "image-fast-v1",
		ToolType:   "generate",
		Prompt:     "sandbox smoke",
		Rationale:  "verify sandbox provider before canary",
	})
	if err != nil {
		t.Fatalf("RunSandboxTestCall() error = %v", err)
	}
	if result.ProviderID != entry.ProviderID || result.SecretRef != entry.SecretRef || result.AssetPersisted || result.UserVisible {
		t.Fatalf("result = %#v, want admin-only sandbox test result", result)
	}
	if len(db.queries) != 1 || !strings.Contains(db.queries[0].sql, "WHERE pr.provider_id = $1") {
		t.Fatalf("queries = %#v, want provider lookup", db.queries)
	}
}

func validRequest() Request {
	return Request{
		ID:             "req_1",
		TenantID:       "tenant_1",
		TaskID:         "task_1",
		ProviderID:     "dev",
		ModelID:        "dev-echo-v1",
		Endpoint:       "text",
		SchemaVersion:  1,
		IdempotencyKey: "idem_1",
		Payload:        map[string]any{"prompt": "test"},
		TraceID:        "trace_1",
		Provenance:     Provenance{ProviderID: "dev", ModelID: "dev-echo-v1", EndpointVersion: "v1", RequestHash: "hash"},
	}
}

func validRegistryEntry() RegistryEntry {
	now := time.Date(2026, 6, 21, 10, 0, 0, 0, time.UTC)
	return RegistryEntry{
		ProviderID:  "zenari-image-sandbox",
		DisplayName: "Zenari image sandbox",
		Mode:        RegistryModeSandbox,
		Status:      RegistryStatusEnabled,
		SecretRef:   "secrets/provider/zenari-image-sandbox",
		Capabilities: []Capability{{
			ProviderID:            "zenari-image-sandbox",
			ModelID:               "image-fast-v1",
			Endpoints:             []string{"image.generate", "image.edit"},
			InputTypes:            []string{"prompt", "reference_image", "mask"},
			OutputTypes:           []string{"image"},
			ToolTypes:             []string{"generate", "remove_background", "upscale", "erase", "expand"},
			MaxCostUnits:          8,
			CostCurrency:          "USD",
			EstimatedCostCents:    12,
			SupportsBatch:         true,
			MaxBatchSize:          20,
			SupportsSeed:          true,
			SupportsCancel:        true,
			SupportedAspectRatios: []string{"1:1", "16:9", "9:16"},
			SupportedQualities:    []string{"draft", "standard", "high"},
		}},
		Routing: RoutingPolicy{
			Weight:              100,
			CanaryPercent:       0,
			MaxConcurrency:      4,
			FallbackProviderIDs: []string{"dev"},
		},
		Health: HealthSnapshot{
			Available:        true,
			LatencyMS:        420,
			ErrorRatePercent: 1,
			LastCheckedAt:    now,
		},
		Metadata: map[string]string{
			"adapter":                  "openai-compatible",
			"adapter_endpoint_version": "openai_compatible_chat_completions_v1",
			"config_base_url_env":      "LLM_OPENAI_BASE_URL",
			"config_live_calls_env":    "LLM_ENABLE_LIVE_CALLS",
			"region":                   "sandbox-us",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
}

type fakeSafetyEnforcer struct {
	calls       []string
	requestErr  error
	responseErr error
}

func (f *fakeSafetyEnforcer) hooks() SafetyHooks {
	return SafetyHooks{
		EnforceProviderRequest:  f.EnforceProviderRequestSafety,
		EnforceProviderResponse: f.EnforceProviderResponseSafety,
	}
}

func (f *fakeSafetyEnforcer) EnforceProviderRequestSafety(_ context.Context, tenantID, taskID string) error {
	f.calls = append(f.calls, "provider_request:"+tenantID+":"+taskID)
	return f.requestErr
}

func (f *fakeSafetyEnforcer) EnforceProviderResponseSafety(_ context.Context, tenantID, taskID string) error {
	f.calls = append(f.calls, "provider_response:"+tenantID+":"+taskID)
	return f.responseErr
}

type countingClient struct {
	invokes  int
	response Response
}

func (c *countingClient) Invoke(context.Context, Request) (Response, error) {
	c.invokes++
	return c.response, nil
}

func (c *countingClient) Status(context.Context) Status {
	return Status{ProviderID: "counting", Available: true}
}

func (c *countingClient) Capabilities() []Capability {
	return nil
}

type providerQueryCall struct {
	sql  string
	args []any
}

type providerFakeDB struct {
	rows       [][]any
	rowSets    [][][]any
	queries    []providerQueryCall
	execs      []providerQueryCall
	begun      bool
	committed  bool
	rolledBack bool
}

func (f *providerFakeDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execs = append(f.execs, providerQueryCall{sql: sql, args: args})
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

func (f *providerFakeDB) Query(_ context.Context, sql string, args ...any) (store.Rows, error) {
	f.queries = append(f.queries, providerQueryCall{sql: sql, args: args})
	if len(f.rowSets) > 0 {
		rows := f.rowSets[0]
		f.rowSets = f.rowSets[1:]
		return &providerRows{rows: rows}, nil
	}
	return &providerRows{rows: f.rows}, nil
}

func (f *providerFakeDB) QueryRow(context.Context, string, ...any) store.Row {
	panic("provider registry list must not query row")
}

func (f *providerFakeDB) Begin(context.Context) (store.Tx, error) {
	f.begun = true
	return &providerFakeTx{db: f}, nil
}

type providerFakeTx struct {
	db     *providerFakeDB
	closed bool
}

func (tx *providerFakeTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return tx.db.Exec(ctx, sql, args...)
}

func (tx *providerFakeTx) Query(ctx context.Context, sql string, args ...any) (store.Rows, error) {
	return tx.db.Query(ctx, sql, args...)
}

func (tx *providerFakeTx) QueryRow(ctx context.Context, sql string, args ...any) store.Row {
	return tx.db.QueryRow(ctx, sql, args...)
}

func (tx *providerFakeTx) Commit(context.Context) error {
	tx.closed = true
	tx.db.committed = true
	return nil
}

func (tx *providerFakeTx) Rollback(context.Context) error {
	if !tx.closed {
		tx.db.rolledBack = true
	}
	return nil
}

func registryDBRow(t *testing.T, entry RegistryEntry, count int) []any {
	t.Helper()
	routingJSON, err := json.Marshal(entry.Routing)
	if err != nil {
		t.Fatalf("marshal routing: %v", err)
	}
	healthJSON, err := json.Marshal(entry.Health)
	if err != nil {
		t.Fatalf("marshal health: %v", err)
	}
	metadataJSON, err := json.Marshal(entry.Metadata)
	if err != nil {
		t.Fatalf("marshal metadata: %v", err)
	}
	capabilitiesJSON, err := json.Marshal(entry.Capabilities)
	if err != nil {
		t.Fatalf("marshal capabilities: %v", err)
	}
	return []any{
		entry.ProviderID,
		entry.DisplayName,
		string(entry.Mode),
		string(entry.Status),
		entry.SecretRef,
		routingJSON,
		healthJSON,
		metadataJSON,
		entry.CreatedAt,
		entry.UpdatedAt,
		capabilitiesJSON,
		int64(count),
	}
}

func strategyGroupDBRow(t *testing.T, group StrategyGroup, count int) []any {
	t.Helper()
	metadataJSON, err := json.Marshal(group.Metadata)
	if err != nil {
		t.Fatalf("marshal strategy metadata: %v", err)
	}
	membersJSON, err := json.Marshal(group.Members)
	if err != nil {
		t.Fatalf("marshal strategy members: %v", err)
	}
	return []any{
		group.GroupID,
		group.DisplayName,
		group.ToolType,
		string(group.Status),
		string(group.SelectionPolicy),
		group.FallbackProviderIDs,
		group.KillSwitch,
		metadataJSON,
		group.CreatedAt,
		group.UpdatedAt,
		membersJSON,
		int64(count),
	}
}

func validStrategyGroup() StrategyGroup {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	return StrategyGroup{
		GroupID:             "image-generation-default",
		DisplayName:         "Image generation default",
		ToolType:            "generate",
		Status:              RegistryStatusEnabled,
		SelectionPolicy:     StrategySelectionWeighted,
		FallbackProviderIDs: []string{"dev"},
		Members: []StrategyGroupMember{{
			ProviderID:     "zenari-image-sandbox",
			Weight:         90,
			CanaryPercent:  10,
			MaxConcurrency: 4,
			FallbackRank:   0,
			Enabled:        true,
		}},
		Metadata:  map[string]string{"routing_surface": "batch_generation"},
		CreatedAt: now,
		UpdatedAt: now,
	}
}

type providerRows struct {
	rows  [][]any
	index int
}

func (r *providerRows) Close() {}

func (r *providerRows) Err() error {
	return nil
}

func (r *providerRows) Next() bool {
	if r.index >= len(r.rows) {
		return false
	}
	r.index++
	return true
}

func (r *providerRows) Scan(dest ...any) error {
	row := r.rows[r.index-1]
	for i := range dest {
		switch ptr := dest[i].(type) {
		case *string:
			*ptr = row[i].(string)
		case *RegistryMode:
			*ptr = RegistryMode(row[i].(string))
		case *RegistryStatus:
			*ptr = RegistryStatus(row[i].(string))
		case *StrategySelectionPolicy:
			*ptr = StrategySelectionPolicy(row[i].(string))
		case *[]string:
			*ptr = append([]string(nil), row[i].([]string)...)
		case *bool:
			*ptr = row[i].(bool)
		case *[]byte:
			*ptr = row[i].([]byte)
		case *time.Time:
			*ptr = row[i].(time.Time)
		case *int64:
			*ptr = row[i].(int64)
		default:
			panic("unsupported provider scan destination")
		}
	}
	return nil
}
