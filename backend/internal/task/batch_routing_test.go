package task

import (
	"context"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/provider"
)

func TestSelectBatchRoutingProviderUsesWeightedStrategyGroup(t *testing.T) {
	reader := fakeStrategyGroupReader{page: provider.StrategyGroupPage{Items: []provider.StrategyGroup{testStrategyGroup(provider.StrategySelectionWeighted)}}}

	decision, ok, err := SelectBatchRoutingProvider(context.Background(), reader, "image.generate", 0)
	if err != nil {
		t.Fatalf("SelectBatchRoutingProvider() error = %v", err)
	}
	if !ok {
		t.Fatal("SelectBatchRoutingProvider() ok = false, want true")
	}
	if decision.ProviderID == "" || decision.StrategyGroupID != "image-generation-default" || decision.SelectionReason == "" {
		t.Fatalf("decision = %#v, want provider and strategy explanation", decision)
	}
	if decision.SelectionPolicy != provider.StrategySelectionWeighted || len(decision.ConsideredProviders) != 2 {
		t.Fatalf("decision policy/considered = %#v", decision)
	}
}

func TestSelectBatchRoutingProviderUsesKillSwitchFallback(t *testing.T) {
	group := testStrategyGroup(provider.StrategySelectionWeighted)
	group.Status = provider.RegistryStatusKillSwitch
	group.KillSwitch = true
	group.Members[0].Enabled = false
	group.Members[0].Weight = 0
	group.Members[1].Weight = 100
	reader := fakeStrategyGroupReader{page: provider.StrategyGroupPage{Items: []provider.StrategyGroup{group}}}

	decision, ok, err := SelectBatchRoutingProvider(context.Background(), reader, "generate", 3)
	if err != nil {
		t.Fatalf("SelectBatchRoutingProvider() error = %v", err)
	}
	if !ok {
		t.Fatal("SelectBatchRoutingProvider() ok = false, want true")
	}
	if decision.ProviderID != "dev" || decision.SelectionReason != "kill_switch_fallback" {
		t.Fatalf("decision = %#v, want dev kill-switch fallback", decision)
	}
}

func TestSelectBatchRoutingProviderUsesFailoverRank(t *testing.T) {
	group := testStrategyGroup(provider.StrategySelectionFailover)
	group.Members[0].FallbackRank = 2
	group.Members[1].FallbackRank = 1
	reader := fakeStrategyGroupReader{page: provider.StrategyGroupPage{Items: []provider.StrategyGroup{group}}}

	decision, ok, err := SelectBatchRoutingProvider(context.Background(), reader, "image.generate", 0)
	if err != nil {
		t.Fatalf("SelectBatchRoutingProvider() error = %v", err)
	}
	if !ok || decision.ProviderID != "dev" || decision.SelectionReason != "failover_primary" {
		t.Fatalf("decision = %#v, want dev by failover rank", decision)
	}
}

func TestBatchRepositoryCreateBatchAppliesStrategyGroupMetadata(t *testing.T) {
	db := &batchFakeDB{}
	group := testStrategyGroup(provider.StrategySelectionFailover)
	group.Members[0].FallbackRank = 2
	group.Members[1].FallbackRank = 1
	repo := NewBatchRepository(db).WithStrategyGroupReader(fakeStrategyGroupReader{page: provider.StrategyGroupPage{Items: []provider.StrategyGroup{group}}})

	batch, err := repo.CreateBatch(context.Background(), BatchCreateInput{
		TenantID:       "tenant_1",
		UserID:         "user_1",
		ProjectID:      "project_1",
		WorkspaceID:    "workspace_1",
		PromptContext:  validBatchGenerationRequest().PromptContext,
		RequestedCount: 1,
		AllowedModels:  []string{"image-fast-v1"},
	})
	if err != nil {
		t.Fatalf("CreateBatch() error = %v", err)
	}
	if len(batch.Children) != 1 {
		t.Fatalf("children = %#v, want one", batch.Children)
	}
	child := batch.Children[0]
	if child.ProviderID != "dev" {
		t.Fatalf("child provider_id = %q, want dev", child.ProviderID)
	}
	if batch.Metadata["routing_strategy_group_id"] != "image-generation-default" || child.Metadata["routing_selection_reason"] != "failover_primary" {
		t.Fatalf("routing metadata batch=%#v child=%#v", batch.Metadata, child.Metadata)
	}
	if child.Metadata["routing_considered"] != "zenari-image-sandbox,dev" {
		t.Fatalf("routing considered = %q", child.Metadata["routing_considered"])
	}
}

func TestBatchRepositoryCreateBatchPreservesAllowedModelWhenStrategyUnavailable(t *testing.T) {
	repo := NewBatchRepository(&batchFakeDB{}).WithStrategyGroupReader(fakeStrategyGroupReader{})

	batch, err := repo.CreateBatch(context.Background(), BatchCreateInput{
		TenantID:       "tenant_1",
		UserID:         "user_1",
		ProjectID:      "project_1",
		WorkspaceID:    "workspace_1",
		PromptContext:  PromptContext{Text: "Create launch poster variants", ModelHints: []string{"glm-5.2"}, ToolHint: "image.generate"},
		RequestedCount: 1,
		AllowedModels:  []string{"glm-5.2"},
	})
	if err != nil {
		t.Fatalf("CreateBatch() error = %v", err)
	}
	if len(batch.AllowedModels) != 1 || batch.AllowedModels[0] != "glm-5.2" {
		t.Fatalf("AllowedModels = %#v, want glm-5.2 preserved", batch.AllowedModels)
	}
	if len(batch.Children) != 1 {
		t.Fatalf("children = %#v, want one", batch.Children)
	}
	child := batch.Children[0]
	if child.ModelID != "glm-5.2" {
		t.Fatalf("child model_id = %q, want glm-5.2", child.ModelID)
	}
	if child.ProviderID != "zenari-image-sandbox" || child.Metadata["routing_selection_reason"] != "strategy_group_unavailable_static_default" {
		t.Fatalf("child routing = provider %q metadata %#v, want static provider fallback without model override", child.ProviderID, child.Metadata)
	}
}

type fakeStrategyGroupReader struct {
	page provider.StrategyGroupPage
	err  error
}

func (r fakeStrategyGroupReader) ListStrategyGroups(_ context.Context, _ int) (provider.StrategyGroupPage, error) {
	return r.page, r.err
}

func testStrategyGroup(policy provider.StrategySelectionPolicy) provider.StrategyGroup {
	now := time.Date(2026, 6, 22, 10, 0, 0, 0, time.UTC)
	return provider.StrategyGroup{
		GroupID:             "image-generation-default",
		DisplayName:         "Image generation default",
		ToolType:            "generate",
		Status:              provider.RegistryStatusEnabled,
		SelectionPolicy:     policy,
		FallbackProviderIDs: []string{"dev"},
		KillSwitch:          false,
		Members: []provider.StrategyGroupMember{
			{
				ProviderID:     "zenari-image-sandbox",
				Weight:         90,
				CanaryPercent:  10,
				MaxConcurrency: 4,
				FallbackRank:   0,
				Enabled:        true,
			},
			{
				ProviderID:     "dev",
				Weight:         10,
				CanaryPercent:  0,
				MaxConcurrency: 2,
				FallbackRank:   1,
				Enabled:        true,
			},
		},
		Metadata:  map[string]string{"routing_surface": "batch_generation"},
		CreatedAt: now,
		UpdatedAt: now,
	}
}
