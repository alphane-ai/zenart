package eval

import (
	"strings"
	"testing"
	"time"
)

func TestGateResultsRequiresAllStage1Suites(t *testing.T) {
	results := []Result{
		validResult("eval_batch", SuiteBatchGeneration),
		validResult("eval_provider", SuiteProviderRouting),
		validResult("eval_edit", SuiteEditTools),
		validResult("eval_export", SuiteExport),
		validResult("eval_billing", SuiteBillingQuota),
		validResult("eval_safety", SuiteSafety),
	}

	gate := GateResults(results)
	if !gate.Pass || !gate.EvalContractComplete || !gate.ReadWithoutEvalRerun {
		t.Fatalf("gate = %#v, want pass", gate)
	}
	if len(gate.MissingSuites) != 0 {
		t.Fatalf("missing suites = %#v, want none", gate.MissingSuites)
	}
	if len(gate.CoveredSuites) != len(RequiredSuites()) {
		t.Fatalf("covered suites = %#v, want all required", gate.CoveredSuites)
	}
}

func TestGateResultsBlocksMissingSuiteFailedStatusAndSafetyRegression(t *testing.T) {
	results := []Result{
		validResult("eval_batch", SuiteBatchGeneration),
		validResult("eval_provider", SuiteProviderRouting),
		validResult("eval_edit", SuiteEditTools),
		validResult("eval_export", SuiteExport),
		validResult("eval_billing", SuiteBillingQuota),
	}
	results[4].Status = StatusFail
	results[4].CriticalSafetyRegressions = 1

	gate := GateResults(results)
	if gate.Pass || gate.EvalContractComplete {
		t.Fatalf("gate = %#v, want blocked incomplete contract", gate)
	}
	for _, want := range []string{"missing_suite_safety", "suite_billing_quota_not_pass", "critical_safety_regressions"} {
		if !containsString(gate.BlockedReasons, want) {
			t.Fatalf("blocked reasons = %#v, missing %s", gate.BlockedReasons, want)
		}
	}
}

func TestValidateStoredResultRequiresCoverageRunnerDigestAndStoredRead(t *testing.T) {
	result := validResult("eval_export", SuiteExport)
	result.RunnerSHA256 = ""
	if err := ValidateStoredResult(result); err == nil || !strings.Contains(err.Error(), "runner hash") {
		t.Fatalf("ValidateStoredResult() error = %v, want runner hash rejection", err)
	}

	result = validResult("eval_export", SuiteExport)
	result.ReadWithoutEvalRerun = false
	if err := ValidateStoredResult(result); err == nil || !strings.Contains(err.Error(), "without rerun") {
		t.Fatalf("ValidateStoredResult() error = %v, want stored read rejection", err)
	}

	result = validResult("eval_export", SuiteExport)
	result.Coverage.TraceComplete = false
	if err := ValidateStoredResult(result); err == nil || !strings.Contains(err.Error(), "coverage") {
		t.Fatalf("ValidateStoredResult() error = %v, want coverage rejection", err)
	}
}

func TestSafeResultProjectionRedactsSummaryAndRejectsSecretLikeFields(t *testing.T) {
	result := validResult("eval_safety", SuiteSafety)
	result.Summary = map[string]any{
		"score":      0.99,
		"api_key":    "redact-me",
		"raw_prompt": "project a safe public summary only",
	}

	projection, err := SafeResultProjection(result)
	if err != nil {
		t.Fatalf("SafeResultProjection() error = %v", err)
	}
	summary, ok := projection["summary"].(map[string]any)
	if !ok {
		t.Fatalf("summary projection = %#v, want map", projection["summary"])
	}
	if _, ok := summary["api_key"]; ok {
		t.Fatalf("summary projection kept api_key field: %#v", summary)
	}

	result = validResult("eval_safety", SuiteSafety)
	result.SourceFixtureDigest = "Bearer abcdefghijklmnop"
	result.Coverage.FixtureDigests = []string{result.SourceFixtureDigest}
	if _, err := SafeResultProjection(result); err == nil || !strings.Contains(err.Error(), "secret-like") {
		t.Fatalf("SafeResultProjection() error = %v, want secret-like rejection", err)
	}
}

func validResult(id string, suite SuiteID) Result {
	digest := StableHash(map[string]any{"suite": suite, "fixture": id})
	return Result{
		ID:       id,
		TenantID: "tenant_1",
		Suite:    suite,
		Subject: Subject{
			Type: SubjectSkillVersion,
			ID:   "skill_version_1",
		},
		Status: StatusPass,
		Coverage: Coverage{
			TraceComplete:      true,
			ExportGateComplete: true,
			QAComplete:         true,
			SafetyComplete:     true,
			FixtureSuites:      []SuiteID{suite},
			FixtureDigests:     []string{digest},
		},
		Summary: map[string]any{
			"safe_score": 0.98,
		},
		RunnerSHA256:         StableHash("runner-" + string(suite)),
		SourceFixtureDigest:  digest,
		ReadWithoutEvalRerun: true,
		CompletedAt:          time.Date(2026, 6, 22, 13, 30, 0, 0, time.UTC),
	}
}
