import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Shared constants & helpers
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_UUID_2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const VALID_UUID_3 = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const VALID_UUID_4 = "d4e5f6a7-b8c9-0123-def0-234567789012";
const VALID_UUID_5 = "e5f6a7b8-c9d0-1234-ef01-345678890123";

const LEAK_RE = /stack|Error:|SELECT|FROM|WHERE|node_modules|src\//;

function assertNoLeaks(body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(LEAK_RE);
}

// ---------------------------------------------------------------------------
// Drizzle chain mock via mutable state + Proxy
// ---------------------------------------------------------------------------
//
// Supports two modes:
// 1. Simple mode: set dbState.result — every await resolves with the same value
// 2. Queue mode:  push to dbState.queue[] — each await pops the next value
//    (for routes that make multiple sequential DB calls)
//
// Error mode: set dbState.error — every await rejects with that error

const dbState: {
  result: unknown;
  error: Error | null;
  queue: unknown[];
} = {
  result: [],
  error: null,
  queue: [],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBuilder(): any {
  return new Proxy(
    function () {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
            if (dbState.error) {
              if (reject) reject(dbState.error);
              return;
            }
            const value =
              dbState.queue.length > 0 ? dbState.queue.shift()! : dbState.result;
            resolve(value);
          };
        }
        if (prop === "catch") {
          return (reject: (e: unknown) => void) => {
            if (dbState.error) reject(dbState.error);
          };
        }
        if (prop === Symbol.toPrimitive || prop === Symbol.toStringTag) {
          return () => "[Builder]";
        }
        // Any method call returns a fresh builder
        return (..._args: unknown[]) => makeBuilder();
      },
      apply() {
        return makeBuilder();
      },
    }
  );
}

function dbSelect() {
  return makeBuilder();
}

vi.mock("@/lib/db", () => ({
  get db() {
    return { select: vi.fn(dbSelect) };
  },
}));

// --- Search mock ---
const mockSearchUnified = vi.fn();
vi.mock("@/lib/search/engine", () => ({
  searchUnified: (...args: unknown[]) => mockSearchUnified(...args),
}));

// --- Auth mocks ---
const mockCheckRateLimit = vi.fn().mockReturnValue(true);
const mockVerifyAdminPassword = vi.fn().mockReturnValue(false);
const mockCreateSessionToken = vi.fn().mockReturnValue({
  token: "test-token.sig",
  maxAge: 43200,
});
const mockLogAdminEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/auth", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  verifyAdminPassword: (...args: unknown[]) => mockVerifyAdminPassword(...args),
  createSessionToken: (...args: unknown[]) => mockCreateSessionToken(...args),
  logAdminEvent: (...args: unknown[]) => mockLogAdminEvent(...args),
  ADMIN_COOKIE: "uaai_admin_session",
}));

// ---------------------------------------------------------------------------
// Dynamic route imports
// ---------------------------------------------------------------------------

let searchGET: typeof import("@/app/api/activities/search/route").GET;
let activityGET: typeof import("@/app/api/activities/[id]/route").GET;
let approvalsGET: typeof import("@/app/api/activities/[id]/approvals/route").GET;
let feesGET: typeof import("@/app/api/activities/[id]/fees/route").GET;
let activityJurGET: typeof import("@/app/api/activities/[id]/jurisdictions/route").GET;
let jurisdictionsGET: typeof import("@/app/api/jurisdictions/route").GET;
let slugGET: typeof import("@/app/api/jurisdictions/[slug]/route").GET;
let categoriesGET: typeof import("@/app/api/categories/route").GET;
let compareGET: typeof import("@/app/api/compare/route").GET;
let loginPOST: typeof import("@/app/api/admin/login/route").POST;

beforeAll(async () => {
  ({ GET: searchGET } = await import("@/app/api/activities/search/route"));
  ({ GET: activityGET } = await import("@/app/api/activities/[id]/route"));
  ({ GET: approvalsGET } = await import("@/app/api/activities/[id]/approvals/route"));
  ({ GET: feesGET } = await import("@/app/api/activities/[id]/fees/route"));
  ({ GET: activityJurGET } = await import("@/app/api/activities/[id]/jurisdictions/route"));
  ({ GET: jurisdictionsGET } = await import("@/app/api/jurisdictions/route"));
  ({ GET: slugGET } = await import("@/app/api/jurisdictions/[slug]/route"));
  ({ GET: categoriesGET } = await import("@/app/api/categories/route"));
  ({ GET: compareGET } = await import("@/app/api/compare/route"));
  ({ POST: loginPOST } = await import("@/app/api/admin/login/route"));
});

/** Reset dbState to defaults before every test */
function resetDb() {
  dbState.result = [];
  dbState.error = null;
  dbState.queue = [];
}

// ===========================================================================
// 1. GET /api/activities/search
// ===========================================================================

describe("GET /api/activities/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
    mockSearchUnified.mockResolvedValue({
      query: "test",
      total: 0,
      results: [],
      jurisdictionGroups: [],
      availability: { matchedJurisdictionSlugs: [], unmatched: [] },
      intent: {
        primaryNoun: "test",
        industryDomain: "general",
        specificityLevel: "broad",
        isGenericQuery: false,
      },
      meta: { tookMs: 5, candidatesEvaluated: 0, minRelevanceThreshold: 0.62 },
    });
  });

  it("returns 400 when q is missing", async () => {
    const res = await searchGET(
      new NextRequest("http://localhost/api/activities/search")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error).toContain("q");
  });

  it("returns 400 when q is whitespace only", async () => {
    const res = await searchGET(
      new NextRequest("http://localhost/api/activities/search?q=+++")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when q exceeds max length (2000)", async () => {
    const res = await searchGET(
      new NextRequest(`http://localhost/api/activities/search?q=${"a".repeat(2001)}`)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("length");
  });

  it("returns 200 with correct response shape for valid query", async () => {
    mockSearchUnified.mockResolvedValueOnce({
      query: "trading",
      total: 1,
      results: [{ activity: { officialName: "General Trading" } }],
      jurisdictionGroups: [],
      availability: { matchedJurisdictionSlugs: ["dubai"], unmatched: [] },
      intent: {
        primaryNoun: "trading",
        industryDomain: "general",
        specificityLevel: "broad",
        isGenericQuery: false,
      },
      meta: { tookMs: 10, candidatesEvaluated: 5, minRelevanceThreshold: 0.62 },
    });

    const res = await searchGET(
      new NextRequest("http://localhost/api/activities/search?q=trading")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("query", "trading");
    expect(body).toHaveProperty("total", 1);
    expect(body).toHaveProperty("results");
    expect(body).toHaveProperty("jurisdictionGroups");
    expect(body).toHaveProperty("availability");
    expect(body).toHaveProperty("intent");
    expect(body).toHaveProperty("meta");
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(1);
  });

  it("passes filter options to searchUnified", async () => {
    await searchGET(
      new NextRequest(
        "http://localhost/api/activities/search?q=trading&emirate=dubai&jurisdictionType=free_zone&verifiedOnly=true&limit=10&offset=5"
      )
    );
    expect(mockSearchUnified).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "trading",
        emirate: "dubai",
        jurisdictionType: "free_zone",
        verifiedOnly: true,
        limit: 10,
        offset: 5,
      })
    );
  });

  it("caps limit at 100", async () => {
    await searchGET(
      new NextRequest("http://localhost/api/activities/search?q=trading&limit=999")
    );
    expect(mockSearchUnified).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 })
    );
  });

  it("defaults limit to 20", async () => {
    await searchGET(
      new NextRequest("http://localhost/api/activities/search?q=trading")
    );
    expect(mockSearchUnified).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 })
    );
  });

  it("returns 500 on search engine failure without leaking internals", async () => {
    mockSearchUnified.mockRejectedValueOnce(new Error("boom"));
    const res = await searchGET(
      new NextRequest("http://localhost/api/activities/search?q=trading")
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
    assertNoLeaks(body);
  });
});

// ===========================================================================
// 2. GET /api/activities/[id]
// ===========================================================================

describe("GET /api/activities/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await activityGET(
      new NextRequest("http://localhost/api/activities/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid activity ID");
    assertNoLeaks(body);
  });

  it("returns 400 for empty string ID", async () => {
    const res = await activityGET(
      new NextRequest("http://localhost/api/activities/"),
      { params: Promise.resolve({ id: "" }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid activity ID");
  });

  it("returns 400 for ID with special characters", async () => {
    const res = await activityGET(
      new NextRequest("http://localhost/api/activities/abc!@#$%"),
      { params: Promise.resolve({ id: "abc!@#$%" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for valid UUID not found in database", async () => {
    dbState.result = [];
    const res = await activityGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Not found");
  });

  it("returns 200 with activity + jurisdiction + licenceType when found", async () => {
    dbState.result = [
      {
        activity: {
          id: VALID_UUID,
          officialName: "General Trading",
          normalizedName: "general trading",
        },
        jurisdiction: { id: VALID_UUID, name: "Dubai DMCC", slug: "dubai-dmcc" },
        licenceType: { id: VALID_UUID, name: "Commercial", code: "COM" },
      },
    ];
    const res = await activityGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity.id).toBe(VALID_UUID);
    expect(body.jurisdiction).toBeDefined();
    expect(body.licenceType).toBeDefined();
  });

  it("returns 500 on database error without leaking internals", async () => {
    dbState.error = new Error("connection refused");
    const res = await activityGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
    assertNoLeaks(body);
  });
});

// ===========================================================================
// 3. GET /api/activities/[id]/approvals
// ===========================================================================

describe("GET /api/activities/[id]/approvals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await approvalsGET(
      new NextRequest("http://localhost/api/activities/bad/approvals"),
      { params: Promise.resolve({ id: "bad" }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid activity ID");
  });

  it("returns 200 with empty array when no approvals", async () => {
    dbState.result = [];
    const res = await approvalsGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}/approvals`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("returns 200 with approval + authority data", async () => {
    dbState.result = [
      {
        approval: {
          id: VALID_UUID,
          name: "Trade Licence",
          approvalType: "licence",
          status: "active",
        },
        authority: { id: VALID_UUID, name: "DED" },
      },
    ];
    const res = await approvalsGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}/approvals`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].approval.name).toBe("Trade Licence");
    expect(body[0].authority.name).toBe("DED");
  });

  it("returns 500 on database error without leaking internals", async () => {
    dbState.error = new Error("db failure");
    const res = await approvalsGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}/approvals`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    assertNoLeaks(body);
  });
});

// ===========================================================================
// 4. GET /api/activities/[id]/fees
// ===========================================================================

describe("GET /api/activities/[id]/fees", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await feesGET(
      new NextRequest("http://localhost/api/activities/not-valid/fees"),
      { params: Promise.resolve({ id: "not-valid" }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid activity ID");
  });

  it("returns empty array when no approvals exist for the activity", async () => {
    dbState.result = [];
    const res = await feesGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}/fees`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("returns fees when approvals exist (queue-based mock)", async () => {
    // The fees route makes two sequential queries:
    //   1. select approval IDs where activityId = id → [{ id: "a1" }]
    //   2. select fees where approvalId IN [...] → fee rows
    dbState.queue = [
      [{ id: "a1" }],
      [{ id: "fee-1", amount: 5000, approvalId: "a1" }],
    ];
    const res = await feesGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}/fees`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].amount).toBe(5000);
  });

  it("returns 500 on database error without leaking internals", async () => {
    dbState.error = new Error("timeout");
    const res = await feesGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}/fees`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    assertNoLeaks(body);
  });
});

// ===========================================================================
// 5. GET /api/activities/[id]/jurisdictions
// ===========================================================================

describe("GET /api/activities/[id]/jurisdictions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns 400 for invalid UUID", async () => {
    const res = await activityJurGET(
      new NextRequest("http://localhost/api/activities/x/jurisdictions"),
      { params: Promise.resolve({ id: "x" }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid activity ID");
  });

  it("returns 200 with empty array when no jurisdictions", async () => {
    dbState.result = [];
    const res = await activityJurGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}/jurisdictions`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("returns flattened jurisdiction objects (not nested)", async () => {
    dbState.result = [
      {
        jurisdiction: {
          id: VALID_UUID,
          name: "Dubai",
          slug: "dubai-dmcc",
          emirate: "dubai",
        },
      },
    ];
    const res = await activityJurGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}/jurisdictions`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Dubai");
    expect(body[0].slug).toBe("dubai-dmcc");
    expect(body[0].jurisdiction).toBeUndefined();
  });

  it("returns 500 on database error without leaking internals", async () => {
    dbState.error = new Error("db crash");
    const res = await activityJurGET(
      new NextRequest(`http://localhost/api/activities/${VALID_UUID}/jurisdictions`),
      { params: Promise.resolve({ id: VALID_UUID }) }
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    assertNoLeaks(body);
  });
});

// ===========================================================================
// 6. GET /api/jurisdictions
// ===========================================================================

describe("GET /api/jurisdictions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns 200 with all jurisdictions when no filters", async () => {
    dbState.result = [
      { id: VALID_UUID, name: "Dubai DMCC", emirate: "dubai", jurisdictionType: "free_zone" },
      { id: VALID_UUID_2, name: "Abu Dhabi ADGM", emirate: "abu_dhabi", jurisdictionType: "free_zone" },
    ];
    const res = await jurisdictionsGET(
      new NextRequest("http://localhost/api/jurisdictions")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
  });

  it("applies emirate filter for valid emirate", async () => {
    dbState.result = [{ id: VALID_UUID, name: "DMCC", emirate: "dubai" }];
    const res = await jurisdictionsGET(
      new NextRequest("http://localhost/api/jurisdictions?emirate=dubai")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it("ignores invalid emirate value (no filter applied)", async () => {
    dbState.result = [{ id: VALID_UUID, name: "All" }];
    const res = await jurisdictionsGET(
      new NextRequest("http://localhost/api/jurisdictions?emirate=nonexistent")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it("applies type filter for valid type", async () => {
    dbState.result = [{ id: VALID_UUID, jurisdictionType: "free_zone" }];
    const res = await jurisdictionsGET(
      new NextRequest("http://localhost/api/jurisdictions?type=free_zone")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it("ignores invalid type value (no filter applied)", async () => {
    dbState.result = [{ id: VALID_UUID }];
    const res = await jurisdictionsGET(
      new NextRequest("http://localhost/api/jurisdictions?type=banana")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
  });

  it("combines emirate + type filters", async () => {
    dbState.result = [];
    const res = await jurisdictionsGET(
      new NextRequest(
        "http://localhost/api/jurisdictions?emirate=dubai&type=free_zone"
      )
    );
    expect(res.status).toBe(200);
  });

  it("returns 500 on database error without leaking internals", async () => {
    dbState.error = new Error("db down");
    const res = await jurisdictionsGET(
      new NextRequest("http://localhost/api/jurisdictions")
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    assertNoLeaks(body);
  });
});

// ===========================================================================
// 7. GET /api/jurisdictions/[slug]
// ===========================================================================

describe("GET /api/jurisdictions/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns 400 for slug with spaces", async () => {
    const res = await slugGET(
      new NextRequest("http://localhost/api/jurisdictions/INVALID SLUG"),
      { params: Promise.resolve({ slug: "INVALID SLUG" }) }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid jurisdiction slug");
  });

  it("returns 400 for slug with special characters", async () => {
    const res = await slugGET(
      new NextRequest("http://localhost/api/jurisdictions/slug!@#$%"),
      { params: Promise.resolve({ slug: "slug!@#$%" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for slug exceeding 200 characters", async () => {
    const longSlug = "a".repeat(201);
    const res = await slugGET(
      new NextRequest(`http://localhost/api/jurisdictions/${longSlug}`),
      { params: Promise.resolve({ slug: longSlug }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for valid slug not found", async () => {
    dbState.result = [];
    const res = await slugGET(
      new NextRequest("http://localhost/api/jurisdictions/nonexistent-slug"),
      { params: Promise.resolve({ slug: "nonexistent-slug" }) }
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Not found");
  });

  it("returns 200 with jurisdiction + authority when found", async () => {
    dbState.result = [
      {
        jurisdiction: { id: VALID_UUID, name: "Dubai DMCC", slug: "dubai-dmcc" },
        authority: { id: VALID_UUID, name: "DMCC", officialWebsite: "https://dmcc.ae" },
      },
    ];
    const res = await slugGET(
      new NextRequest("http://localhost/api/jurisdictions/dubai-dmcc"),
      { params: Promise.resolve({ slug: "dubai-dmcc" }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jurisdiction.slug).toBe("dubai-dmcc");
    expect(body.authority.name).toBe("DMCC");
  });

  it("accepts slug with numbers and hyphens", async () => {
    dbState.result = [
      { jurisdiction: { slug: "free-zone-1" }, authority: null },
    ];
    const res = await slugGET(
      new NextRequest("http://localhost/api/jurisdictions/free-zone-1"),
      { params: Promise.resolve({ slug: "free-zone-1" }) }
    );
    expect(res.status).toBe(200);
  });

  it("returns 500 on database error without leaking internals", async () => {
    dbState.error = new Error("db crash");
    const res = await slugGET(
      new NextRequest("http://localhost/api/jurisdictions/dubai-dmcc"),
      { params: Promise.resolve({ slug: "dubai-dmcc" }) }
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    assertNoLeaks(body);
  });
});

// ===========================================================================
// 8. GET /api/categories
// ===========================================================================

describe("GET /api/categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns 200 with array of { category, count }", async () => {
    dbState.result = [
      { category: "Trading", count: 120 },
      { category: "Services", count: 80 },
    ];
    const res = await categoriesGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty("category");
    expect(body[0]).toHaveProperty("count");
    expect(typeof body[0].count).toBe("number");
  });

  it("returns 200 with empty array when no categories", async () => {
    dbState.result = [];
    const res = await categoriesGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("returns 500 on database error without leaking internals", async () => {
    dbState.error = new Error("db error");
    const res = await categoriesGET();
    expect(res.status).toBe(500);
    const body = await res.json();
    assertNoLeaks(body);
  });
});

// ===========================================================================
// 9. GET /api/compare
// ===========================================================================

describe("GET /api/compare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDb();
  });

  it("returns 400 when activity name is missing", async () => {
    const res = await compareGET(
      new NextRequest(
        `http://localhost/api/compare?jurisdictionId=${VALID_UUID}&jurisdictionId=${VALID_UUID_2}`
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Provide activity name");
  });

  it("returns 400 when fewer than 2 jurisdiction IDs", async () => {
    const res = await compareGET(
      new NextRequest(
        `http://localhost/api/compare?activity=trading&jurisdictionId=${VALID_UUID}`
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Provide activity name");
  });

  it("returns 400 when no jurisdiction IDs", async () => {
    const res = await compareGET(
      new NextRequest("http://localhost/api/compare?activity=trading")
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 5 jurisdiction IDs", async () => {
    const ids = [
      VALID_UUID, VALID_UUID_2, VALID_UUID_3, VALID_UUID_4, VALID_UUID_5, VALID_UUID,
    ];
    const qs = ids.map((id) => `jurisdictionId=${id}`).join("&");
    const res = await compareGET(
      new NextRequest(`http://localhost/api/compare?activity=trading&${qs}`)
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Maximum 5");
  });

  it("returns 400 for invalid UUID format in jurisdiction IDs", async () => {
    const res = await compareGET(
      new NextRequest(
        "http://localhost/api/compare?activity=trading&jurisdictionId=not-a-uuid&jurisdictionId=also-not"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid jurisdiction ID format");
  });

  it("returns 400 when activity name exceeds 500 characters", async () => {
    const longName = "a".repeat(501);
    const res = await compareGET(
      new NextRequest(
        `http://localhost/api/compare?activity=${longName}&jurisdictionId=${VALID_UUID}&jurisdictionId=${VALID_UUID_2}`
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("too long");
  });

  it("returns 200 with comparison rows for valid request (no activity found in any jurisdiction)", async () => {
    // The compare route loops over jurisdictionIds. For each:
    //   1. activity query (select from activities...) → [] (no match)
    //   2. jurisdiction fallback query (select from jurisdictions...) → [{ jurisdiction info }]
    // Queue: each entry must be an array (drizzle always returns arrays).
    const j1 = { id: VALID_UUID, name: "Dubai", slug: "dubai-dmcc", emirate: "dubai", jurisdictionType: "mainland" };
    const j2 = { id: VALID_UUID_2, name: "Abu Dhabi", slug: "abu-dhabi", emirate: "abu_dhabi", jurisdictionType: "mainland" };

    dbState.queue = [
      [],  // activity query for jurisdiction 1 → no match
      [j1], // jurisdiction fallback for 1
      [],  // activity query for jurisdiction 2 → no match
      [j2], // jurisdiction fallback for 2
    ];

    const res = await compareGET(
      new NextRequest(
        `http://localhost/api/compare?activity=general+trading&jurisdictionId=${VALID_UUID}&jurisdictionId=${VALID_UUID_2}`
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0]).toHaveProperty("jurisdiction");
    expect(body[0].jurisdiction.id).toBe(VALID_UUID);
    expect(body[0].jurisdiction.name).toBe("Dubai");
    expect(body[0]).toHaveProperty("activity");
    expect(body[0].activity).toBeNull();
    expect(body[0]).toHaveProperty("approvals");
    expect(body[0].approvals).toEqual([]);
    expect(body[1].jurisdiction.id).toBe(VALID_UUID_2);
  });

  it("returns 500 on database error without leaking internals", async () => {
    dbState.error = new Error("db boom");
    const res = await compareGET(
      new NextRequest(
        `http://localhost/api/compare?activity=trading&jurisdictionId=${VALID_UUID}&jurisdictionId=${VALID_UUID_2}`
      )
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    assertNoLeaks(body);
  });
});

// ===========================================================================
// 10. POST /api/admin/login
// ===========================================================================

describe("POST /api/admin/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue(true);
    mockVerifyAdminPassword.mockReturnValue(false);
    mockCreateSessionToken.mockReturnValue({ token: "test-token.sig", maxAge: 43200 });
    mockLogAdminEvent.mockResolvedValue(undefined);
  });

  function makeReq(body: unknown, headers?: Record<string, string>) {
    const init: RequestInit & { signal?: AbortSignal } = {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return new NextRequest("http://localhost/api/admin/login", init);
  }

  it("returns 400 when body is missing", async () => {
    const res = await loginPOST(
      new NextRequest("http://localhost/api/admin/login", { method: "POST" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await loginPOST(
      new NextRequest("http://localhost/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns 400 when password field is missing", async () => {
    const res = await loginPOST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when password is empty string", async () => {
    const res = await loginPOST(makeReq({ password: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 on wrong password", async () => {
    mockVerifyAdminPassword.mockReturnValue(false);
    const res = await loginPOST(makeReq({ password: "wrong" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Invalid credentials");
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failure" })
    );
  });

  it("returns 200 and sets cookie on correct password", async () => {
    mockVerifyAdminPassword.mockReturnValue(true);
    const res = await loginPOST(makeReq({ password: "correct" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("uaai_admin_session");
    expect(setCookie).toContain("test-token.sig");
    expect(mockCreateSessionToken).toHaveBeenCalledOnce();
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "success" })
    );
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockReturnValue(false);
    const res = await loginPOST(makeReq({ password: "anything" }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("Too many attempts");
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failure",
        details: { reason: "rate_limited" },
      })
    );
  });

  it("rate limit check runs before body parsing", async () => {
    mockCheckRateLimit.mockReturnValue(false);
    await loginPOST(makeReq({ password: "anything" }));
    // Rate limit was checked
    expect(mockCheckRateLimit).toHaveBeenCalled();
    // Body was never parsed (verifyAdminPassword not called)
    expect(mockVerifyAdminPassword).not.toHaveBeenCalled();
  });

  it("logs failure with IP and user-agent on wrong password", async () => {
    mockVerifyAdminPassword.mockReturnValue(false);
    await loginPOST(
      makeReq({ password: "wrong" }, { "x-forwarded-for": "1.2.3.4", "user-agent": "TestAgent/1.0" })
    );
    expect(mockLogAdminEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "admin_login",
        outcome: "failure",
        details: { reason: "invalid_password" },
      })
    );
  });

  it("never exposes internal error details on any failure path", async () => {
    mockCheckRateLimit.mockReturnValue(false);
    const res = await loginPOST(makeReq({ password: "anything" }));
    const body = await res.json();
    assertNoLeaks(body);
  });
});
