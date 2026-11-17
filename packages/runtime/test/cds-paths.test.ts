/**
 * Elements reached through to-one associations (D100): `_Travel.TravelID as TravelNumber` in a
 * view entity and `_Travel.Description` in a projection, read-only (Core.Computed), computed by the
 * PostgreSQL views, also for the drafts.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRAFT_CHANGES, generatedVariant, SERVICE, T1, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");
const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";

const CHANGES: Record<string, (content: string) => string> = {
  ...Object.fromEntries(Object.entries(DRAFT_CHANGES).map(([file, change]) => [file, (c: string) => change(lf(c))])),
  "zrt_r_booking.ddls.asddls": (c) => lf(c).replace("      _Travel\n", "      _Travel.TravelID as TravelNumber,\n      concat( _Travel.TravelID, booking_id ) as BookingKey,\n      _Travel\n"),
  "zrt_c_booking.ddls.asddls": (c) => lf(c).replace("      _Travel : redirected", "      TravelNumber,\n      BookingKey,\n      _Travel.Description as TravelDescription,\n      _Travel : redirected"),
};

let test: TestApp;

beforeAll(async () => {
  test = await writableApp(generatedVariant(CHANGES));
}, 180_000);

afterAll(async () => {
  await test?.close();
});

const HEADERS = { "content-type": "application/json", accept: "application/json", "if-match": "*" };

async function call(method: "GET" | "POST" | "PATCH", url: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await test.app.inject({ method, url: `${SERVICE}${url}`, headers: HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

const travel = (active: boolean): string => `Travel(TravelUUID=${T1},IsActiveEntity=${active})`;
const SELECT = "$select=BookingID,TravelNumber,BookingKey,TravelDescription";

describe("elements of associations (D100)", () => {
  it("describes them read-only, with the label of the element they reach", async () => {
    const metadata = (await test.app.inject({ method: "GET", url: `${SERVICE}$metadata` })).body;
    expect(metadata).toMatch(/<Property Name="TravelDescription" Type="Edm.String"/);
    expect(metadata).toMatch(/<Annotations Target="[^"]+\.BookingType\/TravelNumber">[\s\S]*?<Annotation Term="Core\.Computed"\/>/);
    expect(metadata).toMatch(/<Annotations Target="[^"]+\.BookingType\/TravelDescription">\s*<Annotation Term="Common\.Label" String="Description"\/>/);
  });

  it("reads the values of the parent, in the view entity, an expression and the projection", async () => {
    const read = await call("GET", `${travel(true)}/_Booking?${SELECT}&$orderby=BookingID`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body["value"]).toEqual([
      expect.objectContaining({ BookingID: "0001", TravelNumber: "00000001", BookingKey: "000000010001", TravelDescription: "Paris and Rome" }),
      expect.objectContaining({ BookingID: "0002", TravelNumber: "00000001", BookingKey: "000000010002", TravelDescription: "Paris and Rome" }),
      expect.objectContaining({ BookingID: "0003", TravelNumber: "00000001", BookingKey: "000000010003", TravelDescription: "Paris and Rome" }),
    ]);
    // filtered like any element
    const filtered = (await call("GET", `Booking?$filter=IsActiveEntity eq true and TravelDescription eq 'Paris and Rome'&$select=TravelDescription`)).body["value"] as Array<Record<string, unknown>>;
    expect(filtered.length).toBeGreaterThanOrEqual(3);
    expect(filtered.every((b) => b["TravelDescription"] === "Paris and Rome")).toBe(true);
    expect((await call("GET", `Booking?$filter=IsActiveEntity eq true and TravelDescription eq 'nowhere'&$select=BookingID`)).body["value"]).toEqual([]);
  });

  it("computes them for the drafts from the active instances they reach, and ignores them in the bodies", async () => {
    expect((await call("POST", `${travel(true)}/${NS}.Edit`, { PreserveChanges: true })).status).toBe(201);
    const draft = (await call("GET", `${travel(false)}/_Booking?$select=BookingUUID,TravelNumber,TravelDescription&$orderby=BookingID`)).body["value"] as Array<Record<string, unknown>>;
    expect(draft).toHaveLength(3);
    expect(draft[0]).toMatchObject({ TravelNumber: "00000001", TravelDescription: "Paris and Rome" });
    const key = `Booking(BookingUUID=${String(draft[0]?.["BookingUUID"])},IsActiveEntity=false)`;
    expect((await call("PATCH", key, { TravelDescription: "ignored", CarrierID: "AF" })).status).toBe(200);
    expect((await call("GET", `${key}?$select=TravelDescription,CarrierID`)).body).toMatchObject({ TravelDescription: "Paris and Rome", CarrierID: "AF" });
    expect((await call("POST", `${travel(false)}/${NS}.Discard`, {})).status).toBe(204);
  });
});
