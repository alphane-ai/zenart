import { describe, expect, it } from "vitest";
import userRouteSmoke from "../validation/user-routes-smoke.json";
import { apiOperations } from "./generated/zenart-api";
import { createSessionContract } from "./dev-state";
import {
  buildGeneratedApiCsrfRequestContractEvidence,
  buildCsrfRequestHeaders,
  buildSessionSecurityContractEvidence,
  defaultSameSiteCsrfContract,
  isCsrfProtectedMethod
} from "./request-security";

describe("same-site CSRF request contract", () => {
  it("marks only state-changing methods as CSRF protected", () => {
    expect(isCsrfProtectedMethod("GET")).toBe(false);
    expect(isCsrfProtectedMethod("HEAD")).toBe(false);
    expect(isCsrfProtectedMethod("POST")).toBe(true);
    expect(isCsrfProtectedMethod("PUT")).toBe(true);
    expect(isCsrfProtectedMethod("PATCH")).toBe(true);
    expect(isCsrfProtectedMethod("DELETE")).toBe(true);
  });

  it("adds the same-site CSRF header to unsafe requests without replacing caller headers", () => {
    expect(buildCsrfRequestHeaders("GET", { Accept: "application/json" })).toEqual({
      Accept: "application/json"
    });
    expect(buildCsrfRequestHeaders("POST", { Accept: "application/json" })).toEqual({
      Accept: "application/json",
      [defaultSameSiteCsrfContract.headerName]: defaultSameSiteCsrfContract.headerValue
    });
    expect(buildCsrfRequestHeaders("PATCH", { [defaultSameSiteCsrfContract.headerName]: "caller-token" })).toEqual({
      [defaultSameSiteCsrfContract.headerName]: "caller-token"
    });
  });

  it("builds machine-checkable secure-cookie and same-site CSRF evidence for generated operations", () => {
    const evidence = buildSessionSecurityContractEvidence(createSessionContract(), apiOperations);

    expect(evidence).toMatchObject({
      schema_version: "stage0.rev2.session-csrf-client-evidence",
      status: "pass",
      cookieName: "__Host-zenart_session",
      cookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/"
      },
      sameSiteRequirement: "lax-or-strict",
      csrfStrategy: "same-site-origin-check",
      csrfHeaderName: "X-ZenArt-CSRF",
      credentialMode: "include",
      originPolicy: "same-site-only",
      missingCsrfOperationIds: [],
      cookieFailureReasons: [],
      csrfFailureReasons: []
    });
    expect(evidence.protectedOperationIds).toEqual([
      "deleteSession",
      "updateAccount",
      "createProject",
      "updateProject",
      "createChatSession",
      "createChatMessage",
      "createCandidateSet",
      "selectDirection",
      "createCanvasNode",
      "createCanvasVersion",
      "createUpload",
      "createPackage",
      "createExport",
      "createShareLink",
      "createSupportTicket"
    ]);
  });

  it("builds per-operation generated client request evidence for unsafe operations", () => {
    const evidence = buildGeneratedApiCsrfRequestContractEvidence(apiOperations);

    expect(evidence).toMatchObject({
      schema_version: "stage0.rev2.generated-api-csrf-contract",
      status: "pass",
      credentialMode: "include",
      csrfHeaderName: "X-ZenArt-CSRF",
      csrfHeaderValue: "same-site-origin-check",
      sameSiteRequirement: "lax-or-strict",
      originPolicy: "same-site-only",
      protectedMethods: ["POST", "PUT", "PATCH", "DELETE"],
      unsafeOperationCount: 15,
      safeOperationCount: 17,
      unsafeOperationIds: [
        "deleteSession",
        "updateAccount",
        "createProject",
        "updateProject",
        "createChatSession",
        "createChatMessage",
        "createCandidateSet",
        "selectDirection",
        "createCanvasNode",
        "createCanvasVersion",
        "createUpload",
        "createPackage",
        "createExport",
        "createShareLink",
        "createSupportTicket"
      ],
      safeOperationIds: [
        "getSession",
        "getAccount",
        "listProjects",
        "getProject",
        "getWorkspace",
        "listChatMessages",
        "getTask",
        "listCandidateSets",
        "listCandidateAssets",
        "listCanvasNodes",
        "listCanvasFrames",
        "listCanvasVersions",
        "listAssets",
        "listPackages",
        "getExport",
        "getQuota",
        "getSubscription"
      ],
      unsafeIdempotencyRequiredOperationIds: [
        "updateAccount",
        "createProject",
        "updateProject",
        "createChatSession",
        "createChatMessage",
        "createCandidateSet",
        "selectDirection",
        "createCanvasNode",
        "createCanvasVersion",
        "createUpload",
        "createPackage",
        "createExport",
        "createShareLink",
        "createSupportTicket"
      ],
      unsafeIdempotencyExemptOperationIds: ["deleteSession"],
      missingUnsafeOperationIds: [],
      failureReasons: []
    });
    expect(evidence.unsafeRequestContracts.map((contract) => contract.operationId)).toEqual([
      "deleteSession",
      "updateAccount",
      "createProject",
      "updateProject",
      "createChatSession",
      "createChatMessage",
      "createCandidateSet",
      "selectDirection",
      "createCanvasNode",
      "createCanvasVersion",
      "createUpload",
      "createPackage",
      "createExport",
      "createShareLink",
      "createSupportTicket"
    ]);
    expect(evidence.unsafeRequestContracts).toContainEqual({
      operationId: "createUpload",
      method: "POST",
      path: "/uploads",
      credentials: "include",
      csrfHeaderName: "X-ZenArt-CSRF",
      csrfHeaderValue: "same-site-origin-check",
      idempotencyHeaderRequired: true
    });
    expect(evidence.unsafeRequestContracts).toContainEqual({
      operationId: "deleteSession",
      method: "DELETE",
      path: "/session",
      credentials: "include",
      csrfHeaderName: "X-ZenArt-CSRF",
      csrfHeaderValue: "same-site-origin-check",
      idempotencyHeaderRequired: false
    });
  });

  it("accepts only lax or strict cookies for the same-site CSRF requirement", () => {
    const strictSession = createSessionContract();
    strictSession.cookie = {
      ...strictSession.cookie,
      sameSite: "strict"
    };

    expect(buildSessionSecurityContractEvidence(strictSession, apiOperations)).toMatchObject({
      status: "pass",
      cookieAttributes: {
        sameSite: "strict"
      },
      sameSiteRequirement: "lax-or-strict",
      cookieFailureReasons: []
    });

    const noneSession = createSessionContract();
    noneSession.cookie = {
      ...noneSession.cookie,
      sameSite: "none"
    };

    expect(buildSessionSecurityContractEvidence(noneSession, apiOperations)).toMatchObject({
      status: "fail",
      sameSiteRequirement: "lax-or-strict",
      cookieFailureReasons: ["cookie-same-site"]
    });
  });

  it("keeps the user route smoke artifact pinned to the session/CSRF client contract", () => {
    const artifactEvidence = userRouteSmoke.securityEvidence.find(
      (entry) => entry.schemaVersion === "stage0.rev2.session-csrf-client-evidence"
    );
    const runtimeEvidence = buildSessionSecurityContractEvidence(createSessionContract(), apiOperations);

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
        expectedHttpOnly: String(runtimeEvidence.cookieAttributes.httpOnly),
        expectedSecure: String(runtimeEvidence.cookieAttributes.secure),
        expectedSameSite: runtimeEvidence.cookieAttributes.sameSite,
        expectedPath: runtimeEvidence.cookieAttributes.path
      },
      csrf: {
        headerAttribute: "data-session-csrf-header",
        originPolicyAttribute: "data-session-csrf-origin-policy",
        missingOperationCountAttribute: "data-session-csrf-missing-operation-count",
        cookieFailureCountAttribute: "data-session-cookie-failure-count",
        cookieFailureReasonsAttribute: "data-session-cookie-failure-reasons",
        csrfFailureCountAttribute: "data-session-csrf-failure-count",
        csrfFailureReasonsAttribute: "data-session-csrf-failure-reasons",
        expectedHeader: runtimeEvidence.csrfHeaderName,
        expectedSameSiteRequirement: runtimeEvidence.sameSiteRequirement,
        expectedOriginPolicy: runtimeEvidence.originPolicy,
        expectedMissingOperationCount: String(runtimeEvidence.missingCsrfOperationIds.length),
        expectedCookieFailureCount: String(runtimeEvidence.cookieFailureReasons.length),
        expectedCsrfFailureCount: String(runtimeEvidence.csrfFailureReasons.length)
      }
    });
  });

  it("fails closed with explicit reasons when secure-cookie or CSRF fields drift", () => {
    const insecureSession = createSessionContract();
    insecureSession.cookie = {
      name: "zenart_session",
      httpOnly: false,
      secure: false,
      sameSite: "none",
      path: "/app"
    };
    insecureSession.csrf = {
      ...defaultSameSiteCsrfContract,
      headerName: "X-Unsafe-CSRF",
      protectedMethods: []
    };

    const evidence = buildSessionSecurityContractEvidence(insecureSession, apiOperations);

    expect(evidence.status).toBe("fail");
    expect(evidence.cookieFailureReasons).toEqual([
      "cookie-prefix",
      "cookie-http-only",
      "cookie-secure",
      "cookie-same-site",
      "cookie-path"
    ]);
    expect(evidence.csrfFailureReasons).toEqual(["csrf-header", "csrf-operation-coverage"]);
    expect(evidence.missingCsrfOperationIds).toEqual([
      "deleteSession",
      "updateAccount",
      "createProject",
      "updateProject",
      "createChatSession",
      "createChatMessage",
      "createCandidateSet",
      "selectDirection",
      "createCanvasNode",
      "createCanvasVersion",
      "createUpload",
      "createPackage",
      "createExport",
      "createShareLink",
      "createSupportTicket"
    ]);
  });

  it("fails generated client request evidence when the same-site contract drifts", () => {
    const evidence = buildGeneratedApiCsrfRequestContractEvidence(apiOperations, {
      ...defaultSameSiteCsrfContract,
      headerName: "X-Unsafe-CSRF",
      credentialMode: "include",
      protectedMethods: []
    });

    expect(evidence.status).toBe("fail");
    expect(evidence.failureReasons).toEqual(["csrf-header", "csrf-operation-coverage"]);
    expect(evidence.missingUnsafeOperationIds).toEqual([
      "deleteSession",
      "updateAccount",
      "createProject",
      "updateProject",
      "createChatSession",
      "createChatMessage",
      "createCandidateSet",
      "selectDirection",
      "createCanvasNode",
      "createCanvasVersion",
      "createUpload",
      "createPackage",
      "createExport",
      "createShareLink",
      "createSupportTicket"
    ]);
  });
});
