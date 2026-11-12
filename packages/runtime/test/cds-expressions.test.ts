/**
 * Calculated elements of the CDS views (D67): computed by the PostgreSQL views, read-only in OData
 * (Core.Computed), ignored in the request bodies, and computed from the draft values in a draft.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DRAFT_CHANGES, generatedVariant, SERVICE, T1, T2, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");

const CHANGES: Record<string, (content: string) => string> = {
  ...Object.fromEntries(Object.entries(DRAFT_CHANGES).map(([file, change]) => [file, (c: string) => change(lf(c))])),
  "zrt_r_travel.ddls.asddls": (c) =>
    lf(c).replace(
      "      _Booking\n",
      [
        "      booking_fee + total_price as TotalWithFee,",
        "      case overall_status when 'A' then 'Accepted' else 'Open' end as StatusText,",
        "      dats_days_between( begin_date, end_date ) as Duration,",
        "      _Booking",
        "",
      ].join("\n"),
    ),
  "zrt_c_travel.ddls.asddls": (c) =>
    lf(c).replace("      _Booking : redirected", "      TotalWithFee,\n      StatusText,\n      Duration,\n      upper( Description ) as DescriptionUpper,\n      _Booking : redirected"),
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

const travel = (uuid: string, active: boolean): string => `Travel(TravelUUID=${uuid},IsActiveEntity=${active})`;
const SELECT = "$select=TravelUUID,Description,TotalWithFee,StatusText,Duration,DescriptionUpper";

describe("calculated elements (D67)", () => {
  it("marks them Core.Computed in the $metadata", async () => {
    const metadata = (await test.app.inject({ method: "GET", url: `${SERVICE}$metadata` })).body;
    expect(metadata).toMatch(/<Annotations Target="[^"]+\.TravelType\/TotalWithFee">\s*<Annotation Term="Core\.Computed"\/>/);
    expect(metadata).toMatch(/<Annotations Target="[^"]+\.TravelType\/DescriptionUpper">\s*<Annotation Term="Core\.Computed"\/>/);
  });

  it("reads the values computed by the CDS view", async () => {
    const read = await call("GET", `Travel?$filter=IsActiveEntity eq true and StatusText eq 'Accepted'&${SELECT}`);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body["value"]).toEqual([
      expect.objectContaining({ TravelUUID: T2, TotalWithFee: 320, StatusText: "Accepted", Duration: 2, DescriptionUpper: "BUSINESS TRIP TO BERLIN" }),
    ]);
  });

  it("ignores them in the request bodies and computes them from the draft values", async () => {
    const edit = await call("POST", `${travel(T1, true)}/com.sap.gateway.srvd.zrt_ui_travel.v0001.Edit`, { PreserveChanges: true });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const patched = await call("PATCH", travel(T1, false), { Description: "Lyon", EndDate: "2026-06-03", TotalWithFee: 1, DescriptionUpper: "X" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const draft = await call("GET", `${travel(T1, false)}?${SELECT}`);
    expect(draft.body).toMatchObject({ Description: "Lyon", DescriptionUpper: "LYON", Duration: 2, TotalWithFee: 1540.5, StatusText: "Open" });
    const activated = await call("POST", `${travel(T1, false)}/com.sap.gateway.srvd.zrt_ui_travel.v0001.Activate`, {});
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect((await call("GET", `${travel(T1, true)}?${SELECT}`)).body).toMatchObject({ DescriptionUpper: "LYON", Duration: 2, TotalWithFee: 1540.5 });
  });
});
