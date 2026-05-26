import { SessionContract, SessionSecurityContractEvidence } from "./contracts";

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
    sessionContract.cookie.path === "/" ? "" : "cookie-path"
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

  return {
    schema_version: "stage0.rev2.session-csrf-client-evidence",
    status: cookiePass && csrfPass ? "pass" : "fail",
    cookieName: sessionContract.cookie.name,
    cookieAttributes: {
      httpOnly: sessionContract.cookie.httpOnly,
      secure: sessionContract.cookie.secure,
      sameSite: sessionContract.cookie.sameSite,
      path: sessionContract.cookie.path
    },
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
