/**
 * Features of a managed BO that the reference fixture does not use: early numbering with a
 * `FOR NUMBERING` handler, global feature control of an operation and of an action, dynamic
 * feature control of a field, an action with an entity result of cardinality [0..*], a static
 * function, determinations triggered by an update and by a deletion, side effects.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B1, generatedVariant, SERVICE, T1, T2, T3, writableApp, type TestApp } from "./helpers.js";
import { featuresVariant } from "./variants.js";

const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";

let t: TestApp;

beforeAll(async () => {
  t = await writableApp(
    generatedVariant(featuresVariant()),
  );
}, 180_000);

afterAll(async () => {
  await t?.close();
});

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true" };

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await t.app.inject({ method, url: `${SERVICE}${path}`, headers: { ...JSON_HEADERS, "if-match": "*" }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

describe("features beyond the reference fixture", () => {
  it("numbers a new travel with the FOR NUMBERING handler", async () => {
    const created = await call("POST", "Travel", { TravelID: "00000042", AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "40.00", CurrencyCode: "EUR" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ TravelUUID: "00000000-0000-0000-0000-000000000042", TravelID: "00000042", OverallStatus: "O" });
  });

  it("disables an operation and an action with global feature control", async () => {
    const deleted = await call("DELETE", `Travel(${T3})`);
    expect(deleted.status).toBe(409);
    expect(deleted.body).toMatchObject({ error: { message: expect.stringContaining("not possible") } });
    const copied = await call("POST", `Travel(${T1})/${NS}.copyTravel`, {});
    expect(copied.status).toBe(409);
    const read = await call("GET", `Travel(${T1})?$select=TravelID,__EntityControl,__OperationControl`);
    expect(read.body).toMatchObject({ __EntityControl: { Deletable: false, Updatable: true }, __OperationControl: { copyTravel: false, acceptTravel: true } });
  });

  it("makes a field read-only with instance feature control", async () => {
    const read = await call("GET", `Travel?$select=TravelID,__FieldControl&$filter=TravelID eq '00000001' or TravelID eq '00000002'&$orderby=TravelID`);
    expect((read.body["value"] as Array<Record<string, unknown>>).map((r) => r["__FieldControl"])).toEqual([{ Description: 3 }, { Description: 1 }]);
    const refused = await call("PATCH", `Travel(${T2})`, { Description: "changed" });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { message: "Description is read-only" } });
  });

  it("returns entities of another entity set from an action with result [0..*]", async () => {
    const response = await call("POST", `Travel(${T1})/${NS}.listBookings`, {});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const bookings = response.body["value"] as Array<Record<string, unknown>>;
    expect(bookings.map((b) => b["BookingID"]).sort()).toEqual(["0001", "0002", "0003"]);
    expect(bookings[0]).toHaveProperty("FlightPrice");
  });

  it("calls a static function", async () => {
    const response = await call("GET", `Travel/${NS}.mostExpensive()`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ TravelID: "00000001", TotalPrice: "1520.50" });
  });

  it("runs a determination triggered by an update", async () => {
    const response = await call("PATCH", `Travel(${T1})`, { BookingFee: "25.00" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ Description: "Paris and Rome (changed)", TotalPrice: "1525.50" });
  });

  it("runs a determination triggered by a deletion", async () => {
    expect((await call("DELETE", `Booking(${B1})`)).status).toBe(204);
    expect((await call("GET", `Travel(${T1})`)).body["TotalPrice"]).toBe("775.25");
  });

  it("describes the side effects and the global feature control in the metadata", async () => {
    const metadata = (await t.app.inject({ method: "GET", url: `${SERVICE}$metadata` })).body;
    expect(metadata).toMatch(/<Annotation Term="Common\.SideEffects" Qualifier="BookingFee">[\s\S]*?<PropertyPath>BookingFee<\/PropertyPath>[\s\S]*?<String>TotalPrice<\/String>/);
    expect(metadata).toMatch(/<Annotation Term="Capabilities\.DeleteRestrictions">[\s\S]*?<PropertyValue Property="Deletable" Path="__EntityControl\/Deletable"\/>/);
    expect(metadata).toContain('<Annotation Term="Core.OperationAvailable" Path="_it/__OperationControl/copyTravel"/>');
  });
});
