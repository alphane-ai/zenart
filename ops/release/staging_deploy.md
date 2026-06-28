# Stage 0 Rev2 / Stage 1 Staging Deploy Draft

Authoritative sources: `Docs/stage0_blueprint_rev2.md` and `Docs/Stage1_20260621_blueprint.md`.

This is an operations draft only. Private beta and production gates remain open until a release owner promotes SHA-tagged images into a real staging environment with production-like Postgres, Redis, object storage, observability, backups, and rollback controls.

## Azure VM Bootstrap

Current Stage 1 staging uses an Azure VM as the runtime host and Cloudflare R2 only as object storage. The VM target is configured through ignored local `.env` values:

- `STAGING_SSH_TARGET`
- `STAGING_SSH_KEY`
- `STAGING_REMOTE_DIR`
- `STAGING_API_URL`
- `STAGING_WEB_URL`
- `STAGING_ADMIN_URL`

Before deploy, verify SSH and remote runtime tooling:

```bash
scripts/azure_staging_ssh_preflight.sh
```

If TCP 22 is reachable but the preflight reports `ssh_auth=failed`, check the
failure reason before trying password repair. For `ssh_connect_timeout`,
`ssh_server_not_responding`, or `ssh_auth_hard_timeout`, the VM accepted the TCP
connection but SSH did not complete banner/auth. First generate the Run Command
payload:

```bash
scripts/azure_staging_run_command_payload.sh --output /tmp/zenari-azure-run-command-ssh-repair.sh
```

The generated file is a paste-ready VM-internal script. It checks sshd status,
recent ssh logs, VM resource pressure, port 22 listeners, Linux user state, sudo
policy, `authorized_keys`, `ssh.socket`, `sshd -t`, `/run/sshd`, OpenSSH server
installation, UFW/iptables/nft firewall summaries, Azure Linux Agent logs, and
cloud-init logs, then reloads sshd. It contains the local public key only and
must not contain `STAGING_SSH_PASSWORD`.

This must be repaired inside the VM, not in Azure Cloud Shell. In Azure Portal,
open:

```text
Virtual machines -> target VM -> Run command -> RunShellScript
```

Paste the contents of `/tmp/zenari-azure-run-command-ssh-repair.sh` into that
RunShellScript form. After Azure finishes, keep these non-secret output sections
for diagnosis and rerun `scripts/azure_staging_ssh_preflight.sh` locally:

```text
zenari_azure_run_command_payload=ssh_repair_v1
ssh_service_status
ssh_socket_status
sshd_config_test_before
sshd_config_test_after
firewall_summary
azure_agent_recent_logs
cloud_init_recent_logs
ssh_recent_logs
listening_ssh
listening_ssh_after
zenari_azure_run_command_payload=complete
```

If this workstation has Azure CLI installed, is logged in, and the ignored local
environment contains `AZURE_RESOURCE_GROUP` and `AZURE_VM_NAME`, the same payload
can be invoked without the portal:

```bash
scripts/azure_staging_cli_preflight.sh
RUN_AZURE_STAGING_RUN_COMMAND=1 scripts/azure_staging_run_command_invoke.sh
```

The optional local Azure CLI target variables are:

```text
AZURE_SUBSCRIPTION_ID=
AZURE_TENANT_ID=
AZURE_RESOURCE_GROUP=
AZURE_VM_NAME=
```

Only `AZURE_RESOURCE_GROUP` and `AZURE_VM_NAME` are required when the VM is
known. `AZURE_SUBSCRIPTION_ID` and `AZURE_TENANT_ID` are optional operator
disambiguation fields. Keep these in the ignored local `.env`; `.env.example`
must list them blank and must not contain Azure tokens.

If `AZURE_RESOURCE_GROUP` and `AZURE_VM_NAME` are missing, the preflight tries to
discover the VM by public IP `52.237.80.117`. The invoke wrapper refuses to run
unless `RUN_AZURE_STAGING_RUN_COMMAND=1` is set.

If SSH reaches auth but the key is still rejected, and only then, set
`STAGING_SSH_PASSWORD` in the ignored local `.env` and run:

```bash
scripts/azure_staging_password_key_repair.sh
```

If repairing manually, append the public key printed by the preflight to the
user's `authorized_keys`:

```bash
USER_NAME="<vm-linux-user>"
PUBKEY="ssh-ed25519 <public-key-body> <comment>"

sudo install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
printf '%s\n' "$PUBKEY" | sudo tee -a "/home/$USER_NAME/.ssh/authorized_keys" >/dev/null
sudo chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys"
sudo chmod 600 "/home/$USER_NAME/.ssh/authorized_keys"
```

Use the actual Linux username you want Codex to SSH as and update `STAGING_SSH_TARGET` in the ignored local `.env` to match, for example `mac@<staging-ip>`.

When SSH is authorized, bootstrap the VM runtime prerequisites:

```bash
scripts/azure_staging_bootstrap.sh
```

The bootstrap script verifies passwordless sudo, installs Docker and the Docker
Compose plugin when missing, starts Docker, prepares `${STAGING_REMOTE_DIR:-/opt/zenari}/current`,
and reports whether Docker is available to the login user or through sudo.

Then deploy the current repo snapshot and ignored staging `.env` to the VM:

```bash
scripts/azure_staging_deploy.sh
```

The deploy script runs the bootstrap first, syncs the repository to `${STAGING_REMOTE_DIR:-/opt/zenari}/current`, copies the ignored `.env` to the remote release directory, starts `docker compose --profile frontend up -d --build`, runs `/app/migrate`, and checks `/healthz` through `STAGING_API_URL` when configured.

The current staging admin smoke path does not require a production bearer token. Stage 1 staging can use local admin session bootstrap against the seeded admin identity:

- email: `admin@zenari.ai`
- user id: `user_local_admin`
- tenant id: `tenant_local`

That bootstrap is staging-only and must not be treated as production launch authentication.

## Preconditions

- Installed CI workflow has passed on the exact git SHA.
- SHA-tagged `backend`, `web`, and `admin` images exist.
- Staging secrets are loaded from the approved secret source, not from `.env.example`.
- Staging Postgres migrations use the same migration command intended for production.
- Staging object storage uses an S3-compatible bucket with signed URL configuration and backup/versioning policy.
- Rollback target SHA and feature flag rollback plan are named before deploy starts.

## Deploy Steps

1. Record the release SHA, image tags, migration list, config diff, feature flag diff, owner, rollback SHA, and expected smoke command in release notes.
2. Drain or pause worker intake before migrations when a schema compatibility note requires it.
3. Run forward-only migrations against staging.
4. Deploy the SHA-tagged backend, web, and admin release images. Start worker and crawler only as backend runtime entrypoints that reuse the backend image; do not publish them as standalone release images.
5. Produce validator-resolvable staging JSON evidence for migration, config diff, observability, backup/restore, load, rollback, and security. Each evidence file must reference the release SHA, set `environment=staging`, set the required `kind`, and record an accepted pass/review status.
   - Observability evidence must include request-id propagation, structured JSON logs, OpenTelemetry traces, backend/worker/crawler metrics, dashboard import, and alert routes. Each entry must carry a trace, query, dashboard, alert, report, or evidence reference.
   - Backup/restore evidence must include both Postgres restore and exported package/object restore drill entries with report references.
   - Load evidence must include `chat_task`, `worker_generation`, `zip_export`, `signed_download`, `crawler_throttle`, `quota_contention`, and `workspace_rendering` entries with report references.
   - Rollback evidence must include image rollback, feature flag rollback, migration compatibility, worker drain, and post-rollback smoke entries with report references.
   - Security evidence must include dependency, image/container, and committed-secret scan entries with report references.
6. Run representative load smoke modes from `scripts/load_smoke.sh` against staging URLs and write the aggregate staging load evidence.
7. Run `scripts/staging_smoke.sh` with `STAGING_BASE_URL`, `STAGING_WEB_URL`, `STAGING_ADMIN_URL`, `RELEASE_SHA`, release notes, image refs, seeded smoke IDs, and every evidence path from the previous step. The generated report must set `environment=staging`, set `kind=post_deploy_smoke`, record status `passed`, and verify backend health/readiness, web, admin, auth boundary, worker task, export/package, signed download, crawler admin, quota/rate-limit, and request-id observability categories.
8. Run `scripts/staging_observability_backup_load_smoke.sh` with `RELEASE_SHA`, `OBSERVABILITY_EVIDENCE`, `BACKUP_RESTORE_EVIDENCE`, `LOAD_EVIDENCE`, and `POST_DEPLOY_SMOKE_EVIDENCE`. A blocked report means the private beta `staging_observability_backup_load` check must stay open.
9. Run `scripts/staging_object_storage_retention_cleanup_smoke.sh` against staging admin object-storage retention and cleanup endpoints with admin auth, smoke admin identity, matching release SHA, and same-site CSRF inputs (`CSRF_ORIGIN` or `STAGING_ADMIN_URL`, plus `CSRF_HEADER_NAME`/`CSRF_HEADER_VALUE`) for the cleanup POST probes. Passing evidence must be written to `ops/evidence/staging/object-storage-retention-cleanup.json` and prove retention policy, expired export cleanup, orphan cleanup, CSRF-protected cleanup POST probes, and audit refs before the object-storage gate can close.
10. Run `scripts/staging_legal_support_visibility_smoke.sh` with `STAGING_WEB_URL` and write both legal-page and support-contact external-user visibility evidence before the legal/support gate can close.
11. Confirm logs, metrics, traces, dashboards, alerts, and backup jobs are producing staging evidence.
12. Attach smoke/load/restore/object-retention/legal-support evidence to the release notes before any private beta decision.

## Rollback

1. Disable provider/crawler/analytics risk flags when the failure mode is active ingestion or external calls.
2. Promote the previous SHA-tagged images.
3. Do not roll back database migrations destructively; use expand/contract compatibility or a forward repair migration.
4. Re-run `scripts/staging_smoke.sh`.
5. Record the incident and rollback result in release evidence.
