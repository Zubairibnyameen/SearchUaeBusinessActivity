import { test, expect } from "@playwright/test";

/**
 * DB-INDEPENDENT smoke tests.
 *
 * These assert structural/rendering behaviour that holds regardless of the
 * amount of data in the (local/sandbox) database. They must never be run
 * against the production Neon database — see e2e/README.md.
 */

test.describe("public smoke", () => {
  test("homepage renders", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /Search UAE Business Activities/i })
    ).toBeVisible();
  });

  test("hero search exists", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('#activity-search[role="search"], form[role="search"]').first()).toBeVisible();
    await expect(page.locator("#activity-search")).toBeVisible();
  });

  test("search can be submitted", async ({ page }) => {
    await page.goto("/");
    const input = page.locator("#activity-search");
    await input.fill("restaurant");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=restaurant/);
  });

  test("search results page renders", async ({ page }) => {
    const response = await page.goto("/search?q=restaurant");
    expect(response?.status()).toBe(200);
    await expect(page.locator("#activity-search")).toBeVisible();
  });

  test("jurisdiction index page renders", async ({ page }) => {
    const response = await page.goto("/jurisdictions");
    expect(response?.status()).toBe(200);
    await expect(page).not.toHaveURL(/page-not-found/);
  });

  test("compare page renders", async ({ page }) => {
    const response = await page.goto("/compare");
    expect(response?.status()).toBe(200);
  });

  test("login page renders", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBe(200);
  });

  test("invalid public route produces 404", async ({ page }) => {
    const response = await page.goto("/path-that-does-not-exist-zzz");
    expect(response?.status()).toBe(404);
  });
});
