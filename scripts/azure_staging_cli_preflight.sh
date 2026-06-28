#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
DEFAULT_AZURE_IP="${STAGING_SSH_HOST:-52.237.80.117}"
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
Usage: scripts/azure_staging_cli_preflight.sh [--json]

Checks whether Azure CLI can identify the staging VM for Run Command execution.
It never invokes remote commands. It can use AZURE_RESOURCE_GROUP/AZURE_VM_NAME
from the private environment, or try to discover the VM by public IP.
USAGE
}

if [[ "${1:-}" == "--contract-only" ]]; then
  grep -q 'az account show' "$0"
  grep -q 'az vm list-ip-addresses' "$0"
  grep -q 'AZURE_RESOURCE_GROUP' "$0"
  grep -q 'AZURE_VM_NAME' "$0"
  grep -q 'azure_cli_preflight_status' "$0"
  printf 'azure staging cli preflight contract passed\n'
  exit 0
fi

JSON=0
if [[ "${1:-}" == "--json" ]]; then
  JSON=1
elif [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
elif [[ $# -gt 0 ]]; then
  printf 'unknown argument: %s\n' "$1" >&2
  usage >&2
  exit 2
fi

load_env_file
if [[ -n "${STAGING_SSH_HOST:-}" ]]; then
  DEFAULT_AZURE_IP="$STAGING_SSH_HOST"
elif [[ -n "${STAGING_SSH_TARGET:-}" ]]; then
  DEFAULT_AZURE_IP="$(zenari_extract_ssh_target_host "$STAGING_SSH_TARGET")"
else
  DEFAULT_AZURE_IP="$ZENARI_ACTIVE_AZURE_STAGING_IP"
fi
zenari_assert_active_azure_staging_host "$DEFAULT_AZURE_IP" "Azure staging CLI preflight target"

emit_json() {
  python3 - "$@" <<'PY'
import json
import sys

keys = ("status", "reason", "subscription_id", "resource_group", "vm_name", "azure_ip")
print(json.dumps(dict(zip(keys, sys.argv[1:])), ensure_ascii=False))
PY
}

emit() {
  local status="$1" reason="$2" subscription_id="${3:-}" resource_group="${4:-}" vm_name="${5:-}" azure_ip="${6:-$DEFAULT_AZURE_IP}"
  if [[ "$JSON" == "1" ]]; then
    emit_json "$status" "$reason" "$subscription_id" "$resource_group" "$vm_name" "$azure_ip"
  else
    printf 'azure_cli_preflight_status=%s\n' "$status"
    printf 'azure_cli_preflight_reason=%s\n' "$reason"
    [[ -n "$subscription_id" ]] && printf 'subscription_id=%s\n' "$subscription_id"
    [[ -n "$resource_group" ]] && printf 'resource_group=%s\n' "$resource_group"
    [[ -n "$vm_name" ]] && printf 'vm_name=%s\n' "$vm_name"
    printf 'azure_ip=%s\n' "$azure_ip"
  fi
}

if ! command -v az >/dev/null 2>&1; then
  emit "blocked" "az_cli_missing" "" "${AZURE_RESOURCE_GROUP:-}" "${AZURE_VM_NAME:-}" "$DEFAULT_AZURE_IP"
  exit 2
fi

account_json="$(az account show -o json 2>/dev/null || true)"
if [[ -z "$account_json" ]]; then
  emit "blocked" "az_not_logged_in" "" "${AZURE_RESOURCE_GROUP:-}" "${AZURE_VM_NAME:-}" "$DEFAULT_AZURE_IP"
  exit 2
fi
subscription_id="$(printf '%s' "$account_json" | python3 -c 'import json, sys
try:
    print(json.load(sys.stdin).get("id", ""))
except Exception:
    print("")
')"

if [[ -n "${AZURE_SUBSCRIPTION_ID:-}" ]]; then
  az account set --subscription "$AZURE_SUBSCRIPTION_ID" >/dev/null
  subscription_id="$AZURE_SUBSCRIPTION_ID"
fi

if [[ -n "${AZURE_RESOURCE_GROUP:-}" && -n "${AZURE_VM_NAME:-}" ]]; then
  if az vm show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_VM_NAME" --query id -o tsv >/dev/null 2>&1; then
    emit "ready" "env_vm_found" "$subscription_id" "$AZURE_RESOURCE_GROUP" "$AZURE_VM_NAME" "$DEFAULT_AZURE_IP"
    exit 0
  fi
  emit "blocked" "env_vm_not_found" "$subscription_id" "$AZURE_RESOURCE_GROUP" "$AZURE_VM_NAME" "$DEFAULT_AZURE_IP"
  exit 2
fi

discovery_json="$(az vm list-ip-addresses -o json 2>/dev/null || true)"
if [[ -z "$discovery_json" ]]; then
  emit "blocked" "vm_ip_discovery_failed" "$subscription_id" "" "" "$DEFAULT_AZURE_IP"
  exit 2
fi

read -r resource_group vm_name < <(printf '%s' "$discovery_json" | python3 -c 'import json
import sys

target = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    data = []
for vm in data:
    for nic in vm.get("virtualMachine", {}).get("network", {}).get("publicIpAddresses", []) or []:
        if nic.get("ipAddress") == target:
            print(vm.get("resourceGroup", ""), vm.get("virtualMachine", {}).get("name", ""))
            raise SystemExit(0)
print("", "")
' "$DEFAULT_AZURE_IP")

if [[ -n "$resource_group" && -n "$vm_name" ]]; then
  emit "ready" "vm_found_by_public_ip" "$subscription_id" "$resource_group" "$vm_name" "$DEFAULT_AZURE_IP"
  exit 0
fi

emit "blocked" "vm_not_found_by_public_ip" "$subscription_id" "" "" "$DEFAULT_AZURE_IP"
exit 2
