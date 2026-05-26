import { SessionContract } from "./contracts";

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
