import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSameSiteCsrfContract } from "../request-security";
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
});

const buildPathParams = (pathTemplate: string) =>
  Object.fromEntries(Array.from(pathTemplate.matchAll(/\{([^}]+)\}/g)).map(([, key]) => [key, `${key}-001`]));
