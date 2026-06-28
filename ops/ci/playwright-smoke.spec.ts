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

test("billing smoke validates quota, invoices, team seats, and checkout guards", async ({ page }) => {
  const billingURL = `${webURL}/billing`;
  const response = await page.goto(billingURL, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `GET ${billingURL}`).toBeLessThan(400);

  await expect(page.getByRole("heading", { name: "Billing and Quota" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Billing quota used" })).toBeVisible();
});

test("workspace smoke validates core workspace shell", async ({ page }) => {
  const workspaceURL = `${webURL}/workspace`;
  const response = await page.goto(workspaceURL, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `GET ${workspaceURL}`).toBeLessThan(400);

  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();
});
