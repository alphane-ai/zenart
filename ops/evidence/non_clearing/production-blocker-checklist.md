# Stage 1 Final Production Blocker Checklist

This is a non-clearing operator checklist. It summarizes final production blockers and preserves no_go until strict production evidence exists.

Generated at: `2026-06-28T17:51:11+00:00`
Stage1 gates: `6` / `14` = `42.9%`
Production inputs: `2` / `60` = `3.3%`
Production inputs missing: `55`
Production inputs invalid: `3`
Blocking production inputs: `58`
Production source probes ready: `0` / `4`
Production source probes blocked: `4`
Source-probe blocking input count: `58`
Release decision: `no_go`

## Blocking Input Groups

| Group | Configured | Total | Percent | Missing | Invalid | Blockers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| production_dns | 2 | 4 | 50.0% | 2 | 0 | 2 |
| billing | 0 | 20 | 0.0% | 17 | 3 | 20 |
| security | 0 | 10 | 0.0% | 10 | 0 | 10 |
| governance | 0 | 26 | 0.0% | 26 | 0 | 26 |

## Production Source Probes

| Order | Step | Probe | Ready | Percent | Blockers | First Blocker |
| ---: | --- | --- | --- | ---: | ---: | --- |
| 1 | production_dns_https | production_legal_support_policy | False | 50.0% | 2 | system resolver failed for zenari.ai: [Errno 8] nodename nor servname provided, or not known |
| 2 | production_paid_billing_lifecycle | production_paid_billing_lifecycle | False | 0.0% | 20 | billing_proof_missing |
| 3 | production_security_launch_checks | production_security_launch_checks | False | 0.0% | 10 | security_proof_missing |
| 4 | production_governance_release | production_governance_release | False | 0.0% | 26 | governance_proof_missing |

## DNS And HTTPS

- Status: `blocked`
- Release gate decision: `no_go`
- Production web URL: `https://zenari.ai`
- DNS blocker count: `6`
- Required input count: `3`
- Production resolver: `blocked`
- Production A: `missing`
- Production AAAA: `missing`
- Can clear Stage 1 production launch gate: `False`
- Can close do-not-launch: `False`

Required inputs:
- PRODUCTION_DNS_TARGET
- CLOUDFLARE_ZONE_ID or CF_ZONE_ID
- CLOUDFLARE_API_TOKEN or CF_API_TOKEN

Recommended records:
- zenari.ai: A @ -> 52.237.80.117, proxied True
- www.zenari.ai: CNAME www -> zenari.ai, proxied True

Verification command:

```bash
dig +short A zenari.ai
```

Verification command:

```bash
dig +short AAAA zenari.ai
```

Verification command:

```bash
dig +short CNAME www.zenari.ai
```

Verification command:

```bash
curl -I --max-time 12 https://zenari.ai/
```

Verification command:

```bash
curl -I --max-time 12 https://zenari.ai/legal/terms
```

Verification command:

```bash
python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json
```

After-input command:

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

After-input command:

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --verify-cloudflare --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

After-input command:

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

After-input command:

```bash
python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json
```

After-input command:

```bash
python3 scripts/stage1_production_source_probe.py --legal-support --release-sha $(git rev-parse HEAD) --production-web-url https://zenari.ai --write-canonical-source
```

After-input command:

```bash
python3 scripts/generate_stage1_production_legal_support_evidence.py --source ops/evidence/production/production-legal-support-source.json
```

After-input command:

```bash
python3 scripts/validate_stage1_production_legal_support_evidence.py
```

After-input command:

```bash
python3 scripts/generate_stage1_production_launch_evidence.py
```

After-input command:

```bash
python3 scripts/validate_stage1_production_launch.py
```

## Billing Live Stripe Lifecycle

- Status: `blocked`
- Release gate decision: `no_go`
- Release gate check: `production_paid_billing_lifecycle`
- Required live artifact count: `14`
- First blocker: STRIPE_MODE_must_be_live
- Can clear Stage 1 production launch gate: `False`
- Can close do-not-launch: `False`

Required material:
- --checkout-session-id with prefix cs_live_
- --checkout-customer-id with prefix cus_
- --price-id with prefix price_
- --active-subscription-id with prefix sub_
- --active-customer-id with prefix cus_
- --past-due-subscription-id with prefix sub_
- --past-due-invoice-id with prefix in_
- --cancel-subscription-id with prefix sub_
- --subscription-item-id with prefix si_
- --visible-invoice-id with prefix in_
- --refund-charge-id with prefix ch_
- --refund-id with prefix re_
- --quota-reset-invoice-id with prefix in_
- --failed-export-refund-id with prefix re_

Primary proof command:

```bash
python3 scripts/stage1_stripe_live_billing_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-live-billing-proof.candidate.json --checkout-session-id <cs_live_...> --checkout-customer-id <cus_...> --price-id <price_...> --active-subscription-id <sub_...> --active-customer-id <cus_...> --past-due-subscription-id <sub_...> --past-due-invoice-id <in_...> --cancel-subscription-id <sub_...> --seat-quantity <positive-int> --synced-quantity <same-positive-int> --subscription-item-id <si_...> --visible-invoice-id <in_...> --refund-charge-id <ch_...> --refund-id <re_...> --quota-reset-invoice-id <in_...> --webhook-event-ids <evt_...,evt_...> --failed-export-refund-id <re_...> --live-test-separation-ref <audit-or-runtime-ref> --paid-checkout-ref <audit-or-runtime-ref> --subscription-active-ref <audit-or-runtime-ref> --subscription-past-due-ref <audit-or-runtime-ref> --subscription-cancel-ref <audit-or-runtime-ref> --team-seat-ref <audit-or-runtime-ref> --invoice-visibility-ref <audit-or-runtime-ref> --lifecycle-audit-ref <audit-or-runtime-ref> --refund-credit-ref <audit-or-runtime-ref> --quota-reset-ref <audit-or-runtime-ref> --webhook-idempotency-ref <audit-or-runtime-ref> --failed-export-refund-ref <audit-or-runtime-ref> --quota-projection-ref <audit-or-runtime-ref> --refund-webhook-audit-ref <audit-or-runtime-ref>
```

Follow-up command:

```bash
python3 scripts/validate_stage1_stripe_live_billing_proof.py --proof ops/evidence/non_clearing/production-live-billing-proof.candidate.json
```

Follow-up command:

```bash
python3 scripts/stage1_production_source_probe.py --billing --release-sha $(git rev-parse HEAD) --billing-proof ops/evidence/non_clearing/production-live-billing-proof.candidate.json --diagnostic ops/evidence/production/source-probe-diagnostics.billing.json --write-canonical-source
```

Follow-up command:

```bash
python3 scripts/generate_stage1_production_billing_evidence.py --source ops/evidence/production/billing-paid-lifecycle-source.json
```

Follow-up command:

```bash
python3 scripts/validate_stage1_production_billing_evidence.py
```

Follow-up command:

```bash
python3 scripts/generate_stage1_production_launch_evidence.py
```

Follow-up command:

```bash
python3 scripts/validate_stage1_production_launch.py
```

## Security Launch Checks

- Status: `blocked`
- Release gate decision: `no_go`
- Release gate check: `production_security_launch_checks`
- Required runtime ref count: `10`
- First blocker: secure_session_cookie_ref_missing
- Can clear Stage 1 production launch gate: `False`
- Can close do-not-launch: `False`

Required material:
- --secure-session-cookie-ref for secure_session_cookie
- --csrf-same-site-ref for csrf_same_site_enforcement
- --secret-redaction-ref for secret_exposure_redaction
- --admin-surface-privacy-ref for admin_surface_privacy
- --provider-key-containment-ref for provider_key_containment
- --stripe-live-test-separation-ref for stripe_live_test_separation
- --rate-limit-spend-cap-ref for rate_limit_spend_cap
- --csp-headers-ref for csp_headers
- --rbac-tenant-isolation-ref for rbac_tenant_isolation
- --audit-ref for audit_refs

Primary proof command:

```bash
python3 scripts/stage1_production_security_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-security-proof.candidate.json --same-site lax --raw-secret-exposure-count 0 --frontend-secret-exposure-count 0 --secure-session-cookie-ref <production-runtime-or-audit-ref> --csrf-same-site-ref <production-runtime-or-audit-ref> --secret-redaction-ref <production-runtime-or-audit-ref> --admin-surface-privacy-ref <production-runtime-or-audit-ref> --provider-key-containment-ref <production-runtime-or-audit-ref> --stripe-live-test-separation-ref <production-runtime-or-audit-ref> --rate-limit-spend-cap-ref <production-runtime-or-audit-ref> --csp-headers-ref <production-runtime-or-audit-ref> --rbac-tenant-isolation-ref <production-runtime-or-audit-ref> --audit-ref <production-runtime-or-audit-ref>
```

Follow-up command:

```bash
python3 scripts/validate_stage1_production_security_proof.py --proof ops/evidence/non_clearing/production-security-proof.candidate.json
```

Follow-up command:

```bash
python3 scripts/stage1_production_source_probe.py --security --release-sha $(git rev-parse HEAD) --security-proof ops/evidence/non_clearing/production-security-proof.candidate.json --diagnostic ops/evidence/production/source-probe-diagnostics.security.json --write-canonical-source
```

Follow-up command:

```bash
python3 scripts/generate_stage1_production_security_launch_evidence.py --source ops/evidence/production/production-security-launch-source.json
```

Follow-up command:

```bash
python3 scripts/validate_stage1_production_security_launch_evidence.py
```

Follow-up command:

```bash
python3 scripts/generate_stage1_production_launch_evidence.py
```

Follow-up command:

```bash
python3 scripts/validate_stage1_production_launch.py
```

## Governance Release

- Status: `blocked`
- Release gate decision: `no_go`
- Release gate check: `production_governance_release`
- Required runtime/audit/id/ref count: `26`
- First blocker: activation_runtime_request_ids_missing
- Can clear Stage 1 production launch gate: `False`
- Can close do-not-launch: `False`

Required material:
- activation: --activation-runtime-request-ids
- activation: --activation-audit-refs
- activation: --activation-high-risk-rbac-ref
- activation: --activation-reviewer-rationale-ref
- activation: --activation-second-review-ref
- activation: --activation-audit-immutability-ref
- activation: --activation-gates-ref
- abuse: --abuse-runtime-request-ids
- abuse: --abuse-audit-refs
- abuse: --abuse-account-hold-ref
- abuse: --abuse-rate-limit-ref
- abuse: --abuse-spend-cap-or-kill-switch-ref
- abuse: --abuse-rbac-audit-ref
- skill: --skill-runtime-request-ids
- skill: --skill-audit-refs
- skill: --skill-owner-id
- skill: --skill-suite-id
- skill: --skill-rollback-target-id
- skill: --skill-release-notes-id
- skill: --skill-canary-sample-size
- skill: --skill-owner-risk-ref
- skill: --skill-eval-suite-ref
- skill: --skill-safety-refs-ref
- skill: --skill-canary-metrics-ref
- skill: --skill-rollback-target-ref
- skill: --skill-release-notes-ref

Primary proof command:

```bash
python3 scripts/stage1_production_governance_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-governance-proof.candidate.json --skill-risk-level <low|medium|high> --activation-runtime-request-ids <production-runtime-request-id[,id]> --activation-audit-refs <immutable-production-audit-ref[,ref]> --activation-high-risk-rbac-ref <production-activation-high-risk-rbac-ref> --activation-reviewer-rationale-ref <production-activation-reviewer-rationale-ref> --activation-second-review-ref <production-activation-second-review-ref> --activation-audit-immutability-ref <production-activation-audit-immutability-ref> --activation-gates-ref <production-activation-activation-gates-ref> --abuse-runtime-request-ids <production-runtime-request-id[,id]> --abuse-audit-refs <immutable-production-audit-ref[,ref]> --abuse-account-hold-ref <production-abuse-account-hold-ref> --abuse-rate-limit-ref <production-abuse-rate-limit-ref> --abuse-spend-cap-or-kill-switch-ref <production-abuse-spend-cap-or-kill-switch-ref> --abuse-rbac-audit-ref <production-abuse-rbac-audit-ref> --skill-runtime-request-ids <production-runtime-request-id[,id]> --skill-audit-refs <immutable-production-audit-ref[,ref]> --skill-owner-id <production-owner-id> --skill-suite-id <production-suite-id> --skill-rollback-target-id <production-rollback-target-id> --skill-release-notes-id <production-release-notes-id> --skill-canary-sample-size <production-canary-sample-size> --skill-owner-risk-ref <production-skill-owner-risk-ref> --skill-eval-suite-ref <production-skill-eval-suite-ref> --skill-safety-refs-ref <production-skill-safety-refs-ref> --skill-canary-metrics-ref <production-skill-canary-metrics-ref> --skill-rollback-target-ref <production-skill-rollback-target-ref> --skill-release-notes-ref <production-skill-release-notes-ref>
```

Follow-up command:

```bash
python3 scripts/validate_stage1_production_governance_proof.py --proof ops/evidence/non_clearing/production-governance-proof.candidate.json
```

Follow-up command:

```bash
python3 scripts/stage1_production_source_probe.py --governance --release-sha $(git rev-parse HEAD) --governance-proof ops/evidence/non_clearing/production-governance-proof.candidate.json --diagnostic ops/evidence/production/source-probe-diagnostics.governance.json --write-canonical-source
```

Follow-up command:

```bash
python3 scripts/generate_stage1_production_governance_release_evidence.py --source ops/evidence/production/production-governance-release-source.json
```

Follow-up command:

```bash
python3 scripts/validate_stage1_production_governance_release_evidence.py
```

Follow-up command:

```bash
python3 scripts/generate_stage1_production_launch_evidence.py
```

Follow-up command:

```bash
python3 scripts/validate_stage1_production_launch.py
```

## Source JSON

- Operator brief: `ops/evidence/non_clearing/production-launch-operator-brief.json`
- Missing input checklist: `ops/evidence/non_clearing/production-missing-input-checklist.json`
- Source probe runbook: `ops/evidence/non_clearing/production-source-probe-runbook.json`
- DNS packet: `ops/evidence/non_clearing/production-dns-repair-packet.json`
- Billing packet: `ops/evidence/non_clearing/production-billing-operator-packet.json`
- Security packet: `ops/evidence/non_clearing/production-security-operator-packet.json`
- Governance packet: `ops/evidence/non_clearing/production-governance-operator-packet.json`
