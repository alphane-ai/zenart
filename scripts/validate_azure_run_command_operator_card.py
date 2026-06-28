#!/usr/bin/env python3
"""Validate the non-secret Azure Run Command operator card."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CARD = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-operator-card.md"

SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"postgres(?:ql)?://|Stripe-Signature\s*[:=]|X-Amz-Signature|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"azure run command operator card validation failed: {message}")


def main() -> int:
    text = CARD.read_text(encoding="utf-8")
    for snippet in (
        "Azure Run Command Operator Card",
        "non-secret, non-clearing",
        "staging.zenari.ai",
        "52.237.80.117",
        "This is not currently a Stripe, z.ai, R2, username, or password blocker.",
        "vm_protocol_services_unresponsive",
        "not viable until the VM returns an SSH banner",
        "core backend/web/admin/worker/crawler container states",
        "Optional Local Azure CLI Targeting",
        "AZURE_SUBSCRIPTION_ID=",
        "AZURE_TENANT_ID=",
        "AZURE_RESOURCE_GROUP=",
        "AZURE_VM_NAME=",
        "minimum useful pair",
        "scripts/azure_staging_run_command_invoke.sh",
        "RunShellScript",
        "Do not run this payload in an Azure",
        "ops/evidence/staging/azure-run-command-ssh-repair.sh",
        "ops/evidence/staging/azure-run-command-ssh-repair.output.txt",
        "ingest_azure_run_command_output.py",
        "sanitize_azure_run_command_output.py",
        "classify_azure_run_command_output.py",
        "stage1_azure_origin_readiness.py",
        "--env .env",
        "validate_stage1_azure_origin_readiness.py",
        "generate_stage1_next_blockers_summary.py",
        "validate_stage1_next_blockers_summary.py",
        "zenari_azure_run_command_payload=complete",
        "Do not save SSH passwords",
    ):
        require(snippet in text, f"missing required snippet {snippet!r}")
    require(
        "Paste this into Cloud Shell" not in text and "Run it in Cloud Shell" not in text,
        "operator card must not direct the user to Cloud Shell",
    )
    require(not SECRET_RE.search(text), "operator card contains secret-looking material")
    print("azure run command operator card validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
