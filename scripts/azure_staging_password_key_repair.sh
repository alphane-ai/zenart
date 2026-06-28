#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
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
Usage: scripts/azure_staging_password_key_repair.sh [--contract-only]

Reads STAGING_SSH_PASSWORD from the gitignored local environment and uses it
only inside an expect session to install the configured public key on the Azure
staging VM. The password is never echoed, persisted, or written to evidence.
USAGE
}

if [[ "${1:-}" == "--contract-only" ]]; then
  if ! command -v expect >/dev/null 2>&1; then
    printf 'warning: expect is not installed; live repair will be unavailable\n' >&2
  fi
  grep -q 'STAGING_SSH_PASSWORD' "$ROOT/.env.example"
  grep -q 'set timeout' "$0"
  grep -q 'authorized_keys' "$0"
  grep -q 'NOPASSWD:ALL' "$0"
  grep -q 'StrictHostKeyChecking=accept-new' "$0"
  grep -q 'ServerAliveInterval=5' "$0"
  grep -q 'ServerAliveCountMax=2' "$0"
  grep -q 'STAGING_SSH_HARD_TIMEOUT' "$0"
  grep -q 'log_user 0' "$0"
  printf 'azure staging password key repair contract passed\n'
  exit 0
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

load_env_file

if ! command -v expect >/dev/null 2>&1; then
  printf 'expect is required for password-based one-time repair\n' >&2
  exit 2
fi

TARGET="${STAGING_SSH_TARGET:-}"
if [[ -z "$TARGET" ]]; then
  if [[ -n "${STAGING_SSH_USER:-}" && -n "${STAGING_SSH_HOST:-}" ]]; then
    TARGET="${STAGING_SSH_USER}@${STAGING_SSH_HOST}"
  else
    printf 'missing STAGING_SSH_TARGET or STAGING_SSH_USER/STAGING_SSH_HOST in %s\n' "$ENV_FILE" >&2
    exit 2
  fi
fi

SSH_PASSWORD="${STAGING_SSH_PASSWORD:-}"
if [[ -z "$SSH_PASSWORD" ]]; then
  printf 'missing STAGING_SSH_PASSWORD in %s; keep it gitignored and never commit it\n' "$ENV_FILE" >&2
  exit 2
fi

SSH_KEY="${STAGING_SSH_KEY:-$HOME/.ssh/id_ed25519_machine_login}"
CONNECT_TIMEOUT="${STAGING_SSH_CONNECT_TIMEOUT:-8}"
SSH_HARD_TIMEOUT="${STAGING_SSH_HARD_TIMEOUT:-20}"
if [[ ! -f "$SSH_KEY" ]]; then
  printf 'missing private key %s\n' "$SSH_KEY" >&2
  exit 2
fi
if [[ -f "${SSH_KEY}.pub" ]]; then
  PUBLIC_KEY="$(sed -n '1p' "${SSH_KEY}.pub")"
else
  PUBLIC_KEY="$(ssh-keygen -y -f "$SSH_KEY")"
fi
if [[ -z "$PUBLIC_KEY" ]]; then
  printf 'failed to derive public key from %s\n' "$SSH_KEY" >&2
  exit 2
fi

TARGET_USER="${TARGET%@*}"
TARGET_HOST="${TARGET#*@}"
zenari_assert_active_azure_staging_target "$TARGET" "Azure staging password/key repair target"
PUBLIC_KEY_FINGERPRINT="$(printf '%s\n' "$PUBLIC_KEY" | ssh-keygen -lf - 2>/dev/null | awk '{print $2}' || true)"

printf 'azure staging password key repair target=%s key_fingerprint=%s\n' "$TARGET" "${PUBLIC_KEY_FINGERPRINT:-unknown}"
printf 'password_source=STAGING_SSH_PASSWORD\n'
printf 'password_persisted=false\n'
printf 'ssh_hard_timeout=%ss\n' "$SSH_HARD_TIMEOUT"

export ZENARI_REPAIR_PASSWORD="$SSH_PASSWORD"
export ZENARI_REPAIR_USER="$TARGET_USER"
export ZENARI_REPAIR_HOST="$TARGET_HOST"
export ZENARI_REPAIR_PUBKEY="$PUBLIC_KEY"
export ZENARI_REPAIR_TIMEOUT="$CONNECT_TIMEOUT"
export ZENARI_REPAIR_HARD_TIMEOUT="$SSH_HARD_TIMEOUT"

set +e
repair_output="$(
expect 2>&1 <<'EXPECT'
log_user 0
set timeout $env(ZENARI_REPAIR_HARD_TIMEOUT)
set password $env(ZENARI_REPAIR_PASSWORD)
set target "$env(ZENARI_REPAIR_USER)@$env(ZENARI_REPAIR_HOST)"
set pubkey $env(ZENARI_REPAIR_PUBKEY)
set remote_script {set -euo pipefail; umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; if ! grep -qxF "$PUBKEY" ~/.ssh/authorized_keys; then printf "%s\n" "$PUBKEY" >> ~/.ssh/authorized_keys; fi; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; grep -qxF "$PUBKEY" ~/.ssh/authorized_keys; printf "%s\n" "$PUBKEY" | ssh-keygen -lf -}
set remote_cmd "PUBKEY='$pubkey' bash -lc "
append remote_cmd "'" $remote_script "'"
spawn ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password -o StrictHostKeyChecking=accept-new -o ConnectTimeout=$env(ZENARI_REPAIR_TIMEOUT) -o ServerAliveInterval=5 -o ServerAliveCountMax=2 $target $remote_cmd
expect {
  -re "(?i)password:" {
    send -- "$password\r"
    exp_continue
  }
  -re "(?i)permission denied" {
    exit 13
  }
  eof {
    catch wait result
    set exit_code [lindex $result 3]
    exit $exit_code
  }
  timeout {
    exit 14
  }
}
EXPECT
)"
repair_status=$?
set -e

unset ZENARI_REPAIR_PASSWORD

if [[ "$repair_status" -ne 0 ]]; then
  printf 'password_repair_command=failed\n' >&2
  printf 'password_repair_exit_code=%s\n' "$repair_status" >&2
  if [[ "$repair_status" -eq 13 ]]; then
    printf 'password_repair_failure_reason=password_auth_permission_denied\n' >&2
  elif [[ "$repair_status" -eq 14 ]]; then
    printf 'password_repair_failure_reason=ssh_connect_timeout_or_no_password_prompt\n' >&2
  elif [[ "$repair_status" -eq 255 ]]; then
    printf 'password_repair_failure_reason=ssh_transport_failed_before_key_install\n' >&2
  elif [[ "$repair_output" == *"timed out during banner exchange"* || "$repair_output" == *"Connection timed out"* || "$repair_output" == *"Operation timed out"* ]]; then
    printf 'password_repair_failure_reason=ssh_connect_timeout\n' >&2
  elif [[ "$repair_output" == *"Permission denied"* ]]; then
    printf 'password_repair_failure_reason=password_auth_permission_denied\n' >&2
  else
    printf 'password_repair_failure_reason=password_key_repair_failed_before_key_install\n' >&2
  fi
  if [[ -n "$repair_output" ]]; then
    printf '%s\n' "$repair_output" | sed -E \
      -e 's/(password: )[[:graph:]]+/\1[redacted]/Ig' \
      -e 's/(Bearer )[A-Za-z0-9._~+\\/=-]+/\\1[redacted]/Ig' \
      -e 's/(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/[redacted]/Ig' >&2
  else
    printf 'password_repair_remote_output=empty\n' >&2
  fi
  exit "$repair_status"
fi

printf 'password_repair_command=completed\n'
printf 'running key preflight after repair\n'
"$ROOT/scripts/azure_staging_ssh_preflight.sh"
