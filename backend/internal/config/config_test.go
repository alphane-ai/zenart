package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadDefaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.HTTP.Addr != ":8080" {
		t.Fatalf("HTTP.Addr = %q, want :8080", cfg.HTTP.Addr)
	}
	if cfg.App.BrandName != "zenari.ai" {
		t.Fatalf("App.BrandName = %q, want zenari.ai", cfg.App.BrandName)
	}
	if cfg.App.PublicDomain != "zenari.ai" {
		t.Fatalf("App.PublicDomain = %q, want zenari.ai", cfg.App.PublicDomain)
	}
	if cfg.App.ServiceName != "zenari-backend" {
		t.Fatalf("App.ServiceName = %q, want zenari-backend", cfg.App.ServiceName)
	}
	if cfg.Security.CSRFHeaderName != "X-Zenari-CSRF" {
		t.Fatalf("Security.CSRFHeaderName = %q, want X-Zenari-CSRF", cfg.Security.CSRFHeaderName)
	}
	if got := strings.Join(cfg.Security.AllowedOrigins, ","); got != "http://localhost:26080,http://localhost:26081" {
		t.Fatalf("Security.AllowedOrigins = %q, want Zenari web/admin devports only", got)
	}
	for _, origin := range cfg.Security.AllowedOrigins {
		if strings.Contains(origin, "26082") {
			t.Fatalf("Security.AllowedOrigins must not include legacy manager origin: %v", cfg.Security.AllowedOrigins)
		}
	}
	if cfg.Postgres.DSN == "" {
		t.Fatal("Postgres.DSN must have a local default")
	}
	if !strings.Contains(cfg.Postgres.DSN, "localhost:26432") {
		t.Fatalf("Postgres.DSN = %q, want Zenari devport 26432 fallback", cfg.Postgres.DSN)
	}
	if cfg.Redis.Addr != "localhost:26379" {
		t.Fatalf("Redis.Addr = %q, want localhost:26379", cfg.Redis.Addr)
	}
	if cfg.Security.MaxUploadBytes <= 0 {
		t.Fatalf("Security.MaxUploadBytes = %d, want positive", cfg.Security.MaxUploadBytes)
	}
	if len(cfg.Security.AllowedUploadTypes) == 0 {
		t.Fatal("Security.AllowedUploadTypes must have local defaults")
	}
	if cfg.Security.UploadURLTTL <= 0 {
		t.Fatalf("Security.UploadURLTTL = %s, want positive", cfg.Security.UploadURLTTL)
	}
	if cfg.Security.MalwareScanProvider != "stage0-placeholder" {
		t.Fatalf("Security.MalwareScanProvider = %q, want stage0-placeholder", cfg.Security.MalwareScanProvider)
	}
	if cfg.Security.MalwareScanTimeout <= 0 {
		t.Fatalf("Security.MalwareScanTimeout = %s, want positive", cfg.Security.MalwareScanTimeout)
	}
	if cfg.ObjectStorage.Bucket != "zenari-local" {
		t.Fatalf("ObjectStorage.Bucket = %q, want zenari-local", cfg.ObjectStorage.Bucket)
	}
	if cfg.ObjectStorage.Provider != "local" {
		t.Fatalf("ObjectStorage.Provider = %q, want local", cfg.ObjectStorage.Provider)
	}
	if cfg.ObjectStorage.Endpoint != "http://localhost:26900" || cfg.ObjectStorage.PublicEndpoint != "http://localhost:26900" {
		t.Fatalf("ObjectStorage endpoints = %q/%q, want Zenari devport 26900 fallback", cfg.ObjectStorage.Endpoint, cfg.ObjectStorage.PublicEndpoint)
	}
	if cfg.ObjectStorage.LocalRoot == "" {
		t.Fatal("ObjectStorage.LocalRoot must have a local default")
	}
	if cfg.ObjectStorage.DownloadURLTTL <= 0 {
		t.Fatalf("ObjectStorage.DownloadURLTTL = %s, want positive", cfg.ObjectStorage.DownloadURLTTL)
	}
	if cfg.Auth.AdminDevIdentityHeaders {
		t.Fatal("Auth.AdminDevIdentityHeaders must default to false")
	}
	if cfg.Auth.SessionCookieName != "__Host-zenari_session" {
		t.Fatalf("Auth.SessionCookieName = %q, want __Host-zenari_session", cfg.Auth.SessionCookieName)
	}
	if cfg.LLM.Provider != "openai-compatible" {
		t.Fatalf("LLM.Provider = %q, want openai-compatible", cfg.LLM.Provider)
	}
	if cfg.LLM.OpenAIBaseURL != "https://api.z.ai/api/coding/paas/v4" {
		t.Fatalf("LLM.OpenAIBaseURL = %q, want z.ai OpenAI-compatible endpoint", cfg.LLM.OpenAIBaseURL)
	}
	if cfg.LLM.EnableLiveCalls {
		t.Fatal("LLM.EnableLiveCalls must default to false")
	}
	if !cfg.RateLimit.Enabled {
		t.Fatal("RateLimit.Enabled must default to true")
	}
	if cfg.RateLimit.Store != "memory" {
		t.Fatalf("RateLimit.Store = %q, want memory", cfg.RateLimit.Store)
	}
	if cfg.RateLimit.UserRequestsPerMinute != 60 || cfg.RateLimit.TenantRequestsPerMinute != 240 || cfg.RateLimit.ProviderRequestsPerMinute != 120 || cfg.RateLimit.AdminActionsPerMinute != 30 {
		t.Fatalf("RateLimit defaults = %#v", cfg.RateLimit)
	}
	if cfg.Worker.BatchClaimTimeout <= 0 {
		t.Fatalf("Worker.BatchClaimTimeout = %s, want positive default", cfg.Worker.BatchClaimTimeout)
	}
	if cfg.Observability.MetricsPort != 31990 {
		t.Fatalf("Observability.MetricsPort = %d, want 31990", cfg.Observability.MetricsPort)
	}
	if cfg.Worker.Version != "stage0-local" {
		t.Fatalf("Worker.Version = %q, want stage0-local", cfg.Worker.Version)
	}
	if cfg.Worker.InstanceID != "stage0-local-worker" {
		t.Fatalf("Worker.InstanceID = %q, want stage0-local-worker", cfg.Worker.InstanceID)
	}
	if cfg.Worker.PollInterval <= 0 || cfg.Worker.ClaimTimeout <= 0 || cfg.Worker.DrainGraceTimeout <= 0 || cfg.Worker.CleanupInterval <= 0 || cfg.Worker.CleanupTimeout <= 0 {
		t.Fatalf("worker durations must have positive defaults: %#v", cfg.Worker)
	}
	if cfg.Worker.CleanupBatchLimit != 100 {
		t.Fatalf("Worker.CleanupBatchLimit = %d, want 100", cfg.Worker.CleanupBatchLimit)
	}
	if cfg.Worker.BatchEnabled {
		t.Fatal("Worker.BatchEnabled must default to false")
	}
}

func TestLoadAcceptsStripeSandboxBillingConfig(t *testing.T) {
	t.Setenv("CHECKOUT_PROVIDER", "stripe")
	t.Setenv("STRIPE_MODE", "test")
	t.Setenv("STRIPE_API_KEY", "sk_test_fixturekey")
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_fixturekey")
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk_test_fixturekey")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_fixturekey")
	t.Setenv("STRIPE_SANDBOX_PRODUCT_ID", "prod_123456789")
	t.Setenv("STRIPE_DEFAULT_PRICE_ID", "price_123456789")
	t.Setenv("STRIPE_SUCCESS_URL", "http://localhost:3000/billing?stripe=success")
	t.Setenv("STRIPE_CANCEL_URL", "http://localhost:3000/billing?stripe=cancel")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Billing.CheckoutProvider != "stripe" {
		t.Fatalf("Billing.CheckoutProvider = %q, want stripe", cfg.Billing.CheckoutProvider)
	}
	if cfg.Billing.StripeMode != "test" {
		t.Fatalf("Billing.StripeMode = %q, want test", cfg.Billing.StripeMode)
	}
	if !cfg.Billing.StripeSandboxSelfTest {
		t.Fatal("Billing.StripeSandboxSelfTest must default to true")
	}
}

func TestValidateRejectsIncompleteStripeBillingConfig(t *testing.T) {
	t.Setenv("CHECKOUT_PROVIDER", "stripe")
	t.Setenv("STRIPE_MODE", "test")
	t.Setenv("STRIPE_SECRET_KEY", "")
	t.Setenv("STRIPE_API_KEY", "")
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk_test_fixturekey")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_fixturekey")
	t.Setenv("STRIPE_SANDBOX_PRODUCT_ID", "prod_123456789")
	t.Setenv("STRIPE_DEFAULT_PRICE_ID", "price_123456789")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STRIPE_SECRET_KEY or STRIPE_API_KEY must match STRIPE_MODE") {
		t.Fatalf("Load() error = %v, want missing Stripe secret key error", err)
	}
}

func TestValidateRejectsPlaceholderStripeBillingConfig(t *testing.T) {
	t.Setenv("CHECKOUT_PROVIDER", "stripe")
	t.Setenv("STRIPE_MODE", "test")
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_replace_me")
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk_test_fixturekey")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_fixturekey")
	t.Setenv("STRIPE_SANDBOX_PRODUCT_ID", "prod_123456789")
	t.Setenv("STRIPE_DEFAULT_PRICE_ID", "price_123456789")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "must not be a placeholder") {
		t.Fatalf("Load() error = %v, want Stripe placeholder rejection", err)
	}
}

func TestValidateRejectsStripeTestModeWithLiveKeys(t *testing.T) {
	t.Setenv("CHECKOUT_PROVIDER", "stripe")
	t.Setenv("STRIPE_MODE", "test")
	t.Setenv("STRIPE_SECRET_KEY", "sk_live_fixturekey")
	t.Setenv("STRIPE_API_KEY", "sk_live_fixturekey")
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk_live_fixturekey")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_fixturekey")
	t.Setenv("STRIPE_SANDBOX_PRODUCT_ID", "prod_123456789")
	t.Setenv("STRIPE_DEFAULT_PRICE_ID", "price_123456789")

	err := expectLoadError(t)
	for _, want := range []string{
		"STRIPE_SECRET_KEY or STRIPE_API_KEY must match STRIPE_MODE",
		"STRIPE_PUBLISHABLE_KEY must match STRIPE_MODE",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("Load() error = %v, want %q", err, want)
		}
	}
}

func TestValidateRejectsStripeLiveModeWithTestKeysOutsideLocal(t *testing.T) {
	t.Setenv("ZENARI_ENV", "production")
	t.Setenv("CHECKOUT_PROVIDER", "stripe")
	t.Setenv("STRIPE_MODE", "live")
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_fixturekey")
	t.Setenv("STRIPE_API_KEY", "sk_test_fixturekey")
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk_test_fixturekey")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_fixturekey")
	t.Setenv("STRIPE_SANDBOX_PRODUCT_ID", "prod_123456789")
	t.Setenv("STRIPE_DEFAULT_PRICE_ID", "price_123456789")
	t.Setenv("STRIPE_SUCCESS_URL", "https://zenari.ai/billing?stripe=success")
	t.Setenv("STRIPE_CANCEL_URL", "https://zenari.ai/billing?stripe=cancel")
	t.Setenv("STRIPE_PORTAL_RETURN_URL", "https://zenari.ai/billing")

	err := expectLoadError(t)
	for _, want := range []string{
		"STRIPE_SECRET_KEY or STRIPE_API_KEY must match STRIPE_MODE",
		"STRIPE_PUBLISHABLE_KEY must match STRIPE_MODE",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("Load() error = %v, want %q", err, want)
		}
	}
	if strings.Contains(err.Error(), "STRIPE_MODE=live is not allowed") {
		t.Fatalf("Load() error = %v, want key-prefix rejection without local live-mode blocker", err)
	}
}

func TestValidateRejectsStripeLiveModeInLocalEnvironment(t *testing.T) {
	t.Setenv("CHECKOUT_PROVIDER", "stripe")
	t.Setenv("STRIPE_MODE", "live")
	t.Setenv("STRIPE_SECRET_KEY", "sk_live_fixturekey")
	t.Setenv("STRIPE_API_KEY", "sk_live_fixturekey")
	t.Setenv("STRIPE_PUBLISHABLE_KEY", "pk_live_fixturekey")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_fixturekey")
	t.Setenv("STRIPE_SANDBOX_PRODUCT_ID", "prod_123456789")
	t.Setenv("STRIPE_DEFAULT_PRICE_ID", "price_123456789")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "STRIPE_MODE=live is not allowed") {
		t.Fatalf("Load() error = %v, want local live-mode rejection", err)
	}
}

func expectLoadError(t *testing.T) error {
	t.Helper()
	_, err := Load()
	if err == nil {
		t.Fatal("Load() error = nil, want validation error")
	}
	return err
}

func TestLoadAcceptsOpenAICompatibleLLMConfigWithLiveCalls(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "openai-compatible")
	t.Setenv("LLM_OPENAI_BASE_URL", "https://api.z.ai/api/coding/paas/v4")
	t.Setenv("LLM_OPENAI_API_KEY", "zai_test_live_value_for_config")
	t.Setenv("LLM_OPENAI_MODEL", "glm-5.2")
	t.Setenv("LLM_ENABLE_LIVE_CALLS", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.LLM.OpenAIAPIKey != "zai_test_live_value_for_config" {
		t.Fatalf("LLM.OpenAIAPIKey not loaded from env")
	}
	if cfg.LLM.OpenAIModel != "glm-5.2" {
		t.Fatalf("LLM.OpenAIModel = %q, want glm-5.2", cfg.LLM.OpenAIModel)
	}
}

func TestLoadAcceptsOpenAICompatibleFallbackOpenAIAPIKey(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "openai-compatible")
	t.Setenv("LLM_OPENAI_BASE_URL", "https://api.z.ai/api/coding/paas/v4")
	t.Setenv("LLM_OPENAI_API_KEY", "replace_me")
	t.Setenv("OPENAI_API_KEY", "openai_compatible_live_value_for_config")
	t.Setenv("LLM_OPENAI_MODEL", "glm-5.2")
	t.Setenv("LLM_ENABLE_LIVE_CALLS", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.LLM.OpenAIAPIKey != "openai_compatible_live_value_for_config" {
		t.Fatalf("LLM.OpenAIAPIKey not loaded from OPENAI_API_KEY fallback")
	}
}

func TestValidateRejectsLiveLLMCallsWithoutKey(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "openai-compatible")
	t.Setenv("LLM_OPENAI_API_KEY", "replace_me")
	t.Setenv("LLM_ENABLE_LIVE_CALLS", "true")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "LLM_OPENAI_API_KEY, ZAI_API_KEY, or OPENAI_API_KEY must be set") {
		t.Fatalf("Load() error = %v, want missing LLM key rejection", err)
	}
}

func TestLoadAcceptsRateLimitConfig(t *testing.T) {
	t.Setenv("RATELIMIT_ENABLED", "true")
	t.Setenv("RATELIMIT_STORE", "redis")
	t.Setenv("RATELIMIT_USER_REQUESTS_PER_MINUTE", "10")
	t.Setenv("RATELIMIT_TENANT_REQUESTS_PER_MINUTE", "20")
	t.Setenv("RATELIMIT_PROVIDER_REQUESTS_PER_MINUTE", "30")
	t.Setenv("RATELIMIT_ADMIN_ACTIONS_PER_MINUTE", "5")
	t.Setenv("RATELIMIT_PROVIDER_DAILY_SPEND_CAP_CENTS", "12345")
	t.Setenv("RATELIMIT_PROVIDER_EMERGENCY_KILL_SWITCH", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.RateLimit.Store != "redis" || cfg.RateLimit.UserRequestsPerMinute != 10 || cfg.RateLimit.TenantRequestsPerMinute != 20 || cfg.RateLimit.ProviderRequestsPerMinute != 30 || cfg.RateLimit.AdminActionsPerMinute != 5 {
		t.Fatalf("RateLimit config = %#v", cfg.RateLimit)
	}
	if cfg.RateLimit.ProviderDailySpendCapCents != 12345 || !cfg.RateLimit.ProviderEmergencyKillSwitch {
		t.Fatalf("RateLimit provider controls = %#v", cfg.RateLimit)
	}
}

func TestLoadRateLimitKeepsLegacyProviderSpendEnvFallback(t *testing.T) {
	t.Setenv("RATELIMIT_PROVIDER_DAILY_SPEND_CAP_CENTS", "")
	t.Setenv("RATELIMIT_PROVIDER_EMERGENCY_KILL_SWITCH", "")
	t.Setenv("PROVIDER_DAILY_SPEND_CAP_CENTS", "987")
	t.Setenv("PROVIDER_EMERGENCY_KILL_SWITCH", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.RateLimit.ProviderDailySpendCapCents != 987 || !cfg.RateLimit.ProviderEmergencyKillSwitch {
		t.Fatalf("RateLimit legacy provider fallback = %#v", cfg.RateLimit)
	}
}

func TestValidateRejectsInvalidRateLimitConfig(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.RateLimit.Store = "sqlite"
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "RATELIMIT_STORE") {
		t.Fatalf("Validate() error = %v, want store validation error", err)
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.RateLimit.UserRequestsPerMinute = -1
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "RATELIMIT_USER_REQUESTS_PER_MINUTE") {
		t.Fatalf("Validate() error = %v, want user limit validation error", err)
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.RateLimit.ProviderDailySpendCapCents = -1
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "RATELIMIT_PROVIDER_DAILY_SPEND_CAP_CENTS") {
		t.Fatalf("Validate() error = %v, want provider spend cap validation error", err)
	}
}

func TestValidateRejectsRateLimitMemoryStoreOutsideLocal(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.App.Environment = "staging"
	cfg.ObjectStorage.Provider = "s3-compatible"
	cfg.ObjectStorage.Endpoint = "https://s3.example.test"
	cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test"
	cfg.ObjectStorage.AccessKey = "stage0-staging-access"
	cfg.ObjectStorage.SecretKey = "stage0-staging-secret"
	cfg.ObjectStorage.SigningKey = "stage0-staging-object-signing-key-32"
	cfg.RateLimit.Enabled = true
	cfg.RateLimit.Store = "memory"

	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "RATELIMIT_STORE=memory is only allowed") {
		t.Fatalf("Validate() error = %v, want non-local memory store rejection", err)
	}

	cfg.RateLimit.Store = "redis"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want redis rate-limit store accepted outside local", err)
	}
}

func TestValidateRejectsCredentialBearingLLMBaseURL(t *testing.T) {
	t.Setenv("LLM_PROVIDER", "openai-compatible")
	t.Setenv("LLM_OPENAI_BASE_URL", "https://key:secret@api.z.ai/api/coding/paas/v4")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "LLM_OPENAI_BASE_URL must not include credentials") {
		t.Fatalf("Load() error = %v, want credential-bearing LLM URL rejection", err)
	}
}

func TestLoadAcceptsBatchWorkerPolicyConfig(t *testing.T) {
	t.Setenv("WORKER_BATCH_ENABLED", "true")
	t.Setenv("WORKER_BATCH_TENANT_ID", "tenant_1")
	t.Setenv("WORKER_BATCH_CLAIM_LIMIT", "3")
	t.Setenv("WORKER_BATCH_CLAIM_TIMEOUT", "9m")
	t.Setenv("WORKER_BATCH_MAX_TENANT_CONCURRENCY", "6")
	t.Setenv("WORKER_BATCH_PROVIDER_MAX_CONCURRENCY", "zenari-image-sandbox=4")
	t.Setenv("WORKER_BATCH_PROVIDER_MODEL_MAX_CONCURRENCY", "zenari-image-sandbox:image-fast-v1=2")
	t.Setenv("WORKER_BATCH_ALLOWED_PROVIDER_MODEL_TOOLS", "zenari-image-sandbox:image-fast-v1:image.generate")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !cfg.Worker.BatchEnabled || cfg.Worker.BatchTenantID != "tenant_1" {
		t.Fatalf("batch worker config = %#v", cfg.Worker)
	}
	if cfg.Worker.BatchClaimLimit != 3 || cfg.Worker.BatchMaxTenantConcurrency != 6 {
		t.Fatalf("batch limits = claim %d tenant %d", cfg.Worker.BatchClaimLimit, cfg.Worker.BatchMaxTenantConcurrency)
	}
	if cfg.Worker.BatchClaimTimeout != 9*time.Minute {
		t.Fatalf("batch claim timeout = %s, want 9m", cfg.Worker.BatchClaimTimeout)
	}
	if cfg.Worker.BatchProviderMaxConcurrency["zenari-image-sandbox"] != 4 {
		t.Fatalf("provider limits = %#v", cfg.Worker.BatchProviderMaxConcurrency)
	}
	if cfg.Worker.BatchProviderModelMaxConcurrency["zenari-image-sandbox:image-fast-v1"] != 2 {
		t.Fatalf("provider/model limits = %#v", cfg.Worker.BatchProviderModelMaxConcurrency)
	}
	if len(cfg.Worker.BatchAllowedProviderModelToolTypes) != 1 {
		t.Fatalf("allowed provider/model/tools = %#v", cfg.Worker.BatchAllowedProviderModelToolTypes)
	}
}

func TestValidateRejectsEnabledBatchWorkerWithoutTenant(t *testing.T) {
	t.Setenv("WORKER_BATCH_ENABLED", "true")
	t.Setenv("WORKER_BATCH_TENANT_ID", "")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "WORKER_BATCH_TENANT_ID must not be empty") {
		t.Fatalf("Load() error = %v, want batch tenant error", err)
	}
}

func TestValidateRejectsEnabledBatchWorkerWithoutClaimTimeout(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Worker.BatchEnabled = true
	cfg.Worker.BatchTenantID = "tenant_1"
	cfg.Worker.BatchClaimTimeout = 0
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "WORKER_BATCH_CLAIM_TIMEOUT must be > 0") {
		t.Fatalf("Validate() error = %v, want batch claim timeout error", err)
	}
}

func TestValidateRejectsInvalidObjectStorageEndpoint(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.ObjectStorage.Endpoint = "%"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want invalid endpoint error")
	}
}

func TestValidateRequiresS3CompatibleCredentials(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.ObjectStorage.Provider = "s3-compatible"
	cfg.ObjectStorage.AccessKey = ""
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want missing access key error")
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.Provider = "s3-compatible"
	cfg.ObjectStorage.SecretKey = ""
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want missing secret key error")
	}
}

func TestValidateRejectsObjectStorageEndpointCredentials(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.ObjectStorage.Endpoint = "https://access:secret@s3.example.test"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want credential-bearing endpoint error")
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.PublicEndpoint = "https://access:secret@cdn.example.test"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want credential-bearing public endpoint error")
	}
}

func TestValidateRequiresHTTPSForS3CompatibleStorageOutsideLocal(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.App.Environment = "staging"
	cfg.ObjectStorage.Provider = "s3-compatible"
	cfg.ObjectStorage.AccessKey = "stage0-staging-access"
	cfg.ObjectStorage.SecretKey = "stage0-staging-secret"
	cfg.ObjectStorage.SigningKey = "stage0-staging-object-signing-key-32"
	cfg.ObjectStorage.Endpoint = "http://s3.example.test"
	cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test"
	cfg.RateLimit.Store = "redis"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want non-HTTPS endpoint error")
	}

	cfg.ObjectStorage.Endpoint = "https://s3.example.test"
	cfg.ObjectStorage.PublicEndpoint = "http://downloads.example.test"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want non-HTTPS public endpoint error")
	}

	cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want HTTPS S3-compatible storage config accepted", err)
	}
}

func TestValidateRejectsLocalObjectStorageOutsideLocal(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.App.Environment = "staging"
	cfg.ObjectStorage.Provider = "local"
	cfg.ObjectStorage.SigningKey = "stage0-staging-object-signing-key-32"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want local object storage rejected outside local")
	}
}

func TestValidateRejectsLocalObjectStorageEndpointsOutsideLocal(t *testing.T) {
	for _, endpoint := range []string{
		"https://localhost:9000",
		"https://127.0.0.1:9000",
		"https://10.0.0.5",
		"https://172.16.0.10",
		"https://192.168.1.20",
		"https://169.254.169.254",
	} {
		t.Run(endpoint, func(t *testing.T) {
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			cfg.App.Environment = "staging"
			cfg.ObjectStorage.Provider = "s3-compatible"
			cfg.ObjectStorage.Endpoint = endpoint
			cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test"
			cfg.ObjectStorage.AccessKey = "stage0-staging-access"
			cfg.ObjectStorage.SecretKey = "stage0-staging-secret"
			cfg.ObjectStorage.SigningKey = "stage0-staging-object-signing-key-32"
			if err := cfg.Validate(); err == nil {
				t.Fatal("Validate() error = nil, want local/private object storage endpoint rejected outside local")
			}
		})
	}
}

func TestValidateRejectsLocalObjectStorageSecretsOutsideLocal(t *testing.T) {
	cases := []struct {
		name       string
		accessKey  string
		secretKey  string
		signingKey string
	}{
		{name: "default access key", accessKey: "minioadmin", secretKey: "stage0-staging-secret", signingKey: "stage0-staging-object-signing-key-32"},
		{name: "default secret key", accessKey: "stage0-staging-access", secretKey: "minioadmin", signingKey: "stage0-staging-object-signing-key-32"},
		{name: "default signing key", accessKey: "stage0-staging-access", secretKey: "stage0-staging-secret", signingKey: "stage0-local-object-signing-key-32"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			cfg.App.Environment = "staging"
			cfg.ObjectStorage.Provider = "s3-compatible"
			cfg.ObjectStorage.Endpoint = "https://s3.example.test"
			cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test"
			cfg.ObjectStorage.AccessKey = tc.accessKey
			cfg.ObjectStorage.SecretKey = tc.secretKey
			cfg.ObjectStorage.SigningKey = tc.signingKey
			if err := cfg.Validate(); err == nil {
				t.Fatal("Validate() error = nil, want local object storage secret rejected outside local")
			}
		})
	}
}

func TestValidateRejectsInvalidDownloadURLTTL(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.ObjectStorage.DownloadURLTTL = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want invalid download URL TTL error")
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.SigningKey = "short"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want short signing key error")
	}
}

func TestValidateRejectsUnsafeObjectStorageBucketNames(t *testing.T) {
	for _, bucket := range []string{
		"../escape",
		"zenari_test",
		"Zenari-Test",
		"zenari..test",
		"zenari.-test",
		"192.168.0.1",
		"ab",
	} {
		t.Run(bucket, func(t *testing.T) {
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			cfg.ObjectStorage.Bucket = bucket
			if err := cfg.Validate(); err == nil {
				t.Fatal("Validate() error = nil, want unsafe bucket rejected")
			}
		})
	}
}

func TestValidateRejectsUnknownObjectStorageProvider(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.ObjectStorage.Provider = "ftp"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want provider error")
	}
}

func TestValidateRejectsInvalidSecurityConfig(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.Security.MaxUploadBytes = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want invalid max upload size error")
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Security.AllowedUploadTypes = []string{"png"}
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want invalid upload content type error")
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Security.MalwareScanProvider = ""
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want missing malware scan provider error")
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Security.MalwareScanProvider = "clamav"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want unsupported malware scan provider error")
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Security.MalwareScanProvider = "http"
	cfg.Security.MalwareScanEndpoint = ""
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want missing HTTP malware scan endpoint error")
	}

	cfg.Security.MalwareScanEndpoint = "http://scanner.local/scan"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want valid HTTP malware scanner config", err)
	}
}

func TestValidateRejectsMalwareScannerEndpointCredentials(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.Security.MalwareScanProvider = "http"
	cfg.Security.MalwareScanEndpoint = "https://scan_user:scan_secret@scanner.example.test/scan"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want credential-bearing malware scanner endpoint error")
	}
}

func TestValidateRejectsMalwareScannerEndpointQueryAndFragment(t *testing.T) {
	for _, tc := range []struct {
		name     string
		endpoint string
		wantText string
	}{
		{
			name:     "query",
			endpoint: "https://scanner.example.test/scan?token=secret",
			wantText: "MALWARE_SCAN_ENDPOINT must not include query parameters",
		},
		{
			name:     "fragment",
			endpoint: "https://scanner.example.test/scan#bearer-token",
			wantText: "MALWARE_SCAN_ENDPOINT must not include a fragment",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			cfg.Security.MalwareScanProvider = "http"
			cfg.Security.MalwareScanEndpoint = tc.endpoint
			err = cfg.Validate()
			if err == nil || !strings.Contains(err.Error(), tc.wantText) {
				t.Fatalf("Validate() error = %v, want %q", err, tc.wantText)
			}
		})
	}
}

func TestValidateRejectsObjectStorageEndpointQueryAndFragment(t *testing.T) {
	for _, tc := range []struct {
		name     string
		update   func(*Config)
		wantText string
	}{
		{
			name: "endpoint query",
			update: func(cfg *Config) {
				cfg.ObjectStorage.Endpoint = "https://s3.example.test?X-Amz-Signature=abcdef"
			},
			wantText: "OBJECT_STORAGE_ENDPOINT must not include query parameters",
		},
		{
			name: "endpoint fragment",
			update: func(cfg *Config) {
				cfg.ObjectStorage.Endpoint = "https://s3.example.test/#access-token"
			},
			wantText: "OBJECT_STORAGE_ENDPOINT must not include a fragment",
		},
		{
			name: "public endpoint query",
			update: func(cfg *Config) {
				cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test?token=secret"
			},
			wantText: "OBJECT_STORAGE_PUBLIC_ENDPOINT must not include query parameters",
		},
		{
			name: "public endpoint fragment",
			update: func(cfg *Config) {
				cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test/#signature"
			},
			wantText: "OBJECT_STORAGE_PUBLIC_ENDPOINT must not include a fragment",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			tc.update(&cfg)
			err = cfg.Validate()
			if err == nil || !strings.Contains(err.Error(), tc.wantText) {
				t.Fatalf("Validate() error = %v, want %q", err, tc.wantText)
			}
		})
	}
}

func TestValidateRejectsObjectStorageEndpointWithBucketPath(t *testing.T) {
	for _, tc := range []struct {
		name     string
		update   func(*Config)
		wantText string
	}{
		{
			name: "endpoint contains bucket path",
			update: func(cfg *Config) {
				cfg.ObjectStorage.Endpoint = "https://f3bc0bf71690e4974ea8b1e193c479f8.r2.cloudflarestorage.com/zenari"
			},
			wantText: "OBJECT_STORAGE_ENDPOINT must not include OBJECT_STORAGE_BUCKET as a path segment",
		},
		{
			name: "public endpoint contains bucket path",
			update: func(cfg *Config) {
				cfg.ObjectStorage.PublicEndpoint = "https://f3bc0bf71690e4974ea8b1e193c479f8.r2.cloudflarestorage.com/zenari"
			},
			wantText: "OBJECT_STORAGE_PUBLIC_ENDPOINT must not include OBJECT_STORAGE_BUCKET as a path segment",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			cfg.ObjectStorage.Provider = "s3-compatible"
			cfg.ObjectStorage.Endpoint = "https://f3bc0bf71690e4974ea8b1e193c479f8.r2.cloudflarestorage.com"
			cfg.ObjectStorage.PublicEndpoint = "https://f3bc0bf71690e4974ea8b1e193c479f8.r2.cloudflarestorage.com"
			cfg.ObjectStorage.Region = "auto"
			cfg.ObjectStorage.Bucket = "zenari"
			cfg.ObjectStorage.AccessKey = "stage1-r2-access"
			cfg.ObjectStorage.SecretKey = "stage1-r2-secret"
			tc.update(&cfg)
			err = cfg.Validate()
			if err == nil || !strings.Contains(err.Error(), tc.wantText) {
				t.Fatalf("Validate() error = %v, want %q", err, tc.wantText)
			}
		})
	}
}

func TestValidateAcceptsR2AccountEndpointAndSeparateBucket(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.ObjectStorage.Provider = "s3-compatible"
	cfg.ObjectStorage.Endpoint = "https://f3bc0bf71690e4974ea8b1e193c479f8.r2.cloudflarestorage.com"
	cfg.ObjectStorage.PublicEndpoint = "https://f3bc0bf71690e4974ea8b1e193c479f8.r2.cloudflarestorage.com"
	cfg.ObjectStorage.Region = "auto"
	cfg.ObjectStorage.Bucket = "zenari"
	cfg.ObjectStorage.AccessKey = "stage1-r2-access"
	cfg.ObjectStorage.SecretKey = "stage1-r2-secret"

	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want account endpoint plus separate bucket accepted", err)
	}
}

func TestValidateRequiresHTTPSForHTTPMalwareScannerOutsideLocal(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.App.Environment = "staging"
	cfg.ObjectStorage.Provider = "s3-compatible"
	cfg.ObjectStorage.Endpoint = "https://s3.example.test"
	cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test"
	cfg.ObjectStorage.AccessKey = "stage0-staging-access"
	cfg.ObjectStorage.SecretKey = "stage0-staging-secret"
	cfg.ObjectStorage.SigningKey = "stage0-staging-object-signing-key-32"
	cfg.RateLimit.Store = "redis"
	cfg.Security.MalwareScanProvider = "http"
	cfg.Security.MalwareScanFailClosed = true
	cfg.Security.MalwareScanEndpoint = "http://scanner.example.test/scan"
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want non-HTTPS malware scanner endpoint error")
	}

	cfg.Security.MalwareScanEndpoint = "https://scanner.example.test/scan"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want HTTPS malware scanner endpoint accepted", err)
	}
}

func TestValidateRequiresHTTPMalwareScannerFailClosedOutsideLocal(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.App.Environment = "staging"
	cfg.ObjectStorage.Provider = "s3-compatible"
	cfg.ObjectStorage.Endpoint = "https://s3.example.test"
	cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test"
	cfg.ObjectStorage.AccessKey = "stage0-staging-access"
	cfg.ObjectStorage.SecretKey = "stage0-staging-secret"
	cfg.ObjectStorage.SigningKey = "stage0-staging-object-signing-key-32"
	cfg.RateLimit.Store = "redis"
	cfg.Security.MalwareScanProvider = "http"
	cfg.Security.MalwareScanEndpoint = "https://scanner.example.test/scan"
	cfg.Security.MalwareScanFailClosed = false
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want fail-closed malware scanner error")
	}

	cfg.Security.MalwareScanFailClosed = true
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want fail-closed HTTP malware scanner accepted", err)
	}
}

func TestValidateRejectsHTTPMalwareScannerLocalEndpointsOutsideLocal(t *testing.T) {
	for _, tc := range []struct {
		name     string
		endpoint string
	}{
		{name: "localhost", endpoint: "https://localhost/scan"},
		{name: "loopback", endpoint: "https://127.0.0.1/scan"},
		{name: "private ip", endpoint: "https://10.1.2.3/scan"},
		{name: "link local", endpoint: "https://169.254.10.20/scan"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error = %v", err)
			}
			cfg.App.Environment = "staging"
			cfg.ObjectStorage.Provider = "s3-compatible"
			cfg.ObjectStorage.Endpoint = "https://s3.example.test"
			cfg.ObjectStorage.PublicEndpoint = "https://downloads.example.test"
			cfg.ObjectStorage.AccessKey = "stage0-staging-access"
			cfg.ObjectStorage.SecretKey = "stage0-staging-secret"
			cfg.ObjectStorage.SigningKey = "stage0-staging-object-signing-key-32"
			cfg.Security.MalwareScanProvider = "http"
			cfg.Security.MalwareScanFailClosed = true
			cfg.Security.MalwareScanEndpoint = tc.endpoint

			err = cfg.Validate()
			if err == nil || !strings.Contains(err.Error(), "MALWARE_SCAN_ENDPOINT must not target localhost or private IP outside local") {
				t.Fatalf("Validate() error = %v, want local endpoint denial", err)
			}
		})
	}
}

func TestValidateRestrictsDevIdentityHeadersToLocalAccessMode(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.Auth.AccessMode = "invite-only"
	cfg.Auth.DevIdentityHeaders = true
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want dev identity headers access-mode error")
	}

	cfg.Auth.DevIdentityHeaders = false
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want nil when dev identity headers are disabled", err)
	}
}

func TestValidateRestrictsAdminDevIdentityHeadersToLocalAccessMode(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	cfg.Auth.AccessMode = "invite-only"
	cfg.Auth.DevIdentityHeaders = false
	cfg.Auth.AdminDevIdentityHeaders = true
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want admin dev identity headers access-mode error")
	}

	cfg.Auth.AccessMode = "local"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want nil for local admin dev identity headers", err)
	}
}

func TestValidateRejectsInvalidWorkerCleanupSettings(t *testing.T) {
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Worker.CleanupTimeout = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want cleanup timeout error")
	}

	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Worker.CleanupBatchLimit = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() error = nil, want cleanup batch limit error")
	}
}
