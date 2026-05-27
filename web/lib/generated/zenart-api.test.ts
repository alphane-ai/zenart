import { afterEach, describe, expect, it, vi } from "vitest";
import generatedApiCsrfContract from "../../validation/generated-api-csrf-contract.json";
import userRouteSmoke from "../../validation/user-routes-smoke.json";
import { buildGeneratedApiCsrfRequestContractEvidence, defaultSameSiteCsrfContract } from "../request-security";
import { apiOperations, OperationId, ZenArtApiClient } from "./zenart-api";

describe("generated web API client CSRF contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends same-site credentials and CSRF header on state-changing requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new ZenArtApiClient();

    await client.request("updateAccount", {
      idempotencyKey: "idem-account-001",
      body: { brand_name: "Northstar" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/account",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": "idem-account-001",
          "X-ZenArt-CSRF": "same-site-origin-check"
        })
      })
    );
  });

  it("keeps read-only requests credentialed without adding the CSRF header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "session-001" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new ZenArtApiClient();

    await client.request("getSession");

    expect(fetchMock).toHaveBeenCalledWith(
      "/session",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: expect.not.objectContaining({
          "X-ZenArt-CSRF": "same-site-origin-check"
        })
      })
    );
  });

  it("covers every unsafe generated web operation with credentials, CSRF header, and required idempotency", async () => {
    const unsafeOperations = Object.entries(apiOperations).filter(([, operation]) =>
      defaultSameSiteCsrfContract.protectedMethods.includes(
        operation.method as (typeof defaultSameSiteCsrfContract.protectedMethods)[number]
      )
    ) as Array<[OperationId, (typeof apiOperations)[OperationId]]>;

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new ZenArtApiClient();

    for (const [operationId, operation] of unsafeOperations) {
      await client.request(operationId, {
        idempotencyKey: `idem-${operationId}`,
        pathParams: buildPathParams(operation.path),
        body: operation.method === "DELETE" ? undefined : { ok: true }
      });
    }

    expect(unsafeOperations).toHaveLength(15);
    expect(unsafeOperations.map(([operationId]) => operationId)).toEqual([
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
    for (const [callIndex, [operationId, operation]] of unsafeOperations.entries()) {
      expect(fetchMock).toHaveBeenNthCalledWith(
        callIndex + 1,
        expect.any(String),
        expect.objectContaining({
          method: operation.method,
          credentials: defaultSameSiteCsrfContract.credentialMode,
          headers: expect.objectContaining({
            [defaultSameSiteCsrfContract.headerName]: defaultSameSiteCsrfContract.headerValue
          })
        })
      );
      if (operation.idempotencyRequired) {
        expect(fetchMock.mock.calls[callIndex][1]).toEqual(
          expect.objectContaining({
            headers: expect.objectContaining({
              "Idempotency-Key": `idem-${operationId}`
            })
          })
        );
      }
    }
  });

  it("matches the machine-checkable generated client CSRF evidence artifact", () => {
    const routeSmokeEvidence = generatedApiCsrfContractFromRouteSmoke();
    const requestContractEvidence = buildGeneratedApiCsrfRequestContractEvidence(apiOperations);
    const unsafeOperations = Object.entries(apiOperations)
      .filter(([, operation]) =>
        generatedApiCsrfContract.protectedMethods.includes(
          operation.method as (typeof generatedApiCsrfContract.protectedMethods)[number]
        )
      )
      .map(([operationId]) => operationId);
    const safeOperations = Object.entries(apiOperations)
      .filter(([, operation]) =>
        !generatedApiCsrfContract.protectedMethods.includes(
          operation.method as (typeof generatedApiCsrfContract.protectedMethods)[number]
        )
      )
      .map(([operationId]) => operationId);

    expect(generatedApiCsrfContract).toMatchObject({
      schemaVersion: "stage0.rev2.generated-api-csrf-contract",
      blueprintSource: "Docs/stage0_blueprint_rev2.md",
      generatedClient: "web/lib/generated/zenart-api.ts",
      requestSecurityContract: "web/lib/request-security.ts",
      credentialMode: defaultSameSiteCsrfContract.credentialMode,
      csrfHeaderName: defaultSameSiteCsrfContract.headerName,
      csrfHeaderValue: defaultSameSiteCsrfContract.headerValue,
      sameSiteRequirement: defaultSameSiteCsrfContract.sameSiteRequired,
      originPolicy: defaultSameSiteCsrfContract.originPolicy,
      protectedMethods: defaultSameSiteCsrfContract.protectedMethods,
      status: requestContractEvidence.status,
      safeOperationCount: requestContractEvidence.safeOperationCount,
      missingUnsafeOperationCount: requestContractEvidence.missingUnsafeOperationIds.length,
      failureCount: requestContractEvidence.failureReasons.length,
      unsafeRequestContracts: requestContractEvidence.unsafeRequestContracts
    });
    expect(routeSmokeEvidence).toMatchObject({
      route: "/account",
      source: "web/validation/generated-api-csrf-contract.json",
      generatedClient: "web/lib/generated/zenart-api.ts",
      requestSecurityContract: "web/lib/request-security.ts",
      browserSmoke: "web/tests/session-security.spec.ts",
      browserSmokeScript: "npm run smoke:session-security-playwright",
      expectedStatus: "pass",
      credentialMode: generatedApiCsrfContract.credentialMode,
      csrfHeaderName: generatedApiCsrfContract.csrfHeaderName,
      csrfHeaderValue: generatedApiCsrfContract.csrfHeaderValue,
      sameSiteRequirement: generatedApiCsrfContract.sameSiteRequirement,
      originPolicy: generatedApiCsrfContract.originPolicy,
      unsafeOperationCount: generatedApiCsrfContract.unsafeOperationCount,
      safeOperationCount: generatedApiCsrfContract.safeOperationCount,
      missingUnsafeOperationCount: 0,
      failureCount: 0,
      requiredAttributes: expect.arrayContaining([
        "data-generated-api-csrf-status",
        "data-generated-api-csrf-credential-mode",
        "data-generated-api-csrf-header",
        "data-generated-api-csrf-unsafe-operations",
        "data-generated-api-csrf-safe-operations",
        "data-generated-api-csrf-idempotency-required-operations",
        "data-generated-api-csrf-idempotency-exempt-operations",
        "data-generated-api-csrf-operation-contracts"
      ])
    });
    expect(routeSmokeEvidence.browserSmokeRequiredAssertions).toEqual(generatedApiCsrfContract.browserSmoke.requiredAssertions);
    expect(generatedApiCsrfContract.browserSmoke.expectedUnsafeRequestContracts).toEqual(
      generatedApiCsrfContract.unsafeRequestContracts.map((contract) => {
        const idempotencyKey = contract.idempotencyHeaderRequired ? `csrf-probe-${contract.operationId}` : "not-required";
        return `${contract.operationId}:${contract.method}:${contract.credentials}:${contract.csrfHeaderValue}:${idempotencyKey}`;
      })
    );
    expect(routeSmokeEvidence.browserSmokeExpectedUnsafeRequestContracts).toEqual(
      generatedApiCsrfContract.browserSmoke.expectedUnsafeRequestContracts
    );
    expect(generatedApiCsrfContract.browserSmoke.expectedSafeRequestContracts).toEqual(
      safeOperations.map((operationId) => {
        const operation = apiOperations[operationId as OperationId];
        return `${operationId}:${operation.method}:${generatedApiCsrfContract.credentialMode}:not-required`;
      })
    );
    expect(routeSmokeEvidence.browserSmokeExpectedSafeRequestContracts).toEqual(
      generatedApiCsrfContract.browserSmoke.expectedSafeRequestContracts
    );
    expect(generatedApiCsrfContract.unsafeOperationCount).toBe(unsafeOperations.length);
    expect(generatedApiCsrfContract.safeOperationCount).toBe(safeOperations.length);
    expect(requestContractEvidence.unsafeOperationIds).toEqual(unsafeOperations);
    expect(requestContractEvidence.safeOperationIds).toEqual(safeOperations);
    expect(requestContractEvidence.unsafeIdempotencyRequiredOperationIds).toEqual(
      generatedApiCsrfContract.unsafeRequestContracts
        .filter((contract) => contract.idempotencyHeaderRequired)
        .map((contract) => contract.operationId)
    );
    expect(requestContractEvidence.unsafeIdempotencyExemptOperationIds).toEqual(["deleteSession"]);
    expect(generatedApiCsrfContract.unsafeOperations).toEqual(unsafeOperations);
    expect(generatedApiCsrfContract.safeOperations).toEqual(safeOperations);
  });

  it("rejects cross-origin API bases before same-site credentialed requests can be made", () => {
    expect(() => new ZenArtApiClient("https://api.example.invalid")).toThrow(
      "ZenArtApiClient baseUrl must be same-origin for same-site CSRF protection"
    );
    expect(() => new ZenArtApiClient("//api.example.invalid")).toThrow(
      "ZenArtApiClient baseUrl must not be protocol-relative for same-site CSRF protection"
    );
  });

  it("rejects absolute API bases when a browser origin is unavailable", () => {
    const originalWindow = globalThis.window;

    try {
      vi.stubGlobal("window", undefined);

      expect(() => new ZenArtApiClient("https://app.example.invalid/api")).toThrow(
        "ZenArtApiClient absolute baseUrl requires a browser origin for same-site CSRF protection"
      );
      expect(() => new ZenArtApiClient("/api")).not.toThrow();
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });

  it("allows browser absolute API bases only when they match the current origin", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "session-001" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new ZenArtApiClient(window.location.origin);

    await client.request("getSession");

    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/session`,
      expect.objectContaining({
        method: "GET",
        credentials: defaultSameSiteCsrfContract.credentialMode
      })
    );
  });

  it("rejects credentialed or decorated absolute API bases before same-site requests can be made", () => {
    const currentUrl = new URL(window.location.origin);
    const sameOriginWithCredentials = `${currentUrl.protocol}//user:pass@${currentUrl.host}`;

    expect(() => new ZenArtApiClient(sameOriginWithCredentials)).toThrow(
      "ZenArtApiClient baseUrl must not include credentials for same-site CSRF protection"
    );
    expect(() => new ZenArtApiClient(`${window.location.origin}/api?token=secret`)).toThrow(
      "ZenArtApiClient baseUrl must not include query or fragment material for same-site CSRF protection"
    );
    expect(() => new ZenArtApiClient(`${window.location.origin}/api#csrf`)).toThrow(
      "ZenArtApiClient baseUrl must not include query or fragment material for same-site CSRF protection"
    );
  });

  it("records absolute base hardening in the generated CSRF evidence artifact", () => {
    expect(generatedApiCsrfContract.absoluteBaseUrlGuard).toMatchObject({
      schemaVersion: "stage0.rev2.generated-api-same-origin-base-guard",
      status: "pass",
      sameOriginAllowed: true,
      protocolRelativeRejected: true,
      crossOriginRejected: true,
      serverSideAbsoluteRejected: true,
      credentialMaterialRejected: true,
      queryMaterialRejected: true,
      fragmentMaterialRejected: true,
      failureCount: 0
    });
    expect(generatedApiCsrfContract.assertions).toEqual(
      expect.arrayContaining([
        "Generated web API client rejects credential-bearing absolute base URLs before same-site credentialed requests.",
        "Generated web API client rejects query or fragment-bearing absolute base URLs before same-site credentialed requests."
      ])
    );
    expect(generatedApiCsrfContract.absoluteBaseUrlGuard.rejectedExamples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scenario: "credential-material", outcome: "reject-before-fetch" }),
        expect.objectContaining({ scenario: "query-material", outcome: "reject-before-fetch" }),
        expect.objectContaining({ scenario: "fragment-material", outcome: "reject-before-fetch" })
      ])
    );
  });

  it("keeps slash-relative API bases same-origin without serializing an absolute origin", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "session-001" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new ZenArtApiClient("/api");

    await client.request("getProject", {
      pathParams: { project_id: "project-001" },
      query: { include_archived: false }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project-001?include_archived=false",
      expect.objectContaining({
        method: "GET",
        credentials: defaultSameSiteCsrfContract.credentialMode
      })
    );
  });

  it("rejects path parameters that could escape generated API route templates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    const client = new ZenArtApiClient();

    await expect(
      client.request("getProject", {
        pathParams: { project_id: "../admin/secrets" }
      })
    ).rejects.toThrow("Unsafe path parameter: project_id");
    await expect(
      client.request("getExport", {
        pathParams: { export_id: "https://evil.example/export-001" }
      })
    ).rejects.toThrow("Unsafe path parameter: export_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

const buildPathParams = (pathTemplate: string) =>
  Object.fromEntries(Array.from(pathTemplate.matchAll(/\{([^}]+)\}/g)).map(([, key]) => [key, `${key}-001`]));

const generatedApiCsrfContractFromRouteSmoke = () => {
  const routeSmoke = generatedApiCsrfContract as unknown as {
    schemaVersion: string;
  };
  expect(routeSmoke.schemaVersion).toBe("stage0.rev2.generated-api-csrf-contract");

  const evidence = userRouteSmoke.securityEvidence.find(
    (entry) => entry.schemaVersion === "stage0.rev2.generated-api-csrf-contract"
  );
  expect(evidence).toBeDefined();
  return evidence!;
};
