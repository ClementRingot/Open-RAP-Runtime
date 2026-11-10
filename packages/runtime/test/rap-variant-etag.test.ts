/**
 * `etag dependent by _Travel` (D32): a booking has the ETag of its travel; a PATCH or DELETE of a
 * booking checks it, and a change of a booking changes the ETag of the travel (its
 * LocalLastChangedAt), once per change set.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B1, B2, batchBody, batchResponses, generatedVariant, SERVICE, T1, writableApp, type TestApp } from "./helpers.js";
import { etagDependentVariant } from "./variants.js";

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true" };

let t: TestApp;

beforeAll(async () => {
  t = await writableApp(generatedVariant(etagDependentVariant()));
}, 180_000);

afterAll(async () => {
  await t?.close();
});

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, unknown> }> {
  const response = await t.app.inject({ method, url: `${SERVICE}${path}`, headers: { ...JSON_HEADERS, ...headers }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>), headers: response.headers };
}

const etagOf = async (path: string): Promise<string> => String((await call("GET", path)).body["@odata.etag"]);

describe("etag dependent by", () => {
  it("annotates the ETag of the master in $metadata", async () => {
    const metadata = (await t.app.inject({ method: "GET", url: `${SERVICE}$metadata` })).body;
    expect(metadata).toMatch(/<Annotations Target="SAP__self\.Container\/Booking">[\s\S]*?<Annotation Term="Core\.OptimisticConcurrency">\s*<Collection>\s*<PropertyPath>_Travel\/LocalLastChangedAt<\/PropertyPath>/);
  });

  it("gives the bookings the ETag of their travel", async () => {
    const travel = await etagOf(`Travel(${T1})`);
    const booking = await call("GET", `Booking(${B1})?$select=BookingID`);
    expect(booking.body["@odata.etag"]).toBe(travel);
    expect(booking.headers["etag"]).toBe(travel);
    const expanded = await call("GET", `Travel(${T1})?$select=TravelID&$expand=_Booking($select=BookingID)`);
    expect((expanded.body["_Booking"] as Array<Record<string, unknown>>).map((b) => b["@odata.etag"])).toEqual([travel, travel, travel]);
    const list = await call("GET", `Booking?$filter=TravelUUID eq ${T1}&$select=BookingID`);
    expect((list.body["value"] as Array<Record<string, unknown>>).every((b) => b["@odata.etag"] === travel)).toBe(true);
  });

  it("checks the ETag of the travel on a change of a booking, which changes it", async () => {
    const before = await etagOf(`Travel(${T1})`);
    expect((await call("PATCH", `Booking(${B1})`, { FlightPrice: "800.00" })).status).toBe(428);
    expect((await call("PATCH", `Booking(${B1})`, { FlightPrice: "800.00" }, { "if-match": 'W/"2020-01-01T00:00:00Z"' })).status).toBe(412);

    const changed = await call("PATCH", `Booking(${B1})`, { FlightPrice: "800.00" }, { "if-match": before });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const after = await etagOf(`Travel(${T1})`);
    expect(after).not.toBe(before);
    expect(changed.body["@odata.etag"]).toBe(after);
    expect(changed.headers["etag"]).toBe(after);

    // the travel was changed through its booking: its old ETag is refused
    expect((await call("PATCH", `Travel(${T1})`, { Description: "x" }, { "if-match": before })).status).toBe(412);
    const rows = (await t.pglite.query<{ changed: boolean }>(`SELECT local_last_changed_at > '2026-01-10 08:00:00.123456+00' AS changed FROM zrt_travel WHERE travel_uuid = '${T1}'`)).rows;
    expect(rows).toEqual([{ changed: true }]);
  });

  it("changes the ETag of the travel once for the requests of a change set", async () => {
    const etag = await etagOf(`Travel(${T1})`);
    const boundary = "batch_id-etag-1";
    const body = batchBody(
      boundary,
      [
        { method: "PATCH", url: `Booking(${B1})`, body: { FlightPrice: "810.00" }, headers: { "If-Match": etag } },
        { method: "PATCH", url: `Booking(${B2})`, body: { FlightPrice: "820.00" }, headers: { "If-Match": etag } },
      ],
      true,
    );
    const response = await t.app.inject({ method: "POST", url: `${SERVICE}$batch`, headers: { "content-type": `multipart/mixed;boundary=${boundary}` }, payload: body });
    expect(response.statusCode).toBe(200);
    const parts = batchResponses(response.body);
    expect(parts.map((p) => p.status)).toEqual([200, 200]);
    const after = await etagOf(`Travel(${T1})`);
    expect(after).not.toBe(etag);
    expect(parts.map((p) => (p.body as Record<string, unknown>)["@odata.etag"])).toEqual([after, after]);
  });

  it("checks the ETags of a change set against the state read before it", async () => {
    // the travel is changed first, then its booking with the ETag read before the change set
    const etag = await etagOf(`Travel(${T1})`);
    const boundary = "batch_id-etag-2";
    const body = batchBody(
      boundary,
      [
        { method: "PATCH", url: `Travel(${T1})`, body: { Description: "Paris, Rome and Berlin" }, headers: { "If-Match": etag } },
        { method: "PATCH", url: `Booking(${B1})`, body: { FlightPrice: "830.00" }, headers: { "If-Match": etag } },
      ],
      true,
    );
    const response = await t.app.inject({ method: "POST", url: `${SERVICE}$batch`, headers: { "content-type": `multipart/mixed;boundary=${boundary}` }, payload: body });
    expect(batchResponses(response.body).map((p) => p.status)).toEqual([200, 200]);
    // another client's ETag of before is stale now
    expect((await call("PATCH", `Booking(${B1})`, { FlightPrice: "840.00" }, { "if-match": etag })).status).toBe(412);
  });

  it("checks and changes the ETag of the travel on a deletion and a creation of a booking", async () => {
    const etag = await etagOf(`Travel(${T1})`);
    expect((await call("DELETE", `Booking(${B2})`, undefined, { "if-match": 'W/"0"' })).status).toBe(412);
    expect((await call("DELETE", `Booking(${B2})`, undefined, { "if-match": etag })).status).toBe(204);
    const afterDelete = await etagOf(`Travel(${T1})`);
    expect(afterDelete).not.toBe(etag);

    const created = await call("POST", `Travel(${T1})/_Booking`, { BookingID: "0009", CarrierID: "LH", ConnectionID: "0400", FlightDate: "2026-06-03", FlightPrice: "10.00", CurrencyCode: "EUR" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const afterCreate = await etagOf(`Travel(${T1})`);
    expect(afterCreate).not.toBe(afterDelete);
    expect(created.body["@odata.etag"]).toBe(afterCreate);
  });
});
