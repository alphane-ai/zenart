import { describe, expect, it } from "vitest";
import userRouteSmoke from "../validation/user-routes-smoke.json";
import { apiOperations } from "./generated/zenart-api";
import { createSessionContract } from "./dev-state";
import {
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
      missingCsrfOperationIds: []
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
        expectedHeader: runtimeEvidence.csrfHeaderName,
        expectedOriginPolicy: runtimeEvidence.originPolicy,
        expectedMissingOperationCount: String(runtimeEvidence.missingCsrfOperationIds.length)
      }
    });
  });
});
