import { describe, expect, it } from "vitest";
import { fromJson, fromSql, normalizeDecimal, normalizeTimestamp, toJson } from "../src/values.js";

describe("canonical values", () => {
  it("normalizes time stamps from PostgreSQL and ISO inputs to UTC microseconds", () => {
    expect(normalizeTimestamp("2026-11-09 12:34:56.1234+00")).toBe("2026-11-09T12:34:56.123400Z");
    expect(normalizeTimestamp("2026-11-09T14:34:56.1234567+02:00")).toBe("2026-11-09T12:34:56.123456Z");
    expect(normalizeTimestamp("2026-11-09T12:34Z", 0)).toBe("2026-11-09T12:34:00Z");
  });

  it("reads SQL values", () => {
    expect(fromSql({ kind: "char", length: 5 }, "ab   ")).toBe("ab");
    expect(fromSql({ kind: "numc", length: 4 }, "0042")).toBe("0042");
    expect(fromSql({ kind: "dats", length: 8 }, null)).toBeNull();
    expect(fromSql({ kind: "curr", length: 16, decimals: 2 }, null)).toBe("0.00");
    expect(fromSql({ kind: "raw", length: 16 }, "3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(fromSql({ kind: "timestampl", length: 21, decimals: 7 }, "2026-01-10 08:00:00.5+00")).toBe("2026-01-10T08:00:00.500000Z");
  });

  it("writes OData JSON with the precision of the Edm type", () => {
    expect(toJson({ type: "Edm.DateTimeOffset", precision: 7 }, "2026-01-10T08:00:00.500000Z", true)).toBe("2026-01-10T08:00:00.5000000Z");
    expect(toJson({ type: "Edm.DateTimeOffset", precision: 0 }, "2026-01-10T08:00:00Z", true)).toBe("2026-01-10T08:00:00Z");
    expect(toJson({ type: "Edm.Decimal", precision: 16, scale: 2 }, "12.50", true)).toBe("12.50");
  });

  it("reads OData JSON values with type checks", () => {
    const amount = { kind: "curr", length: 16, decimals: 2 } as const;
    expect(fromJson(amount, { type: "Edm.Decimal", precision: 16, scale: 2 }, "12.345", "Price")).toBe("12.35");
    expect(fromJson(amount, { type: "Edm.Decimal", precision: 16, scale: 2 }, 7, "Price")).toBe("7.00");
    expect(() => fromJson(amount, { type: "Edm.Decimal", precision: 16, scale: 2 }, "abc", "Price")).toThrow(/not a valid decimal/);
    expect(fromJson({ kind: "numc", length: 8 }, { type: "Edm.String", maxLength: 8, digitSequence: true }, "42", "TravelID")).toBe("00000042");
    expect(() => fromJson({ kind: "char", length: 3 }, { type: "Edm.String", maxLength: 3 }, "abcd", "C")).toThrow(/exceeds 3 characters/);
    expect(fromJson({ kind: "dats", length: 8 }, { type: "Edm.Date" }, null, "D")).toBeNull();
    expect(() => fromJson({ kind: "dats", length: 8 }, { type: "Edm.Date" }, "2026/01/01", "D")).toThrow(/YYYY-MM-DD/);
    expect(fromJson({ kind: "raw", length: 16 }, { type: "Edm.Guid" }, "3F2504E0-4F89-11D3-9A0C-0305E82C3301", "G")).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
  });

  it("rounds decimals half away from zero, as ABAP", () => {
    expect(normalizeDecimal("1.005", 2)).toBe("1.01");
    expect(normalizeDecimal("-1.005", 2)).toBe("-1.01");
    expect(normalizeDecimal("0.004", 2)).toBe("0.00");
    expect(normalizeDecimal("12", 0)).toBe("12");
    expect(normalizeDecimal("1e3", 2)).toBe("1000.00");
  });
});
