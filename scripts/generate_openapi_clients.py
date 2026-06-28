#!/usr/bin/env python3
"""Generate minimal TypeScript API client scaffolds from openapi/zenart.v1.yaml."""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
TARGETS = {
    "web": ROOT / "web" / "lib" / "generated" / "zenart-api.ts",
    "admin": ROOT / "admin" / "lib" / "generated" / "zenart-api.ts",
}


@dataclass(frozen=True)
class Operation:
    method: str
    path: str
    operation_id: str
    rbac: str
    idempotency_required: bool
    error_envelope: bool


def parse_operations(text: str) -> list[Operation]:
    operations: list[Operation] = []
    in_paths = False
    current_path = ""
    current_method = ""
    current: dict[str, str] = {}
    current_lines: list[str] = []
    mutating = {"post", "put", "patch", "delete"}

    def flush() -> None:
        if not current_path or not current_method or "operationId" not in current:
            return
        error_envelope = (
            "default:" in "\n".join(current_lines)
            and '$ref: "#/components/responses/Error"' in "\n".join(current_lines)
        )
        operations.append(
            Operation(
                method=current_method.upper(),
                path=current_path,
                operation_id=current["operationId"],
                rbac=current.get("x-rbac", ""),
                idempotency_required=current.get("x-idempotency-required", "false") == "true",
                error_envelope=error_envelope,
            )
        )

    for line in text.splitlines():
        if line == "paths:":
            in_paths = True
            continue
        if line == "components:":
            flush()
            break
        if not in_paths:
            continue

        path_match = re.match(r"^  (/[^:]+):$", line)
        if path_match:
            flush()
            current_path = path_match.group(1)
            current_method = ""
            current = {}
            current_lines = []
            continue

        method_match = re.match(r"^    (get|post|put|patch|delete):$", line)
        if method_match:
            flush()
            current_method = method_match.group(1)
            current = {}
            current_lines = []
            continue

        if current_method:
            current_lines.append(line)

        field_match = re.match(r"^      (operationId|x-rbac|x-idempotency-required): (.+)$", line)
        if field_match and current_method:
            current[field_match.group(1)] = field_match.group(2).strip()

    if not operations:
        raise ValueError("no OpenAPI operations found")

    seen = set()
    for operation in operations:
        if operation.operation_id in seen:
            raise ValueError(f"duplicate operationId: {operation.operation_id}")
        seen.add(operation.operation_id)
        if operation.rbac not in {"user", "admin"}:
            raise ValueError(f"{operation.operation_id} missing x-rbac user/admin")
        if operation.method.lower() in mutating and operation.method != "GET" and operation.operation_id != "deleteSession":
            if not operation.idempotency_required:
                raise ValueError(f"{operation.operation_id} must declare x-idempotency-required")
        if not operation.error_envelope:
            raise ValueError(f"{operation.operation_id} must declare default ErrorEnvelope response")

    return operations


def operation_subset(audience: str, operations: list[Operation]) -> list[Operation]:
    if audience == "web":
        return [operation for operation in operations if operation.rbac == "user"]
    return operations


def render(audience: str, operations: list[Operation], digest: str) -> str:
    ops = operation_subset(audience, operations)
    union = " | ".join(f'"{operation.operation_id}"' for operation in ops)
    rows = ",\n".join(
        (
            f'  {operation.operation_id}: {{ method: "{operation.method}", '
            f'path: "{operation.path}", rbac: "{operation.rbac}", '
            f"idempotencyRequired: {str(operation.idempotency_required).lower()}, "
            f"errorEnvelope: {str(operation.error_envelope).lower()} }}"
        )
        for operation in ops
    )
    security_import = (
        'import { buildCsrfRequestHeaders, defaultSameSiteCsrfContract } from "../request-security";\n\n'
        if audience == "web"
        else ""
    )
    fetch_credentials = (
        "\n      credentials: defaultSameSiteCsrfContract.credentialMode,"
        if audience == "web"
        else ""
    )
    fetch_headers_line = (
        "headers: buildCsrfRequestHeaders(operation.method, headers),"
        if audience == "web"
        else "headers,"
    )
    constructor_body = (
        " {\n    this.assertSameSiteBaseUrl(baseUrl);\n  }"
        if audience == "web"
        else " {}"
    )
    path_param_guard = (
        '''      if (this.isUnsafePathParam(value)) {
        throw new Error(`Unsafe path parameter: ${key}`);
      }
'''
        if audience == "web"
        else ""
    )
    web_same_site_helpers = (
        '''

  private assertSameSiteBaseUrl(baseUrl: string) {
    if (baseUrl.startsWith("//")) {
      throw new Error("ZenariApiClient baseUrl must not be protocol-relative for same-site CSRF protection");
    }
    if (!baseUrl || baseUrl.startsWith("/")) {
      return;
    }

    const parsed = new URL(baseUrl);
    if (typeof window === "undefined") {
      throw new Error("ZenariApiClient absolute baseUrl requires a browser origin for same-site CSRF protection");
    }
    if (parsed.username || parsed.password) {
      throw new Error("ZenariApiClient baseUrl must not include credentials for same-site CSRF protection");
    }
    if (parsed.search || parsed.hash) {
      throw new Error("ZenariApiClient baseUrl must not include query or fragment material for same-site CSRF protection");
    }
    const currentOrigin = window.location.origin;
    if (parsed.origin !== currentOrigin) {
      throw new Error("ZenariApiClient baseUrl must be same-origin for same-site CSRF protection");
    }
  }

  private isUnsafePathParam(value: string) {
    return (
      value.includes("/") ||
      value.includes("\\\\") ||
      value === "." ||
      value === ".." ||
      value.startsWith(".") ||
      value.includes("..")
    );
  }'''
        if audience == "web"
        else ""
    )

    return f'''// Generated by scripts/generate_openapi_clients.py. Do not edit manually.
// OpenAPI source: openapi/zenart.v1.yaml
{security_import}\
export const OPENAPI_SHA256 = "{digest}";
export const API_AUDIENCE = "{audience}" as const;

export type FieldError = {{
  field: string;
  message: string;
  code?: string;
}};

export type ErrorEnvelope = {{
  code: string;
  message: string;
  request_id: string;
  taxonomy: {{
    category:
      | "validation"
      | "auth"
      | "forbidden"
      | "not_found"
      | "conflict"
      | "retryable"
      | "blocked"
      | "quota_insufficient"
      | "provider_unavailable"
      | "review_required"
      | "internal";
    retryable: boolean;
    blocked: boolean;
    user_actionable: boolean;
  }};
  retryable: boolean;
  blocked: boolean;
  details: Record<string, unknown>;
  field_errors: FieldError[];
}};

export type PageInfo = {{
  next_page_token: string;
  total_count: number;
}};

export type TaskStatus = {{
  id: string;
  tenant_id: string;
  type: string;
  schema_version: number;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  retry_count: number;
  timeout_at: string | null;
  error?: {{
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }};
  user_message: string;
  app_version: string;
  worker_version: string;
  created_at: string;
  updated_at: string;
}};

export type OperationId = {union};

export type ApiOperation = {{
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  rbac: "user" | "admin";
  idempotencyRequired: boolean;
  errorEnvelope: true;
}};

export const apiOperations: Record<OperationId, ApiOperation> = {{
{rows}
}};

export type RequestOptions = {{
  pathParams?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}};

export class ApiError extends Error {{
  readonly envelope: ErrorEnvelope;

  constructor(envelope: ErrorEnvelope) {{
    super(envelope.message);
    this.name = "ApiError";
    this.envelope = envelope;
  }}
}}

export class ZenariApiClient {{
  constructor(
    private readonly baseUrl = "",
    private readonly defaultHeaders: Record<string, string> = {{}}
  ){constructor_body}

  async request<TResponse>(operationId: OperationId, options: RequestOptions = {{}}): Promise<TResponse> {{
    const operation = apiOperations[operationId];
    const headers: Record<string, string> = {{
      ...this.defaultHeaders,
      ...options.headers
    }};

    if (operation.idempotencyRequired) {{
      if (!options.idempotencyKey) {{
        throw new Error(`Idempotency-Key is required for ${{operationId}}`);
      }}
      headers["Idempotency-Key"] = options.idempotencyKey;
    }}

    const interpolatedPath = this.interpolate(operation.path, options.pathParams);
    const pathForUrl = this.baseUrl.startsWith("/")
      ? `${{this.baseUrl.replace(/\\/$/, "")}}${{interpolatedPath}}`
      : interpolatedPath;
    const url = new URL(pathForUrl, this.baseUrl.startsWith("http") ? this.baseUrl : "http://localhost");
    for (const [key, value] of Object.entries(options.query ?? {{}})) {{
      if (value !== undefined) {{
        url.searchParams.set(key, String(value));
      }}
    }}

    if (options.body !== undefined) {{
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }}

    const response = await fetch(
      this.baseUrl.startsWith("http") ? url.toString() : `${{url.pathname}}${{url.search}}`,
      {{
      method: operation.method,{fetch_credentials}
      {fetch_headers_line}
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
      }}
    );

    if (!response.ok) {{
      throw new ApiError((await response.json()) as ErrorEnvelope);
    }}
    if (response.status === 204) {{
      return undefined as TResponse;
    }}
    return (await response.json()) as TResponse;
  }}

  private interpolate(path: string, params: Record<string, string> = {{}}): string {{
    return path.replace(/\\{{([^}}]+)\\}}/g, (_match, key: string) => {{
      const value = params[key];
      if (!value) {{
        throw new Error(`Missing path parameter: ${{key}}`);
      }}
{path_param_guard}\
      return encodeURIComponent(value);
    }});
  }}{web_same_site_helpers}
}}
'''


def generate(check: bool) -> int:
    text = OPENAPI.read_text(encoding="utf-8")
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    operations = parse_operations(text)

    changed: list[Path] = []
    for audience, target in TARGETS.items():
        content = render(audience, operations, digest)
        if check:
            if not target.exists() or target.read_text(encoding="utf-8") != content:
                changed.append(target)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")

    if changed:
        for target in changed:
            print(f"stale generated client: {target.relative_to(ROOT)}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated files are stale")
    args = parser.parse_args()
    try:
        return generate(args.check)
    except Exception as exc:
        print(f"OpenAPI client generation failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
