package server

import (
	"bytes"
	"os"
	"path/filepath"
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
		"operationId: regenerateExport",
		"operationId: createSafetyDecision",
		"operationId: listAnalyticsEvents",
		"operationId: listAnalyticsReports",
		"SupportTicketPage:",
		"AbuseEventPage:",
		"ProviderStatusPage:",
		"ProviderUsagePage:",
		"ExportPage:",
		"SafetyDecision:",
		"AnalyticsEventPage:",
		"AnalyticsReportPage:",
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
