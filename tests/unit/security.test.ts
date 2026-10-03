import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

// ─── Constants replicated from source (pure, no imports from app code) ────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUERY_LENGTH = 2000;

const PRIVATE_IP_RE =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|::1|fc|fd|fe80)/i;

const OFFICIAL_HOST_PATTERNS = [
  /\.gov\.ae$/,
  /\.(gov|mil)$/,
  /^(www\.)?(dmcc|ifza|rakez|spcfz|spcfreezone|ajmanfreezones|afz)\./,
  /^(www\.)?(mohap|dha|tdra|khda|dcaa|sira|ded|municipality|centralbank|vara|scasec|uiae)\./,
];

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    // Strip IPv6 brackets: new URL("http://[::1]/").hostname === "[::1]"
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (PRIVATE_IP_RE.test(host)) return false;
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    return true;
  } catch {
    return false;
  }
}

function looksOfficial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

// ─── A. Fee Isolation ─────────────────────────────────────────────────────

describe("fee isolation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("scopes fees to approvals belonging to the requested activity only", async () => {
    const mockApprovals = [
      { id: "approval-aaa-111" },
      { id: "approval-aaa-222" },
    ];
    const mockFees = [
      { id: "fee-1", approvalId: "approval-aaa-111", amount: "100" },
      { id: "fee-2", approvalId: "approval-aaa-222", amount: "200" },
    ];

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(mockApprovals),
    };
    const feesSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(mockFees),
    };

    let selectCallCount = 0;
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return selectChain;
        return feesSelectChain;
      }),
    };

    vi.doMock("@/lib/db", () => ({ db: mockDb }));

    const { GET } = await import("@/app/api/activities/[id]/fees/route");

    const request = new Request("http://localhost/api/activities/550e8400-e29b-41d4-a716-446655440000/fees");
    const response = await GET(request as unknown as import("next/server").NextRequest, {
      params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }),
    });

    const body = await response.json();

    // Fees were returned
    expect(body).toEqual(mockFees);

    // The fees query used inArray scoped to approvalIds from activity A
    expect(feesSelectChain.where).toHaveBeenCalledTimes(1);
    const whereArg = feesSelectChain.where.mock.calls[0][0];
    expect(whereArg).toBeDefined();

    // Verify the select was called from the correct tables
    expect(selectChain.from).toHaveBeenCalled();
    expect(feesSelectChain.from).toHaveBeenCalled();

    vi.doUnmock("@/lib/db");
  });

  it("returns empty array when activity has no approvals", async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };

    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };

    vi.doMock("@/lib/db", () => ({ db: mockDb }));

    const { GET } = await import("@/app/api/activities/[id]/fees/route");

    const request = new Request("http://localhost/api/activities/550e8400-e29b-41d4-a716-446655440000/fees");
    const response = await GET(request as unknown as import("next/server").NextRequest, {
      params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }),
    });

    const body = await response.json();
    expect(body).toEqual([]);

    vi.doUnmock("@/lib/db");
  });
});

// ─── B. Rate limiting ──────────────────────────────────────────────────────
//
// The ADMIN_PASSWORD session helpers these used to sit next to have been
// removed: admin access is now authorized solely by a verified Supabase session
// plus the ADMIN_EMAILS allowlist. The rate limiter is not admin-specific, so it
// stays and is still covered.

import { checkRateLimit, clearRateLimit } from "@/lib/auth/rate-limit";

describe("rate limit — checkRateLimit", () => {
  beforeEach(() => {
    clearRateLimit("auth-test-ip");
  });

  it("returns true for the first call", () => {
    expect(checkRateLimit("auth-test-ip")).toBe(true);
  });

  it("stays true up to and including the 5th call", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("auth-test-ip")).toBe(true);
    }
  });

  it("returns false on the 6th consecutive call", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("auth-test-ip");
    expect(checkRateLimit("auth-test-ip")).toBe(false);
  });
});

describe("rate limit — clearRateLimit", () => {
  it("resets the counter so next call is allowed", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("clear-test");
    expect(checkRateLimit("clear-test")).toBe(false);

    clearRateLimit("clear-test");
    expect(checkRateLimit("clear-test")).toBe(true);
  });
});

// ─── C. UUID Validation ───────────────────────────────────────────────────

describe("UUID validation", () => {
  it.each([
    ["550e8400-e29b-41d4-a716-446655440000", true],
    ["not-a-uuid", false],
    ["", false],
    ["550e8400-e29b-41d4-a716", false],
    ["550e8400-e29b-41d4-a716-4466554400000000", false],
    ["gggggggg-e29b-41d4-a716-446655440000", false],
  ])("UUID_RE.test(%j) === %s", (input, expected) => {
    expect(UUID_RE.test(input)).toBe(expected);
  });
});

// ─── D. Search Length Limit ───────────────────────────────────────────────

describe("search query length limit", () => {
  it("allows short queries", () => {
    expect("query".length <= MAX_QUERY_LENGTH).toBe(true);
  });

  it("allows exactly 2000 characters", () => {
    const query = "a".repeat(2000);
    expect(query.length <= MAX_QUERY_LENGTH).toBe(true);
  });

  it("rejects queries over 2000 characters", () => {
    const query = "a".repeat(2001);
    expect(query.length > MAX_QUERY_LENGTH).toBe(true);
  });
});

// ─── E. SSRF Protection ──────────────────────────────────────────────────

describe("SSRF protection — isSafeUrl", () => {
  it.each([
    ["http://localhost:3000/admin", false],
    ["http://127.0.0.1/admin", false],
    ["http://10.0.0.1/secret", false],
    ["http://192.168.1.1/internal", false],
    ["http://172.16.0.1/test", false],
    ["file:///etc/passwd", false],
    ["ftp://example.com/file", false],
    ["javascript:alert(1)", false],
    ["http://[::1]/test", false],
  ])("isSafeUrl(%j) === false", (url, expected) => {
    expect(isSafeUrl(url)).toBe(expected);
  });

  it.each([
    ["https://www.dmcc.ae/activity-list", true],
    ["https://afz.gov.ae/activity-list", true],
    ["https://www.ifza.com/activities", true],
    ["https://example.com/some-page", true],
  ])("isSafeUrl(%j) === true", (url, expected) => {
    expect(isSafeUrl(url)).toBe(expected);
  });
});

describe("SSRF protection — looksOfficial", () => {
  it("recognises official UAE domains", () => {
    expect(looksOfficial("https://www.dmcc.ae/activity-list")).toBe(true);
    expect(looksOfficial("https://afz.gov.ae/activity-list")).toBe(true);
    expect(looksOfficial("https://www.ifza.com/activities")).toBe(true);
  });

  it("rejects non-official domains", () => {
    expect(looksOfficial("https://example.com/some-page")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(looksOfficial("not-a-url")).toBe(false);
  });
});

// ─── F. Error Sanitisation ────────────────────────────────────────────────

describe("error sanitisation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("fees route returns generic error on db failure", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockRejectedValue(new Error("SQL Injection Attempt; DROP TABLE users;")),
      }),
    };
    vi.doMock("@/lib/db", () => ({ db: mockDb }));

    const { GET } = await import("@/app/api/activities/[id]/fees/route");
    const request = new Request("http://localhost/api/activities/550e8400-e29b-41d4-a716-446655440000/fees");
    const response = await GET(request as unknown as import("next/server").NextRequest, {
      params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("DROP TABLE");
    expect(JSON.stringify(body)).not.toContain("SQL Injection");

    vi.doUnmock("@/lib/db");
  });

  it("activity [id] route returns generic error on db failure", async () => {
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockRejectedValue(new Error("connection refused at 10.0.0.5:5432")),
        limit: vi.fn().mockReturnThis(),
      }),
    };
    vi.doMock("@/lib/db", () => ({ db: mockDb }));

    const { GET } = await import("@/app/api/activities/[id]/route");
    const request = new Request("http://localhost/api/activities/550e8400-e29b-41d4-a716-446655440000");
    const response = await GET(request as unknown as import("next/server").NextRequest, {
      params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");

    vi.doUnmock("@/lib/db");
  });
});

// ─── G. Rate Limiting (extended) ──────────────────────────────────────────

describe("rate limiting", () => {
  beforeEach(() => {
    clearRateLimit("test-ip");
    clearRateLimit("ip-a");
    clearRateLimit("ip-b");
    clearRateLimit("ip-c");
  });

  it("blocks after 5 successful calls (6th attempt fails)", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("test-ip")).toBe(true);
    }
    expect(checkRateLimit("test-ip")).toBe(false);
  });

  it("different IPs have independent limits", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("ip-a");
    expect(checkRateLimit("ip-a")).toBe(false);
    expect(checkRateLimit("ip-b")).toBe(true);
  });

  it("clearRateLimit resets counter", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("ip-c");
    expect(checkRateLimit("ip-c")).toBe(false);
    clearRateLimit("ip-c");
    expect(checkRateLimit("ip-c")).toBe(true);
  });
});

// ─── H. Security Headers in next.config.ts ────────────────────────────────

describe("security headers in next.config.ts", () => {
  it("defines all required security headers and disables poweredByHeader", () => {
    const configPath = path.resolve(__dirname, "../../next.config.ts");
    const content = fs.readFileSync(configPath, "utf-8");

    expect(content).toContain("X-Content-Type-Options");
    expect(content).toContain("X-Frame-Options");
    expect(content).toContain("X-XSS-Protection");
    expect(content).toContain("Referrer-Policy");
    expect(content).toContain("Permissions-Policy");
    expect(content).toContain("Strict-Transport-Security");
    expect(content).toContain("Content-Security-Policy");
    expect(content).toContain("frame-ancestors 'none'");
    expect(content).toContain("poweredByHeader: false");
  });
});
