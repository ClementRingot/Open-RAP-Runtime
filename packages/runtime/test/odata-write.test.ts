/**
 * OData writes as a Fiori elements V4 List Report / Object Page (non-draft) sends them: POST in
 * a change set, PATCH with If-Match, bound actions with $select, DELETE, creation of a booking
 * from the Object Page table, instance feature control read with the rows.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { B1, B4, batchBody, batchResponses, SERVICE, T1, T2, T3, writableApp, type TestApp } from "./helpers.js";

const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";
const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true" };

let t: TestApp;

beforeEach(async () => {
  t = await writableApp();
}, 120_000);

afterEach(async () => {
  await t?.close();
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, unknown> }> {
  const response = await t.app.inject({ method: "GET", url: `${SERVICE}${path}`, headers: { accept: JSON_HEADERS.accept } });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>), headers: response.headers };
}

async function send(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, unknown> }> {
  const response = await t.app.inject({ method, url: `${SERVICE}${path}`, headers: { ...JSON_HEADERS, ...headers }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>), headers: response.headers };
}

async function etag(path: string): Promise<string> {
  return String((await get(path)).body["@odata.etag"]);
}

const travel = {
  TravelID: "00000100",
  AgencyID: "070001",
  CustomerID: "000042",
  BeginDate: "2027-03-01",
  EndDate: "2027-03-10",
  BookingFee: "25.00",
  CurrencyCode: "EUR",
  Description: "Created like Fiori elements does",
};

describe("OData writes on the managed runtime", () => {
  it("creates an entity: 201, generated key, determinations, ETag and Location", async () => {
    const response = await send("POST", "Travel", { ...travel, OverallStatus: "X" });
    expect(response.status).toBe(201);
    const uuid = String(response.body["TravelUUID"]);
    expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).toMatchObject({ TravelID: "00000100", OverallStatus: "O", TotalPrice: "25.00", CreatedBy: "DEVELOPER", "@odata.context": "$metadata#Travel/$entity" });
    expect(response.headers["location"]).toBe(`${SERVICE}Travel(${uuid})`);
    expect(response.headers["etag"]).toBe(response.body["@odata.etag"]);
    expect((await get(`Travel(${uuid})`)).status).toBe(200);
  });

  it("answers a failed validation with the message, its target and a rollback", async () => {
    const response = await send("POST", "Travel", { ...travel, EndDate: "2027-02-01" });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { message: "End date must not be before begin date", target: "EndDate", "@Common.numericSeverity": 4 } });
    const list = await get("Travel?$filter=TravelID eq '00000100'");
    expect(list.body["value"]).toEqual([]);
  });

  it("rejects unknown properties and ignores read-only ones", async () => {
    expect((await send("POST", "Travel", { ...travel, Unknown: 1 })).status).toBe(400);
    const created = await send("POST", "Travel", { ...travel, CreatedBy: "MALLORY", TotalPrice: "1.00" });
    expect(created.body).toMatchObject({ CreatedBy: "DEVELOPER", TotalPrice: "25.00" });
  });

  it("updates with If-Match: 428 without, 412 when stale, 200 and determinations otherwise", async () => {
    expect((await send("PATCH", `Travel(${T1})`, { Description: "x" })).status).toBe(428);
    expect((await send("PATCH", `Travel(${T1})`, { Description: "x" }, { "if-match": 'W/"2000-01-01T00:00:00.000000Z"' })).status).toBe(412);
    const before = await etag(`Travel(${T1})`);
    const response = await send("PATCH", `Travel(${T1})`, { Description: "Paris, Rome and Florence", BookingFee: "30.00" }, { "if-match": before });
    expect(response.status).toBe(200);
    // calculateTotalPrice (field BookingFee) → reCalcTotalPrice: 30.00 + 750.25 + 750.25 + 0.00
    expect(response.body).toMatchObject({ Description: "Paris, Rome and Florence", BookingFee: "30.00", TotalPrice: "1530.50", LastChangedBy: "DEVELOPER" });
    expect(response.body["@odata.etag"]).not.toBe(before);
  });

  it("reports a failed validation of an update on the field", async () => {
    const response = await send("PATCH", `Travel(${T1})`, { EndDate: "2026-05-01" }, { "if-match": "*" });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { message: "End date must not be before begin date", target: "EndDate" } });
    expect((await get(`Travel(${T1})`)).body["EndDate"]).toBe("2026-06-15");
  });

  it("deletes with its compositions", async () => {
    expect((await send("DELETE", `Travel(${T2})`, undefined, { "if-match": "*" })).status).toBe(204);
    expect((await get(`Travel(${T2})`)).status).toBe(404);
    expect((await get(`Booking(${B4})`)).status).toBe(404);
  });

  it("creates a booking through the composition and recalculates the travel", async () => {
    const response = await send("POST", `Travel(${T1})/_Booking`, { BookingID: "0004", CarrierID: "LH", ConnectionID: "0401", FlightDate: "2026-06-10", FlightPrice: "99.75", CurrencyCode: "EUR" });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ TravelUUID: T1, BookingID: "0004", "@odata.context": "$metadata#Booking/$entity" });
    expect((await get(`Travel(${T1})`)).body["TotalPrice"]).toBe("1620.25");
    expect((await send("POST", "Booking", { BookingID: "0005" })).status).toBe(405);
  });

  it("deep inserts the bookings of a new travel", async () => {
    const response = await send("POST", "Travel?$expand=_Booking", {
      ...travel,
      _Booking: [
        { BookingID: "0001", CarrierID: "AF", ConnectionID: "0012", FlightDate: "2027-03-01", FlightPrice: "100.00", CurrencyCode: "EUR" },
        { BookingID: "0002", CarrierID: "AF", ConnectionID: "0013", FlightDate: "2027-03-10", FlightPrice: "120.50", CurrencyCode: "EUR" },
      ],
    });
    expect(response.status).toBe(201);
    const uuid = String(response.body["TravelUUID"]);
    const bookings = await get(`Travel(${uuid})/_Booking?$orderby=BookingID`);
    expect((bookings.body["value"] as Array<Record<string, unknown>>).map((b) => b["BookingID"])).toEqual(["0001", "0002"]);
    expect((await get(`Travel(${uuid})`)).body["TotalPrice"]).toBe("245.50");
  });

  it("executes a bound action with its result, then refuses it by feature control", async () => {
    const path = `Travel(${T1})/${NS}.acceptTravel?$select=TravelUUID,OverallStatus,__OperationControl`;
    const response = await send("POST", path, {}, { "if-match": await etag(`Travel(${T1})`) });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ TravelUUID: T1, OverallStatus: "A", __OperationControl: { acceptTravel: false } });
    const again = await send("POST", path, {}, { "if-match": "*" });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { message: `The action acceptTravel is not possible for Travel(${T1})` } });
  });

  it("returns the success messages of an action in sap-messages (T100 text)", async () => {
    const response = await send("POST", `Travel(${T3})/${NS}.acceptTravel`, {}, { "if-match": "*" });
    expect(response.status).toBe(200);
    expect(JSON.parse(String(response.headers["sap-messages"]))).toEqual([{ code: "ZRT_TRAVEL/002", message: "Travel 00000003 accepted", numericSeverity: 1, transition: true }]);
  });

  it("calls an action with a parameter of an abstract entity", async () => {
    const response = await send("POST", `Travel(${T1})/${NS}.deductDiscount`, { DiscountPercent: 10 }, { "if-match": "*" });
    expect(response.status).toBe(200);
    // 20.00 - 10 %; the determination recalculates the total: 18.00 + 1500.50
    expect(response.body).toMatchObject({ TravelUUID: T1, BookingFee: "18.00", TotalPrice: "1518.50" });
    const refused = await send("POST", `Travel(${T1})/${NS}.deductDiscount`, { DiscountPercent: 0 }, { "if-match": "*" });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { code: "ZRT_TRAVEL/001", message: "The discount must be between 1 and 100 %, not 0 %" } });
    expect((await send("POST", `Travel(${T1})/${NS}.deductDiscount`, { Discount: 1 }, { "if-match": "*" })).status).toBe(400);
  });

  it("calls a factory action: the new instance is the result", async () => {
    const response = await send("POST", `Travel(${T2})/${NS}.copyTravel`, {}, { "if-match": "*" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ TravelID: "00000002", Description: "Copy of Business trip to Berlin", OverallStatus: "O", TotalPrice: "10.00" });
    expect(response.body["TravelUUID"]).not.toBe(T2);
    const copies = await get("Travel?$filter=TravelID eq '00000002'&$count=true");
    expect(copies.body["@odata.count"]).toBe(2);
  });

  it("returns the instance feature control with the rows read", async () => {
    const list = await get(`Travel?$select=TravelUUID,OverallStatus,__OperationControl&$orderby=TravelID`);
    expect(list.body["value"]).toEqual([
      expect.objectContaining({ TravelUUID: T1, __OperationControl: { acceptTravel: true } }),
      expect.objectContaining({ TravelUUID: T2, __OperationControl: { acceptTravel: false } }),
      expect.objectContaining({ TravelUUID: T3, __OperationControl: { acceptTravel: true } }),
    ]);
  });

  it("runs a change set as one LUW: Content-ID references and deferred responses", async () => {
    const boundary = "batch_id-1700000000000-12";
    const body = batchBody(
      boundary,
      [
        { method: "POST", url: "Travel", body: travel, contentId: "1" },
        { method: "POST", url: "$1/_Booking", body: { BookingID: "0001", CarrierID: "LH", ConnectionID: "0400", FlightDate: "2027-03-02", FlightPrice: "50.00", CurrencyCode: "EUR" }, contentId: "2" },
      ],
      true,
    );
    const response = await t.app.inject({ method: "POST", url: `${SERVICE}$batch`, headers: { "content-type": `multipart/mixed;boundary=${boundary}` }, payload: body });
    expect(response.statusCode).toBe(200);
    const parts = batchResponses(response.body);
    expect(parts.map((p) => p.status)).toEqual([201, 201]);
    const created = parts[0]?.body as Record<string, unknown>;
    // the deferred response of the travel shows the state after the whole change set
    expect(created).toMatchObject({ TravelID: "00000100", TotalPrice: "75.00" });
    expect(parts[1]?.body).toMatchObject({ TravelUUID: created["TravelUUID"], BookingID: "0001" });
  });

  it("rolls back a whole change set when one of its requests fails", async () => {
    const boundary = "batch_id-1700000000000-13";
    const body = batchBody(
      boundary,
      [
        { method: "PATCH", url: `Travel(${T1})`, body: { Description: "changed in a failing change set" }, headers: { "If-Match": "*" } },
        { method: "PATCH", url: `Travel(${T3})`, body: { EndDate: "2026-01-01" }, headers: { "If-Match": "*" } },
      ],
      true,
    );
    const response = await t.app.inject({ method: "POST", url: `${SERVICE}$batch`, headers: { "content-type": `multipart/mixed;boundary=${boundary}` }, payload: body });
    const parts = batchResponses(response.body);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.status).toBe(400);
    expect(parts[0]?.body).toMatchObject({ error: { message: "End date must not be before begin date", target: `/Travel(${T3})/EndDate` } });
    expect((await get(`Travel(${T1})`)).body["Description"]).toBe("Paris and Rome");
  });

  it("updates a booking through the navigation of its travel", async () => {
    const response = await send("PATCH", `Travel(${T1})/_Booking(${B1})`, { FlightPrice: "800.25" }, { "if-match": "*" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ BookingUUID: B1, FlightPrice: "800.25" });
    expect((await get(`Travel(${T1})`)).body["TotalPrice"]).toBe("1570.50");
    expect((await send("PATCH", `Travel(${T2})/_Booking(${B1})`, { FlightPrice: "1.00" }, { "if-match": "*" })).status).toBe(404);
  });
});
