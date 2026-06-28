package task

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/alphane-ai/zenart/backend/internal/provider"
)

type StrategyGroupReader interface {
	ListStrategyGroups(ctx context.Context, limit int) (provider.StrategyGroupPage, error)
}

type BatchRoutingDecision struct {
	ProviderID          string
	StrategyGroupID     string
	StrategyDisplayName string
	SelectionPolicy     provider.StrategySelectionPolicy
	SelectionReason     string
	FallbackProviderIDs []string
	ConsideredProviders []string
}

func SelectBatchRoutingProvider(ctx context.Context, reader StrategyGroupReader, toolType string, childIndex int) (BatchRoutingDecision, bool, error) {
	if reader == nil {
		return BatchRoutingDecision{}, false, nil
	}
	toolType = strings.TrimSpace(toolType)
	if toolType == "" {
		toolType = "image.generate"
	}
	page, err := reader.ListStrategyGroups(ctx, 100)
	if err != nil {
		return BatchRoutingDecision{}, false, err
	}
	for _, group := range page.Items {
		if !strategyGroupMatchesTool(group, toolType) {
			continue
		}
		if err := provider.ValidateStrategyGroup(group); err != nil {
			return BatchRoutingDecision{}, false, err
		}
		providerID, reason, considered, err := selectStrategyGroupMember(group, childIndex)
		if err != nil {
			return BatchRoutingDecision{}, false, err
		}
		if providerID == "" {
			continue
		}
		return BatchRoutingDecision{
			ProviderID:          providerID,
			StrategyGroupID:     group.GroupID,
			StrategyDisplayName: group.DisplayName,
			SelectionPolicy:     group.SelectionPolicy,
			SelectionReason:     reason,
			FallbackProviderIDs: append([]string(nil), group.FallbackProviderIDs...),
			ConsideredProviders: considered,
		}, true, nil
	}
	return BatchRoutingDecision{}, false, nil
}

func selectStrategyGroupMember(group provider.StrategyGroup, childIndex int) (string, string, []string, error) {
	if group.Status == provider.RegistryStatusKillSwitch || group.KillSwitch {
		providerID, considered := firstEnabledFallback(group)
		if providerID == "" {
			return "", "", considered, errors.New("provider strategy group kill switch has no enabled fallback member")
		}
		return providerID, "kill_switch_fallback", considered, nil
	}
	members := enabledMembers(group.Members)
	considered := strategyMemberProviderIDs(members)
	if len(members) == 0 {
		return "", "", considered, errors.New("provider strategy group has no enabled members")
	}
	switch group.SelectionPolicy {
	case provider.StrategySelectionFailover:
		sort.SliceStable(members, func(i, j int) bool {
			if members[i].FallbackRank == members[j].FallbackRank {
				return members[i].ProviderID < members[j].ProviderID
			}
			return members[i].FallbackRank < members[j].FallbackRank
		})
		member := members[0]
		return member.ProviderID, "failover_primary", considered, nil
	case provider.StrategySelectionPriority:
		sort.SliceStable(members, func(i, j int) bool {
			if members[i].Weight == members[j].Weight {
				return members[i].ProviderID < members[j].ProviderID
			}
			return members[i].Weight > members[j].Weight
		})
		return members[0].ProviderID, "priority_weight", considered, nil
	case provider.StrategySelectionCanary:
		for _, member := range members {
			if member.CanaryPercent > 0 && stablePercent(group.GroupID, member.ProviderID, childIndex) < member.CanaryPercent {
				return member.ProviderID, "canary_percent", considered, nil
			}
		}
		sort.SliceStable(members, func(i, j int) bool {
			if members[i].FallbackRank == members[j].FallbackRank {
				return members[i].ProviderID < members[j].ProviderID
			}
			return members[i].FallbackRank < members[j].FallbackRank
		})
		return members[0].ProviderID, "canary_fallback", considered, nil
	case provider.StrategySelectionWeighted:
		total := 0
		for _, member := range members {
			total += member.Weight
		}
		if total <= 0 {
			sort.SliceStable(members, func(i, j int) bool {
				return members[i].ProviderID < members[j].ProviderID
			})
			return members[0].ProviderID, "weighted_zero_default", considered, nil
		}
		slot := stablePercent(group.GroupID, group.ToolType, childIndex) % total
		running := 0
		for _, member := range members {
			running += member.Weight
			if slot < running {
				return member.ProviderID, "weighted_slot", considered, nil
			}
		}
		return members[len(members)-1].ProviderID, "weighted_tail", considered, nil
	default:
		return "", "", considered, fmt.Errorf("unsupported strategy selection_policy %q", group.SelectionPolicy)
	}
}

func strategyGroupMatchesTool(group provider.StrategyGroup, toolType string) bool {
	groupTool := strings.TrimSpace(group.ToolType)
	return groupTool == toolType || normalizeToolSurface(groupTool) == normalizeToolSurface(toolType)
}

func normalizeToolSurface(toolType string) string {
	switch strings.TrimSpace(toolType) {
	case "generate", "image.generate":
		return "generate"
	default:
		return strings.TrimSpace(toolType)
	}
}

func firstEnabledFallback(group provider.StrategyGroup) (string, []string) {
	enabled := enabledMembers(group.Members)
	considered := strategyMemberProviderIDs(enabled)
	if len(enabled) == 0 {
		return "", considered
	}
	fallbackSet := make(map[string]bool, len(group.FallbackProviderIDs))
	for _, providerID := range group.FallbackProviderIDs {
		fallbackSet[strings.TrimSpace(providerID)] = true
	}
	sort.SliceStable(enabled, func(i, j int) bool {
		if enabled[i].FallbackRank == enabled[j].FallbackRank {
			return enabled[i].ProviderID < enabled[j].ProviderID
		}
		return enabled[i].FallbackRank < enabled[j].FallbackRank
	})
	for _, member := range enabled {
		if fallbackSet[member.ProviderID] {
			return member.ProviderID, considered
		}
	}
	return enabled[0].ProviderID, considered
}

func enabledMembers(members []provider.StrategyGroupMember) []provider.StrategyGroupMember {
	enabled := make([]provider.StrategyGroupMember, 0, len(members))
	for _, member := range members {
		member.ProviderID = strings.TrimSpace(member.ProviderID)
		if member.Enabled && member.ProviderID != "" {
			enabled = append(enabled, member)
		}
	}
	return enabled
}

func strategyMemberProviderIDs(members []provider.StrategyGroupMember) []string {
	providerIDs := make([]string, 0, len(members))
	for _, member := range members {
		providerIDs = append(providerIDs, member.ProviderID)
	}
	return providerIDs
}

func stablePercent(parts ...any) int {
	joined := make([]string, 0, len(parts))
	for _, part := range parts {
		joined = append(joined, fmt.Sprintf("%v", part))
	}
	sum := sha256String(strings.Join(joined, ":"))
	value := 0
	for idx := 0; idx < 8 && idx < len(sum); idx++ {
		value = (value*16 + hexDigit(sum[idx])) % 100
	}
	return value
}

func sha256String(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func hexDigit(ch byte) int {
	switch {
	case ch >= '0' && ch <= '9':
		return int(ch - '0')
	case ch >= 'a' && ch <= 'f':
		return int(ch-'a') + 10
	case ch >= 'A' && ch <= 'F':
		return int(ch-'A') + 10
	default:
		return 0
	}
}
