import { describe, expect, it } from "vitest";
import userRouteSmoke from "../validation/user-routes-smoke.json";
import { apiOperations } from "./generated/zenart-api";
import { createSessionContract } from "./dev-state";
import {
  buildSecureCookieSameSiteRuntimePairingDigest,
  buildGeneratedApiCsrfRequestContractEvidence,
  buildCsrfRequestHeaders,
  buildSessionSecurityContractEvidence,
  defaultSameSiteCsrfContract,
  isCsrfProtectedMethod,
} from "./request-security";

const generatedUnsafeOperationIds = Object.entries(apiOperations)
  .filter(([, operation]) => isCsrfProtectedMethod(operation.method))
  .map(([operationId]) => operationId);
const generatedSafeOperationIds = Object.entries(apiOperations)
  .filter(([, operation]) => !isCsrfProtectedMethod(operation.method))
  .map(([operationId]) => operationId);
const generatedUnsafeIdempotencyRequiredOperationIds = Object.entries(
  apiOperations,
)
  .filter(
    ([, operation]) =>
      isCsrfProtectedMethod(operation.method) && operation.idempotencyRequired,
  )
  .map(([operationId]) => operationId);
const generatedUnsafeIdempotencyExemptOperationIds = Object.entries(
  apiOperations,
)
  .filter(
    ([, operation]) =>
      isCsrfProtectedMethod(operation.method) && !operation.idempotencyRequired,
  )
  .map(([operationId]) => operationId);

describe("same-site CSRF request contract", () => {
  it("marks only state-changing methods as CSRF protected", () => {
    expect(isCsrfProtectedMethod("GET")).toBe(false);
    expect(isCsrfProtectedMethod("HEAD")).toBe(false);
    expect(isCsrfProtectedMethod("OPTIONS")).toBe(false);
    expect(isCsrfProtectedMethod("POST")).toBe(true);
    expect(isCsrfProtectedMethod("PUT")).toBe(true);
    expect(isCsrfProtectedMethod("PATCH")).toBe(true);
    expect(isCsrfProtectedMethod("DELETE")).toBe(true);
  });

  it("adds the same-site CSRF header to unsafe requests while preserving unrelated caller headers", () => {
    expect(
      buildCsrfRequestHeaders("GET", { Accept: "application/json" }),
    ).toEqual({
      Accept: "application/json",
    });
    expect(
      buildCsrfRequestHeaders("HEAD", { Accept: "application/json" }),
    ).toEqual({
      Accept: "application/json",
    });
    expect(
      buildCsrfRequestHeaders("OPTIONS", { Accept: "application/json" }),
    ).toEqual({
      Accept: "application/json",
    });
    expect(
      buildCsrfRequestHeaders("POST", { Accept: "application/json" }),
    ).toEqual({
      Accept: "application/json",
      [defaultSameSiteCsrfContract.headerName]:
        defaultSameSiteCsrfContract.headerValue,
    });
    expect(
      buildCsrfRequestHeaders("PATCH", {
        Accept: "application/json",
        [defaultSameSiteCsrfContract.headerName]: "caller-token",
      }),
    ).toEqual({
      Accept: "application/json",
      [defaultSameSiteCsrfContract.headerName]:
        defaultSameSiteCsrfContract.headerValue,
    });
  });

  it("strips caller-supplied CSRF aliases before applying the canonical same-site header", () => {
    expect(
      buildCsrfRequestHeaders("GET", {
        Accept: "application/json",
        "X-Zenari-CSRF": "stale-token",
        "x-zenari-csrf": "lowercase-stale-token",
      }),
    ).toEqual({
      Accept: "application/json",
    });
    expect(
      buildCsrfRequestHeaders("POST", {
        Accept: "application/json",
        "X-Zenari-CSRF": "stale-token",
        "x-zenari-csrf": "lowercase-stale-token",
        "X-Client-Trace": "trace-001",
      }),
    ).toEqual({
      Accept: "application/json",
      "X-Client-Trace": "trace-001",
      [defaultSameSiteCsrfContract.headerName]:
        defaultSameSiteCsrfContract.headerValue,
    });
  });

  it("builds machine-checkable secure-cookie and same-site CSRF evidence for generated operations", () => {
    const evidence = buildSessionSecurityContractEvidence(
      createSessionContract(),
      apiOperations,
    );

    expect(evidence).toMatchObject({
      schema_version: "stage0.rev2.session-csrf-client-evidence",
      status: "pass",
      cookieName: "__Host-zenari_session",
      cookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        domain: "",
        hostOnly: true,
      },
      hostPrefixInvariant: {
        prefix: "__Host-",
        prefixPresent: true,
        secure: true,
        pathRoot: true,
        hostOnly: true,
        status: "pass",
        failureReasons: [],
      },
      setCookieContract:
        "__Host-zenari_session;HttpOnly;Secure;SameSite=lax;Path=/;HostOnly",
      acceptedSameSiteValues: ["lax", "strict"],
      rejectedSameSiteValues: ["none"],
      sameSiteAcceptanceMatrix: [
        { sameSite: "lax", status: "pass", failureReason: "" },
        { sameSite: "strict", status: "pass", failureReason: "" },
        { sameSite: "none", status: "fail", failureReason: "cookie-same-site" },
      ],
      sameSiteRequirement: "lax-or-strict",
      csrfStrategy: "same-site-origin-check",
      csrfHeaderName: "X-Zenari-CSRF",
      credentialMode: "include",
      originPolicy: "same-site-only",
      missingCsrfOperationIds: [],
      cookieFailureReasons: [],
      csrfFailureReasons: [],
    });
    expect(evidence.protectedOperationIds).toEqual(generatedUnsafeOperationIds);
  });

  it("builds per-operation generated client request evidence for unsafe operations", () => {
    const evidence =
      buildGeneratedApiCsrfRequestContractEvidence(apiOperations);

    expect(evidence).toMatchObject({
      schema_version: "stage0.rev2.generated-api-csrf-contract",
      status: "pass",
      credentialMode: "include",
      csrfHeaderName: "X-Zenari-CSRF",
      csrfHeaderValue: "same-site-origin-check",
      sameSiteRequirement: "lax-or-strict",
      originPolicy: "same-site-only",
      protectedMethods: ["POST", "PUT", "PATCH", "DELETE"],
      unsafeOperationCount: generatedUnsafeOperationIds.length,
      safeOperationCount: generatedSafeOperationIds.length,
      unsafeOperationIds: generatedUnsafeOperationIds,
      safeOperationIds: generatedSafeOperationIds,
      unsafeIdempotencyRequiredOperationIds:
        generatedUnsafeIdempotencyRequiredOperationIds,
      unsafeIdempotencyExemptOperationIds:
        generatedUnsafeIdempotencyExemptOperationIds,
      missingUnsafeOperationIds: [],
      methodCoverage: {
        schema_version: "stage0.rev2.generated-api-csrf-method-coverage",
        status: "pass",
        protectedMethods: ["POST", "PUT", "PATCH", "DELETE"],
        safeMethods: ["GET", "HEAD", "OPTIONS"],
        coveredUnsafeMethods: ["DELETE", "PATCH", "POST", "PUT"],
        coveredSafeMethods: ["GET"],
        unsafeMethodCoverage: [
          "POST:covered",
          "PUT:covered",
          "PATCH:covered",
          "DELETE:covered",
        ],
        safeMethodCoverage: [
          "GET:covered",
          "HEAD:not-generated",
          "OPTIONS:not-generated",
        ],
        failureReasons: [],
      },
      failureReasons: [],
    });
    expect(
      evidence.unsafeRequestContracts.map((contract) => contract.operationId),
    ).toEqual(generatedUnsafeOperationIds);
    expect(evidence.unsafeRequestContracts).toContainEqual({
      operationId: "createUpload",
      method: "POST",
      path: "/uploads",
      credentials: "include",
      csrfHeaderName: "X-Zenari-CSRF",
      csrfHeaderValue: "same-site-origin-check",
      idempotencyHeaderRequired: true,
    });
    expect(evidence.unsafeRequestContracts).toContainEqual({
      operationId: "deleteSession",
      method: "DELETE",
      path: "/session",
      credentials: "include",
      csrfHeaderName: "X-Zenari-CSRF",
      csrfHeaderValue: "same-site-origin-check",
      idempotencyHeaderRequired: false,
    });
    expect(evidence.safeRequestContracts).toContainEqual({
      operationId: "getSession",
      method: "GET",
      path: "/session",
      credentials: "include",
      csrfHeaderName: "not-required",
      csrfHeaderValue: "not-required",
      idempotencyHeaderRequired: false,
    });
    expect(evidence.safeRequestContracts).toContainEqual({
      operationId: "getSubscription",
      method: "GET",
      path: "/billing/subscription",
      credentials: "include",
      csrfHeaderName: "not-required",
      csrfHeaderValue: "not-required",
      idempotencyHeaderRequired: false,
    });
    expect(evidence.safeRequestContracts).toContainEqual({
      operationId: "listBillingInvoices",
      method: "GET",
      path: "/billing/invoices",
      credentials: "include",
      csrfHeaderName: "not-required",
      csrfHeaderValue: "not-required",
      idempotencyHeaderRequired: false,
    });
  });

  it("keeps HEAD and OPTIONS same-site credentialed but outside CSRF unsafe inventory", () => {
    const operations = {
      getSession: {
        method: "GET",
        path: "/session",
        idempotencyRequired: false,
      },
      headSession: {
        method: "HEAD",
        path: "/session",
        idempotencyRequired: false,
      },
      optionsSession: {
        method: "OPTIONS",
        path: "/session",
        idempotencyRequired: false,
      },
      createUpload: {
        method: "POST",
        path: "/uploads",
        idempotencyRequired: true,
      },
    } as const;

    const evidence = buildGeneratedApiCsrfRequestContractEvidence(operations);

    expect(evidence).toMatchObject({
      status: "fail",
      unsafeOperationIds: ["createUpload"],
      safeOperationIds: ["getSession", "headSession", "optionsSession"],
      unsafeOperationCount: 1,
      safeOperationCount: 3,
      methodCoverage: {
        status: "fail",
        protectedMethods: ["POST", "PUT", "PATCH", "DELETE"],
        safeMethods: ["GET", "HEAD", "OPTIONS"],
        coveredUnsafeMethods: ["POST"],
        coveredSafeMethods: ["GET", "HEAD", "OPTIONS"],
        unsafeMethodCoverage: [
          "POST:covered",
          "PUT:missing",
          "PATCH:missing",
          "DELETE:missing",
        ],
        safeMethodCoverage: ["GET:covered", "HEAD:covered", "OPTIONS:covered"],
        failureReasons: [
          "missing-unsafe-method-PUT",
          "missing-unsafe-method-PATCH",
          "missing-unsafe-method-DELETE",
        ],
      },
      missingUnsafeOperationIds: [],
      failureReasons: ["csrf-method-coverage"],
    });
    expect(evidence.safeRequestContracts).toEqual([
      {
        operationId: "getSession",
        method: "GET",
        path: "/session",
        credentials: "include",
        csrfHeaderName: "not-required",
        csrfHeaderValue: "not-required",
        idempotencyHeaderRequired: false,
      },
      {
        operationId: "headSession",
        method: "HEAD",
        path: "/session",
        credentials: "include",
        csrfHeaderName: "not-required",
        csrfHeaderValue: "not-required",
        idempotencyHeaderRequired: false,
      },
      {
        operationId: "optionsSession",
        method: "OPTIONS",
        path: "/session",
        credentials: "include",
        csrfHeaderName: "not-required",
        csrfHeaderValue: "not-required",
        idempotencyHeaderRequired: false,
      },
    ]);
    expect(buildCsrfRequestHeaders("HEAD")).toEqual({});
    expect(buildCsrfRequestHeaders("OPTIONS")).toEqual({});
  });

  it("accepts only lax or strict cookies for the same-site CSRF requirement", () => {
    const strictSession = createSessionContract();
    strictSession.cookie = {
      ...strictSession.cookie,
      sameSite: "strict",
    };

    expect(
      buildSessionSecurityContractEvidence(strictSession, apiOperations),
    ).toMatchObject({
      status: "pass",
      cookieAttributes: {
        sameSite: "strict",
      },
      sameSiteRequirement: "lax-or-strict",
      cookieFailureReasons: [],
    });

    const noneSession = createSessionContract();
    noneSession.cookie = {
      ...noneSession.cookie,
      sameSite: "none",
    };

    expect(
      buildSessionSecurityContractEvidence(noneSession, apiOperations),
    ).toMatchObject({
      status: "fail",
      sameSiteRequirement: "lax-or-strict",
      cookieFailureReasons: ["cookie-same-site"],
    });
  });

  it("fails secure-cookie evidence when a __Host cookie carries a Domain attribute", () => {
    const domainScopedSession = createSessionContract();
    domainScopedSession.cookie = {
      ...domainScopedSession.cookie,
      domain: ".zenari.local",
    };

    expect(
      buildSessionSecurityContractEvidence(domainScopedSession, apiOperations),
    ).toMatchObject({
      status: "fail",
      cookieAttributes: {
        domain: ".zenari.local",
        hostOnly: false,
      },
      hostPrefixInvariant: {
        prefix: "__Host-",
        prefixPresent: true,
        secure: true,
        pathRoot: true,
        hostOnly: false,
        status: "fail",
        failureReasons: ["cookie-domain"],
      },
      setCookieContract:
        "__Host-zenari_session;HttpOnly;Secure;SameSite=lax;Path=/;Domain=.zenari.local",
      cookieFailureReasons: ["cookie-domain"],
    });
  });

  it("keeps the user route smoke artifact pinned to the session/CSRF client contract", () => {
    const artifactEvidence = userRouteSmoke.securityEvidence.find(
      (entry) =>
        entry.schemaVersion === "stage0.rev2.session-csrf-client-evidence",
    );
    const runtimeEvidence = buildSessionSecurityContractEvidence(
      createSessionContract(),
      apiOperations,
    );
    const generatedRuntimeEvidence =
      buildGeneratedApiCsrfRequestContractEvidence(apiOperations);
    const runtimePairingDigest = buildSecureCookieSameSiteRuntimePairingDigest(
      createSessionContract(),
      generatedRuntimeEvidence,
      runtimeEvidence,
    );

    expect(artifactEvidence).toMatchObject({
      route: "/account",
      source: "web/components/workspace-app.tsx",
      statusAttribute: "data-session-security-status",
      expectedStatus: runtimeEvidence.status,
      cookie: {
        name: runtimeEvidence.cookieName,
        httpOnlyAttribute: "data-session-cookie-http-only",
        secureAttribute: "data-session-cookie-secure",
        sameSiteAttribute: "data-session-cookie-same-site",
        pathAttribute: "data-session-cookie-path",
        setCookieContractAttribute: "data-session-cookie-set-cookie-contract",
        domainAttribute: "data-session-cookie-domain",
        hostOnlyAttribute: "data-session-cookie-host-only",
        hostPrefixAttribute: "data-session-cookie-host-prefix",
        hostPrefixStatusAttribute: "data-session-cookie-host-prefix-status",
        hostPrefixPresentAttribute: "data-session-cookie-host-prefix-present",
        hostPrefixSecureAttribute: "data-session-cookie-host-prefix-secure",
        hostPrefixPathRootAttribute:
          "data-session-cookie-host-prefix-path-root",
        hostPrefixHostOnlyAttribute:
          "data-session-cookie-host-prefix-host-only",
        hostPrefixFailureCountAttribute:
          "data-session-cookie-host-prefix-failure-count",
        hostPrefixFailureReasonsAttribute:
          "data-session-cookie-host-prefix-failure-reasons",
        expectedHttpOnly: String(runtimeEvidence.cookieAttributes.httpOnly),
        expectedSecure: String(runtimeEvidence.cookieAttributes.secure),
        expectedSameSite: runtimeEvidence.cookieAttributes.sameSite,
        expectedPath: runtimeEvidence.cookieAttributes.path,
        expectedSetCookieContract: runtimeEvidence.setCookieContract,
        expectedDomain: runtimeEvidence.cookieAttributes.domain,
        expectedHostOnly: String(runtimeEvidence.cookieAttributes.hostOnly),
        expectedHostPrefix: runtimeEvidence.hostPrefixInvariant.prefix,
        expectedHostPrefixStatus: runtimeEvidence.hostPrefixInvariant.status,
        expectedHostPrefixPresent: String(
          runtimeEvidence.hostPrefixInvariant.prefixPresent,
        ),
        expectedHostPrefixSecure: String(
          runtimeEvidence.hostPrefixInvariant.secure,
        ),
        expectedHostPrefixPathRoot: String(
          runtimeEvidence.hostPrefixInvariant.pathRoot,
        ),
        expectedHostPrefixHostOnly: String(
          runtimeEvidence.hostPrefixInvariant.hostOnly,
        ),
        expectedHostPrefixFailureCount: String(
          runtimeEvidence.hostPrefixInvariant.failureReasons.length,
        ),
        expectedHostPrefixFailureReasons:
          runtimeEvidence.hostPrefixInvariant.failureReasons.join(","),
      },
      csrf: {
        strategyAttribute: "data-session-csrf-strategy",
        headerAttribute: "data-session-csrf-header",
        credentialModeAttribute: "data-session-csrf-credential-mode",
        originPolicyAttribute: "data-session-csrf-origin-policy",
        sameSiteRequirementAttribute: "data-session-csrf-same-site-requirement",
        missingOperationCountAttribute:
          "data-session-csrf-missing-operation-count",
        cookieFailureCountAttribute: "data-session-cookie-failure-count",
        cookieFailureReasonsAttribute: "data-session-cookie-failure-reasons",
        csrfFailureCountAttribute: "data-session-csrf-failure-count",
        csrfFailureReasonsAttribute: "data-session-csrf-failure-reasons",
        expectedStrategy: runtimeEvidence.csrfStrategy,
        expectedHeader: runtimeEvidence.csrfHeaderName,
        expectedCredentialMode: runtimeEvidence.credentialMode,
        expectedSameSiteRequirement: runtimeEvidence.sameSiteRequirement,
        expectedOriginPolicy: runtimeEvidence.originPolicy,
        expectedMissingOperationCount: String(
          runtimeEvidence.missingCsrfOperationIds.length,
        ),
        expectedCookieFailureCount: String(
          runtimeEvidence.cookieFailureReasons.length,
        ),
        expectedCsrfFailureCount: String(
          runtimeEvidence.csrfFailureReasons.length,
        ),
      },
      backendRuntimePairing: {
        schemaVersion:
          "stage0.rev2.secure-cookie-same-site-csrf-runtime-pairing",
        contractAttribute: "data-session-backend-runtime-pairing",
        statusAttribute: "data-session-backend-runtime-pairing-status",
        digestAttribute: "data-session-backend-runtime-pairing-digest",
        setCookieContractAttribute: "data-session-backend-set-cookie-contract",
        csrfValidationContractAttribute:
          "data-session-backend-csrf-validation-contract",
        unsafeRequestContractCountAttribute:
          "data-session-backend-unsafe-request-contract-count",
        missingUnsafeOperationCountAttribute:
          "data-session-backend-missing-unsafe-operation-count",
        cookieFailureCountAttribute:
          "data-session-backend-cookie-failure-count",
        csrfFailureCountAttribute: "data-session-backend-csrf-failure-count",
        expectedContract: "secure-cookie-same-site-csrf-runtime",
        expectedStatus: "pass",
        expectedDigest: runtimePairingDigest,
        expectedSetCookieContract:
          "__Host-zenari_session;HttpOnly;Secure;SameSite=lax;Path=/;HostOnly",
        expectedCsrfValidationContract:
          "POST,PUT,PATCH,DELETE:X-Zenari-CSRF:same-site-origin-check:same-site-only:include:lax-or-strict",
        expectedUnsafeRequestContractCount: String(
          generatedRuntimeEvidence.unsafeRequestContracts.length,
        ),
        expectedMissingUnsafeOperationCount: String(
          runtimeEvidence.missingCsrfOperationIds.length,
        ),
        expectedCookieFailureCount: String(
          runtimeEvidence.cookieFailureReasons.length,
        ),
        expectedCsrfFailureCount: String(
          runtimeEvidence.csrfFailureReasons.length,
        ),
      },
    });
  });

  it("fails closed with explicit reasons when secure-cookie or CSRF fields drift", () => {
    const insecureSession = createSessionContract();
    insecureSession.cookie = {
      name: "zenari_session",
      httpOnly: false,
      secure: false,
      sameSite: "none",
      path: "/app",
      domain: ".zenari.local",
    };
    insecureSession.csrf = {
      ...defaultSameSiteCsrfContract,
      headerName: "X-Unsafe-CSRF",
      protectedMethods: [],
    };

    const evidence = buildSessionSecurityContractEvidence(
      insecureSession,
      apiOperations,
    );

    expect(evidence.status).toBe("fail");
    expect(evidence.cookieFailureReasons).toEqual([
      "cookie-prefix",
      "cookie-http-only",
      "cookie-secure",
      "cookie-same-site",
      "cookie-path",
      "cookie-domain",
    ]);
    expect(evidence.hostPrefixInvariant).toEqual({
      prefix: "__Host-",
      prefixPresent: false,
      secure: false,
      pathRoot: false,
      hostOnly: false,
      status: "fail",
      failureReasons: [
        "cookie-prefix",
        "cookie-secure",
        "cookie-path",
        "cookie-domain",
      ],
    });
    expect(evidence.csrfFailureReasons).toEqual([
      "csrf-header",
      "csrf-operation-coverage",
    ]);
    expect(evidence.missingCsrfOperationIds).toEqual(
      generatedUnsafeOperationIds,
    );
  });

  it("fails generated client request evidence when the same-site contract drifts", () => {
    const evidence = buildGeneratedApiCsrfRequestContractEvidence(
      apiOperations,
      {
        ...defaultSameSiteCsrfContract,
        headerName: "X-Unsafe-CSRF",
        credentialMode: "include",
        protectedMethods: [],
      },
    );

    expect(evidence.status).toBe("fail");
    expect(evidence.failureReasons).toEqual([
      "csrf-header",
      "csrf-operation-coverage",
    ]);
    expect(evidence.missingUnsafeOperationIds).toEqual(
      generatedUnsafeOperationIds,
    );
  });
});
