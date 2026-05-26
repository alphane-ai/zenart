package app

import (
	"net/http"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/config"
	"github.com/alphane-ai/zenart/backend/internal/security"
)

func TestMalwareScannerFromConfigSelectsHTTPScanner(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	cfg.Security.MalwareScanProvider = " HTTP "
	cfg.Security.MalwareScanEndpoint = "http://scanner.local/scan"
	cfg.Security.MalwareScanAPIKey = "secret"
	cfg.Security.MalwareScanTimeout = 3 * time.Second

	scanner := malwareScannerFromConfig(cfg, http.DefaultClient)
	httpScanner, ok := scanner.(security.HTTPMalwareScanner)
	if !ok {
		t.Fatalf("scanner = %T, want HTTPMalwareScanner", scanner)
	}
	if httpScanner.Endpoint != "http://scanner.local/scan" || httpScanner.APIKey != "secret" || httpScanner.Timeout != 3*time.Second {
		t.Fatalf("http scanner = %#v", httpScanner)
	}
}

func TestMalwareScannerFromConfigDefaultsToPlaceholder(t *testing.T) {
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if _, ok := malwareScannerFromConfig(cfg, nil).(security.PlaceholderMalwareScanner); !ok {
		t.Fatalf("scanner should default to placeholder")
	}
}
