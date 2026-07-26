# Stage 1 Next Blockers Summary

This is a non-clearing operator summary. It preserves `no_go` and does not close staging, production, or Do-Not-Launch gates.

## Counts

| Area | Count | Percent | Status |
| --- | ---: | ---: | --- |
| Stage1 gates | 6/14 | 42.9% | no_go |
| Production inputs | 2/60 | 3.3% | 58 blockers |
| Production source probes | 0/4 | 0.0% | 4 blocked |
| External resources | 6/7 | 85.7% | 1 missing / 0 blocked |
| Non-clearing refresh | 35/38 | 92.1% | 3 blocked / 0 failed |
| Azure TCP ports | 3/3 | 100.0% | public entry ports 22/80/443 |
| Azure HTTP probes | 4/6 | 66.7% | none |

## External Resources

- External readiness: `6/7 = 85.7%`
- Current loop breaker: R2, Stripe sandbox, z.ai glm-5.2, staging evidence inputs/artifacts, CI exact artifacts, and Azure origin are ready; the remaining production loop is source probes: live Stripe billing, production security, production legal/support HTTPS, and production governance release.

## Azure

- Azure status: `pass / no_go`
- SSH: `pass / ssh_key_auth_ok`
- Azure CLI: `blocked / az_cli_missing`
- Transport lane: `origin_probe_non_clearing_pass` next `continue_strict_staging_runtime_evidence`
- Transport summary: Azure origin probes returned at least one usable HTTP response; strict staging gates still require canonical evidence.
- Transport reasons: `local_azure_cli_missing`
- SSH phase: `auth_reached`; password/key repair viable `True`; Run Command required `False`
- HTTP failure categories: `none, tls_error`
- Repair commands: `13`
- Run Command diagnosis: `superseded` source `blocked` superseded_by `azure_origin_pass` findings `none` input_present `False`
- Run Command lanes: SSH repair `not_required`, origin runtime `not_required`, next `none`
- Origin summary keys: `none`

## Operator Shortlist

| # | Item | Status | Needs Input | Current Blocker | Operator Action | Agent Command |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | production_dns_https | blocked | True | system resolver failed for zenari.ai: [Errno 8] nodename nor servname provided, or not known | Provide PRODUCTION_DNS_TARGET plus Cloudflare zone/token, or apply the apex/www records manually. | `python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json` |
| 2 | production_live_billing | blocked | True | billing_proof_missing | Use live Stripe mode and collect sanitized live checkout, subscription, invoice, refund, quota, and webhook IDs. | `python3 scripts/stage1_stripe_live_billing_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-live-billing-proof.candidate.json --checkout-session-id <cs_live_...> --checkout-customer-id <cus_...> --price-id <price_...> --active-subscription-id <sub_...> --active-customer-id <cus_...> --past-due-subscription-id <sub_...> --past-due-invoice-id <in_...> --cancel-subscription-id <sub_...> --seat-quantity <positive-int> --synced-quantity <same-positive-int> --subscription-item-id <si_...> --visible-invoice-id <in_...> --refund-charge-id <ch_...> --refund-id <re_...> --quota-reset-invoice-id <in_...> --webhook-event-ids <evt_...,evt_...> --failed-export-refund-id <re_...> --live-test-separation-ref <audit-or-runtime-ref> --paid-checkout-ref <audit-or-runtime-ref> --subscription-active-ref <audit-or-runtime-ref> --subscription-past-due-ref <audit-or-runtime-ref> --subscription-cancel-ref <audit-or-runtime-ref> --team-seat-ref <audit-or-runtime-ref> --invoice-visibility-ref <audit-or-runtime-ref> --lifecycle-audit-ref <audit-or-runtime-ref> --refund-credit-ref <audit-or-runtime-ref> --quota-reset-ref <audit-or-runtime-ref> --webhook-idempotency-ref <audit-or-runtime-ref> --failed-export-refund-ref <audit-or-runtime-ref> --quota-projection-ref <audit-or-runtime-ref> --refund-webhook-audit-ref <audit-or-runtime-ref>` |
| 3 | production_security_runtime | blocked | True | security_proof_missing | Attach production runtime refs for session cookie, CSRF, redaction, admin privacy, key containment, CSP, RBAC, audit, and spend caps. | `python3 scripts/stage1_production_security_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-security-proof.candidate.json --same-site lax --raw-secret-exposure-count 0 --frontend-secret-exposure-count 0 --secure-session-cookie-ref <production-runtime-or-audit-ref> --csrf-same-site-ref <production-runtime-or-audit-ref> --secret-redaction-ref <production-runtime-or-audit-ref> --admin-surface-privacy-ref <production-runtime-or-audit-ref> --provider-key-containment-ref <production-runtime-or-audit-ref> --stripe-live-test-separation-ref <production-runtime-or-audit-ref> --rate-limit-spend-cap-ref <production-runtime-or-audit-ref> --csp-headers-ref <production-runtime-or-audit-ref> --rbac-tenant-isolation-ref <production-runtime-or-audit-ref> --audit-ref <production-runtime-or-audit-ref>` |
| 4 | production_governance_release | blocked | True | governance_proof_missing | Provide activation, abuse, and skill release runtime request IDs plus immutable production audit refs. | `python3 scripts/stage1_production_governance_proof.py --release-sha $(git rev-parse HEAD) --output ops/evidence/non_clearing/production-governance-proof.candidate.json --skill-risk-level <low|medium|high> --activation-runtime-request-ids <production-runtime-request-id[,id]> --activation-audit-refs <immutable-production-audit-ref[,ref]> --activation-high-risk-rbac-ref <production-activation-high-risk-rbac-ref> --activation-reviewer-rationale-ref <production-activation-reviewer-rationale-ref> --activation-second-review-ref <production-activation-second-review-ref> --activation-audit-immutability-ref <production-activation-audit-immutability-ref> --activation-gates-ref <production-activation-activation-gates-ref> --abuse-runtime-request-ids <production-runtime-request-id[,id]> --abuse-audit-refs <immutable-production-audit-ref[,ref]> --abuse-account-hold-ref <production-abuse-account-hold-ref> --abuse-rate-limit-ref <production-abuse-rate-limit-ref> --abuse-spend-cap-or-kill-switch-ref <production-abuse-spend-cap-or-kill-switch-ref> --abuse-rbac-audit-ref <production-abuse-rbac-audit-ref> --skill-runtime-request-ids <production-runtime-request-id[,id]> --skill-audit-refs <immutable-production-audit-ref[,ref]> --skill-owner-id <production-owner-id> --skill-suite-id <production-suite-id> --skill-rollback-target-id <production-rollback-target-id> --skill-release-notes-id <production-release-notes-id> --skill-canary-sample-size <production-canary-sample-size> --skill-owner-risk-ref <production-skill-owner-risk-ref> --skill-eval-suite-ref <production-skill-eval-suite-ref> --skill-safety-refs-ref <production-skill-safety-refs-ref> --skill-canary-metrics-ref <production-skill-canary-metrics-ref> --skill-rollback-target-ref <production-skill-rollback-target-ref> --skill-release-notes-ref <production-skill-release-notes-ref>` |

## Operator Action Packet

| # | Item | Owner | Return Artifact | Agent Command After Return | Validation |
| ---: | --- | --- | --- | --- | --- |
| 0 | production_source_probes_missing | agent_after_operator_input | sanitized live production source evidence for billing, security, legal/support HTTPS, and governance. | `python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2` | `python3 scripts/validate_stage1_next_blockers_summary.py` |
<!-- production_source_probes_missing handoff: R2, Stripe sandbox, z.ai glm-5.2, staging evidence inputs/artifacts, CI exact artifacts, and Azure origin are ready; the remaining production loop is source probes: live Stripe billing, production security, production legal/support HTTPS, and production governance release. -->
| 1 | production_dns_https | operator_cloudflare_dns | Cloudflare DNS Edit token/Zone ID plus PRODUCTION_DNS_TARGET in a private env file, or manual apex/www DNS records with HTTPS resolver proof | `python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json` | `python3 scripts/stage1_production_dns_readiness.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-readiness.json || test $? -eq 2` |
<!-- production_dns_https handoff: Do not paste R2 S3 credentials here; DNS needs Cloudflare DNS permission or manual DNS records, then resolver/HTTPS proof. -->
| 2 | production_live_billing | operator_production_account | sanitized Stripe live IDs and production audit refs for checkout, subscription, invoice, refund, quota, webhook, and team-seat lifecycle | `python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2` | `python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2` |
<!-- production_live_billing handoff: Stripe sandbox evidence is already non-blocking; only live-mode sanitized proof can advance this item. -->
| 3 | production_security_runtime | operator_production_account | production runtime request/audit refs for session cookie, CSRF, redaction, admin privacy, key containment, CSP, RBAC, audit, rate limit, and spend cap | `python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2` | `python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2` |
<!-- production_security_runtime handoff: Provide sanitized production runtime/audit references only; do not paste secrets, cookies, Authorization headers, signed URLs, or raw provider payloads. -->
| 4 | production_governance_release | operator_production_account | production activation, abuse, and skill release runtime request IDs plus immutable audit refs | `python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2` | `python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2` |
<!-- production_governance_release handoff: Provide sanitized production runtime/audit references only; do not paste secrets, cookies, Authorization headers, signed URLs, or raw provider payloads. -->

## Production Lanes

| Lane | Blockers | Percent | First Blocker |
| --- | ---: | ---: | --- |
| production_dns_https | 2 | 50.0% | system resolver failed for zenari.ai: [Errno 8] nodename nor servname provided, or not known |
| production_live_billing | 20 | 0.0% | billing_proof_missing |
| production_security_runtime | 10 | 0.0% | security_proof_missing |
| production_governance_release | 26 | 0.0% | governance_proof_missing |

## Production Source Inputs

| Source Step | Inputs | Percent | Candidate Proof | Canonical Source | First Blocker |
| --- | ---: | ---: | --- | --- | --- |
| legal_support_source_probe | 2/4 | 50.0% | HTTPS production pages | ops/evidence/production/production-legal-support-source.json | system resolver failed for zenari.ai: [Errno 8] nodename nor servname provided, or not known |
| billing_source_probe | 0/20 | 0.0% | ops/evidence/non_clearing/production-live-billing-proof.candidate.json | ops/evidence/production/billing-paid-lifecycle-source.json | billing_proof_missing |
| security_source_probe | 0/10 | 0.0% | ops/evidence/non_clearing/production-security-proof.candidate.json | ops/evidence/production/production-security-launch-source.json | security_proof_missing |
| governance_source_probe | 0/26 | 0.0% | ops/evidence/non_clearing/production-governance-proof.candidate.json | ops/evidence/production/production-governance-release-source.json | governance_proof_missing |

## Top Priority Action

- Action: `production_source_probes_missing`
- Lane: `production_launch_inputs`
- Why: R2, Stripe sandbox, z.ai glm-5.2, staging evidence inputs/artifacts, CI exact artifacts, and Azure origin are ready; the remaining production loop is source probes: live Stripe billing, production security, production legal/support HTTPS, and production governance release.
- Requires external input: `True`
- External input: sanitized live production source evidence for billing, security, legal/support HTTPS, and governance.
- Parallel blocker: none
- Parallel command: `none`

```bash
python3 scripts/ingest_stage1_production_return_artifacts.py || test $? -eq 2
```

## Evidence Refs

- `closure_queue`: `ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json`
- `production_action_matrix`: `ops/evidence/non_clearing/production-action-matrix.json`
- `production_missing_input_checklist`: `ops/evidence/non_clearing/production-missing-input-checklist.json`
- `production_source_probe_runbook`: `ops/evidence/non_clearing/production-source-probe-runbook.json`
- `production_launch_source_pipeline`: `ops/evidence/non_clearing/production-launch-source-pipeline.json`
- `production_non_clearing_refresh`: `ops/evidence/non_clearing/production-non-clearing-refresh.json`
- `external_resource_readiness`: `ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json`
- `azure_origin_readiness`: `ops/evidence/staging/stage1-azure-origin-readiness.json`
- `azure_run_command_diagnosis`: `ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json`
