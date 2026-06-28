package skillbook

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	evalcontract "github.com/alphane-ai/zenart/backend/internal/eval"
	"github.com/alphane-ai/zenart/backend/internal/security"
)

type VersionStatus string

const (
	VersionDraft    VersionStatus = "draft"
	VersionReview   VersionStatus = "review"
	VersionCanary   VersionStatus = "canary"
	VersionActive   VersionStatus = "active"
	VersionArchived VersionStatus = "archived"
)

type ReviewStatus string

const (
	ReviewPending ReviewStatus = "pending"
	ReviewPassed  ReviewStatus = "passed"
	ReviewFailed  ReviewStatus = "failed"
)

type SkillTemplate struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Category     string   `json:"category"`
	Capabilities []string `json:"capabilities"`
	Tags         []string `json:"tags,omitempty"`
}

type Version struct {
	ID                    string                   `json:"id"`
	SkillID               string                   `json:"skill_id"`
	Version               string                   `json:"version"`
	Status                VersionStatus            `json:"status"`
	ReviewStatus          ReviewStatus             `json:"review_status"`
	CanaryPercent         int                      `json:"canary_percent"`
	CanaryPassed          bool                     `json:"canary_passed"`
	RollbackTargetVersion string                   `json:"rollback_target_version,omitempty"`
	LatestEval            evalcontract.GateSummary `json:"latest_eval"`
	PromptFragments       []string                 `json:"prompt_fragments,omitempty"`
	InternalPrompt        string                   `json:"internal_prompt,omitempty"`
	HiddenPolicy          string                   `json:"hidden_policy,omitempty"`
	Metadata              map[string]any           `json:"metadata,omitempty"`
	PublishedAt           time.Time                `json:"published_at,omitempty"`
}

type ReleaseGate struct {
	Visible        bool     `json:"visible"`
	AllowedState   string   `json:"allowed_state"`
	BlockedReasons []string `json:"blocked_reasons,omitempty"`
}

type UserProjection struct {
	ID           string    `json:"id"`
	SkillID      string    `json:"skill_id"`
	Name         string    `json:"name"`
	Description  string    `json:"description"`
	Category     string    `json:"category"`
	Capabilities []string  `json:"capabilities"`
	Tags         []string  `json:"tags,omitempty"`
	Version      string    `json:"version"`
	Canary       bool      `json:"canary"`
	PublishedAt  time.Time `json:"published_at,omitempty"`
}

var ErrValidation = errors.New("skillbook contract validation error")

func EvaluateReleaseGate(template SkillTemplate, version Version) ReleaseGate {
	gate := ReleaseGate{
		Visible:      true,
		AllowedState: string(version.Status),
	}
	if strings.TrimSpace(template.ID) == "" || strings.TrimSpace(version.ID) == "" || strings.TrimSpace(version.SkillID) == "" {
		gate.Visible = false
		gate.BlockedReasons = append(gate.BlockedReasons, "template_and_version_ids_required")
	}
	if version.SkillID != template.ID {
		gate.Visible = false
		gate.BlockedReasons = append(gate.BlockedReasons, "skill_version_mismatch")
	}
	if version.Status != VersionActive && version.Status != VersionCanary {
		gate.Visible = false
		gate.BlockedReasons = append(gate.BlockedReasons, "version_not_active_or_canary")
	}
	if version.ReviewStatus != ReviewPassed {
		gate.Visible = false
		gate.BlockedReasons = append(gate.BlockedReasons, "review_not_passed")
	}
	if !version.LatestEval.Pass || !version.LatestEval.EvalContractComplete || len(version.LatestEval.MissingSuites) > 0 {
		gate.Visible = false
		gate.BlockedReasons = append(gate.BlockedReasons, "eval_gate_not_passed")
	}
	if version.LatestEval.CriticalSafetyRegressions > 0 {
		gate.Visible = false
		gate.BlockedReasons = append(gate.BlockedReasons, "critical_safety_regressions")
	}
	if version.Status == VersionCanary {
		if !version.CanaryPassed || version.CanaryPercent <= 0 || version.CanaryPercent > 100 {
			gate.Visible = false
			gate.BlockedReasons = append(gate.BlockedReasons, "canary_gate_not_passed")
		}
	}
	if version.Status == VersionActive && strings.TrimSpace(version.RollbackTargetVersion) == "" {
		gate.Visible = false
		gate.BlockedReasons = append(gate.BlockedReasons, "rollback_target_required")
	}
	if findings := security.ClassifyValue(map[string]any{
		"template":         template,
		"prompt_fragments": version.PromptFragments,
		"internal_prompt":  version.InternalPrompt,
		"hidden_policy":    version.HiddenPolicy,
		"version_metadata": version.Metadata,
	}); len(findings) > 0 {
		gate.Visible = false
		gate.BlockedReasons = append(gate.BlockedReasons, "internal_prompt_fragments_not_projectable", "secret_like_skill_metadata")
	}
	gate.BlockedReasons = uniqueSortedStrings(gate.BlockedReasons)
	return gate
}

func ProjectForUser(template SkillTemplate, version Version) (UserProjection, error) {
	gate := EvaluateReleaseGate(template, version)
	if !gate.Visible {
		return UserProjection{}, fmt.Errorf("%w: skill version not user-visible: %s", ErrValidation, strings.Join(gate.BlockedReasons, ","))
	}
	projection := UserProjection{
		ID:           version.ID,
		SkillID:      template.ID,
		Name:         strings.TrimSpace(template.Name),
		Description:  strings.TrimSpace(template.Description),
		Category:     strings.TrimSpace(template.Category),
		Capabilities: uniqueSortedStrings(template.Capabilities),
		Tags:         uniqueSortedStrings(template.Tags),
		Version:      strings.TrimSpace(version.Version),
		Canary:       version.Status == VersionCanary,
		PublishedAt:  version.PublishedAt,
	}
	if projection.Name == "" || projection.Description == "" || projection.Category == "" || projection.Version == "" {
		return UserProjection{}, fmt.Errorf("%w: user projection label, description, category, and version are required", ErrValidation)
	}
	if findings := security.ClassifyValue(projection); len(findings) > 0 {
		return UserProjection{}, fmt.Errorf("%w: secret-like user skill projection at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return projection, nil
}

func uniqueSortedStrings(values []string) []string {
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
