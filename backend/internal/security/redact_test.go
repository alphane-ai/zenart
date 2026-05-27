package security

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestRedactMapRemovesNestedSecrets(t *testing.T) {
	redacted := RedactMap(map[string]any{
		"message": "ok",
		"api_key": "secret-value",
		"nested": map[string]any{
			"session_token": "token-value",
			"database_url":  "postgres://user:pass@localhost:5432/db",
		},
	})

	if redacted["message"] != "ok" {
		t.Fatalf("message = %v, want ok", redacted["message"])
	}
	if redacted["api_key"] != Redacted {
		t.Fatalf("api_key = %v, want redacted", redacted["api_key"])
	}
	nested := redacted["nested"].(map[string]any)
	if nested["session_token"] != Redacted {
		t.Fatalf("session_token = %v, want redacted", nested["session_token"])
	}
	if nested["database_url"] != Redacted {
		t.Fatalf("database_url = %v, want redacted", nested["database_url"])
	}
}

func TestRedactStringHandlesBearerAndAssignments(t *testing.T) {
	if got := RedactString("Bearer abc123"); got != "Bearer "+Redacted {
		t.Fatalf("bearer = %q, want redacted", got)
	}
	if got := RedactString("password=hunter2"); got != "password="+Redacted {
		t.Fatalf("assignment = %q, want redacted", got)
	}
}

func TestClassifyValueFindsNestedSecrets(t *testing.T) {
	findings := ClassifyValue(map[string]any{
		"public": "ok",
		"oauth": map[string]any{
			"client_secret": "secret",
			"note":          "Authorization: Bearer abcdefghijklmnop",
		},
		"items": []any{
			map[string]any{"dsn": "postgres://user:pass@localhost:5432/db"},
		},
	})

	if len(findings) < 4 {
		t.Fatalf("findings = %#v, want key and value classifications", findings)
	}
	assertFinding(t, findings, SecretKindCredential, "oauth.client_secret")
	assertFinding(t, findings, SecretKindAuthorization, "oauth.note")
	assertFinding(t, findings, SecretKindCredential, "items[0].dsn")
	assertFinding(t, findings, SecretKindDSN, "items[0].dsn")
}

func TestRedactStringHandlesProviderKeysAndInlineAssignments(t *testing.T) {
	input := `openai_api_key="sk-proj-abcdefghijklmnopqrstuvwxyz123456" ok stripe=rk_live_abcdefghijklmnop`
	got := RedactString(input)
	if got != `openai_api_key=`+Redacted+` ok stripe=`+Redacted {
		t.Fatalf("RedactString() = %q", got)
	}
}

func TestRedactStringCoversCloudAndProviderTokens(t *testing.T) {
	input := `google=AIza12345678901234567890123456789012345 anthropic=sk-ant-abcdefghijklmnopqrstuvwxyz123456 linear=lin_api_abcdefghijklmnopqrstuvwxyz azure=DefaultEndpointsProtocol=https;AccountName=zenart;AccountKey=abcdefghijklmnopqrstuvwxyz1234567890==`
	got := RedactString(input)
	if got != `google=`+Redacted+` anthropic=`+Redacted+` linear=`+Redacted+` azure=`+Redacted {
		t.Fatalf("RedactString() = %q", got)
	}
	findings := ClassifyString(input)
	assertSignal(t, findings, "google_api_key")
	assertSignal(t, findings, "anthropic_key")
	assertSignal(t, findings, "linear_key")
	assertSignal(t, findings, "azure_storage_key")
}

func TestRedactStringCoversAIStorageAndObservabilityTokens(t *testing.T) {
	input := strings.Join([]string{
		"hf=hf_abcdefghijklmnopqrstuvwxyz123456",
		"replicate=r8_abcdefghijklmnopqrstuvwxyz123456",
		"stability=sk-abcdefghijklmnopqrstuvwxyz1234567890",
		"groq=gsk_abcdefghijklmnopqrstuvwxyz123456",
		"together=tgp_v1_abcdefghijklmnopqrstuvwxyz123456",
		"pinecone=pcsk_abcdefghijklmnopqrstuvwxyz123456",
		"openrouter=sk-or-v1-abcdefghijklmnopqrstuvwxyz123456",
		"perplexity=pplx-abcdefghijklmnopqrstuvwxyz123456",
		"xai=xai-abcdefghijklmnopqrstuvwxyz123456",
		"fireworks=fw_abcdefghijklmnopqrstuvwxyz123456",
		"fal=fal-abcdefghijklmnopqrstuvwxyz123456",
		"elevenlabs=sk_abcdefghijklmnopqrstuvwxyz123456",
		"figma=figd_abcdefghijklmnopqrstuvwxyz123456",
		"notion=secret_abcdefghijklmnopqrstuvwxyz123456",
		"langsmith=lsv2_pt_abcdefghijklmnopqrstuvwxyz123456",
		"supabase=sb_abcdefghijklmnopqrstuvwxyz123456",
		"cloudflare=CFPAT_abcdefghijklmnopqrstuvwxyz123456",
		"datadog=dd_abcdefghijklmnopqrstuvwxyz123456",
		"sentry=sntrys_abcdefghijklmnopqrstuvwxyz123456",
		"posthog=phx_abcdefghijklmnopqrstuvwxyz123456",
		"grafana=glsa_abcdefghijklmnopqrstuvwxyz123456",
	}, " ")
	got := RedactString(input)
	for _, leaked := range []string{
		"hf_abcdefghijklmnopqrstuvwxyz123456",
		"r8_abcdefghijklmnopqrstuvwxyz123456",
		"sk-abcdefghijklmnopqrstuvwxyz1234567890",
		"gsk_abcdefghijklmnopqrstuvwxyz123456",
		"tgp_v1_abcdefghijklmnopqrstuvwxyz123456",
		"pcsk_abcdefghijklmnopqrstuvwxyz123456",
		"sk-or-v1-abcdefghijklmnopqrstuvwxyz123456",
		"pplx-abcdefghijklmnopqrstuvwxyz123456",
		"xai-abcdefghijklmnopqrstuvwxyz123456",
		"fw_abcdefghijklmnopqrstuvwxyz123456",
		"fal-abcdefghijklmnopqrstuvwxyz123456",
		"sk_abcdefghijklmnopqrstuvwxyz123456",
		"figd_abcdefghijklmnopqrstuvwxyz123456",
		"secret_abcdefghijklmnopqrstuvwxyz123456",
		"lsv2_pt_abcdefghijklmnopqrstuvwxyz123456",
		"sb_abcdefghijklmnopqrstuvwxyz123456",
		"CFPAT_abcdefghijklmnopqrstuvwxyz123456",
		"dd_abcdefghijklmnopqrstuvwxyz123456",
		"sntrys_abcdefghijklmnopqrstuvwxyz123456",
		"phx_abcdefghijklmnopqrstuvwxyz123456",
		"glsa_abcdefghijklmnopqrstuvwxyz123456",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	findings := ClassifyString(input)
	for _, signal := range []string{
		"huggingface_token",
		"replicate_token",
		"stability_key",
		"groq_key",
		"together_key",
		"pinecone_key",
		"openrouter_key",
		"perplexity_key",
		"xai_key",
		"fireworks_key",
		"fal_key",
		"elevenlabs_key",
		"figma_token",
		"notion_token",
		"langsmith_token",
		"supabase_jwt",
		"cloudflare_token",
		"datadog_key",
		"sentry_auth_token",
		"posthog_key",
		"grafana_service_account_token",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactMapCoversLaunchAnalyticsSupportAndIdentityMetadataKeys(t *testing.T) {
	metadata := map[string]any{
		"analytics": map[string]any{
			"posthog_project_api_key": "phc_abcdefghijklmnopqrstuvwxyz123456",
			"segment_write_key":       "segment-write-key-value",
			"amplitude_api_key":       "amplitude-secret-value",
			"mixpanel_token":          "mixpanel-secret-value",
			"launchdarkly_sdk_key":    "launchdarkly-sdk-secret",
		},
		"support": map[string]string{
			"pagerduty_routing_key": "pagerduty-routing-secret",
			"opsgenie_api_key":      "opsgenie-secret-value",
			"zendesk_api_token":     "zendesk-secret-value",
			"intercom_access_token": "intercom-secret-value",
		},
		"email": map[string]string{
			"resend_api_key":    "re_abcdefghijklmnopqrstuvwxyz123456",
			"postmark_api_key":  "postmark-secret-value",
			"mailchimp_api_key": "mailchimp-secret-value",
		},
		"identity": map[string]string{
			"clerk_secret_key":          "clerk-secret-value",
			"auth0_client_secret":       "auth0-secret-value",
			"firebase_server_key":       "AAAAabc1234:APA91babcdefghijklmnopqrstuvwxyz123456",
			"supabase_service_role_key": "supabase-secret-value",
		},
		"public": "ok",
	}

	redacted := RedactMap(metadata)
	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{
		"phc_abcdefghijklmnopqrstuvwxyz123456",
		"segment-write-key-value",
		"amplitude-secret-value",
		"mixpanel-secret-value",
		"launchdarkly-sdk-secret",
		"pagerduty-routing-secret",
		"opsgenie-secret-value",
		"zendesk-secret-value",
		"intercom-secret-value",
		"re_abcdefghijklmnopqrstuvwxyz123456",
		"postmark-secret-value",
		"mailchimp-secret-value",
		"clerk-secret-value",
		"auth0-secret-value",
		"AAAAabc1234:APA91babcdefghijklmnopqrstuvwxyz123456",
		"supabase-secret-value",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"public":"ok"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(metadata)
	for _, location := range []string{
		"analytics.posthog_project_api_key",
		"analytics.segment_write_key",
		"analytics.amplitude_api_key",
		"analytics.mixpanel_token",
		"analytics.launchdarkly_sdk_key",
		"support.pagerduty_routing_key",
		"support.opsgenie_api_key",
		"support.zendesk_api_token",
		"support.intercom_access_token",
		"email.resend_api_key",
		"email.postmark_api_key",
		"email.mailchimp_api_key",
		"identity.clerk_secret_key",
		"identity.auth0_client_secret",
		"identity.firebase_server_key",
		"identity.supabase_service_role_key",
	} {
		assertAnyFindingAt(t, findings, location)
	}
	assertSignal(t, findings, "resend_key")
	assertSignal(t, findings, "firebase_server_key")
}

func TestRedactStringCoversLaunchOpsAndCITokens(t *testing.T) {
	grafanaToken := "glc_" + strings.Repeat("A", 28)
	newRelicKey := "NRAK-" + strings.Repeat("B", 24)
	terraformToken := "abcdefghijklmn.atlasv1." + strings.Repeat("C", 44)
	snykToken := "snyk_" + strings.Repeat("D", 24)
	input := strings.Join([]string{
		"grafana=" + grafanaToken,
		"newrelic=" + newRelicKey,
		"terraform=" + terraformToken,
		"snyk=" + snykToken,
		"honeycomb_api_key=hcops-secret-value",
		"splunk_hec_token=splunk-secret-value",
		"OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=team-secret",
		"circleci_token=circle-secret-value",
		"buildkite_agent_token=buildkite-secret-value",
		"okta_client_secret=okta-secret-value",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		grafanaToken,
		newRelicKey,
		terraformToken,
		snykToken,
		"hcops-secret-value",
		"splunk-secret-value",
		"team-secret",
		"circle-secret-value",
		"buildkite-secret-value",
		"okta-secret-value",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if !strings.Contains(got, Redacted) {
		t.Fatalf("RedactString() = %q, want redaction marker", got)
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"grafana_cloud_token",
		"new_relic_key",
		"terraform_cloud_token",
		"snyk_token",
		"assignment:key_name",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactMapCoversLaunchOpsAndCISecretKeys(t *testing.T) {
	metadata := map[string]any{
		"observability": map[string]any{
			"newRelicLicenseKey": "newrelic-license-secret",
			"splunkHECToken":     "splunk-hec-secret",
			"honeycombTeam":      "honeycomb-team-secret",
			"otelHeaders":        "x-honeycomb-team=team-secret",
			"public_endpoint":    "https://otel.example.test/v1/traces",
		},
		"ci": map[string]string{
			"terraformCloudToken": "abcdefghijklmn.atlasv1." + strings.Repeat("C", 44),
			"snykToken":           "snyk_" + strings.Repeat("D", 24),
			"circleCIToken":       "circle-secret-value",
			"buildkiteAgentToken": "buildkite-secret-value",
		},
		"identity": map[string]string{
			"oktaClientSecret": "okta-secret-value",
		},
		"public": "visible",
	}

	body, err := json.Marshal(RedactValue(metadata))
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{
		"newrelic-license-secret",
		"splunk-hec-secret",
		"honeycomb-team-secret",
		"team-secret",
		"abcdefghijklmn.atlasv1.",
		"snyk_",
		"circle-secret-value",
		"buildkite-secret-value",
		"okta-secret-value",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"public":"visible"`, `"public_endpoint":"https://otel.example.test/v1/traces"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(metadata)
	for _, location := range []string{
		"observability.newRelicLicenseKey",
		"observability.splunkHECToken",
		"observability.honeycombTeam",
		"observability.otelHeaders",
		"ci.terraformCloudToken",
		"ci.snykToken",
		"ci.circleCIToken",
		"ci.buildkiteAgentToken",
		"identity.oktaClientSecret",
	} {
		assertAnyFindingAt(t, findings, location)
	}
}

func TestRedactStringCoversLaunchObservabilityWebhookSecrets(t *testing.T) {
	healthchecksURL := "https://hc-ping.com/abcdef12-3456-7890-abcd-ef1234567890"
	betterUptimeURL := "https://uptime.betterstack.com/api/v1/heartbeat/abc123def456ghi789jkl012"
	grafanaOncallURL := "https://oncall.example.test/integrations/v1/abc123def456ghi789jkl012"
	input := strings.Join([]string{
		"HEALTHCHECKS_PING_URL=" + healthchecksURL,
		"BETTER_UPTIME_HEARTBEAT_URL=" + betterUptimeURL,
		"GRAFANA_ONCALL_WEBHOOK_URL=" + grafanaOncallURL,
		"rollbar_access_token=rollbar-secret-value",
		"bugsnag_api_key=bugsnag-secret-value",
		"axiom_api_token=axiom-secret-value",
		"logz_io_shipping_token=logzio-secret-value",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		healthchecksURL,
		betterUptimeURL,
		grafanaOncallURL,
		"rollbar-secret-value",
		"bugsnag-secret-value",
		"axiom-secret-value",
		"logzio-secret-value",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	findings := ClassifyString(input)
	for _, signal := range []string{
		"healthchecks_ping_url",
		"better_uptime_heartbeat_url",
		"grafana_oncall_webhook_url",
		"assignment:key_name",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactMapCoversLaunchObservabilityWebhookMetadataKeys(t *testing.T) {
	metadata := map[string]any{
		"monitoring": map[string]string{
			"betterStackApiKey":      "better-stack-secret",
			"cronitorPingURL":        "https://cronitor.link/p/abcdef1234567890",
			"uptimeRobotApiKey":      "uptimerobot-secret",
			"honeybadgerDeployToken": "honeybadger-secret",
			"rollbarAccessToken":     "rollbar-secret",
			"bugsnagBuildApiKey":     "bugsnag-secret",
			"airbrakeProjectKey":     "airbrake-secret",
			"scoutApmKey":            "scout-secret",
			"lightstepAccessToken":   "lightstep-secret",
			"chronosphereApiToken":   "chronosphere-secret",
			"signozIngestionKey":     "signoz-secret",
			"axiomApiToken":          "axiom-secret",
			"logflareSourceToken":    "logflare-secret",
			"sematextLogsToken":      "sematext-secret",
			"logzIoShippingToken":    "logzio-secret",
			"papertrailApiToken":     "papertrail-secret",
		},
		"public": map[string]string{
			"dashboard_url": "https://status.example.test",
		},
	}

	redacted := RedactMap(metadata)
	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{
		"better-stack-secret",
		"https://cronitor.link/p/abcdef1234567890",
		"uptimerobot-secret",
		"honeybadger-secret",
		"rollbar-secret",
		"bugsnag-secret",
		"airbrake-secret",
		"scout-secret",
		"lightstep-secret",
		"chronosphere-secret",
		"signoz-secret",
		"axiom-secret",
		"logflare-secret",
		"sematext-secret",
		"logzio-secret",
		"papertrail-secret",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), `"dashboard_url":"https://status.example.test"`) {
		t.Fatalf("redacted metadata = %s, want public dashboard URL preserved", string(body))
	}

	findings := ClassifyValue(metadata)
	for _, location := range []string{
		"monitoring.betterStackApiKey",
		"monitoring.cronitorPingURL",
		"monitoring.uptimeRobotApiKey",
		"monitoring.honeybadgerDeployToken",
		"monitoring.rollbarAccessToken",
		"monitoring.bugsnagBuildApiKey",
		"monitoring.airbrakeProjectKey",
		"monitoring.scoutApmKey",
		"monitoring.lightstepAccessToken",
		"monitoring.chronosphereApiToken",
		"monitoring.signozIngestionKey",
		"monitoring.axiomApiToken",
		"monitoring.logflareSourceToken",
		"monitoring.sematextLogsToken",
		"monitoring.logzIoShippingToken",
		"monitoring.papertrailApiToken",
	} {
		assertAnyFindingAt(t, findings, location)
	}
}

func TestRedactStringCoversLaunchAIEvalProxyTokens(t *testing.T) {
	input := strings.Join([]string{
		"LANGFUSE_SECRET_KEY=sk-lf-abcdefghijklmnopqrstuvwxyz123456",
		"LANGFUSE_PUBLIC_KEY=pk-lf-abcdefghijklmnopqrstuvwxyz123456",
		"BRAINTRUST_API_KEY=braintrust-secret-value",
		"HELICONE_API_KEY=sk-helicone-abcdefghijklmnopqrstuvwxyz123456",
		"OPENPIPE_API_KEY=opk_abcdefghijklmnopqrstuvwxyz123456",
		"PROMPTLAYER_API_KEY=pl_abcdefghijklmnopqrstuvwxyz123456",
		"PORTKEY_API_KEY=ptk_abcdefghijklmnopqrstuvwxyz123456",
		"WANDB_API_KEY=wandb-secret-value",
		"WEIGHTS_BIASES_API_KEY=weights-secret-value",
		"WEAVE_API_KEY=weave-secret-value",
		"ARIZE_PHOENIX_API_KEY=phoenix-secret-value",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"sk-lf-abcdefghijklmnopqrstuvwxyz123456",
		"pk-lf-abcdefghijklmnopqrstuvwxyz123456",
		"braintrust-secret-value",
		"sk-helicone-abcdefghijklmnopqrstuvwxyz123456",
		"opk_abcdefghijklmnopqrstuvwxyz123456",
		"pl_abcdefghijklmnopqrstuvwxyz123456",
		"ptk_abcdefghijklmnopqrstuvwxyz123456",
		"wandb-secret-value",
		"weights-secret-value",
		"weave-secret-value",
		"phoenix-secret-value",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if !strings.Contains(got, Redacted) {
		t.Fatalf("RedactString() = %q, want redaction marker", got)
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"langfuse_secret_key",
		"langfuse_public_key",
		"helicone_key",
		"openpipe_key",
		"promptlayer_key",
		"portkey_key",
		"assignment:key_name",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactMapCoversLaunchAIEvalProxyMetadataKeys(t *testing.T) {
	metadata := map[string]any{
		"ai_observability": map[string]any{
			"langfuseSecretKey":     "sk-lf-abcdefghijklmnopqrstuvwxyz123456",
			"langfusePublicKey":     "pk-lf-abcdefghijklmnopqrstuvwxyz123456",
			"braintrustApiKey":      "braintrust-secret-value",
			"heliconeAuthToken":     "sk-helicone-abcdefghijklmnopqrstuvwxyz123456",
			"openpipeApiKey":        "opk_abcdefghijklmnopqrstuvwxyz123456",
			"promptlayerApiKey":     "pl_abcdefghijklmnopqrstuvwxyz123456",
			"portkeyVirtualKey":     "ptk_abcdefghijklmnopqrstuvwxyz123456",
			"wandbApiKey":           "wandb-secret-value",
			"weightsBiasesApiKey":   "weights-secret-value",
			"weaveTraceServerToken": "weave-secret-value",
			"arizePhoenixApiKey":    "phoenix-secret-value",
			"publicEndpoint":        "https://eval.example.test",
		},
		"public": "visible",
	}

	body, err := json.Marshal(RedactValue(metadata))
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{
		"sk-lf-abcdefghijklmnopqrstuvwxyz123456",
		"pk-lf-abcdefghijklmnopqrstuvwxyz123456",
		"braintrust-secret-value",
		"sk-helicone-abcdefghijklmnopqrstuvwxyz123456",
		"opk_abcdefghijklmnopqrstuvwxyz123456",
		"pl_abcdefghijklmnopqrstuvwxyz123456",
		"ptk_abcdefghijklmnopqrstuvwxyz123456",
		"wandb-secret-value",
		"weights-secret-value",
		"weave-secret-value",
		"phoenix-secret-value",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"public":"visible"`, `"publicEndpoint":"https://eval.example.test"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(metadata)
	for _, location := range []string{
		"ai_observability.langfuseSecretKey",
		"ai_observability.langfusePublicKey",
		"ai_observability.braintrustApiKey",
		"ai_observability.heliconeAuthToken",
		"ai_observability.openpipeApiKey",
		"ai_observability.promptlayerApiKey",
		"ai_observability.portkeyVirtualKey",
		"ai_observability.wandbApiKey",
		"ai_observability.weightsBiasesApiKey",
		"ai_observability.weaveTraceServerToken",
		"ai_observability.arizePhoenixApiKey",
	} {
		assertAnyFindingAt(t, findings, location)
	}
}

func TestRedactStringCoversLaunchBackupAndIncidentSecrets(t *testing.T) {
	ageKey := "AGE-SECRET-KEY-" + strings.Repeat("A", 32)
	input := strings.Join([]string{
		"RESTIC_PASSWORD=restic-password-value",
		"RESTIC_REPOSITORY=s3:s3.example.test/zenart-prod-backups",
		"KOPIA_SERVER_PASSWORD=kopia-server-password",
		"BORG_PASSPHRASE=borg-passphrase",
		"PGBACKREST_REPO1_CIPHER_PASS=pgbackrest-cipher-pass",
		"WALG_S3_PREFIX=s3://backup-access:backup-secret@bucket/path",
		"LITESTREAM_REPLICA_URL=s3://litestream-access:litestream-secret@bucket/db",
		"BACKUP_ENCRYPTION_KEY=backup-encryption-secret",
		"AGE_SECRET_KEY=" + ageKey,
		"GPG_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----abc123-----END PRIVATE KEY-----",
		"ROOTLY_API_KEY=rootly-secret-value",
		"FIREHYDRANT_TOKEN=firehydrant-secret-value",
		"STATUSPAGE_API_KEY=statuspage-secret-value",
		"VICTOROPS_ROUTING_KEY=victorops-routing-secret",
		"SPLUNK_ON_CALL_API_KEY=splunk-on-call-secret",
		"SQUADCAST_WEBHOOK_SECRET=squadcast-webhook-secret",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"restic-password-value",
		"s3.example.test/zenart-prod-backups",
		"kopia-server-password",
		"borg-passphrase",
		"pgbackrest-cipher-pass",
		"backup-access",
		"backup-secret",
		"litestream-access",
		"litestream-secret",
		"backup-encryption-secret",
		ageKey,
		"abc123",
		"rootly-secret-value",
		"firehydrant-secret-value",
		"statuspage-secret-value",
		"victorops-routing-secret",
		"splunk-on-call-secret",
		"squadcast-webhook-secret",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if !strings.Contains(got, Redacted) {
		t.Fatalf("RedactString() = %q, want redaction marker", got)
	}

	findings := ClassifyString(input)
	assertSignal(t, findings, "age_secret_key")
	assertSignal(t, findings, "pem_private_key")
	assertSignal(t, findings, "assignment:key_name")
}

func TestRedactMapCoversLaunchBackupAndIncidentMetadataKeys(t *testing.T) {
	metadata := map[string]any{
		"backup": map[string]any{
			"resticPassword":            "restic-password-value",
			"kopiaRepository":           "s3:s3.example.test/zenart-prod-backups",
			"borgPassphrase":            "borg-passphrase",
			"pgbackrestRepo1CipherPass": "pgbackrest-cipher-pass",
			"walgS3Prefix":              "s3://backup-access:backup-secret@bucket/path",
			"litestreamReplicaUrl":      "s3://litestream-access:litestream-secret@bucket/db",
			"backupEncryptionKey":       "backup-encryption-secret",
			"ageIdentity":               "AGE-SECRET-KEY-" + strings.Repeat("B", 32),
			"publicRetentionDays":       30,
		},
		"incident": map[string]string{
			"rootlyApiKey":              "rootly-secret-value",
			"firehydrantToken":          "firehydrant-secret-value",
			"statuspageApiKey":          "statuspage-secret-value",
			"victoropsRoutingKey":       "victorops-routing-secret",
			"splunkOnCallRoutingKey":    "splunk-on-call-secret",
			"squadcastWebhookSecret":    "squadcast-webhook-secret",
			"publicStatusPageComponent": "api",
		},
		"public": "visible",
	}

	body, err := json.Marshal(RedactValue(metadata))
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{
		"restic-password-value",
		"s3.example.test/zenart-prod-backups",
		"borg-passphrase",
		"pgbackrest-cipher-pass",
		"backup-access",
		"litestream-access",
		"backup-encryption-secret",
		"AGE-SECRET-KEY-",
		"rootly-secret-value",
		"firehydrant-secret-value",
		"statuspage-secret-value",
		"victorops-routing-secret",
		"splunk-on-call-secret",
		"squadcast-webhook-secret",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"public":"visible"`, `"publicRetentionDays":30`, `"publicStatusPageComponent":"api"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(metadata)
	for _, location := range []string{
		"backup.resticPassword",
		"backup.kopiaRepository",
		"backup.borgPassphrase",
		"backup.pgbackrestRepo1CipherPass",
		"backup.walgS3Prefix",
		"backup.litestreamReplicaUrl",
		"backup.backupEncryptionKey",
		"backup.ageIdentity",
		"incident.rootlyApiKey",
		"incident.firehydrantToken",
		"incident.statuspageApiKey",
		"incident.victoropsRoutingKey",
		"incident.splunkOnCallRoutingKey",
		"incident.squadcastWebhookSecret",
	} {
		assertAnyFindingAt(t, findings, location)
	}
}

func TestRedactStringCoversLaunchAuthorizationSchemesAndInfraTokens(t *testing.T) {
	pulumiToken := "pul-" + strings.Repeat("a", 40)
	databricksToken := "dapi" + strings.Repeat("b", 32)
	input := strings.Join([]string{
		"Authorization: ApiKey provider-secret-value",
		"Proxy-Authorization: SharedKey storage-account:signature-value",
		"Authorization=Token provider-token-value",
		"Proxy-Authorization=SharedKeyLite storage-lite-secret",
		"client_assertion=eyJabcdefghijklmnopqrstuvwxyz.eyJabcdefghijklmnopqrstuvwxyz.abcdefghijklmnopqrst",
		"azure=azdpat" + strings.Repeat("A", 24),
		"pulumi=" + pulumiToken,
		"databricks=" + databricksToken,
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"provider-secret-value",
		"storage-account:signature-value",
		"provider-token-value",
		"storage-lite-secret",
		"eyJabcdefghijklmnopqrstuvwxyz.eyJabcdefghijklmnopqrstuvwxyz.abcdefghijklmnopqrst",
		"azdpat" + strings.Repeat("A", 24),
		pulumiToken,
		databricksToken,
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	for _, fragment := range []string{
		"Authorization: ApiKey " + Redacted,
		"Proxy-Authorization: SharedKey " + Redacted,
		"Authorization=Token " + Redacted,
		"Proxy-Authorization=SharedKeyLite " + Redacted,
		Redacted,
	} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("RedactString() = %q, missing %s", got, fragment)
		}
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"assignment:key_name",
		"jwt",
		"azure_devops_pat",
		"pulumi_access_token",
		"databricks_pat",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactStringCoversWebhookAndGitLabTokens(t *testing.T) {
	input := strings.Join([]string{
		"gitlab=glpat-abcdefghijklmnopqrstuvwxyz123456",
		"slack=https://hooks.slack.com/services/T00000000/B00000000/abcdefghijklmnopqrstuvwxyz",
		"discord=https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz123456",
		"Authorization: Bearer abcdefghijklmnop",
	}, " ")
	got := RedactString(input)
	for _, leaked := range []string{
		"glpat-abcdefghijklmnopqrstuvwxyz123456",
		"hooks.slack.com/services/T00000000",
		"discord.com/api/webhooks/123456789012345678",
		"abcdefghijklmnop",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	findings := ClassifyString(input)
	assertSignal(t, findings, "gitlab_token")
	assertSignal(t, findings, "slack_webhook_url")
	assertSignal(t, findings, "discord_webhook_url")
}

func TestRedactStringCoversEmbeddedSignedURLsAndRegistryTokens(t *testing.T) {
	input := `download https://s3.local/zenart/export.zip?X-Amz-Credential=AKIAIOSFODNN7EXAMPLE&X-Amz-Signature=abcdef&X-Goog-Signature=secret-goog&se=2026-05-27&sp=r&sv=2024-01-01&response-content-type=application%2Fzip npm=npm_abcdefghijklmnopqrstuvwxyz123456`
	got := RedactString(input)
	for _, leaked := range []string{"AKIAIOSFODNN7EXAMPLE", "abcdef", "secret-goog", "npm_abcdefghijklmnopqrstuvwxyz123456"} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	for _, fragment := range []string{"X-Amz-Credential=", "X-Amz-Signature=", "X-Goog-Signature=", "se=", "sp=", "sv=", Redacted} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("RedactString() = %q, missing %s", got, fragment)
		}
	}
	findings := ClassifyString(input)
	assertSignal(t, findings, "url_query_secret")
	assertSignal(t, findings, "npm_token")
}

func TestRedactStringCoversS3CompatibleAndCDNSignedURLs(t *testing.T) {
	input := strings.Join([]string{
		"https://oss.example.test/export.zip?OSSAccessKeyId=oss-access&X-OSS-Signature=oss-signature&X-OSS-Security-Token=oss-token&X-OSS-Credential=oss-credential&X-OSS-Date=20260527T120000Z&X-OSS-Expires=900&security-token=oss-security-token",
		"https://cos.example.test/export.zip?q-sign-algorithm=sha1&q-ak=cos-access-key&q-sign-time=1770000000;1770000900&q-key-time=1770000000;1770000900&q-header-list=host&q-url-param-list=ci-process&q-signature=cos-signature&X-Cos-Security-Token=cos-token",
		"https://cdn.example.test/export.zip?CloudFront-Signature=cf-signature&CloudFront-Policy=cf-policy&CloudFront-Key-Pair-Id=cf-keypair",
		"https://b2.example.test/export.zip?X-Bz-Info-Authorization=b2-authorization&Authorization=b2-download-token&AccessKeyId=b2-key-id&X-Bz-Security-Token=b2-security-token",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"oss-access",
		"oss-signature",
		"oss-token",
		"oss-credential",
		"oss-security-token",
		"cos-access-key",
		"1770000000;1770000900",
		"cos-token",
		"cos-signature",
		"cf-signature",
		"cf-policy",
		"cf-keypair",
		"b2-authorization",
		"b2-download-token",
		"b2-key-id",
		"b2-security-token",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	for _, fragment := range []string{
		"OSSAccessKeyId=",
		"X-OSS-Signature=",
		"X-OSS-Credential=",
		"security-token=",
		"q-ak=",
		"q-signature=",
		"CloudFront-Signature=",
		"X-Bz-Info-Authorization=",
		"Authorization=",
		"AccessKeyId=",
		Redacted,
	} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("RedactString() = %q, missing %s", got, fragment)
		}
	}

	findings := ClassifyString(input)
	assertSignal(t, findings, "url_query_secret")
}

func TestRedactStringCoversS3CompatibleHeaderAndEnvSecrets(t *testing.T) {
	input := strings.Join([]string{
		"Authorization: AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20260527/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=abcdef1234567890",
		"OBJECT_STORAGE_ACCESS_KEY=stage0-staging-access-key",
		"OBJECT_STORAGE_SECRET_KEY=stage0-staging-secret-key",
		"OBJECT_STORAGE_SIGNING_KEY=stage0-staging-object-signing-secret",
		"AWS_SESSION_TOKEN=stage0-session-token",
		"MINIO_ROOT_PASSWORD=minio-root-password",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"AKIAIOSFODNN7EXAMPLE",
		"abcdef1234567890",
		"stage0-staging-access-key",
		"stage0-staging-secret-key",
		"stage0-staging-object-signing-secret",
		"stage0-session-token",
		"minio-root-password",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if !strings.Contains(got, Redacted) {
		t.Fatalf("RedactString() = %q, want redaction marker", got)
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"aws_sigv4_authorization",
		"s3_access_key_id",
		"s3_secret_access_key",
		"aws_session_token",
		"assignment:key_name",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactStringCoversS3CompatibleProviderAliasesAndEdgeTokens(t *testing.T) {
	input := strings.Join([]string{
		"R2_ACCESS_KEY_ID=r2-access-key-value",
		"R2_SECRET_ACCESS_KEY=r2-secret-key-value",
		"WASABI_ACCESS_KEY=wasabi-access-key-value",
		"WASABI_SECRET_KEY=wasabi-secret-key-value",
		"SCW_ACCESS_KEY=scw-access-key-value",
		"SCW_SECRET_KEY=scw-secret-key-value",
		"VULTR_OBJECT_STORAGE_ACCESS_KEY=vultr-access-key-value",
		"VULTR_OBJECT_STORAGE_SECRET_KEY=vultr-secret-key-value",
		"LINODE_OBJECT_STORAGE_ACCESS_KEY=linode-access-key-value",
		"LINODE_OBJECT_STORAGE_SECRET_KEY=linode-secret-key-value",
		"OCI_ACCESS_KEY=oci-access-key-value",
		"OCI_PRIVATE_KEY=oci-private-key-value",
		"https://edge.example.test/export.zip?__token__=edge-token&hdnts=akamai-hdnts&hdntl=akamai-hdntl&Edge-Auth=edge-auth&Akamai-Signature=akamai-signature&response-content-type=application%2Fzip",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"r2-access-key-value",
		"r2-secret-key-value",
		"wasabi-access-key-value",
		"wasabi-secret-key-value",
		"scw-access-key-value",
		"scw-secret-key-value",
		"vultr-access-key-value",
		"vultr-secret-key-value",
		"linode-access-key-value",
		"linode-secret-key-value",
		"oci-access-key-value",
		"oci-private-key-value",
		"edge-token",
		"akamai-hdnts",
		"akamai-hdntl",
		"edge-auth",
		"akamai-signature",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if !strings.Contains(got, "response-content-type=application%2Fzip") || !strings.Contains(got, Redacted) {
		t.Fatalf("RedactString() = %q, want public response override preserved and secrets redacted", got)
	}

	findings := ClassifyString(input)
	assertSignal(t, findings, "url_query_secret")
	assertSignal(t, findings, "assignment:key_name")
}

func TestRedactStringCoversSignedDeliveryCookieAndHeaderAssignments(t *testing.T) {
	input := strings.Join([]string{
		"CloudFront-Signature=cf-cookie-signature",
		"CloudFront-Policy=cf-cookie-policy",
		"CloudFront-Key-Pair-Id=cf-cookie-keypair",
		"Cloud-CDN-Signature=gcp-cdn-signature",
		"Cloud-CDN-Policy=gcp-cdn-policy",
		"Cloud-CDN-Key-Name=gcp-key-name",
		"URLPrefix=gcp-url-prefix",
		"KeyName=gcp-key-name-legacy",
		"CDN-Token=generic-cdn-token",
		"CF-Authorization=cloudflare-signed-token",
		"Cloudflare-Access-Jwt-Assertion=cf-access-jwt",
		"response-content-type=application/zip",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"cf-cookie-signature",
		"cf-cookie-policy",
		"cf-cookie-keypair",
		"gcp-cdn-signature",
		"gcp-cdn-policy",
		"gcp-key-name",
		"gcp-url-prefix",
		"gcp-key-name-legacy",
		"generic-cdn-token",
		"cloudflare-signed-token",
		"cf-access-jwt",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if !strings.Contains(got, "response-content-type=application/zip") || !strings.Contains(got, Redacted) {
		t.Fatalf("RedactString() = %q, want public response override preserved and delivery secrets redacted", got)
	}

	findings := ClassifyString(input)
	assertSignal(t, findings, "signed_delivery_assignment")
}

func TestRedactStringCoversExtendedSignedDeliveryProviders(t *testing.T) {
	input := strings.Join([]string{
		"Fastly-API-Key=fastly-api-secret",
		"Fastly-Service-Token=fastly-service-secret",
		"Fastly-Edge-Auth=fastly-edge-secret",
		"Imgix-Secure-URL-Token=imgix-token-secret",
		"ix-signature=imgix-signature-secret",
		"BunnyCDN-API-Key=bunny-api-secret",
		"Bunny-Storage-Password=bunny-storage-secret",
		"Mux-Token-ID=mux-token-id-secret",
		"Mux-Token-Secret=mux-token-secret",
		"Mux-Signing-Key=mux-signing-secret",
		"Vercel-Blob-Read-Write-Token=vercel-blob-secret",
		"X-Vercel-Signature=vercel-signature-secret",
		"response-content-disposition=attachment",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"fastly-api-secret",
		"fastly-service-secret",
		"fastly-edge-secret",
		"imgix-token-secret",
		"imgix-signature-secret",
		"bunny-api-secret",
		"bunny-storage-secret",
		"mux-token-id-secret",
		"mux-token-secret",
		"mux-signing-secret",
		"vercel-blob-secret",
		"vercel-signature-secret",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if !strings.Contains(got, "response-content-disposition=attachment") || !strings.Contains(got, Redacted) {
		t.Fatalf("RedactString() = %q, want public response override preserved and delivery secrets redacted", got)
	}

	findings := ClassifyString(input)
	assertSignal(t, findings, "signed_delivery_assignment")
}

func TestRedactStringCoversExtendedSignedDeliveryURLs(t *testing.T) {
	input := strings.Join([]string{
		"https://cdn.example.test/export.zip?Fastly-API-Key=fastly-api-secret&Fastly-Signature=fastly-signature-secret",
		"https://assets.example.test/image.png?ix-signature=imgix-signature-secret&Imgix-Secure-URL-Token=imgix-token-secret",
		"https://video.example.test/asset.m3u8?Mux-Token-ID=mux-token-id-secret&Mux-Token-Secret=mux-token-secret&Mux-Policy=mux-policy-secret",
		"https://blob.example.test/export.zip?Vercel-Blob-Read-Write-Token=vercel-blob-secret&X-Vercel-Token=vercel-token-secret",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"fastly-api-secret",
		"fastly-signature-secret",
		"imgix-signature-secret",
		"imgix-token-secret",
		"mux-token-id-secret",
		"mux-token-secret",
		"mux-policy-secret",
		"vercel-blob-secret",
		"vercel-token-secret",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	for _, fragment := range []string{
		"Fastly-API-Key=",
		"ix-signature=",
		"Mux-Token-ID=",
		"Vercel-Blob-Read-Write-Token=",
		Redacted,
	} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("RedactString() = %q, missing %s", got, fragment)
		}
	}

	findings := ClassifyString(input)
	assertSignal(t, findings, "url_query_secret")
}

func TestRedactMapCoversExtendedSignedDeliveryMetadata(t *testing.T) {
	metadata := map[string]any{
		"delivery": map[string]any{
			"fastlyApiKey":             "fastly-api-secret",
			"fastlyServiceToken":       "fastly-service-secret",
			"imgixSecureURLToken":      "imgix-token-secret",
			"bunnyStoragePassword":     "bunny-storage-secret",
			"muxTokenSecret":           "mux-token-secret",
			"muxSigningKey":            "mux-signing-secret",
			"vercelBlobReadWriteToken": "vercel-blob-secret",
			"publicEndpoint":           "https://downloads.example.test",
		},
		"signed_url_parts": map[string]string{
			"Fastly-Signature": "fastly-signature-secret",
			"ix-signature":     "imgix-signature-secret",
			"X-Vercel-Token":   "vercel-token-secret",
			"path":             "/exports/package.zip",
		},
	}

	body, err := json.Marshal(RedactValue(metadata))
	if err != nil {
		t.Fatalf("marshal redacted delivery metadata: %v", err)
	}
	for _, leaked := range []string{
		"fastly-api-secret",
		"fastly-service-secret",
		"imgix-token-secret",
		"bunny-storage-secret",
		"mux-token-secret",
		"mux-signing-secret",
		"vercel-blob-secret",
		"fastly-signature-secret",
		"imgix-signature-secret",
		"vercel-token-secret",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{
		`"publicEndpoint":"https://downloads.example.test"`,
		`"path":"/exports/package.zip"`,
		Redacted,
	} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(metadata)
	for _, expected := range []struct {
		kind     SecretKind
		location string
	}{
		{SecretKindAPIKey, "delivery.fastlyApiKey"},
		{SecretKindSignedURL, "delivery.fastlyServiceToken"},
		{SecretKindSignedURL, "delivery.imgixSecureURLToken"},
		{SecretKindPassword, "delivery.bunnyStoragePassword"},
		{SecretKindSignedURL, "delivery.muxTokenSecret"},
		{SecretKindPrivateKey, "delivery.muxSigningKey"},
		{SecretKindSignedURL, "delivery.vercelBlobReadWriteToken"},
		{SecretKindSignedURL, "signed_url_parts.Fastly-Signature"},
		{SecretKindSignedURL, "signed_url_parts.ix-signature"},
		{SecretKindSignedURL, "signed_url_parts.X-Vercel-Token"},
	} {
		assertFinding(t, findings, expected.kind, expected.location)
	}
}

func TestRedactMapCoversS3CompatibleObjectStorageConfigMetadata(t *testing.T) {
	metadata := map[string]any{
		"object_storage": map[string]any{
			"provider":                 "s3-compatible",
			"objectStorageAccessKey":   "stage0-staging-access-key",
			"objectStorageSecretKey":   "stage0-staging-secret-key",
			"objectStorageSigningKey":  "stage0-staging-object-signing-secret",
			"awsSessionToken":          "stage0-session-token",
			"minioRootPassword":        "minio-root-password",
			"public_download_endpoint": "https://downloads.example.test",
		},
	}

	body, err := json.Marshal(RedactMap(metadata))
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{
		"stage0-staging-access-key",
		"stage0-staging-secret-key",
		"stage0-staging-object-signing-secret",
		"stage0-session-token",
		"minio-root-password",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{
		`"provider":"s3-compatible"`,
		`"public_download_endpoint":"https://downloads.example.test"`,
		Redacted,
	} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(metadata)
	for _, location := range []string{
		"object_storage.objectStorageAccessKey",
		"object_storage.objectStorageSecretKey",
		"object_storage.objectStorageSigningKey",
		"object_storage.awsSessionToken",
		"object_storage.minioRootPassword",
	} {
		assertAnyFindingAt(t, findings, location)
	}
}

func TestRedactMapCoversS3CompatibleProviderAliasMetadata(t *testing.T) {
	metadata := map[string]any{
		"storage_aliases": map[string]any{
			"r2AccessKeyID":                 "r2-access-key-value",
			"r2SecretAccessKey":             "r2-secret-key-value",
			"wasabiAccessKey":               "wasabi-access-key-value",
			"wasabiSecretKey":               "wasabi-secret-key-value",
			"scwAccessKey":                  "scw-access-key-value",
			"scwSecretKey":                  "scw-secret-key-value",
			"scalewayAccessKey":             "scaleway-access-key-value",
			"scalewaySecretKey":             "scaleway-secret-key-value",
			"vultrObjectStorageAccessKey":   "vultr-access-key-value",
			"vultrObjectStorageSecretKey":   "vultr-secret-key-value",
			"linodeObjectStorageAccessKey":  "linode-access-key-value",
			"linodeObjectStorageSecretKey":  "linode-secret-key-value",
			"ociAccessKey":                  "oci-access-key-value",
			"ociPrivateKey":                 "oci-private-key-value",
			"oracleObjectStoragePrivateKey": "oracle-private-key-value",
			"publicEndpoint":                "https://downloads.example.test",
		},
	}

	body, err := json.Marshal(RedactValue(metadata))
	if err != nil {
		t.Fatalf("marshal redacted provider alias metadata: %v", err)
	}
	for _, leaked := range []string{
		"r2-access-key-value",
		"r2-secret-key-value",
		"wasabi-access-key-value",
		"wasabi-secret-key-value",
		"scw-access-key-value",
		"scw-secret-key-value",
		"scaleway-access-key-value",
		"scaleway-secret-key-value",
		"vultr-access-key-value",
		"vultr-secret-key-value",
		"linode-access-key-value",
		"linode-secret-key-value",
		"oci-access-key-value",
		"oci-private-key-value",
		"oracle-private-key-value",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), `"publicEndpoint":"https://downloads.example.test"`) || !strings.Contains(string(body), Redacted) {
		t.Fatalf("redacted metadata = %s, want public endpoint and redaction marker", string(body))
	}

	findings := ClassifyValue(metadata)
	for _, expected := range []struct {
		kind     SecretKind
		location string
	}{
		{SecretKindAccessKey, "storage_aliases.r2AccessKeyID"},
		{SecretKindCloudKey, "storage_aliases.r2SecretAccessKey"},
		{SecretKindAccessKey, "storage_aliases.wasabiAccessKey"},
		{SecretKindCloudKey, "storage_aliases.wasabiSecretKey"},
		{SecretKindAccessKey, "storage_aliases.scwAccessKey"},
		{SecretKindCloudKey, "storage_aliases.scwSecretKey"},
		{SecretKindAccessKey, "storage_aliases.scalewayAccessKey"},
		{SecretKindCloudKey, "storage_aliases.scalewaySecretKey"},
		{SecretKindAccessKey, "storage_aliases.vultrObjectStorageAccessKey"},
		{SecretKindCloudKey, "storage_aliases.vultrObjectStorageSecretKey"},
		{SecretKindAccessKey, "storage_aliases.linodeObjectStorageAccessKey"},
		{SecretKindCloudKey, "storage_aliases.linodeObjectStorageSecretKey"},
		{SecretKindAccessKey, "storage_aliases.ociAccessKey"},
		{SecretKindPrivateKey, "storage_aliases.ociPrivateKey"},
		{SecretKindPrivateKey, "storage_aliases.oracleObjectStoragePrivateKey"},
	} {
		assertFinding(t, findings, expected.kind, expected.location)
	}
}

func TestRedactMapCoversExportAndCrawlerMetadataURLs(t *testing.T) {
	redacted := RedactMap(map[string]any{
		"export": map[string]any{
			"download_url": "https://storage.local/tenants/tenant_1/exports/pkg.zip?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=abcdef",
		},
		"crawler": map[string]any{
			"source_url": "https://user:pass@example.com/source?token=secret-token",
		},
	})

	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{"AKIAIOSFODNN7EXAMPLE", "abcdef", "user:pass", "secret-token"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), Redacted) {
		t.Fatalf("redacted metadata = %s, want redaction marker", string(body))
	}
}

func TestRedactValueCoversHeadersAndStringSlices(t *testing.T) {
	header := http.Header{
		"Authorization": []string{"Bearer abcdefghijklmnop"},
		"X-Trace":       []string{"https://storage.local/file.zip?X-Amz-Signature=abcdef"},
	}
	redacted, ok := RedactValue(header).(map[string][]string)
	if !ok {
		t.Fatalf("RedactValue(header) type = %T, want map[string][]string", RedactValue(header))
	}
	if redacted["Authorization"][0] != Redacted {
		t.Fatalf("Authorization = %#v, want redacted", redacted["Authorization"])
	}
	if strings.Contains(redacted["X-Trace"][0], "abcdef") {
		t.Fatalf("X-Trace = %#v, leaked signed URL signature", redacted["X-Trace"])
	}

	value := map[string]any{
		"headers": header,
		"events":  []string{"ok", "token=npm_abcdefghijklmnopqrstuvwxyz123456"},
	}
	body, err := json.Marshal(RedactValue(value))
	if err != nil {
		t.Fatalf("marshal redacted value: %v", err)
	}
	for _, leaked := range []string{"abcdefghijklmnop", "abcdef", "npm_abcdefghijklmnopqrstuvwxyz123456"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted body = %s, leaked %s", string(body), leaked)
		}
	}
}

func TestRedactValueCoversLaunchMetadataContainers(t *testing.T) {
	values := url.Values{
		"X-Amz-Signature": []string{"abcdef"},
		"public":          []string{"ok"},
	}
	redactedValues, ok := RedactValue(values).(map[string][]string)
	if !ok {
		t.Fatalf("RedactValue(url.Values) type = %T, want map[string][]string", RedactValue(values))
	}
	if redactedValues["X-Amz-Signature"][0] != Redacted || redactedValues["public"][0] != "ok" {
		t.Fatalf("redacted url values = %#v", redactedValues)
	}

	metadata := map[string]any{
		"export_events": []map[string]any{
			{
				"download_url": "https://storage.local/export.zip?X-Amz-Signature=abcdef",
				"status":       "ready",
			},
		},
		"support_context": []map[string]string{
			{
				"api_key": "secret",
				"summary": "user reported export failure",
			},
		},
		"audit_headers": []map[string][]string{
			{
				"Authorization": []string{"Bearer abcdefghijklmnop"},
			},
		},
		"crawler_findings": map[string][]any{
			"source_urls": []any{
				"https://user:pass@example.test/path?token=secret-token",
			},
		},
	}
	body, err := json.Marshal(RedactValue(metadata))
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{
		"abcdef",
		`"api_key":"secret"`,
		"abcdefghijklmnop",
		"user:pass",
		"secret-token",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{"ready", "user reported export failure", Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted metadata = %s, missing %s", string(body), fragment)
		}
	}
}

func TestRedactValueCoversErrors(t *testing.T) {
	got := RedactValue(errors.New("provider failed with sk-ant-abcdefghijklmnopqrstuvwxyz123456"))
	asString, ok := got.(string)
	if !ok {
		t.Fatalf("RedactValue(error) type = %T, want string", got)
	}
	if strings.Contains(asString, "sk-ant-abcdefghijklmnopqrstuvwxyz123456") || !strings.Contains(asString, Redacted) {
		t.Fatalf("RedactValue(error) = %q, want redacted error string", asString)
	}
}

func TestRedactValueCoversRawMessagesBytesURLsAndStringers(t *testing.T) {
	raw := json.RawMessage(`{"signed_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","provider_key":"sk-ant-abcdefghijklmnopqrstuvwxyz123456"}`)
	redactedRaw, ok := RedactValue(raw).(json.RawMessage)
	if !ok {
		t.Fatalf("RedactValue(raw) type = %T, want json.RawMessage", RedactValue(raw))
	}
	if strings.Contains(string(redactedRaw), "abcdef") || strings.Contains(string(redactedRaw), "sk-ant-abcdefghijklmnopqrstuvwxyz123456") {
		t.Fatalf("redacted raw = %s, leaked secret", string(redactedRaw))
	}

	redactedBytes, ok := RedactValue([]byte(`{"Authorization":"Bearer abcdefghijklmnop"}`)).([]byte)
	if !ok {
		t.Fatalf("RedactValue(bytes) type = %T, want []byte", RedactValue([]byte{}))
	}
	if strings.Contains(string(redactedBytes), "abcdefghijklmnop") {
		t.Fatalf("redacted bytes = %s, leaked bearer token", string(redactedBytes))
	}

	parsed, err := url.Parse("https://user:pass@example.test/export.zip?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE&Signature=abcdef")
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}
	redactedURL := RedactValue(parsed)
	asString, ok := redactedURL.(string)
	if !ok {
		t.Fatalf("RedactValue(url) type = %T, want string", redactedURL)
	}
	for _, leaked := range []string{"user:pass", "AKIAIOSFODNN7EXAMPLE", "abcdef"} {
		if strings.Contains(asString, leaked) {
			t.Fatalf("redacted URL = %q, leaked %s", asString, leaked)
		}
	}

	stringer := stringerValue("provider token=npm_abcdefghijklmnopqrstuvwxyz123456")
	redactedStringer, ok := RedactValue(stringer).(string)
	if !ok {
		t.Fatalf("RedactValue(stringer) type = %T, want string", RedactValue(stringer))
	}
	if strings.Contains(redactedStringer, "npm_abcdefghijklmnopqrstuvwxyz123456") {
		t.Fatalf("redacted stringer = %q, leaked token", redactedStringer)
	}
}

func TestRedactValueCoversTypedStructsAndMaps(t *testing.T) {
	type exportMetadata struct {
		DownloadURL string             `json:"download_url"`
		ProviderKey string             `json:"provider_key"`
		Headers     http.Header        `json:"headers"`
		Tags        map[int]string     `json:"tags"`
		Nested      []typedSecretEvent `json:"nested"`
		Ignored     string             `json:"-"`
	}
	value := exportMetadata{
		DownloadURL: "https://storage.local/export.zip?X-Amz-Signature=abcdef",
		ProviderKey: "sk-ant-abcdefghijklmnopqrstuvwxyz123456",
		Headers:     http.Header{"Authorization": []string{"Bearer abcdefghijklmnop"}},
		Tags:        map[int]string{7: "token=npm_abcdefghijklmnopqrstuvwxyz123456"},
		Nested: []typedSecretEvent{{
			CrawlerSourceURL: "https://user:pass@example.test/source?token=secret-token",
			Public:           "ok",
		}},
		Ignored: "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
	}

	redacted := RedactValue(value)
	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted typed value: %v", err)
	}
	for _, leaked := range []string{
		"abcdef",
		"sk-ant-abcdefghijklmnopqrstuvwxyz123456",
		"abcdefghijklmnop",
		"npm_abcdefghijklmnopqrstuvwxyz123456",
		"user:pass",
		"secret-token",
		"sk-proj-abcdefghijklmnopqrstuvwxyz123456",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted typed value = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"download_url"`, `"provider_key":"[REDACTED]"`, `"7"`, `"public":"ok"`} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted typed value = %s, missing %s", string(body), fragment)
		}
	}
	if strings.Contains(string(body), "Ignored") {
		t.Fatalf("redacted typed value = %s, json ignored field should be omitted", string(body))
	}
}

func TestClassifyValueCoversTypedStructsAndMaps(t *testing.T) {
	value := typedSecretEnvelope{
		Event: typedSecretEvent{
			CrawlerSourceURL: "https://user:pass@example.test/source?token=secret-token",
			Public:           "ok",
		},
		Labels: map[int]string{
			1: "Authorization: Bearer abcdefghijklmnop",
		},
	}

	findings := ClassifyValue(value)
	assertFinding(t, findings, SecretKindDSN, "event.crawler_source_url")
	assertFinding(t, findings, SecretKindSignedURL, "event.crawler_source_url")
	assertFinding(t, findings, SecretKindAuthorization, "labels.1")
}

func TestRedactValueCoversTypedSignedURLPartStructs(t *testing.T) {
	type signedURLParts struct {
		Key             string `json:"key"`
		Expires         string `json:"expires"`
		Sig             string `json:"sig"`
		XAmzCredential  string `json:"X-Amz-Credential"`
		XAmzSignature   string `json:"X-Amz-Signature"`
		ResponseContent string `json:"response-content-type"`
		PublicFormat    string `json:"public_format"`
	}
	value := signedURLParts{
		Key:             "tenants/tenant_1/exports/package.zip",
		Expires:         "1770000900",
		Sig:             "backend-mediated-signature",
		XAmzCredential:  "AKIAIOSFODNN7EXAMPLE/20260527/us-east-1/s3/aws4_request",
		XAmzSignature:   "s3-compatible-signature",
		ResponseContent: "application/zip",
		PublicFormat:    "zip",
	}

	body, err := json.Marshal(RedactValue(value))
	if err != nil {
		t.Fatalf("marshal redacted signed URL parts: %v", err)
	}
	for _, leaked := range []string{
		"1770000900",
		"backend-mediated-signature",
		"AKIAIOSFODNN7EXAMPLE",
		"s3-compatible-signature",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted signed URL parts = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{
		`"key":"tenants/tenant_1/exports/package.zip"`,
		`"expires":"[REDACTED]"`,
		`"sig":"[REDACTED]"`,
		`"X-Amz-Credential":"[REDACTED]"`,
		`"X-Amz-Signature":"[REDACTED]"`,
		`"response-content-type":"application/zip"`,
		`"public_format":"zip"`,
	} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted signed URL parts = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(value)
	for _, location := range []string{"expires", "sig", "X-Amz-Credential", "X-Amz-Signature"} {
		assertFinding(t, findings, SecretKindSignedURL, location)
	}
}

func TestRedactValueStopsRecursiveStructCycles(t *testing.T) {
	type node struct {
		Name  string `json:"name"`
		Token string `json:"token"`
		Next  *node  `json:"next"`
	}
	first := &node{Name: "first", Token: "npm_abcdefghijklmnopqrstuvwxyz123456"}
	second := &node{Name: "second", Token: "sk-ant-abcdefghijklmnopqrstuvwxyz123456", Next: first}
	first.Next = second

	body, err := json.Marshal(RedactValue(first))
	if err != nil {
		t.Fatalf("marshal cyclic redacted value: %v", err)
	}
	for _, leaked := range []string{"npm_abcdefghijklmnopqrstuvwxyz123456", "sk-ant-abcdefghijklmnopqrstuvwxyz123456"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted cycle = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), Redacted) {
		t.Fatalf("redacted cycle = %s, want redaction marker", string(body))
	}
}

func TestClassifyValueCoversRawMessagesBytesURLsErrorsAndStringers(t *testing.T) {
	parsed, err := url.Parse("https://user:pass@example.test/export.zip?X-Amz-Signature=abcdef")
	if err != nil {
		t.Fatalf("parse URL: %v", err)
	}
	findings := ClassifyValue(map[string]any{
		"raw":      json.RawMessage(`{"webhook_secret":"whsec_abcdefghijklmnopqrstuvwxyz123456"}`),
		"bytes":    []byte(`{"provider_key":"sk-ant-abcdefghijklmnopqrstuvwxyz123456"}`),
		"url":      parsed,
		"error":    errors.New("failed with Bearer abcdefghijklmnop"),
		"stringer": stringerValue("token=npm_abcdefghijklmnopqrstuvwxyz123456"),
	})

	assertFinding(t, findings, SecretKindWebhookSecret, "raw.webhook_secret")
	assertFinding(t, findings, SecretKindProviderKey, "bytes.provider_key")
	assertFinding(t, findings, SecretKindDSN, "url")
	assertFinding(t, findings, SecretKindSignedURL, "url")
	assertFinding(t, findings, SecretKindAuthorization, "error")
	assertFinding(t, findings, SecretKindToken, "stringer")
}

func TestRedactStringCoversRawJSONPayloads(t *testing.T) {
	input := `{"event":"export_failed","headers":{"Authorization":["Bearer abcdefghijklmnop"]},"provider":{"openai_api_key":"sk-proj-abcdefghijklmnopqrstuvwxyz123456"},"signed_url":"https://storage.local/export.zip?X-Amz-Signature=abcdef","items":[{"webhook_secret":"whsec_abcdefghijklmnopqrstuvwxyz123456"}]}`
	got := RedactString(input)

	for _, leaked := range []string{
		"abcdefghijklmnop",
		"sk-proj-abcdefghijklmnopqrstuvwxyz123456",
		"abcdef",
		"whsec_abcdefghijklmnopqrstuvwxyz123456",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	for _, fragment := range []string{`"event":"export_failed"`, Redacted} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("RedactString() = %q, missing %s", got, fragment)
		}
	}

	findings := ClassifyString(input)
	assertFinding(t, findings, SecretKindAuthorization, "headers.Authorization")
	assertFinding(t, findings, SecretKindAPIKey, "provider.openai_api_key")
	assertFinding(t, findings, SecretKindSignedURL, "signed_url")
	assertFinding(t, findings, SecretKindWebhookSecret, "items[0].webhook_secret")
}

func TestRedactStringCoversLaunchProviderAndCommerceTokens(t *testing.T) {
	twilioKey := "SK" + strings.Repeat("0", 32)
	input := strings.Join([]string{
		"sendgrid=SG.abcdefghijklmnopqrstuvwxyz123456.abcdefghijklmnopqrstuvwxyz123456",
		"mailgun=key-abcdefghijklmnopqrstuvwxyz123456",
		"stripe_webhook=whsec_abcdefghijklmnopqrstuvwxyz123456",
		"shopify=shpat_abcdefghijklmnopqrstuvwxyz123456",
		"twilio=" + twilioKey,
		"square=EAAAabcdefghijklmnopqrstuvwxyz123456",
		"aws_secret_access_key=abcdefghijklmnopqrstuvwxyz1234567890/+=",
	}, " ")
	got := RedactString(input)

	for _, leaked := range []string{
		"SG.abcdefghijklmnopqrstuvwxyz123456.abcdefghijklmnopqrstuvwxyz123456",
		"key-abcdefghijklmnopqrstuvwxyz123456",
		"whsec_abcdefghijklmnopqrstuvwxyz123456",
		"shpat_abcdefghijklmnopqrstuvwxyz123456",
		twilioKey,
		"EAAAabcdefghijklmnopqrstuvwxyz123456",
		"abcdefghijklmnopqrstuvwxyz1234567890/+=",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"sendgrid_key",
		"mailgun_key",
		"stripe_webhook_secret",
		"shopify_access_token",
		"twilio_key",
		"square_token",
		"aws_secret_access_key_assignment",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactStringCoversLaunchBillingTaxAndAccountingSecrets(t *testing.T) {
	input := strings.Join([]string{
		"paddle_api_key=pdl_live_abcdefghijklmnopqrstuvwxyz123456",
		"paddle_vendor_auth_code=paddle-vendor-auth-secret",
		"lemonsqueezy_signing_secret=ls-signing-secret",
		"chargebee_api_key=chargebee-secret-value",
		"recurly_private_api_key=recurly-secret-value",
		"braintree_private_key=braintree-private-secret",
		"paypal_client_secret=paypal-client-secret",
		"adyen_hmac_key=adyen-hmac-secret",
		"taxjar_api_key=taxjar-secret-value",
		"avalara_license_key=avalara-license-secret",
		"quickbooks_refresh_token=quickbooks-refresh-secret",
		"xero_access_token=xero-access-secret",
	}, " ")
	got := RedactString(input)

	for _, leaked := range []string{
		"pdl_live_abcdefghijklmnopqrstuvwxyz123456",
		"paddle-vendor-auth-secret",
		"ls-signing-secret",
		"chargebee-secret-value",
		"recurly-secret-value",
		"braintree-private-secret",
		"paypal-client-secret",
		"adyen-hmac-secret",
		"taxjar-secret-value",
		"avalara-license-secret",
		"quickbooks-refresh-secret",
		"xero-access-secret",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}

	findings := ClassifyString(input)
	for _, kind := range []SecretKind{
		SecretKindAPIKey,
		SecretKindToken,
		SecretKindWebhookSecret,
		SecretKindPrivateKey,
		SecretKindCredential,
	} {
		assertKind(t, findings, kind)
	}
}

func TestRedactMapCoversLaunchBillingTaxAndAccountingMetadataKeys(t *testing.T) {
	metadata := map[string]any{
		"billing": map[string]string{
			"paddle_client_secret":         "paddle-client-secret",
			"chargebee_webhook_secret":     "chargebee-webhook-secret",
			"braintree_merchant_account":   "braintree-merchant-account",
			"paypal_webhook_id":            "paypal-webhook-secret",
			"lemon_squeezy_webhook_secret": "lemon-webhook-secret",
		},
		"tax": map[string]any{
			"taxjar_token":       "taxjar-token-secret",
			"avalara_password":   "avalara-password-secret",
			"avalara_account_id": "avalara-account-secret",
		},
		"accounting": map[string]string{
			"quickbooks_client_secret": "quickbooks-client-secret",
			"xero_refresh_token":       "xero-refresh-secret",
		},
		"public": "ok",
	}

	redacted := RedactMap(metadata)
	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted metadata: %v", err)
	}
	for _, leaked := range []string{
		"paddle-client-secret",
		"chargebee-webhook-secret",
		"braintree-merchant-account",
		"paypal-webhook-secret",
		"lemon-webhook-secret",
		"taxjar-token-secret",
		"avalara-password-secret",
		"avalara-account-secret",
		"quickbooks-client-secret",
		"xero-refresh-secret",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), `"public":"ok"`) || !strings.Contains(string(body), Redacted) {
		t.Fatalf("redacted metadata = %s, want public field and redaction marker", string(body))
	}

	findings := ClassifyValue(metadata)
	for _, location := range []string{
		"billing.paddle_client_secret",
		"billing.chargebee_webhook_secret",
		"billing.braintree_merchant_account",
		"billing.paypal_webhook_id",
		"billing.lemon_squeezy_webhook_secret",
		"tax.taxjar_token",
		"tax.avalara_password",
		"tax.avalara_account_id",
		"accounting.quickbooks_client_secret",
		"accounting.xero_refresh_token",
	} {
		assertAnyFindingAt(t, findings, location)
	}
}

func TestRedactStringCoversLaunchDeployCloudAndSignedDeliverySecrets(t *testing.T) {
	doToken := "dop_v1_" + strings.Repeat("a", 64)
	input := strings.Join([]string{
		"digitalocean=" + doToken,
		"netlify=nfp_abcdefghijklmnopqrstuvwxyz123456",
		"railway=railway_abcdefghijklmnopqrstuvwxyz123456",
		"google_oauth=ya29.abcdefghijklmnopqrstuvwxyz123456",
		"firebase=AAAAabc1234:APA91babcdefghijklmnopqrstuvwxyz123456",
		"fly=FlyV1 fm2_lJPECAAAAAAACfEjR0Q1JKSkZFSFlYWTM0NTY3ODkw",
		"postgresql://db_user:db_pass@db.example.com:5432/zenart",
		"https://cdn.example.com/export.zip?Expires=1770000000&Policy=abcdef&Key-Pair-Id=K1234567890",
		"https://storage.googleapis.com/zenart/export.zip?GoogleAccessId=service@example.iam.gserviceaccount.com&X-Goog-Signature=abcdef",
		"service_account_json={\"private_key\":\"-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\"}",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		doToken,
		"nfp_abcdefghijklmnopqrstuvwxyz123456",
		"railway_abcdefghijklmnopqrstuvwxyz123456",
		"ya29.abcdefghijklmnopqrstuvwxyz123456",
		"AAAAabc1234:APA91babcdefghijklmnopqrstuvwxyz123456",
		"FlyV1 fm2_lJPECAAAAAAACfEjR0Q1JKSkZFSFlYWTM0NTY3ODkw",
		"db_user:db_pass",
		"1770000000",
		"service@example.iam.gserviceaccount.com",
		"-----BEGIN PRIVATE KEY-----",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"digitalocean_token",
		"netlify_token",
		"railway_token",
		"google_oauth_token",
		"firebase_server_key",
		"fly_token",
		"url_credentials",
		"url_query_secret",
		"assignment:key_name",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactStringCoversLaunchRegistryAndSecretManagerTokens(t *testing.T) {
	renderToken := "rnd_abcdefghijklmnopqrstuvwxyz123456"
	dopplerToken := "dp.pt.abcdefghijklmnopqrstuvwxyz123456"
	vaultToken := "hvs.abcdefghijklmnopqrstuvwxyz123456"
	input := strings.Join([]string{
		"docker_auth=dXNlcjpwYXNzd29yZC1zdXBlci1zZWNyZXQ=",
		`{"auths":{"registry.example.com":{"auth":"dXNlcjpwYXNzd29yZC1zdXBlci1zZWNyZXQ="}}}`,
		"github_app_private_key=LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tYWJjZGVmZ2hpams=",
		"render=" + renderToken,
		"doppler=" + dopplerToken,
		"vault=" + vaultToken,
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"dXNlcjpwYXNzd29yZC1zdXBlci1zZWNyZXQ=",
		"LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tYWJjZGVmZ2hpams=",
		renderToken,
		dopplerToken,
		vaultToken,
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"docker_auth_token",
		"dockerconfigjson_auth",
		"github_app_private_key",
		"render_api_key",
		"doppler_token",
		"vault_token",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactStringCoversStoragePostPolicyAndCustomerEncryptionSecrets(t *testing.T) {
	customerKey := strings.Repeat("A", 44)
	input := strings.Join([]string{
		"https://bucket.s3.amazonaws.com/export.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260527%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Policy=eyJleHBpcmF0aW9uIjoiMjAyNiJ9&X-Amz-Signature=abcdef123456&X-Amz-Security-Token=session-token",
		"https://storage.googleapis.com/zenart/export.zip?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=service@example.iam.gserviceaccount.com&X-Goog-Signature=googabcdef&GoogleAccessId=service@example.iam.gserviceaccount.com",
		"x-amz-server-side-encryption-customer-key=" + customerKey,
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"AKIAIOSFODNN7EXAMPLE",
		"eyJleHBpcmF0aW9uIjoiMjAyNiJ9",
		"abcdef123456",
		"session-token",
		"GOOG4-RSA-SHA256",
		"service@example.iam.gserviceaccount.com",
		"googabcdef",
		customerKey,
		"eyJwb2xpY3kiOiJzZWNyZXQifQ==",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if !strings.Contains(got, Redacted) {
		t.Fatalf("RedactString() = %q, want redaction marker", got)
	}

	jsonInput := `{"fields":{"x-amz-policy":"eyJwb2xpY3kiOiJzZWNyZXQifQ==","x-amz-server-side-encryption-customer-key":"` + customerKey + `","success_action_status":"201"}}`
	jsonGot := RedactString(jsonInput)
	for _, leaked := range []string{
		"eyJwb2xpY3kiOiJzZWNyZXQifQ==",
		customerKey,
	} {
		if strings.Contains(jsonGot, leaked) {
			t.Fatalf("RedactString(JSON) = %q, leaked %s", jsonGot, leaked)
		}
	}
	if !strings.Contains(jsonGot, "success_action_status") || !strings.Contains(jsonGot, Redacted) {
		t.Fatalf("RedactString(JSON) = %q, want public POST policy fields and redaction marker", jsonGot)
	}

	findings := append(ClassifyString(input), ClassifyString(jsonInput)...)
	assertSignal(t, findings, "url_query_secret")
	assertSignal(t, findings, "sse_customer_key_assignment")
}

func TestRedactValueCoversStorageQueryMapsAndKubernetesPullSecrets(t *testing.T) {
	queryValues := url.Values{
		"X-Amz-Policy": []string{"eyJwb2xpY3kiOiJzZWNyZXQifQ=="},
		"X-Amz-Server-Side-Encryption-Customer-Key":             []string{strings.Repeat("A", 44)},
		"X-Goog-Algorithm":                                      []string{"GOOG4-RSA-SHA256"},
		"access_token":                                          []string{"ya29.abcdefghijklmnopqrstuvwxyz123456"},
		"response-content-disposition":                          []string{"attachment; filename=export.zip"},
		"X-Amz-Copy-Source-Server-Side-Encryption-Customer-Key": []string{strings.Repeat("B", 44)},
	}
	redactedQuery, ok := RedactValue(queryValues).(map[string][]string)
	if !ok {
		t.Fatalf("RedactValue(url.Values) type = %T, want map[string][]string", RedactValue(queryValues))
	}
	for _, key := range []string{
		"X-Amz-Policy",
		"X-Amz-Server-Side-Encryption-Customer-Key",
		"X-Goog-Algorithm",
		"access_token",
		"X-Amz-Copy-Source-Server-Side-Encryption-Customer-Key",
	} {
		if got := redactedQuery[key][0]; got != Redacted {
			t.Fatalf("redacted query[%s] = %q, want redacted", key, got)
		}
	}
	if redactedQuery["response-content-disposition"][0] != "attachment; filename=export.zip" {
		t.Fatalf("public response override redacted unexpectedly: %#v", redactedQuery["response-content-disposition"])
	}

	metadata := map[string]any{
		"imagePullSecret": "dXNlcjpwYXNzd29yZC1zdXBlci1zZWNyZXQ=",
		"dockercfg":       "eyJhdXRocyI6eyJyZWdpc3RyeS5leGFtcGxlLmNvbSI6eyJhdXRoIjoiZFhObGNqcHdZWE56In19fQ==",
		"public":          "visible",
	}
	body, err := json.Marshal(RedactValue(metadata))
	if err != nil {
		t.Fatalf("marshal redacted storage metadata: %v", err)
	}
	for _, leaked := range []string{
		"dXNlcjpwYXNzd29yZC1zdXBlci1zZWNyZXQ=",
		"eyJhdXRocyI6eyJyZWdpc3RyeS5leGFtcGxlLmNvbSI6eyJhdXRoIjoiZFhObGNqcHdZWE56In19fQ==",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted metadata = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), `"public":"visible"`) || !strings.Contains(string(body), Redacted) {
		t.Fatalf("redacted metadata = %s, want public value and redaction marker", string(body))
	}

	findings := ClassifyValue(map[string]any{"query": queryValues, "metadata": metadata})
	assertFinding(t, findings, SecretKindSignedURL, "query.X-Amz-Policy")
	assertFinding(t, findings, SecretKindEncryptionKey, "query.X-Amz-Server-Side-Encryption-Customer-Key")
	assertFinding(t, findings, SecretKindRegistryAuth, "metadata.imagePullSecret")
	assertFinding(t, findings, SecretKindRegistryAuth, "metadata.dockercfg")
}

func TestRedactValueCoversKubernetesSecretPayloadContainers(t *testing.T) {
	input := map[string]any{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]any{
			"name":      "export-worker",
			"namespace": "staging",
		},
		"data": map[string]any{
			"username":      "YWRtaW4=",
			"config.json":   "eyJhdXRoIjoiZlhObGNqcHdZWE56In0=",
			"provider.yaml": "b3BlbmFpOiBzay1wcm9qLWFsZWFr",
		},
		"stringData": map[string]string{
			"password": "plain-password",
			"token":    "plain-token",
		},
	}

	body, err := json.Marshal(RedactValue(input))
	if err != nil {
		t.Fatalf("marshal redacted Kubernetes secret: %v", err)
	}
	for _, leaked := range []string{
		"YWRtaW4=",
		"eyJhdXRoIjoiZlhObGNqcHdZWE56In0=",
		"b3BlbmFpOiBzay1wcm9qLWFsZWFr",
		"plain-password",
		"plain-token",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted Kubernetes secret = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"kind":"Secret"`, `"name":"export-worker"`, `"username":"[REDACTED]"`, `"password":"[REDACTED]"`} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted Kubernetes secret = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(input)
	assertFinding(t, findings, SecretKindSecretPayload, "data.username")
	assertFinding(t, findings, SecretKindSecretPayload, "data.config.json")
	assertFinding(t, findings, SecretKindSecretPayload, "stringData.password")
}

func TestRedactValueCoversTypedKubernetesSecretPayloadContainers(t *testing.T) {
	type kubernetesSecret struct {
		APIVersion string            `json:"apiVersion"`
		Kind       string            `json:"kind"`
		Data       map[string]string `json:"data"`
		Public     string            `json:"public"`
	}
	input := kubernetesSecret{
		APIVersion: "v1",
		Kind:       "Secret",
		Data: map[string]string{
			"tls.crt": "LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t",
			"tls.key": "LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t",
		},
		Public: "visible",
	}

	body, err := json.Marshal(RedactValue(input))
	if err != nil {
		t.Fatalf("marshal redacted typed Kubernetes secret: %v", err)
	}
	for _, leaked := range []string{
		"LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t",
		"LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted typed Kubernetes secret = %s, leaked %s", string(body), leaked)
		}
	}
	if !strings.Contains(string(body), `"public":"visible"`) || !strings.Contains(string(body), Redacted) {
		t.Fatalf("redacted typed Kubernetes secret = %s, want public value and redaction marker", string(body))
	}

	findings := ClassifyValue(input)
	assertFinding(t, findings, SecretKindSecretPayload, "data.tls.crt")
	assertFinding(t, findings, SecretKindSecretPayload, "data.tls.key")
}

func TestRedactValueCoversStructuredSignedURLMetadataMaps(t *testing.T) {
	input := map[string]any{
		"aws": map[string]any{
			"X-Amz-Algorithm":       "AWS4-HMAC-SHA256",
			"X-Amz-Credential":      "AKIAIOSFODNN7EXAMPLE/20260527/us-east-1/s3/aws4_request",
			"X-Amz-Date":            "20260527T120000Z",
			"X-Amz-Expires":         "900",
			"X-Amz-SignedHeaders":   "host",
			"X-Amz-Signature":       "abcdef123456",
			"response-content-type": "application/zip",
		},
		"google": map[string]string{
			"X-Goog-Algorithm":      "GOOG4-RSA-SHA256",
			"X-Goog-Credential":     "service@example.iam.gserviceaccount.com",
			"X-Goog-Date":           "20260527T120000Z",
			"X-Goog-Expires":        "600",
			"X-Goog-SignedHeaders":  "host",
			"X-Goog-Signature":      "googabcdef",
			"response-content-type": "application/zip",
		},
		"azure": map[string][]any{
			"sv":    []any{"2024-01-01"},
			"se":    []any{"2026-05-27T13:00:00Z"},
			"sp":    []any{"r"},
			"sip":   []any{"203.0.113.10"},
			"si":    []any{"stored-policy-id"},
			"ses":   []any{"encryption-scope"},
			"saoid": []any{"signed-authorized-object-id"},
			"suoid": []any{"signed-unauthorized-object-id"},
			"scid":  []any{"signed-correlation-id"},
			"sig":   []any{"azure-signature"},
			"rsct":  []any{"application/zip"},
		},
		"cos": map[string]string{
			"q-sign-algorithm":      "sha1",
			"q-ak":                  "cos-access-key",
			"q-sign-time":           "1770000000;1770000900",
			"q-key-time":            "1770000000;1770000900",
			"q-header-list":         "host",
			"q-url-param-list":      "ci-process",
			"q-signature":           "cos-signature",
			"response-content-type": "application/zip",
		},
		"edge": map[string]string{
			"Cloud-CDN-Signature":             "gcp-cdn-signature",
			"Cloud-CDN-Policy":                "gcp-cdn-policy",
			"Cloud-CDN-Key-Name":              "gcp-key-name",
			"URLPrefix":                       "gcp-url-prefix",
			"CDN-Token":                       "generic-cdn-token",
			"CF-Authorization":                "cloudflare-signed-token",
			"Cloudflare-Access-Jwt-Assertion": "cf-access-jwt",
			"response-content-disposition":    "attachment",
		},
		"public": map[string]any{
			"expires": "visible-business-expiry",
			"policy":  "public-export-policy-name",
		},
	}

	body, err := json.Marshal(RedactValue(input))
	if err != nil {
		t.Fatalf("marshal structured signed URL metadata: %v", err)
	}
	for _, leaked := range []string{
		"AWS4-HMAC-SHA256",
		"AKIAIOSFODNN7EXAMPLE",
		"20260527T120000Z",
		"abcdef123456",
		"GOOG4-RSA-SHA256",
		"service@example.iam.gserviceaccount.com",
		"googabcdef",
		"2024-01-01",
		"2026-05-27T13:00:00Z",
		"203.0.113.10",
		"stored-policy-id",
		"encryption-scope",
		"signed-authorized-object-id",
		"signed-unauthorized-object-id",
		"signed-correlation-id",
		"azure-signature",
		"cos-access-key",
		"1770000000;1770000900",
		"cos-signature",
		"gcp-cdn-signature",
		"gcp-cdn-policy",
		"gcp-key-name",
		"gcp-url-prefix",
		"generic-cdn-token",
		"cloudflare-signed-token",
		"cf-access-jwt",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted structured signed URL metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{
		`"response-content-type":"application/zip"`,
		`"response-content-disposition":"attachment"`,
		`"rsct":["application/zip"]`,
		`"expires":"visible-business-expiry"`,
		`"policy":"public-export-policy-name"`,
		Redacted,
	} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted structured signed URL metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(input)
	for _, location := range []string{
		"aws.X-Amz-Date",
		"aws.X-Amz-Expires",
		"aws.X-Amz-SignedHeaders",
		"google.X-Goog-Date",
		"google.X-Goog-Expires",
		"google.X-Goog-SignedHeaders",
		"azure.sv",
		"azure.se",
		"azure.sp",
		"azure.sip",
		"azure.si",
		"azure.ses",
		"azure.saoid",
		"azure.suoid",
		"azure.scid",
		"azure.sig",
		"cos.q-sign-algorithm",
		"cos.q-ak",
		"cos.q-signature",
		"edge.Cloud-CDN-Signature",
		"edge.Cloud-CDN-Policy",
		"edge.Cloud-CDN-Key-Name",
		"edge.URLPrefix",
		"edge.CDN-Token",
		"edge.CF-Authorization",
		"edge.Cloudflare-Access-Jwt-Assertion",
	} {
		assertFinding(t, findings, SecretKindSignedURL, location)
	}
}

func TestRedactValueCoversTypedStructuredSignedURLMaps(t *testing.T) {
	type delivery struct {
		SignedFields map[string]string `json:"signed_fields"`
		Public       string            `json:"public"`
	}
	value := delivery{
		SignedFields: map[string]string{
			"CloudFront-Signature":   "cf-signature",
			"CloudFront-Policy":      "cf-policy",
			"CloudFront-Key-Pair-Id": "cf-keypair",
			"response-content-type":  "application/zip",
		},
		Public: "ok",
	}

	body, err := json.Marshal(RedactValue(value))
	if err != nil {
		t.Fatalf("marshal typed delivery: %v", err)
	}
	for _, leaked := range []string{"cf-signature", "cf-policy", "cf-keypair"} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted typed delivery = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"public":"ok"`, `"response-content-type":"application/zip"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted typed delivery = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(value)
	assertFinding(t, findings, SecretKindSignedURL, "signed_fields.CloudFront-Signature")
	assertFinding(t, findings, SecretKindSignedURL, "signed_fields.CloudFront-Policy")
	assertFinding(t, findings, SecretKindSignedURL, "signed_fields.CloudFront-Key-Pair-Id")
}

func TestClassifyKeyCoversLaunchSecretNames(t *testing.T) {
	cases := []struct {
		key  string
		kind SecretKind
	}{
		{key: "x_api_key", kind: SecretKindAPIKey},
		{key: "private_token", kind: SecretKindPrivateKey},
		{key: "deploy_key", kind: SecretKindPrivateKey},
		{key: "proxy_authorization", kind: SecretKindAuthorization},
		{key: "service_account_json", kind: SecretKindServiceAcct},
		{key: "CONNECTION_STRING", kind: SecretKindCredential},
		{key: "personal_access_token", kind: SecretKindToken},
		{key: "dockerconfigjson", kind: SecretKindRegistryAuth},
		{key: "registry_password", kind: SecretKindRegistryAuth},
		{key: "clientSecret", kind: SecretKindCredential},
		{key: "clientAssertion", kind: SecretKindCredential},
		{key: "accessToken", kind: SecretKindToken},
		{key: "refreshToken", kind: SecretKindToken},
		{key: "idToken", kind: SecretKindToken},
		{key: "authToken", kind: SecretKindToken},
		{key: "secretKey", kind: SecretKindSensitiveKey},
		{key: "subscriptionKey", kind: SecretKindAccessKey},
		{key: "storageAccountKey", kind: SecretKindAccessKey},
		{key: "openRouterApiKey", kind: SecretKindAPIKey},
		{key: "perplexityApiKey", kind: SecretKindAPIKey},
		{key: "xaiApiKey", kind: SecretKindAPIKey},
		{key: "fireworksApiKey", kind: SecretKindAPIKey},
		{key: "falApiKey", kind: SecretKindAPIKey},
		{key: "elevenlabsApiKey", kind: SecretKindAPIKey},
		{key: "figmaAccessToken", kind: SecretKindToken},
		{key: "langsmithApiKey", kind: SecretKindAPIKey},
		{key: "databaseUrl", kind: SecretKindCredential},
		{key: "serviceAccountJSON", kind: SecretKindServiceAcct},
		{key: "registryPassword", kind: SecretKindRegistryAuth},
		{key: "imagePullSecret", kind: SecretKindRegistryAuth},
		{key: "dockercfg", kind: SecretKindRegistryAuth},
		{key: "xAmzServerSideEncryptionCustomerKey", kind: SecretKindEncryptionKey},
		{key: "sseCustomerKey", kind: SecretKindEncryptionKey},
		{key: "newRelicLicenseKey", kind: SecretKindToken},
		{key: "splunkHECToken", kind: SecretKindToken},
		{key: "honeycombTeam", kind: SecretKindToken},
		{key: "otelHeaders", kind: SecretKindToken},
		{key: "terraformCloudToken", kind: SecretKindToken},
		{key: "snykToken", kind: SecretKindToken},
		{key: "circleCIToken", kind: SecretKindToken},
		{key: "buildkiteAgentToken", kind: SecretKindToken},
		{key: "oktaClientSecret", kind: SecretKindCredential},
		{key: "redisUrl", kind: SecretKindCredential},
		{key: "smtpDsn", kind: SecretKindCredential},
		{key: "elasticsearchUrl", kind: SecretKindCredential},
		{key: "opensearchUrl", kind: SecretKindCredential},
		{key: "elasticCloudAuth", kind: SecretKindCredential},
		{key: "clickhouseUrl", kind: SecretKindCredential},
		{key: "metabaseSecretKey", kind: SecretKindToken},
		{key: "grafanaServiceAccountToken", kind: SecretKindToken},
	}

	for _, tt := range cases {
		findings := ClassifyKey(tt.key)
		if len(findings) == 0 {
			t.Fatalf("ClassifyKey(%q) returned no findings", tt.key)
		}
		if findings[0].Kind != tt.kind {
			t.Fatalf("ClassifyKey(%q) kind = %s, want %s", tt.key, findings[0].Kind, tt.kind)
		}
	}
}

func TestRedactStringCoversLaunchInfraDSNsAndTokens(t *testing.T) {
	input := strings.Join([]string{
		"redis_url=redis://default:redis-password@redis.internal:6379/0",
		"smtp_dsn=smtp://mailer:smtp-password@smtp.internal:587",
		"elasticsearch_url=https://elastic:elastic-password@search.internal:9200",
		"opensearch_url=https://opensearch:opensearch-password@search.internal:9200",
		"clickhouse_url=clickhouse://analytics:clickhouse-password@clickhouse.internal:9440/zenart",
		"elastic_api_key=abcdefghijklmnopqrstuvwxyz1234567890ABCD==",
		"metabase_session=abcdefghijklmnopqrstuvwxyz1234567890",
		"Authorization: ApiKey abcdefghijklmnopqrstuvwxyz123456",
	}, " ")
	got := RedactString(input)

	for _, leaked := range []string{
		"redis-password",
		"smtp-password",
		"elastic-password",
		"opensearch-password",
		"clickhouse-password",
		"abcdefghijklmnopqrstuvwxyz1234567890ABCD==",
		"abcdefghijklmnopqrstuvwxyz1234567890",
		"abcdefghijklmnopqrstuvwxyz123456",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if strings.Count(got, Redacted) < 8 {
		t.Fatalf("RedactString() = %q, want launch infra secrets redacted", got)
	}

	findings := ClassifyString(input)
	assertFinding(t, findings, SecretKindCredential, "")
	assertFinding(t, findings, SecretKindToken, "")
	assertFinding(t, findings, SecretKindAuthorization, "")
}

func TestRedactMapCoversLaunchInfraStructuredMetadata(t *testing.T) {
	redacted := RedactMap(map[string]any{
		"redisUrl":                   "redis://default:redis-password@redis.internal:6379/0",
		"smtpDsn":                    "smtp://mailer:smtp-password@smtp.internal:587",
		"elasticCloudAuth":           "elastic:cloud-password",
		"grafanaServiceAccountToken": "glsa_abcdefghijklmnopqrstuvwxyz123456",
		"metabaseSessionCookie":      "abcdefghijklmnopqrstuvwxyz1234567890",
		"public_endpoint":            "https://status.example.test",
	})
	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted infra metadata: %v", err)
	}
	for _, leaked := range []string{
		"redis-password",
		"smtp-password",
		"cloud-password",
		"glsa_abcdefghijklmnopqrstuvwxyz123456",
		"abcdefghijklmnopqrstuvwxyz1234567890",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted infra metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"public_endpoint":"https://status.example.test"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted infra metadata = %s, missing %s", string(body), fragment)
		}
	}
}

func TestRedactStringCoversLaunchExportRenderAndDesignSecrets(t *testing.T) {
	input := strings.Join([]string{
		"cloudconvert_api_key=cloudconvert-secret-value",
		"convertapi_secret=convertapi-secret-value",
		"browserless_token=browserless-secret-value",
		"browserbase_api_key=browserbase-secret-value",
		"screenshotone_access_key=screenshotone-secret-value",
		"urlbox_api_secret=urlbox-secret-value",
		"htmlcsstoimage_api_key=hcti-secret-value",
		"docraptor_api_key=docraptor-secret-value",
		"pdfshift_api_key=pdfshift-secret-value",
		"pdfco_api_key=pdfco-secret-value",
		"aspose_client_secret=aspose-secret-value",
		"cloudinary_api_secret=cloudinary-secret-value",
		"uploadcare_secret_key=uploadcare-secret-value",
		"imagekit_private_key=imagekit-secret-value",
		"filestack_security_secret=filestack-secret-value",
		"shotstack_api_key=shotstack-secret-value",
		"bannerbear_project_api_key=bannerbear-secret-value",
		"renderform_workspace_secret=renderform-secret-value",
		"figma_personal_access_token=figd_abcdefghijklmnopqrstuvwxyz123456",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"cloudconvert-secret-value",
		"convertapi-secret-value",
		"browserless-secret-value",
		"browserbase-secret-value",
		"screenshotone-secret-value",
		"urlbox-secret-value",
		"hcti-secret-value",
		"docraptor-secret-value",
		"pdfshift-secret-value",
		"pdfco-secret-value",
		"aspose-secret-value",
		"cloudinary-secret-value",
		"uploadcare-secret-value",
		"imagekit-secret-value",
		"filestack-secret-value",
		"shotstack-secret-value",
		"bannerbear-secret-value",
		"renderform-secret-value",
		"figd_abcdefghijklmnopqrstuvwxyz123456",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if strings.Count(got, Redacted) < 19 {
		t.Fatalf("RedactString() = %q, want export render and design secrets redacted", got)
	}

	findings := ClassifyString(input)
	assertFinding(t, findings, SecretKindAPIKey, "")
	assertFinding(t, findings, SecretKindCredential, "")
	assertFinding(t, findings, SecretKindProviderKey, "")
}

func TestRedactMapCoversLaunchExportRenderAndDesignMetadata(t *testing.T) {
	metadata := map[string]any{
		"export": map[string]any{
			"cloudconvertApiKey":        "cloudconvert-secret-value",
			"convertapiSecret":          "convertapi-secret-value",
			"docraptorApiKey":           "docraptor-secret-value",
			"pdfshiftApiKey":            "pdfshift-secret-value",
			"filestackSecuritySecret":   "filestack-secret-value",
			"renderformWorkspaceSecret": "renderform-secret-value",
			"publicTemplateId":          "template_launch_1",
		},
		"thumbnail": map[string]any{
			"browserlessToken":       "browserless-secret-value",
			"screenshotoneAccessKey": "screenshotone-secret-value",
			"htmlcsstoimageApiKey":   "hcti-secret-value",
			"cloudinaryApiSecret":    "cloudinary-secret-value",
			"imagekitPrivateKey":     "imagekit-secret-value",
			"publicDeliveryFolder":   "tenant-safe-thumbnails",
		},
		"design": map[string]any{
			"figmaPersonalAccessToken": "figd_abcdefghijklmnopqrstuvwxyz123456",
			"figmaClientSecret":        "figma-client-secret",
			"publicFigmaFileKey":       "FigmaPublicFile123",
		},
	}

	body, err := json.Marshal(RedactValue(metadata))
	if err != nil {
		t.Fatalf("marshal redacted export render metadata: %v", err)
	}
	for _, leaked := range []string{
		"cloudconvert-secret-value",
		"convertapi-secret-value",
		"docraptor-secret-value",
		"pdfshift-secret-value",
		"filestack-secret-value",
		"renderform-secret-value",
		"browserless-secret-value",
		"screenshotone-secret-value",
		"hcti-secret-value",
		"cloudinary-secret-value",
		"imagekit-secret-value",
		"figd_abcdefghijklmnopqrstuvwxyz123456",
		"figma-client-secret",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted export render metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"publicTemplateId":"template_launch_1"`, `"publicDeliveryFolder":"tenant-safe-thumbnails"`, `"publicFigmaFileKey":"FigmaPublicFile123"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted export render metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(metadata)
	assertFinding(t, findings, SecretKindAPIKey, "export.cloudconvertApiKey")
	assertFinding(t, findings, SecretKindCredential, "export.filestackSecuritySecret")
	assertFinding(t, findings, SecretKindPrivateKey, "thumbnail.imagekitPrivateKey")
	assertFinding(t, findings, SecretKindProviderKey, "design.figmaPersonalAccessToken")
}

func TestRedactStringCoversLaunchDataWarehouseCredentials(t *testing.T) {
	input := strings.Join([]string{
		"snowflake_private_key=-----BEGIN_PRIVATE_KEY-----abcdef",
		"snowflake_password=snowflake-password",
		"bigquery_service_account={\"private_key\":\"bq-private-key\"}",
		"GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcp-prod.json",
		"databricks_token=databricks-token-redaction-fixture",
		"dbt_cloud_token=dbtc_abcdefghijklmnopqrstuvwxyz123456",
		"airbyte_client_secret=airbyte-secret",
		"fivetran_api_secret=fivetran-secret",
		"motherduck_token=md_abcdefghijklmnopqrstuvwxyz123456",
		"neon_database_url=postgres://app:neon-password@ep-test.neon.tech/zenart",
		"planetscale_service_token=pscale_tkn_abcdefghijklmnopqrstuvwxyz",
		"turso_auth_token=turso-secret",
		"libsql_auth_token=libsql-secret",
		"aiven_api_token=aiven-secret",
		"cockroach_url=postgresql://root:roach-password@roach.internal:26257/defaultdb",
		"mongodb_uri=mongodb+srv://app:mongo-password@cluster.example.test/zenart",
		"mysql_dsn=mysql://app:mysql-password@mysql.internal:3306/zenart",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"-----BEGIN_PRIVATE_KEY-----abcdef",
		"snowflake-password",
		"bq-private-key",
		"/run/secrets/gcp-prod.json",
		"databricks-token-redaction-fixture",
		"dbtc_abcdefghijklmnopqrstuvwxyz123456",
		"airbyte-secret",
		"fivetran-secret",
		"md_abcdefghijklmnopqrstuvwxyz123456",
		"neon-password",
		"pscale_tkn_abcdefghijklmnopqrstuvwxyz",
		"turso-secret",
		"libsql-secret",
		"aiven-secret",
		"roach-password",
		"mongo-password",
		"mysql-password",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if strings.Count(got, Redacted) < 17 {
		t.Fatalf("RedactString() = %q, want launch data credentials redacted", got)
	}

	findings := ClassifyString(input)
	assertFinding(t, findings, SecretKindCredential, "")
	assertFinding(t, findings, SecretKindServiceAcct, "")
}

func TestRedactMapCoversLaunchDataWarehouseStructuredMetadata(t *testing.T) {
	redacted := RedactMap(map[string]any{
		"snowflakePrivateKey":          "snowflake-private-key",
		"bigqueryServiceAccount":       map[string]any{"private_key": "bq-private-key", "client_email": "svc@example.test"},
		"googleApplicationCredentials": "/run/secrets/gcp-prod.json",
		"databricksToken":              "databricks-token-redaction-fixture",
		"dbtCloudToken":                "dbtc_abcdefghijklmnopqrstuvwxyz123456",
		"airbyteClientSecret":          "airbyte-secret",
		"fivetranApiSecret":            "fivetran-secret",
		"motherduckToken":              "md_abcdefghijklmnopqrstuvwxyz123456",
		"neonDatabaseUrl":              "postgres://app:neon-password@ep-test.neon.tech/zenart",
		"planetscaleServiceToken":      "pscale_tkn_abcdefghijklmnopqrstuvwxyz",
		"tursoAuthToken":               "turso-secret",
		"libsqlAuthToken":              "libsql-secret",
		"aivenApiToken":                "aiven-secret",
		"cockroachUrl":                 "postgresql://root:roach-password@roach.internal:26257/defaultdb",
		"mongoUri":                     "mongodb+srv://app:mongo-password@cluster.example.test/zenart",
		"mysqlDsn":                     "mysql://app:mysql-password@mysql.internal:3306/zenart",
		"publicWarehouseRegion":        "us-east-1",
	})
	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted launch data metadata: %v", err)
	}
	for _, leaked := range []string{
		"snowflake-private-key",
		"bq-private-key",
		"/run/secrets/gcp-prod.json",
		"databricks-token-redaction-fixture",
		"dbtc_abcdefghijklmnopqrstuvwxyz123456",
		"airbyte-secret",
		"fivetran-secret",
		"md_abcdefghijklmnopqrstuvwxyz123456",
		"neon-password",
		"pscale_tkn_abcdefghijklmnopqrstuvwxyz",
		"turso-secret",
		"libsql-secret",
		"aiven-secret",
		"roach-password",
		"mongo-password",
		"mysql-password",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted launch data metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"publicWarehouseRegion":"us-east-1"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted launch data metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(map[string]any{
		"snowflakePrivateKey":          "snowflake-private-key",
		"bigqueryServiceAccount":       "service-account",
		"googleApplicationCredentials": "/run/secrets/gcp-prod.json",
		"databricksToken":              "databricks-token",
	})
	assertFinding(t, findings, SecretKindPrivateKey, "snowflakePrivateKey")
	assertFinding(t, findings, SecretKindServiceAcct, "bigqueryServiceAccount")
	assertFinding(t, findings, SecretKindServiceAcct, "googleApplicationCredentials")
	assertFinding(t, findings, SecretKindCredential, "databricksToken")
}

func TestRedactStringCoversPackageRegistryAndSCMSecrets(t *testing.T) {
	input := strings.Join([]string{
		"NODE_AUTH_TOKEN=npm_abcdefghijklmnopqrstuvwxyz123456",
		"PYPI_TOKEN=pypi-abcdefghijklmnopqrstuvwxyz123456",
		"TWINE_PASSWORD=twine-password-value",
		"RUBYGEMS_API_KEY=rubygems-secret-value",
		"CARGO_REGISTRY_TOKEN=cargo-secret-value",
		"COMPOSER_AUTH={\"github-oauth\":{\"github.com\":\"composer-github-token\"}}",
		"NUGET_API_KEY=nuget-secret-value",
		"MAVEN_SERVER_PASSWORD=maven-secret-value",
		"JFROG_ACCESS_TOKEN=jfrog-secret-value",
		"CLOUDSMITH_API_KEY=cloudsmith-secret-value",
		"GITLAB_DEPLOY_TOKEN=gldt-abcdefghijklmnopqrstuvwxyz123456",
		"BITBUCKET_APP_PASSWORD=bitbucket-secret-value",
		"SOURCEGRAPH_TOKEN=sourcegraph-secret-value",
		"GERRIT_HTTP_PASSWORD=gerrit-secret-value",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"npm_abcdefghijklmnopqrstuvwxyz123456",
		"pypi-abcdefghijklmnopqrstuvwxyz123456",
		"twine-password-value",
		"rubygems-secret-value",
		"cargo-secret-value",
		"composer-github-token",
		"nuget-secret-value",
		"maven-secret-value",
		"jfrog-secret-value",
		"cloudsmith-secret-value",
		"gldt-abcdefghijklmnopqrstuvwxyz123456",
		"bitbucket-secret-value",
		"sourcegraph-secret-value",
		"gerrit-secret-value",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if strings.Count(got, Redacted) < 14 {
		t.Fatalf("RedactString() = %q, want package registry and SCM secrets redacted", got)
	}

	findings := ClassifyString(input)
	for _, signal := range []string{
		"npm_token",
		"pypi_token",
		"gitlab_deploy_token",
		"assignment:key_name",
	} {
		assertSignal(t, findings, signal)
	}
}

func TestRedactMapCoversPackageRegistryAndSCMStructuredMetadata(t *testing.T) {
	redacted := RedactMap(map[string]any{
		"package_managers": map[string]any{
			"nodeAuthToken":       "npm_abcdefghijklmnopqrstuvwxyz123456",
			"pypiApiToken":        "pypi-abcdefghijklmnopqrstuvwxyz123456",
			"rubygemsApiKey":      "rubygems-secret-value",
			"cargoRegistryToken":  "cargo-secret-value",
			"composerGithubOAuth": "composer-github-token",
			"nugetApiKey":         "nuget-secret-value",
			"mavenPassword":       "maven-secret-value",
			"gradleToken":         "gradle-secret-value",
			"jfrogAccessToken":    "jfrog-secret-value",
			"artifactoryApiKey":   "artifactory-secret-value",
			"cloudsmithApiKey":    "cloudsmith-secret-value",
			"publicRegistry":      "https://registry.npmjs.org",
		},
		"scm": map[string]string{
			"gitlabDeployToken":  "gldt-abcdefghijklmnopqrstuvwxyz123456",
			"giteaDeployKey":     "gitea-deploy-key-value",
			"bitbucketToken":     "bitbucket-secret-value",
			"sourcegraphToken":   "sourcegraph-secret-value",
			"gerritHttpPassword": "gerrit-secret-value",
		},
	})
	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted package registry metadata: %v", err)
	}
	for _, leaked := range []string{
		"npm_abcdefghijklmnopqrstuvwxyz123456",
		"pypi-abcdefghijklmnopqrstuvwxyz123456",
		"rubygems-secret-value",
		"cargo-secret-value",
		"composer-github-token",
		"nuget-secret-value",
		"maven-secret-value",
		"gradle-secret-value",
		"jfrog-secret-value",
		"artifactory-secret-value",
		"cloudsmith-secret-value",
		"gldt-abcdefghijklmnopqrstuvwxyz123456",
		"gitea-deploy-key-value",
		"bitbucket-secret-value",
		"sourcegraph-secret-value",
		"gerrit-secret-value",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted package registry metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"publicRegistry":"https://registry.npmjs.org"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted package registry metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(map[string]any{
		"nodeAuthToken":       "npm_abcdefghijklmnopqrstuvwxyz123456",
		"pypiApiToken":        "pypi-abcdefghijklmnopqrstuvwxyz123456",
		"rubygemsApiKey":      "rubygems-secret-value",
		"cargoRegistryToken":  "cargo-secret-value",
		"composerGithubOAuth": "composer-github-token",
		"mavenPassword":       "maven-secret-value",
		"gitlabDeployToken":   "gldt-abcdefghijklmnopqrstuvwxyz123456",
		"giteaDeployKey":      "gitea-deploy-key-value",
	})
	assertFinding(t, findings, SecretKindToken, "nodeAuthToken")
	assertFinding(t, findings, SecretKindToken, "pypiApiToken")
	assertFinding(t, findings, SecretKindAPIKey, "rubygemsApiKey")
	assertFinding(t, findings, SecretKindRegistryAuth, "cargoRegistryToken")
	assertFinding(t, findings, SecretKindCredential, "composerGithubOAuth")
	assertFinding(t, findings, SecretKindPassword, "mavenPassword")
	assertFinding(t, findings, SecretKindToken, "gitlabDeployToken")
	assertFinding(t, findings, SecretKindPrivateKey, "giteaDeployKey")
}

func TestRedactStringCoversDeployPlatformAndSecretManagerSecrets(t *testing.T) {
	input := strings.Join([]string{
		"VERCEL_TOKEN=vercel-deploy-token-value",
		"VERCEL_AUTOMATION_BYPASS_SECRET=vercel-bypass-secret",
		"NETLIFY_AUTH_TOKEN=netlify-auth-token-value",
		"NETLIFY_BUILD_HOOK_URL=https://api.netlify.com/build_hooks/netlify-secret-hook",
		"RENDER_DEPLOY_HOOK_URL=https://api.render.com/deploy/srv-secret?key=render-hook-secret",
		"RAILWAY_TOKEN=railway-token-value",
		"FLY_ACCESS_TOKEN=FlyV1 fly-secret-token-value",
		"CLOUDFLARE_TUNNEL_TOKEN=cloudflare-tunnel-token-value",
		"TURNSTILE_SECRET_KEY=turnstile-secret-value",
		"RECAPTCHA_SECRET=recaptcha-secret-value",
		"HCAPTCHA_SECRET=hcaptcha-secret-value",
		"DOPPLER_TOKEN=dp.pt.dopplersecretfixture1234567890",
		"INFISICAL_CLIENT_SECRET=infisical-client-secret",
		"OP_SERVICE_ACCOUNT_TOKEN=opsvc-account-token",
		"VAULT_APPROLE_SECRET_ID=vault-approle-secret",
		"SOPS_AGE_KEY=AGE-SECRET-KEY-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	}, " ")

	got := RedactString(input)
	for _, leaked := range []string{
		"vercel-deploy-token-value",
		"vercel-bypass-secret",
		"netlify-auth-token-value",
		"netlify-secret-hook",
		"render-hook-secret",
		"railway-token-value",
		"fly-secret-token-value",
		"cloudflare-tunnel-token-value",
		"turnstile-secret-value",
		"recaptcha-secret-value",
		"hcaptcha-secret-value",
		"dp.pt.dopplersecretfixture1234567890",
		"infisical-client-secret",
		"opsvc-account-token",
		"vault-approle-secret",
		"AGE-SECRET-KEY-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	if strings.Count(got, Redacted) < 16 {
		t.Fatalf("RedactString() = %q, want deploy platform and secret manager secrets redacted", got)
	}

	findings := ClassifyString(input)
	for _, kind := range []SecretKind{
		SecretKindToken,
		SecretKindCredential,
		SecretKindWebhookSecret,
		SecretKindEncryptionKey,
	} {
		assertFinding(t, findings, kind, "")
	}
	assertSignal(t, findings, "assignment:key_name")
}

func TestRedactMapCoversDeployPlatformAndSecretManagerMetadata(t *testing.T) {
	redacted := RedactMap(map[string]any{
		"deploy": map[string]any{
			"vercelToken":                   "vercel-token-value",
			"vercelProjectProtectionBypass": "vercel-bypass-value",
			"netlifyBuildHook":              "netlify-hook-value",
			"renderApiKey":                  "render-api-key-value",
			"railwayProjectToken":           "railway-project-token",
			"flyDeployToken":                "fly-deploy-token",
			"cloudflarePagesDeployHook":     "cloudflare-pages-hook",
			"cloudflareTunnelToken":         "cloudflare-tunnel-token",
			"turnstileSecret":               "turnstile-secret",
			"recaptchaSecretKey":            "recaptcha-secret-key",
			"hcaptchaSecret":                "hcaptcha-secret",
			"publicRuntime":                 "nodejs20",
		},
		"secret_managers": map[string]string{
			"dopplerServiceToken":            "doppler-service-token",
			"infisicalUniversalAuthSecret":   "infisical-universal-secret",
			"onepasswordServiceAccountToken": "op-service-account-token",
			"vaultToken":                     "vault-token-value",
			"vaultTransitKey":                "vault-transit-key",
			"sopsAgeKey":                     "AGE-SECRET-KEY-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
		},
	})
	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted deploy platform metadata: %v", err)
	}
	for _, leaked := range []string{
		"vercel-token-value",
		"vercel-bypass-value",
		"netlify-hook-value",
		"render-api-key-value",
		"railway-project-token",
		"fly-deploy-token",
		"cloudflare-pages-hook",
		"cloudflare-tunnel-token",
		"turnstile-secret",
		"recaptcha-secret-key",
		"hcaptcha-secret",
		"doppler-service-token",
		"infisical-universal-secret",
		"op-service-account-token",
		"vault-token-value",
		"vault-transit-key",
		"AGE-SECRET-KEY-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted deploy platform metadata = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"publicRuntime":"nodejs20"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted deploy platform metadata = %s, missing %s", string(body), fragment)
		}
	}

	findings := ClassifyValue(map[string]any{
		"vercelToken":               "vercel-token-value",
		"netlifyBuildHook":          "netlify-hook-value",
		"renderApiKey":              "render-api-key-value",
		"vaultTransitKey":           "vault-transit-key",
		"cloudflareTurnstileSecret": "turnstile-secret",
	})
	assertFinding(t, findings, SecretKindToken, "vercelToken")
	assertFinding(t, findings, SecretKindWebhookSecret, "netlifyBuildHook")
	assertFinding(t, findings, SecretKindAPIKey, "renderApiKey")
	assertFinding(t, findings, SecretKindEncryptionKey, "vaultTransitKey")
	assertFinding(t, findings, SecretKindCredential, "cloudflareTurnstileSecret")
}

func TestRedactValueCoversMixedCaseLaunchSecretKeys(t *testing.T) {
	redacted := RedactValue(map[string]any{
		"clientSecret":       "client-secret-value",
		"accessToken":        "access-token-value",
		"refreshToken":       "refresh-token-value",
		"idToken":            "id-token-value",
		"authToken":          "auth-token-value",
		"secretKey":          "secret-key-value",
		"databaseUrl":        "postgres://user:pass@example.test:5432/zenart",
		"serviceAccountJSON": `{"private_key":"-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"}`,
		"registryPassword":   "registry-password-value",
		"publicLabel":        "visible",
	})

	body, err := json.Marshal(redacted)
	if err != nil {
		t.Fatalf("marshal redacted value: %v", err)
	}
	for _, leaked := range []string{
		"client-secret-value",
		"access-token-value",
		"refresh-token-value",
		"id-token-value",
		"auth-token-value",
		"secret-key-value",
		"user:pass",
		"-----BEGIN PRIVATE KEY-----",
		"registry-password-value",
	} {
		if strings.Contains(string(body), leaked) {
			t.Fatalf("redacted value = %s, leaked %s", string(body), leaked)
		}
	}
	for _, fragment := range []string{`"publicLabel":"visible"`, Redacted} {
		if !strings.Contains(string(body), fragment) {
			t.Fatalf("redacted value = %s, missing %s", string(body), fragment)
		}
	}
}

func TestRedactStringCoversMixedCaseRawJSONSecretKeys(t *testing.T) {
	input := `{"clientSecret":"client-secret-value","accessToken":"access-token-value","refreshToken":"refresh-token-value","idToken":"id-token-value","databaseUrl":"postgres://user:pass@example.test:5432/zenart","serviceAccountJSON":{"private_key":"-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"},"publicLabel":"visible"}`
	got := RedactString(input)

	for _, leaked := range []string{
		"client-secret-value",
		"access-token-value",
		"refresh-token-value",
		"id-token-value",
		"user:pass",
		"-----BEGIN PRIVATE KEY-----",
	} {
		if strings.Contains(got, leaked) {
			t.Fatalf("RedactString() = %q, leaked %s", got, leaked)
		}
	}
	for _, fragment := range []string{`"publicLabel":"visible"`, Redacted} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("RedactString() = %q, missing %s", got, fragment)
		}
	}

	findings := ClassifyString(input)
	assertFinding(t, findings, SecretKindCredential, "clientSecret")
	assertFinding(t, findings, SecretKindToken, "accessToken")
	assertFinding(t, findings, SecretKindToken, "refreshToken")
	assertFinding(t, findings, SecretKindToken, "idToken")
	assertFinding(t, findings, SecretKindCredential, "databaseUrl")
	assertFinding(t, findings, SecretKindServiceAcct, "serviceAccountJSON")
}

func TestRedactingSlogHandlerRedactsMessagesAttrsGroupsAndContextAttrs(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(NewRedactingSlogHandler(slog.NewJSONHandler(&logs, nil))).With(
		"startup_api_key", "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
	)
	logger.Error(
		"provider failed with hf_abcdefghijklmnopqrstuvwxyz123456",
		"error", errors.New("Authorization: Bearer abcdefghijklmnop"),
		"headers", http.Header{"X-Download": []string{"https://storage.local/file.zip?X-Amz-Signature=abcdef"}},
		slog.Group("provider", "api_key", "secret", "public", "ok"),
	)

	line := logs.String()
	for _, leaked := range []string{
		"sk-proj-abcdefghijklmnopqrstuvwxyz123456",
		"hf_abcdefghijklmnopqrstuvwxyz123456",
		"abcdefghijklmnop",
		"abcdef",
		`"api_key":"secret"`,
	} {
		if strings.Contains(line, leaked) {
			t.Fatalf("redacted slog line = %s, leaked %s", line, leaked)
		}
	}
	for _, fragment := range []string{Redacted, `"provider":{"api_key":"[REDACTED]","public":"ok"}`} {
		if !strings.Contains(line, fragment) {
			t.Fatalf("redacted slog line = %s, missing %s", line, fragment)
		}
	}
}

func TestRedactingSlogHandlerRedactsLogValuerAttrs(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(NewRedactingSlogHandler(slog.NewJSONHandler(&logs, nil)))
	logger.Warn(
		"audit event",
		"event", secretLogValuer{},
		"attrs", []slog.Attr{
			slog.String("signed_url", "https://storage.local/export.zip?X-Amz-Signature=abcdef"),
		},
	)

	line := logs.String()
	for _, leaked := range []string{
		"sk-ant-abcdefghijklmnopqrstuvwxyz123456",
		"abcdefghijklmnop",
		"abcdef",
	} {
		if strings.Contains(line, leaked) {
			t.Fatalf("redacted slog line = %s, leaked %s", line, leaked)
		}
	}
	for _, fragment := range []string{Redacted, `"public":"ok"`} {
		if !strings.Contains(line, fragment) {
			t.Fatalf("redacted slog line = %s, missing %s", line, fragment)
		}
	}
}

func TestClassifyValueCoversLaunchMetadataContainers(t *testing.T) {
	findings := ClassifyValue(map[string]any{
		"query": url.Values{
			"X-Goog-Signature": []string{"abcdef"},
		},
		"export_events": []map[string]any{
			{"download_url": "https://storage.local/export.zip?X-Amz-Signature=abcdef"},
		},
		"support_context": []map[string]string{
			{"api_key": "secret"},
		},
		"audit_headers": []map[string][]string{
			{"Authorization": []string{"Bearer abcdefghijklmnop"}},
		},
		"crawler_findings": map[string][]any{
			"source_urls": []any{"https://user:pass@example.test/source"},
		},
		"log_value": secretLogValuer{},
	})

	assertFinding(t, findings, SecretKindSignedURL, "query.X-Goog-Signature")
	assertFinding(t, findings, SecretKindSignedURL, "query.X-Goog-Signature[0]")
	assertFinding(t, findings, SecretKindSignedURL, "export_events[0].download_url")
	assertFinding(t, findings, SecretKindAPIKey, "support_context[0].api_key")
	assertFinding(t, findings, SecretKindAuthorization, "audit_headers[0].Authorization")
	assertFinding(t, findings, SecretKindDSN, "crawler_findings.source_urls[0]")
	assertFinding(t, findings, SecretKindProviderKey, "log_value.provider.provider_key")
	assertFinding(t, findings, SecretKindAuthorization, "log_value.provider.error")
}

func TestClassifyValueCoversHeadersAndStringSlices(t *testing.T) {
	findings := ClassifyValue(map[string]any{
		"headers": http.Header{
			"Authorization": []string{"Bearer abcdefghijklmnop"},
		},
		"events": []string{"token=npm_abcdefghijklmnopqrstuvwxyz123456"},
	})

	assertFinding(t, findings, SecretKindAuthorization, "headers.Authorization")
	assertFinding(t, findings, SecretKindAuthorization, "headers.Authorization[0]")
	assertFinding(t, findings, SecretKindToken, "events[0]")
}

func TestPlaceholderMalwareScannerReportsUnavailableAndForcedSuspicious(t *testing.T) {
	now := time.Date(2026, 5, 26, 1, 2, 3, 0, time.UTC)
	scanner := PlaceholderMalwareScanner{Now: func() time.Time { return now }}

	result, err := scanner.Scan(context.Background(), MalwareScanTarget{
		TenantID:    "tenant_1",
		ObjectKey:   "tenants/tenant_1/uploads/file.png",
		ContentType: "image/png",
		ByteSize:    123,
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if result.Status != MalwareScanStatusUnavailable || result.Provider != "stage0-placeholder" || !result.ScannedAt.Equal(now) {
		t.Fatalf("Scan() = %#v, want unavailable placeholder result", result)
	}

	result, err = scanner.Scan(context.Background(), MalwareScanTarget{
		TenantID:  "tenant_1",
		ObjectKey: "tenants/tenant_1/uploads/file.png",
		Metadata:  map[string]string{"stage0_force_malware_status": "suspicious"},
	})
	if err != nil {
		t.Fatalf("forced Scan() error = %v", err)
	}
	if result.Status != MalwareScanStatusSuspicious {
		t.Fatalf("forced Scan() status = %s, want suspicious", result.Status)
	}
}

func TestHTTPMalwareScannerPostsTargetAndRedactsMetadata(t *testing.T) {
	now := time.Date(2026, 5, 26, 12, 0, 0, 0, time.UTC)
	var received MalwareScanTarget
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer scan-secret" {
			t.Fatalf("Authorization = %q, want bearer API key", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		_ = json.NewEncoder(w).Encode(MalwareScanResult{
			Status:    " CLEAN ",
			Provider:  "scanner sk-ant-abcdefghijklmnopqrstuvwxyz123456",
			Rationale: "checked with Bearer abcdefghijklmnop",
			Metadata: map[string]string{
				"engine_version": "1",
				"api_key":        "secret",
			},
		})
	}))
	defer server.Close()

	result, err := (HTTPMalwareScanner{
		Endpoint: server.URL,
		APIKey:   "scan-secret",
		Timeout:  time.Second,
		Now:      func() time.Time { return now },
	}).Scan(context.Background(), MalwareScanTarget{
		TenantID:    "tenant_1",
		ObjectKey:   "uploads/file.png",
		ContentType: "image/png",
		ByteSize:    12,
		Metadata:    map[string]string{"slot": "reference", "api_key": "secret"},
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if received.TenantID != "tenant_1" || received.ObjectKey != "uploads/file.png" {
		t.Fatalf("received target = %#v", received)
	}
	if received.Metadata["api_key"] != Redacted {
		t.Fatalf("received metadata = %#v, want redacted before external scan", received.Metadata)
	}
	if result.Status != MalwareScanStatusClean || result.Signature != "http-v1" || !result.ScannedAt.Equal(now) {
		t.Fatalf("result = %#v, want clean defaulted result", result)
	}
	if strings.Contains(result.Provider, "sk-ant") || strings.Contains(result.Rationale, "abcdefghijklmnop") {
		t.Fatalf("result = %#v, want redacted provider/rationale", result)
	}
	if result.Metadata["api_key"] != Redacted || result.Metadata["engine_version"] != "1" {
		t.Fatalf("metadata = %#v, want redacted api_key and public engine version", result.Metadata)
	}
}

func TestHTTPMalwareScannerRejectsUnsupportedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(MalwareScanResult{Status: "infected sk-ant-abcdefghijklmnopqrstuvwxyz123456"})
	}))
	defer server.Close()

	_, err := (HTTPMalwareScanner{
		Endpoint: server.URL,
		Timeout:  time.Second,
	}).Scan(context.Background(), MalwareScanTarget{
		TenantID:  "tenant_1",
		ObjectKey: "uploads/file.png",
	})
	if err == nil {
		t.Fatal("Scan() error = nil, want unsupported status error")
	}
	if strings.Contains(err.Error(), "sk-ant-abcdefghijklmnopqrstuvwxyz123456") {
		t.Fatalf("Scan() error = %q, leaked scanner-supplied unsupported status secret", err.Error())
	}
	if !strings.Contains(err.Error(), Redacted) {
		t.Fatalf("Scan() error = %q, want redaction marker", err.Error())
	}
}

func TestHTTPMalwareScannerRejectsSecretBearingEndpoints(t *testing.T) {
	for _, tc := range []struct {
		name     string
		endpoint string
		wantText string
	}{
		{
			name:     "credentials",
			endpoint: "https://scanner:secret@scanner.example.test/scan",
			wantText: "must not include credentials",
		},
		{
			name:     "query",
			endpoint: "https://scanner.example.test/scan?api_key=secret",
			wantText: "must not include query parameters",
		},
		{
			name:     "fragment",
			endpoint: "https://scanner.example.test/scan#bearer-token",
			wantText: "must not include a fragment",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := (HTTPMalwareScanner{
				Endpoint: tc.endpoint,
				Timeout:  time.Second,
			}).Scan(context.Background(), MalwareScanTarget{
				TenantID:  "tenant_1",
				ObjectKey: "uploads/file.png",
			})
			if err == nil || !strings.Contains(err.Error(), tc.wantText) {
				t.Fatalf("Scan() error = %v, want %q", err, tc.wantText)
			}
		})
	}
}

func TestHTTPMalwareScannerRejectsLocalEndpointsWhenDenied(t *testing.T) {
	for _, endpoint := range []string{
		"http://localhost/scan",
		"http://127.0.0.1/scan",
		"http://10.1.2.3/scan",
		"http://[::1]/scan",
	} {
		t.Run(endpoint, func(t *testing.T) {
			_, err := (HTTPMalwareScanner{
				Endpoint:           endpoint,
				Timeout:            time.Second,
				DenyLocalEndpoints: true,
			}).Scan(context.Background(), MalwareScanTarget{
				TenantID:  "tenant_1",
				ObjectKey: "uploads/file.png",
			})
			if err == nil || !strings.Contains(err.Error(), "must not target localhost or private IP") {
				t.Fatalf("Scan() error = %v, want local endpoint denial", err)
			}
		})
	}
}

func TestHTTPMalwareScannerDeniesRedirectsWithoutForwardingAuth(t *testing.T) {
	redirected := false
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected = true
		if r.Header.Get("Authorization") != "" {
			t.Fatalf("redirect target received Authorization = %q", r.Header.Get("Authorization"))
		}
		_ = json.NewEncoder(w).Encode(MalwareScanResult{Status: MalwareScanStatusClean})
	}))
	defer sink.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, sink.URL+"/scan", http.StatusTemporaryRedirect)
	}))
	defer server.Close()

	_, err := (HTTPMalwareScanner{
		Endpoint: server.URL + "/scan",
		APIKey:   "scan-secret",
		Timeout:  time.Second,
	}).Scan(context.Background(), MalwareScanTarget{
		TenantID:  "tenant_1",
		ObjectKey: "uploads/file.png",
	})
	if err == nil || !strings.Contains(err.Error(), "redirect denied") {
		t.Fatalf("Scan() error = %v, want redirect denied", err)
	}
	if redirected {
		t.Fatal("redirect target was reached")
	}
}

func TestHTTPMalwareScannerRedactsNon2xxResponseBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`scanner failed with Authorization: Bearer abcdefghijklmnop and sk-ant-abcdefghijklmnopqrstuvwxyz123456`))
	}))
	defer server.Close()

	_, err := (HTTPMalwareScanner{
		Endpoint: server.URL,
		Timeout:  time.Second,
	}).Scan(context.Background(), MalwareScanTarget{
		TenantID:  "tenant_1",
		ObjectKey: "uploads/file.png",
	})
	if err == nil {
		t.Fatal("Scan() error = nil, want HTTP status error")
	}
	for _, leaked := range []string{"abcdefghijklmnop", "sk-ant-abcdefghijklmnopqrstuvwxyz123456"} {
		if strings.Contains(err.Error(), leaked) {
			t.Fatalf("Scan() error = %q, leaked %s", err.Error(), leaked)
		}
	}
	if !strings.Contains(err.Error(), Redacted) {
		t.Fatalf("Scan() error = %q, want redaction marker", err.Error())
	}
}

func assertFinding(t *testing.T, findings []SecretFinding, kind SecretKind, location string) {
	t.Helper()
	for _, finding := range findings {
		if finding.Kind == kind && finding.Location == location {
			return
		}
	}
	t.Fatalf("missing finding kind=%s location=%s in %#v", kind, location, findings)
}

func assertSignal(t *testing.T, findings []SecretFinding, signal string) {
	t.Helper()
	for _, finding := range findings {
		if finding.Signal == signal {
			return
		}
	}
	t.Fatalf("missing finding signal=%s in %#v", signal, findings)
}

func assertAnyFindingAt(t *testing.T, findings []SecretFinding, location string) {
	t.Helper()
	for _, finding := range findings {
		if finding.Location == location {
			return
		}
	}
	t.Fatalf("missing finding location=%s in %#v", location, findings)
}

func assertKind(t *testing.T, findings []SecretFinding, kind SecretKind) {
	t.Helper()
	for _, finding := range findings {
		if finding.Kind == kind {
			return
		}
	}
	t.Fatalf("missing finding kind=%s in %#v", kind, findings)
}

type stringerValue string

func (s stringerValue) String() string {
	return string(s)
}

type secretLogValuer struct{}

func (secretLogValuer) LogValue() slog.Value {
	return slog.GroupValue(
		slog.Group("provider",
			"provider_key", "sk-ant-abcdefghijklmnopqrstuvwxyz123456",
			"error", "Authorization: Bearer abcdefghijklmnop",
			"public", "ok",
		),
	)
}

type typedSecretEnvelope struct {
	Event  typedSecretEvent `json:"event"`
	Labels map[int]string   `json:"labels"`
}

type typedSecretEvent struct {
	CrawlerSourceURL string `json:"crawler_source_url"`
	Public           string `json:"public"`
}
