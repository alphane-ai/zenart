import { describe, expect, it } from "vitest";
import { buildCsrfRequestHeaders, defaultSameSiteCsrfContract, isCsrfProtectedMethod } from "./request-security";

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
});
