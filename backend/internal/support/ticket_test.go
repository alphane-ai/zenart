package support

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

func completeEvidence() TicketEvidence {
	return TicketEvidence{
		ProjectID:          " project_1 ",
		TaskID:             " task_1 ",
		BatchID:            " batch_1 ",
		TraceID:            " trace_1 ",
		AssetID:            " asset_1 ",
		LinkedExportID:     " export_1 ",
		QuotaBucketID:      " quota_1 ",
		BillingReferenceID: " billing:stripe:in_123 ",
	}
}

func TestNormalizeAndRedactRequiresStage1EvidenceLinks(t *testing.T) {
	_, err := NormalizeAndRedact("export_failure", "failed", TicketEvidence{
		ProjectID:      "project_1",
		TaskID:         "task_1",
		TraceID:        "trace_1",
		AssetID:        "asset_1",
		LinkedExportID: "export_1",
		QuotaBucketID:  "quota_1",
	}, nil)
	if !errors.Is(err, ErrMissingEvidence) {
		t.Fatalf("NormalizeAndRedact() error = %v, want ErrMissingEvidence", err)
	}
}

func TestNormalizeAndRedactCoversProjectTaskBatchAssetExportBillingAndSecrets(t *testing.T) {
	input, err := NormalizeAndRedact(
		" export_failure ",
		"provider failed with Bearer abcdefghijklmnop",
		completeEvidence(),
		map[string]any{
			"api_key": "secret",
			"url":     "https://storage.local/export.zip?X-Amz-Signature=abcdef",
		},
	)
	if err != nil {
		t.Fatalf("NormalizeAndRedact() error = %v", err)
	}
	if input.Category != "export_failure" || input.Evidence.ProjectID != "project_1" || input.Evidence.BatchID != "batch_1" {
		t.Fatalf("normalized input = %#v", input)
	}
	body, err := json.Marshal(input)
	if err != nil {
		t.Fatalf("marshal input: %v", err)
	}
	for _, leaked := range []string{"abcdefghijklmnop", "secret", "abcdef"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted input leaked %q: %s", leaked, string(body))
		}
	}
	if !strings.Contains(string(body), security.Redacted) {
		t.Fatalf("redacted input = %s, want redaction marker", string(body))
	}
}

func TestTicketEvidenceAnalyticsPropertiesAreSafeAndComplete(t *testing.T) {
	props := completeEvidence().AnalyticsProperties(map[string]any{"token": "secret"})
	for _, key := range []string{"project_id", "task_id", "batch_id", "trace_id", "asset_id", "linked_export_id", "quota_bucket_id", "billing_reference_id", "metadata"} {
		if _, ok := props[key]; !ok {
			t.Fatalf("analytics properties missing %s: %#v", key, props)
		}
	}
	body, err := json.Marshal(props)
	if err != nil {
		t.Fatalf("marshal properties: %v", err)
	}
	if strings.Contains(string(body), "secret") {
		t.Fatalf("analytics properties leaked metadata secret: %s", string(body))
	}
}
