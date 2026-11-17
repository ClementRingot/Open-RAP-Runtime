/**
 * Joins of a view entity (D104): inner and left outer joins of tables and CDS entities, the
 * columns of each source by its alias, read-only.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");

const JOIN_VIEW = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Bookings of the travels'
define view entity ZRT_I_TravelBooking
  as select from zrt_travel as t
    inner join zrt_booking as b on b.parent_uuid = t.travel_uuid
    left outer join ZRT_R_Travel as r on r.TravelUUID = t.travel_uuid and r.OverallStatus = 'A'
{
  key b.booking_uuid  as BookingUUID,
      t.travel_id     as TravelID,
      b.booking_id    as BookingID,
      flight_price    as FlightPrice,
      r.Description   as AcceptedDescription
}
`;

let test: TestApp;

beforeAll(async () => {
  test = await writableApp(
    generatedVariant({
      "zrt_i_travelbooking.ddls.asddls": JOIN_VIEW,
      "zrt_ui_travel.srvd.srvdsrv": (c) => lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_TravelBooking as TravelBooking;"),
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

describe("joins of a view entity (D104)", () => {
  it("reads the columns of the joined sources", async () => {
    const rows = (await get("TravelBooking?$orderby=TravelID,BookingID")).value as Array<Record<string, unknown>>;
    const travels = (await get("Travel?$select=TravelUUID")).value as Array<Record<string, unknown>>;
    const bookings = (await get("Booking?$select=BookingUUID")).value as Array<Record<string, unknown>>;
    // inner join: one row per booking of a travel
    expect(rows).toHaveLength(bookings.length);
    expect(travels.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r["TravelID"] === "00000001").map((r) => r["BookingID"])).toEqual(["0001", "0002", "0003"]);
    // left outer join: the description of the accepted travels only
    const accepted = (await get(`Travel?$filter=OverallStatus eq 'A'&$select=TravelID,Description`)).value as Array<Record<string, unknown>>;
    for (const row of rows) {
      const travel = accepted.find((t) => t["TravelID"] === row["TravelID"]);
      // no match: the initial value, as ABAP reads a null of the database
      expect(row["AcceptedDescription"] ?? "").toBe(travel === undefined ? "" : travel["Description"]);
    }
  });

  it("filters on a column of a joined source and describes it read-only", async () => {
    expect(((await get("TravelBooking?$filter=TravelID eq '00000001'&$select=BookingID")).value as unknown[]).length).toBe(3);
    const metadata = (await test.app.inject({ method: "GET", url: `${SERVICE}$metadata` })).body;
    expect(metadata).toMatch(/<Annotations Target="[^"]+\.TravelBookingType\/TravelID">[\s\S]*?<Annotation Term="Core\.Computed"\/>/);
  });
});
