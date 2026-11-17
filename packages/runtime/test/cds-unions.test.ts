/**
 * UNION and UNION ALL of view entities (D106): the branches merged into one result set, typed by
 * the first SELECT.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");

const DOCUMENTS = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@Metadata.ignorePropagatedAnnotations: true
@EndUserText.label: 'Travels and bookings'
define view entity ZRT_I_Document
  as select from zrt_travel
{
  key travel_uuid             as DocumentUUID,
      @EndUserText.label: 'Kind'
      cast( 'T' as abap.char(1) ) as Kind,
      travel_id               as Number
}
union all select from zrt_booking
{
  key booking_uuid            as DocumentUUID,
      cast( 'B' as abap.char(1) ) as Kind,
      booking_id              as Number
}
`;

const CARRIERS = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@Metadata.ignorePropagatedAnnotations: true
define view entity ZRT_I_Carrier
  as select from zrt_booking
{
  key carrier_id as CarrierID
}
union select from zrt_booking
{
  key carrier_id as CarrierID
}
`;

let test: TestApp;

beforeAll(async () => {
  test = await writableApp(
    generatedVariant({
      "zrt_i_document.ddls.asddls": DOCUMENTS,
      "zrt_i_carrier.ddls.asddls": CARRIERS,
      "zrt_ui_travel.srvd.srvdsrv": (c) =>
        lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_Document as Document;\n  expose ZRT_I_Carrier as Carrier;"),
    }),
  );
}, 180_000);

afterAll(async () => {
  await test?.close();
});

async function get(path: string): Promise<Array<Record<string, unknown>>> {
  const response = await test.app.inject({ method: "GET", url: `${SERVICE}${path}`, headers: { accept: "application/json" } });
  expect(response.statusCode, response.body).toBe(200);
  return (JSON.parse(response.body) as { value: Array<Record<string, unknown>> }).value;
}

describe("UNION of view entities (D106)", () => {
  it("merges the rows of every branch (UNION ALL)", async () => {
    const travels = await get("Travel?$select=TravelUUID");
    const bookings = await get("Booking?$select=BookingUUID,CarrierID");
    const documents = await get("Document?$select=DocumentUUID,Kind,Number");
    expect(documents).toHaveLength(travels.length + bookings.length);
    expect(documents.filter((d) => d["Kind"] === "T")).toHaveLength(travels.length);
    expect((await get("Document?$filter=Kind eq 'B'&$select=Number")).length).toBe(bookings.length);
  });

  it("removes the duplicates without ALL", async () => {
    const bookings = await get("Booking?$select=CarrierID");
    expect(await get("Carrier")).toHaveLength(new Set(bookings.map((b) => b["CarrierID"])).size);
  });
});
