#!/usr/bin/env python3
"""Fetch Stage 1 exact CI artifacts from a GitHub Actions run.

The script downloads only validator-owned JSON artifacts, validates the three CI
evidence files together, then atomically publishes them to `ops/evidence/ci/`.
It never persists GitHub tokens, raw artifact zips, logs, or downloaded files
that fail strict validation.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "ops" / "evidence" / "ci"
DEFAULT_REPORT = ROOT / "ops" / "evidence" / "ci" / "stage1-ci-artifact-fetch.preflight.json"
CONTRACT = ROOT / "fixtures" / "stage1" / "ci_exact" / "local_contract.json"
VALIDATOR = ROOT / "scripts" / "validate_stage1_ci_exact_evidence.py"
DEFAULT_WORKFLOW = "stage0-rev2-ci.yml"
DEFAULT_BRANCH = "main"

REQUIRED_FILES = {
    "pr_main_run": {
        "artifact": "stage0-rev2-pr-main-run",
        "filename": "stage0-rev2-pr-main-run.json",
    },
    "playwright_smoke": {
        "artifact": "stage0-rev2-playwright-smoke",
        "filename": "stage0-rev2-playwright-smoke.json",
    },
    "docker_image_build": {
        "artifact": "stage0-rev2-docker-image-build",
        "filename": "stage0-rev2-docker-image-build.json",
    },
}
AGGREGATE_ARTIFACT = "stage1-ci-exact-evidence-aggregate"
RUN_URL_RE = re.compile(r"^https://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/actions/runs/(?P<run_id>[0-9]+)")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
RUN_ID_RE = re.compile(r"^[0-9]+$")
RAW_SECRET_RE = re.compile(
    r"(?i)(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9_]{20,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|X-Amz-Signature|GoogleAccessId)"
)
SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "token",
    "api_token",
    "github_token",
    "secret",
    "secret_key",
    "api_key",
    "raw_response",
    "raw_payload",
    "download_url",
    "archive_download_url",
    "signed_url",
}
SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "authorization_header_persisted",
    "raw_artifact_zip_persisted",
    "raw_log_persisted",
    "raw_response_body_persisted",
    "github_token_persisted",
)


class FetchCiArtifactsError(Exception):
    pass


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def repo_path(path: Path) -> Path:
    if path.is_absolute():
        return path
    return ROOT / path


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FetchCiArtifactsError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise FetchCiArtifactsError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise FetchCiArtifactsError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise FetchCiArtifactsError(f"{path}.{key} exposes secret/raw field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise FetchCiArtifactsError(f"{path} contains secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "ci_artifact_fetch")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sanitize_text(value: str, limit: int = 220) -> str:
    cleaned = RAW_SECRET_RE.sub("[redacted]", value.replace("\r", " ").replace("\n", " "))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) > limit:
        return cleaned[: limit - 3] + "..."
    return cleaned


def repository_from_git_remote() -> str:
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except OSError:
        return ""
    if result.returncode != 0:
        return ""
    remote = result.stdout.strip()
    if remote.startswith("git@github.com:"):
        remote = remote.removeprefix("git@github.com:")
    elif remote.startswith("https://github.com/"):
        remote = remote.removeprefix("https://github.com/")
    else:
        return ""
    remote = remote.removesuffix(".git").strip("/")
    return remote if REPOSITORY_RE.fullmatch(remote) else ""


def resolve_repository(args: argparse.Namespace) -> str:
    repository = (args.repository or os.environ.get("GITHUB_REPOSITORY") or "").strip()
    if not repository:
        repository = repository_from_git_remote()
    if not repository or not REPOSITORY_RE.fullmatch(repository):
        raise FetchCiArtifactsError("repository must be owner/name; pass --repository or run inside a GitHub repo")
    return repository


def parse_run_identity(args: argparse.Namespace) -> tuple[str, str, str]:
    repository = (args.repository or "").strip()
    run_id = (args.run_id or "").strip()
    run_url = (args.run_url or "").strip()
    if run_url:
        match = RUN_URL_RE.match(run_url)
        if not match:
            raise FetchCiArtifactsError("run URL must be a GitHub Actions run URL")
        repository = repository or f"{match.group('owner')}/{match.group('repo')}"
        run_id = run_id or match.group("run_id")
    if run_id and not repository:
        repository = resolve_repository(args)
    if not repository or not REPOSITORY_RE.fullmatch(repository):
        raise FetchCiArtifactsError("repository must be owner/name")
    if not run_id or not RUN_ID_RE.fullmatch(run_id):
        raise FetchCiArtifactsError("run id must be numeric")
    if not run_url:
        run_url = f"https://github.com/{repository}/actions/runs/{run_id}"
    return repository, run_id, run_url


def token_from_env(names: list[str]) -> tuple[str, str]:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value, name
    return "", ""


def token_from_gh_cli(enabled: bool) -> tuple[str, str]:
    if not enabled or not shutil.which("gh"):
        return "", ""
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
    except OSError:
        return "", ""
    token = result.stdout.strip()
    if result.returncode == 0 and token:
        return token, "gh_cli"
    return "", ""


def auth_token(args: argparse.Namespace) -> tuple[str, str]:
    token, source = token_from_env(args.token_env_names)
    if token:
        return token, source
    return token_from_gh_cli(args.use_gh_cli_auth)


def github_headers(token: str) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "zenari-stage1-ci-artifact-fetcher",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def http_request(url: str, headers: dict[str, str], *, timeout: int) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(1 << 20)


def github_json(url: str, headers: dict[str, str], *, timeout: int) -> dict[str, Any]:
    status, body = http_request(url, headers, timeout=timeout)
    if status < 200 or status > 299:
        detail = sanitize_text(body.decode("utf-8", errors="replace"))
        raise FetchCiArtifactsError(f"GitHub API request failed with HTTP {status}: {detail}")
    try:
        data = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise FetchCiArtifactsError(f"GitHub API returned invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise FetchCiArtifactsError("GitHub API response must be an object")
    return data


def latest_successful_run(args: argparse.Namespace, repository: str, headers: dict[str, str]) -> dict[str, Any]:
    workflow = args.workflow.strip() or DEFAULT_WORKFLOW
    params = {
        "branch": args.branch.strip() or DEFAULT_BRANCH,
        "status": "completed",
        "per_page": str(args.max_runs),
    }
    if args.event.strip():
        params["event"] = args.event.strip()
    query = urllib.parse.urlencode(params)
    workflow_ref = urllib.parse.quote(workflow, safe="")
    url = f"https://api.github.com/repos/{repository}/actions/workflows/{workflow_ref}/runs?{query}"
    try:
        data = github_json(url, headers, timeout=args.timeout_seconds)
    except FetchCiArtifactsError as exc:
        raise FetchCiArtifactsError(
            f"latest successful workflow lookup failed for {workflow} in {repository}: {exc}; "
            f"install .github/workflows/{workflow} on the default branch first"
        ) from exc
    runs = data.get("workflow_runs")
    if not isinstance(runs, list):
        raise FetchCiArtifactsError("GitHub workflow runs response missing workflow_runs list")
    release_sha = args.release_sha.strip().lower()
    for run in runs:
        if not isinstance(run, dict):
            continue
        if run.get("conclusion") != "success":
            continue
        if release_sha and str(run.get("head_sha", "")).lower() != release_sha:
            continue
        run_id = str(run.get("id", "")).strip()
        run_url = str(run.get("html_url", "")).strip()
        if RUN_ID_RE.fullmatch(run_id) and RUN_URL_RE.match(run_url):
            return {
                "run_id": run_id,
                "run_url": run_url,
                "head_sha": str(run.get("head_sha", "")),
                "head_branch": str(run.get("head_branch", "")),
                "event": str(run.get("event", "")),
                "created_at": str(run.get("created_at", "")),
                "updated_at": str(run.get("updated_at", "")),
            }
    detail = f"workflow={workflow} branch={params['branch']} status=completed"
    if params.get("event"):
        detail += f" event={params['event']}"
    if release_sha:
        detail += f" release_sha={release_sha}"
    raise FetchCiArtifactsError(f"no successful GitHub Actions run found for {repository}: {detail}")


def resolve_run_identity(args: argparse.Namespace, headers: dict[str, str]) -> tuple[str, str, str, dict[str, Any]]:
    if args.latest_successful:
        repository = resolve_repository(args)
        run = latest_successful_run(args, repository, headers)
        return (
            repository,
            run["run_id"],
            run["run_url"],
            {
                "mode": "latest_successful",
                "workflow": args.workflow.strip() or DEFAULT_WORKFLOW,
                "branch": args.branch.strip() or DEFAULT_BRANCH,
                "event_filter": args.event.strip(),
                "release_sha_filter": args.release_sha.strip().lower(),
                "selected_run": run,
            },
        )
    repository, run_id, run_url = parse_run_identity(args)
    return repository, run_id, run_url, {"mode": "explicit_run"}


def list_run_artifacts(repository: str, run_id: str, headers: dict[str, str], timeout: int) -> list[dict[str, Any]]:
    url = f"https://api.github.com/repos/{repository}/actions/runs/{run_id}/artifacts?per_page=100"
    artifacts: list[dict[str, Any]] = []
    while url:
        data = github_json(url, headers, timeout=timeout)
        page_artifacts = data.get("artifacts")
        if not isinstance(page_artifacts, list):
            raise FetchCiArtifactsError("GitHub artifacts response missing artifacts list")
        artifacts.extend(item for item in page_artifacts if isinstance(item, dict))
        url = ""
        # The first page is enough for the current workflow, which publishes four artifacts.
    return artifacts


def download_artifact_zip(artifact: dict[str, Any], headers: dict[str, str], timeout: int) -> bytes:
    archive_url = artifact.get("archive_download_url")
    if not isinstance(archive_url, str) or not archive_url.startswith("https://api.github.com/"):
        raise FetchCiArtifactsError(f"artifact {artifact.get('name', 'unknown')} has no safe archive download URL")
    status, body = http_request(archive_url, headers, timeout=timeout)
    if status < 200 or status > 299:
        raise FetchCiArtifactsError(f"artifact {artifact.get('name', 'unknown')} download failed with HTTP {status}")
    return body


def json_from_zip_member(zip_file: zipfile.ZipFile, member: str) -> dict[str, Any]:
    with zip_file.open(member) as handle:
        raw = handle.read(2 << 20)
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise FetchCiArtifactsError(f"artifact member {member} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise FetchCiArtifactsError(f"artifact member {member} must contain a JSON object")
    assert_no_secret(data, f"artifact.{member}")
    return data


def extract_required_from_zip(zip_bytes: bytes, source_name: str) -> dict[str, dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zip_file:
            members = [name for name in zip_file.namelist() if not name.endswith("/")]
            by_basename = {Path(name).name: name for name in members}
            for artifact_id, spec in REQUIRED_FILES.items():
                filename = spec["filename"]
                member = by_basename.get(filename)
                if member:
                    found[artifact_id] = json_from_zip_member(zip_file, member)
    except zipfile.BadZipFile as exc:
        raise FetchCiArtifactsError(f"artifact {source_name} is not a valid zip archive") from exc
    return found


def collect_from_github(args: argparse.Namespace) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    token, token_source = auth_token(args)
    headers = github_headers(token)
    repository, run_id, run_url, discovery = resolve_run_identity(args, headers)
    artifacts = list_run_artifacts(repository, run_id, headers, args.timeout_seconds)
    relevant_names = {spec["artifact"] for spec in REQUIRED_FILES.values()} | {AGGREGATE_ARTIFACT}
    relevant = [
        artifact
        for artifact in artifacts
        if artifact.get("name") in relevant_names and artifact.get("expired") is not True
    ]
    found: dict[str, dict[str, Any]] = {}
    artifact_statuses: list[dict[str, Any]] = []
    # Prefer the aggregate artifact when available, then fill gaps from individual job artifacts.
    relevant.sort(key=lambda item: 0 if item.get("name") == AGGREGATE_ARTIFACT else 1)
    for artifact in relevant:
        name = str(artifact.get("name", "unknown"))
        try:
            zip_bytes = download_artifact_zip(artifact, headers, args.timeout_seconds)
            extracted = extract_required_from_zip(zip_bytes, name)
        except FetchCiArtifactsError as exc:
            artifact_statuses.append({"name": name, "status": "blocked", "reason": sanitize_text(str(exc))})
            continue
        for artifact_id, data in extracted.items():
            found.setdefault(artifact_id, data)
        artifact_statuses.append(
            {
                "name": name,
                "status": "read",
                "required_files_found": sorted(extracted),
                "raw_zip_persisted": False,
            }
        )
    if len(found) < len(REQUIRED_FILES):
        try:
            gh_found, gh_metadata = collect_from_gh_cli_download(args, repository, run_id)
        except FetchCiArtifactsError as exc:
            artifact_statuses.append(
                {
                    "name": "gh_cli_download_fallback",
                    "status": "blocked",
                    "reason": sanitize_text(str(exc)),
                }
            )
        else:
            for artifact_id, data in gh_found.items():
                found.setdefault(artifact_id, data)
            artifact_statuses.append(
                {
                    "name": "gh_cli_download_fallback",
                    "status": "read",
                    "required_files_found": sorted(gh_found),
                    "raw_download_dir_persisted": False,
                }
            )
            artifact_statuses.extend(
                {
                    "name": f"gh_cli_download:{artifact_id}",
                    "status": "read",
                    "filename": REQUIRED_FILES[artifact_id]["filename"],
                }
                for artifact_id in sorted(gh_found)
            )
            gh_metadata.pop("input_dir", None)
            gh_metadata.pop("required_files_found", None)
            gh_metadata.pop("source", None)
            gh_metadata.pop("repository", None)
            gh_metadata.pop("run_id", None)
            artifact_statuses.append(
                {
                    "name": "gh_cli_download_metadata",
                    "status": "read",
                    **gh_metadata,
                }
            )
    metadata = {
        "source": "github_actions_api",
        "repository": repository,
        "run_id": run_id,
        "run_url": run_url,
        "auth_present": bool(token_source),
        "auth_source": token_source or "none",
        "run_discovery": discovery,
        "artifact_count_seen": len(artifacts),
        "artifact_count_relevant": len(relevant),
        "artifact_statuses": artifact_statuses,
    }
    return found, metadata


def collect_from_input_dir(input_dir: Path) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    root = input_dir.resolve()
    if not root.exists() or not root.is_dir():
        raise FetchCiArtifactsError(f"input dir missing or not a directory: {display_path(root)}")
    found: dict[str, dict[str, Any]] = {}
    for artifact_id, spec in REQUIRED_FILES.items():
        matches = sorted(root.rglob(spec["filename"]))
        if matches:
            found[artifact_id] = load_json(matches[0])
            assert_no_secret(found[artifact_id], artifact_id)
    metadata = {
        "source": "local_input_dir",
        "input_dir": display_path(root),
        "required_files_found": sorted(found),
    }
    return found, metadata


def collect_from_gh_cli_download(args: argparse.Namespace, repository: str, run_id: str) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    if not args.use_gh_cli_auth or not shutil.which("gh"):
        raise FetchCiArtifactsError("gh CLI artifact download fallback is unavailable")
    with tempfile.TemporaryDirectory(prefix="zenari-gh-run-download-") as tmp:
        result = subprocess.run(
            ["gh", "run", "download", run_id, "--repo", repository, "--dir", tmp],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode != 0:
            detail = sanitize_text((result.stderr or result.stdout or "").strip())
            raise FetchCiArtifactsError(f"gh run download failed: {detail}")
        found, metadata = collect_from_input_dir(Path(tmp))
        metadata.update(
            {
                "source": "github_actions_gh_cli_download",
                "repository": repository,
                "run_id": run_id,
                "gh_cli_download_succeeded": True,
                "raw_download_dir_persisted": False,
            }
        )
        return found, metadata


def write_candidate_files(found: dict[str, dict[str, Any]], candidate_dir: Path) -> dict[str, Path]:
    candidate_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for artifact_id, spec in REQUIRED_FILES.items():
        if artifact_id not in found:
            continue
        path = candidate_dir / spec["filename"]
        path.write_text(json.dumps(found[artifact_id], indent=2, sort_keys=True) + "\n", encoding="utf-8")
        paths[artifact_id] = path
    return paths


def validate_candidates(candidate_paths: dict[str, Path]) -> tuple[bool, str]:
    missing = [artifact_id for artifact_id in REQUIRED_FILES if artifact_id not in candidate_paths]
    if missing:
        return False, f"missing required CI artifact(s): {', '.join(missing)}"
    result = subprocess.run(
        [
            sys.executable,
            "scripts/validate_stage1_ci_exact_evidence.py",
            "--pr-main",
            str(candidate_paths["pr_main_run"]),
            "--playwright",
            str(candidate_paths["playwright_smoke"]),
            "--docker",
            str(candidate_paths["docker_image_build"]),
        ],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    output = sanitize_text((result.stderr or result.stdout or "").strip(), limit=500)
    return result.returncode == 0, output or "strict CI exact validator passed"


def publish_candidates(candidate_paths: dict[str, Path], output_dir: Path) -> list[str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    published: list[str] = []
    for artifact_id, spec in REQUIRED_FILES.items():
        source = candidate_paths[artifact_id]
        target = output_dir / spec["filename"]
        temp_target = target.with_suffix(target.suffix + ".tmp")
        shutil.copyfile(source, temp_target)
        os.replace(temp_target, target)
        published.append(display_path(target))
    return published


def build_report(
    *,
    status: str,
    source_metadata: dict[str, Any],
    found: dict[str, dict[str, Any]],
    validator_passed: bool,
    validator_output: str,
    published: list[str],
    dry_run: bool,
) -> dict[str, Any]:
    missing = [artifact_id for artifact_id in REQUIRED_FILES if artifact_id not in found]
    blockers = []
    if missing:
        blockers.append(f"missing required CI artifact(s): {', '.join(missing)}")
    if not validator_passed:
        blockers.append(f"strict CI exact validator did not pass: {validator_output}")
    report: dict[str, Any] = {
        "schema_version": "stage1.ci_artifact_fetch.preflight.v1",
        "kind": "stage1_ci_artifact_fetch_preflight",
        "environment": "ci",
        "status": status,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source_metadata": source_metadata,
        "required_artifacts": {
            artifact_id: {
                "artifact": spec["artifact"],
                "filename": spec["filename"],
                "found": artifact_id in found,
            }
            for artifact_id, spec in REQUIRED_FILES.items()
        },
        "strict_validator": "python3 scripts/validate_stage1_ci_exact_evidence.py",
        "strict_validator_passed": validator_passed,
        "strict_validator_output": validator_output,
        "canonical_artifacts_written": bool(published) and not dry_run,
        "published_artifacts": published,
        "dry_run": dry_run,
        "can_clear_ci_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "blockers": blockers,
        "safe_projection_policy": {field: False for field in SAFE_FALSE_FIELDS},
    }
    for field in SAFE_FALSE_FIELDS:
        report[field] = False
    return report


def validate_contract_anchors() -> None:
    contract = load_json(CONTRACT)
    policy = contract.get("artifact_fetch_policy")
    if not isinstance(policy, dict):
        raise FetchCiArtifactsError("CI exact contract artifact_fetch_policy must be object")
    if policy.get("fetch_command") != "python3 scripts/fetch_stage1_ci_artifacts.py":
        raise FetchCiArtifactsError("CI exact contract artifact fetch command mismatch")
    if policy.get("strict_validator") != "python3 scripts/validate_stage1_ci_exact_evidence.py":
        raise FetchCiArtifactsError("CI exact contract artifact fetch strict validator mismatch")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch and validate Stage 1 CI exact GitHub Actions artifacts")
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--run-url", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--repository", default="")
    parser.add_argument("--latest-successful", action="store_true", help="auto-discover the latest successful workflow run")
    parser.add_argument("--workflow", default=DEFAULT_WORKFLOW, help="workflow file/name/id for --latest-successful")
    parser.add_argument("--branch", default=DEFAULT_BRANCH, help="branch filter for --latest-successful")
    parser.add_argument("--event", default="", help="optional GitHub event filter for --latest-successful")
    parser.add_argument("--release-sha", default="", help="optional head SHA filter for --latest-successful")
    parser.add_argument("--max-runs", type=int, default=20, help="max workflow runs to scan for --latest-successful")
    parser.add_argument("--input-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--token-env", action="append", dest="token_env_names")
    parser.add_argument("--no-gh-cli-auth", action="store_false", dest="use_gh_cli_auth", help="do not fall back to `gh auth token`")
    parser.add_argument("--timeout-seconds", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true", help="validate fetched artifacts without writing canonical outputs")
    args = parser.parse_args()
    if args.max_runs < 1 or args.max_runs > 100:
        parser.error("--max-runs must be between 1 and 100")
    if args.input_dir and args.latest_successful:
        parser.error("--input-dir cannot be combined with --latest-successful")
    if args.token_env_names is None:
        args.token_env_names = ["GITHUB_TOKEN", "GH_TOKEN"]
    return args


def main() -> int:
    args = parse_args()
    try:
        validate_contract_anchors()
        if args.contract_only:
            print("stage1 CI artifact fetch contract passed")
            return 0
        if args.input_dir:
            found, metadata = collect_from_input_dir(repo_path(args.input_dir))
        else:
            found, metadata = collect_from_github(args)
        with tempfile.TemporaryDirectory(prefix="zenari-ci-artifacts-") as tmp:
            candidate_paths = write_candidate_files(found, Path(tmp))
            validator_passed, validator_output = validate_candidates(candidate_paths)
            published: list[str] = []
            status = "ready" if validator_passed else "blocked"
            if validator_passed and not args.dry_run:
                published = publish_candidates(candidate_paths, repo_path(args.output_dir))
                # Verify the canonical default paths after atomic publish.
                canonical_ok, canonical_output = validate_candidates(
                    {
                        artifact_id: repo_path(args.output_dir) / spec["filename"]
                        for artifact_id, spec in REQUIRED_FILES.items()
                    }
                )
                validator_passed = validator_passed and canonical_ok
                validator_output = canonical_output if not canonical_ok else validator_output
                status = "ready" if validator_passed else "blocked"
            report = build_report(
                status=status,
                source_metadata=metadata,
                found=found,
                validator_passed=validator_passed,
                validator_output=validator_output,
                published=published,
                dry_run=args.dry_run,
            )
            write_json(repo_path(args.report), report)
    except FetchCiArtifactsError as exc:
        report = build_report(
            status="blocked",
            source_metadata={"source": "error"},
            found={},
            validator_passed=False,
            validator_output=sanitize_text(str(exc)),
            published=[],
            dry_run=args.dry_run,
        )
        try:
            write_json(repo_path(args.report), report)
        except FetchCiArtifactsError:
            pass
        print(f"fetch Stage 1 CI artifacts failed: {exc}", file=sys.stderr)
        return 2
    print(f"stage1 CI artifact fetch {status}: report {display_path(repo_path(args.report))}")
    return 0 if validator_passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
