package trace

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

const WorkflowBatchGeneration = "batch_generation"

var (
	UserVisibleFields = []string{
		"trace_id",
		"task_id",
		"workflow",
		"task_status",
		"user_message",
		"final_export_allowed",
		"denial_reasons",
		"export_id",
	}
	UserHiddenFields = []string{
		"provider_payload",
		"internal_prompt",
		"raw_safety_payload",
		"safety_rule_rationale",
		"admin_audit_notes",
		"quota_transaction_internal_metadata",
		"agent_step_payload",
	}
	AdminVisibleTables = []string{
		"agent_traces",
		"eval_results",
		"qa_results",
		"safety_decisions",
		"exports",
		"audit_logs",
	}
	DefaultSafetyDecisionSteps  = []string{"brief", "provider_request", "provider_response", "qa", "export"}
	DefaultRetainedFiles        = []string{"manifest.json", "qa_report.json", "metadata.json", "trace_provenance.json", "safety_disclaimer.md"}
	DefaultBlockedRetainedFiles = []string{"qa_report.json", "trace_provenance.json", "safety_disclaimer.md"}
)

var forbiddenProjectionKeys = map[string]struct{}{
	"provider_payload":                    {},
	"raw_provider_payload":                {},
	"raw_provider_output":                 {},
	"internal_prompt":                     {},
	"hidden_prompt":                       {},
	"raw_prompt":                          {},
	"raw_safety_payload":                  {},
	"safety_rule_rationale":               {},
	"admin_audit_notes":                   {},
	"quota_transaction_internal_metadata": {},
	"agent_step_payload":                  {},
	"authorization":                       {},
	"api_key":                             {},
	"secret":                              {},
	"token":                               {},
	"password":                            {},
}

type PromptContextInput struct {
	Text              string
	SelectedObjectIDs []string
	ReferenceAssetIDs []string
	BrandKitID        string
	ModelHints        []string
	ToolHint          string
}

type PromptContextPayload struct {
	Text              string   `json:"text"`
	SelectedObjectIDs []string `json:"selected_object_ids"`
	ReferenceAssetIDs []string `json:"reference_asset_ids"`
	BrandKitID        string   `json:"brand_kit_id,omitempty"`
	ModelHints        []string `json:"model_hints"`
	ToolHint          string   `json:"tool_hint,omitempty"`
}

type PromptContextProjection struct {
	TextSHA256        string   `json:"text_sha256"`
	TextRedacted      bool     `json:"text_redacted"`
	SelectedObjectIDs []string `json:"selected_object_ids"`
	ReferenceAssetIDs []string `json:"reference_asset_ids"`
	BrandKitID        string   `json:"brand_kit_id,omitempty"`
	ModelHints        []string `json:"model_hints"`
	ToolHint          string   `json:"tool_hint,omitempty"`
}

type TraceProjectionInput struct {
	TraceID                string
	VisibleTraceRef        string
	BatchID                string
	ChildID                string
	TaskID                 string
	Workflow               string
	TaskStatus             string
	ProviderID             string
	ModelID                string
	ToolType               string
	ProviderRequestHash    string
	ProviderResponseID     string
	ProviderResponseStatus string
	PromptContext          PromptContextPayload
	AssetIDs               []string
	CanvasObjectIDs        []string
	ExportID               string
	PackageID              string
	FinalExportAllowed     bool
	DownloadEnabled        bool
	DenialReasons          []string
	RetainedFiles          []string
	RetainedWhenBlocked    []string
}

type TraceProjection struct {
	TraceID                   string                    `json:"trace_id"`
	VisibleTraceRef           string                    `json:"visible_trace_ref,omitempty"`
	BatchID                   string                    `json:"batch_id,omitempty"`
	ChildID                   string                    `json:"child_id,omitempty"`
	TaskID                    string                    `json:"task_id"`
	Workflow                  string                    `json:"workflow"`
	TaskStatus                string                    `json:"task_status"`
	PromptContext             PromptContextProjection   `json:"prompt_context"`
	ProviderID                string                    `json:"provider_id,omitempty"`
	ModelID                   string                    `json:"model_id,omitempty"`
	ToolType                  string                    `json:"tool_type,omitempty"`
	ProviderResponseID        string                    `json:"provider_response_id,omitempty"`
	ProviderResponseStatus    string                    `json:"provider_response_status,omitempty"`
	RequestHash               string                    `json:"request_hash"`
	AssetIDs                  []string                  `json:"asset_ids"`
	CanvasObjectIDs           []string                  `json:"canvas_object_ids"`
	UserTraceProjection       UserTraceProjection       `json:"user_trace_projection"`
	AdminTraceProjection      AdminTraceProjection      `json:"admin_trace_projection"`
	ExportRetentionProjection ExportRetentionProjection `json:"export_retention_projection"`
	RawPromptProjected        bool                      `json:"raw_prompt_projected"`
	RawProviderPayloadSaved   bool                      `json:"raw_provider_payload_saved"`
	RawSafetyPayloadProjected bool                      `json:"raw_safety_payload_projected"`
}

type UserTraceProjection struct {
	VisibleFields          []string `json:"visible_fields"`
	HiddenFields           []string `json:"hidden_fields"`
	FailureMappingRequired bool     `json:"failure_mapping_required"`
	IncludesDenialReasons  bool     `json:"includes_denial_reasons"`
	DownloadEnabled        bool     `json:"download_enabled"`
}

type AdminTraceProjection struct {
	VisibleTables                []string `json:"visible_tables"`
	RBACScope                    string   `json:"rbac_scope"`
	PayloadRedactionRequired     bool     `json:"payload_redaction_required"`
	LinksTraceExportEvalQASafety bool     `json:"links_trace_export_eval_qa_safety"`
	SafetyDecisionSteps          []string `json:"safety_decision_steps"`
}

type ExportRetentionProjection struct {
	PackageID           string   `json:"package_id,omitempty"`
	ExportID            string   `json:"export_id,omitempty"`
	RetainedFiles       []string `json:"retained_files"`
	RetainedWhenBlocked []string `json:"retained_when_blocked"`
	DownloadEnabled     bool     `json:"download_enabled"`
	FinalExportAllowed  bool     `json:"final_export_allowed"`
	RetentionReasons    []string `json:"retention_reasons"`
}

func BuildPromptContextPayload(input PromptContextInput) (PromptContextPayload, error) {
	text := strings.TrimSpace(input.Text)
	if text == "" {
		return PromptContextPayload{}, errors.New("prompt context text is required")
	}
	if findings := security.ClassifyString(text); len(findings) > 0 {
		return PromptContextPayload{}, fmt.Errorf("prompt context text contains secret-like material: %s", findings[0].Signal)
	}
	payload := PromptContextPayload{
		Text:              text,
		SelectedObjectIDs: trimUnique(input.SelectedObjectIDs),
		ReferenceAssetIDs: trimUnique(input.ReferenceAssetIDs),
		BrandKitID:        strings.TrimSpace(input.BrandKitID),
		ModelHints:        trimUnique(input.ModelHints),
		ToolHint:          strings.TrimSpace(input.ToolHint),
	}
	if findings := classifyPromptContextPayload(payload); len(findings) > 0 {
		return PromptContextPayload{}, fmt.Errorf("prompt context contains secret-like material at %s", firstFindingLocation(findings[0]))
	}
	return payload, nil
}

func BuildTraceProjection(input TraceProjectionInput) (TraceProjection, error) {
	input = normalizeTraceProjectionInput(input)
	if input.TraceID == "" || input.TaskID == "" {
		return TraceProjection{}, errors.New("trace_id and task_id are required")
	}
	if input.Workflow == "" {
		return TraceProjection{}, errors.New("workflow is required")
	}
	if strings.TrimSpace(input.PromptContext.Text) == "" {
		return TraceProjection{}, errors.New("prompt context text is required")
	}
	if findings := classifyTraceProjectionInput(input); len(findings) > 0 {
		return TraceProjection{}, fmt.Errorf("trace projection input contains secret-like material at %s", firstFindingLocation(findings[0]))
	}
	projection := TraceProjection{
		TraceID:                input.TraceID,
		VisibleTraceRef:        input.VisibleTraceRef,
		BatchID:                input.BatchID,
		ChildID:                input.ChildID,
		TaskID:                 input.TaskID,
		Workflow:               input.Workflow,
		TaskStatus:             input.TaskStatus,
		ProviderID:             input.ProviderID,
		ModelID:                input.ModelID,
		ToolType:               input.ToolType,
		ProviderResponseID:     input.ProviderResponseID,
		ProviderResponseStatus: input.ProviderResponseStatus,
		RequestHash:            input.ProviderRequestHash,
		AssetIDs:               trimUnique(input.AssetIDs),
		CanvasObjectIDs:        trimUnique(input.CanvasObjectIDs),
		PromptContext: PromptContextProjection{
			TextSHA256:        sha256Hex(input.PromptContext.Text),
			TextRedacted:      true,
			SelectedObjectIDs: append([]string(nil), input.PromptContext.SelectedObjectIDs...),
			ReferenceAssetIDs: append([]string(nil), input.PromptContext.ReferenceAssetIDs...),
			BrandKitID:        input.PromptContext.BrandKitID,
			ModelHints:        append([]string(nil), input.PromptContext.ModelHints...),
			ToolHint:          input.PromptContext.ToolHint,
		},
		UserTraceProjection: UserTraceProjection{
			VisibleFields:          append([]string(nil), UserVisibleFields...),
			HiddenFields:           append([]string(nil), UserHiddenFields...),
			FailureMappingRequired: true,
			IncludesDenialReasons:  true,
			DownloadEnabled:        input.DownloadEnabled,
		},
		AdminTraceProjection: AdminTraceProjection{
			VisibleTables:                append([]string(nil), AdminVisibleTables...),
			RBACScope:                    "admin_reviewer",
			PayloadRedactionRequired:     true,
			LinksTraceExportEvalQASafety: true,
			SafetyDecisionSteps:          append([]string(nil), DefaultSafetyDecisionSteps...),
		},
		ExportRetentionProjection: ExportRetentionProjection{
			PackageID:           input.PackageID,
			ExportID:            input.ExportID,
			RetainedFiles:       retainedFiles(input.RetainedFiles, DefaultRetainedFiles),
			RetainedWhenBlocked: retainedFiles(input.RetainedWhenBlocked, DefaultBlockedRetainedFiles),
			DownloadEnabled:     input.DownloadEnabled,
			FinalExportAllowed:  input.FinalExportAllowed,
			RetentionReasons:    trimUnique(input.DenialReasons),
		},
		RawPromptProjected:        false,
		RawProviderPayloadSaved:   false,
		RawSafetyPayloadProjected: false,
	}
	if err := ValidateUserExportProjection(projection); err != nil {
		return TraceProjection{}, err
	}
	return projection, nil
}

func (p TraceProjection) Map() map[string]any {
	body, err := json.Marshal(p)
	if err != nil {
		return map[string]any{"projection_error": security.RedactString(err.Error())}
	}
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		return map[string]any{"projection_error": security.RedactString(err.Error())}
	}
	return out
}

func ValidateUserExportProjection(value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	var decoded any
	if err := json.Unmarshal(body, &decoded); err != nil {
		return err
	}
	if key, ok := containsForbiddenProjectionKey(decoded); ok {
		return fmt.Errorf("trace projection contains forbidden red-line field %q", key)
	}
	if findings := security.ClassifyValue(decoded); len(findings) > 0 {
		return fmt.Errorf("trace projection contains secret-like material at %s", findings[0].Location)
	}
	return nil
}

func normalizeTraceProjectionInput(input TraceProjectionInput) TraceProjectionInput {
	input.TraceID = strings.TrimSpace(input.TraceID)
	input.VisibleTraceRef = strings.TrimSpace(input.VisibleTraceRef)
	input.BatchID = strings.TrimSpace(input.BatchID)
	input.ChildID = strings.TrimSpace(input.ChildID)
	input.TaskID = strings.TrimSpace(input.TaskID)
	if input.TaskID == "" {
		input.TaskID = input.ChildID
	}
	input.Workflow = strings.TrimSpace(input.Workflow)
	if input.Workflow == "" {
		input.Workflow = WorkflowBatchGeneration
	}
	input.TaskStatus = strings.TrimSpace(input.TaskStatus)
	input.ProviderID = strings.TrimSpace(input.ProviderID)
	input.ModelID = strings.TrimSpace(input.ModelID)
	input.ToolType = strings.TrimSpace(input.ToolType)
	input.ProviderRequestHash = strings.TrimSpace(input.ProviderRequestHash)
	input.ProviderResponseID = strings.TrimSpace(input.ProviderResponseID)
	input.ProviderResponseStatus = strings.TrimSpace(input.ProviderResponseStatus)
	input.ExportID = strings.TrimSpace(input.ExportID)
	input.PackageID = strings.TrimSpace(input.PackageID)
	return input
}

func containsForbiddenProjectionKey(value any) (string, bool) {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			normalized := strings.ToLower(strings.TrimSpace(key))
			if _, forbidden := forbiddenProjectionKeys[normalized]; forbidden {
				return key, true
			}
			if key, ok := containsForbiddenProjectionKey(child); ok {
				return key, true
			}
		}
	case []any:
		for _, child := range typed {
			if key, ok := containsForbiddenProjectionKey(child); ok {
				return key, true
			}
		}
	}
	return "", false
}

func trimUnique(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func retainedFiles(values, fallback []string) []string {
	out := trimUnique(values)
	if len(out) == 0 {
		out = append([]string(nil), fallback...)
	}
	return out
}

func classifyPromptContextPayload(payload PromptContextPayload) []security.SecretFinding {
	fields := map[string]any{
		"text":                payload.Text,
		"selected_object_ids": payload.SelectedObjectIDs,
		"reference_asset_ids": payload.ReferenceAssetIDs,
		"brand_kit_id":        payload.BrandKitID,
		"model_hints":         payload.ModelHints,
		"tool_hint":           payload.ToolHint,
	}
	return security.ClassifyValue(fields)
}

func classifyTraceProjectionInput(input TraceProjectionInput) []security.SecretFinding {
	fields := map[string]any{
		"trace_id":                 input.TraceID,
		"visible_trace_ref":        input.VisibleTraceRef,
		"batch_id":                 input.BatchID,
		"child_id":                 input.ChildID,
		"task_id":                  input.TaskID,
		"workflow":                 input.Workflow,
		"task_status":              input.TaskStatus,
		"provider_id":              input.ProviderID,
		"model_id":                 input.ModelID,
		"tool_type":                input.ToolType,
		"provider_request_hash":    input.ProviderRequestHash,
		"provider_response_id":     input.ProviderResponseID,
		"provider_response_status": input.ProviderResponseStatus,
		"asset_ids":                input.AssetIDs,
		"canvas_object_ids":        input.CanvasObjectIDs,
		"export_id":                input.ExportID,
		"package_id":               input.PackageID,
		"denial_reasons":           input.DenialReasons,
		"retained_files":           input.RetainedFiles,
		"retained_when_blocked":    input.RetainedWhenBlocked,
	}
	findings := security.ClassifyValue(fields)
	return append(findings, classifyPromptContextPayload(input.PromptContext)...)
}

func firstFindingLocation(finding security.SecretFinding) string {
	if strings.TrimSpace(finding.Location) != "" {
		return finding.Location
	}
	return finding.Signal
}

func sha256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
