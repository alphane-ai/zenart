package api

import (
	"net/http"
	"strings"
)

type ErrorCategory string

const (
	ErrorCategoryValidation          ErrorCategory = "validation"
	ErrorCategoryAuth                ErrorCategory = "auth"
	ErrorCategoryForbidden           ErrorCategory = "forbidden"
	ErrorCategoryNotFound            ErrorCategory = "not_found"
	ErrorCategoryConflict            ErrorCategory = "conflict"
	ErrorCategoryRetryable           ErrorCategory = "retryable"
	ErrorCategoryBlocked             ErrorCategory = "blocked"
	ErrorCategoryQuotaInsufficient   ErrorCategory = "quota_insufficient"
	ErrorCategoryProviderUnavailable ErrorCategory = "provider_unavailable"
	ErrorCategoryReviewRequired      ErrorCategory = "review_required"
	ErrorCategoryInternal            ErrorCategory = "internal"
)

type ErrorTaxonomy struct {
	Category       ErrorCategory `json:"category"`
	Retryable      bool          `json:"retryable"`
	Blocked        bool          `json:"blocked"`
	UserActionable bool          `json:"user_actionable"`
}

func ClassifyError(status int, code string) ErrorTaxonomy {
	normalized := strings.ToLower(strings.TrimSpace(code))
	category := categoryFor(status, normalized)
	return ErrorTaxonomy{
		Category:       category,
		Retryable:      retryable(category, status, normalized),
		Blocked:        blocked(category),
		UserActionable: userActionable(category, status, normalized),
	}
}

func (t ErrorTaxonomy) Map() map[string]any {
	return map[string]any{
		"category":        string(t.Category),
		"retryable":       t.Retryable,
		"blocked":         t.Blocked,
		"user_actionable": t.UserActionable,
	}
}

func categoryFor(status int, code string) ErrorCategory {
	switch {
	case strings.Contains(code, "quota_insufficient") || strings.Contains(code, "quota_unavailable") || strings.Contains(code, "seat_limit_exceeded"):
		return ErrorCategoryQuotaInsufficient
	case strings.Contains(code, "provider_unavailable") || strings.Contains(code, "provider_rate_limited") || strings.Contains(code, "provider_timeout"):
		return ErrorCategoryProviderUnavailable
	case strings.Contains(code, "review_required") || strings.Contains(code, "safety_review") || strings.Contains(code, "manual_review"):
		return ErrorCategoryReviewRequired
	case strings.Contains(code, "blocked") || strings.Contains(code, "kill_switch") || strings.Contains(code, "spend_cap") || strings.Contains(code, "csrf_") || strings.Contains(code, "tenant_denied"):
		return ErrorCategoryBlocked
	case strings.Contains(code, "retryable") || strings.Contains(code, "temporarily_unavailable") || strings.Contains(code, "rate_limit"):
		return ErrorCategoryRetryable
	case status == http.StatusUnauthorized:
		return ErrorCategoryAuth
	case status == http.StatusForbidden:
		return ErrorCategoryForbidden
	case status == http.StatusNotFound:
		return ErrorCategoryNotFound
	case status == http.StatusConflict:
		return ErrorCategoryConflict
	case status == http.StatusPaymentRequired:
		return ErrorCategoryQuotaInsufficient
	case status == http.StatusTooManyRequests || status == http.StatusBadGateway || status == http.StatusServiceUnavailable || status == http.StatusGatewayTimeout:
		return ErrorCategoryRetryable
	case status >= 500:
		return ErrorCategoryInternal
	case status == http.StatusBadRequest:
		return ErrorCategoryValidation
	default:
		return ErrorCategoryInternal
	}
}

func retryable(category ErrorCategory, status int, code string) bool {
	if category == ErrorCategoryProviderUnavailable || category == ErrorCategoryRetryable {
		return true
	}
	if strings.Contains(code, "kill_switch") || strings.Contains(code, "spend_cap") {
		return false
	}
	return status == http.StatusTooManyRequests || status == http.StatusBadGateway || status == http.StatusServiceUnavailable || status == http.StatusGatewayTimeout
}

func blocked(category ErrorCategory) bool {
	return category == ErrorCategoryBlocked || category == ErrorCategoryReviewRequired || category == ErrorCategoryQuotaInsufficient
}

func userActionable(category ErrorCategory, status int, code string) bool {
	switch category {
	case ErrorCategoryValidation, ErrorCategoryAuth, ErrorCategoryForbidden, ErrorCategoryQuotaInsufficient, ErrorCategoryReviewRequired:
		return true
	case ErrorCategoryBlocked:
		return !strings.Contains(code, "csrf_")
	case ErrorCategoryRetryable, ErrorCategoryProviderUnavailable:
		return status == http.StatusTooManyRequests
	default:
		return false
	}
}
