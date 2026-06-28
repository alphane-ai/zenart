package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenAICompatibleProviderLiveDisabledRejectsWithoutHTTPCall(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	defer server.Close()

	_, err := (OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL,
		APIKey:           fakeZAIKey(),
		ModelID:          "glm-5.2",
		LiveCallsEnabled: false,
	}}).Invoke(context.Background(), validOpenAICompatibleRequest())
	if err == nil || !strings.Contains(err.Error(), "live calls are disabled") {
		t.Fatalf("Invoke() error = %v, want live disabled", err)
	}
	if called {
		t.Fatal("disabled live calls should not make HTTP requests")
	}
	status := (OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL,
		APIKey:           fakeZAIKey(),
		ModelID:          "glm-5.2",
		LiveCallsEnabled: false,
	}}).Status(context.Background())
	if status.Available || status.Message != "openai-compatible live calls disabled" {
		t.Fatalf("Status() = %#v, want disabled status without HTTP probe", status)
	}
	if called {
		t.Fatal("disabled status should not make HTTP requests")
	}
}

func TestOpenAICompatibleProviderMissingKeyRejectsWithoutHTTPCall(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	defer server.Close()

	_, err := (OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL,
		ModelID:          "glm-5.2",
		LiveCallsEnabled: true,
	}}).Invoke(context.Background(), validOpenAICompatibleRequest())
	if err == nil || !strings.Contains(err.Error(), "API key is required") {
		t.Fatalf("Invoke() error = %v, want missing key", err)
	}
	if called {
		t.Fatal("missing key should not make HTTP requests")
	}
}

func TestOpenAICompatibleProviderInvokeMapsRequestResponseAndUsage(t *testing.T) {
	now := time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC)
	key := fakeZAIKey()
	var gotPath string
	var gotAuthorization string
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuthorization = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("request body decode failed: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"chatcmpl_test_1",
			"choices":[{"message":{"role":"assistant","content":"Generated poster concept with blue header and clean layout."},"finish_reason":"stop"}],
			"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}
		}`))
	}))
	defer server.Close()

	resp, err := (OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL + "/api/paas/v4",
		APIKey:           key,
		ModelID:          "glm-5.2",
		LiveCallsEnabled: true,
		Now:              func() time.Time { return now },
	}}).Invoke(context.Background(), validOpenAICompatibleRequest())
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if gotPath != "/api/paas/v4/chat/completions" {
		t.Fatalf("request path = %q, want z.ai-compatible chat completions path", gotPath)
	}
	if gotAuthorization != "Bearer "+key {
		t.Fatalf("Authorization header = %q, want bearer test key", gotAuthorization)
	}
	if gotBody["model"] != "image-fast-v1" {
		t.Fatalf("request model = %#v, want request model image-fast-v1", gotBody["model"])
	}
	messages, ok := gotBody["messages"].([]any)
	if !ok || len(messages) != 2 {
		t.Fatalf("request messages = %#v, want system and user messages", gotBody["messages"])
	}
	userMessage := messages[1].(map[string]any)
	userContent := userMessage["content"].(string)
	if !strings.Contains(userContent, "User prompt") || !strings.Contains(userContent, "launch poster") {
		t.Fatalf("user content = %q, want prompt projection", userContent)
	}
	if strings.Contains(userContent, key) {
		t.Fatalf("user content leaked provider key")
	}
	if resp.ProviderID != "zenari-image-sandbox" || resp.ModelID != "image-fast-v1" || resp.Status != "succeeded" {
		t.Fatalf("response = %#v", resp)
	}
	if resp.Usage.InputTokens != 11 || resp.Usage.OutputTokens != 7 || resp.Usage.CostUnits != 18 {
		t.Fatalf("usage = %#v, want token usage mapped to cost units", resp.Usage)
	}
	if resp.Provenance.EndpointVersion != openAICompatibleEndpointVersion {
		t.Fatalf("endpoint version = %q", resp.Provenance.EndpointVersion)
	}
	if resp.CompletedAt != now {
		t.Fatalf("CompletedAt = %s, want %s", resp.CompletedAt, now)
	}
	outputJSON, _ := json.Marshal(resp.Output)
	if strings.Contains(string(outputJSON), key) || strings.Contains(string(outputJSON), "reference_asset_ids") {
		t.Fatalf("provider output leaked key or raw provider payload: %s", string(outputJSON))
	}
	if !strings.Contains(string(outputJSON), "Generated poster concept") {
		t.Fatalf("output = %s, want generated text summary", string(outputJSON))
	}
}

func TestOpenAICompatibleProviderInvokePrefersRequestModelOverConfiguredDefault(t *testing.T) {
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Fatalf("request body decode failed: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"id":"chatcmpl_test_request_model",
			"choices":[{"message":{"role":"assistant","content":"Generated asset."},"finish_reason":"stop"}],
			"usage":{"total_tokens":1}
		}`))
	}))
	defer server.Close()

	req := validOpenAICompatibleRequest()
	req.ModelID = "glm-5.2"
	req.Provenance.ModelID = req.ModelID

	resp, err := (OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL,
		APIKey:           fakeZAIKey(),
		ModelID:          "glm-4.5",
		LiveCallsEnabled: true,
	}}).Invoke(context.Background(), req)
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if gotBody["model"] != "glm-5.2" {
		t.Fatalf("request model = %#v, want request model glm-5.2", gotBody["model"])
	}
	if resp.ModelID != "glm-5.2" || resp.Provenance.ModelID != "glm-5.2" {
		t.Fatalf("response model projection = %q provenance=%#v, want request model preserved", resp.ModelID, resp.Provenance)
	}
}

func TestOpenAICompatibleProviderHTTPErrorDoesNotLeakSecretOrBody(t *testing.T) {
	key := fakeZAIKey()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", "req_provider_429")
		w.Header().Set("Retry-After", "30")
		w.WriteHeader(http.StatusTooManyRequests)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"type":       "rate_limit_exceeded",
				"code":       "rate_limit_exceeded",
				"request_id": "req_body_should_not_win",
				"message":    "auth failed for Authorization: " + r.Header.Get("Authorization") + " with raw prompt User prompt launch poster",
			},
			"raw_provider_payload": "should never be projected",
		})
	}))
	defer server.Close()

	_, err := (OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL,
		APIKey:           key,
		ModelID:          "glm-5.2",
		LiveCallsEnabled: true,
	}}).Invoke(context.Background(), validOpenAICompatibleRequest())
	if err == nil {
		t.Fatal("Invoke() error = nil, want HTTP error")
	}
	providerErr, ok := ErrorDetails(err)
	if !ok {
		t.Fatalf("Invoke() error = %T %v, want provider.Error", err, err)
	}
	if providerErr.Code != "provider_retryable_http_error" || providerErr.HTTPStatus != http.StatusTooManyRequests || !providerErr.Retryable {
		t.Fatalf("provider error = %#v, want retryable HTTP classification", providerErr)
	}
	message := err.Error()
	if !strings.Contains(message, "provider_retryable_http_error") || !strings.Contains(message, "http_status=429") {
		t.Fatalf("error = %q, want retryable provider error classification", message)
	}
	for _, want := range []string{"body_sha256=", "request_id=req_provider_429", "retry_after=30", "message=redacted provider details"} {
		if !strings.Contains(message, want) {
			t.Fatalf("error = %q, want fragment %q", message, want)
		}
	}
	for _, leaked := range []string{
		key,
		"Authorization",
		"User prompt launch poster",
		"raw_provider_payload",
		"req_body_should_not_win",
	} {
		if strings.Contains(message, leaked) {
			t.Fatalf("error leaked %q: %q", leaked, message)
		}
	}
}

func TestOpenAICompatibleProviderZAIInsufficientBalanceIsNonRetryableQuotaError(t *testing.T) {
	key := fakeZAIKey()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}`))
	}))
	defer server.Close()

	_, err := (OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL,
		APIKey:           key,
		ModelID:          "glm-5.2",
		LiveCallsEnabled: true,
	}}).Invoke(context.Background(), validOpenAICompatibleRequest())
	providerErr, ok := ErrorDetails(err)
	if !ok {
		t.Fatalf("Invoke() error = %T %v, want provider.Error", err, err)
	}
	if providerErr.Code != "provider_quota_unavailable" || providerErr.HTTPStatus != http.StatusTooManyRequests || providerErr.ProviderCode != "1113" || providerErr.Retryable {
		t.Fatalf("provider error = %#v, want non-retryable quota classification", providerErr)
	}
	message := providerErr.Error()
	if !strings.Contains(message, "provider_quota_unavailable") || !strings.Contains(message, "provider_code=1113") {
		t.Fatalf("error message = %q, want quota/provider code", message)
	}
	if strings.Contains(message, key) || strings.Contains(strings.ToLower(message), "authorization") {
		t.Fatalf("error leaked secret-bearing detail: %q", message)
	}
}

func TestOpenAICompatibleProviderStatusAndCapabilitiesHideKey(t *testing.T) {
	key := fakeZAIKey()
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		if r.Header.Get("Authorization") != "Bearer "+key {
			t.Fatalf("Authorization header = %q, want bearer test key", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"glm-5.2"}]}`))
	}))
	defer server.Close()
	client := OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL + "/api/paas/v4",
		APIKey:           key,
		ModelID:          "glm-5.2",
		LiveCallsEnabled: true,
		Now:              func() time.Time { return time.Date(2026, 6, 21, 12, 0, 0, 0, time.UTC) },
	}}
	status := client.Status(context.Background())
	if !status.Available || status.ProviderID != "zenari-image-sandbox" {
		t.Fatalf("status = %#v, want available sandbox adapter", status)
	}
	if strings.Contains(status.Message, key) {
		t.Fatalf("status leaked key: %#v", status)
	}
	if status.Message != "openai-compatible health probe passed" || gotPath != "/api/paas/v4/models" {
		t.Fatalf("status/path = %#v/%q, want health probe pass on models endpoint", status, gotPath)
	}
	capabilities := client.Capabilities()
	if len(capabilities) != 1 {
		t.Fatalf("capabilities = %#v, want one capability", capabilities)
	}
	capability := capabilities[0]
	if capability.ProviderID != "zenari-image-sandbox" || capability.ModelID != "glm-5.2" || !capability.SupportsBatch {
		t.Fatalf("capability = %#v, want batch-capable openai-compatible model", capability)
	}
	if len(capability.Endpoints) == 0 || len(capability.ToolTypes) == 0 {
		t.Fatalf("capability endpoints/tools = %#v", capability)
	}
	for _, endpoint := range []string{"image.edit"} {
		if !containsString(capability.Endpoints, endpoint) {
			t.Fatalf("capability endpoints = %#v, missing %s", capability.Endpoints, endpoint)
		}
	}
	for _, tool := range []string{"remove_background", "upscale", "erase", "expand"} {
		if !containsString(capability.ToolTypes, tool) {
			t.Fatalf("capability tools = %#v, missing %s", capability.ToolTypes, tool)
		}
	}
}

func TestOpenAICompatibleProviderStatusHTTPErrorDoesNotLeakKey(t *testing.T) {
	key := fakeZAIKey()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad Authorization: "+r.Header.Get("Authorization"), http.StatusUnauthorized)
	}))
	defer server.Close()
	status := (OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL,
		APIKey:           key,
		ModelID:          "glm-5.2",
		LiveCallsEnabled: true,
	}}).Status(context.Background())
	if status.Available {
		t.Fatalf("Status() = %#v, want unavailable on HTTP error", status)
	}
	if !strings.Contains(status.Message, "HTTP status 401") {
		t.Fatalf("status message = %q, want sanitized HTTP status", status.Message)
	}
	if strings.Contains(status.Message, key) || strings.Contains(strings.ToLower(status.Message), "authorization") {
		t.Fatalf("status leaked secret-bearing detail: %#v", status)
	}
}

func TestOpenAICompatibleProviderStatusRequiresConfiguredModel(t *testing.T) {
	key := fakeZAIKey()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+key {
			t.Fatalf("Authorization header = %q, want bearer test key", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"glm-5.2-air"},{"id":"embedding-3"}]}`))
	}))
	defer server.Close()

	status := (OpenAICompatibleProvider{Config: OpenAICompatibleConfig{
		ProviderID:       "zenari-image-sandbox",
		BaseURL:          server.URL + "/api/paas/v4",
		APIKey:           key,
		ModelID:          "glm-5.2",
		LiveCallsEnabled: true,
	}}).Status(context.Background())
	if status.Available {
		t.Fatalf("Status() = %#v, want unavailable when configured model is missing", status)
	}
	if status.Message != "openai-compatible health probe missing configured model" {
		t.Fatalf("status message = %q, want configured-model failure", status.Message)
	}
	if strings.Contains(status.Message, key) || strings.Contains(strings.ToLower(status.Message), "authorization") {
		t.Fatalf("status leaked secret-bearing detail: %#v", status)
	}
}

func TestOpenAICompatibleModelIDsRejectsSecretShapedResponse(t *testing.T) {
	key := fakeZAIKey()
	_, err := openAICompatibleModelIDs([]byte(`{"object":"list","data":[{"id":"glm-5.2"}],"debug":"` + key + `"}`))
	if err == nil || !strings.Contains(err.Error(), "redacted details") {
		t.Fatalf("openAICompatibleModelIDs() error = %v, want secret-shaped response rejection", err)
	}
	if strings.Contains(err.Error(), key) {
		t.Fatalf("error leaked secret-shaped response: %v", err)
	}
}

func TestOpenAICompatibleChatCompletionsURL(t *testing.T) {
	tests := map[string]string{
		"https://api.z.ai/api/paas/v4":                     "https://api.z.ai/api/paas/v4/chat/completions",
		"https://api.openai.example.test/v1":               "https://api.openai.example.test/v1/chat/completions",
		"https://api.openai.example.test/chat/completions": "https://api.openai.example.test/chat/completions",
		"https://api.openai.example.test/":                 "https://api.openai.example.test/v1/chat/completions",
	}
	for input, want := range tests {
		got, err := openAICompatibleChatCompletionsURL(input)
		if err != nil {
			t.Fatalf("openAICompatibleChatCompletionsURL(%q) error = %v", input, err)
		}
		if got != want {
			t.Fatalf("openAICompatibleChatCompletionsURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestOpenAICompatibleModelsURL(t *testing.T) {
	tests := map[string]string{
		"https://api.z.ai/api/paas/v4":       "https://api.z.ai/api/paas/v4/models",
		"https://api.openai.example.test/v1": "https://api.openai.example.test/v1/models",
		"https://api.openai.example.test/":   "https://api.openai.example.test/models",
	}
	for input, want := range tests {
		got, err := openAICompatibleModelsURL(input)
		if err != nil {
			t.Fatalf("openAICompatibleModelsURL(%q) error = %v", input, err)
		}
		if got != want {
			t.Fatalf("openAICompatibleModelsURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestOpenAICompatibleEndpointURLRejectsUnsafeBaseURL(t *testing.T) {
	tests := map[string]string{
		"https://key:secret@api.z.ai/api/paas/v4":   "must not include credentials",
		"https://api.z.ai/api/paas/v4?token=debug":  "must not include query or fragment",
		"https://api.z.ai/api/paas/v4#debug":        "must not include query or fragment",
		"ftp://api.z.ai/api/paas/v4":                "must use http or https",
		"https://api.z.ai/api/paas/v4/chat?debug=1": "must not include query or fragment",
		"https://api.z.ai/api/paas/v4/models#debug": "must not include query or fragment",
	}
	for input, want := range tests {
		if got, err := openAICompatibleEndpointURL(input, "models", false); err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("openAICompatibleEndpointURL(%q) = %q, %v; want error containing %q", input, got, err, want)
		}
	}
}

func validOpenAICompatibleRequest() Request {
	req := validRequest()
	req.ProviderID = "zenari-image-sandbox"
	req.ModelID = "image-fast-v1"
	req.Endpoint = "image.generate"
	req.Payload = map[string]any{
		"prompt":              "launch poster for a quiet productivity workspace",
		"tool_type":           "image.generate",
		"seed":                "seed_1",
		"selected_object_ids": []string{"node_1"},
		"reference_asset_ids": []string{"asset_1", "asset_2"},
		"allowed_models":      []string{"image-fast-v1"},
	}
	req.Provenance.ProviderID = req.ProviderID
	req.Provenance.ModelID = req.ModelID
	req.Provenance.RequestHash = "request_hash_1"
	return req
}

func fakeZAIKey() string {
	return strings.Repeat("a", 32) + "." + strings.Repeat("b", 16)
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
