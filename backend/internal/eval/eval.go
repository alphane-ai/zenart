package eval

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

type SuiteID string

const (
	SuiteBatchGeneration SuiteID = "batch_generation"
	SuiteProviderRouting SuiteID = "provider_routing"
	SuiteEditTools       SuiteID = "edit_tools"
	SuiteExport          SuiteID = "export"
	SuiteBillingQuota    SuiteID = "billing_quota"
	SuiteSafety          SuiteID = "safety"
)

type Status string

const (
	StatusPass Status = "pass"
	StatusFail Status = "fail"
)

type SubjectType string

const (
	SubjectSkillVersion SubjectType = "skill_version"
	SubjectProvider     SubjectType = "provider"
	SubjectRelease      SubjectType = "release"
)

type Subject struct {
	Type SubjectType `json:"type"`
	ID   string      `json:"id"`
}

type Fixture struct {
	ID     string         `json:"id"`
	Suite  SuiteID        `json:"suite"`
	Digest string         `json:"digest"`
	Tags   []string       `json:"tags,omitempty"`
	Input  map[string]any `json:"input,omitempty"`
}

type Suite struct {
	ID       SuiteID   `json:"id"`
	Name     string    `json:"name"`
	Fixtures []Fixture `json:"fixtures"`
	Required bool      `json:"required"`
}

type Coverage struct {
	TraceComplete      bool      `json:"trace_complete"`
	ExportGateComplete bool      `json:"export_gate_complete"`
	QAComplete         bool      `json:"qa_complete"`
	SafetyComplete     bool      `json:"safety_complete"`
	FixtureSuites      []SuiteID `json:"fixture_suites"`
	FixtureDigests     []string  `json:"fixture_digests"`
}

type Result struct {
	ID                        string         `json:"id"`
	TenantID                  string         `json:"tenant_id"`
	Suite                     SuiteID        `json:"suite"`
	Subject                   Subject        `json:"subject"`
	Status                    Status         `json:"status"`
	Coverage                  Coverage       `json:"coverage"`
	Summary                   map[string]any `json:"summary,omitempty"`
	RunnerSHA256              string         `json:"runner_sha256"`
	SourceFixtureDigest       string         `json:"source_fixture_digest"`
	CriticalSafetyRegressions int            `json:"critical_safety_regressions"`
	ReadWithoutEvalRerun      bool           `json:"read_without_eval_rerun"`
	CompletedAt               time.Time      `json:"completed_at"`
}

type GateSummary struct {
	Pass                      bool      `json:"pass"`
	RequiredSuites            []SuiteID `json:"required_suites"`
	CoveredSuites             []SuiteID `json:"covered_suites"`
	MissingSuites             []SuiteID `json:"missing_suites,omitempty"`
	BlockedReasons            []string  `json:"blocked_reasons,omitempty"`
	StoredResultIDs           []string  `json:"stored_result_ids"`
	ReadWithoutEvalRerun      bool      `json:"read_without_eval_rerun"`
	EvalContractComplete      bool      `json:"eval_contract_complete"`
	CriticalSafetyRegressions int       `json:"critical_safety_regressions"`
}

var ErrValidation = errors.New("eval contract validation error")

func RequiredSuites() []SuiteID {
	return []SuiteID{
		SuiteBatchGeneration,
		SuiteProviderRouting,
		SuiteEditTools,
		SuiteExport,
		SuiteBillingQuota,
		SuiteSafety,
	}
}

func ValidateSuite(suite Suite) error {
	if !requiredSuiteSet()[suite.ID] {
		return fmt.Errorf("%w: unsupported suite %q", ErrValidation, suite.ID)
	}
	if strings.TrimSpace(suite.Name) == "" {
		return fmt.Errorf("%w: suite name is required", ErrValidation)
	}
	if suite.Required && len(suite.Fixtures) == 0 {
		return fmt.Errorf("%w: required suite %q needs fixtures", ErrValidation, suite.ID)
	}
	for _, fixture := range suite.Fixtures {
		if err := ValidateFixture(fixture); err != nil {
			return err
		}
		if fixture.Suite != suite.ID {
			return fmt.Errorf("%w: fixture %q suite mismatch", ErrValidation, fixture.ID)
		}
	}
	if findings := security.ClassifyValue(suite); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like eval suite field at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func ValidateFixture(fixture Fixture) error {
	if strings.TrimSpace(fixture.ID) == "" {
		return fmt.Errorf("%w: fixture id is required", ErrValidation)
	}
	if !requiredSuiteSet()[fixture.Suite] {
		return fmt.Errorf("%w: unsupported fixture suite %q", ErrValidation, fixture.Suite)
	}
	if strings.TrimSpace(fixture.Digest) == "" {
		return fmt.Errorf("%w: fixture digest is required", ErrValidation)
	}
	if findings := security.ClassifyValue(fixture); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like eval fixture field at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func ValidateStoredResult(result Result) error {
	if strings.TrimSpace(result.ID) == "" || strings.TrimSpace(result.TenantID) == "" {
		return fmt.Errorf("%w: result id and tenant_id are required", ErrValidation)
	}
	if !requiredSuiteSet()[result.Suite] {
		return fmt.Errorf("%w: unsupported result suite %q", ErrValidation, result.Suite)
	}
	if result.Subject.Type == "" || strings.TrimSpace(result.Subject.ID) == "" {
		return fmt.Errorf("%w: result subject is required", ErrValidation)
	}
	if result.Status != StatusPass && result.Status != StatusFail {
		return fmt.Errorf("%w: unsupported result status %q", ErrValidation, result.Status)
	}
	if strings.TrimSpace(result.RunnerSHA256) == "" || strings.TrimSpace(result.SourceFixtureDigest) == "" {
		return fmt.Errorf("%w: deterministic runner hash and source fixture digest are required", ErrValidation)
	}
	if !result.ReadWithoutEvalRerun {
		return fmt.Errorf("%w: stored eval result must be readable without rerun", ErrValidation)
	}
	if !result.Coverage.TraceComplete || !result.Coverage.ExportGateComplete || !result.Coverage.QAComplete || !result.Coverage.SafetyComplete {
		return fmt.Errorf("%w: trace, export gate, QA, and safety coverage are required", ErrValidation)
	}
	if !containsSuite(result.Coverage.FixtureSuites, result.Suite) {
		return fmt.Errorf("%w: fixture coverage must include suite %q", ErrValidation, result.Suite)
	}
	if !containsString(result.Coverage.FixtureDigests, result.SourceFixtureDigest) {
		return fmt.Errorf("%w: fixture coverage must include source fixture digest", ErrValidation)
	}
	if result.Status == StatusPass && result.CriticalSafetyRegressions > 0 {
		return fmt.Errorf("%w: passing result cannot contain critical safety regressions", ErrValidation)
	}
	if findings := security.ClassifyValue(map[string]any{
		"id":                          result.ID,
		"tenant_id":                   result.TenantID,
		"suite":                       string(result.Suite),
		"subject_type":                string(result.Subject.Type),
		"subject_id":                  result.Subject.ID,
		"status":                      string(result.Status),
		"summary":                     safeSummaryProjection(result.Summary),
		"runner_sha256":               result.RunnerSHA256,
		"source_fixture_digest":       result.SourceFixtureDigest,
		"critical_safety_regressions": result.CriticalSafetyRegressions,
		"read_without_eval_rerun":     result.ReadWithoutEvalRerun,
		"trace_complete":              result.Coverage.TraceComplete,
		"export_gate_complete":        result.Coverage.ExportGateComplete,
		"qa_complete":                 result.Coverage.QAComplete,
		"safety_complete":             result.Coverage.SafetyComplete,
		"coverage_fixture_suites":     result.Coverage.FixtureSuites,
		"coverage_fixture_digests":    result.Coverage.FixtureDigests,
	}); len(findings) > 0 {
		return fmt.Errorf("%w: secret-like eval result field at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return nil
}

func GateResults(results []Result) GateSummary {
	required := RequiredSuites()
	summary := GateSummary{
		Pass:                 true,
		RequiredSuites:       required,
		ReadWithoutEvalRerun: true,
		EvalContractComplete: true,
	}
	covered := map[SuiteID]bool{}
	for _, result := range results {
		if strings.TrimSpace(result.ID) != "" {
			summary.StoredResultIDs = append(summary.StoredResultIDs, result.ID)
		}
		if err := ValidateStoredResult(result); err != nil {
			summary.Pass = false
			summary.EvalContractComplete = false
			summary.BlockedReasons = append(summary.BlockedReasons, err.Error())
			continue
		}
		if result.Status != StatusPass {
			summary.Pass = false
			summary.BlockedReasons = append(summary.BlockedReasons, fmt.Sprintf("suite_%s_not_pass", result.Suite))
		}
		if !result.ReadWithoutEvalRerun {
			summary.ReadWithoutEvalRerun = false
		}
		summary.CriticalSafetyRegressions += result.CriticalSafetyRegressions
		covered[result.Suite] = true
	}
	for _, suite := range required {
		if covered[suite] {
			summary.CoveredSuites = append(summary.CoveredSuites, suite)
			continue
		}
		summary.Pass = false
		summary.EvalContractComplete = false
		summary.MissingSuites = append(summary.MissingSuites, suite)
		summary.BlockedReasons = append(summary.BlockedReasons, fmt.Sprintf("missing_suite_%s", suite))
	}
	if summary.CriticalSafetyRegressions > 0 {
		summary.Pass = false
		summary.BlockedReasons = append(summary.BlockedReasons, "critical_safety_regressions")
	}
	summary.StoredResultIDs = uniqueSortedStrings(summary.StoredResultIDs)
	summary.BlockedReasons = uniqueSortedStrings(summary.BlockedReasons)
	return summary
}

func SafeResultProjection(result Result) (map[string]any, error) {
	if err := ValidateStoredResult(result); err != nil {
		return nil, err
	}
	projection := map[string]any{
		"id":                          result.ID,
		"tenant_id":                   result.TenantID,
		"suite":                       string(result.Suite),
		"subject_type":                string(result.Subject.Type),
		"subject_id":                  result.Subject.ID,
		"status":                      string(result.Status),
		"summary":                     safeSummaryProjection(result.Summary),
		"runner_sha256":               result.RunnerSHA256,
		"source_fixture_digest":       result.SourceFixtureDigest,
		"read_without_eval_rerun":     result.ReadWithoutEvalRerun,
		"critical_safety_regressions": result.CriticalSafetyRegressions,
		"completed_at":                result.CompletedAt,
	}
	if findings := security.ClassifyValue(projection); len(findings) > 0 {
		return nil, fmt.Errorf("%w: secret-like eval projection field at %s", ErrValidation, firstFindingLocation(findings[0]))
	}
	return projection, nil
}

func safeSummaryProjection(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	out := make(map[string]any, len(input))
	for key, value := range input {
		if security.IsSensitiveKey(key) {
			continue
		}
		out[key] = security.RedactValue(value)
	}
	return out
}

func StableHash(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		payload = []byte(fmt.Sprintf("%#v", value))
	}
	sum := sha256.Sum256(payload)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func requiredSuiteSet() map[SuiteID]bool {
	out := map[SuiteID]bool{}
	for _, suite := range RequiredSuites() {
		out[suite] = true
	}
	return out
}

func containsSuite(values []SuiteID, want SuiteID) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
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
