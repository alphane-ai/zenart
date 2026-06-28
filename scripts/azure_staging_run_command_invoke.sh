#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
PAYLOAD_FILE="${AZURE_RUN_COMMAND_PAYLOAD_FILE:-$ROOT/ops/evidence/staging/azure-run-command-ssh-repair.sh}"
source "$ROOT/scripts/azure_staging_target_guard.sh"

load_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    if [[ -n "$key" && -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done <"$ENV_FILE"
}

usage() {
  cat <<'USAGE'
Usage: RUN_AZURE_STAGING_RUN_COMMAND=1 scripts/azure_staging_run_command_invoke.sh

Optional Azure CLI wrapper for executing the generated staging SSH repair
payload through Azure VM Run Command. Requires az login. It uses
AZURE_RESOURCE_GROUP/AZURE_VM_NAME when present, otherwise it asks
scripts/azure_staging_cli_preflight.sh to discover the VM by public IP.
AZURE_SUBSCRIPTION_ID and AZURE_TENANT_ID are optional operator
disambiguation fields; tenant selection is handled by az login/account state.
The command refuses to execute unless RUN_AZURE_STAGING_RUN_COMMAND=1 is set.
USAGE
}

if [[ "${1:-}" == "--contract-only" ]]; then
  grep -q 'RUN_AZURE_STAGING_RUN_COMMAND' "$0"
  grep -q 'az vm run-command invoke' "$0"
  grep -q 'AZURE_SUBSCRIPTION_ID' "$0"
  grep -q 'AZURE_TENANT_ID' "$0"
  grep -q 'AZURE_RESOURCE_GROUP' "$0"
  grep -q 'AZURE_VM_NAME' "$0"
  grep -q 'azure_staging_cli_preflight.sh --json' "$0"
  grep -q 'azure_staging_run_command_payload.sh' "$0"
  grep -q 'password_persisted=false' "$ROOT/scripts/azure_staging_run_command_payload.sh"
  printf 'azure staging run command invoke contract passed\n'
  exit 0
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

load_env_file
if [[ -n "${STAGING_SSH_HOST:-}" ]]; then
  RUN_COMMAND_TARGET_HOST="$STAGING_SSH_HOST"
elif [[ -n "${STAGING_SSH_TARGET:-}" ]]; then
  RUN_COMMAND_TARGET_HOST="$(zenari_extract_ssh_target_host "$STAGING_SSH_TARGET")"
else
  RUN_COMMAND_TARGET_HOST="$ZENARI_ACTIVE_AZURE_STAGING_IP"
fi
zenari_assert_active_azure_staging_host "$RUN_COMMAND_TARGET_HOST" "Azure staging Run Command invoke target"

if [[ "${RUN_AZURE_STAGING_RUN_COMMAND:-0}" != "1" ]]; then
  printf 'refusing to execute Azure Run Command without RUN_AZURE_STAGING_RUN_COMMAND=1\n' >&2
  exit 2
fi
if ! command -v az >/dev/null 2>&1; then
  printf 'missing Azure CLI: install az or use Azure Portal Run command with the generated payload\n' >&2
  exit 2
fi
if [[ -z "${AZURE_RESOURCE_GROUP:-}" || -z "${AZURE_VM_NAME:-}" ]]; then
  preflight_json="$("$ROOT/scripts/azure_staging_cli_preflight.sh" --json 2>/dev/null || true)"
  if [[ -z "$preflight_json" ]]; then
    printf 'missing AZURE_RESOURCE_GROUP/AZURE_VM_NAME and Azure CLI preflight did not return discovery data\n' >&2
    exit 2
  fi
  read -r discovered_status discovered_reason discovered_resource_group discovered_vm_name < <(printf '%s' "$preflight_json" | python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
print(data.get("status", ""), data.get("reason", ""), data.get("resource_group", ""), data.get("vm_name", ""))
')
  if [[ "$discovered_status" != "ready" || -z "$discovered_resource_group" || -z "$discovered_vm_name" ]]; then
    printf 'missing AZURE_RESOURCE_GROUP/AZURE_VM_NAME and Azure CLI preflight is not ready: %s\n' "${discovered_reason:-unknown}" >&2
    exit 2
  fi
  AZURE_RESOURCE_GROUP="$discovered_resource_group"
  AZURE_VM_NAME="$discovered_vm_name"
fi

"$ROOT/scripts/azure_staging_run_command_payload.sh" --output "$PAYLOAD_FILE" >/dev/null
if [[ ! -s "$PAYLOAD_FILE" ]]; then
  printf 'payload file was not generated: %s\n' "$PAYLOAD_FILE" >&2
  exit 2
fi

printf 'azure_run_command_target_resource_group=%s\n' "$AZURE_RESOURCE_GROUP"
printf 'azure_run_command_target_vm=%s\n' "$AZURE_VM_NAME"
printf 'azure_run_command_payload=%s\n' "$PAYLOAD_FILE"
printf 'password_persisted=false\n'

az vm run-command invoke \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_VM_NAME" \
  --command-id RunShellScript \
  --scripts @"$PAYLOAD_FILE" \
  --output json
