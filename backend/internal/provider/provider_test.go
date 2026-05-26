package provider

import (
	"context"
	"testing"
	"time"
)

func TestDevProviderInvoke(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	resp, err := (DevProvider{Now: func() time.Time { return now }}).Invoke(context.Background(), Request{
		ID:             "req_1",
		TenantID:       "tenant_1",
		TaskID:         "task_1",
		ProviderID:     "dev",
		ModelID:        "dev-echo-v1",
		Endpoint:       "text",
		SchemaVersion:  1,
		IdempotencyKey: "idem_1",
		Payload:        map[string]any{"prompt": "test"},
		TraceID:        "trace_1",
		Provenance:     Provenance{ProviderID: "dev", ModelID: "dev-echo-v1", EndpointVersion: "v1", RequestHash: "hash"},
	})
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if resp.Status != "succeeded" {
		t.Fatalf("Status = %q, want succeeded", resp.Status)
	}
	if !resp.CompletedAt.Equal(now) {
		t.Fatalf("CompletedAt = %v, want %v", resp.CompletedAt, now)
	}
}

func TestValidateRequestRequiresTraceAndIdempotency(t *testing.T) {
	err := ValidateRequest(Request{ID: "req_1", TenantID: "tenant_1", TaskID: "task_1", ProviderID: "dev", ModelID: "dev-echo-v1", SchemaVersion: 1})
	if err == nil {
		t.Fatal("ValidateRequest() error = nil, want missing trace/idempotency error")
	}
}

func TestSelectFallback(t *testing.T) {
	capability, ok := SelectFallback(
		[]Status{{ProviderID: "primary", Available: false}, {ProviderID: "dev", Available: true}},
		[]Capability{
			{ProviderID: "primary", ModelID: "primary-v1", Endpoints: []string{"text"}},
			{ProviderID: "dev", ModelID: "dev-echo-v1", Endpoints: []string{"text"}},
		},
		"text",
	)
	if !ok {
		t.Fatal("SelectFallback() did not find available provider")
	}
	if capability.ProviderID != "dev" {
		t.Fatalf("ProviderID = %q, want dev", capability.ProviderID)
	}
}
