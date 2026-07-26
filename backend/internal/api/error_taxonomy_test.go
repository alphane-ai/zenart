package api

import (
	"net/http"
	"testing"
)

func TestClassifyErrorCoversStage1Taxonomy(t *testing.T) {
	cases := []struct {
		name       string
		status     int
		code       string
		category   ErrorCategory
		retryable  bool
		blocked    bool
		actionable bool
	}{
		{
			name:       "retryable rate limit",
			status:     http.StatusTooManyRequests,
			code:       "rate_limit_exceeded",
			category:   ErrorCategoryRetryable,
			retryable:  true,
			blocked:    false,
			actionable: true,
		},
		{
			name:       "blocked safety",
			status:     http.StatusConflict,
			code:       "safety_blocked",
			category:   ErrorCategoryBlocked,
			retryable:  false,
			blocked:    true,
			actionable: true,
		},
		{
			name:       "quota insufficient",
			status:     http.StatusPaymentRequired,
			code:       "batch_quota_insufficient",
			category:   ErrorCategoryQuotaInsufficient,
			retryable:  false,
			blocked:    true,
			actionable: true,
		},
		{
			name:       "provider quota unavailable",
			status:     http.StatusConflict,
			code:       "provider_quota_unavailable",
			category:   ErrorCategoryQuotaInsufficient,
			retryable:  false,
			blocked:    true,
			actionable: true,
		},
		{
			name:       "provider unavailable",
			status:     http.StatusBadGateway,
			code:       "provider_unavailable",
			category:   ErrorCategoryProviderUnavailable,
			retryable:  true,
			blocked:    false,
			actionable: false,
		},
		{
			name:       "review required",
			status:     http.StatusConflict,
			code:       "safety_review_required",
			category:   ErrorCategoryReviewRequired,
			retryable:  false,
			blocked:    true,
			actionable: true,
		},
		{
			name:       "provider kill switch is blocked not retryable",
			status:     http.StatusForbidden,
			code:       "provider_kill_switch_enabled",
			category:   ErrorCategoryBlocked,
			retryable:  false,
			blocked:    true,
			actionable: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyError(tc.status, tc.code)
			if got.Category != tc.category || got.Retryable != tc.retryable || got.Blocked != tc.blocked || got.UserActionable != tc.actionable {
				t.Fatalf("ClassifyError(%d, %q) = %#v", tc.status, tc.code, got)
			}
			asMap := got.Map()
			if asMap["category"] != string(tc.category) || asMap["retryable"] != tc.retryable || asMap["blocked"] != tc.blocked || asMap["user_actionable"] != tc.actionable {
				t.Fatalf("Map() = %#v", asMap)
			}
		})
	}
}
