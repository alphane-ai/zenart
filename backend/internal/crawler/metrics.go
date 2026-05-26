package crawler

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"time"
)

type Metrics struct {
	startedAt         time.Time
	readinessChecks   atomic.Uint64
	readinessFailures atomic.Uint64
}

func NewMetrics() *Metrics {
	return &Metrics{startedAt: time.Now().UTC()}
}

func (m *Metrics) ObserveReadiness(ok bool) {
	if m == nil {
		return
	}
	m.readinessChecks.Add(1)
	if !ok {
		m.readinessFailures.Add(1)
	}
}

func (m *Metrics) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		uptimeSeconds := int64(time.Since(m.startedAt).Seconds())
		_, _ = fmt.Fprintf(w, "# HELP crawler_process_uptime_seconds Crawler process uptime in seconds.\n")
		_, _ = fmt.Fprintf(w, "# TYPE crawler_process_uptime_seconds gauge\n")
		_, _ = fmt.Fprintf(w, "crawler_process_uptime_seconds %d\n", uptimeSeconds)
		_, _ = fmt.Fprintf(w, "# HELP crawler_readiness_checks_total Crawler dependency readiness checks.\n")
		_, _ = fmt.Fprintf(w, "# TYPE crawler_readiness_checks_total counter\n")
		_, _ = fmt.Fprintf(w, "crawler_readiness_checks_total %d\n", m.readinessChecks.Load())
		_, _ = fmt.Fprintf(w, "# HELP crawler_readiness_failures_total Crawler dependency readiness failures.\n")
		_, _ = fmt.Fprintf(w, "# TYPE crawler_readiness_failures_total counter\n")
		_, _ = fmt.Fprintf(w, "crawler_readiness_failures_total %d\n", m.readinessFailures.Load())
	})
}
