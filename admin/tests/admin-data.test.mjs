import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fixtures = readFileSync(new URL("../lib/fixtures.ts", import.meta.url), "utf8");
const routes = [
  "skills",
  "skills/releases",
  "crawler",
  "prompt-fragments",
  "meta-prompts",
  "traces",
  "feedback",
  "providers",
  "queues",
  "exports",
  "exports/[id]",
  "support",
  "quota",
  "safety",
  "abuse",
  "audit"
];

test("admin fixtures cover required operational surfaces", () => {
  for (const token of [
    "export const skills",
    "export const skillVersions",
    "export const crawlerFindings",
    "export const promptFragments",
    "export const metaPrompts",
    "export const traces",
    "export const feedbackItems",
    "export const providerHealth",
    "export const queueHealth",
    "export const exportJobs",
    "export const supportUsers",
    "export const quotaAccounts",
    "export const riskyExports",
    "export const abuseEvents",
    "export const auditEvents"
  ]) {
    assert.match(fixtures, new RegExp(token.replaceAll(" ", "\\s+")));
  }
});

test("admin app exposes a route for every stage 0 admin surface", () => {
  for (const route of routes) {
    const page = readFileSync(
      new URL(`../app/${route}/page.tsx`, import.meta.url),
      "utf8"
    );
    assert.match(page, /PageHeader/);
  }
});
