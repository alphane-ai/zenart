package skillbook

import (
	"strings"
	"testing"
	"time"

	evalcontract "github.com/alphane-ai/zenart/backend/internal/eval"
)

func TestProjectForUserAllowsReviewedEvalPassedActiveVersion(t *testing.T) {
	projection, err := ProjectForUser(validTemplate(), validVersion(VersionActive))
	if err != nil {
		t.Fatalf("ProjectForUser() error = %v", err)
	}
	if projection.Name != "Brand Campaign Builder" || projection.Version != "1.2.0" || projection.Canary {
		t.Fatalf("projection = %#v, want safe active projection", projection)
	}
}

func TestProjectForUserAllowsPassedCanaryVersion(t *testing.T) {
	version := validVersion(VersionCanary)
	version.RollbackTargetVersion = ""
	version.CanaryPercent = 10
	version.CanaryPassed = true

	projection, err := ProjectForUser(validTemplate(), version)
	if err != nil {
		t.Fatalf("ProjectForUser() error = %v", err)
	}
	if !projection.Canary {
		t.Fatalf("projection.Canary = false, want true")
	}
}

func TestProjectForUserBlocksReviewEvalCanaryAndRollbackFailures(t *testing.T) {
	template := validTemplate()

	version := validVersion(VersionActive)
	version.ReviewStatus = ReviewPending
	assertBlocked(t, template, version, "review_not_passed")

	version = validVersion(VersionActive)
	version.LatestEval.Pass = false
	assertBlocked(t, template, version, "eval_gate_not_passed")

	version = validVersion(VersionCanary)
	version.CanaryPassed = false
	assertBlocked(t, template, version, "canary_gate_not_passed")

	version = validVersion(VersionActive)
	version.RollbackTargetVersion = ""
	assertBlocked(t, template, version, "rollback_target_required")
}

func TestProjectForUserDoesNotExposePromptFragmentsOrHiddenPolicies(t *testing.T) {
	version := validVersion(VersionActive)
	version.PromptFragments = []string{"internal prompt fragment"}
	version.InternalPrompt = "never expose this prompt"
	version.HiddenPolicy = "hidden routing and policy"

	projection, err := ProjectForUser(validTemplate(), version)
	if err != nil {
		t.Fatalf("ProjectForUser() error = %v, want safe projection without internal fields", err)
	}
	rendered := strings.Join([]string{projection.Name, projection.Description, projection.Category, projection.Version}, " ")
	for _, forbidden := range []string{"internal prompt fragment", "never expose this prompt", "hidden routing and policy"} {
		if strings.Contains(rendered, forbidden) {
			t.Fatalf("projection leaked %q: %#v", forbidden, projection)
		}
	}

	version = validVersion(VersionActive)
	version.InternalPrompt = "Bearer abcdefghijklmnop"
	assertBlocked(t, validTemplate(), version, "internal_prompt_fragments_not_projectable")
}

func TestProjectForUserRejectsSecretLikeTemplateMetadata(t *testing.T) {
	template := validTemplate()
	template.Description = "Bearer abcdefghijklmnop"
	if _, err := ProjectForUser(template, validVersion(VersionActive)); err == nil || !strings.Contains(err.Error(), "secret_like_skill_metadata") {
		t.Fatalf("ProjectForUser() error = %v, want secret-like metadata block", err)
	}
}

func assertBlocked(t *testing.T, template SkillTemplate, version Version, reason string) {
	t.Helper()
	gate := EvaluateReleaseGate(template, version)
	if gate.Visible || !contains(gate.BlockedReasons, reason) {
		t.Fatalf("gate = %#v, want blocked reason %s", gate, reason)
	}
	if _, err := ProjectForUser(template, version); err == nil || !strings.Contains(err.Error(), reason) {
		t.Fatalf("ProjectForUser() error = %v, want reason %s", err, reason)
	}
}

func validTemplate() SkillTemplate {
	return SkillTemplate{
		ID:          "skill_brand_campaign",
		Name:        "Brand Campaign Builder",
		Description: "Creates reviewed campaign visuals from approved brand assets.",
		Category:    "marketing",
		Capabilities: []string{
			"batch_generation",
			"export",
			"edit_tools",
		},
		Tags: []string{"campaign", "brand"},
	}
}

func validVersion(status VersionStatus) Version {
	required := evalcontract.RequiredSuites()
	return Version{
		ID:                    "skill_version_1",
		SkillID:               "skill_brand_campaign",
		Version:               "1.2.0",
		Status:                status,
		ReviewStatus:          ReviewPassed,
		CanaryPercent:         100,
		CanaryPassed:          true,
		RollbackTargetVersion: "1.1.0",
		LatestEval: evalcontract.GateSummary{
			Pass:                      true,
			RequiredSuites:            required,
			CoveredSuites:             required,
			StoredResultIDs:           []string{"eval_batch", "eval_provider", "eval_edit", "eval_export", "eval_billing", "eval_safety"},
			ReadWithoutEvalRerun:      true,
			EvalContractComplete:      true,
			CriticalSafetyRegressions: 0,
		},
		PublishedAt: time.Date(2026, 6, 22, 13, 45, 0, 0, time.UTC),
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
