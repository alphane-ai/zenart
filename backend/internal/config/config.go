package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	App           AppConfig
	HTTP          HTTPConfig
	Security      SecurityConfig
	Postgres      PostgresConfig
	Redis         RedisConfig
	ObjectStorage ObjectStorageConfig
	Auth          AuthConfig
	Billing       BillingConfig
	LLM           LLMConfig
	RateLimit     RateLimitConfig
	Observability ObservabilityConfig
	Crawler       CrawlerConfig
	Tasks         TaskConfig
	Worker        WorkerConfig
}

type AppConfig struct {
	Environment  string
	ServiceName  string
	BrandName    string
	PublicDomain string
}

type HTTPConfig struct {
	Addr              string
	ReadHeaderTimeout time.Duration
}

type SecurityConfig struct {
	AllowedOrigins        []string
	MaxUploadBytes        int64
	AllowedUploadTypes    []string
	UploadURLTTL          time.Duration
	MalwareScanProvider   string
	MalwareScanEndpoint   string
	MalwareScanAPIKey     string
	MalwareScanTimeout    time.Duration
	MalwareScanFailClosed bool
	ContentSecurityPolicy string
	CSRFHeaderName        string
	CSRFHeaderValue       string
}

type PostgresConfig struct {
	DSN          string
	CheckTimeout time.Duration
}

type RedisConfig struct {
	Addr         string
	Password     string
	DB           int
	CheckTimeout time.Duration
}

type ObjectStorageConfig struct {
	Provider       string
	Endpoint       string
	PublicEndpoint string
	Region         string
	Bucket         string
	AccessKey      string
	SecretKey      string
	UseSSL         bool
	ForcePathStyle bool
	LocalRoot      string
	SigningKey     string
	DownloadURLTTL time.Duration
	CheckTimeout   time.Duration
}

type AuthConfig struct {
	AccessMode              string
	SessionCookieName       string
	SessionSecret           string
	SessionTTL              time.Duration
	AdminSessionCookieName  string
	AdminSessionSecret      string
	AdminSessionTTL         time.Duration
	SessionCookieSecure     bool
	SessionCookieSameSite   string
	SessionCookieDomain     string
	DevIdentityHeaders      bool
	AdminDevIdentityHeaders bool
	LocalSeedUserEmail      string
	LocalSeedAdminEmail     string
}

type BillingConfig struct {
	CheckoutProvider       string
	WeeklyQuotaUnits       int64
	StripeMode             string
	StripeAPIBaseURL       string
	StripeAPIKey           string
	StripeSecretKey        string
	StripePublishableKey   string
	StripeWebhookSecret    string
	StripeSandboxProductID string
	StripeDefaultPriceID   string
	StripeSuccessURL       string
	StripeCancelURL        string
	StripePortalReturnURL  string
	StripeSandboxSelfTest  bool
}

type LLMConfig struct {
	Provider        string
	OpenAIBaseURL   string
	OpenAIAPIKey    string
	OpenAIModel     string
	RequestTimeout  time.Duration
	EnableLiveCalls bool
}

type RateLimitConfig struct {
	Enabled                     bool
	Store                       string
	UserRequestsPerMinute       int
	TenantRequestsPerMinute     int
	ProviderRequestsPerMinute   int
	AdminActionsPerMinute       int
	ProviderDailySpendCapCents  int64
	ProviderEmergencyKillSwitch bool
}

type ObservabilityConfig struct {
	MetricsEnabled bool
	MetricsPort    int
}

type CrawlerConfig struct {
	Enabled          bool
	UserAgent        string
	GlobalRPS        float64
	SourceRPS        float64
	RawRetentionDays int
	BlocklistHosts   []string
}

type TaskConfig struct {
	SchemaVersion int
}

type WorkerConfig struct {
	InstanceID                         string
	Version                            string
	PollInterval                       time.Duration
	ClaimTimeout                       time.Duration
	DrainGraceTimeout                  time.Duration
	CleanupInterval                    time.Duration
	CleanupTimeout                     time.Duration
	CleanupBatchLimit                  int
	BatchEnabled                       bool
	BatchTenantID                      string
	BatchPollInterval                  time.Duration
	BatchClaimLimit                    int
	BatchClaimTimeout                  time.Duration
	BatchMaxTenantConcurrency          int
	BatchProviderMaxConcurrency        map[string]int
	BatchProviderModelMaxConcurrency   map[string]int
	BatchAllowedProviderModelToolTypes []string
}

var objectStorageBucketPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

func Load() (Config, error) {
	cfg := Config{
		App: AppConfig{
			Environment:  env("ZENARI_ENV", "local"),
			ServiceName:  env("SERVICE_NAME", "zenari-backend"),
			BrandName:    env("APP_BRAND_NAME", "zenari.ai"),
			PublicDomain: env("APP_PUBLIC_DOMAIN", "zenari.ai"),
		},
		HTTP: HTTPConfig{
			Addr:              env("HTTP_ADDR", ":8080"),
			ReadHeaderTimeout: durationEnv("HTTP_READ_HEADER_TIMEOUT", 5*time.Second),
		},
		Security: SecurityConfig{
			AllowedOrigins:        listEnv("CORS_ALLOWED_ORIGINS", []string{"http://localhost:26080", "http://localhost:26081"}),
			MaxUploadBytes:        int64Env("MAX_UPLOAD_BYTES", 25*1024*1024),
			AllowedUploadTypes:    listEnv("ALLOWED_UPLOAD_CONTENT_TYPES", []string{"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"}),
			UploadURLTTL:          durationEnv("UPLOAD_URL_TTL", 10*time.Minute),
			MalwareScanProvider:   env("MALWARE_SCAN_PROVIDER", "stage0-placeholder"),
			MalwareScanEndpoint:   env("MALWARE_SCAN_ENDPOINT", ""),
			MalwareScanAPIKey:     env("MALWARE_SCAN_API_KEY", ""),
			MalwareScanTimeout:    durationEnv("MALWARE_SCAN_TIMEOUT", 5*time.Second),
			MalwareScanFailClosed: boolEnv("MALWARE_SCAN_FAIL_CLOSED", false),
			ContentSecurityPolicy: env("CONTENT_SECURITY_POLICY", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
			CSRFHeaderName:        env("CSRF_HEADER_NAME", "X-Zenari-CSRF"),
			CSRFHeaderValue:       env("CSRF_HEADER_VALUE", "same-site-origin-check"),
		},
		Postgres: PostgresConfig{
			DSN:          env("DATABASE_URL", "postgres://zenari:zenari@localhost:26432/zenari?sslmode=disable"),
			CheckTimeout: durationEnv("POSTGRES_CHECK_TIMEOUT", 2*time.Second),
		},
		Redis: RedisConfig{
			Addr:         env("REDIS_ADDR", "localhost:26379"),
			Password:     env("REDIS_PASSWORD", ""),
			DB:           intEnv("REDIS_DB", 0),
			CheckTimeout: durationEnv("REDIS_CHECK_TIMEOUT", 2*time.Second),
		},
		ObjectStorage: ObjectStorageConfig{
			Provider:       env("OBJECT_STORAGE_PROVIDER", "local"),
			Endpoint:       env("OBJECT_STORAGE_ENDPOINT", "http://localhost:26900"),
			PublicEndpoint: env("OBJECT_STORAGE_PUBLIC_ENDPOINT", "http://localhost:26900"),
			Region:         env("OBJECT_STORAGE_REGION", "us-east-1"),
			Bucket:         env("OBJECT_STORAGE_BUCKET", "zenari-local"),
			AccessKey:      env("OBJECT_STORAGE_ACCESS_KEY", "minioadmin"),
			SecretKey:      env("OBJECT_STORAGE_SECRET_KEY", "minioadmin"),
			UseSSL:         boolEnv("OBJECT_STORAGE_USE_SSL", false),
			ForcePathStyle: boolEnv("OBJECT_STORAGE_FORCE_PATH_STYLE", true),
			LocalRoot:      env("OBJECT_STORAGE_LOCAL_ROOT", ".local-objectstore"),
			SigningKey:     env("OBJECT_STORAGE_SIGNING_KEY", "stage0-local-object-signing-key-32"),
			DownloadURLTTL: durationEnv("OBJECT_STORAGE_DOWNLOAD_URL_TTL", 10*time.Minute),
			CheckTimeout:   durationEnv("OBJECT_STORAGE_CHECK_TIMEOUT", 2*time.Second),
		},
		Auth: AuthConfig{
			AccessMode:              env("STAGE0_ACCESS_MODE", "local"),
			SessionCookieName:       env("SESSION_COOKIE_NAME", "__Host-zenari_session"),
			SessionSecret:           env("SESSION_SECRET", "stage0-local-session-secret-minimum-32-bytes"),
			SessionTTL:              durationEnv("SESSION_TTL", 24*time.Hour),
			AdminSessionCookieName:  env("ADMIN_SESSION_COOKIE_NAME", "__Host-zenari_admin_session"),
			AdminSessionSecret:      env("ADMIN_SESSION_SECRET", "stage0-local-admin-session-secret-minimum-32-bytes"),
			AdminSessionTTL:         durationEnv("ADMIN_SESSION_TTL", 8*time.Hour),
			SessionCookieSecure:     boolEnv("SESSION_COOKIE_SECURE", true),
			SessionCookieSameSite:   env("SESSION_COOKIE_SAME_SITE", "lax"),
			SessionCookieDomain:     env("SESSION_COOKIE_DOMAIN", ""),
			DevIdentityHeaders:      boolEnv("DEV_IDENTITY_HEADERS_ENABLED", true),
			AdminDevIdentityHeaders: boolEnv("ADMIN_DEV_IDENTITY_HEADERS_ENABLED", false),
			LocalSeedUserEmail:      env("LOCAL_SEED_USER_EMAIL", "local.user@example.com"),
			LocalSeedAdminEmail:     env("LOCAL_SEED_ADMIN_EMAIL", "local.admin@example.com"),
		},
		Billing: BillingConfig{
			CheckoutProvider:       env("CHECKOUT_PROVIDER", "mock"),
			WeeklyQuotaUnits:       int64Env("WEEKLY_QUOTA_UNITS", 1000),
			StripeMode:             env("STRIPE_MODE", "test"),
			StripeAPIBaseURL:       env("STRIPE_API_BASE_URL", "https://api.stripe.com"),
			StripeAPIKey:           env("STRIPE_API_KEY", ""),
			StripeSecretKey:        env("STRIPE_SECRET_KEY", ""),
			StripePublishableKey:   env("STRIPE_PUBLISHABLE_KEY", env("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "")),
			StripeWebhookSecret:    env("STRIPE_WEBHOOK_SECRET", env("BILLING_WEBHOOK_SECRET", "")),
			StripeSandboxProductID: env("STRIPE_SANDBOX_PRODUCT_ID", ""),
			StripeDefaultPriceID:   env("STRIPE_DEFAULT_PRICE_ID", ""),
			StripeSuccessURL:       env("STRIPE_SUCCESS_URL", "http://localhost:26080/billing?stripe=success"),
			StripeCancelURL:        env("STRIPE_CANCEL_URL", "http://localhost:26080/billing?stripe=cancel"),
			StripePortalReturnURL:  env("STRIPE_PORTAL_RETURN_URL", "http://localhost:26080/billing"),
			StripeSandboxSelfTest:  boolEnv("STRIPE_SANDBOX_SELFTEST_REQUIRED", true),
		},
		LLM: LLMConfig{
			Provider:        env("LLM_PROVIDER", "openai-compatible"),
			OpenAIBaseURL:   env("LLM_OPENAI_BASE_URL", "https://api.z.ai/api/coding/paas/v4"),
			OpenAIAPIKey:    firstNonPlaceholderSecret(env("LLM_OPENAI_API_KEY", ""), env("ZAI_API_KEY", ""), env("OPENAI_API_KEY", "")),
			OpenAIModel:     env("LLM_OPENAI_MODEL", "glm-5.2"),
			RequestTimeout:  durationEnv("LLM_REQUEST_TIMEOUT", 60*time.Second),
			EnableLiveCalls: boolEnv("LLM_ENABLE_LIVE_CALLS", false),
		},
		RateLimit: RateLimitConfig{
			Enabled:                     boolEnv("RATELIMIT_ENABLED", true),
			Store:                       env("RATELIMIT_STORE", "memory"),
			UserRequestsPerMinute:       intEnv("RATELIMIT_USER_REQUESTS_PER_MINUTE", 60),
			TenantRequestsPerMinute:     intEnv("RATELIMIT_TENANT_REQUESTS_PER_MINUTE", 240),
			ProviderRequestsPerMinute:   intEnv("RATELIMIT_PROVIDER_REQUESTS_PER_MINUTE", 120),
			AdminActionsPerMinute:       intEnv("RATELIMIT_ADMIN_ACTIONS_PER_MINUTE", 30),
			ProviderDailySpendCapCents:  int64Env("RATELIMIT_PROVIDER_DAILY_SPEND_CAP_CENTS", int64Env("PROVIDER_DAILY_SPEND_CAP_CENTS", 0)),
			ProviderEmergencyKillSwitch: boolEnv("RATELIMIT_PROVIDER_EMERGENCY_KILL_SWITCH", boolEnv("PROVIDER_EMERGENCY_KILL_SWITCH", false)),
		},
		Observability: ObservabilityConfig{
			MetricsEnabled: boolEnv("METRICS_ENABLED", true),
			MetricsPort:    intEnv("METRICS_PORT", 31990),
		},
		Crawler: CrawlerConfig{
			Enabled:          boolEnv("CRAWLER_ENABLED", false),
			UserAgent:        env("CRAWLER_USER_AGENT", "ZenariStage1Bot/1.0"),
			GlobalRPS:        float64Env("CRAWLER_GLOBAL_RPS", 0.2),
			SourceRPS:        float64Env("CRAWLER_SOURCE_RPS", 0.1),
			RawRetentionDays: intEnv("CRAWLER_RAW_RETENTION_DAYS", 14),
			BlocklistHosts:   listEnv("CRAWLER_BLOCKLIST_HOSTS", nil),
		},
		Tasks: TaskConfig{
			SchemaVersion: intEnv("TASK_SCHEMA_VERSION", 1),
		},
		Worker: WorkerConfig{
			InstanceID:                         env("WORKER_INSTANCE_ID", "stage0-local-worker"),
			Version:                            env("WORKER_VERSION", "stage0-local"),
			PollInterval:                       durationEnv("WORKER_POLL_INTERVAL", 2*time.Second),
			ClaimTimeout:                       durationEnv("WORKER_CLAIM_TIMEOUT", 15*time.Minute),
			DrainGraceTimeout:                  durationEnv("WORKER_DRAIN_GRACE_TIMEOUT", 10*time.Second),
			CleanupInterval:                    durationEnv("WORKER_CLEANUP_INTERVAL", time.Hour),
			CleanupTimeout:                     durationEnv("WORKER_CLEANUP_TIMEOUT", 30*time.Second),
			CleanupBatchLimit:                  intEnv("WORKER_CLEANUP_BATCH_LIMIT", 100),
			BatchEnabled:                       boolEnv("WORKER_BATCH_ENABLED", false),
			BatchTenantID:                      env("WORKER_BATCH_TENANT_ID", ""),
			BatchPollInterval:                  durationEnv("WORKER_BATCH_POLL_INTERVAL", 2*time.Second),
			BatchClaimLimit:                    intEnv("WORKER_BATCH_CLAIM_LIMIT", 4),
			BatchClaimTimeout:                  durationEnv("WORKER_BATCH_CLAIM_TIMEOUT", 15*time.Minute),
			BatchMaxTenantConcurrency:          intEnv("WORKER_BATCH_MAX_TENANT_CONCURRENCY", 4),
			BatchProviderMaxConcurrency:        intMapEnv("WORKER_BATCH_PROVIDER_MAX_CONCURRENCY", nil),
			BatchProviderModelMaxConcurrency:   intMapEnv("WORKER_BATCH_PROVIDER_MODEL_MAX_CONCURRENCY", nil),
			BatchAllowedProviderModelToolTypes: listEnv("WORKER_BATCH_ALLOWED_PROVIDER_MODEL_TOOLS", nil),
		},
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	var errs []string

	if strings.TrimSpace(c.App.BrandName) == "" {
		errs = append(errs, "APP_BRAND_NAME must not be empty")
	}
	if strings.TrimSpace(c.App.PublicDomain) == "" {
		errs = append(errs, "APP_PUBLIC_DOMAIN must not be empty")
	}
	if strings.Contains(strings.TrimSpace(c.App.PublicDomain), "://") {
		errs = append(errs, "APP_PUBLIC_DOMAIN must be a host name, not a URL")
	}
	if strings.TrimSpace(c.HTTP.Addr) == "" {
		errs = append(errs, "HTTP_ADDR must not be empty")
	}
	if _, _, err := net.SplitHostPort(normalizeAddr(c.HTTP.Addr)); err != nil {
		errs = append(errs, fmt.Sprintf("HTTP_ADDR must be host:port or :port: %v", err))
	}
	if strings.TrimSpace(c.Postgres.DSN) == "" {
		errs = append(errs, "DATABASE_URL must not be empty")
	}
	if strings.TrimSpace(c.Redis.Addr) == "" {
		errs = append(errs, "REDIS_ADDR must not be empty")
	}
	if c.Security.MaxUploadBytes <= 0 {
		errs = append(errs, "MAX_UPLOAD_BYTES must be > 0")
	}
	if len(c.Security.AllowedUploadTypes) == 0 {
		errs = append(errs, "ALLOWED_UPLOAD_CONTENT_TYPES must include at least one content type")
	}
	for _, contentType := range c.Security.AllowedUploadTypes {
		if !strings.Contains(contentType, "/") {
			errs = append(errs, "ALLOWED_UPLOAD_CONTENT_TYPES entries must be media types")
			break
		}
	}
	if c.Security.UploadURLTTL <= 0 {
		errs = append(errs, "UPLOAD_URL_TTL must be > 0")
	}
	if strings.TrimSpace(c.Security.MalwareScanProvider) == "" {
		errs = append(errs, "MALWARE_SCAN_PROVIDER must not be empty")
	}
	if c.Security.MalwareScanTimeout <= 0 {
		errs = append(errs, "MALWARE_SCAN_TIMEOUT must be > 0")
	}
	switch strings.ToLower(strings.TrimSpace(c.Security.MalwareScanProvider)) {
	case "stage0-placeholder", "placeholder":
	case "http":
		if strings.TrimSpace(c.Security.MalwareScanEndpoint) == "" {
			errs = append(errs, "MALWARE_SCAN_ENDPOINT must not be empty when MALWARE_SCAN_PROVIDER=http")
		} else if parsed, endpointErr := validateSecretlessHTTPServiceEndpoint(c.Security.MalwareScanEndpoint, "MALWARE_SCAN_ENDPOINT"); endpointErr != "" {
			errs = append(errs, endpointErr)
		} else if !isLocalEnvironment(c.App.Environment) && parsed.Scheme != "https" {
			errs = append(errs, "MALWARE_SCAN_ENDPOINT must use https outside local")
		} else if !isLocalEnvironment(c.App.Environment) && isLocalServiceHost(parsed.Hostname()) {
			errs = append(errs, "MALWARE_SCAN_ENDPOINT must not target localhost or private IP outside local")
		}
		if !isLocalEnvironment(c.App.Environment) && !c.Security.MalwareScanFailClosed {
			errs = append(errs, "MALWARE_SCAN_FAIL_CLOSED must be true when MALWARE_SCAN_PROVIDER=http outside local")
		}
	default:
		errs = append(errs, `MALWARE_SCAN_PROVIDER must be "stage0-placeholder" or "http"`)
	}
	if strings.TrimSpace(c.Security.CSRFHeaderName) == "" {
		errs = append(errs, "CSRF_HEADER_NAME must not be empty")
	}
	if strings.TrimSpace(c.Security.CSRFHeaderValue) == "" {
		errs = append(errs, "CSRF_HEADER_VALUE must not be empty")
	}
	for _, origin := range c.Security.AllowedOrigins {
		parsed, err := url.ParseRequestURI(origin)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			errs = append(errs, fmt.Sprintf("CORS_ALLOWED_ORIGINS entry must be an absolute origin: %q", origin))
		}
	}
	if strings.TrimSpace(c.Auth.AccessMode) == "" {
		errs = append(errs, "STAGE0_ACCESS_MODE must not be empty")
	}
	if c.Auth.DevIdentityHeaders && strings.TrimSpace(c.Auth.AccessMode) != "local" {
		errs = append(errs, "DEV_IDENTITY_HEADERS_ENABLED may only be true when STAGE0_ACCESS_MODE=local")
	}
	if c.Auth.AdminDevIdentityHeaders && strings.TrimSpace(c.Auth.AccessMode) != "local" {
		errs = append(errs, "ADMIN_DEV_IDENTITY_HEADERS_ENABLED may only be true when STAGE0_ACCESS_MODE=local")
	}
	if strings.TrimSpace(c.Auth.SessionCookieName) == "" {
		errs = append(errs, "SESSION_COOKIE_NAME must not be empty")
	}
	if strings.TrimSpace(c.Auth.AdminSessionCookieName) == "" {
		errs = append(errs, "ADMIN_SESSION_COOKIE_NAME must not be empty")
	}
	if c.Auth.SessionTTL <= 0 {
		errs = append(errs, "SESSION_TTL must be > 0")
	}
	if c.Auth.AdminSessionTTL <= 0 {
		errs = append(errs, "ADMIN_SESSION_TTL must be > 0")
	}
	if len(c.Auth.SessionSecret) < 32 {
		errs = append(errs, "SESSION_SECRET must be at least 32 bytes")
	}
	if len(c.Auth.AdminSessionSecret) < 32 {
		errs = append(errs, "ADMIN_SESSION_SECRET must be at least 32 bytes")
	}
	switch strings.ToLower(strings.TrimSpace(c.Auth.SessionCookieSameSite)) {
	case "lax", "strict":
	default:
		errs = append(errs, `SESSION_COOKIE_SAME_SITE must be "lax" or "strict"`)
	}
	if strings.HasPrefix(c.Auth.SessionCookieName, "__Host-") || strings.HasPrefix(c.Auth.AdminSessionCookieName, "__Host-") {
		if !c.Auth.SessionCookieSecure {
			errs = append(errs, "__Host- session cookies require SESSION_COOKIE_SECURE=true")
		}
		if strings.TrimSpace(c.Auth.SessionCookieDomain) != "" {
			errs = append(errs, "__Host- session cookies must not set SESSION_COOKIE_DOMAIN")
		}
	}
	switch c.ObjectStorage.Provider {
	case "local", "s3-compatible":
	default:
		errs = append(errs, `OBJECT_STORAGE_PROVIDER must be "local" or "s3-compatible"`)
	}
	objectStorageEndpoint, objectStorageEndpointErr := validateObjectStorageEndpoint(c.ObjectStorage.Endpoint, "OBJECT_STORAGE_ENDPOINT")
	if objectStorageEndpointErr != "" {
		errs = append(errs, objectStorageEndpointErr)
	}
	var objectStoragePublicEndpoint *url.URL
	if strings.TrimSpace(c.ObjectStorage.PublicEndpoint) != "" {
		var publicEndpointErr string
		objectStoragePublicEndpoint, publicEndpointErr = validateObjectStorageEndpoint(c.ObjectStorage.PublicEndpoint, "OBJECT_STORAGE_PUBLIC_ENDPOINT")
		if publicEndpointErr != "" {
			errs = append(errs, publicEndpointErr)
		}
	}
	if strings.TrimSpace(c.ObjectStorage.Bucket) == "" {
		errs = append(errs, "OBJECT_STORAGE_BUCKET must not be empty")
	} else if !validObjectStorageBucket(c.ObjectStorage.Bucket) {
		errs = append(errs, "OBJECT_STORAGE_BUCKET must be a DNS-compatible bucket name")
	} else {
		if objectStorageEndpoint != nil && endpointContainsBucketPath(objectStorageEndpoint, c.ObjectStorage.Bucket) {
			errs = append(errs, "OBJECT_STORAGE_ENDPOINT must not include OBJECT_STORAGE_BUCKET as a path segment; set bucket only in OBJECT_STORAGE_BUCKET")
		}
		if objectStoragePublicEndpoint != nil && endpointContainsBucketPath(objectStoragePublicEndpoint, c.ObjectStorage.Bucket) {
			errs = append(errs, "OBJECT_STORAGE_PUBLIC_ENDPOINT must not include OBJECT_STORAGE_BUCKET as a path segment; set bucket only in OBJECT_STORAGE_BUCKET")
		}
	}
	if c.ObjectStorage.Provider == "local" && strings.TrimSpace(c.ObjectStorage.LocalRoot) == "" {
		errs = append(errs, "OBJECT_STORAGE_LOCAL_ROOT must not be empty for local object storage")
	}
	if c.ObjectStorage.DownloadURLTTL <= 0 {
		errs = append(errs, "OBJECT_STORAGE_DOWNLOAD_URL_TTL must be > 0")
	}
	if len(c.ObjectStorage.SigningKey) < 32 {
		errs = append(errs, "OBJECT_STORAGE_SIGNING_KEY must be at least 32 bytes")
	}
	if !isLocalEnvironment(c.App.Environment) {
		if c.ObjectStorage.Provider != "s3-compatible" {
			errs = append(errs, "OBJECT_STORAGE_PROVIDER must be s3-compatible outside local")
		}
		if objectStorageEndpoint != nil && isLocalServiceHost(objectStorageEndpoint.Hostname()) {
			errs = append(errs, "OBJECT_STORAGE_ENDPOINT must not target localhost or private IP outside local")
		}
		if objectStoragePublicEndpoint != nil && isLocalServiceHost(objectStoragePublicEndpoint.Hostname()) {
			errs = append(errs, "OBJECT_STORAGE_PUBLIC_ENDPOINT must not target localhost or private IP outside local")
		}
		if isDefaultLocalSecret(c.ObjectStorage.SigningKey, "stage0-local-object-signing-key-32") {
			errs = append(errs, "OBJECT_STORAGE_SIGNING_KEY must not use the local default outside local")
		}
	}
	if c.ObjectStorage.Provider == "s3-compatible" {
		if strings.TrimSpace(c.ObjectStorage.Region) == "" {
			errs = append(errs, "OBJECT_STORAGE_REGION must not be empty for S3-compatible object storage")
		}
		if strings.TrimSpace(c.ObjectStorage.AccessKey) == "" {
			errs = append(errs, "OBJECT_STORAGE_ACCESS_KEY must not be empty for S3-compatible object storage")
		}
		if strings.TrimSpace(c.ObjectStorage.SecretKey) == "" {
			errs = append(errs, "OBJECT_STORAGE_SECRET_KEY must not be empty for S3-compatible object storage")
		}
		if !isLocalEnvironment(c.App.Environment) {
			if objectStorageEndpoint != nil && objectStorageEndpoint.Scheme != "https" {
				errs = append(errs, "OBJECT_STORAGE_ENDPOINT must use https for S3-compatible object storage outside local")
			}
			if objectStoragePublicEndpoint != nil && objectStoragePublicEndpoint.Scheme != "https" {
				errs = append(errs, "OBJECT_STORAGE_PUBLIC_ENDPOINT must use https for S3-compatible object storage outside local")
			}
			if isDefaultLocalSecret(c.ObjectStorage.AccessKey, "minioadmin") || isDefaultLocalSecret(c.ObjectStorage.SecretKey, "minioadmin") {
				errs = append(errs, "OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY must not use local MinIO defaults outside local")
			}
		}
	}
	if c.Observability.MetricsPort <= 0 || c.Observability.MetricsPort > 65535 {
		errs = append(errs, "METRICS_PORT must be between 1 and 65535")
	}
	if strings.TrimSpace(c.Crawler.UserAgent) == "" {
		errs = append(errs, "CRAWLER_USER_AGENT must not be empty")
	}
	if c.Crawler.GlobalRPS <= 0 {
		errs = append(errs, "CRAWLER_GLOBAL_RPS must be > 0")
	}
	if c.Crawler.SourceRPS <= 0 {
		errs = append(errs, "CRAWLER_SOURCE_RPS must be > 0")
	}
	if c.Crawler.RawRetentionDays <= 0 || c.Crawler.RawRetentionDays > 30 {
		errs = append(errs, "CRAWLER_RAW_RETENTION_DAYS must be between 1 and 30")
	}
	switch strings.ToLower(strings.TrimSpace(c.Billing.CheckoutProvider)) {
	case "mock", "stripe":
	default:
		errs = append(errs, `CHECKOUT_PROVIDER must be "mock" or "stripe"`)
	}
	if c.Billing.WeeklyQuotaUnits <= 0 {
		errs = append(errs, "WEEKLY_QUOTA_UNITS must be > 0")
	}
	if strings.EqualFold(strings.TrimSpace(c.Billing.CheckoutProvider), "stripe") {
		mode := strings.ToLower(strings.TrimSpace(c.Billing.StripeMode))
		switch mode {
		case "test", "live":
		default:
			errs = append(errs, `STRIPE_MODE must be "test" or "live"`)
		}
		stripeSecretKey := firstNonEmpty(c.Billing.StripeSecretKey, c.Billing.StripeAPIKey)
		if !strings.HasPrefix(stripeSecretKey, "sk_"+mode+"_") {
			errs = append(errs, "STRIPE_SECRET_KEY or STRIPE_API_KEY must match STRIPE_MODE")
		} else if isPlaceholderSecret(stripeSecretKey) {
			errs = append(errs, "STRIPE_SECRET_KEY or STRIPE_API_KEY must not be a placeholder")
		}
		stripeAPIBaseURL, stripeAPIBaseErr := validateSecretlessHTTPServiceEndpoint(c.Billing.StripeAPIBaseURL, "STRIPE_API_BASE_URL")
		if stripeAPIBaseErr != "" {
			errs = append(errs, stripeAPIBaseErr)
		} else if !isLocalEnvironment(c.App.Environment) {
			if stripeAPIBaseURL.Scheme != "https" {
				errs = append(errs, "STRIPE_API_BASE_URL must use https outside local")
			}
			if isLocalServiceHost(stripeAPIBaseURL.Hostname()) {
				errs = append(errs, "STRIPE_API_BASE_URL must not target localhost or private IP outside local")
			}
		}
		if !strings.HasPrefix(strings.TrimSpace(c.Billing.StripePublishableKey), "pk_"+mode+"_") {
			errs = append(errs, "STRIPE_PUBLISHABLE_KEY must match STRIPE_MODE")
		} else if isPlaceholderSecret(c.Billing.StripePublishableKey) {
			errs = append(errs, "STRIPE_PUBLISHABLE_KEY must not be a placeholder")
		}
		if !strings.HasPrefix(strings.TrimSpace(c.Billing.StripeWebhookSecret), "whsec_") {
			errs = append(errs, "STRIPE_WEBHOOK_SECRET or BILLING_WEBHOOK_SECRET must start with whsec_")
		} else if isPlaceholderSecret(c.Billing.StripeWebhookSecret) {
			errs = append(errs, "STRIPE_WEBHOOK_SECRET or BILLING_WEBHOOK_SECRET must not be a placeholder")
		}
		if strings.TrimSpace(c.Billing.StripeDefaultPriceID) == "" || !strings.HasPrefix(strings.TrimSpace(c.Billing.StripeDefaultPriceID), "price_") {
			errs = append(errs, "STRIPE_DEFAULT_PRICE_ID must start with price_")
		} else if isPlaceholderSecret(c.Billing.StripeDefaultPriceID) {
			errs = append(errs, "STRIPE_DEFAULT_PRICE_ID must not be a placeholder")
		}
		if strings.TrimSpace(c.Billing.StripeSandboxProductID) == "" || !strings.HasPrefix(strings.TrimSpace(c.Billing.StripeSandboxProductID), "prod_") {
			errs = append(errs, "STRIPE_SANDBOX_PRODUCT_ID must start with prod_")
		} else if isPlaceholderSecret(c.Billing.StripeSandboxProductID) {
			errs = append(errs, "STRIPE_SANDBOX_PRODUCT_ID must not be a placeholder")
		}
		successURL, successErr := validateStripeRedirectURL(c.Billing.StripeSuccessURL, "STRIPE_SUCCESS_URL")
		if successErr != "" {
			errs = append(errs, successErr)
		}
		cancelURL, cancelErr := validateStripeRedirectURL(c.Billing.StripeCancelURL, "STRIPE_CANCEL_URL")
		if cancelErr != "" {
			errs = append(errs, cancelErr)
		}
		portalReturnURL, portalReturnErr := validateStripeRedirectURL(c.Billing.StripePortalReturnURL, "STRIPE_PORTAL_RETURN_URL")
		if portalReturnErr != "" {
			errs = append(errs, portalReturnErr)
		}
		if mode == "live" && isLocalEnvironment(c.App.Environment) {
			errs = append(errs, "STRIPE_MODE=live is not allowed when ZENARI_ENV is local")
		}
		if !isLocalEnvironment(c.App.Environment) {
			if successURL != nil && successURL.Scheme != "https" {
				errs = append(errs, "STRIPE_SUCCESS_URL must use https outside local")
			}
			if cancelURL != nil && cancelURL.Scheme != "https" {
				errs = append(errs, "STRIPE_CANCEL_URL must use https outside local")
			}
			if portalReturnURL != nil && portalReturnURL.Scheme != "https" {
				errs = append(errs, "STRIPE_PORTAL_RETURN_URL must use https outside local")
			}
		}
	}
	switch strings.ToLower(strings.TrimSpace(c.LLM.Provider)) {
	case "disabled", "mock", "openai-compatible":
	default:
		errs = append(errs, `LLM_PROVIDER must be "disabled", "mock", or "openai-compatible"`)
	}
	if c.LLM.RequestTimeout <= 0 {
		errs = append(errs, "LLM_REQUEST_TIMEOUT must be > 0")
	}
	if strings.EqualFold(strings.TrimSpace(c.LLM.Provider), "openai-compatible") {
		llmBaseURL, llmBaseErr := validateSecretlessHTTPServiceEndpoint(c.LLM.OpenAIBaseURL, "LLM_OPENAI_BASE_URL")
		if llmBaseErr != "" {
			errs = append(errs, llmBaseErr)
		} else {
			if !isLocalEnvironment(c.App.Environment) && llmBaseURL.Scheme != "https" {
				errs = append(errs, "LLM_OPENAI_BASE_URL must use https outside local")
			}
			if !isLocalEnvironment(c.App.Environment) && isLocalServiceHost(llmBaseURL.Hostname()) {
				errs = append(errs, "LLM_OPENAI_BASE_URL must not target localhost or private IP outside local")
			}
		}
		if strings.TrimSpace(c.LLM.OpenAIModel) == "" {
			errs = append(errs, "LLM_OPENAI_MODEL must not be empty when LLM_PROVIDER=openai-compatible")
		}
		if c.LLM.EnableLiveCalls {
			llmKey := strings.TrimSpace(c.LLM.OpenAIAPIKey)
			if llmKey == "" || isPlaceholderSecret(llmKey) {
				errs = append(errs, "LLM_OPENAI_API_KEY, ZAI_API_KEY, or OPENAI_API_KEY must be set to a non-placeholder value when LLM_ENABLE_LIVE_CALLS=true")
			}
		}
	}
	switch strings.ToLower(strings.TrimSpace(c.RateLimit.Store)) {
	case "memory", "redis":
	default:
		errs = append(errs, `RATELIMIT_STORE must be "memory" or "redis"`)
	}
	if c.RateLimit.Enabled {
		if c.RateLimit.UserRequestsPerMinute < 0 {
			errs = append(errs, "RATELIMIT_USER_REQUESTS_PER_MINUTE must be >= 0")
		}
		if c.RateLimit.TenantRequestsPerMinute < 0 {
			errs = append(errs, "RATELIMIT_TENANT_REQUESTS_PER_MINUTE must be >= 0")
		}
		if c.RateLimit.ProviderRequestsPerMinute < 0 {
			errs = append(errs, "RATELIMIT_PROVIDER_REQUESTS_PER_MINUTE must be >= 0")
		}
		if c.RateLimit.AdminActionsPerMinute < 0 {
			errs = append(errs, "RATELIMIT_ADMIN_ACTIONS_PER_MINUTE must be >= 0")
		}
		if c.RateLimit.ProviderDailySpendCapCents < 0 {
			errs = append(errs, "RATELIMIT_PROVIDER_DAILY_SPEND_CAP_CENTS must be >= 0")
		}
		if !isLocalEnvironment(c.App.Environment) && strings.EqualFold(strings.TrimSpace(c.RateLimit.Store), "memory") {
			errs = append(errs, "RATELIMIT_STORE=memory is only allowed when ZENARI_ENV=local")
		}
	}
	if c.Tasks.SchemaVersion < 1 {
		errs = append(errs, "TASK_SCHEMA_VERSION must be >= 1")
	}
	if strings.TrimSpace(c.Worker.Version) == "" {
		errs = append(errs, "WORKER_VERSION must not be empty")
	}
	if strings.TrimSpace(c.Worker.InstanceID) == "" {
		errs = append(errs, "WORKER_INSTANCE_ID must not be empty")
	}
	if c.Worker.PollInterval <= 0 {
		errs = append(errs, "WORKER_POLL_INTERVAL must be > 0")
	}
	if c.Worker.ClaimTimeout <= 0 {
		errs = append(errs, "WORKER_CLAIM_TIMEOUT must be > 0")
	}
	if c.Worker.DrainGraceTimeout <= 0 {
		errs = append(errs, "WORKER_DRAIN_GRACE_TIMEOUT must be > 0")
	}
	if c.Worker.CleanupInterval < 0 {
		errs = append(errs, "WORKER_CLEANUP_INTERVAL must be >= 0")
	}
	if c.Worker.CleanupTimeout <= 0 {
		errs = append(errs, "WORKER_CLEANUP_TIMEOUT must be > 0")
	}
	if c.Worker.CleanupBatchLimit <= 0 {
		errs = append(errs, "WORKER_CLEANUP_BATCH_LIMIT must be > 0")
	}
	if c.Worker.BatchEnabled {
		if strings.TrimSpace(c.Worker.BatchTenantID) == "" {
			errs = append(errs, "WORKER_BATCH_TENANT_ID must not be empty when WORKER_BATCH_ENABLED=true")
		}
		if c.Worker.BatchPollInterval <= 0 {
			errs = append(errs, "WORKER_BATCH_POLL_INTERVAL must be > 0")
		}
		if c.Worker.BatchClaimLimit <= 0 || c.Worker.BatchClaimLimit > 100 {
			errs = append(errs, "WORKER_BATCH_CLAIM_LIMIT must be between 1 and 100")
		}
		if c.Worker.BatchClaimTimeout <= 0 {
			errs = append(errs, "WORKER_BATCH_CLAIM_TIMEOUT must be > 0")
		}
		if c.Worker.BatchMaxTenantConcurrency < 0 {
			errs = append(errs, "WORKER_BATCH_MAX_TENANT_CONCURRENCY must be >= 0")
		}
		for providerID, limit := range c.Worker.BatchProviderMaxConcurrency {
			if strings.TrimSpace(providerID) == "" || limit < 0 {
				errs = append(errs, "WORKER_BATCH_PROVIDER_MAX_CONCURRENCY entries must have non-empty provider ids and non-negative limits")
				break
			}
		}
		for key, limit := range c.Worker.BatchProviderModelMaxConcurrency {
			if strings.TrimSpace(key) == "" || !strings.Contains(key, ":") || limit < 0 {
				errs = append(errs, "WORKER_BATCH_PROVIDER_MODEL_MAX_CONCURRENCY entries must use provider:model=limit with non-negative limits")
				break
			}
		}
		for _, entry := range c.Worker.BatchAllowedProviderModelToolTypes {
			if len(strings.Split(entry, ":")) != 3 {
				errs = append(errs, "WORKER_BATCH_ALLOWED_PROVIDER_MODEL_TOOLS entries must use provider:model:tool")
				break
			}
		}
	}

	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

func validateObjectStorageEndpoint(raw, name string) (*url.URL, string) {
	if strings.Contains(strings.TrimSpace(raw), "#") {
		return nil, fmt.Sprintf("%s must not include a fragment", name)
	}
	parsed, errMessage := validateExternalServiceEndpoint(raw, name)
	if errMessage != "" {
		return nil, errMessage
	}
	if parsed.RawQuery != "" {
		return nil, fmt.Sprintf("%s must not include query parameters", name)
	}
	if parsed.Fragment != "" {
		return nil, fmt.Sprintf("%s must not include a fragment", name)
	}
	return parsed, ""
}

func endpointContainsBucketPath(parsed *url.URL, bucket string) bool {
	bucket = strings.Trim(strings.TrimSpace(bucket), "/")
	if parsed == nil || bucket == "" {
		return false
	}
	for _, segment := range strings.Split(parsed.EscapedPath(), "/") {
		if segment == "" {
			continue
		}
		unescaped, err := url.PathUnescape(segment)
		if err != nil {
			unescaped = segment
		}
		if unescaped == bucket {
			return true
		}
	}
	return false
}

func validateSecretlessHTTPServiceEndpoint(raw, name string) (*url.URL, string) {
	if strings.Contains(strings.TrimSpace(raw), "#") {
		return nil, fmt.Sprintf("%s must not include a fragment", name)
	}
	parsed, errMessage := validateExternalServiceEndpoint(raw, name)
	if errMessage != "" {
		return nil, errMessage
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Sprintf("%s must use http or https", name)
	}
	if parsed.RawQuery != "" {
		return nil, fmt.Sprintf("%s must not include query parameters", name)
	}
	if parsed.Fragment != "" {
		return nil, fmt.Sprintf("%s must not include a fragment", name)
	}
	return parsed, ""
}

func validateStripeRedirectURL(raw, name string) (*url.URL, string) {
	if strings.Contains(strings.TrimSpace(raw), "#") {
		return nil, fmt.Sprintf("%s must not include a fragment", name)
	}
	parsed, errMessage := validateExternalServiceEndpoint(raw, name)
	if errMessage != "" {
		return nil, errMessage
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Sprintf("%s must use http or https", name)
	}
	if parsed.Fragment != "" {
		return nil, fmt.Sprintf("%s must not include a fragment", name)
	}
	return parsed, ""
}

func validateExternalServiceEndpoint(raw, name string) (*url.URL, string) {
	parsed, err := url.ParseRequestURI(raw)
	if err != nil {
		return nil, fmt.Sprintf("%s must be a URL: %v", name, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Sprintf("%s must include scheme and host", name)
	}
	if parsed.User != nil {
		return nil, fmt.Sprintf("%s must not include credentials", name)
	}
	return parsed, ""
}

func validObjectStorageBucket(bucket string) bool {
	bucket = strings.TrimSpace(bucket)
	if !objectStorageBucketPattern.MatchString(bucket) {
		return false
	}
	if strings.Contains(bucket, "..") || strings.Contains(bucket, ".-") || strings.Contains(bucket, "-.") {
		return false
	}
	if ip := net.ParseIP(bucket); ip != nil && ip.To4() != nil {
		return false
	}
	return true
}

func isLocalEnvironment(environment string) bool {
	switch strings.ToLower(strings.TrimSpace(environment)) {
	case "", "local":
		return true
	default:
		return false
	}
}

func isLocalServiceHost(host string) bool {
	host = strings.Trim(strings.ToLower(strings.TrimSpace(host)), "[]")
	switch host {
	case "", "localhost", "localhost.localdomain":
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

func isDefaultLocalSecret(value, defaultValue string) bool {
	return strings.TrimSpace(value) == defaultValue
}

func isPlaceholderSecret(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "" ||
		strings.Contains(normalized, "replace_me") ||
		strings.Contains(normalized, "placeholder") ||
		strings.Contains(normalized, "changeme")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstNonPlaceholderSecret(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" && !isPlaceholderSecret(trimmed) {
			return trimmed
		}
	}
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func normalizeAddr(addr string) string {
	if strings.HasPrefix(addr, ":") {
		return "0.0.0.0" + addr
	}
	return addr
}

func env(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		if strings.TrimSpace(value) == "" {
			return fallback
		}
		return value
	}
	return fallback
}

func intEnv(key string, fallback int) int {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func int64Env(key string, fallback int64) int64 {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func float64Env(key string, fallback float64) float64 {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func boolEnv(key string, fallback bool) bool {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func listEnv(key string, fallback []string) []string {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	parts := strings.Split(value, ",")
	items := make([]string, 0, len(parts))
	for _, part := range parts {
		item := strings.TrimSpace(part)
		if item != "" {
			items = append(items, item)
		}
	}
	if len(items) == 0 {
		return fallback
	}
	return items
}

func intMapEnv(key string, fallback map[string]int) map[string]int {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	out := make(map[string]int)
	for _, part := range strings.Split(value, ",") {
		item := strings.TrimSpace(part)
		if item == "" {
			continue
		}
		pieces := strings.SplitN(item, "=", 2)
		if len(pieces) != 2 {
			return fallback
		}
		name := strings.TrimSpace(pieces[0])
		limit, err := strconv.Atoi(strings.TrimSpace(pieces[1]))
		if name == "" || err != nil {
			return fallback
		}
		out[name] = limit
	}
	if len(out) == 0 {
		return fallback
	}
	return out
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
