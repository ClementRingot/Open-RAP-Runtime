/** `$apply` (D52): groupby, aggregate, filter, with $orderby, $top, $count and the access controls. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseApply } from "../src/odata/uri/parser.js";
import { fixtureApp, SERVICE, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await fixtureApp();
});
afterAll(async () => {
  await t.close();
});

async function get(url: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await t.app.inject({ method: "GET", url: `${SERVICE}${url}`, headers: { accept: "application/json" } });
  return { status: response.statusCode, json: JSON.parse(response.body) as Record<string, unknown> };
}

describe("$apply", () => {
  it("parses the transformations of the analytical requests", () => {
    expect(parseApply("filter(OverallStatus eq 'O')/groupby((CurrencyCode),aggregate(TotalPrice with sum as Total,$count as Count))")).toEqual([
      { kind: "filter", filter: expect.objectContaining({ kind: "binary" }) },
      { kind: "groupby", properties: ["CurrencyCode"], aggregate: [{ property: "TotalPrice", method: "sum", alias: "Total" }, { method: "count", alias: "Count" }] },
    ]);
    expect(parseApply("aggregate(BookingFee with max as Max)")).toEqual([{ kind: "aggregate", aggregate: [{ property: "BookingFee", method: "max", alias: "Max" }] }]);
    expect(() => parseApply("groupby((A))/filter(B eq 1)")).toThrow(/not supported/);
    expect(() => parseApply("compute(A as B)")).toThrow(/not supported/);
  });

  it("groups and aggregates", async () => {
    const byCurrency = await get("Travel?$apply=groupby((CurrencyCode),aggregate(TotalPrice with sum as Total,$count as Count))&$orderby=Total desc&$count=true");
    expect(byCurrency.status, JSON.stringify(byCurrency.json)).toBe(200);
    expect(byCurrency.json["@odata.count"]).toBe(2);
    expect(byCurrency.json["value"]).toEqual([
      { CurrencyCode: "EUR", Total: 1520.5, Count: 2 },
      { CurrencyCode: "USD", Total: 310, Count: 1 },
    ]);
    const filtered = await get(`Travel?$apply=${encodeURIComponent("filter(OverallStatus ne 'X')/aggregate(BookingFee with average as Average,TravelID with countdistinct as Travels)")}`);
    expect(filtered.json["value"]).toEqual([{ Average: 15, Travels: 2 }]);
    const top = await get("Travel?$apply=groupby((OverallStatus))&$orderby=OverallStatus&$top=2");
    expect(top.json["value"]).toEqual([{ OverallStatus: "A" }, { OverallStatus: "O" }]);
  });

  it("refuses what it cannot do", async () => {
    expect((await get("Travel?$apply=groupby((Nothing))")).status).toBe(400);
    expect((await get("Travel?$apply=groupby((CurrencyCode))&$orderby=TotalPrice")).status).toBe(400);
    expect((await get("Travel?$apply=topcount(2,TotalPrice)")).status).toBe(501);
  });
});
