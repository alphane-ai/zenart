package crawler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMetricsHandlerExposesCrawlerCounters(t *testing.T) {
	metrics := NewMetrics()
	metrics.ObserveReadiness(true)
	metrics.ObserveReadiness(false)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(rec, req)

	body := rec.Body.String()
	for _, fragment := range []string{
		"crawler_process_uptime_seconds",
		"crawler_readiness_checks_total 2",
		"crawler_readiness_failures_total 1",
	} {
		if !strings.Contains(body, fragment) {
			t.Fatalf("metrics body = %s, missing %s", body, fragment)
		}
	}
}
