# Stage 1 Production DNS Operator Checklist

This is a non-clearing operator handoff. It does not apply DNS changes and it does not clear production launch gates.

Status: `blocked`
Release gate decision: `no_go`
Production web URL: `https://zenari.ai`
DNS blocker count: `6`
Required input count: `3`

## Current Resolver State

- Production system resolver: `blocked`
- Production A record: `missing`
- Production AAAA record: `missing`
- Public production address count: `0`
- Staging control resolver: `pass`
- Staging A probe: `pass`
- Cloudflare zone id configured: `False`
- Cloudflare API token configured: `False`
- Cloudflare DNS credentials configured: `False`
- R2 S3 credentials detected: `True`
- R2 S3 can manage DNS: `False`
- Production DNS target status: `ready`

## Credential Scope

- Cloudflare DNS credentials configured: `False`
- R2 S3 credentials detected: `True`
- R2 S3 present keys: `OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ACCESS_KEY, OBJECT_STORAGE_SECRET_KEY`
- R2 S3 can manage DNS: `False`
- Operator note: Cloudflare R2 S3 access keys are object-storage credentials only and cannot create or edit zenari.ai DNS records; use a Cloudflare API token with Zone DNS Edit permission.

## Current DNS Records

- zenari.ai A: `none`
- zenari.ai AAAA: `none`
- zenari.ai CNAME: `none`
- www.zenari.ai A: `none`
- www.zenari.ai CNAME: `none`
- staging.zenari.ai A control: `172.67.219.243, 104.21.62.40`

## DNS Over HTTPS Fallback

- production_a_cloudflare: resolver `cloudflare`, host `zenari.ai`, rrtype `A`, status `blocked`, addresses `none`, error `<urlopen error [Errno 54] Connection reset by peer>`
- production_aaaa_cloudflare: resolver `cloudflare`, host `zenari.ai`, rrtype `AAAA`, status `blocked`, addresses `none`, error `<urlopen error [Errno 54] Connection reset by peer>`
- production_a_google: resolver `google`, host `zenari.ai`, rrtype `A`, status `blocked`, addresses `none`, error `hard timeout after 12.0s`
- production_aaaa_google: resolver `google`, host `zenari.ai`, rrtype `AAAA`, status `blocked`, addresses `none`, error `hard timeout after 12.0s`
- staging_a_cloudflare: resolver `cloudflare`, host `staging.zenari.ai`, rrtype `A`, status `blocked`, addresses `none`, error `<urlopen error [Errno 54] Connection reset by peer>`
- staging_a_google: resolver `google`, host `staging.zenari.ai`, rrtype `A`, status `blocked`, addresses `none`, error `hard timeout after 12.0s`

## Public Production Addresses Observed

- `none`

## Recommended DNS Records

1. Host: `zenari.ai`
   - Type: `A`
   - Name: `@`
   - Content: `52.237.80.117`
   - Proxied: `True`
   - TTL: `auto`
   - Current status: `missing`
   - Required when: PRODUCTION_DNS_TARGET is an IPv4 production web ingress

2. Host: `www.zenari.ai`
   - Type: `CNAME`
   - Name: `www`
   - Content: `zenari.ai`
   - Proxied: `True`
   - TTL: `auto`
   - Current status: `missing`
   - Required when: Apex zenari.ai is configured

## Required Inputs

1. PRODUCTION_DNS_TARGET
2. CLOUDFLARE_ZONE_ID or CF_ZONE_ID
3. CLOUDFLARE_API_TOKEN or CF_API_TOKEN

## Blocked Checks

1. system resolver failed for zenari.ai: [Errno 8] nodename nor servname provided, or not known
2. public DNS probes returned no public A/AAAA records for zenari.ai
3. production HTTPS failed for https://zenari.ai/: skipped HTTPS probe because system resolver failed for zenari.ai: [Errno 8] nodename nor servname provided, or not known
4. CLOUDFLARE_ZONE_ID_or_CF_ZONE_ID
5. CLOUDFLARE_API_TOKEN_or_CF_API_TOKEN
6. CLOUDFLARE_ZONE_DNS_SCOPE_PREFLIGHT_FAILED

## Cloudflare UI Steps

1. Do not use Cloudflare R2 S3 access keys for this DNS change; they are object-storage credentials only.
2. Open Cloudflare dashboard for the zenari.ai zone.
3. Go to DNS > Records and create or update the apex record named @ using PRODUCTION_DNS_TARGET.
4. Create or update www as a CNAME to zenari.ai.
5. Keep records proxied unless the production ingress requires DNS-only validation during certificate issuance.
6. Do not copy staging.zenari.ai records as the production target unless PRODUCTION_DNS_TARGET explicitly names that production ingress.

## Cloudflare API Plan

1. Do not export OBJECT_STORAGE_ACCESS_KEY or OBJECT_STORAGE_SECRET_KEY for DNS writes.
2. Export CLOUDFLARE_ZONE_ID or CF_ZONE_ID only in the operator shell.
3. Export CLOUDFLARE_API_TOKEN or CF_API_TOKEN with Zone DNS Edit permission only in the operator shell.
4. Export PRODUCTION_DNS_TARGET as the production web ingress IPv4 address or hostname.
5. Run stage1_production_dns_cutover_plan.py without --apply and confirm status ready_to_apply.
6. Run stage1_production_dns_cutover_plan.py --verify-cloudflare and confirm cloudflare_scope_preflight.status is pass.
7. Run stage1_production_dns_cutover_plan.py --apply only after reviewing the non-clearing plan.

## Private Env Template

- Path placeholder: `<private-production-env>`
- Gitignored copy required: `True`
- Blank values only in evidence: `True`

```dotenv
PRODUCTION_DNS_TARGET=
CLOUDFLARE_ZONE_ID=
CF_ZONE_ID=
CLOUDFLARE_API_TOKEN=
CF_API_TOKEN=
```

## Verification Commands

1. Command:

```bash
dig +short A zenari.ai
```

2. Command:

```bash
dig +short AAAA zenari.ai
```

3. Command:

```bash
dig +short CNAME www.zenari.ai
```

4. Command:

```bash
curl -I --max-time 12 https://zenari.ai/
```

5. Command:

```bash
curl -I --max-time 12 https://zenari.ai/legal/terms
```

6. Command:

```bash
python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json
```

## Commands After Inputs

1. Command:

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

2. Command:

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --verify-cloudflare --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

3. Command:

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

4. Command:

```bash
python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json
```

5. Command:

```bash
python3 scripts/stage1_production_source_probe.py --legal-support --release-sha $(git rev-parse HEAD) --production-web-url https://zenari.ai --write-canonical-source
```

6. Command:

```bash
python3 scripts/generate_stage1_production_legal_support_evidence.py --source ops/evidence/production/production-legal-support-source.json
```

7. Command:

```bash
python3 scripts/validate_stage1_production_legal_support_evidence.py
```

8. Command:

```bash
python3 scripts/generate_stage1_production_launch_evidence.py
```

9. Command:

```bash
python3 scripts/validate_stage1_production_launch.py
```

## Operator Command Packet

1. Step: `generate_plan_with_private_env`
   - Side effect: non-clearing plan only
   - May write DNS: `False`
   - Requires review: `False`

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

2. Step: `validate_plan`
   - Side effect: local validation only
   - May write DNS: `False`
   - Requires review: `False`

```bash
python3 scripts/validate_stage1_production_dns_cutover_plan.py --plan ops/evidence/non_clearing/production-dns-cutover-plan.json
```

3. Step: `verify_cloudflare_scope`
   - Side effect: read-only Cloudflare zone and DNS permission preflight
   - May write DNS: `False`
   - Requires review: `False`

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --verify-cloudflare --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

4. Step: `apply_reviewed_dns`
   - Side effect: operator-owned Cloudflare DNS write after review
   - May write DNS: `True`
   - Requires review: `True`

```bash
python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json
```

5. Step: `wait_and_probe_dns`
   - Side effect: read-only DNS and HTTPS probe
   - May write DNS: `False`
   - Requires review: `False`

```bash
python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json
```

6. Step: `regenerate_repair_packet`
   - Side effect: non-clearing evidence refresh
   - May write DNS: `False`
   - Requires review: `False`

```bash
python3 scripts/generate_stage1_production_dns_repair_packet.py --operator-markdown ops/evidence/non_clearing/production-dns-operator-checklist.md
```

7. Step: `validate_repair_packet`
   - Side effect: local validation only
   - May write DNS: `False`
   - Requires review: `False`

```bash
python3 scripts/validate_stage1_production_dns_repair_packet.py --operator-markdown ops/evidence/non_clearing/production-dns-operator-checklist.md
```

8. Step: `refresh_non_clearing_summary`
   - Side effect: non-clearing summary refresh
   - May write DNS: `False`
   - Requires review: `False`

```bash
python3 scripts/refresh_stage1_production_non_clearing_evidence.py || test $? -eq 2
```

## Operator Next Actions

1. Set the explicit production DNS target; do not use staging host as an implicit production target.
2. Provide Cloudflare zone id and a DNS-edit token only in the operator environment; do not persist token values.
3. Generate the cutover plan, apply DNS only after reviewing the non-clearing plan, then wait for public propagation.
4. Rerun DNS readiness and legal/support source probe after zenari.ai resolves and HTTPS public paths return pass.

## Gate Impact

- Can clear Stage 1 production launch gate: `False`
- Can clear production legal/support policy: `False`
- Can close do-not-launch: `False`
- Non-clearing evidence only: `True`
- Preserved do-not-launch condition: `stage1_production_launch_evidence_incomplete`

## Source Evidence

- dns_readiness: `ops/evidence/non_clearing/production-dns-readiness.json`
- dns_cutover_plan: `ops/evidence/non_clearing/production-dns-cutover-plan.json`
- source_probe_runbook: `ops/evidence/non_clearing/production-source-probe-runbook.json`
