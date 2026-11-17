/**
 * Aggregate expressions of a view entity (D105): COUNT(*), COUNT(DISTINCT), SUM, AVG(AS type),
 * MAX with GROUP BY and HAVING, read through OData.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, T1, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");

const STATS = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Bookings per travel'
define view entity ZRT_I_TravelStats
  as select from zrt_booking as b
{
  key b.parent_uuid                                     as TravelUUID,
  key b.currency_code                                   as CurrencyCode,
      count(*)                                          as Bookings,
      count( distinct carrier_id )                      as Carriers,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      sum( flight_price )                               as Total,
      avg( flight_price as abap.dec(16,2) )             as Average,
      max( flight_date )                                as LastFlight
}
group by b.parent_uuid, b.currency_code
having count(*) >= 1
`;

let test: TestApp;

beforeAll(async () => {
  test = await writableApp(
    generatedVariant({
      "zrt_i_travelstats.ddls.asddls": STATS,
      "zrt_ui_travel.srvd.srvdsrv": (c) => lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_TravelStats as TravelStats;"),
    }),
  );
}, 180_000);

afterAll(async () => {
  await test?.close();
});

async function get(path: string): Promise<Record<string, unknown>> {
  const response = await test.app.inject({ method: "GET", url: `${SERVICE}${path}`, headers: { accept: "application/json" } });
  expect(response.statusCode, response.body).toBe(200);
  return JSON.parse(response.body) as Record<string, unknown>;
}

describe("aggregate expressions of a view entity (D105)", () => {
  it("computes the aggregates per group, as the bookings give them", async () => {
    const bookings = (await get(`Travel(${T1})/_Booking?$select=FlightPrice,CarrierID,FlightDate,CurrencyCode`)).value as Array<Record<string, unknown>>;
    const stats = (await get(`TravelStats?$filter=TravelUUID eq ${T1}`)).value as Array<Record<string, unknown>>;
    expect(stats).toHaveLength(new Set(bookings.map((b) => b["CurrencyCode"])).size);
    const row = stats[0] as Record<string, unknown>;
    const mine = bookings.filter((b) => b["CurrencyCode"] === row["CurrencyCode"]);
    const prices = mine.map((b) => Number(b["FlightPrice"]));
    expect(row).toMatchObject({ Bookings: mine.length, Carriers: new Set(mine.map((b) => b["CarrierID"])).size });
    expect(Number(row["Total"])).toBeCloseTo(prices.reduce((a, b) => a + b, 0), 2);
    expect(Number(row["Average"])).toBeCloseTo(prices.reduce((a, b) => a + b, 0) / prices.length, 2);
    expect(row["LastFlight"]).toBe(mine.map((b) => String(b["FlightDate"])).sort().reverse()[0]);
  });

  it("types COUNT as an integer and describes the aggregates read-only", async () => {
    const metadata = (await test.app.inject({ method: "GET", url: `${SERVICE}$metadata` })).body;
    expect(metadata).toMatch(/<Property Name="Bookings" Type="Edm.Int32"/);
    expect(metadata).toMatch(/<Property Name="Average" Type="Edm.Decimal"[^>]*Precision="16"[^>]*Scale="2"/);
    expect(metadata).toMatch(/<Annotations Target="[^"]+\.TravelStatsType\/Total">[\s\S]*?<Annotation Term="Core\.Computed"\/>/);
  });
});
