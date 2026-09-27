import { describe, it, expect, beforeAll } from "vitest";

describe("GET /api/health", () => {
  let GET: () => Promise<Response>;

  beforeAll(async () => {
    ({ GET } = await import("@/app/api/health/route"));
  });

  it("returns 200 with status ok", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("does not leak internals, credentials or paths", async () => {
    const res = await GET();
    const body = JSON.stringify(await res.json());
    expect(body).not.toMatch(/stack|error|node_modules|src\//i);
    expect(body).not.toContain("postgres");
  });
});
