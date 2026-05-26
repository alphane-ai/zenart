package worker

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
	claims          atomic.Uint64
	emptyPolls      atomic.Uint64
	claimErrors     atomic.Uint64
	drainedTasks    atomic.Uint64
	unsupported     atomic.Uint64
	claimDurations  atomic.Int64
	taskTypeClaims  sync.Map
	drainOperations atomic.Uint64
}

func NewMetrics() *Metrics {
	return &Metrics{startedAt: time.Now().UTC()}
}

func (m *Metrics) ObserveClaim(taskType string, duration time.Duration) {
	if m == nil {
		return
	}
	m.claims.Add(1)
	m.claimDurations.Add(duration.Milliseconds())
	incrementSyncCounter(&m.taskTypeClaims, taskType)
}

func (m *Metrics) ObserveEmptyPoll() {
	if m == nil {
		return
	}
	m.emptyPolls.Add(1)
}

func (m *Metrics) ObserveClaimError() {
	if m == nil {
		return
	}
	m.claimErrors.Add(1)
}

func (m *Metrics) ObserveUnsupportedTask() {
	if m == nil {
		return
	}
	m.unsupported.Add(1)
}

func (m *Metrics) ObserveDrain(tasks int64) {
	if m == nil {
		return
	}
	m.drainOperations.Add(1)
	if tasks > 0 {
		m.drainedTasks.Add(uint64(tasks))
	}
}

func (m *Metrics) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		uptimeSeconds := int64(time.Since(m.startedAt).Seconds())
		_, _ = fmt.Fprintf(w, "# HELP worker_process_uptime_seconds Worker process uptime in seconds.\n")
		_, _ = fmt.Fprintf(w, "# TYPE worker_process_uptime_seconds gauge\n")
		_, _ = fmt.Fprintf(w, "worker_process_uptime_seconds %d\n", uptimeSeconds)
		writeCounter(w, "worker_task_claims_total", "Worker task claims.", m.claims.Load())
		writeCounter(w, "worker_task_empty_polls_total", "Worker polls that found no claimable task.", m.emptyPolls.Load())
		writeCounter(w, "worker_task_claim_errors_total", "Worker task claim errors.", m.claimErrors.Load())
		writeCounter(w, "worker_task_claim_duration_ms_total", "Total worker task claim duration in milliseconds.", uint64(m.claimDurations.Load()))
		writeCounter(w, "worker_unsupported_task_claims_total", "Claimed tasks without a matching worker contract.", m.unsupported.Load())
		writeCounter(w, "worker_drain_operations_total", "Worker drain operations.", m.drainOperations.Load())
		writeCounter(w, "worker_drained_tasks_total", "Running tasks marked failed during worker drain.", m.drainedTasks.Load())
		writeSyncMapCounters(w, "worker_task_claims_by_type_total", "Worker task claims by task type.", "task_type", &m.taskTypeClaims)
	})
}

func writeCounter(w http.ResponseWriter, name, help string, value uint64) {
	_, _ = fmt.Fprintf(w, "# HELP %s %s\n", name, help)
	_, _ = fmt.Fprintf(w, "# TYPE %s counter\n", name)
	_, _ = fmt.Fprintf(w, "%s %d\n", name, value)
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
