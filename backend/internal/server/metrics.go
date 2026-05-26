package server

import (
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Metrics struct {
	startedAt       time.Time
	requestTotal    atomic.Uint64
	requestDuration atomic.Int64
	statusCounts    sync.Map
	routeCounts     sync.Map
}

func NewMetrics() *Metrics {
	return &Metrics{startedAt: time.Now().UTC()}
}

func (m *Metrics) ObserveHTTP(route, method string, status int, duration time.Duration) {
	if m == nil {
		return
	}
	m.requestTotal.Add(1)
	m.requestDuration.Add(duration.Milliseconds())
	incrementSyncCounter(&m.statusCounts, fmt.Sprintf("%d", status))
	incrementSyncCounter(&m.routeCounts, method+" "+route)
}

func (m *Metrics) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		total := m.requestTotal.Load()
		durationTotal := m.requestDuration.Load()
		uptimeSeconds := int64(time.Since(m.startedAt).Seconds())
		_, _ = fmt.Fprintf(w, "# HELP backend_http_requests_total Total backend HTTP requests observed by Stage 0 middleware.\n")
		_, _ = fmt.Fprintf(w, "# TYPE backend_http_requests_total counter\n")
		_, _ = fmt.Fprintf(w, "backend_http_requests_total %d\n", total)
		_, _ = fmt.Fprintf(w, "# HELP backend_http_request_duration_ms_total Total backend HTTP request duration in milliseconds.\n")
		_, _ = fmt.Fprintf(w, "# TYPE backend_http_request_duration_ms_total counter\n")
		_, _ = fmt.Fprintf(w, "backend_http_request_duration_ms_total %d\n", durationTotal)
		_, _ = fmt.Fprintf(w, "# HELP backend_process_uptime_seconds Backend process uptime in seconds.\n")
		_, _ = fmt.Fprintf(w, "# TYPE backend_process_uptime_seconds gauge\n")
		_, _ = fmt.Fprintf(w, "backend_process_uptime_seconds %d\n", uptimeSeconds)
		writeSyncMapCounters(w, "backend_http_requests_by_status_total", "Backend HTTP requests by response status.", "status", &m.statusCounts)
		writeSyncMapCounters(w, "backend_http_requests_by_route_total", "Backend HTTP requests by normalized route.", "route", &m.routeCounts)
	})
}

func incrementSyncCounter(values *sync.Map, key string) {
	actual, _ := values.LoadOrStore(key, new(atomic.Uint64))
	actual.(*atomic.Uint64).Add(1)
}

func writeSyncMapCounters(w http.ResponseWriter, name, help, label string, values *sync.Map) {
	keys := []string{}
	values.Range(func(key, _ any) bool {
		keys = append(keys, key.(string))
		return true
	})
	sort.Strings(keys)
	_, _ = fmt.Fprintf(w, "# HELP %s %s\n", name, help)
	_, _ = fmt.Fprintf(w, "# TYPE %s counter\n", name)
	for _, key := range keys {
		value, _ := values.Load(key)
		_, _ = fmt.Fprintf(w, "%s{%s=%q} %d\n", name, label, sanitizeMetricLabel(key), value.(*atomic.Uint64).Load())
	}
}

func sanitizeMetricLabel(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "\n", "\\n")
	value = strings.ReplaceAll(value, "\"", "\\\"")
	return value
}
