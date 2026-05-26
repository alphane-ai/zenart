package main

import (
	"context"
	"testing"
	"time"

	"github.com/alphane-ai/zenart/backend/internal/stage0"
)

type fakeCleanupService struct {
	called bool
	result stage0.CleanupResult
}

func (s *fakeCleanupService) CleanupExpiredExportsAndOrphanedObjects(_ context.Context, now time.Time, limit int) (stage0.CleanupResult, error) {
	s.called = true
	if now.IsZero() {
		return stage0.CleanupResult{}, context.Canceled
	}
	if limit != 100 {
		return stage0.CleanupResult{}, context.DeadlineExceeded
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

	runCleanupOnce(context.Background(), service, logger)

	if !service.called {
		t.Fatalf("cleanup service was not called")
	}
	if logger.infos != 1 || logger.errors != 0 {
		t.Fatalf("logger info/errors = %d/%d, want 1/0", logger.infos, logger.errors)
	}
}
