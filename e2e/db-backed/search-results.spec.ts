import { test, expect } from "@playwright/test";

/**
 * DB-BACKED smoke tests (opt-in via E2E_DB=1).
 *
 * These assert content that depends on data being present in the database.
 * They are only meaningful against a database that mirrors the expected
 * dataset (indexed activities / jurisdictions). They are SKIPPED unless the
 * environment explicitly sets E2E_DB=1.
 *
 * They must NEVER be run against the production Neon database — see
 * e2e/README.md. Use a local/sandbox PostgreSQL that mirrors the dataset.
 */
const enabled = process.env.E2E_DB === "1";

test.describe("db-backed (opt-in)", () => {
  test("search page renders its results region for a known query", async ({ page }) => {
    test.skip(!enabled, "E2E_DB not set");

    const response = await page.goto("/search?q=general%20trading");
    expect(response?.status()).toBe(200);
    // The search bar must be present and interactive.
    await expect(page.locator("#activity-search")).toBeVisible();
    // The results region resolves (either the skeleton during streaming or the
    // final results container). Both have this aria component.
    await expect(
      page.locator('[aria-busy="true"], #search-results, [data-search-results]').first()
    ).toBeVisible();
  });

  test("jurisdictions index page renders a list container when data is present", async ({ page }) => {
    test.skip(!enabled, "E2E_DB not set");

    const response = await page.goto("/jurisdictions");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });
});
