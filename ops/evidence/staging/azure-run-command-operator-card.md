# Azure Run Command Operator Card

This is a non-secret, non-clearing operator card for the Azure staging VM.
It does not clear any Stage 1 release gate and does not contain SSH passwords,
Cloudflare tokens, Stripe keys, provider keys, cookies, or raw Run Command output.

## Current Blocker

- DNS for `staging.zenari.ai` currently resolves through Cloudflare proxy
  addresses, not directly to the Azure VM.
- Use the Azure VM with public IP `52.237.80.117`.
- Azure TCP ports `22`, `80`, and `443` are reachable on `52.237.80.117`.
- Azure HTTP and HTTPS probes return no successful response.
- SSH reaches TCP `22` but times out during banner exchange/auth.
- Azure Run Command output is still missing from local evidence.
- This is not currently a Stripe, z.ai, R2, username, or password blocker.
  The VM is accepting TCP but not returning SSH or HTTP protocol bytes.
- Current transport lane: `vm_protocol_services_unresponsive`; local password
  or key repair is not viable until the VM returns an SSH banner.
- The Run Command payload also emits safe database/compose classifications for
  core backend/web/admin/worker/crawler container states and quota replay, such
  as whether `postgres` exists, whether the backend has a database URL, and
  whether that database target is local compose or an external candidate. It
  does not print or persist the raw database URL.

## Optional Local Azure CLI Targeting

If this workstation has Azure CLI installed and logged in, the ignored local
`.env` can target the VM directly with these non-secret resource identifiers:

```text
AZURE_SUBSCRIPTION_ID=
AZURE_TENANT_ID=
AZURE_RESOURCE_GROUP=
AZURE_VM_NAME=
```

`AZURE_RESOURCE_GROUP` and `AZURE_VM_NAME` are the minimum useful pair for
`scripts/azure_staging_run_command_invoke.sh`. If they are absent, the local
preflight tries to discover the VM by public IP `52.237.80.117`. Keep these
values out of `.env.example` except as blank names, and do not store Azure
tokens or raw Run Command output in the repo.

## Azure Portal Action

1. Open Azure Portal.
2. Go to Virtual machines.
3. Open the staging VM whose public IP is `52.237.80.117`.
4. Open that VM's Run command page.
5. Choose RunShellScript on the VM page. Do not run this payload in an Azure
   browser shell or any local terminal.
6. Paste the full contents of:

```text
ops/evidence/staging/azure-run-command-ssh-repair.sh
```

7. Run it inside the VM.
8. Copy the visible output from Azure Portal.
9. Paste or pipe that output into the local ingest command from the repository
   root. The ingest command writes sanitized local evidence, classifies the
   result, and refreshes readiness:

```bash
python3 scripts/ingest_azure_run_command_output.py
```

For blind/operator handoff, the minimum safe rule is: copy the Azure Portal
RunShellScript output, come back to this local repo, run the ingest command,
paste the output into stdin, then end stdin. Do not put the VM password,
Cloudflare keys, Stripe keys, provider keys, cookies, or Authorization headers
into any repo file.

Do not save SSH passwords, Cloudflare tokens, Stripe keys, provider keys,
cookies, Authorization headers, or raw application payloads in that output file.

## Local Commands After Output Is Saved

Prefer the single ingest command:

```bash
python3 scripts/ingest_azure_run_command_output.py
```

Manual equivalent:

```bash
python3 scripts/sanitize_azure_run_command_output.py --output ops/evidence/staging/azure-run-command-ssh-repair.output.txt --require-marker
python3 scripts/classify_azure_run_command_output.py --input ops/evidence/staging/azure-run-command-ssh-repair.output.txt --output ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json || test $? -eq 2
python3 scripts/stage1_azure_origin_readiness.py --env .env --output ops/evidence/staging/stage1-azure-origin-readiness.json || test $? -eq 2
python3 scripts/validate_stage1_azure_origin_readiness.py
python3 scripts/generate_stage1_next_blockers_summary.py || test $? -eq 2
python3 scripts/validate_stage1_next_blockers_summary.py
```

## Success Signal

The Run Command payload should print this marker near the end:

```text
zenari_azure_run_command_payload=complete
```

If the marker is missing, save the visible non-secret output anyway and run the
classifier. The classifier will keep the gate blocked and report which evidence
is missing.

## What The Output Will Decide

- If Docker or Compose is missing, staging bootstrap/deploy is the next repair.
- If Caddy or listeners `80/443/31080/26080/26081` are missing, origin repair is
  the next repair.
- If `postgres`, the backend database URL, or the quota replay DB candidate is
  reported missing/local-only, the next repair is staging database exposure or
  running the strict quota replay evidence from an environment that can reach
  the deployed staging Postgres endpoint.
- If local backend/web/admin probes fail inside the VM, service logs and compose
  health are the next repair.
- If SSH is still broken after the payload repairs authorized keys and sshd,
  Azure serial console or VM-level networking is the next repair.
- If the VM-internal probes pass but external HTTP/SSH still time out, the next
  repair is Azure NSG/firewall/routing or Cloudflare origin configuration.
