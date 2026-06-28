# Stage 1 Production Action Matrix

This is a short non-clearing action matrix. It does not clear production launch or do-not-launch.

Generated at: `2026-06-28T17:51:11+00:00`
Release decision: `no_go`
Stage1 gates: `6` / `14` = `42.9%`
Production inputs: `2` / `60` = `3.3%`
Blocking production inputs: `58`
Source probes ready: `0` / `4`

## Action Lanes

| Order | Lane | Owner | Blockers | Percent | First blocker |
| ---: | --- | --- | ---: | ---: | --- |
| 1 | Production DNS and HTTPS | operator_dns_control | 2 | 50.0% | system resolver failed for zenari.ai: [Errno 8] nodename nor servname provided, or not known |
| 2 | Production Stripe live billing lifecycle | operator_live_stripe_account | 20 | 0.0% | billing_proof_missing |
| 3 | Production security launch checks | agent_after_production_https_with_operator_refs | 10 | 0.0% | security_proof_missing |
| 4 | Production governance release evidence | operator_production_audit_refs | 26 | 0.0% | governance_proof_missing |

## Immediate Help Queue

1. production_dns_https: Provide PRODUCTION_DNS_TARGET plus Cloudflare zone/token, or apply the apex/www records manually.
   First required material: CLOUDFLARE_ZONE_ID or CF_ZONE_ID, CLOUDFLARE_API_TOKEN or CF_API_TOKEN
2. production_live_billing: Use live Stripe mode and collect sanitized live checkout, subscription, invoice, refund, quota, and webhook IDs.
   First required material: STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID, STAGE1_PROD_BILLING_CHECKOUT_CUSTOMER_ID, STAGE1_PROD_BILLING_PRICE_ID, STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_ID
3. production_security_runtime: Attach production runtime refs for session cookie, CSRF, redaction, admin privacy, key containment, CSP, RBAC, audit, and spend caps.
   First required material: STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF, STAGE1_PROD_SECURITY_CSRF_SAME_SITE_REF, STAGE1_PROD_SECURITY_SECRET_REDACTION_REF, STAGE1_PROD_SECURITY_ADMIN_SURFACE_PRIVACY_REF
4. production_governance_release: Provide activation, abuse, and skill release runtime request IDs plus immutable production audit refs.
   First required material: STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS, STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_REFS, STAGE1_PROD_GOVERNANCE_ACTIVATION_HIGH_RISK_RBAC_REF, STAGE1_PROD_GOVERNANCE_ACTIVATION_REVIEWER_RATIONALE_REF

## Lane Details

### 1. Production DNS and HTTPS

- Help kind: `cloudflare_zone_token_and_target_or_manual_dns_change`
- Blocking inputs: `2`
- Immediate action: Provide PRODUCTION_DNS_TARGET plus Cloudflare zone/token, or apply the apex/www records manually.
- Agent action after inputs: Run DNS readiness, cutover plan, legal/support source probe, and strict production legal/support evidence.
- Source output: `ops/evidence/production/production-legal-support-source.json`
- Strict validator: `python3 scripts/validate_stage1_production_legal_support_evidence.py`

Required material sample:
- CLOUDFLARE_ZONE_ID or CF_ZONE_ID
- CLOUDFLARE_API_TOKEN or CF_API_TOKEN

Automation commands after inputs:
```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --verify-cloudflare --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

```bash
python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json
```

### 2. Production Stripe live billing lifecycle

- Help kind: `live_stripe_runtime_and_sanitized_live_artifact_ids`
- Blocking inputs: `20`
- Immediate action: Use live Stripe mode and collect sanitized live checkout, subscription, invoice, refund, quota, and webhook IDs.
- Agent action after inputs: Validate the sanitized live billing proof, write canonical billing source, and generate strict billing evidence.
- Source output: `ops/evidence/production/billing-paid-lifecycle-source.json`
- Strict validator: `python3 scripts/validate_stage1_production_billing_evidence.py`

Required material sample:
- STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID
- STAGE1_PROD_BILLING_CHECKOUT_CUSTOMER_ID
- STAGE1_PROD_BILLING_PRICE_ID
- STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_ID
- STAGE1_PROD_BILLING_ACTIVE_CUSTOMER_ID
- STAGE1_PROD_BILLING_PAST_DUE_SUBSCRIPTION_ID
- STAGE1_PROD_BILLING_PAST_DUE_INVOICE_ID
- STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_ID
- STAGE1_PROD_BILLING_SEAT_QUANTITY
- STAGE1_PROD_BILLING_SYNCED_QUANTITY
- STAGE1_PROD_BILLING_SUBSCRIPTION_ITEM_ID
- STAGE1_PROD_BILLING_VISIBLE_INVOICE_ID

Automation commands after inputs:
```bash
python3 scripts/stage1_stripe_live_billing_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-live-billing-proof.candidate.json --checkout-session-id <cs_live_...> --checkout-customer-id <cus_...> --price-id <price_...> --active-subscription-id <sub_...> --active-customer-id <cus_...> --past-due-subscription-id <sub_...> --past-due-invoice-id <in_...> --cancel-subscription-id <sub_...> --seat-quantity <positive-int> --synced-quantity <same-positive-int> --subscription-item-id <si_...> --visible-invoice-id <in_...> --refund-charge-id <ch_...> --refund-id <re_...> --quota-reset-invoice-id <in_...> --webhook-event-ids <evt_...,evt_...> --failed-export-refund-id <re_...> --live-test-separation-ref <audit-or-runtime-ref> --paid-checkout-ref <audit-or-runtime-ref> --subscription-active-ref <audit-or-runtime-ref> --subscription-past-due-ref <audit-or-runtime-ref> --subscription-cancel-ref <audit-or-runtime-ref> --team-seat-ref <audit-or-runtime-ref> --invoice-visibility-ref <audit-or-runtime-ref> --lifecycle-audit-ref <audit-or-runtime-ref> --refund-credit-ref <audit-or-runtime-ref> --quota-reset-ref <audit-or-runtime-ref> --webhook-idempotency-ref <audit-or-runtime-ref> --failed-export-refund-ref <audit-or-runtime-ref> --quota-projection-ref <audit-or-runtime-ref> --refund-webhook-audit-ref <audit-or-runtime-ref>
```

```bash
python3 scripts/validate_stage1_stripe_live_billing_proof.py --proof ops/evidence/non_clearing/production-live-billing-proof.candidate.json
```

```bash
python3 scripts/stage1_production_source_probe.py --billing --release-sha $(git rev-parse HEAD) --billing-proof ops/evidence/non_clearing/production-live-billing-proof.candidate.json --diagnostic ops/evidence/production/source-probe-diagnostics.billing.json --write-canonical-source
```

```bash
python3 scripts/generate_stage1_production_billing_evidence.py --source ops/evidence/production/billing-paid-lifecycle-source.json
```

### 3. Production security launch checks

- Help kind: `production_runtime_security_refs`
- Blocking inputs: `10`
- Immediate action: Attach production runtime refs for session cookie, CSRF, redaction, admin privacy, key containment, CSP, RBAC, audit, and spend caps.
- Agent action after inputs: Validate the security proof, write canonical security source, and generate strict production security evidence.
- Source output: `ops/evidence/production/production-security-launch-source.json`
- Strict validator: `python3 scripts/validate_stage1_production_security_launch_evidence.py`

Required material sample:
- STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF
- STAGE1_PROD_SECURITY_CSRF_SAME_SITE_REF
- STAGE1_PROD_SECURITY_SECRET_REDACTION_REF
- STAGE1_PROD_SECURITY_ADMIN_SURFACE_PRIVACY_REF
- STAGE1_PROD_SECURITY_PROVIDER_KEY_CONTAINMENT_REF
- STAGE1_PROD_SECURITY_STRIPE_LIVE_TEST_SEPARATION_REF
- STAGE1_PROD_SECURITY_RATE_LIMIT_SPEND_CAP_REF
- STAGE1_PROD_SECURITY_CSP_HEADERS_REF
- STAGE1_PROD_SECURITY_RBAC_TENANT_ISOLATION_REF
- STAGE1_PROD_SECURITY_AUDIT_REF

Automation commands after inputs:
```bash
python3 scripts/stage1_production_security_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-security-proof.candidate.json --same-site lax --raw-secret-exposure-count 0 --frontend-secret-exposure-count 0 --secure-session-cookie-ref <production-runtime-or-audit-ref> --csrf-same-site-ref <production-runtime-or-audit-ref> --secret-redaction-ref <production-runtime-or-audit-ref> --admin-surface-privacy-ref <production-runtime-or-audit-ref> --provider-key-containment-ref <production-runtime-or-audit-ref> --stripe-live-test-separation-ref <production-runtime-or-audit-ref> --rate-limit-spend-cap-ref <production-runtime-or-audit-ref> --csp-headers-ref <production-runtime-or-audit-ref> --rbac-tenant-isolation-ref <production-runtime-or-audit-ref> --audit-ref <production-runtime-or-audit-ref>
```

```bash
python3 scripts/validate_stage1_production_security_proof.py --proof ops/evidence/non_clearing/production-security-proof.candidate.json
```

```bash
python3 scripts/stage1_production_source_probe.py --security --release-sha $(git rev-parse HEAD) --security-proof ops/evidence/non_clearing/production-security-proof.candidate.json --diagnostic ops/evidence/production/source-probe-diagnostics.security.json --write-canonical-source
```

```bash
python3 scripts/generate_stage1_production_security_launch_evidence.py --source ops/evidence/production/production-security-launch-source.json
```

### 4. Production governance release evidence

- Help kind: `production_runtime_request_ids_and_immutable_audit_refs`
- Blocking inputs: `26`
- Immediate action: Provide activation, abuse, and skill release runtime request IDs plus immutable production audit refs.
- Agent action after inputs: Validate governance proof, write canonical governance source, and generate strict governance release evidence.
- Source output: `ops/evidence/production/production-governance-release-source.json`
- Strict validator: `python3 scripts/validate_stage1_production_governance_release_evidence.py`

Required material sample:
- STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS
- STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_REFS
- STAGE1_PROD_GOVERNANCE_ACTIVATION_HIGH_RISK_RBAC_REF
- STAGE1_PROD_GOVERNANCE_ACTIVATION_REVIEWER_RATIONALE_REF
- STAGE1_PROD_GOVERNANCE_ACTIVATION_SECOND_REVIEW_REF
- STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_IMMUTABILITY_REF
- STAGE1_PROD_GOVERNANCE_ACTIVATION_GATES_REF
- STAGE1_PROD_GOVERNANCE_ABUSE_RUNTIME_REQUEST_IDS
- STAGE1_PROD_GOVERNANCE_ABUSE_AUDIT_REFS
- STAGE1_PROD_GOVERNANCE_ABUSE_ACCOUNT_HOLD_REF
- STAGE1_PROD_GOVERNANCE_ABUSE_RATE_LIMIT_REF
- STAGE1_PROD_GOVERNANCE_ABUSE_SPEND_CAP_OR_KILL_SWITCH_REF

Automation commands after inputs:
```bash
python3 scripts/stage1_production_governance_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-governance-proof.candidate.json --skill-risk-level <low|medium|high> --activation-runtime-request-ids <production-runtime-request-id[,id]> --activation-audit-refs <immutable-production-audit-ref[,ref]> --activation-high-risk-rbac-ref <production-activation-high-risk-rbac-ref> --activation-reviewer-rationale-ref <production-activation-reviewer-rationale-ref> --activation-second-review-ref <production-activation-second-review-ref> --activation-audit-immutability-ref <production-activation-audit-immutability-ref> --activation-gates-ref <production-activation-activation-gates-ref> --abuse-runtime-request-ids <production-runtime-request-id[,id]> --abuse-audit-refs <immutable-production-audit-ref[,ref]> --abuse-account-hold-ref <production-abuse-account-hold-ref> --abuse-rate-limit-ref <production-abuse-rate-limit-ref> --abuse-spend-cap-or-kill-switch-ref <production-abuse-spend-cap-or-kill-switch-ref> --abuse-rbac-audit-ref <production-abuse-rbac-audit-ref> --skill-runtime-request-ids <production-runtime-request-id[,id]> --skill-audit-refs <immutable-production-audit-ref[,ref]> --skill-owner-id <production-owner-id> --skill-suite-id <production-suite-id> --skill-rollback-target-id <production-rollback-target-id> --skill-release-notes-id <production-release-notes-id> --skill-canary-sample-size <production-canary-sample-size> --skill-owner-risk-ref <production-skill-owner-risk-ref> --skill-eval-suite-ref <production-skill-eval-suite-ref> --skill-safety-refs-ref <production-skill-safety-refs-ref> --skill-canary-metrics-ref <production-skill-canary-metrics-ref> --skill-rollback-target-ref <production-skill-rollback-target-ref> --skill-release-notes-ref <production-skill-release-notes-ref>
```

```bash
python3 scripts/validate_stage1_production_governance_proof.py --proof ops/evidence/non_clearing/production-governance-proof.candidate.json
```

```bash
python3 scripts/stage1_production_source_probe.py --governance --release-sha $(git rev-parse HEAD) --governance-proof ops/evidence/non_clearing/production-governance-proof.candidate.json --diagnostic ops/evidence/production/source-probe-diagnostics.governance.json --write-canonical-source
```

```bash
python3 scripts/generate_stage1_production_governance_release_evidence.py --source ops/evidence/production/production-governance-release-source.json
```

## Not Current Blockers

- staging aggregate is already go
- R2 zenari bucket is already a staging resource, not the current production blocker
- Stripe sandbox is not the current blocker; live mode proof is required
- z.ai/OpenAI-compatible LLM is not the current blocker
- worker/crawler/migrate are backend runtime entrypoints, not release images
- manager is legacy local-only and not a release surface

## Source JSON

- missing_input_checklist: `ops/evidence/non_clearing/production-missing-input-checklist.json`
- source_runbook: `ops/evidence/non_clearing/production-source-probe-runbook.json`
- dns_packet: `ops/evidence/non_clearing/production-dns-repair-packet.json`
- billing_packet: `ops/evidence/non_clearing/production-billing-operator-packet.json`
- security_packet: `ops/evidence/non_clearing/production-security-operator-packet.json`
- governance_packet: `ops/evidence/non_clearing/production-governance-operator-packet.json`