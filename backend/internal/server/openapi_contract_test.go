package server

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestOpenAPIContractCoversServerRoutes(t *testing.T) {
	contract := readOpenAPIContract(t)
	required := []string{
		"/tasks/{task_id}",
		"/audit",
		"/support/tickets",
		"/abuse/events",
		"/providers/status",
		"/providers/usage",
		"/exports",
		"TaskStatus:",
		"ErrorEnvelope:",
		"IdempotencyKey:",
		"x-rbac:",
		"page_token",
		"page_size",
		"search",
		"sort",
	}
	for _, token := range required {
		if !bytes.Contains(contract, []byte(token)) {
			t.Fatalf("OpenAPI contract missing %q", token)
		}
	}
}

func TestOpenAPIContractCoversAdminSupportAbuseProviderAndExportRoutes(t *testing.T) {
	contract := string(readOpenAPIContract(t))
	for _, token := range []string{
		"operationId: listSupportTickets",
		"operationId: listAbuseEvents",
		"operationId: listProviderStatus",
		"operationId: listProviderUsage",
		"operationId: listExports",
		"operationId: cleanupExports",
		"operationId: regenerateExport",
		"operationId: createSafetyDecision",
		"operationId: listAnalyticsEvents",
		"operationId: listAnalyticsReports",
		"operationId: createAdminBillingManualCredit",
		"operationId: createAdminBillingRefundNote",
		"operationId: createAdminBillingSubscriptionSync",
		"operationId: createAdminBillingAccountLock",
		"operationId: getTeamSeatUsage",
		"operationId: checkTeamSeatEntitlement",
		"operationId: acceptTeamInvite",
		"operationId: createAdminTeam",
		"operationId: createAdminTeamInvite",
		"operationId: removeAdminTeamMember",
		"operationId: getAdminTeamSeatUsage",
		"operationId: getAdminTeamBillingLink",
		"operationId: upsertAdminTeamBillingLink",
		"operationId: listAdminTeamSeatBillingSyncs",
		"operationId: startCrawlerRun",
		"SupportTicketPage:",
		"AbuseEventPage:",
		"ProviderStatusPage:",
		"ProviderUsagePage:",
		"ExportPage:",
		"SafetyDecision:",
		"AnalyticsEventPage:",
		"AnalyticsReportPage:",
		"AdminBillingManualCreditCreate:",
		"AdminBillingRefundNoteCreate:",
		"AdminBillingSubscriptionSyncCreate:",
		"AdminBillingAccountLockCreate:",
		"AdminBillingOperation:",
		"TeamSeatUsage:",
		"TeamSeatEntitlement:",
		"AdminTeamCreate:",
		"AdminTeamInviteCreate:",
		"AdminTeamMemberRemove:",
		"TeamBillingLink:",
		"TeamBillingLinkUpsert:",
		"TeamSeatSyncPage:",
		"CrawlerSourceId:",
	} {
		if !strings.Contains(contract, token) {
			t.Fatalf("OpenAPI admin operations missing %q", token)
		}
	}
}

func TestOpenAPITaskStatusMatchesBackendContract(t *testing.T) {
	contract := string(readOpenAPIContract(t))
	for _, token := range []string{
		"enum: [pending, running, succeeded, failed, cancelled]",
		"progress:",
		"retry_count:",
		"timeout_at:",
		"user_message:",
		"app_version:",
		"worker_version:",
		"schema_version:",
	} {
		if !strings.Contains(contract, token) {
			t.Fatalf("TaskStatus contract missing %q", token)
		}
	}
}

func TestOpenAPIAgentTraceRequiresCompletenessContract(t *testing.T) {
	contract := string(readOpenAPIContract(t))
	for _, token := range []string{
		"AgentTrace:",
		"request_id:",
		"workflow:",
		"enum: [brief, provider_request, provider_response, qa, export]",
		"schema_validation:",
		"provenance:",
		"safety_status:",
		"qa_eval_status:",
		"quota_transaction_id:",
		"admin_visibility:",
		"user_failure_mapping:",
		"export_references:",
		"artifact_links:",
		"eval_result_ref:",
		"qa_result_refs:",
		"user_trace_projection:",
		"admin_trace_projection:",
		"export_retention_projection:",
		"eval_results",
		"qa_results",
		"asset_ids:",
		"package_id:",
		"export_id:",
		"manifest_linked:",
		"qa_report_linked:",
		"trace_provenance:",
		"safety_disclaimer_when_applicable:",
		"visible_fields:",
		"hidden_fields:",
		"provider_payload",
		"internal_prompt",
		"raw_safety_payload",
		"visible_tables:",
		"retained_files:",
		"retained_when_blocked:",
		"download_enabled:",
		"denial_reasons:",
	} {
		if !strings.Contains(contract, token) {
			t.Fatalf("AgentTrace completeness contract missing %q", token)
		}
	}
}

func TestOpenAPIOperationsDeclareSharedErrorEnvelope(t *testing.T) {
	contract := string(readOpenAPIContract(t))
	blocks := openAPIOperationBlocks(contract)
	if len(blocks) == 0 {
		t.Fatal("no OpenAPI operation blocks found")
	}
	for operationID, block := range blocks {
		if !strings.Contains(block, "default:") || !strings.Contains(block, `$ref: "#/components/responses/Error"`) {
			t.Fatalf("%s must declare shared ErrorEnvelope default response", operationID)
		}
	}
}

func TestOpenAPIContractCoversNonSpecialBackendAPIRoutes(t *testing.T) {
	contract := string(readOpenAPIContract(t))
	contractRoutes := openAPIRouteKeys(contract)
	if len(contractRoutes) == 0 {
		t.Fatal("no OpenAPI routes found")
	}

	serverPath := filepath.Join("server.go")
	serverSource, err := os.ReadFile(serverPath)
	if err != nil {
		t.Fatalf("read server routes: %v", err)
	}
	serverRoutes := serverRouteKeys(string(serverSource))
	if len(serverRoutes) == 0 {
		t.Fatal("no backend API routes found")
	}

	special := map[string]string{
		"POST /auth/local/session": "local development session bootstrap is not a public generated API operation",
		"POST /billing/webhook":    "Stripe server-to-server webhook is validated by billing evidence, not generated clients",
		"PUT /objects/upload":      "signed upload URL accepts object bytes and is not a JSON API operation",
		"GET /objects/download":    "signed download URL streams object bytes and is not a JSON API operation",
	}
	for key, backendPath := range serverRoutes {
		if _, ok := special[key]; ok {
			continue
		}
		if !contractRoutes[key] {
			t.Fatalf("OpenAPI contract missing backend route %s from %s", key, backendPath)
		}
	}
}

func openAPIOperationBlocks(contract string) map[string]string {
	blocks := make(map[string]string)
	lines := strings.Split(contract, "\n")
	var operationID string
	var block strings.Builder

	flush := func() {
		if operationID == "" {
			return
		}
		blocks[operationID] = block.String()
		operationID = ""
		block.Reset()
	}

	for _, line := range lines {
		if strings.HasPrefix(line, "components:") {
			flush()
			break
		}
		if isOpenAPIMethodLine(line) {
			flush()
		}
		if operationID != "" {
			block.WriteString(line)
			block.WriteString("\n")
		}
		if strings.HasPrefix(line, "      operationId: ") {
			operationID = strings.TrimPrefix(strings.TrimSpace(line), "operationId: ")
			block.WriteString(line)
			block.WriteString("\n")
		}
	}
	flush()
	return blocks
}

func isOpenAPIMethodLine(line string) bool {
	switch line {
	case "    get:", "    post:", "    put:", "    patch:", "    delete:":
		return true
	default:
		return false
	}
}

func readOpenAPIContract(t *testing.T) []byte {
	t.Helper()
	path := filepath.Join("..", "..", "..", "openapi", "zenart.v1.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read OpenAPI contract: %v", err)
	}
	return data
}

func openAPIRouteKeys(contract string) map[string]bool {
	keys := make(map[string]bool)
	var currentPath string
	for _, line := range strings.Split(contract, "\n") {
		if match := regexp.MustCompile(`^  (/[^:]+):$`).FindStringSubmatch(line); match != nil {
			currentPath = normalizeOpenAPIPath(match[1])
			continue
		}
		if currentPath == "" {
			continue
		}
		if match := regexp.MustCompile(`^    (get|post|put|patch|delete):$`).FindStringSubmatch(line); match != nil {
			keys[strings.ToUpper(match[1])+" "+currentPath] = true
		}
	}
	return keys
}

func serverRouteKeys(source string) map[string]string {
	keys := make(map[string]string)
	routePattern := regexp.MustCompile(`s\.mux\.Handle(?:Func)?\("(?P<method>GET|POST|PUT|PATCH|DELETE) (?P<path>/api/(?:admin/)?v1/[^"]+)"`)
	for _, match := range routePattern.FindAllStringSubmatch(source, -1) {
		method := match[1]
		path := match[2]
		key := method + " " + normalizeServerAPIPath(path)
		keys[key] = path
	}
	return keys
}

func normalizeServerAPIPath(path string) string {
	path = strings.TrimPrefix(path, "/api/admin/v1")
	path = strings.TrimPrefix(path, "/api/v1")
	return normalizeOpenAPIPath(path)
}

func normalizeOpenAPIPath(path string) string {
	return regexp.MustCompile(`\{[^}]+\}`).ReplaceAllString(path, "{}")
}
