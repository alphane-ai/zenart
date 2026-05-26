import { afterEach, describe, expect, it, vi } from "vitest";
import { ZenArtApiClient } from "./zenart-api";

describe("generated web API client CSRF contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends same-site credentials and CSRF header on state-changing requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
});
