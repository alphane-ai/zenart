package provider

import (
	"context"
	"errors"
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

func TestSafetyClientEnforcesProviderRequestAndResponse(t *testing.T) {
	enforcer := &fakeSafetyEnforcer{}
	client := SafetyClient{Inner: DevProvider{}, Hooks: enforcer.hooks()}

	_, err := client.Invoke(context.Background(), validRequest())
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if len(enforcer.calls) != 2 || enforcer.calls[0] != "provider_request:tenant_1:task_1" || enforcer.calls[1] != "provider_response:tenant_1:task_1" {
		t.Fatalf("safety calls = %#v, want request then response enforcement", enforcer.calls)
	}
}

func TestSafetyClientBlocksBeforeProviderInvoke(t *testing.T) {
	wantErr := errors.New("safety blocked")
	enforcer := &fakeSafetyEnforcer{requestErr: wantErr}
	inner := countingClient{response: Response{Status: "succeeded"}}
	client := SafetyClient{Inner: &inner, Hooks: enforcer.hooks()}

	_, err := client.Invoke(context.Background(), validRequest())
	if !errors.Is(err, wantErr) {
		t.Fatalf("Invoke() error = %v, want request safety error", err)
	}
	if inner.invokes != 0 {
		t.Fatalf("inner invokes = %d, want blocked before provider call", inner.invokes)
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

func validRequest() Request {
	return Request{
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
	}
}

type fakeSafetyEnforcer struct {
	calls       []string
	requestErr  error
	responseErr error
}

func (f *fakeSafetyEnforcer) hooks() SafetyHooks {
	return SafetyHooks{
		EnforceProviderRequest:  f.EnforceProviderRequestSafety,
		EnforceProviderResponse: f.EnforceProviderResponseSafety,
	}
}

func (f *fakeSafetyEnforcer) EnforceProviderRequestSafety(_ context.Context, tenantID, taskID string) error {
	f.calls = append(f.calls, "provider_request:"+tenantID+":"+taskID)
	return f.requestErr
}

func (f *fakeSafetyEnforcer) EnforceProviderResponseSafety(_ context.Context, tenantID, taskID string) error {
	f.calls = append(f.calls, "provider_response:"+tenantID+":"+taskID)
	return f.responseErr
}

type countingClient struct {
	invokes  int
	response Response
}

func (c *countingClient) Invoke(context.Context, Request) (Response, error) {
	c.invokes++
	return c.response, nil
}

func (c *countingClient) Status(context.Context) Status {
	return Status{ProviderID: "counting", Available: true}
}

func (c *countingClient) Capabilities() []Capability {
	return nil
}
