package agent

import "testing"

func TestBaseStepContractsCoverRequiredStage0Contracts(t *testing.T) {
	contracts := BaseStepContracts(1)
	seen := map[string]bool{}
	for _, contract := range contracts {
		seen[contract.Name] = true
		if contract.SchemaVersion != 1 {
			t.Fatalf("%s SchemaVersion = %d, want 1", contract.Name, contract.SchemaVersion)
		}
		if !contract.Idempotency.Required {
			t.Fatalf("%s must require idempotency", contract.Name)
		}
		if contract.Quota.Mode != "reserve_commit_refund" {
			t.Fatalf("%s quota mode = %q", contract.Name, contract.Quota.Mode)
		}
	}

	required := []string{
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
	for _, name := range required {
		if !seen[name] {
			t.Fatalf("missing contract %q", name)
		}
	}
}
