#!/usr/bin/env python3
"""Validate the Stage 1 release image boundary.

Stage 1 ships exactly three release images: backend, web, and admin. Backend
runtime entrypoints such as worker/crawler/migrate may exist, but they must not
be promoted to independent release images or public deployment units.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
RELEASE_IMAGES = {"backend", "web", "admin"}
FORBIDDEN_RELEASE_IMAGES = {"manager", "worker", "crawler", "migrate"}
DOCKER_COMPOSE = ROOT / "docker-compose.yml"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
RELEASE_METADATA_CONTRACT = ROOT / "fixtures" / "stage1" / "release_metadata" / "local_contract.json"
CI_EXACT_CONTRACT = ROOT / "fixtures" / "stage1" / "ci_exact" / "local_contract.json"
RELEASE_METADATA_VALIDATOR = ROOT / "scripts" / "validate_stage1_release_metadata_contract.py"
RELEASE_METADATA_PREFLIGHT = ROOT / "scripts" / "generate_stage1_release_metadata_preflight.py"
RELEASE_CANDIDATE_GENERATOR = ROOT / "scripts" / "generate_stage1_release_candidate_metadata.py"
AZURE_DEPLOY = ROOT / "scripts" / "azure_staging_deploy.sh"
CI_DOCKER_EVIDENCE = ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-docker-image-build.json"


class ReleaseImageBoundaryError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ReleaseImageBoundaryError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise ReleaseImageBoundaryError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(value, dict), f"{display_path(path)} must contain a JSON object")
    return value


def parse_compose_services(text: str) -> dict[str, dict[str, str]]:
    services: dict[str, dict[str, str]] = {}
    in_services = False
    current: str | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if indent == 0:
            in_services = stripped == "services:"
            current = None
            continue
        if not in_services:
            continue
        if indent == 2 and stripped.endswith(":"):
            current = stripped[:-1]
            services[current] = {}
            continue
        if current is None or indent < 4:
            continue
        if ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        services[current].setdefault(key.strip(), value.strip())

    return services


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def service_image(services: dict[str, dict[str, str]], service: str) -> str:
    image = services.get(service, {}).get("image", "")
    return unquote(image)


def validate_compose() -> None:
    text = read_text(DOCKER_COMPOSE)
    services = parse_compose_services(text)

    require("manager" not in services, "docker-compose.yml must not define legacy manager service")
    for service in ("backend", "worker", "crawler", "web", "admin"):
        require(service in services, f"docker-compose.yml missing expected service {service}")

    backend_image = service_image(services, "backend")
    require(backend_image, "backend service must declare image")
    for service, expected_entrypoint in (("worker", "/app/worker"), ("crawler", "/app/crawler")):
        image = service_image(services, service)
        require(image == backend_image, f"{service} image must match backend image")
        require("build" not in services[service], f"{service} must not define its own build context")
        entrypoint = services[service].get("entrypoint", "")
        require(expected_entrypoint in entrypoint, f"{service} must run {expected_entrypoint} backend runtime entrypoint")

    for service in ("web", "admin"):
        require("build" in services[service], f"{service} release service must define build")
    require("build" in services["backend"], "backend release service must define build")

    require(
        "not independent Stage 1 release images" in text
        and "runtime entrypoints" in text,
        "docker-compose.yml must document worker/crawler as backend runtime entrypoints",
    )


def validate_release_metadata_contract() -> None:
    contract = read_json(RELEASE_METADATA_CONTRACT)
    require(set(contract.get("required_image_names") or []) == RELEASE_IMAGES, "release metadata required_image_names must be backend/web/admin")
    require(
        FORBIDDEN_RELEASE_IMAGES <= set(contract.get("forbidden_release_image_names") or []),
        "release metadata contract must forbid manager/worker/crawler/migrate release images",
    )


def validate_ci_exact_contract() -> None:
    contract = read_json(CI_EXACT_CONTRACT)
    required = contract.get("required_evidence")
    require(isinstance(required, list), "CI exact contract required_evidence must be a list")
    docker = next((item for item in required if isinstance(item, dict) and item.get("artifact_id") == "docker_image_build"), None)
    require(isinstance(docker, dict), "CI exact contract missing docker_image_build artifact")
    proofs = " ".join(str(item) for item in docker.get("required_proofs") or [])
    require("web image build" in proofs, "CI Docker proof must require web image build")
    require("admin image build" in proofs, "CI Docker proof must require admin image build")
    require("backend image build" in proofs, "CI Docker proof must require backend image build")
    require("backend worker command build" in proofs, "CI Docker proof must keep worker under backend command build")
    require(
        "no standalone manager or worker release image requirement" in proofs,
        "CI Docker proof must reject standalone manager/worker release image requirement",
    )


def validate_release_scripts() -> None:
    for path in (RELEASE_METADATA_VALIDATOR, RELEASE_METADATA_PREFLIGHT):
        text = read_text(path)
        require('RELEASE_IMAGE_NAMES = {"backend", "web", "admin"}' in text, f"{display_path(path)} release image set mismatch")
        require(
            'FORBIDDEN_RELEASE_IMAGE_NAMES = {"manager", "worker", "crawler", "migrate"}' in text,
            f"{display_path(path)} forbidden release image set mismatch",
        )

    candidate = read_text(RELEASE_CANDIDATE_GENERATOR)
    require(
        "only backend, web, and admin are release images" in candidate,
        "release candidate metadata notes must state backend/web/admin release image scope",
    )
    require(
        "Worker/crawler/migrate are backend runtime commands" in candidate,
        "release candidate metadata notes must keep worker/crawler/migrate under backend runtime",
    )

    deploy = read_text(AZURE_DEPLOY)
    require("docker rm -f zenart-manager zenari-manager" in deploy, "Azure deploy must remove legacy manager containers")
    require('"backend", "worker", "crawler", "web", "admin"' in deploy, "Azure deploy must check expected compose services")
    require("legacy manager service is running" in deploy, "Azure deploy must fail if manager is running")
    require("must match backend image" in deploy, "Azure deploy must verify worker/crawler share backend image")


def validate_blueprint() -> None:
    text = read_text(BLUEPRINT)
    required_snippets = (
        "release image 闭集只能是 `web`、`admin`、`backend`",
        "不得新增 `manager`、`worker`、`crawler`、`migrate`",
        "worker/crawler/migrate 只能作为 backend runtime",
        "manager 不得成为 production deploy artifact",
    )
    for snippet in required_snippets:
        require(snippet in text, f"blueprint missing release image boundary snippet: {snippet}")


def validate_existing_ci_docker_evidence() -> None:
    if not CI_DOCKER_EVIDENCE.exists():
        return
    evidence = read_json(CI_DOCKER_EVIDENCE)
    image_set = set(evidence.get("image_set") or [])
    require(image_set == RELEASE_IMAGES, "CI Docker evidence image_set must be exactly backend/web/admin")
    images = evidence.get("images")
    require(isinstance(images, dict), "CI Docker evidence images must be an object")
    require(set(images) == RELEASE_IMAGES, "CI Docker evidence images keys must be exactly backend/web/admin")
    forbidden_text = json.dumps(evidence, sort_keys=True)
    for name in FORBIDDEN_RELEASE_IMAGES:
        patterns = (
            rf'"{re.escape(name)}"\s*:',
            rf'"image_set"\s*:\s*\[[^\]]*"{re.escape(name)}"',
            rf'"release_image_name"\s*:\s*"{re.escape(name)}"',
        )
        require(
            not any(re.search(pattern, forbidden_text) for pattern in patterns),
            f"CI Docker evidence promotes forbidden release image {name}",
        )


def main() -> int:
    try:
        validate_blueprint()
        validate_compose()
        validate_release_metadata_contract()
        validate_ci_exact_contract()
        validate_release_scripts()
        validate_existing_ci_docker_evidence()
    except ReleaseImageBoundaryError as exc:
        print(f"stage1 release image boundary validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 release image boundary validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
