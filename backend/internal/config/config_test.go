package config

import "testing"

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
	if cfg.ObjectStorage.Bucket != "zenart-local" {
		t.Fatalf("ObjectStorage.Bucket = %q, want zenart-local", cfg.ObjectStorage.Bucket)
	}
	if cfg.ObjectStorage.Provider != "local" {
		t.Fatalf("ObjectStorage.Provider = %q, want local", cfg.ObjectStorage.Provider)
	}
	if cfg.ObjectStorage.LocalRoot == "" {
		t.Fatal("ObjectStorage.LocalRoot must have a local default")
	}
	if cfg.Worker.Version != "stage0-local" {
		t.Fatalf("Worker.Version = %q, want stage0-local", cfg.Worker.Version)
	}
	if cfg.Worker.InstanceID != "stage0-local-worker" {
		t.Fatalf("Worker.InstanceID = %q, want stage0-local-worker", cfg.Worker.InstanceID)
	}
	if cfg.Worker.PollInterval <= 0 || cfg.Worker.ClaimTimeout <= 0 || cfg.Worker.DrainGraceTimeout <= 0 {
		t.Fatalf("worker durations must have positive defaults: %#v", cfg.Worker)
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
}
