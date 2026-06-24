import { expect, test } from "@playwright/test";

const webPort = process.env.WEB_PLAYWRIGHT_PORT ?? "26080";
const adminPort = process.env.ADMIN_PLAYWRIGHT_PORT ?? "26081";
const webURL = process.env.WEB_URL ?? `http://127.0.0.1:${webPort}`;
const adminURL = process.env.ADMIN_URL ?? `http://127.0.0.1:${adminPort}`;

test("web workspace shell renders", async ({ page }) => {
  const response = await page.goto(webURL, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `GET ${webURL}`).toBeLessThan(400);
  await expect(page.locator("body")).toBeVisible();
  await expect(page.getByText(/package|export|workspace|candidate/i).first()).toBeVisible();
});

test("admin operations shell renders", async ({ page }) => {
  const response = await page.goto(adminURL, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `GET ${adminURL}`).toBeLessThan(400);
  await expect(page.getByText(/admin|operations|review/i).first()).toBeVisible();
});
