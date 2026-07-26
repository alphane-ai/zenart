package provider

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

type Request struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id"`
	TaskID         string         `json:"task_id"`
	ProviderID     string         `json:"provider_id"`
	ModelID        string         `json:"model_id"`
	Endpoint       string         `json:"endpoint"`
	SchemaVersion  int            `json:"schema_version"`
	IdempotencyKey string         `json:"idempotency_key"`
	Payload        map[string]any `json:"payload"`
	TraceID        string         `json:"trace_id"`
	Provenance     Provenance     `json:"provenance"`
}

type Response struct {
	ID          string         `json:"id"`
	RequestID   string         `json:"request_id"`
	ProviderID  string         `json:"provider_id"`
	ModelID     string         `json:"model_id"`
	Status      string         `json:"status"`
	Output      map[string]any `json:"output"`
	Usage       Usage          `json:"usage"`
	TraceID     string         `json:"trace_id"`
	Provenance  Provenance     `json:"provenance"`
	CompletedAt time.Time      `json:"completed_at"`
}

type Usage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
	CostUnits    int64 `json:"cost_units"`
}

type Provenance struct {
	ProviderID      string         `json:"provider_id"`
	ModelID         string         `json:"model_id"`
	EndpointVersion string         `json:"endpoint_version"`
	RequestHash     string         `json:"request_hash"`
	Parameters      map[string]any `json:"parameters,omitempty"`
	Seed            string         `json:"seed,omitempty"`
}

type Capability struct {
	ProviderID            string   `json:"provider_id"`
	ModelID               string   `json:"model_id"`
	Endpoints             []string `json:"endpoints"`
	InputTypes            []string `json:"input_types"`
	OutputTypes           []string `json:"output_types"`
	ToolTypes             []string `json:"tool_types,omitempty"`
	MaxCostUnits          int64    `json:"max_cost_units"`
	CostCurrency          string   `json:"cost_currency,omitempty"`
	EstimatedCostCents    int64    `json:"estimated_cost_cents,omitempty"`
	SupportsBatch         bool     `json:"supports_batch"`
	MaxBatchSize          int      `json:"max_batch_size,omitempty"`
	SupportsSeed          bool     `json:"supports_seed,omitempty"`
	SupportsCancel        bool     `json:"supports_cancel,omitempty"`
	SupportedAspectRatios []string `json:"supported_aspect_ratios,omitempty"`
	SupportedQualities    []string `json:"supported_qualities,omitempty"`
}

type Status struct {
	ProviderID string    `json:"provider_id"`
	Available  bool      `json:"available"`
	LatencyMS  int64     `json:"latency_ms"`
	CheckedAt  time.Time `json:"checked_at"`
	Message    string    `json:"message,omitempty"`
}

type Client interface {
	Invoke(ctx context.Context, req Request) (Response, error)
	Status(ctx context.Context) Status
	Capabilities() []Capability
}

type Error struct {
	ProviderID   string
	Code         string
	HTTPStatus   int
	ProviderCode string
	Message      string
	Retryable    bool
	RetryAfter   string
}

func (e *Error) Error() string {
	if e == nil {
		return "provider error"
	}
	code := strings.TrimSpace(e.Code)
	if code == "" {
		code = "provider_error"
	}
	parts := []string{fmt.Sprintf("provider_error=%s", code)}
	if e.HTTPStatus > 0 {
		parts = append(parts, fmt.Sprintf("http_status=%d", e.HTTPStatus))
	}
	if providerCode := strings.TrimSpace(e.ProviderCode); providerCode != "" {
		parts = append(parts, "provider_code="+providerCode)
	}
	if retryAfter := strings.TrimSpace(e.RetryAfter); retryAfter != "" {
		parts = append(parts, "retry_after="+retryAfter)
	}
	parts = append(parts, fmt.Sprintf("retryable=%t", e.Retryable))
	if message := strings.TrimSpace(e.Message); message != "" {
		parts = append(parts, "message="+message)
	}
	return strings.Join(parts, " ")
}

func ErrorDetails(err error) (*Error, bool) {
	var providerErr *Error
	if errors.As(err, &providerErr) && providerErr != nil {
		return providerErr, true
	}
	return nil, false
}

type ClientResolver interface {
	ResolveProviderClient(providerID string) (Client, bool)
}

type ClientMap map[string]Client

func (m ClientMap) ResolveProviderClient(providerID string) (Client, bool) {
	client, ok := m[providerID]
	return client, ok
}

type clientResolverKey struct{}

func ContextWithClientResolver(ctx context.Context, resolver ClientResolver) context.Context {
	return context.WithValue(ctx, clientResolverKey{}, resolver)
}

func ClientResolverFromContext(ctx context.Context) (ClientResolver, bool) {
	resolver, ok := ctx.Value(clientResolverKey{}).(ClientResolver)
	return resolver, ok
}

type SafetyHooks struct {
	EnforceProviderRequest  func(ctx context.Context, tenantID, taskID string) error
	EnforceProviderResponse func(ctx context.Context, tenantID, taskID string) error
}

type SafetyClient struct {
	Inner Client
	Hooks SafetyHooks
}

func (c SafetyClient) Invoke(ctx context.Context, req Request) (Response, error) {
	if c.Inner == nil {
		return Response{}, errors.New("inner provider client is required")
	}
	if c.Hooks.EnforceProviderRequest != nil {
		if err := c.Hooks.EnforceProviderRequest(ctx, req.TenantID, req.TaskID); err != nil {
			return Response{}, err
		}
	}
	resp, err := c.Inner.Invoke(ctx, req)
	if err != nil {
		return Response{}, err
	}
	if c.Hooks.EnforceProviderResponse != nil {
		if err := c.Hooks.EnforceProviderResponse(ctx, req.TenantID, req.TaskID); err != nil {
			return Response{}, err
		}
	}
	return resp, nil
}

func (c SafetyClient) Status(ctx context.Context) Status {
	if c.Inner == nil {
		return Status{ProviderID: "unconfigured", Available: false, CheckedAt: time.Now().UTC(), Message: "inner provider client is required"}
	}
	return c.Inner.Status(ctx)
}

func (c SafetyClient) Capabilities() []Capability {
	if c.Inner == nil {
		return nil
	}
	return c.Inner.Capabilities()
}

type DevProvider struct {
	Now func() time.Time
}

func (p DevProvider) Invoke(_ context.Context, req Request) (Response, error) {
	if err := ValidateRequest(req); err != nil {
		return Response{}, err
	}
	now := time.Now().UTC()
	if p.Now != nil {
		now = p.Now().UTC()
	}
	provenance := req.Provenance
	provenance.ProviderID = req.ProviderID
	provenance.ModelID = req.ModelID
	if strings.TrimSpace(provenance.EndpointVersion) == "" {
		provenance.EndpointVersion = "dev_echo_v1"
	}
	return Response{
		ID:         "dev_response:" + req.ID,
		RequestID:  req.ID,
		ProviderID: req.ProviderID,
		ModelID:    req.ModelID,
		Status:     "succeeded",
		Output: map[string]any{
			"echo": req.Payload,
		},
		Usage:       Usage{CostUnits: 1},
		TraceID:     req.TraceID,
		Provenance:  provenance,
		CompletedAt: now,
	}, nil
}

func (p DevProvider) Status(context.Context) Status {
	now := time.Now().UTC()
	if p.Now != nil {
		now = p.Now().UTC()
	}
	return Status{ProviderID: "dev", Available: true, CheckedAt: now}
}

func (DevProvider) Capabilities() []Capability {
	return []Capability{{
		ProviderID:    "dev",
		ModelID:       "dev-echo-v1",
		Endpoints:     []string{"text", "image", "layout"},
		InputTypes:    []string{"json"},
		OutputTypes:   []string{"json"},
		MaxCostUnits:  0,
		SupportsBatch: false,
	}}
}

func ValidateRequest(req Request) error {
	if req.ID == "" || req.TenantID == "" || req.TaskID == "" || req.ProviderID == "" || req.ModelID == "" || req.TraceID == "" {
		return errors.New("request id, tenant_id, task_id, provider_id, model_id, and trace_id are required")
	}
	if req.SchemaVersion < 1 {
		return errors.New("schema_version must be >= 1")
	}
	if req.IdempotencyKey == "" {
		return errors.New("idempotency_key is required")
	}
	return nil
}

func SelectFallback(statuses []Status, capabilities []Capability, endpoint string) (Capability, bool) {
	available := map[string]bool{}
	for _, status := range statuses {
		available[status.ProviderID] = status.Available
	}
	for _, capability := range capabilities {
		if !available[capability.ProviderID] {
			continue
		}
		for _, supportedEndpoint := range capability.Endpoints {
			if supportedEndpoint == endpoint {
				return capability, true
			}
		}
	}
	return Capability{}, false
}
