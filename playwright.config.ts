import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E configuration.
 *
 * SAFETY (important):
 *  - E2E must NEVER connect to the production Neon database.
 *  - The suite runs against an app instance identified by E2E_BASE_URL.
 *  - By default E2E is blocked when the locally-configured DATABASE_URL points
 *    to a remote/production-like host. To run safely you MUST point the app
 *    at a LOCAL / SANDBOX PostgreSQL (see e2e/README.md).
 *  - This suite is intentionally NOT part of the default CI pipeline (CI runs
 *    only unit/API tests which are DB-free).
 */
import path from "node:path";

const E2E_BASE_URL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";

// ── Safety guard: refuse to run against a production-like DB host ─────────
const LOCAL_HOST_RE =
  /^(localhost|127(\.\d{1,3}){3}|::1|0\.0\.0\.0|\[::1\])$/i;

function dbHostCategory(): string {
  const url = process.env.DATABASE_URL ?? "";
  try {
    const host = new URL(url).hostname;
    return host && LOCAL_HOST_RE.test(host) ? "local" : "remote";
  } catch {
    return "remote";
  }
}

// (The guard also runs in the global setup; this is an early, visible check.)
const allowRemoteExplicit = process.env.E2E_ALLOW_REMOTE === "1";
if (dbHostCategory() !== "local" && !allowRemoteExplicit) {
  throw new Error(
    "[playwright] Refusing to run E2E: DATABASE_URL points to a remote " +
      "(production-like) host. Point the app at a LOCAL/SANDBOX PostgreSQL and " +
      "set E2E_BASE_URL, or set E2E_ALLOW_REMOTE=1 explicitly (not recommended). " +
      "See e2e/README.md."
  );
}

export default defineConfig({
  testDir: path.join(__dirname, "e2e"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "smoke",
      testMatch: /e2e\/smoke\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "db-backed",
      testMatch: /e2e\/db-backed\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
