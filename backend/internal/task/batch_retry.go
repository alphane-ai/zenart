package task

import "strings"

func batchFailureAllowsRetry(code string) bool {
	switch strings.ToLower(strings.TrimSpace(code)) {
	case "",
		"provider_request_invalid",
		"provider_usage_record_failed",
		"result_sink_unavailable",
		"result_persistence_failed",
		"result_persistence_missing_ids",
		"quota_insufficient",
		"provider_quota_unavailable",
		"safety_rejected",
		"safety_review_required",
		"content_blocked":
		return false
	default:
		return true
	}
}

func providerResponseStatusAllowsRetry(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "rate_limited",
		"timeout",
		"timed_out",
		"unavailable",
		"temporarily_unavailable",
		"overloaded",
		"transient_error",
		"failed_transient":
		return true
	case "succeeded", "success", "completed":
		return false
	default:
		return false
	}
}

func classifyBatchChildFailure(code string, metadata map[string]string) (bool, string) {
	normalizedCode := strings.ToLower(strings.TrimSpace(code))
	if normalizedCode == "provider_response_failed" {
		if providerResponseStatusAllowsRetry(metadata["provider_response_status"]) {
			return true, "provider_response_retryable"
		}
		return false, "provider_response_non_retryable"
	}
	if batchFailureAllowsRetry(normalizedCode) {
		return true, "retryable_failure"
	}
	return false, "non_retryable_failure"
}

func childFailureRetryable(child GenerationChildTask) bool {
	if child.Status != ChildStatusFailed || child.RetryCount >= child.MaxRetries {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(child.Metadata["retryable"]), "false") {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(child.Metadata["dead_letter_state"]), "dead_lettered") {
		return false
	}
	return batchFailureAllowsRetry(child.FailureCode)
}

func retryableBool(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
