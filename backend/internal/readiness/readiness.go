package readiness

import (
	"context"
	"fmt"
	"sort"
	"time"
)

type Status string

const (
	StatusOK   Status = "ok"
	StatusFail Status = "fail"
)

type Check struct {
	Name    string
	Timeout time.Duration
	Run     func(context.Context) error
}

type Result struct {
	Name      string `json:"name"`
	Status    Status `json:"status"`
	LatencyMS int64  `json:"latency_ms"`
	Error     string `json:"error,omitempty"`
}

type Report struct {
	Status Status   `json:"status"`
	Checks []Result `json:"checks"`
}

type Checker struct {
	checks []Check
}

func New(checks ...Check) Checker {
	return Checker{checks: checks}
}

func (c Checker) Run(ctx context.Context) Report {
	results := make([]Result, 0, len(c.checks))
	overall := StatusOK

	for _, check := range c.checks {
		result := runCheck(ctx, check)
		if result.Status != StatusOK {
			overall = StatusFail
		}
		results = append(results, result)
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return Report{Status: overall, Checks: results}
}

func runCheck(parent context.Context, check Check) Result {
	started := time.Now()
	timeout := check.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}

	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	result := Result{Name: check.Name, Status: StatusOK}
	if check.Run == nil {
		result.Status = StatusFail
		result.Error = "readiness check is not configured"
		result.LatencyMS = time.Since(started).Milliseconds()
		return result
	}

	if err := check.Run(ctx); err != nil {
		result.Status = StatusFail
		result.Error = err.Error()
	}
	result.LatencyMS = time.Since(started).Milliseconds()
	return result
}

func Required(name string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s unavailable: %w", name, err)
}
