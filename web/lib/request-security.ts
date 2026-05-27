import { GeneratedApiCsrfRequestContractEvidence, SessionContract, SessionSecurityContractEvidence } from "./contracts";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export const csrfProtectedMethods: Array<Exclude<HttpMethod, "GET" | "HEAD" | "OPTIONS">> = ["POST", "PUT", "PATCH", "DELETE"];

export const defaultSameSiteCsrfContract: SessionContract["csrf"] = {
  strategy: "same-site-origin-check",
  headerName: "X-ZenArt-CSRF",
  headerValue: "same-site-origin-check",
  sameSiteRequired: "lax-or-strict",
  credentialMode: "include",
  originPolicy: "same-site-only",
  protectedMethods: csrfProtectedMethods
};

export const isCsrfProtectedMethod = (method: HttpMethod) =>
  csrfProtectedMethods.includes(method as Exclude<HttpMethod, "GET" | "HEAD" | "OPTIONS">);

const meetsSameSiteRequirement = (
  sameSite: SessionContract["cookie"]["sameSite"],
  requirement: SessionContract["csrf"]["sameSiteRequired"]
) => requirement === "lax-or-strict" && (sameSite === "lax" || sameSite === "strict");

const sameSiteAcceptanceValues: SessionContract["cookie"]["sameSite"][] = ["lax", "strict", "none"];

const buildSameSiteAcceptanceMatrix = (requirement: SessionContract["csrf"]["sameSiteRequired"]) =>
  sameSiteAcceptanceValues.map((sameSite) => {
    const accepted = meetsSameSiteRequirement(sameSite, requirement);
    return {
      sameSite,
      status: accepted ? "pass" : "fail",
      failureReason: accepted ? "" : "cookie-same-site"
    } as const;
  });

export const serializeSetCookieContract = (cookie: SessionContract["cookie"]) =>
  [
    cookie.name,
    cookie.httpOnly ? "HttpOnly" : "client-readable",
    cookie.secure ? "Secure" : "insecure",
    `SameSite=${cookie.sameSite}`,
    `Path=${cookie.path}`,
    cookie.domain ? `Domain=${cookie.domain}` : "HostOnly"
  ].join(";");

export const buildCsrfRequestHeaders = (
  method: HttpMethod,
  headers: Record<string, string> = {},
  contract = defaultSameSiteCsrfContract
) => {
  if (!isCsrfProtectedMethod(method)) {
    return headers;
  }

  return {
    ...headers,
    [contract.headerName]: headers[contract.headerName] ?? contract.headerValue
  };
};

export const buildSessionSecurityContractEvidence = (
  sessionContract: SessionContract,
  operations: Record<string, { method: HttpMethod }>
): SessionSecurityContractEvidence => {
  const protectedOperationIds = Object.entries(operations)
    .filter(([, operation]) => isCsrfProtectedMethod(operation.method))
    .map(([operationId]) => operationId);
  const missingCsrfOperationIds = Object.entries(operations)
    .filter(([, operation]) => isCsrfProtectedMethod(operation.method))
    .filter(([, operation]) => !sessionContract.csrf.protectedMethods.includes(operation.method as SessionContract["csrf"]["protectedMethods"][number]))
    .map(([operationId]) => operationId);
  const cookieFailureReasons = [
    sessionContract.cookie.name.startsWith("__Host-") ? "" : "cookie-prefix",
    sessionContract.cookie.httpOnly ? "" : "cookie-http-only",
    sessionContract.cookie.secure ? "" : "cookie-secure",
    meetsSameSiteRequirement(sessionContract.cookie.sameSite, sessionContract.csrf.sameSiteRequired) ? "" : "cookie-same-site",
    sessionContract.cookie.path === "/" ? "" : "cookie-path",
    sessionContract.cookie.domain ? "cookie-domain" : ""
  ].filter(Boolean);
  const csrfFailureReasons = [
    sessionContract.csrf.strategy === "same-site-origin-check" ? "" : "csrf-strategy",
    sessionContract.csrf.headerName === "X-ZenArt-CSRF" ? "" : "csrf-header",
    sessionContract.csrf.credentialMode === "include" ? "" : "csrf-credentials",
    sessionContract.csrf.originPolicy === "same-site-only" ? "" : "csrf-origin-policy",
    sessionContract.csrf.sameSiteRequired === "lax-or-strict" ? "" : "csrf-same-site-requirement",
    missingCsrfOperationIds.length === 0 ? "" : "csrf-operation-coverage",
    protectedOperationIds.length > 0 ? "" : "csrf-operation-inventory"
  ].filter(Boolean);
  const cookiePass = cookieFailureReasons.length === 0;
  const csrfPass = csrfFailureReasons.length === 0;
  const sameSiteAcceptanceMatrix = buildSameSiteAcceptanceMatrix(sessionContract.csrf.sameSiteRequired);

  return {
    schema_version: "stage0.rev2.session-csrf-client-evidence",
    status: cookiePass && csrfPass ? "pass" : "fail",
    cookieName: sessionContract.cookie.name,
    cookieAttributes: {
      httpOnly: sessionContract.cookie.httpOnly,
      secure: sessionContract.cookie.secure,
      sameSite: sessionContract.cookie.sameSite,
      path: sessionContract.cookie.path,
      domain: sessionContract.cookie.domain ?? "",
      hostOnly: !sessionContract.cookie.domain
    },
    setCookieContract: serializeSetCookieContract(sessionContract.cookie),
    acceptedSameSiteValues: sameSiteAcceptanceMatrix
      .filter((entry) => entry.status === "pass")
      .map((entry) => entry.sameSite as "lax" | "strict"),
    rejectedSameSiteValues: sameSiteAcceptanceMatrix
      .filter((entry) => entry.status === "fail")
      .map((entry) => entry.sameSite as "none"),
    sameSiteAcceptanceMatrix,
    sameSiteRequirement: sessionContract.csrf.sameSiteRequired,
    csrfStrategy: sessionContract.csrf.strategy,
    csrfHeaderName: sessionContract.csrf.headerName,
    credentialMode: sessionContract.csrf.credentialMode,
    originPolicy: sessionContract.csrf.originPolicy,
    protectedMethods: sessionContract.csrf.protectedMethods,
    protectedOperationIds,
    missingCsrfOperationIds,
    cookieFailureReasons,
    csrfFailureReasons
  };
};

export const buildGeneratedApiCsrfRequestContractEvidence = (
  operations: Record<string, { method: HttpMethod; path: string; idempotencyRequired: boolean }>,
  contract = defaultSameSiteCsrfContract
): GeneratedApiCsrfRequestContractEvidence => {
  const entries = Object.entries(operations);
  const unsafeEntries = entries.filter(([, operation]) => isCsrfProtectedMethod(operation.method));
  const safeEntries = entries.filter(([, operation]) => !isCsrfProtectedMethod(operation.method));
  const missingUnsafeOperationIds = unsafeEntries
    .filter(([, operation]) => !contract.protectedMethods.includes(operation.method as SessionContract["csrf"]["protectedMethods"][number]))
    .map(([operationId]) => operationId);
  const unsafeIdempotencyRequiredOperationIds = unsafeEntries
    .filter(([, operation]) => operation.idempotencyRequired)
    .map(([operationId]) => operationId);
  const unsafeIdempotencyExemptOperationIds = unsafeEntries
    .filter(([, operation]) => !operation.idempotencyRequired)
    .map(([operationId]) => operationId);
  const unsafeRequestContracts = unsafeEntries.map(([operationId, operation]) => ({
    operationId,
    method: operation.method,
    path: operation.path,
    credentials: contract.credentialMode,
    csrfHeaderName: contract.headerName,
    csrfHeaderValue: contract.headerValue,
    idempotencyHeaderRequired: operation.idempotencyRequired
  }));
  const failureReasons = [
    contract.credentialMode === "include" ? "" : "csrf-credentials",
    contract.headerName === "X-ZenArt-CSRF" ? "" : "csrf-header",
    contract.headerValue === "same-site-origin-check" ? "" : "csrf-header-value",
    contract.originPolicy === "same-site-only" ? "" : "csrf-origin-policy",
    contract.sameSiteRequired === "lax-or-strict" ? "" : "csrf-same-site-requirement",
    unsafeRequestContracts.length > 0 ? "" : "csrf-operation-inventory",
    missingUnsafeOperationIds.length === 0 ? "" : "csrf-operation-coverage"
  ].filter(Boolean);

  return {
    schema_version: "stage0.rev2.generated-api-csrf-contract",
    status: failureReasons.length === 0 ? "pass" : "fail",
    credentialMode: contract.credentialMode,
    csrfHeaderName: contract.headerName,
    csrfHeaderValue: contract.headerValue,
    sameSiteRequirement: contract.sameSiteRequired,
    originPolicy: contract.originPolicy,
    protectedMethods: contract.protectedMethods,
    unsafeOperationCount: unsafeRequestContracts.length,
    safeOperationCount: safeEntries.length,
    unsafeOperationIds: unsafeEntries.map(([operationId]) => operationId),
    safeOperationIds: safeEntries.map(([operationId]) => operationId),
    unsafeIdempotencyRequiredOperationIds,
    unsafeIdempotencyExemptOperationIds,
    missingUnsafeOperationIds,
    unsafeRequestContracts,
    failureReasons
  };
};
