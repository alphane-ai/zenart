#!/usr/bin/env bash

# Shared guard for Zenari's single active Azure staging VM.
# Keep this file free of retired IP literals; the validator owns that denylist.

ZENARI_ACTIVE_AZURE_STAGING_IP="52.237.80.117"

zenari_extract_ssh_target_host() {
  local target="$1"
  local host="${target#*@}"
  host="${host#[}"
  host="${host%]}"
  printf '%s' "$host"
}

zenari_assert_active_azure_staging_host() {
  local host="$1"
  local context="${2:-Azure staging target}"
  if [[ -z "$host" ]]; then
    printf '%s is missing a host; set STAGING_SSH_HOST=%s in the gitignored local .env\n' "$context" "$ZENARI_ACTIVE_AZURE_STAGING_IP" >&2
    exit 2
  fi
  if [[ "$host" != "$ZENARI_ACTIVE_AZURE_STAGING_IP" ]]; then
    printf '%s must use active Azure staging IP %s; got %s\n' "$context" "$ZENARI_ACTIVE_AZURE_STAGING_IP" "$host" >&2
    printf 'Set STAGING_SSH_HOST=%s and STAGING_SSH_TARGET=<user>@%s in the gitignored local .env.\n' "$ZENARI_ACTIVE_AZURE_STAGING_IP" "$ZENARI_ACTIVE_AZURE_STAGING_IP" >&2
    exit 2
  fi
}

zenari_assert_active_azure_staging_target() {
  local target="$1"
  local context="${2:-Azure staging SSH target}"
  local host
  host="$(zenari_extract_ssh_target_host "$target")"
  zenari_assert_active_azure_staging_host "$host" "$context"
}
