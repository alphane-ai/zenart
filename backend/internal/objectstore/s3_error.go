package objectstore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/alphane-ai/zenart/backend/internal/security"
)

const s3ErrorBodyLimit = 64 << 10

type s3XMLErrorResponse struct {
	Code      string `xml:"Code"`
	Message   string `xml:"Message"`
	RequestID string `xml:"RequestId"`
	RequestId string `xml:"RequestID"`
}

type s3JSONErrorResponse struct {
	Code      string `json:"Code"`
	Message   string `json:"Message"`
	RequestID string `json:"RequestId"`
	RequestId string `json:"RequestID"`
	Error     struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
		RequestId string `json:"requestId"`
	} `json:"error"`
}

func readS3ErrorBody(resp *http.Response) []byte {
	if resp == nil || resp.Body == nil {
		return nil
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, s3ErrorBodyLimit))
	if err != nil {
		return nil
	}
	return body
}

func s3ErrorSummary(resp *http.Response, body []byte) string {
	statusCode := 0
	var headers http.Header
	if resp != nil {
		statusCode = resp.StatusCode
		headers = resp.Header
	}
	sum := sha256.Sum256(body)
	parts := []string{
		fmt.Sprintf("http_status=%d", statusCode),
		"body_sha256=" + hex.EncodeToString(sum[:8]),
	}
	headerRequestID := safeS3ErrorToken(firstNonEmptyS3(
		headers.Get("X-Amz-Request-Id"),
		headers.Get("X-Amz-Request-ID"),
		headers.Get("X-Amz-Requestid"),
	))
	bodyCode, bodyMessage, bodyRequestID := s3ErrorDetails(body)
	if headerRequestID == "" {
		headerRequestID = bodyRequestID
	}
	if headerRequestID != "" {
		parts = append(parts, "request_id="+headerRequestID)
	}
	if cfRay := safeS3ErrorToken(headers.Get("Cf-Ray")); cfRay != "" {
		parts = append(parts, "cf_ray="+cfRay)
	}
	if hostID := safeS3ErrorToken(headers.Get("X-Amz-Id-2")); hostID != "" {
		parts = append(parts, "host_id="+hostID)
	}
	if bodyCode != "" {
		parts = append(parts, "code="+bodyCode)
	}
	if bodyMessage != "" {
		parts = append(parts, "message="+bodyMessage)
	}
	return strings.Join(parts, " ")
}

func s3ErrorDetails(body []byte) (string, string, string) {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return "", "", ""
	}

	var xmlErr s3XMLErrorResponse
	if err := xml.Unmarshal([]byte(trimmed), &xmlErr); err == nil {
		code := safeS3ErrorToken(xmlErr.Code)
		message := safeS3ErrorMessage(xmlErr.Message)
		requestID := safeS3ErrorToken(firstNonEmptyS3(xmlErr.RequestID, xmlErr.RequestId))
		if code != "" || message != "" || requestID != "" {
			return code, message, requestID
		}
	}

	var jsonErr s3JSONErrorResponse
	if err := json.Unmarshal([]byte(trimmed), &jsonErr); err == nil {
		code := firstNonEmptyS3(jsonErr.Code, jsonErr.Error.Code)
		message := firstNonEmptyS3(jsonErr.Message, jsonErr.Error.Message)
		requestID := firstNonEmptyS3(jsonErr.RequestID, jsonErr.RequestId, jsonErr.Error.RequestID, jsonErr.Error.RequestId)
		return safeS3ErrorToken(code), safeS3ErrorMessage(message), safeS3ErrorToken(requestID)
	}

	return "", "", ""
}

func safeS3ErrorMessage(value string) string {
	value = security.RedactString(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	if strings.Contains(value, security.Redacted) {
		return "redacted object storage details"
	}
	return truncateS3ErrorValue(strings.Join(strings.Fields(value), " "), 180)
}

func safeS3ErrorToken(value string) string {
	value = security.RedactString(strings.TrimSpace(value))
	if value == "" || strings.Contains(value, security.Redacted) {
		return ""
	}
	value = strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		case r == '_' || r == '-' || r == '.':
			return r
		default:
			return '_'
		}
	}, value)
	return truncateS3ErrorValue(value, 96)
}

func truncateS3ErrorValue(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	if limit <= 3 {
		return value[:limit]
	}
	return value[:limit-3] + "..."
}

func firstNonEmptyS3(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
