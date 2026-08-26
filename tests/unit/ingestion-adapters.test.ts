import { describe, it, expect, vi } from "vitest";

const { MockWorkbook } = vi.hoisted(() => {
  const mockSheet = {
    eachRow: (cb: (row: { eachCell: (opts: unknown, cb2: (cell: { value: unknown }, col: number) => void) => void }, rowNumber: number) => void) => {
      cb({ eachCell: () => {} }, 1);
      cb(
        {
          eachCell: (_opts: unknown,             cb2: (cell: { value: unknown }, col: number) => void) => {
            cb2({ value: "" }, 1);
            cb2({ value: "" }, 2);
            cb2({ value: "" }, 3);
            cb2({ value: "" }, 4);
            cb2({ value: "" }, 5);
            cb2({ value: "Sub-header" }, 6);
            cb2({ value: "" }, 7);
            cb2({ value: "" }, 8);
            cb2({ value: "" }, 9);
            cb2({ value: "" }, 10);
            cb2({ value: "" }, 11);
            cb2({ value: "" }, 12);
            cb2({ value: "" }, 13);
            cb2({ value: "" }, 14);
            cb2({ value: "" }, 15);
          },
        },
        2,
      );
      cb(
        {
          eachCell: (_opts: unknown, cb2: (cell: { value: unknown }, col: number) => void) => {
            cb2({ value: "" }, 1);
            cb2({ value: "" }, 2);
            cb2({ value: "" }, 3);
            cb2({ value: "" }, 4);
            cb2({ value: "" }, 5);
            cb2({ value: "ACT-001" }, 6);
            cb2({ value: "General Trading" }, 7);
            cb2({ value: "" }, 8);
            cb2({ value: "Commercial" }, 9);
            cb2({ value: "General trading activities" }, 10);
            cb2({ value: "" }, 11);
            cb2({ value: "" }, 12);
            cb2({ value: "" }, 13);
            cb2({ value: "" }, 14);
            cb2({ value: "Y" }, 15);
          },
        },
        3,
      );
    },
  };
  class MockWorkbook {
    xlsx = { load: vi.fn().mockResolvedValue(undefined) };
    worksheets = [mockSheet];
  }
  return { MockWorkbook };
});

vi.mock("exceljs", () => ({
  default: { Workbook: MockWorkbook },
}));

import { dmccAdapter } from "@/lib/ingestion/adapters/dmcc";
import { afzAdapter } from "@/lib/ingestion/adapters/afz";
import { spcAdapter } from "@/lib/ingestion/adapters/spc";
import { rakezAdapter } from "@/lib/ingestion/adapters/rakez";
import { ifzaAdapter } from "@/lib/ingestion/adapters/ifza";
import type { ParsedActivity } from "@/lib/ingestion/types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const mockParsed: ParsedActivity = {
  raw: { testKey: "testValue" },
  activityCode: "TEST-001",
  officialName: "General Trading Activities",
  description: "General trading",
  officialCategory: "Trading",
  activityGroup: "Commercial",
  licenceLabel: "Commercial License",
  approval: { signal: "no_signal" },
};

const VALID_EMIRATES = [
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "ras_al_khaimah",
  "fujairah",
  "umm_al_quwain",
] as const;

const VALID_JURISDICTION_TYPES = ["mainland", "free_zone"] as const;

const VALID_SOURCE_TYPES = [
  "federal_government",
  "government_authority",
  "mainland_authority",
  "free_zone_authority",
  "sector_regulator",
  "government_pdf",
  "secondary_source",
] as const;

// ---------------------------------------------------------------------------
// DMCC adapter
// ---------------------------------------------------------------------------
describe("dmccAdapter", () => {
  describe("meta", () => {
    it("has a non-empty jurisdictionSlug", () => {
      expect(typeof dmccAdapter.meta.jurisdictionSlug).toBe("string");
      expect(dmccAdapter.meta.jurisdictionSlug.length).toBeGreaterThan(0);
    });

    it("has a valid emirate", () => {
      expect(VALID_EMIRATES).toContain(dmccAdapter.meta.emirate);
    });

    it("has a valid jurisdictionType", () => {
      expect(VALID_JURISDICTION_TYPES).toContain(dmccAdapter.meta.jurisdictionType);
    });

    it("has a valid sourceType", () => {
      expect(VALID_SOURCE_TYPES).toContain(dmccAdapter.meta.sourceType);
    });

    it("has a non-empty authorityName", () => {
      expect(typeof dmccAdapter.meta.authorityName).toBe("string");
      expect(dmccAdapter.meta.authorityName.length).toBeGreaterThan(0);
    });
  });

  describe("discover", () => {
    it("returns at least one DiscoveredSource", async () => {
      const sources = await dmccAdapter.discover();
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBeGreaterThanOrEqual(1);
    });

    it("each source has id, label, url, format", async () => {
      const sources = await dmccAdapter.discover();
      for (const src of sources) {
        expect(typeof src.id).toBe("string");
        expect(src.id.length).toBeGreaterThan(0);
        expect(typeof src.label).toBe("string");
        expect(src.label.length).toBeGreaterThan(0);
        expect(typeof src.url).toBe("string");
        expect(src.url.length).toBeGreaterThan(0);
        expect(typeof src.format).toBe("string");
      }
    });
  });

  describe("normalize", () => {
    it("preserves officialName", () => {
      const result = dmccAdapter.normalize(mockParsed);
      expect(result.officialName).toBe(mockParsed.officialName);
    });

    it("sets normalizedName as lowercase cleaned version", () => {
      const result = dmccAdapter.normalize(mockParsed);
      expect(result.normalizedName).toBe("general trading activities");
    });

    it("sets approvalSignal from parsed approval", () => {
      const result = dmccAdapter.normalize(mockParsed);
      expect(result.approvalSignal).toBe("no_signal");
    });

    it("preserves raw", () => {
      const result = dmccAdapter.normalize(mockParsed);
      expect(result.raw).toBe(mockParsed.raw);
    });

    it("sets signalDetail when approval is present", () => {
      const result = dmccAdapter.normalize(mockParsed);
      expect(result.signalDetail).toBeDefined();
      expect(result.signalDetail?.signal).toBe("no_signal");
    });

    it("defaults approvalSignal to unknown when approval is absent", () => {
      const noApproval: ParsedActivity = { ...mockParsed, approval: undefined };
      const result = dmccAdapter.normalize(noApproval);
      expect(result.approvalSignal).toBe("unknown");
    });

    it("sets normalizedCategory as lowercase of officialCategory", () => {
      const result = dmccAdapter.normalize(mockParsed);
      expect(result.normalizedCategory).toBe("trading");
    });
  });

  describe("parse (mocked ExcelJS)", () => {
    it("parses a mock XLSX into ParsedActivity array", async () => {
      const payload = {
        discovery: {
          id: "test",
          label: "Test",
          url: "http://example.com/test.xlsx",
          format: "xlsx" as const,
        },
        body: Buffer.from("fake-xlsx"),
        fetchedAt: new Date(),
      };

      const result = await dmccAdapter.parse(payload);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].officialName).toBe("General Trading");
      expect(result[0].activityCode).toBe("ACT-001");
      expect(result[0].approval).toBeDefined();
      expect(result[0].approval?.signal).toBe("third_party_approval_indicated");
    });
  });
});

// ---------------------------------------------------------------------------
// AFZ adapter
// ---------------------------------------------------------------------------
describe("afzAdapter", () => {
  describe("meta", () => {
    it("has a non-empty jurisdictionSlug", () => {
      expect(typeof afzAdapter.meta.jurisdictionSlug).toBe("string");
      expect(afzAdapter.meta.jurisdictionSlug.length).toBeGreaterThan(0);
    });

    it("has a valid emirate", () => {
      expect(VALID_EMIRATES).toContain(afzAdapter.meta.emirate);
    });

    it("has a valid jurisdictionType", () => {
      expect(VALID_JURISDICTION_TYPES).toContain(afzAdapter.meta.jurisdictionType);
    });

    it("has a valid sourceType", () => {
      expect(VALID_SOURCE_TYPES).toContain(afzAdapter.meta.sourceType);
    });

    it("has a non-empty authorityName", () => {
      expect(typeof afzAdapter.meta.authorityName).toBe("string");
      expect(afzAdapter.meta.authorityName.length).toBeGreaterThan(0);
    });
  });

  describe("discover", () => {
    it("returns at least one DiscoveredSource", async () => {
      const sources = await afzAdapter.discover();
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBeGreaterThanOrEqual(1);
    });

    it("each source has id, label, url, format", async () => {
      const sources = await afzAdapter.discover();
      for (const src of sources) {
        expect(typeof src.id).toBe("string");
        expect(src.id.length).toBeGreaterThan(0);
        expect(typeof src.label).toBe("string");
        expect(src.label.length).toBeGreaterThan(0);
        expect(typeof src.url).toBe("string");
        expect(src.url.length).toBeGreaterThan(0);
        expect(typeof src.format).toBe("string");
      }
    });
  });

  describe("normalize", () => {
    it("preserves officialName", () => {
      const result = afzAdapter.normalize(mockParsed);
      expect(result.officialName).toBe(mockParsed.officialName);
    });

    it("sets normalizedName as lowercase cleaned version", () => {
      const result = afzAdapter.normalize(mockParsed);
      expect(result.normalizedName).toBe("general trading activities");
    });

    it("sets approvalSignal from parsed approval", () => {
      const result = afzAdapter.normalize(mockParsed);
      expect(result.approvalSignal).toBe("no_signal");
    });

    it("preserves raw", () => {
      const result = afzAdapter.normalize(mockParsed);
      expect(result.raw).toBe(mockParsed.raw);
    });

    it("defaults approvalSignal to unknown when approval is absent", () => {
      const noApproval: ParsedActivity = { ...mockParsed, approval: undefined };
      const result = afzAdapter.normalize(noApproval);
      expect(result.approvalSignal).toBe("unknown");
    });

    it("sets signalDetail when approval is present", () => {
      const result = afzAdapter.normalize(mockParsed);
      expect(result.signalDetail).toBeDefined();
      expect(result.signalDetail?.signal).toBe("no_signal");
    });
  });
});

// ---------------------------------------------------------------------------
// SPC adapter
// ---------------------------------------------------------------------------
describe("spcAdapter", () => {
  describe("meta", () => {
    it("has a non-empty jurisdictionSlug", () => {
      expect(typeof spcAdapter.meta.jurisdictionSlug).toBe("string");
      expect(spcAdapter.meta.jurisdictionSlug.length).toBeGreaterThan(0);
    });

    it("has a valid emirate", () => {
      expect(VALID_EMIRATES).toContain(spcAdapter.meta.emirate);
    });

    it("has a valid jurisdictionType", () => {
      expect(VALID_JURISDICTION_TYPES).toContain(spcAdapter.meta.jurisdictionType);
    });

    it("has a valid sourceType", () => {
      expect(VALID_SOURCE_TYPES).toContain(spcAdapter.meta.sourceType);
    });

    it("has a non-empty authorityName", () => {
      expect(typeof spcAdapter.meta.authorityName).toBe("string");
      expect(spcAdapter.meta.authorityName.length).toBeGreaterThan(0);
    });
  });

  describe("discover", () => {
    it("returns at least one DiscoveredSource", async () => {
      const sources = await spcAdapter.discover();
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBeGreaterThanOrEqual(1);
    });

    it("each source has id, label, url, format", async () => {
      const sources = await spcAdapter.discover();
      for (const src of sources) {
        expect(typeof src.id).toBe("string");
        expect(src.id.length).toBeGreaterThan(0);
        expect(typeof src.label).toBe("string");
        expect(src.label.length).toBeGreaterThan(0);
        expect(typeof src.url).toBe("string");
        expect(src.url.length).toBeGreaterThan(0);
        expect(typeof src.format).toBe("string");
      }
    });
  });

  describe("normalize", () => {
    it("preserves officialName", () => {
      const result = spcAdapter.normalize(mockParsed);
      expect(result.officialName).toBe(mockParsed.officialName);
    });

    it("sets normalizedName as lowercase cleaned version", () => {
      const result = spcAdapter.normalize(mockParsed);
      expect(result.normalizedName).toBe("general trading activities");
    });

    it("sets approvalSignal from parsed approval", () => {
      const result = spcAdapter.normalize(mockParsed);
      expect(result.approvalSignal).toBe("no_signal");
    });

    it("preserves raw", () => {
      const result = spcAdapter.normalize(mockParsed);
      expect(result.raw).toBe(mockParsed.raw);
    });

    it("defaults approvalSignal to unknown when approval is absent", () => {
      const noApproval: ParsedActivity = { ...mockParsed, approval: undefined };
      const result = spcAdapter.normalize(noApproval);
      expect(result.approvalSignal).toBe("unknown");
    });

    it("sets normalizedCategory as lowercase of officialCategory", () => {
      const result = spcAdapter.normalize(mockParsed);
      expect(result.normalizedCategory).toBe("trading");
    });

    it("preserves prices array when present", () => {
      const withPrices: ParsedActivity = {
        ...mockParsed,
        price: { amount: 5000, currency: "AED" },
        prices: [{ amount: 5000, currency: "AED" }, { amount: 7500, currency: "AED" }],
      };
      const result = spcAdapter.normalize(withPrices);
      expect(result.prices).toHaveLength(2);
      expect(result.price?.amount).toBe(5000);
    });
  });
});

// ---------------------------------------------------------------------------
// RAKEZ adapter
// ---------------------------------------------------------------------------
describe("rakezAdapter", () => {
  describe("meta", () => {
    it("has a non-empty jurisdictionSlug", () => {
      expect(typeof rakezAdapter.meta.jurisdictionSlug).toBe("string");
      expect(rakezAdapter.meta.jurisdictionSlug.length).toBeGreaterThan(0);
    });

    it("has a valid emirate", () => {
      expect(VALID_EMIRATES).toContain(rakezAdapter.meta.emirate);
    });

    it("has a valid jurisdictionType", () => {
      expect(VALID_JURISDICTION_TYPES).toContain(rakezAdapter.meta.jurisdictionType);
    });

    it("has a valid sourceType", () => {
      expect(VALID_SOURCE_TYPES).toContain(rakezAdapter.meta.sourceType);
    });

    it("has a non-empty authorityName", () => {
      expect(typeof rakezAdapter.meta.authorityName).toBe("string");
      expect(rakezAdapter.meta.authorityName.length).toBeGreaterThan(0);
    });
  });

  describe("discover", () => {
    it("returns at least one DiscoveredSource", async () => {
      const sources = await rakezAdapter.discover();
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBeGreaterThanOrEqual(1);
    });

    it("each source has id, label, url, format", async () => {
      const sources = await rakezAdapter.discover();
      for (const src of sources) {
        expect(typeof src.id).toBe("string");
        expect(src.id.length).toBeGreaterThan(0);
        expect(typeof src.label).toBe("string");
        expect(src.label.length).toBeGreaterThan(0);
        expect(typeof src.url).toBe("string");
        expect(src.url.length).toBeGreaterThan(0);
        expect(typeof src.format).toBe("string");
      }
    });
  });

  describe("normalize", () => {
    it("preserves officialName", () => {
      const result = rakezAdapter.normalize(mockParsed);
      expect(result.officialName).toBe(mockParsed.officialName);
    });

    it("sets normalizedName as lowercase cleaned version", () => {
      const result = rakezAdapter.normalize(mockParsed);
      expect(result.normalizedName).toBe("general trading activities");
    });

    it("sets approvalSignal from parsed approval", () => {
      const result = rakezAdapter.normalize(mockParsed);
      expect(result.approvalSignal).toBe("no_signal");
    });

    it("preserves raw", () => {
      const result = rakezAdapter.normalize(mockParsed);
      expect(result.raw).toBe(mockParsed.raw);
    });

    it("defaults approvalSignal to unknown when approval is absent", () => {
      const noApproval: ParsedActivity = { ...mockParsed, approval: undefined };
      const result = rakezAdapter.normalize(noApproval);
      expect(result.approvalSignal).toBe("unknown");
    });

    it("preserves zone field", () => {
      const withZone: ParsedActivity = { ...mockParsed, zone: "Freezone" };
      const result = rakezAdapter.normalize(withZone);
      expect(result.zone).toBe("Freezone");
    });

    it("preserves restrictions", () => {
      const withRestrictions: ParsedActivity = {
        ...mockParsed,
        restrictions: "ESR flag set",
      };
      const result = rakezAdapter.normalize(withRestrictions);
      expect(result.restrictions).toBe("ESR flag set");
    });

    it("preserves prices array", () => {
      const withPrices: ParsedActivity = {
        ...mockParsed,
        prices: [{ amount: 3000, currency: "AED" }],
      };
      const result = rakezAdapter.normalize(withPrices);
      expect(result.prices).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// IFZA adapter
// ---------------------------------------------------------------------------
describe("ifzaAdapter", () => {
  describe("meta", () => {
    it("has a non-empty jurisdictionSlug", () => {
      expect(typeof ifzaAdapter.meta.jurisdictionSlug).toBe("string");
      expect(ifzaAdapter.meta.jurisdictionSlug.length).toBeGreaterThan(0);
    });

    it("has a valid emirate", () => {
      expect(VALID_EMIRATES).toContain(ifzaAdapter.meta.emirate);
    });

    it("has a valid jurisdictionType", () => {
      expect(VALID_JURISDICTION_TYPES).toContain(ifzaAdapter.meta.jurisdictionType);
    });

    it("has a valid sourceType", () => {
      expect(VALID_SOURCE_TYPES).toContain(ifzaAdapter.meta.sourceType);
    });

    it("has a non-empty authorityName", () => {
      expect(typeof ifzaAdapter.meta.authorityName).toBe("string");
      expect(ifzaAdapter.meta.authorityName.length).toBeGreaterThan(0);
    });
  });

  describe("discover", () => {
    it("returns at least one DiscoveredSource", async () => {
      const sources = await ifzaAdapter.discover();
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBeGreaterThanOrEqual(1);
    });

    it("each source has id, label, url, format", async () => {
      const sources = await ifzaAdapter.discover();
      for (const src of sources) {
        expect(typeof src.id).toBe("string");
        expect(src.id.length).toBeGreaterThan(0);
        expect(typeof src.label).toBe("string");
        expect(src.label.length).toBeGreaterThan(0);
        expect(typeof src.url).toBe("string");
        expect(src.url.length).toBeGreaterThan(0);
        expect(typeof src.format).toBe("string");
      }
    });
  });

  describe("normalize", () => {
    it("preserves officialName", () => {
      const result = ifzaAdapter.normalize(mockParsed);
      expect(result.officialName).toBe(mockParsed.officialName);
    });

    it("sets normalizedName as lowercase cleaned version", () => {
      const result = ifzaAdapter.normalize(mockParsed);
      expect(result.normalizedName).toBe("general trading activities");
    });

    it("sets approvalSignal from parsed approval", () => {
      const result = ifzaAdapter.normalize(mockParsed);
      expect(result.approvalSignal).toBe("no_signal");
    });

    it("preserves raw", () => {
      const result = ifzaAdapter.normalize(mockParsed);
      expect(result.raw).toBe(mockParsed.raw);
    });

    it("defaults approvalSignal to unknown when approval is absent", () => {
      const noApproval: ParsedActivity = { ...mockParsed, approval: undefined };
      const result = ifzaAdapter.normalize(noApproval);
      expect(result.approvalSignal).toBe("unknown");
    });

    it("sets signalDetail when approval is present", () => {
      const approved: ParsedActivity = {
        ...mockParsed,
        approval: {
          signal: "third_party_approval_indicated",
          signalType: "third_party_approval_required",
          authorityName: "RTA",
        },
      };
      const result = ifzaAdapter.normalize(approved);
      expect(result.signalDetail).toBeDefined();
      expect(result.signalDetail?.signal).toBe("third_party_approval_indicated");
      expect(result.signalDetail?.authorityName).toBe("RTA");
    });

    it("preserves restrictions field", () => {
      const restricted: ParsedActivity = {
        ...mockParsed,
        restrictions: "Required_Prior_TL_Issuance flag set",
      };
      const result = ifzaAdapter.normalize(restricted);
      expect(result.restrictions).toBe("Required_Prior_TL_Issuance flag set");
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-adapter consistency
// ---------------------------------------------------------------------------
describe("adapter consistency", () => {
  const adapters = [
    { name: "dmcc", adapter: dmccAdapter },
    { name: "afz", adapter: afzAdapter },
    { name: "spc", adapter: spcAdapter },
    { name: "rakez", adapter: rakezAdapter },
    { name: "ifza", adapter: ifzaAdapter },
  ];

  for (const { name, adapter } of adapters) {
    describe(`${name} normalize output shape`, () => {
      it("returns all required NormalizedActivity fields", () => {
        const result = adapter.normalize(mockParsed);
        expect(result).toHaveProperty("officialName");
        expect(result).toHaveProperty("normalizedName");
        expect(result).toHaveProperty("approvalSignal");
        expect(result).toHaveProperty("raw");
        expect(typeof result.normalizedName).toBe("string");
        expect(typeof result.approvalSignal).toBe("string");
        expect(typeof result.raw).toBe("object");
      });

      it("normalizedName is lowercase of officialName", () => {
        const result = adapter.normalize(mockParsed);
        expect(result.normalizedName).toBe(
          mockParsed.officialName.toLowerCase(),
        );
      });

      it("officialName is preserved exactly", () => {
        const result = adapter.normalize(mockParsed);
        expect(result.officialName).toBe(mockParsed.officialName);
      });
    });
  }
});
