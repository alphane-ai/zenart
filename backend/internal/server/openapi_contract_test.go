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
		"SupportTicketPage:",
		"AbuseEventPage:",
		"ProviderStatusPage:",
		"ProviderUsagePage:",
		"ExportPage:",
		"SafetyDecision:",
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

func readOpenAPIContract(t *testing.T) []byte {
	t.Helper()
	path := filepath.Join("..", "..", "..", "openapi", "zenart.v1.yaml")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read OpenAPI contract: %v", err)
	}
	return data
}
