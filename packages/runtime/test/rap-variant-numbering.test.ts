/**
 * Early numbering by association: the bookings have `early numbering`, the handler
 * `FOR NUMBERING … FOR CREATE Travel\_Booking` maps their %cid to keys, from the key of their
 * travel; it can refuse a booking (failed, reported).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, T1, writableApp, type TestApp } from "./helpers.js";
import { numberingByAssociationVariant } from "./variants.js";

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true", "if-match": "*" };

let t: TestApp;

beforeAll(async () => {
  t = await writableApp(generatedVariant(numberingByAssociationVariant()));
}, 180_000);

afterAll(async () => {
  await t?.close();
});

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await t.app.inject({ method, url: `${SERVICE}${path}`, headers: JSON_HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

const booking = (id: string): Record<string, unknown> => ({ BookingID: id, CarrierID: "LH", ConnectionID: "0400", FlightDate: "2026-06-03", FlightPrice: "10.00", CurrencyCode: "EUR" });

describe("early numbering by association", () => {
  it("numbers a booking created by association with the handler of the travel", async () => {
    const created = await call("POST", `Travel(${T1})/_Booking`, booking("0004"));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body["BookingUUID"]).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c0004");
    const rows = (await t.pglite.query<{ n: number }>(`SELECT count(*)::int AS n FROM zrt_booking WHERE booking_uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c0004'`)).rows;
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("numbers the bookings of a deep create", async () => {
    const created = await call("POST", "Travel?$expand=_Booking", {
      TravelID: "00000077",
      AgencyID: "070001",
      CustomerID: "000001",
      BeginDate: "2027-05-01",
      EndDate: "2027-05-08",
      BookingFee: "10.00",
      CurrencyCode: "EUR",
      Description: "Deep create",
      _Booking: [booking("0001"), booking("0002")],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const travel = String(created.body["TravelUUID"]).replace(/-/g, "");
    const bookings = (created.body["_Booking"] as Array<Record<string, unknown>>).map((b) => String(b["BookingUUID"]).replace(/-/g, "")).sort();
    expect(bookings).toEqual([`${travel.slice(0, 28)}0001`, `${travel.slice(0, 28)}0002`]);
  });

  it("refuses a booking the handler fails", async () => {
    const refused = await call("POST", `Travel(${T1})/_Booking`, booking("9999"));
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { message: "The booking ID 9999 is reserved" } });
    const rows = (await t.pglite.query<{ n: number }>(`SELECT count(*)::int AS n FROM zrt_booking WHERE booking_id = '9999'`)).rows;
    expect(rows).toEqual([{ n: 0 }]);
  });
});
