/**
 * A managed BO with additional save: the RAP runtime writes the persistent tables and
 * save_modified writes a log table of its own in plain ABAP SQL; its failed rolls the LUW back.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, T1, T3, writableApp, type TestApp } from "./helpers.js";
import { additionalSaveVariant } from "./variants.js";

let t: TestApp;

beforeAll(async () => {
  t = await writableApp(generatedVariant(additionalSaveVariant()));
}, 180_000);

afterAll(async () => {
  await t?.close();
});

const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true", "if-match": "*" };

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await t.app.inject({ method, url: `${SERVICE}${path}`, headers: JSON_HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

async function log(): Promise<Array<Record<string, unknown>>> {
  return (await t.pglite.query<Record<string, unknown>>("SELECT travel_uuid::text AS travel, operation, description, logged_by, logged_on IS NOT NULL AS dated FROM zrt_travel_log ORDER BY operation, description")).rows;
}

describe("managed BO with additional save", () => {
  it("writes the BO and a log row per created, changed and deleted travel", async () => {
    const created = await call("POST", "Travel", { TravelID: "00000042", AgencyID: "070001", CustomerID: "000001", BeginDate: "2027-05-01", EndDate: "2027-05-08", BookingFee: "40.00", CurrencyCode: "EUR", Description: "Logged" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await call("PATCH", `Travel(${T1})`, { Description: "Changed" })).status).toBe(200);
    expect((await call("PATCH", `Travel(${T1})`, { BookingFee: "21.00" })).status).toBe(200);
    expect((await call("DELETE", `Travel(${T3})`)).status).toBe(204);
    // the managed save wrote the BO
    expect((await t.pglite.query("SELECT description FROM zrt_travel WHERE travel_id = '00000042'")).rows).toEqual([{ description: "Logged" }]);
    expect((await call("GET", `Travel(${T3})`)).status).toBe(404);
    expect(await log()).toEqual([
      { travel: String(created.body["TravelUUID"]), operation: "C", description: "Logged", logged_by: "DEVELOPER", dated: true },
      { travel: T3, operation: "D", description: "", logged_by: "DEVELOPER", dated: true },
      { travel: T1, operation: "U", description: "", logged_by: "DEVELOPER", dated: true },
      { travel: T1, operation: "U", description: "Changed", logged_by: "DEVELOPER", dated: true },
    ]);
  });

  it("rolls back the managed save when the saver fails (cl_abap_behavior_saver_failed)", async () => {
    const before = await log();
    const refused = await call("PATCH", `Travel(${T1})`, { Description: "Refused by the saver" });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { message: "The saver refuses this description" } });
    expect((await t.pglite.query(`SELECT description FROM zrt_travel WHERE travel_uuid = '${T1}'`)).rows).toEqual([{ description: "Changed" }]);
    expect(await log()).toEqual(before);
  });

  it("rolls the log back with the LUW when a validation fails", async () => {
    const before = (await log()).length;
    const refused = await call("PATCH", `Travel(${T1})`, { EndDate: "2020-01-01" });
    expect(refused.status).toBe(400);
    expect((await log()).length).toBe(before);
  });
});
