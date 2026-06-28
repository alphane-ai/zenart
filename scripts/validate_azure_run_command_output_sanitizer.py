#!/usr/bin/env python3
"""Validate Azure Run Command output sanitizer behavior."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SANITIZER = ROOT / "scripts" / "sanitize_azure_run_command_output.py"
CLASSIFIER = ROOT / "scripts" / "classify_azure_run_command_output.py"


class ContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def main() -> int:
    source = SANITIZER.read_text(encoding="utf-8")
    for snippet in (
        "azure-run-command-ssh-repair.output.txt",
        "raw_output_persisted=false",
        "cfat_",
        "Bearer",
        "Authorization",
        "Set-Cookie",
        "PRIVATE KEY",
        "X-Amz-Signature",
        "GoogleAccessId",
        "zenari_azure_run_command_payload=complete",
        "classify_azure_run_command_output.py",
    ):
        require(snippet in source, f"sanitizer missing {snippet!r}")
    require("set -x" not in source, "sanitizer must not include shell xtrace")
    subprocess.run(["python3", str(SANITIZER), "--contract-only"], cwd=ROOT, check=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        raw = tmp_path / "raw.txt"
        sanitized = tmp_path / "sanitized.txt"
        diagnosis = tmp_path / "diagnosis.json"
        raw.write_text(
            "\n".join(
                [
                    "zenari_azure_run_command_payload=ssh_repair_v1",
                    "Authorization: Bearer secret-token-value",
                    "Cookie: session=abc",
                    "SET_COOKIE_SECRET=abcdef",
                    "DATABASE_URL=postgres://user:pass@example/db",
                    "X-Amz-Signature=abcdef123456",
                    "origin_diagnostics_begin",
                    "docker_cli=present",
                    "docker_compose=present",
                    "release_dir_present=true",
                    "compose_file_present=true",
                    "worker_crawler_backend_image_match=true",
                    "manager_absent=true",
                    "caddy_container=present",
                    "caddy_running=true",
                    "origin_listener_80=present",
                    "origin_listener_443=present",
                    "local_backend_healthz=200",
                    "local_caddy_root=200",
                    "origin_diagnostics_end",
                    "ssh_socket_status=",
                    "sshd_config_test_after=",
                    "listening_ssh_after=",
                    "LISTEN 0 128 0.0.0.0:22",
                    "zenari_azure_run_command_payload=complete",
                ]
            ),
            encoding="utf-8",
        )
        result = subprocess.run(
            ["python3", str(SANITIZER), "--input", str(raw), "--output", str(sanitized), "--require-marker"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        require("redaction_count=" in result.stdout, "sanitizer must report redaction count")
        text = sanitized.read_text(encoding="utf-8")
        for forbidden in ("Bearer secret-token-value", "session=abc", "postgres://user:pass@example/db", "abcdef123456"):
            require(forbidden not in text, f"sanitized output retained {forbidden!r}")
        require("[redacted]" in text, "sanitized output must include redaction marker")
        classify_status = subprocess.run(
            ["python3", str(CLASSIFIER), "--input", str(sanitized), "--output", str(diagnosis)],
            cwd=ROOT,
            check=False,
        ).returncode
        require(classify_status == 2, f"classifier should preserve blocked origin status with exit 2, got {classify_status}")
        diagnosis_data = json.loads(diagnosis.read_text(encoding="utf-8"))
        require(diagnosis_data.get("status") == "blocked", "sanitized partial-origin sample must remain blocked")
        require(diagnosis_data.get("ssh_repair_status") == "pass", "sanitized sample must show SSH repair pass")
        require(diagnosis_data.get("origin_runtime_status") == "missing", "sanitized sample must show incomplete origin runtime")
        require(diagnosis_data.get("next_repair_lane") == "origin_runtime_unknown", "sanitized sample must route next repair to origin diagnostics")

        no_marker = tmp_path / "no-marker.txt"
        no_marker.write_text("not the payload\n", encoding="utf-8")
        status = subprocess.run(
            ["python3", str(SANITIZER), "--input", str(no_marker), "--output", str(tmp_path / "no-marker-out.txt"), "--require-marker"],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode
        require(status != 0, "require-marker must reject unrelated output")

        stdin_out = tmp_path / "stdin.txt"
        subprocess.run(
            ["python3", str(SANITIZER), "--output", str(stdin_out)],
            cwd=ROOT,
            input="zenari_azure_run_command_payload=ssh_repair_v1\nBearer another-secret\n",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        require("another-secret" not in stdin_out.read_text(encoding="utf-8"), "stdin sanitizer must redact bearer token")

    print("azure run command output sanitizer validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
