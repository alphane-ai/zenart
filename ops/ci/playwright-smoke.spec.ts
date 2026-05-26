import { expect, test } from "@playwright/test";

const webURL = process.env.WEB_URL ?? "http://localhost:3000";
const adminURL = process.env.ADMIN_URL ?? "http://localhost:3001";

test("web workspace shell renders", async ({ page }) => {
  const response = await page.goto(webURL, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `GET ${webURL}`).toBeLessThan(400);
  await expect(page.getByRole("main").or(page.locator("body"))).toBeVisible();
  await expect(page.getByText(/package|export|workspace|candidate/i).first()).toBeVisible();
});

test("admin operations shell renders", async ({ page }) => {
  const response = await page.goto(adminURL, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `GET ${adminURL}`).toBeLessThan(400);
  await expect(page.getByText(/admin|operations|review/i).first()).toBeVisible();
});
