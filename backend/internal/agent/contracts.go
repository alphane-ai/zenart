package agent

type StepContract struct {
	Name                 string               `json:"name"`
	SchemaVersion        int                  `json:"schema_version"`
	InputSchemaRef       string               `json:"input_schema_ref"`
	OutputSchemaRef      string               `json:"output_schema_ref"`
	ErrorCategories      []string             `json:"error_categories"`
	Retry                RetryPolicy          `json:"retry"`
	Idempotency          IdempotencyPolicy    `json:"idempotency"`
	Quota                QuotaPolicy          `json:"quota"`
	Safety               SafetyPolicy         `json:"safety"`
	UserStatusMapping    map[string]string    `json:"user_status_mapping"`
	AdminDebugVisibility AdminDebugVisibility `json:"admin_debug_visibility"`
	EvalFixtureCoverage  []string             `json:"eval_fixture_coverage"`
}

type RetryPolicy struct {
	MaxAttempts int      `json:"max_attempts"`
	OnErrors    []string `json:"on_errors"`
}

type IdempotencyPolicy struct {
	Required bool   `json:"required"`
	Scope    string `json:"scope"`
}

type QuotaPolicy struct {
	Mode          string `json:"mode"`
	EstimateUnits int64  `json:"estimate_units"`
}

type SafetyPolicy struct {
	RequiredChecks []string `json:"required_checks"`
}

type AdminDebugVisibility struct {
	ShowInput      bool `json:"show_input"`
	ShowOutput     bool `json:"show_output"`
	ShowTrace      bool `json:"show_trace"`
	ShowProviderIO bool `json:"show_provider_io"`
}

func BaseStepContracts(schemaVersion int) []StepContract {
	names := []string{
		"intent_router",
		"brief_completion",
		"workflow_planner",
		"hidden_skill_selector",
		"meta_prompt_spec_resolver",
		"prompt_fragment_composer",
		"safety_policy_injector",
		"provider_model_router",
		"candidate_set_builder",
		"iteration_planner",
		"design_qa_runner",
		"package_export_builder",
		"feedback_extractor",
		"prompt_mutation_proposer",
	}

	contracts := make([]StepContract, 0, len(names))
	for _, name := range names {
		contracts = append(contracts, StepContract{
			Name:            name,
			SchemaVersion:   schemaVersion,
			InputSchemaRef:  "urn:zenart:agent:" + name + ":input:v1",
			OutputSchemaRef: "urn:zenart:agent:" + name + ":output:v1",
			ErrorCategories: []string{"validation", "dependency", "provider", "quota", "safety", "internal"},
			Retry: RetryPolicy{
				MaxAttempts: 3,
				OnErrors:    []string{"dependency", "provider"},
			},
			Idempotency: IdempotencyPolicy{Required: true, Scope: "tenant_task"},
			Quota:       QuotaPolicy{Mode: "reserve_commit_refund", EstimateUnits: 0},
			Safety:      SafetyPolicy{RequiredChecks: []string{"policy_version_present"}},
			UserStatusMapping: map[string]string{
				"queued":    "queued",
				"running":   "running",
				"succeeded": "completed",
				"failed":    "failed",
			},
			AdminDebugVisibility: AdminDebugVisibility{
				ShowInput:      true,
				ShowOutput:     true,
				ShowTrace:      true,
				ShowProviderIO: false,
			},
			EvalFixtureCoverage: []string{},
		})
	}
	return contracts
}
