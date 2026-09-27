import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const mockMigrationClient = vi.fn();

vi.mock("@/lib/db", () => ({
  get migrationClient() {
    return mockMigrationClient;
  },
}));

describe("GET /api/ready", () => {
  let GET: () => Promise<Response>;

  beforeAll(async () => {
    ({ GET } = await import("@/app/api/ready/route"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // Restore the mock env presence so env validation passes.
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test_db";
    process.env.ADMIN_PASSWORD = "test-password-123";
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-key-for-testing-only";
  });

  it("returns 200 status ok when database is reachable", async () => {
    mockMigrationClient.mockResolvedValue([{ ok: 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("returns 503 unavailable when the database is unreachable", async () => {
    mockMigrationClient.mockRejectedValue(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ status: "unavailable" });
  });

  it("returns 503 when required env is missing without leaking values", async () => {
    process.env.DATABASE_URL = "";
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("postgres");
  });

  it("does not leak DB host, credentials, SQL or stack traces on failure", async () => {
    mockMigrationClient.mockRejectedValue(
      new Error("connect to postgresql://user:hunter2@db.internal.example:5432/x failed")
    );
    const res = await GET();
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("hunter2");
    expect(body).not.toContain("db.internal");
    expect(body).not.toContain("postgres");
    expect(body).not.toMatch(/stack/i);
  });
});
