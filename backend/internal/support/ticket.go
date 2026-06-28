package support

import (
	"errors"
	"strings"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

var ErrMissingEvidence = errors.New("support ticket evidence links are required")

type TicketEvidence struct {
	ProjectID          string
	TaskID             string
	BatchID            string
	TraceID            string
	AssetID            string
	LinkedExportID     string
	QuotaBucketID      string
	BillingReferenceID string
}

type RedactedTicketInput struct {
	Evidence TicketEvidence
	Category string
	Body     string
	Metadata map[string]any
}

func NormalizeAndRedact(category, body string, evidence TicketEvidence, metadata map[string]any) (RedactedTicketInput, error) {
	normalized := RedactedTicketInput{
		Evidence: TicketEvidence{
			ProjectID:          strings.TrimSpace(evidence.ProjectID),
			TaskID:             strings.TrimSpace(evidence.TaskID),
			BatchID:            strings.TrimSpace(evidence.BatchID),
			TraceID:            strings.TrimSpace(evidence.TraceID),
			AssetID:            strings.TrimSpace(evidence.AssetID),
			LinkedExportID:     strings.TrimSpace(evidence.LinkedExportID),
			QuotaBucketID:      strings.TrimSpace(evidence.QuotaBucketID),
			BillingReferenceID: strings.TrimSpace(evidence.BillingReferenceID),
		},
		Category: strings.TrimSpace(category),
		Body:     security.RedactString(strings.TrimSpace(body)),
		Metadata: security.RedactMap(metadata),
	}
	if normalized.Metadata == nil {
		normalized.Metadata = map[string]any{}
	}
	if !normalized.Evidence.Complete() {
		return RedactedTicketInput{}, ErrMissingEvidence
	}
	return normalized, nil
}

func (e TicketEvidence) Complete() bool {
	return strings.TrimSpace(e.ProjectID) != "" &&
		strings.TrimSpace(e.TaskID) != "" &&
		strings.TrimSpace(e.BatchID) != "" &&
		strings.TrimSpace(e.TraceID) != "" &&
		strings.TrimSpace(e.AssetID) != "" &&
		strings.TrimSpace(e.LinkedExportID) != "" &&
		strings.TrimSpace(e.QuotaBucketID) != "" &&
		strings.TrimSpace(e.BillingReferenceID) != ""
}

func (e TicketEvidence) AnalyticsProperties(redactedMetadata map[string]any) map[string]any {
	return map[string]any{
		"project_id":           strings.TrimSpace(e.ProjectID),
		"task_id":              strings.TrimSpace(e.TaskID),
		"batch_id":             strings.TrimSpace(e.BatchID),
		"trace_id":             strings.TrimSpace(e.TraceID),
		"asset_id":             strings.TrimSpace(e.AssetID),
		"linked_export_id":     strings.TrimSpace(e.LinkedExportID),
		"quota_bucket_id":      strings.TrimSpace(e.QuotaBucketID),
		"billing_reference_id": strings.TrimSpace(e.BillingReferenceID),
		"metadata":             security.RedactMap(redactedMetadata),
	}
}
