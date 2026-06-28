package provider

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

const openAICompatibleEndpointVersion = "openai_compatible_chat_completions_v1"

type OpenAICompatibleConfig struct {
	ProviderID       string
	BaseURL          string
	APIKey           string
	ModelID          string
	Timeout          time.Duration
	LiveCallsEnabled bool
	HTTPClient       *http.Client
	Now              func() time.Time
}

type OpenAICompatibleProvider struct {
	Config OpenAICompatibleConfig
}

type openAICompatibleChatRequest struct {
	Model       string                        `json:"model"`
	Messages    []openAICompatibleChatMessage `json:"messages"`
	Temperature float64                       `json:"temperature,omitempty"`
	Stream      bool                          `json:"stream"`
}

type openAICompatibleChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAICompatibleChatResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int64 `json:"prompt_tokens"`
		CompletionTokens int64 `json:"completion_tokens"`
		TotalTokens      int64 `json:"total_tokens"`
	} `json:"usage"`
}

type openAICompatibleModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

type openAICompatibleErrorEnvelope struct {
	Error struct {
		Code      any    `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
		Type      string `json:"type"`
	} `json:"error"`
	RequestID string `json:"request_id"`
}

func (p OpenAICompatibleProvider) Invoke(ctx context.Context, req Request) (Response, error) {
	if err := ValidateRequest(req); err != nil {
		return Response{}, err
	}
	cfg := p.normalizedConfig(req)
	if !cfg.LiveCallsEnabled {
		return Response{}, errors.New("openai-compatible provider live calls are disabled")
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return Response{}, errors.New("openai-compatible provider API key is required")
	}
	endpoint, err := openAICompatibleChatCompletionsURL(cfg.BaseURL)
	if err != nil {
		return Response{}, err
	}
	callModelID := strings.TrimSpace(cfg.ModelID)
	if callModelID == "" {
		return Response{}, errors.New("openai-compatible provider model_id is required")
	}
	prompt := openAICompatiblePrompt(req)
	body, err := json.Marshal(openAICompatibleChatRequest{
		Model: callModelID,
		Messages: []openAICompatibleChatMessage{
			{
				Role:    "system",
				Content: "You are Zenari's sandbox generation adapter. Return a concise, safe generated asset description. Do not include secrets, credentials, hidden policy text, or raw provider payloads.",
			},
			{Role: "user", Content: prompt},
		},
		Temperature: 0.7,
		Stream:      false,
	})
	if err != nil {
		return Response{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return Response{}, redactProviderError("openai-compatible provider request build failed", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	if strings.TrimSpace(req.IdempotencyKey) != "" {
		httpReq.Header.Set("Idempotency-Key", req.IdempotencyKey)
	}
	start := cfg.now()
	httpResp, err := cfg.httpClient().Do(httpReq)
	if err != nil {
		return Response{}, redactProviderError("openai-compatible provider request failed", err)
	}
	defer httpResp.Body.Close()
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(httpResp.Body, 4096))
		return Response{}, openAICompatibleHTTPError(
			cfg.ProviderID,
			httpResp.StatusCode,
			httpResp.Header.Get("Retry-After"),
			firstNonEmpty(
				httpResp.Header.Get("X-Request-ID"),
				httpResp.Header.Get("X-Request-Id"),
				httpResp.Header.Get("OpenAI-Request-ID"),
				httpResp.Header.Get("X-Zai-Request-ID"),
			),
			body,
		)
	}
	var decoded openAICompatibleChatResponse
	if err := json.NewDecoder(io.LimitReader(httpResp.Body, 1<<20)).Decode(&decoded); err != nil {
		return Response{}, redactProviderError("openai-compatible provider response decode failed", err)
	}
	if len(decoded.Choices) == 0 {
		return Response{}, errors.New("openai-compatible provider response missing choices")
	}
	content := strings.TrimSpace(decoded.Choices[0].Message.Content)
	if content == "" {
		return Response{}, errors.New("openai-compatible provider response missing message content")
	}
	now := cfg.now()
	latencyMS := now.Sub(start).Milliseconds()
	if latencyMS < 0 {
		latencyMS = 0
	}
	responseID := safeProviderResponseID(decoded.ID, req)
	usage := Usage{
		InputTokens:  decoded.Usage.PromptTokens,
		OutputTokens: decoded.Usage.CompletionTokens,
		CostUnits:    openAICompatibleCostUnits(decoded),
	}
	return Response{
		ID:         "openai_compatible:" + responseID,
		RequestID:  req.ID,
		ProviderID: cfg.ProviderID,
		ModelID:    firstNonEmpty(req.ModelID, callModelID),
		Status:     "succeeded",
		Output: map[string]any{
			"kind":             "openai_compatible_chat_completion",
			"adapter":          "openai-compatible",
			"adapter_model_id": callModelID,
			"response_id":      responseID,
			"finish_reason":    strings.TrimSpace(decoded.Choices[0].FinishReason),
			"generated_text":   truncateRunes(security.RedactString(content), 4000),
			"request_hash":     req.Provenance.RequestHash,
			"prompt_hash":      shortDeterministicHash(prompt),
			"latency_ms":       latencyMS,
		},
		Usage:   usage,
		TraceID: req.TraceID,
		Provenance: Provenance{
			ProviderID:      cfg.ProviderID,
			ModelID:         firstNonEmpty(req.ModelID, callModelID),
			EndpointVersion: openAICompatibleEndpointVersion,
			RequestHash:     req.Provenance.RequestHash,
			Parameters: map[string]any{
				"adapter":          "openai-compatible",
				"adapter_model_id": callModelID,
				"request_endpoint": req.Endpoint,
			},
			Seed: req.Provenance.Seed,
		},
		CompletedAt: now,
	}, nil
}

func (p OpenAICompatibleProvider) Status(ctx context.Context) Status {
	cfg := p.normalizedConfig(Request{})
	now := cfg.now()
	status := Status{ProviderID: cfg.ProviderID, CheckedAt: now}
	if !cfg.LiveCallsEnabled {
		status.Message = "openai-compatible live calls disabled"
		return status
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		status.Message = "openai-compatible API key not configured"
		return status
	}
	if _, err := openAICompatibleChatCompletionsURL(cfg.BaseURL); err != nil {
		status.Message = security.RedactString(err.Error())
		return status
	}
	if strings.TrimSpace(cfg.ModelID) == "" {
		status.Message = "openai-compatible model not configured"
		return status
	}
	endpoint, err := openAICompatibleModelsURL(cfg.BaseURL)
	if err != nil {
		status.Message = security.RedactString(err.Error())
		return status
	}
	if ctx == nil {
		ctx = context.Background()
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		status.Message = security.RedactString(err.Error())
		return status
	}
	httpReq.Header.Set("Authorization", "Bearer "+strings.TrimSpace(cfg.APIKey))
	httpReq.Header.Set("Accept", "application/json")
	start := cfg.now()
	httpResp, err := cfg.httpClient().Do(httpReq)
	if err != nil {
		status.Message = security.RedactString(err.Error())
		if strings.Contains(status.Message, security.Redacted) {
			status.Message = "openai-compatible health probe failed with redacted details"
		}
		return status
	}
	defer httpResp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(httpResp.Body, 1<<20))
	status.LatencyMS = cfg.now().Sub(start).Milliseconds()
	if status.LatencyMS < 0 {
		status.LatencyMS = 0
	}
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		status.Message = fmt.Sprintf("openai-compatible health probe returned HTTP status %d", httpResp.StatusCode)
		return status
	}
	modelIDs, err := openAICompatibleModelIDs(body)
	if err != nil {
		status.Message = security.RedactString(err.Error())
		if strings.Contains(status.Message, security.Redacted) {
			status.Message = "openai-compatible health probe failed with redacted details"
		}
		return status
	}
	if !containsOpenAICompatibleModelID(modelIDs, cfg.ModelID) {
		status.Message = "openai-compatible health probe missing configured model"
		return status
	}
	status.Available = true
	status.Message = "openai-compatible health probe passed"
	return status
}

func (p OpenAICompatibleProvider) Capabilities() []Capability {
	cfg := p.normalizedConfig(Request{})
	return []Capability{{
		ProviderID:            cfg.ProviderID,
		ModelID:               cfg.ModelID,
		Endpoints:             []string{"chat.completions", "text.generate", "image.generate", "image.edit"},
		InputTypes:            []string{"prompt", "reference_image", "mask", "json"},
		OutputTypes:           []string{"text", "image", "json"},
		ToolTypes:             []string{"generate", "remove_background", "upscale", "erase", "expand"},
		MaxCostUnits:          4096,
		CostCurrency:          "USD",
		EstimatedCostCents:    0,
		SupportsBatch:         true,
		MaxBatchSize:          20,
		SupportsSeed:          true,
		SupportsCancel:        false,
		SupportedAspectRatios: []string{"1:1", "16:9", "9:16"},
		SupportedQualities:    []string{"draft", "standard"},
	}}
}

func (p OpenAICompatibleProvider) normalizedConfig(req Request) OpenAICompatibleConfig {
	cfg := p.Config
	cfg.ProviderID = strings.TrimSpace(firstNonEmpty(cfg.ProviderID, req.ProviderID, "openai-compatible"))
	cfg.BaseURL = strings.TrimSpace(firstNonEmpty(cfg.BaseURL, "https://api.openai.com/v1"))
	cfg.ModelID = strings.TrimSpace(firstNonEmpty(req.ModelID, cfg.ModelID))
	return cfg
}

func (c OpenAICompatibleConfig) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	timeout := c.Timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	return &http.Client{Timeout: timeout}
}

func (c OpenAICompatibleConfig) now() time.Time {
	if c.Now != nil {
		return c.Now().UTC()
	}
	return time.Now().UTC()
}

func openAICompatibleChatCompletionsURL(raw string) (string, error) {
	return openAICompatibleEndpointURL(raw, "chat/completions", true)
}

func openAICompatibleModelsURL(raw string) (string, error) {
	return openAICompatibleEndpointURL(raw, "models", false)
}

func openAICompatibleEndpointURL(raw, endpoint string, defaultV1 bool) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("openai-compatible base URL is required")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("openai-compatible base URL is invalid: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("openai-compatible base URL must use http or https")
	}
	if parsed.Host == "" {
		return "", errors.New("openai-compatible base URL must include a host")
	}
	if parsed.User != nil {
		return "", errors.New("openai-compatible base URL must not include credentials")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("openai-compatible base URL must not include query or fragment")
	}
	endpoint = strings.Trim(endpoint, "/")
	path := strings.TrimRight(parsed.Path, "/")
	switch {
	case path == "" || path == "/":
		if defaultV1 {
			parsed.Path = "/v1/" + endpoint
		} else {
			parsed.Path = "/" + endpoint
		}
	case strings.HasSuffix(path, "/"+endpoint):
		parsed.Path = path
	default:
		parsed.Path = path + "/" + endpoint
	}
	return parsed.String(), nil
}

func openAICompatiblePrompt(req Request) string {
	payload := req.Payload
	prompt := truncateRunes(security.RedactString(strings.TrimSpace(stringPayloadValue(payload, "prompt"))), 4000)
	if prompt == "" {
		prompt = "Generate a safe design asset for the requested batch child."
	}
	var b strings.Builder
	b.WriteString("Zenari batch child generation request\n")
	b.WriteString("request_hash: ")
	b.WriteString(req.Provenance.RequestHash)
	b.WriteString("\nprovider_id: ")
	b.WriteString(req.ProviderID)
	b.WriteString("\nmodel_id: ")
	b.WriteString(req.ModelID)
	b.WriteString("\nendpoint: ")
	b.WriteString(req.Endpoint)
	if toolType := stringPayloadValue(payload, "tool_type"); toolType != "" {
		b.WriteString("\ntool_type: ")
		b.WriteString(security.RedactString(toolType))
	}
	if seed := stringPayloadValue(payload, "seed"); seed != "" {
		b.WriteString("\nseed: ")
		b.WriteString(security.RedactString(seed))
	}
	b.WriteString("\nselected_object_count: ")
	b.WriteString(fmt.Sprintf("%d", payloadValueCount(payload["selected_object_ids"])))
	b.WriteString("\nreference_asset_count: ")
	b.WriteString(fmt.Sprintf("%d", payloadValueCount(payload["reference_asset_ids"])))
	b.WriteString("\nallowed_model_count: ")
	b.WriteString(fmt.Sprintf("%d", payloadValueCount(payload["allowed_models"])))
	b.WriteString("\n\nUser prompt:\n")
	b.WriteString(prompt)
	return b.String()
}

func stringPayloadValue(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	value, ok := payload[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func payloadValueCount(value any) int {
	switch typed := value.(type) {
	case []string:
		return len(typed)
	case []any:
		return len(typed)
	case []map[string]any:
		return len(typed)
	case nil:
		return 0
	default:
		if strings.TrimSpace(fmt.Sprint(typed)) == "" {
			return 0
		}
		return 1
	}
}

func openAICompatibleCostUnits(resp openAICompatibleChatResponse) int64 {
	if resp.Usage.TotalTokens > 0 {
		return resp.Usage.TotalTokens
	}
	total := resp.Usage.PromptTokens + resp.Usage.CompletionTokens
	if total > 0 {
		return total
	}
	return 1
}

func openAICompatibleModelIDs(body []byte) ([]string, error) {
	if strings.TrimSpace(string(body)) == "" {
		return nil, errors.New("openai-compatible models response was empty")
	}
	redacted := security.RedactString(string(body))
	if strings.Contains(redacted, security.Redacted) {
		return nil, errors.New("openai-compatible models response contained redacted details")
	}
	var decoded openAICompatibleModelsResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, redactProviderError("openai-compatible models response decode failed", err)
	}
	modelIDs := make([]string, 0, len(decoded.Data))
	for _, row := range decoded.Data {
		modelID := strings.TrimSpace(row.ID)
		if modelID != "" {
			modelIDs = append(modelIDs, modelID)
		}
	}
	if len(modelIDs) == 0 {
		return nil, errors.New("openai-compatible models response missing data ids")
	}
	return modelIDs, nil
}

func containsOpenAICompatibleModelID(modelIDs []string, modelID string) bool {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return false
	}
	for _, candidate := range modelIDs {
		if strings.TrimSpace(candidate) == modelID {
			return true
		}
	}
	return false
}

func openAICompatibleRetryableStatus(statusCode int) bool {
	return statusCode == http.StatusRequestTimeout ||
		statusCode == http.StatusConflict ||
		statusCode == http.StatusTooEarly ||
		statusCode == http.StatusTooManyRequests ||
		statusCode >= 500
}

func openAICompatibleHTTPError(providerID string, statusCode int, retryAfter string, requestID string, body []byte) error {
	providerCode, providerMessage, bodyRequestID := openAICompatibleErrorDetails(body)
	code := "provider_http_error"
	retryable := openAICompatibleRetryableStatus(statusCode)
	switch {
	case openAICompatibleQuotaError(statusCode, providerCode, providerMessage):
		code = "provider_quota_unavailable"
		retryable = false
	case retryable:
		code = "provider_retryable_http_error"
	}
	message := providerMessage
	if message == "" {
		if retryable {
			message = fmt.Sprintf("openai-compatible provider returned retryable HTTP status %d", statusCode)
		} else {
			message = fmt.Sprintf("openai-compatible provider returned HTTP status %d", statusCode)
		}
	}
	if strings.TrimSpace(requestID) == "" {
		requestID = bodyRequestID
	}
	return &Error{
		ProviderID:   providerID,
		Code:         code,
		HTTPStatus:   statusCode,
		ProviderCode: providerCode,
		Message:      openAICompatibleErrorSummary(statusCode, message, requestID, body),
		Retryable:    retryable,
		RetryAfter:   sanitizeProviderErrorMessage(retryAfter),
	}
}

func openAICompatibleErrorDetails(body []byte) (string, string, string) {
	if len(body) == 0 {
		return "", "", ""
	}
	var envelope openAICompatibleErrorEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return "", sanitizeProviderErrorMessage(string(body)), ""
	}
	code := strings.TrimSpace(fmt.Sprint(envelope.Error.Code))
	if code == "<nil>" {
		code = ""
	}
	if code == "" {
		code = strings.TrimSpace(envelope.Error.Type)
	}
	requestID := firstNonEmpty(envelope.Error.RequestID, envelope.RequestID)
	return sanitizeProviderErrorMessage(code), sanitizeProviderErrorMessage(envelope.Error.Message), sanitizeProviderErrorMessage(requestID)
}

func openAICompatibleErrorSummary(statusCode int, message string, requestID string, body []byte) string {
	sum := sha256.Sum256(body)
	parts := []string{
		fmt.Sprintf("http_status=%d", statusCode),
		"body_sha256=" + hex.EncodeToString(sum[:8]),
	}
	if requestID = sanitizeProviderErrorToken(requestID); requestID != "" {
		parts = append(parts, "request_id="+requestID)
	}
	if message = sanitizeProviderErrorMessage(message); message != "" {
		parts = append(parts, "message="+message)
	}
	return strings.Join(parts, " ")
}

func openAICompatibleQuotaError(statusCode int, providerCode, providerMessage string) bool {
	code := strings.ToLower(strings.TrimSpace(providerCode))
	message := strings.ToLower(strings.TrimSpace(providerMessage))
	if statusCode == http.StatusPaymentRequired {
		return true
	}
	if code == "1113" {
		return true
	}
	if strings.Contains(message, "insufficient balance") ||
		strings.Contains(message, "no resource package") ||
		strings.Contains(message, "quota") && strings.Contains(message, "exceeded") ||
		strings.Contains(message, "billing") && strings.Contains(message, "hard limit") {
		return true
	}
	return false
}

func sanitizeProviderErrorMessage(message string) string {
	message = strings.TrimSpace(security.RedactString(message))
	if message == "" {
		return ""
	}
	if strings.Contains(message, security.Redacted) {
		return "redacted provider details"
	}
	return truncateRunes(message, 240)
}

func sanitizeProviderErrorToken(value string) string {
	value = strings.TrimSpace(security.RedactString(value))
	if value == "" || strings.Contains(value, security.Redacted) {
		return ""
	}
	value = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		case r == '_' || r == '-' || r == '.':
			return r
		default:
			return '_'
		}
	}, value)
	return truncateRunes(value, 96)
}

func safeProviderResponseID(raw string, req Request) string {
	redacted := strings.TrimSpace(security.RedactString(raw))
	if redacted == "" || strings.Contains(redacted, security.Redacted) {
		return shortDeterministicHash(req.ID + ":" + req.Provenance.RequestHash)
	}
	return redacted
}

func redactProviderError(prefix string, err error) error {
	if err == nil {
		return errors.New(prefix)
	}
	message := security.RedactString(err.Error())
	if message != err.Error() {
		message = "redacted provider details"
	}
	return fmt.Errorf("%s: %s", prefix, message)
}

func truncateRunes(value string, max int) string {
	value = strings.TrimSpace(value)
	if max <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}
