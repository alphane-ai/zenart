import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const data = readFileSync(new URL("../lib/manager-data.ts", import.meta.url), "utf8");

test("manager console exposes four local surfaces", () => {
  for (const token of [
    "Backend API",
    "User Web",
    "Admin Console",
    "Manager Console",
    "http://127.0.0.1:31080",
    "http://127.0.0.1:26080",
    "http://127.0.0.1:26081",
    "http://127.0.0.1:26082"
  ]) {
    assert.match(data, new RegExp(token.replaceAll(".", "\\.")));
  }
});

test("manager console states master and worker DAG responsibilities", () => {
  for (const token of [
    "Worker",
    "provisional",
    "master",
    "dependency-ready integration frontier",
    "Delivery Lanes",
    "Release Gates"
  ]) {
    assert.match(page, new RegExp(token));
  }
});
