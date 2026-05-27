package main

import (
	"context"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/stage0"
)

type fakeCleanupService struct {
	called bool
	limit  int
	result stage0.CleanupResult
}

func (s *fakeCleanupService) CleanupExpiredExportsAndOrphanedObjects(_ context.Context, now time.Time, limit int) (stage0.CleanupResult, error) {
	s.called = true
	s.limit = limit
	if now.IsZero() {
		return stage0.CleanupResult{}, context.Canceled
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
	service := &fakeCleanupService{result: stage0.CleanupResult{ExpiredExports: 1, OrphanedObjects: 2, DeletedObjects: 3}}
	logger := &fakeCleanupLogger{}

	runCleanupOnce(context.Background(), service, logger, time.Second, 250)

	if !service.called {
		t.Fatalf("cleanup service was not called")
	}
	if service.limit != 250 {
		t.Fatalf("cleanup limit = %d, want 250", service.limit)
	}
	if logger.infos != 1 || logger.errors != 0 {
		t.Fatalf("logger info/errors = %d/%d, want 1/0", logger.infos, logger.errors)
	}
}

func TestRunCleanupOnceFallsBackToSafeDefaults(t *testing.T) {
	service := &fakeCleanupService{}
	logger := &fakeCleanupLogger{}

	runCleanupOnce(context.Background(), service, logger, 0, 0)

	if service.limit != 100 {
		t.Fatalf("cleanup limit = %d, want fallback 100", service.limit)
	}
	if logger.infos != 1 || logger.errors != 0 {
		t.Fatalf("logger info/errors = %d/%d, want 1/0", logger.infos, logger.errors)
	}
}
