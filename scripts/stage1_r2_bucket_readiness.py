#!/usr/bin/env python3
"""Provision/verify the Stage 1 Cloudflare R2 bucket without persisting secrets.

This is a non-clearing readiness probe. A passing report proves that the
configured `zenari` bucket can accept, read, list, and delete an object, but it
does not clear the stricter staging object-retention runtime gate.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import ipaddress
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "r2_bucket_readiness" / "local_contract.json"
DEFAULT_ENV_FILE = ROOT / ".env"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-r2-bucket-readiness.preflight.json"
EXPECTED_BUCKET = "zenari"

SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "authorization_header_persisted",
    "raw_response_body_persisted",
    "raw_endpoint_persisted",
    "access_key_persisted",
    "secret_key_persisted",
)

SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "secret_key",
    "access_key",
    "access_key_id",
    "secret_access_key",
    "api_key",
    "token",
    "api_token",
    "cloudflare_api_token",
    "object_storage_access_key",
    "object_storage_secret_key",
    "raw_response",
    "raw_response_body",
    "endpoint",
    "object_storage_endpoint",
}

RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"AWS4-HMAC-SHA256\s+Credential=|"
    r"X-Amz-Signature|"
    r"X-Amz-Credential|"
    r"X-Amz-Security-Token|"
    r"OBJECT_STORAGE_(?:ACCESS|SECRET)_KEY\s*=|"
    r"CLOUDFLARE_API_TOKEN\s*=)"
)

SIGNED_URL_PARAM_RE = re.compile(
    r"(?i)([?&])(?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|AWSAccessKeyId|GoogleAccessId|Signature)="
    r"[^&\s]+"
)

SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)\b("
    r"authorization|credential|signature|token|api[_-]?key|access[_-]?key|access[_-]?key[_-]?id|"
    r"secret|secret[_-]?key|secret[_-]?access[_-]?key|aws[_-]?secret[_-]?access[_-]?key|"
    r"object[_-]?storage[_-]?(?:access|secret)[_-]?key|r2[_-]?(?:access|secret)[_-]?key"
    r")\s*[:=]\s*(\"[^\"]{4,}\"|'[^']{4,}'|[^\s,;]{4,})"
)


class R2ReadinessError(Exception):
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
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        raise R2ReadinessError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise R2ReadinessError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise R2ReadinessError(f"{path}.{key} exposes secret/raw endpoint field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise R2ReadinessError(f"{path} contains secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "r2_readiness")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key:
            values[key] = value
    return values


def env_lookup(dotenv: dict[str, str], *names: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
        value = dotenv.get(name)
        if value:
            return value
    return ""


def has_value(value: str) -> bool:
    normalized = value.strip()
    if not normalized:
        return False
    lowered = normalized.lower()
    return not any(token in lowered for token in ("replace_me", "placeholder", "example.test"))


def bool_value(value: str, default: bool = False) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def host_suffix(hostname: str) -> str:
    normalized = hostname.strip().lower()
    if normalized.endswith(".r2.cloudflarestorage.com"):
        return "r2.cloudflarestorage.com"
    parts = normalized.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else normalized


def is_public_host(hostname: str) -> bool:
    normalized = hostname.strip().lower().strip("[]")
    if not normalized or normalized in {"localhost", "0.0.0.0"}:
        return False
    if normalized.endswith((".local", ".localhost", ".test", ".example", ".example.test", ".invalid")):
        return False
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return True
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified)


def parse_endpoint(raw: str) -> urllib.parse.ParseResult | None:
    value = raw.strip()
    if not value:
        return None
    if "://" not in value:
        value = "https://" + value
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return None
    return parsed


def derived_account_id(endpoint: urllib.parse.ParseResult | None) -> str:
    if endpoint is None or not endpoint.hostname:
        return ""
    host = endpoint.hostname.lower()
    suffix = ".r2.cloudflarestorage.com"
    if not host.endswith(suffix):
        return ""
    account_id = host[: -len(suffix)]
    if re.fullmatch(r"[0-9a-f]{32}", account_id):
        return account_id
    return ""


def sanitize_text(value: str, limit: int = 180) -> str:
    cleaned = value.replace("\r", " ").replace("\n", " ")
    cleaned = SIGNED_URL_PARAM_RE.sub(r"\1signature=[redacted]", cleaned)
    cleaned = RAW_SECRET_RE.sub("[redacted]", cleaned)
    cleaned = SECRET_ASSIGNMENT_RE.sub(lambda match: f"{match.group(1)}=[redacted]", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) > limit:
        return cleaned[: limit - 3] + "..."
    return cleaned


def safe_token(value: str, limit: int = 96) -> str:
    cleaned = sanitize_text(value, limit=limit)
    if not cleaned or "[redacted]" in cleaned:
        return ""
    cleaned = re.sub(r"[^A-Za-z0-9_.-]", "_", cleaned).strip("._-")
    return cleaned[:limit]


def header_lookup(headers: dict[str, str], *names: str) -> str:
    lowered = {key.lower(): value for key, value in headers.items()}
    for name in names:
        value = lowered.get(name.lower(), "")
        if value:
            return value
    return ""


def body_sha256_short(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()[:16]


def safe_http_error_detail(body: bytes, headers: dict[str, str], parsed_detail: dict[str, Any] | None = None) -> dict[str, Any]:
    detail: dict[str, Any] = {"body_sha256": body_sha256_short(body)}
    request_id = safe_token(
        header_lookup(headers, "x-amz-request-id", "x-amz-requestid", "x-amz-request-id", "cf-request-id")
    )
    cf_ray = safe_token(header_lookup(headers, "cf-ray"))
    host_id = safe_token(header_lookup(headers, "x-amz-id-2"))
    if request_id:
        detail["request_id"] = request_id
    if cf_ray:
        detail["cf_ray"] = cf_ray
    if host_id:
        detail["host_id"] = host_id
    if parsed_detail:
        detail.update(parsed_detail)
    return detail


def summarize_json_error(body: bytes) -> dict[str, Any]:
    if not body:
        return {}
    try:
        payload = json.loads(body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return {"message": sanitize_text(body.decode("utf-8", errors="replace"))}
    errors = payload.get("errors") if isinstance(payload, dict) else None
    if not isinstance(errors, list):
        return {}
    safe_errors: list[dict[str, Any]] = []
    for item in errors[:3]:
        if not isinstance(item, dict):
            continue
        safe_errors.append(
            {
                "code": safe_token(str(item.get("code", ""))),
                "message": sanitize_text(str(item.get("message", ""))),
            }
        )
    return {"errors": safe_errors} if safe_errors else {}


def summarize_xml_error(body: bytes) -> dict[str, str]:
    if not body:
        return {}
    try:
        root = ET.fromstring(body.decode("utf-8", errors="replace"))
    except ET.ParseError:
        return {"message": sanitize_text(body.decode("utf-8", errors="replace"))}

    def find_text(name: str) -> str:
        for child in root.iter():
            if child.tag.split("}", 1)[-1] == name and child.text:
                return sanitize_text(child.text)
        return ""

    result: dict[str, str] = {}
    code = find_text("Code")
    message = find_text("Message")
    request_id = find_text("RequestId") or find_text("RequestID")
    if code:
        result["code"] = safe_token(code)
    if message:
        result["message"] = message
    if request_id:
        result["body_request_id"] = safe_token(request_id)
    return result


def http_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: int = 20,
) -> tuple[int, bytes, dict[str, str]]:
    request = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read(1 << 20), dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(1 << 20), dict(exc.headers.items())


def probe(
    check_id: str,
    status: str,
    *,
    http_status: int | None = None,
    reason: str,
    detail: dict[str, Any] | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "check_id": check_id,
        "status": status,
        "reason": reason,
        "secret_material_persisted": False,
        "authorization_header_persisted": False,
        "raw_response_body_persisted": False,
    }
    if http_status is not None:
        row["http_status"] = http_status
    if detail:
        row["detail"] = detail
    return row


def probe_blocker_summary(row: dict[str, Any]) -> str:
    parts = [f"{row['check_id']}: {row['status']} - {row['reason']}"]
    http_status = row.get("http_status")
    if isinstance(http_status, int):
        parts.append(f"http_status={http_status}")
    detail = row.get("detail")
    if isinstance(detail, dict):
        for field in ("code", "message", "request_id", "cf_ray", "host_id", "exception_type"):
            value = detail.get(field)
            if isinstance(value, str) and value.strip():
                parts.append(f"{field}={sanitize_text(value, limit=120)}")
    return "; ".join(parts)


def cf_token_verify(dotenv: dict[str, str], timeout: int) -> dict[str, Any]:
    token = env_lookup(dotenv, "CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "CLOUDFLARE_R2_API_TOKEN", "R2_API_TOKEN")
    if not has_value(token):
        return probe("cloudflare_token_verify", "missing", reason="no Cloudflare API token configured")
    status, body, response_headers = http_request(
        "GET",
        "https://api.cloudflare.com/client/v4/user/tokens/verify",
        headers={"Authorization": f"Bearer {token}"},
        timeout=timeout,
    )
    detail = safe_http_error_detail(body, response_headers, summarize_json_error(body))
    if status == 200:
        try:
            payload = json.loads(body.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict) and payload.get("success") is True:
            return probe("cloudflare_token_verify", "pass", http_status=status, reason="token verified by Cloudflare API")
    return probe("cloudflare_token_verify", "blocked", http_status=status, reason="Cloudflare API token did not verify", detail=detail)


def cf_create_bucket(dotenv: dict[str, str], endpoint: urllib.parse.ParseResult | None, bucket: str, timeout: int) -> dict[str, Any]:
    token = env_lookup(dotenv, "CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "CLOUDFLARE_R2_API_TOKEN", "R2_API_TOKEN")
    account_id = env_lookup(dotenv, "CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID", "R2_ACCOUNT_ID") or derived_account_id(endpoint)
    if not has_value(token):
        return probe("cloudflare_create_bucket", "missing", reason="no Cloudflare API token configured")
    if not has_value(account_id):
        return probe("cloudflare_create_bucket", "missing", reason="no Cloudflare account id configured or derivable from R2 endpoint")
    body = json.dumps({"name": bucket}, sort_keys=True).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    jurisdiction = env_lookup(dotenv, "R2_BUCKET_CREATE_JURISDICTION", "CLOUDFLARE_R2_JURISDICTION")
    if jurisdiction:
        headers["cf-r2-jurisdiction"] = jurisdiction
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets"
    status, response_body, response_headers = http_request("POST", url, headers=headers, data=body, timeout=timeout)
    detail = safe_http_error_detail(response_body, response_headers, summarize_json_error(response_body))
    if 200 <= status <= 299:
        try:
            payload = json.loads(response_body.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            payload = {}
        if isinstance(payload, dict) and payload.get("success") is True:
            return probe("cloudflare_create_bucket", "pass", http_status=status, reason="bucket create API succeeded")
    serialized_detail = json.dumps(detail, sort_keys=True).lower()
    if status in {400, 409} and "already" in serialized_detail and "exist" in serialized_detail:
        return probe("cloudflare_create_bucket", "pass", http_status=status, reason="bucket already exists")
    return probe("cloudflare_create_bucket", "blocked", http_status=status, reason="bucket create API did not succeed", detail=detail)


def quote_path(path: str) -> str:
    return urllib.parse.quote(path, safe="/~")


def canonical_query(query: str) -> str:
    pairs = urllib.parse.parse_qsl(query, keep_blank_values=True)
    encoded = [
        (
            urllib.parse.quote(key, safe="-_.~"),
            urllib.parse.quote(value, safe="-_.~"),
        )
        for key, value in pairs
    ]
    encoded.sort()
    return "&".join(f"{key}={value}" for key, value in encoded)


def s3_url(endpoint: urllib.parse.ParseResult, bucket: str, key: str = "", query: dict[str, str] | None = None, *, force_path_style: bool) -> str:
    scheme = endpoint.scheme
    host = endpoint.netloc
    base_path = endpoint.path.rstrip("/")
    if force_path_style:
        path = f"{base_path}/{bucket}"
    else:
        host = f"{bucket}.{host}"
        path = base_path or "/"
    if key:
        path = f"{path.rstrip('/')}/{quote_path(key)}"
    elif not path:
        path = "/"
    encoded_query = urllib.parse.urlencode(query or {}, quote_via=urllib.parse.quote)
    return urllib.parse.urlunparse((scheme, host, path, "", encoded_query, ""))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def signing_key(secret_key: str, date_stamp: str, region: str) -> bytes:
    date_key = hmac.new(("AWS4" + secret_key).encode("utf-8"), date_stamp.encode("utf-8"), hashlib.sha256).digest()
    region_key = hmac.new(date_key, region.encode("utf-8"), hashlib.sha256).digest()
    service_key = hmac.new(region_key, b"s3", hashlib.sha256).digest()
    return hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()


def sign_s3_headers(
    *,
    method: str,
    url: str,
    region: str,
    access_key: str,
    secret_key: str,
    payload: bytes,
    headers: dict[str, str] | None = None,
) -> dict[str, str]:
    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    parsed = urllib.parse.urlparse(url)
    payload_hash = sha256_hex(payload)
    signed_headers = {k.lower(): " ".join(v.split()) for k, v in (headers or {}).items()}
    signed_headers["host"] = parsed.netloc
    signed_headers["x-amz-content-sha256"] = payload_hash
    signed_headers["x-amz-date"] = amz_date
    signed_header_names = sorted(signed_headers)
    canonical_headers = "".join(f"{name}:{signed_headers[name]}\n" for name in signed_header_names)
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    canonical_request = "\n".join(
        [
            method,
            quote_path(parsed.path or "/"),
            canonical_query(parsed.query),
            canonical_headers,
            ";".join(signed_header_names),
            payload_hash,
        ]
    )
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            sha256_hex(canonical_request.encode("utf-8")),
        ]
    )
    signature = hmac.new(signing_key(secret_key, date_stamp, region), string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    output = {name: value for name, value in (headers or {}).items()}
    output["Host"] = parsed.netloc
    output["X-Amz-Content-Sha256"] = payload_hash
    output["X-Amz-Date"] = amz_date
    output["Authorization"] = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={';'.join(signed_header_names)}, "
        f"Signature={signature}"
    )
    return output


def s3_request(
    *,
    method: str,
    url: str,
    region: str,
    access_key: str,
    secret_key: str,
    payload: bytes = b"",
    headers: dict[str, str] | None = None,
    timeout: int,
) -> tuple[int, bytes, dict[str, str]]:
    signed = sign_s3_headers(
        method=method,
        url=url,
        region=region,
        access_key=access_key,
        secret_key=secret_key,
        payload=payload,
        headers=headers,
    )
    return http_request(method, url, headers=signed, data=payload if method in {"PUT", "POST"} else None, timeout=timeout)


def s3_probe(
    check_id: str,
    method: str,
    url: str,
    *,
    region: str,
    access_key: str,
    secret_key: str,
    payload: bytes = b"",
    headers: dict[str, str] | None = None,
    timeout: int,
    accepted: set[int],
    pass_reason: str,
) -> tuple[dict[str, Any], bytes]:
    try:
        status, body, response_headers = s3_request(
            method=method,
            url=url,
            region=region,
            access_key=access_key,
            secret_key=secret_key,
            payload=payload,
            headers=headers,
            timeout=timeout,
    )
    except Exception as exc:  # noqa: BLE001 - summarized without secrets.
        detail = {"exception_type": sanitize_text(type(exc).__name__, limit=80)}
        return probe(check_id, "blocked", reason="S3 request failed before HTTP response", detail=detail), b""
    if status in accepted:
        detail: dict[str, Any] = {}
        request_id = header_lookup(response_headers, "cf-ray", "x-amz-request-id", "x-amz-requestid")
        if safe_token(request_id):
            detail["provider_request_id_present"] = True
        return probe(check_id, "pass", http_status=status, reason=pass_reason, detail=detail or None), body
    return (
        probe(
            check_id,
            "blocked",
            http_status=status,
            reason="S3 request did not return an accepted status",
            detail=safe_http_error_detail(body, response_headers, summarize_xml_error(body)),
        ),
        body,
    )


def list_contains_key(body: bytes, expected_key: str) -> bool:
    try:
        root = ET.fromstring(body.decode("utf-8", errors="replace"))
    except ET.ParseError:
        return False
    for child in root.iter():
        if child.tag.split("}", 1)[-1] == "Key" and child.text == expected_key:
            return True
    return False


def validate_contract_anchors() -> None:
    contract = load_json(CONTRACT)
    if contract.get("schema_version") != "stage1.r2_bucket_readiness.contract.v1":
        raise R2ReadinessError("contract schema_version mismatch")
    if contract.get("canonical_preflight_path") != "ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json":
        raise R2ReadinessError("contract canonical_preflight_path mismatch")
    if contract.get("expected_bucket") != EXPECTED_BUCKET:
        raise R2ReadinessError("contract expected_bucket mismatch")


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    dotenv = parse_env_file(repo_path(args.env_file))
    provider = env_lookup(dotenv, "OBJECT_STORAGE_PROVIDER")
    endpoint_raw = env_lookup(dotenv, "OBJECT_STORAGE_ENDPOINT")
    region = env_lookup(dotenv, "OBJECT_STORAGE_REGION") or "auto"
    bucket = args.bucket or env_lookup(dotenv, "OBJECT_STORAGE_BUCKET") or EXPECTED_BUCKET
    access_key = env_lookup(dotenv, "OBJECT_STORAGE_ACCESS_KEY", "R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
    secret_key = env_lookup(dotenv, "OBJECT_STORAGE_SECRET_KEY", "R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
    force_path_style = bool_value(env_lookup(dotenv, "OBJECT_STORAGE_FORCE_PATH_STYLE"), True)
    endpoint = parse_endpoint(endpoint_raw)
    endpoint_https = endpoint is not None and endpoint.scheme == "https"
    endpoint_public = endpoint is not None and bool(endpoint.hostname) and is_public_host(endpoint.hostname or "")
    config = {
        "provider_s3_compatible": provider.strip() == "s3-compatible",
        "endpoint_present": has_value(endpoint_raw),
        "endpoint_https": endpoint_https,
        "endpoint_public": endpoint_public,
        "endpoint_host_suffix": host_suffix(endpoint.hostname or "") if endpoint else "missing",
        "bucket_zenari": bucket == EXPECTED_BUCKET,
        "region_present": has_value(region),
        "region_auto": region == "auto",
        "access_key_present": has_value(access_key),
        "secret_key_present": has_value(secret_key),
        "force_path_style": force_path_style,
        "cloudflare_api_token_present": has_value(
            env_lookup(dotenv, "CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "CLOUDFLARE_R2_API_TOKEN", "R2_API_TOKEN")
        ),
        "cloudflare_account_id_present_or_derivable": has_value(
            env_lookup(dotenv, "CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID", "R2_ACCOUNT_ID") or derived_account_id(endpoint)
        ),
    }
    probes: list[dict[str, Any]] = [cf_token_verify(dotenv, args.timeout_seconds)]
    if args.create_bucket:
        probes.append(cf_create_bucket(dotenv, endpoint, bucket, args.timeout_seconds))
    else:
        probes.append(probe("cloudflare_create_bucket", "skipped", reason="--create-bucket was not requested"))

    required_config_ready = (
        config["provider_s3_compatible"]
        and config["endpoint_present"]
        and config["endpoint_https"]
        and config["endpoint_public"]
        and config["bucket_zenari"]
        and config["region_present"]
        and config["access_key_present"]
        and config["secret_key_present"]
    )
    test_key = f"stage1-readiness/{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{os.getpid()}.txt"
    content = f"zenari-r2-readiness:{test_key}\n".encode("utf-8")
    if required_config_ready and endpoint is not None:
        bucket_url = s3_url(endpoint, bucket, force_path_style=force_path_style)
        head_probe, _ = s3_probe(
            "s3_head_bucket",
            "HEAD",
            bucket_url,
            region=region,
            access_key=access_key,
            secret_key=secret_key,
            timeout=args.timeout_seconds,
            accepted={200, 204},
            pass_reason="bucket head succeeded",
        )
        probes.append(head_probe)
        object_url = s3_url(endpoint, bucket, test_key, force_path_style=force_path_style)
        put_probe, _ = s3_probe(
            "s3_put_object",
            "PUT",
            object_url,
            region=region,
            access_key=access_key,
            secret_key=secret_key,
            payload=content,
            headers={"Content-Type": "text/plain; charset=utf-8", "X-Amz-Meta-Zenari-Readiness": "stage1"},
            timeout=args.timeout_seconds,
            accepted={200, 201, 204},
            pass_reason="test object put succeeded",
        )
        probes.append(put_probe)
        if put_probe["status"] == "pass":
            get_probe, get_body = s3_probe(
                "s3_get_object",
                "GET",
                object_url,
                region=region,
                access_key=access_key,
                secret_key=secret_key,
                timeout=args.timeout_seconds,
                accepted={200},
                pass_reason="test object get succeeded",
            )
            if get_probe["status"] == "pass" and hashlib.sha256(get_body).hexdigest() != hashlib.sha256(content).hexdigest():
                get_probe = probe("s3_get_object", "blocked", http_status=get_probe.get("http_status"), reason="test object checksum mismatch")
            probes.append(get_probe)
            list_url = s3_url(
                endpoint,
                bucket,
                query={"list-type": "2", "prefix": "stage1-readiness/"},
                force_path_style=force_path_style,
            )
            list_probe, list_body = s3_probe(
                "s3_list_prefix",
                "GET",
                list_url,
                region=region,
                access_key=access_key,
                secret_key=secret_key,
                timeout=args.timeout_seconds,
                accepted={200},
                pass_reason="test prefix list succeeded",
            )
            if list_probe["status"] == "pass" and not list_contains_key(list_body, test_key):
                list_probe = probe("s3_list_prefix", "blocked", http_status=list_probe.get("http_status"), reason="test object was not visible in list response")
            probes.append(list_probe)
            delete_probe, _ = s3_probe(
                "s3_delete_object",
                "DELETE",
                object_url,
                region=region,
                access_key=access_key,
                secret_key=secret_key,
                timeout=args.timeout_seconds,
                accepted={200, 202, 204},
                pass_reason="test object delete succeeded",
            )
            probes.append(delete_probe)
            confirm_probe, _ = s3_probe(
                "s3_confirm_deleted",
                "GET",
                object_url,
                region=region,
                access_key=access_key,
                secret_key=secret_key,
                timeout=args.timeout_seconds,
                accepted={404},
                pass_reason="deleted test object is no longer readable",
            )
            probes.append(confirm_probe)
        else:
            for check_id in ("s3_get_object", "s3_list_prefix", "s3_delete_object", "s3_confirm_deleted"):
                probes.append(probe(check_id, "skipped", reason="dependent on successful s3_put_object"))
    else:
        missing = [name for name, ready in config.items() if name in {
            "provider_s3_compatible",
            "endpoint_present",
            "endpoint_https",
            "endpoint_public",
            "bucket_zenari",
            "region_present",
            "access_key_present",
            "secret_key_present",
        } and not ready]
        for check_id in ("s3_head_bucket", "s3_put_object", "s3_get_object", "s3_list_prefix", "s3_delete_object", "s3_confirm_deleted"):
            probes.append(probe(check_id, "missing", reason="R2 S3 config is incomplete or invalid", detail={"missing_config": missing}))

    required_probe_ids = {"s3_head_bucket", "s3_put_object", "s3_get_object", "s3_list_prefix", "s3_delete_object", "s3_confirm_deleted"}
    by_id = {str(item["check_id"]): item for item in probes}
    required_pass = all(by_id.get(check_id, {}).get("status") == "pass" for check_id in required_probe_ids)
    missing_config = not required_config_ready
    status = "ready" if required_pass else ("missing" if missing_config else "blocked")
    blockers = [probe_blocker_summary(item) for item in probes if item["check_id"] in required_probe_ids and item["status"] != "pass"]
    if bucket != EXPECTED_BUCKET:
        blockers.append("OBJECT_STORAGE_BUCKET must be zenari")

    report: dict[str, Any] = {
        "schema_version": "stage1.r2_bucket_readiness.preflight.v1",
        "kind": "stage1_r2_bucket_readiness_preflight",
        "environment": "release",
        "status": status,
        "release_gate_decision": "no_go",
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "expected_bucket": EXPECTED_BUCKET,
        "config_summary": config,
        "probes": probes,
        "readiness": {
            "r2_bucket_access_ready": required_pass,
            "bucket_created_by_this_run": by_id.get("cloudflare_create_bucket", {}).get("status") == "pass"
            and by_id.get("cloudflare_create_bucket", {}).get("reason") == "bucket create API succeeded",
            "bucket_existing_verified": required_pass,
            "object_roundtrip_ready": by_id.get("s3_put_object", {}).get("status") == "pass"
            and by_id.get("s3_get_object", {}).get("status") == "pass",
            "list_ready": by_id.get("s3_list_prefix", {}).get("status") == "pass",
            "delete_ready": by_id.get("s3_delete_object", {}).get("status") == "pass"
            and by_id.get("s3_confirm_deleted", {}).get("status") == "pass",
            "test_key_sha256": hashlib.sha256(test_key.encode("utf-8")).hexdigest(),
        },
        "blockers": blockers,
        "canonical_pass_path": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_object_retention_cleanup": False,
        "can_close_do_not_launch": False,
        "strict_followup_required": [
            "WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE=1 scripts/staging_object_storage_retention_cleanup_smoke.sh",
            "python3 scripts/validate_stage1_staging_object_retention_evidence.py",
            "python3 scripts/validate_stage1_staging_runtime.py",
        ],
        "operator_ask": (
            "Provide a Cloudflare API token with Workers R2 Storage Write plus account id, or pre-create bucket zenari "
            "and provide S3 keys scoped to that bucket with list/read/write/delete access."
            if status != "ready"
            else "No R2 bucket credential input needed; run strict staging object retention probes with deployed admin access."
        ),
        "safe_projection_policy": {field: False for field in SAFE_FALSE_FIELDS},
    }
    for field in SAFE_FALSE_FIELDS:
        report[field] = False
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify Stage 1 R2 bucket readiness")
    parser.add_argument("--contract-only", action="store_true", help="validate local contract anchors only")
    parser.add_argument("--create-bucket", action="store_true", help="attempt Cloudflare REST API bucket creation before S3 checks")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--bucket", default="")
    parser.add_argument("--timeout-seconds", type=int, default=20)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract_anchors()
        if args.contract_only:
            print("stage1 R2 bucket readiness contract passed")
            return 0
        report = build_report(args)
        write_json(repo_path(args.output), report)
    except R2ReadinessError as exc:
        print(f"stage1 R2 bucket readiness failed: {exc}", file=sys.stderr)
        return 1
    print(f"wrote Stage 1 R2 bucket readiness preflight to {display_path(repo_path(args.output))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
