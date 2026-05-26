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
	if cfg.ObjectStorage.Bucket != "zenart-local" {
		t.Fatalf("ObjectStorage.Bucket = %q, want zenart-local", cfg.ObjectStorage.Bucket)
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
