package ratelimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

type Scope string

const (
	ScopeUser        Scope = "user"
	ScopeTenant      Scope = "tenant"
	ScopeProvider    Scope = "provider"
	ScopeAdminAction Scope = "admin_action"
)

const (
	CodeAllowed                   = "allowed"
	CodeDisabled                  = "rate_limit_disabled"
	CodeRateLimitExceeded         = "rate_limit_exceeded"
	CodeDailySpendCapExceeded     = "daily_spend_cap_exceeded"
	CodeProviderKillSwitchEnabled = "provider_kill_switch_enabled"
)

type Store interface {
	Increment(ctx context.Context, key string, amount int64, window time.Duration, now time.Time) (Counter, error)
	Reserve(ctx context.Context, key string, amount int64, limit int64, window time.Duration, now time.Time) (Counter, bool, error)
}

type Counter struct {
	Value   int64
	ResetAt time.Time
}

type Policy struct {
	Enabled                       bool
	UserRequestsPerMinute         int64
	TenantRequestsPerMinute       int64
	ProviderRequestsPerMinute     int64
	AdminActionsPerMinute         int64
	ProviderDailySpendCapCents    int64
	ProviderEmergencyKillSwitch   bool
	ProviderSpendWindow           time.Duration
	ProviderSpendCapAppliesToCost bool
}

type Request struct {
	Scope      Scope
	TenantID   string
	UserID     string
	ProviderID string
	SubjectID  string
	Action     string
	CostCents  int64
	Now        time.Time
}

type Decision struct {
	Allowed           bool
	Code              string
	Message           string
	Scope             Scope
	TenantID          string
	UserID            string
	ProviderID        string
	SubjectID         string
	Action            string
	Limit             int64
	Observed          int64
	Remaining         int64
	CostCents         int64
	SpendCapCents     int64
	SpentCents        int64
	ResetAt           time.Time
	RetryAfterSeconds int64
	AuditRequired     bool
}

type Enforcer struct {
	store  Store
	policy Policy
	now    func() time.Time
}

func NewEnforcer(store Store, policy Policy) Enforcer {
	if store == nil {
		store = NewMemoryStore()
	}
	if policy.ProviderSpendWindow == 0 {
		policy.ProviderSpendWindow = 24 * time.Hour
	}
	return Enforcer{
		store:  store,
		policy: policy,
		now: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func (e Enforcer) WithNow(now func() time.Time) Enforcer {
	if now == nil {
		return e
	}
	e.now = now
	return e
}

func (e Enforcer) Policy() Policy {
	return e.policy
}

func (e Enforcer) Check(ctx context.Context, req Request) (Decision, error) {
	now := req.Now
	if now.IsZero() {
		now = e.now()
	}
	now = now.UTC()
	decision := Decision{
		Allowed:       true,
		Code:          CodeAllowed,
		Message:       "request is allowed",
		Scope:         req.Scope,
		TenantID:      strings.TrimSpace(req.TenantID),
		UserID:        strings.TrimSpace(req.UserID),
		ProviderID:    strings.TrimSpace(req.ProviderID),
		Action:        strings.TrimSpace(req.Action),
		CostCents:     req.CostCents,
		AuditRequired: req.Scope == ScopeAdminAction,
	}
	if !e.policy.Enabled {
		decision.Code = CodeDisabled
		decision.Message = "rate limit enforcement is disabled"
		return decision, nil
	}
	if req.CostCents < 0 {
		return Decision{}, errors.New("cost_cents must be non-negative")
	}
	if decision.Action == "" {
		return Decision{}, errors.New("action is required")
	}
	subjectID := strings.TrimSpace(req.SubjectID)
	if subjectID == "" {
		subjectID = subjectForScope(req)
	}
	if subjectID == "" {
		return Decision{}, fmt.Errorf("%s subject id is required", req.Scope)
	}
	decision.SubjectID = subjectID

	limit, window, err := e.ratePolicy(req.Scope)
	if err != nil {
		return Decision{}, err
	}
	if limit > 0 {
		counter, err := e.store.Increment(ctx, rateKey(req.Scope, subjectID, decision.Action), 1, window, now)
		if err != nil {
			return Decision{}, err
		}
		decision.Limit = limit
		decision.Observed = counter.Value
		decision.Remaining = maxInt64(0, limit-counter.Value)
		decision.ResetAt = counter.ResetAt
		decision.RetryAfterSeconds = retryAfterSeconds(now, counter.ResetAt)
		if counter.Value > limit {
			decision.Allowed = false
			decision.Code = CodeRateLimitExceeded
			decision.Message = "request rate limit exceeded"
			return decision, nil
		}
	}

	if decision.ProviderID != "" || req.Scope == ScopeProvider {
		if e.policy.ProviderEmergencyKillSwitch {
			decision.Allowed = false
			decision.Code = CodeProviderKillSwitchEnabled
			decision.Message = "provider emergency kill switch is enabled"
			decision.SpendCapCents = e.policy.ProviderDailySpendCapCents
			decision.ResetAt = dailyResetAt(now)
			decision.RetryAfterSeconds = retryAfterSeconds(now, decision.ResetAt)
			return decision, nil
		}
		if e.policy.ProviderDailySpendCapCents > 0 && req.CostCents > 0 {
			window := e.policy.ProviderSpendWindow
			if window == 0 {
				window = 24 * time.Hour
			}
			providerSubject := decision.ProviderID
			if providerSubject == "" {
				providerSubject = subjectID
			}
			counter, ok, err := e.store.Reserve(
				ctx,
				spendKey(providerSubject, now),
				req.CostCents,
				e.policy.ProviderDailySpendCapCents,
				window,
				now,
			)
			if err != nil {
				return Decision{}, err
			}
			decision.SpendCapCents = e.policy.ProviderDailySpendCapCents
			decision.SpentCents = counter.Value
			decision.ResetAt = counter.ResetAt
			decision.RetryAfterSeconds = retryAfterSeconds(now, counter.ResetAt)
			decision.Remaining = maxInt64(0, e.policy.ProviderDailySpendCapCents-counter.Value)
			if !ok {
				decision.Allowed = false
				decision.Code = CodeDailySpendCapExceeded
				decision.Message = "provider daily spend cap exceeded"
				return decision, nil
			}
		}
	}

	return decision, nil
}

func (e Enforcer) ratePolicy(scope Scope) (int64, time.Duration, error) {
	switch scope {
	case ScopeUser:
		return e.policy.UserRequestsPerMinute, time.Minute, nil
	case ScopeTenant:
		return e.policy.TenantRequestsPerMinute, time.Minute, nil
	case ScopeProvider:
		return e.policy.ProviderRequestsPerMinute, time.Minute, nil
	case ScopeAdminAction:
		return e.policy.AdminActionsPerMinute, time.Minute, nil
	default:
		return 0, 0, fmt.Errorf("unsupported rate limit scope %q", scope)
	}
}

func subjectForScope(req Request) string {
	switch req.Scope {
	case ScopeUser, ScopeAdminAction:
		return strings.TrimSpace(req.UserID)
	case ScopeTenant:
		return strings.TrimSpace(req.TenantID)
	case ScopeProvider:
		return strings.TrimSpace(req.ProviderID)
	default:
		return ""
	}
}

func AuditMetadata(decision Decision) map[string]any {
	metadata := map[string]any{
		"rate_limit_code":        decision.Code,
		"allowed":                decision.Allowed,
		"scope":                  string(decision.Scope),
		"subject_id":             decision.SubjectID,
		"tenant_id":              decision.TenantID,
		"user_id":                decision.UserID,
		"provider_id":            decision.ProviderID,
		"action":                 decision.Action,
		"limit":                  decision.Limit,
		"observed":               decision.Observed,
		"remaining":              decision.Remaining,
		"cost_cents":             decision.CostCents,
		"spent_cents":            decision.SpentCents,
		"spend_cap_cents":        decision.SpendCapCents,
		"retry_after_seconds":    decision.RetryAfterSeconds,
		"audit_required":         decision.AuditRequired,
		"raw_prompt_included":    false,
		"raw_provider_payload":   false,
		"raw_secret_projection":  false,
		"enforcement_contract":   "stage1.rate_limit_spend_cap.v1",
		"explainable_error_code": decision.Code,
	}
	if !decision.ResetAt.IsZero() {
		metadata["reset_at"] = decision.ResetAt.UTC().Format(time.RFC3339)
	}
	return security.RedactMap(metadata)
}

func PublicErrorDetails(decision Decision) map[string]any {
	details := map[string]any{
		"scope":               string(decision.Scope),
		"action":              decision.Action,
		"limit":               decision.Limit,
		"observed":            decision.Observed,
		"remaining":           decision.Remaining,
		"cost_cents":          decision.CostCents,
		"spend_cap_cents":     decision.SpendCapCents,
		"retry_after_seconds": decision.RetryAfterSeconds,
	}
	if !decision.ResetAt.IsZero() {
		details["reset_at"] = decision.ResetAt.UTC().Format(time.RFC3339)
	}
	return details
}

func HTTPStatus(decision Decision) int {
	switch decision.Code {
	case CodeRateLimitExceeded:
		return http.StatusTooManyRequests
	case CodeDailySpendCapExceeded, CodeProviderKillSwitchEnabled:
		return http.StatusForbidden
	default:
		if decision.Allowed {
			return http.StatusOK
		}
		return http.StatusTooManyRequests
	}
}

type MemoryStore struct {
	mu       sync.Mutex
	counters map[string]Counter
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{counters: map[string]Counter{}}
}

func (s *MemoryStore) Increment(_ context.Context, key string, amount int64, window time.Duration, now time.Time) (Counter, error) {
	if err := validateCounterInput(key, amount, window); err != nil {
		return Counter{}, err
	}
	now = now.UTC()
	resetAt := windowResetAt(now, window)
	s.mu.Lock()
	defer s.mu.Unlock()
	counter := s.counters[key]
	if counter.ResetAt.IsZero() || !counter.ResetAt.After(now) {
		counter = Counter{ResetAt: resetAt}
	}
	counter.Value += amount
	counter.ResetAt = resetAt
	s.counters[key] = counter
	return counter, nil
}

func (s *MemoryStore) Reserve(_ context.Context, key string, amount int64, limit int64, window time.Duration, now time.Time) (Counter, bool, error) {
	if err := validateCounterInput(key, amount, window); err != nil {
		return Counter{}, false, err
	}
	if limit <= 0 {
		return Counter{}, false, errors.New("limit must be positive")
	}
	now = now.UTC()
	resetAt := windowResetAt(now, window)
	s.mu.Lock()
	defer s.mu.Unlock()
	counter := s.counters[key]
	if counter.ResetAt.IsZero() || !counter.ResetAt.After(now) {
		counter = Counter{ResetAt: resetAt}
	}
	if counter.Value+amount > limit {
		counter.ResetAt = resetAt
		s.counters[key] = counter
		return counter, false, nil
	}
	counter.Value += amount
	counter.ResetAt = resetAt
	s.counters[key] = counter
	return counter, true, nil
}

type RedisStore struct {
	Client    redis.Cmdable
	KeyPrefix string
}

func (s RedisStore) Increment(ctx context.Context, key string, amount int64, window time.Duration, now time.Time) (Counter, error) {
	if err := validateCounterInput(key, amount, window); err != nil {
		return Counter{}, err
	}
	if s.Client == nil {
		return Counter{}, errors.New("redis client is required")
	}
	now = now.UTC()
	resetAt := windowResetAt(now, window)
	redisKey := s.redisKey(key)
	pipe := s.Client.Pipeline()
	incr := pipe.IncrBy(ctx, redisKey, amount)
	pipe.ExpireAt(ctx, redisKey, resetAt)
	if _, err := pipe.Exec(ctx); err != nil {
		return Counter{}, err
	}
	return Counter{Value: incr.Val(), ResetAt: resetAt}, nil
}

func (s RedisStore) Reserve(ctx context.Context, key string, amount int64, limit int64, window time.Duration, now time.Time) (Counter, bool, error) {
	if err := validateCounterInput(key, amount, window); err != nil {
		return Counter{}, false, err
	}
	if limit <= 0 {
		return Counter{}, false, errors.New("limit must be positive")
	}
	if s.Client == nil {
		return Counter{}, false, errors.New("redis client is required")
	}
	now = now.UTC()
	resetAt := windowResetAt(now, window)
	result, err := reserveScript.Run(ctx, s.Client, []string{s.redisKey(key)}, amount, limit, resetAt.Unix()).Slice()
	if err != nil {
		return Counter{}, false, err
	}
	if len(result) != 2 {
		return Counter{}, false, errors.New("redis reserve script returned unexpected result")
	}
	allowed, err := redisInt64(result[0])
	if err != nil {
		return Counter{}, false, err
	}
	value, err := redisInt64(result[1])
	if err != nil {
		return Counter{}, false, err
	}
	return Counter{Value: value, ResetAt: resetAt}, allowed == 1, nil
}

func (s RedisStore) redisKey(key string) string {
	prefix := strings.TrimSpace(s.KeyPrefix)
	if prefix == "" {
		prefix = "zenari:ratelimit"
	}
	return prefix + ":" + key
}

var reserveScript = redis.NewScript(`
local current = tonumber(redis.call("GET", KEYS[1]) or "0")
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local reset_at = tonumber(ARGV[3])
if current + amount > limit then
  redis.call("EXPIREAT", KEYS[1], reset_at)
  return {0, current}
end
current = current + amount
redis.call("SET", KEYS[1], current, "EXAT", reset_at)
return {1, current}
`)

func redisInt64(value any) (int64, error) {
	switch typed := value.(type) {
	case int64:
		return typed, nil
	case int:
		return int64(typed), nil
	case string:
		var parsed int64
		_, err := fmt.Sscan(typed, &parsed)
		return parsed, err
	default:
		return 0, fmt.Errorf("unexpected redis integer type %T", value)
	}
}

func validateCounterInput(key string, amount int64, window time.Duration) error {
	if strings.TrimSpace(key) == "" {
		return errors.New("counter key is required")
	}
	if amount <= 0 {
		return errors.New("counter amount must be positive")
	}
	if window <= 0 {
		return errors.New("counter window must be positive")
	}
	return nil
}

var safeKeySegmentPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]+$`)

func rateKey(scope Scope, subjectID, action string) string {
	return strings.Join([]string{
		"rate",
		safeSegment(string(scope)),
		safeSegment(subjectID),
		safeSegment(action),
	}, ":")
}

func spendKey(providerID string, now time.Time) string {
	return strings.Join([]string{
		"spend",
		safeSegment(providerID),
		now.UTC().Format("20060102"),
	}, ":")
}

func safeSegment(value string) string {
	value = strings.TrimSpace(value)
	if value != "" && safeKeySegmentPattern.MatchString(value) {
		return value
	}
	sum := sha256.Sum256([]byte(value))
	return "sha256-" + hex.EncodeToString(sum[:])[:24]
}

func windowResetAt(now time.Time, window time.Duration) time.Time {
	now = now.UTC()
	if window == 24*time.Hour {
		return dailyResetAt(now)
	}
	windowNanos := window.Nanoseconds()
	nowNanos := now.UnixNano()
	start := nowNanos / windowNanos * windowNanos
	return time.Unix(0, start+windowNanos).UTC()
}

func dailyResetAt(now time.Time) time.Time {
	now = now.UTC()
	return time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
}

func retryAfterSeconds(now, resetAt time.Time) int64 {
	if resetAt.IsZero() || !resetAt.After(now) {
		return 0
	}
	seconds := int64(resetAt.Sub(now).Seconds())
	if seconds <= 0 {
		return 1
	}
	return seconds
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
