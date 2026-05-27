package config

import (
	"strings"
	"testing"
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
	if cfg.Postgres.DSN == "" {
		t.Fatal("Postgres.DSN must have a local default")
	}
	if cfg.Redis.Addr != "localhost:6379" {
		t.Fatalf("Redis.Addr = %q, want localhost:6379", cfg.Redis.Addr)
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
	if cfg.ObjectStorage.Bucket != "zenart-local" {
		t.Fatalf("ObjectStorage.Bucket = %q, want zenart-local", cfg.ObjectStorage.Bucket)
	}
	if cfg.ObjectStorage.Provider != "local" {
		t.Fatalf("ObjectStorage.Provider = %q, want local", cfg.ObjectStorage.Provider)
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
		"zenart_test",
		"ZenArt-Test",
		"zenart..test",
		"zenart.-test",
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
