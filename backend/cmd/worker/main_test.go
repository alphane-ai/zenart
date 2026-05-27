package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/stage0"
	"github.com/alphane-ai/zenart/backend/internal/worker"
)

type fakeCleanupService struct {
	called bool
	limit  int
	result stage0.CleanupResult
	err    error
}

func (s *fakeCleanupService) CleanupExpiredExportsAndOrphanedObjects(_ context.Context, now time.Time, limit int) (stage0.CleanupResult, error) {
	s.called = true
	s.limit = limit
	if now.IsZero() {
		return stage0.CleanupResult{}, context.Canceled
	}
	if s.err != nil {
		return s.result, s.err
	}
	return s.result, nil
}

type fakeCleanupLogger struct {
	infos  int
	errors int
}

func (l *fakeCleanupLogger) Info(string, ...any) {
	l.infos++
}

func (l *fakeCleanupLogger) Error(string, ...any) {
	l.errors++
}

func TestRunCleanupOnceInvokesService(t *testing.T) {
	service := &fakeCleanupService{result: stage0.CleanupResult{ExpiredExports: 1, OrphanedObjects: 2, DeletedObjects: 3, FailedObjects: 4}}
	logger := &fakeCleanupLogger{}
	metrics := worker.NewMetrics()

	runCleanupOnce(context.Background(), service, logger, metrics, time.Second, 250)

	if !service.called {
		t.Fatalf("cleanup service was not called")
	}
	if service.limit != 250 {
		t.Fatalf("cleanup limit = %d, want 250", service.limit)
	}
	if logger.infos != 1 || logger.errors != 0 {
		t.Fatalf("logger info/errors = %d/%d, want 1/0", logger.infos, logger.errors)
	}
	body := renderWorkerMetrics(t, metrics)
	for _, fragment := range []string{
		"worker_cleanup_runs_total 1",
		"worker_cleanup_failures_total 0",
		"worker_cleanup_expired_exports_total 1",
		"worker_cleanup_orphaned_objects_total 2",
		"worker_cleanup_deleted_objects_total 3",
		"worker_cleanup_failed_objects_total 4",
	} {
		if !strings.Contains(body, fragment) {
			t.Fatalf("metrics body = %s, missing %s", body, fragment)
		}
	}
}

func TestRunCleanupOnceFallsBackToSafeDefaults(t *testing.T) {
	service := &fakeCleanupService{}
	logger := &fakeCleanupLogger{}

	runCleanupOnce(context.Background(), service, logger, nil, 0, 0)

	if service.limit != 100 {
		t.Fatalf("cleanup limit = %d, want fallback 100", service.limit)
	}
	if logger.infos != 1 || logger.errors != 0 {
		t.Fatalf("logger info/errors = %d/%d, want 1/0", logger.infos, logger.errors)
	}
}

func TestRunCleanupOnceRecordsFailureMetric(t *testing.T) {
	service := &fakeCleanupService{err: errors.New("cleanup failed")}
	logger := &fakeCleanupLogger{}
	metrics := worker.NewMetrics()

	runCleanupOnce(context.Background(), service, logger, metrics, time.Second, 25)

	if service.limit != 25 {
		t.Fatalf("cleanup limit = %d, want 25", service.limit)
	}
	if logger.infos != 0 || logger.errors != 1 {
		t.Fatalf("logger info/errors = %d/%d, want 0/1", logger.infos, logger.errors)
	}
	body := renderWorkerMetrics(t, metrics)
	for _, fragment := range []string{
		"worker_cleanup_runs_total 0",
		"worker_cleanup_failures_total 1",
		"worker_cleanup_deleted_objects_total 0",
	} {
		if !strings.Contains(body, fragment) {
			t.Fatalf("metrics body = %s, missing %s", body, fragment)
		}
	}
}

func TestRunCleanupOnceRecordsPartialFailureEvidence(t *testing.T) {
	service := &fakeCleanupService{
		result: stage0.CleanupResult{
			ExpiredExports:  1,
			OrphanedObjects: 2,
			DeletedObjects:  3,
			FailedObjects:   1,
			Status:          "partial_failed",
		},
		err: errors.New("s3 delete failed token=npm_abcdefghijklmnopqrstuvwxyz123456"),
	}
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	metrics := worker.NewMetrics()

	runCleanupOnce(context.Background(), service, logger, metrics, time.Second, 25)

	body := renderWorkerMetrics(t, metrics)
	for _, fragment := range []string{
		"worker_cleanup_runs_total 1",
		"worker_cleanup_failures_total 1",
		"worker_cleanup_expired_exports_total 1",
		"worker_cleanup_orphaned_objects_total 2",
		"worker_cleanup_deleted_objects_total 3",
		"worker_cleanup_failed_objects_total 1",
	} {
		if !strings.Contains(body, fragment) {
			t.Fatalf("metrics body = %s, missing %s", body, fragment)
		}
	}
	line := logs.String()
	for _, fragment := range []string{
		`"msg":"export object cleanup failed"`,
		`"expired_exports":1`,
		`"orphaned_objects":2`,
		`"deleted_objects":3`,
		`"failed_objects":1`,
		`"cleanup_status":"partial_failed"`,
	} {
		if !strings.Contains(line, fragment) {
			t.Fatalf("cleanup log = %s, missing %s", line, fragment)
		}
	}
	if strings.Contains(line, "npm_abcdefghijklmnopqrstuvwxyz123456") {
		t.Fatalf("cleanup log = %s, leaked secret token", line)
	}
	if !strings.Contains(line, "[REDACTED]") {
		t.Fatalf("cleanup log = %s, want redaction marker", line)
	}
}

func TestCleanupStatusFallsBackForErroredRuns(t *testing.T) {
	if got := cleanupStatus(stage0.CleanupResult{Status: "partial_failed"}); got != "partial_failed" {
		t.Fatalf("cleanupStatus() = %q, want partial_failed", got)
	}
	if got := cleanupStatus(stage0.CleanupResult{FailedObjects: 1}); got != "partial_failed" {
		t.Fatalf("cleanupStatus() = %q, want partial_failed", got)
	}
	if got := cleanupStatus(stage0.CleanupResult{}); got != "failed" {
		t.Fatalf("cleanupStatus() = %q, want failed", got)
	}
}

func renderWorkerMetrics(t *testing.T, metrics *worker.Metrics) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(rec, req)
	return rec.Body.String()
}
