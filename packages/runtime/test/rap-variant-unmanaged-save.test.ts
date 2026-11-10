/**
 * A managed BO with unmanaged save: no persistent tables, the RAP runtime reads the instances
 * through the CDS views and save_modified writes them, the travels with MAPPING FROM ENTITY and
 * INDICATORS SET STRUCTURE %control, the bookings in plain ABAP SQL.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B1, B4, generatedVariant, SERVICE, T1, T2, writableApp, type TestApp } from "./helpers.js";
import { unmanagedSaveVariant } from "./variants.js";

let t: TestApp;

beforeAll(async () => {
  t = await writableApp(generatedVariant(unmanagedSaveVariant()));
}, 180_000);

afterAll(async () => {
  await t?.close();
});

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true", "if-match": "*" };

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown>; messages: string }> {
  const response = await t.app.inject({ method, url: `${SERVICE}${path}`, headers: JSON_HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>), messages: String(response.headers["sap-messages"] ?? "") };
}

async function rows(query: string): Promise<Array<Record<string, unknown>>> {
  return (await t.pglite.query<Record<string, unknown>>(query)).rows;
}

const TRAVEL = { TravelID: "00000042", AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "40.00", CurrencyCode: "EUR", Description: "Unmanaged" };

describe("managed BO with unmanaged save", () => {
  it("creates through save_modified (MAPPING FROM ENTITY)", async () => {
    const created = await call("POST", "Travel", TRAVEL);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.messages).toContain("Saved by save_modified");
    const db = await rows("SELECT travel_id, description, booking_fee::text AS fee, overall_status, total_price::text AS total FROM zrt_travel WHERE travel_id = '00000042'");
    expect(db).toEqual([{ travel_id: "00000042", description: "Unmanaged", fee: "40.00", overall_status: "O", total: "40.00" }]);
  });

  it("updates only the changed fields (INDICATORS SET STRUCTURE %control)", async () => {
    // another transaction changes the end date in the table: the update of the description keeps it
    await t.pglite.exec(`UPDATE zrt_travel SET end_date = '2026-06-30' WHERE travel_uuid = '${T1}'`);
    const updated = await call("PATCH", `Travel(${T1})`, { Description: "Changed by the saver" });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    const db = await rows(`SELECT description, end_date::text AS end_date FROM zrt_travel WHERE travel_uuid = '${T1}'`);
    expect(db).toEqual([{ description: "Changed by the saver", end_date: "2026-06-30" }]);
  });

  it("writes the child entities in plain ABAP SQL", async () => {
    const created = await call("POST", `Travel(${T1})/_Booking`, { BookingID: "0004", CarrierID: "LH", ConnectionID: "0400", FlightDate: "2026-06-03", FlightPrice: "10.00", CurrencyCode: "EUR" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(await rows(`SELECT booking_id, flight_price::text AS price FROM zrt_booking WHERE parent_uuid = '${T1}' AND booking_id = '0004'`)).toEqual([{ booking_id: "0004", price: "10.00" }]);
    expect((await call("PATCH", `Booking(${B1})`, { FlightPrice: "700.00" })).status).toBe(200);
    expect(await rows(`SELECT flight_price::text AS price FROM zrt_booking WHERE booking_uuid = '${B1}'`)).toEqual([{ price: "700.00" }]);
  });

  it("deletes a travel and its bookings", async () => {
    expect((await call("DELETE", `Travel(${T2})`)).status).toBe(204);
    expect(await rows(`SELECT count(*)::int AS n FROM zrt_travel WHERE travel_uuid = '${T2}'`)).toEqual([{ n: 0 }]);
    expect(await rows(`SELECT count(*)::int AS n FROM zrt_booking WHERE booking_uuid = '${B4}'`)).toEqual([{ n: 0 }]);
    expect((await call("GET", `Travel(${T2})`)).status).toBe(404);
  });
});
