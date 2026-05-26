package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
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
	Observability ObservabilityConfig
	Tasks         TaskConfig
	Worker        WorkerConfig
}

type AppConfig struct {
	Environment string
	ServiceName string
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
	CheckTimeout   time.Duration
}

type AuthConfig struct {
	AccessMode             string
	SessionCookieName      string
	SessionSecret          string
	SessionTTL             time.Duration
	AdminSessionCookieName string
	AdminSessionSecret     string
	AdminSessionTTL        time.Duration
	SessionCookieSecure    bool
	SessionCookieSameSite  string
	SessionCookieDomain    string
	LocalSeedUserEmail     string
	LocalSeedAdminEmail    string
}

type BillingConfig struct {
	CheckoutProvider string
	WeeklyQuotaUnits int64
}

type ObservabilityConfig struct {
	MetricsEnabled bool
	MetricsPort    int
}

type TaskConfig struct {
	SchemaVersion int
}

type WorkerConfig struct {
	InstanceID        string
	Version           string
	PollInterval      time.Duration
	ClaimTimeout      time.Duration
	DrainGraceTimeout time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		App: AppConfig{
			Environment: env("ZENART_ENV", "local"),
			ServiceName: env("SERVICE_NAME", "zenart-backend"),
		},
		HTTP: HTTPConfig{
			Addr:              env("HTTP_ADDR", ":8080"),
			ReadHeaderTimeout: durationEnv("HTTP_READ_HEADER_TIMEOUT", 5*time.Second),
		},
		Security: SecurityConfig{
			AllowedOrigins:        listEnv("CORS_ALLOWED_ORIGINS", []string{"http://localhost:3000", "http://localhost:3001"}),
			MaxUploadBytes:        int64Env("MAX_UPLOAD_BYTES", 25*1024*1024),
			AllowedUploadTypes:    listEnv("ALLOWED_UPLOAD_CONTENT_TYPES", []string{"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"}),
			UploadURLTTL:          durationEnv("UPLOAD_URL_TTL", 10*time.Minute),
			ContentSecurityPolicy: env("CONTENT_SECURITY_POLICY", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"),
			CSRFHeaderName:        env("CSRF_HEADER_NAME", "X-ZenArt-CSRF"),
			CSRFHeaderValue:       env("CSRF_HEADER_VALUE", "same-site-origin-check"),
		},
		Postgres: PostgresConfig{
			DSN:          env("DATABASE_URL", "postgres://zenart:zenart@localhost:5432/zenart?sslmode=disable"),
			CheckTimeout: durationEnv("POSTGRES_CHECK_TIMEOUT", 2*time.Second),
		},
		Redis: RedisConfig{
			Addr:         env("REDIS_ADDR", "localhost:6379"),
			Password:     env("REDIS_PASSWORD", ""),
			DB:           intEnv("REDIS_DB", 0),
			CheckTimeout: durationEnv("REDIS_CHECK_TIMEOUT", 2*time.Second),
		},
		ObjectStorage: ObjectStorageConfig{
			Provider:       env("OBJECT_STORAGE_PROVIDER", "local"),
			Endpoint:       env("OBJECT_STORAGE_ENDPOINT", "http://localhost:9000"),
			PublicEndpoint: env("OBJECT_STORAGE_PUBLIC_ENDPOINT", ""),
			Region:         env("OBJECT_STORAGE_REGION", "us-east-1"),
			Bucket:         env("OBJECT_STORAGE_BUCKET", "zenart-local"),
			AccessKey:      env("OBJECT_STORAGE_ACCESS_KEY", "minioadmin"),
			SecretKey:      env("OBJECT_STORAGE_SECRET_KEY", "minioadmin"),
			UseSSL:         boolEnv("OBJECT_STORAGE_USE_SSL", false),
			ForcePathStyle: boolEnv("OBJECT_STORAGE_FORCE_PATH_STYLE", true),
			LocalRoot:      env("OBJECT_STORAGE_LOCAL_ROOT", ".local-objectstore"),
			SigningKey:     env("OBJECT_STORAGE_SIGNING_KEY", "stage0-local-object-signing"),
			CheckTimeout:   durationEnv("OBJECT_STORAGE_CHECK_TIMEOUT", 2*time.Second),
		},
		Auth: AuthConfig{
			AccessMode:             env("STAGE0_ACCESS_MODE", "local"),
			SessionCookieName:      env("SESSION_COOKIE_NAME", "__Host-zenart_session"),
			SessionSecret:          env("SESSION_SECRET", "stage0-local-session-secret-minimum-32-bytes"),
			SessionTTL:             durationEnv("SESSION_TTL", 24*time.Hour),
			AdminSessionCookieName: env("ADMIN_SESSION_COOKIE_NAME", "__Host-zenart_admin_session"),
			AdminSessionSecret:     env("ADMIN_SESSION_SECRET", "stage0-local-admin-session-secret-minimum-32-bytes"),
			AdminSessionTTL:        durationEnv("ADMIN_SESSION_TTL", 8*time.Hour),
			SessionCookieSecure:    boolEnv("SESSION_COOKIE_SECURE", true),
			SessionCookieSameSite:  env("SESSION_COOKIE_SAME_SITE", "lax"),
			SessionCookieDomain:    env("SESSION_COOKIE_DOMAIN", ""),
			LocalSeedUserEmail:     env("LOCAL_SEED_USER_EMAIL", "local.user@example.com"),
			LocalSeedAdminEmail:    env("LOCAL_SEED_ADMIN_EMAIL", "local.admin@example.com"),
		},
		Billing: BillingConfig{
			CheckoutProvider: env("CHECKOUT_PROVIDER", "mock"),
			WeeklyQuotaUnits: int64Env("WEEKLY_QUOTA_UNITS", 1000),
		},
		Observability: ObservabilityConfig{
			MetricsEnabled: boolEnv("METRICS_ENABLED", true),
			MetricsPort:    intEnv("METRICS_PORT", 9090),
		},
		Tasks: TaskConfig{
			SchemaVersion: intEnv("TASK_SCHEMA_VERSION", 1),
		},
		Worker: WorkerConfig{
			InstanceID:        env("WORKER_INSTANCE_ID", "stage0-local-worker"),
			Version:           env("WORKER_VERSION", "stage0-local"),
			PollInterval:      durationEnv("WORKER_POLL_INTERVAL", 2*time.Second),
			ClaimTimeout:      durationEnv("WORKER_CLAIM_TIMEOUT", 15*time.Minute),
			DrainGraceTimeout: durationEnv("WORKER_DRAIN_GRACE_TIMEOUT", 10*time.Second),
		},
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	var errs []string

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
	if _, err := url.ParseRequestURI(c.ObjectStorage.Endpoint); err != nil {
		errs = append(errs, fmt.Sprintf("OBJECT_STORAGE_ENDPOINT must be a URL: %v", err))
	}
	if strings.TrimSpace(c.ObjectStorage.PublicEndpoint) != "" {
		if _, err := url.ParseRequestURI(c.ObjectStorage.PublicEndpoint); err != nil {
			errs = append(errs, fmt.Sprintf("OBJECT_STORAGE_PUBLIC_ENDPOINT must be a URL: %v", err))
		}
	}
	if strings.TrimSpace(c.ObjectStorage.Bucket) == "" {
		errs = append(errs, "OBJECT_STORAGE_BUCKET must not be empty")
	}
	if c.ObjectStorage.Provider == "local" && strings.TrimSpace(c.ObjectStorage.LocalRoot) == "" {
		errs = append(errs, "OBJECT_STORAGE_LOCAL_ROOT must not be empty for local object storage")
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
	}
	if c.Observability.MetricsPort <= 0 || c.Observability.MetricsPort > 65535 {
		errs = append(errs, "METRICS_PORT must be between 1 and 65535")
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

	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
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
