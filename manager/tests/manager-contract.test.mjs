import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function assertContains(source, tokens) {
  for (const token of tokens) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

test("manager metadata and package identity are Zenari scoped", () => {
  assert.equal(packageJson.name, "@zenari/manager");
  assert.equal(packageJson.scripts.dev, "next dev --port 26082");
  assert.equal(packageJson.scripts.test, "node --test tests/*.test.mjs");
  assertContains(layout, ["zenari.ai Manager", "zenari.ai manager console"]);
});

test("manager exposes the registered local dev port map", () => {
  assertContains(page, [
    'data-manager-endpoint={endpoint.id}',
    'data-manager-port={endpoint.port}',
    'id: "backend-api"',
    'port: "31080"',
    'id: "user-web"',
    'port: "26080"',
    'id: "admin-web"',
    'port: "26081"',
    'id: "manager-web"',
    'port: "26082"',
    "26432 PostgreSQL",
    "26379 Redis",
    "26900/26901 MinIO",
    "31990-31992 metrics"
  ]);
});

test("manager links the core Stage 1 operator workflows", () => {
  assertContains(page, [
    'data-manager-workflow={workflow.id}',
    'id: "subscription-ops"',
    "Plans, team seats, quota ledger, Stripe lifecycle evidence, invoice visibility",
    'href: `${adminUrl}/quota`',
    'id: "provider-registry"',
    "Provider health, model capabilities, secret references, kill switch, test calls",
    'id: "strategy-groups"',
    "Tenant plan routing, cost weights, canary, fallback, provider/model concurrency",
    'id: "batch-queues"',
    "Batch fan-out, child tasks, retries, dead letters, cancellation and refunds",
    'id: "release-readiness"',
    "Stage 1 staging runtime, production launch, CI evidence, strict validators",
    'id: "user-workspace"'
  ]);
});

test("manager preserves launch evidence boundaries", () => {
  assertContains(page, [
    'data-manager-boundary={row.id}',
    'id: "local-dev-ports"',
    'id: "brand-surface"',
    'id: "launch-gate"',
    "Local-devport evidence cannot clear staging or production gates"
  ]);
});
