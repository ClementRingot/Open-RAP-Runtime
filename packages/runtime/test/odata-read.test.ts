/**
 * Conformance of the reads with the requests an OpenUI5 / Fiori Elements V4 List Report and
 * Object Page send (PLAN.md, annex A, cases 1 to 11 and error cases).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B1, B2, B3, B4, batchBody, batchResponses, fixtureApp, SERVICE, T1, T2, T3, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await fixtureApp();
});
afterAll(async () => {
  await t.close();
});

const ACCEPT = "application/json;odata.metadata=minimal;IEEE754Compatible=true";
const LIST_SELECT = "AgencyID,BeginDate,CurrencyCode,EndDate,OverallStatus,TotalPrice,TravelID,TravelUUID";

async function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown>; headers: Record<string, unknown>; text: string }> {
  const response = await t.app.inject({ method: "GET", url: `${SERVICE}${url}`, headers: { accept: ACCEPT, ...headers } });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(response.body) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: response.statusCode, json, headers: response.headers, text: response.body };
}

const values = (r: { json: Record<string, unknown> }): Array<Record<string, unknown>> => r.json["value"] as Array<Record<string, unknown>>;
const ids = (r: { json: Record<string, unknown> }): unknown[] => values(r).map((v) => v["TravelID"] ?? v["BookingID"]);

describe("service root, $metadata, CSRF", () => {
  it("answers HEAD with a CSRF token (UI5 fetches it before its first $batch)", async () => {
    const response = await t.app.inject({ method: "HEAD", url: SERVICE, headers: { "x-csrf-token": "Fetch" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["x-csrf-token"]).toMatch(/^[\w-]{20,}$/);
    expect(response.headers["odata-version"]).toBe("4.0");
  });

  it("serves the service document and $metadata", async () => {
    const doc = await get("");
    expect(doc.json).toEqual({
      "@odata.context": "$metadata",
      value: [
        { name: "Travel", kind: "EntitySet", url: "Travel" },
        { name: "Booking", kind: "EntitySet", url: "Booking" },
      ],
    });
    const metadata = await t.app.inject({ method: "GET", url: `${SERVICE}$metadata?sap-language=FR`, headers: { accept: "application/xml" } });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.headers["content-type"]).toContain("application/xml");
    expect(metadata.body).toContain('<EntityType Name="TravelType">');
  });
});

describe("List Report", () => {
  it("1. initial list in a $batch: $count, $select, $skip, $top, ETag, IEEE754Compatible", async () => {
    const boundary = "batch_id-1731160000000-12";
    const response = await t.app.inject({
      method: "POST",
      url: `${SERVICE}$batch?sap-client=100`,
      headers: { "content-type": `multipart/mixed;boundary=${boundary}`, accept: "multipart/mixed" },
      payload: batchBody(boundary, [{ url: `Travel?$count=true&$select=${LIST_SELECT}&$skip=0&$top=30` }]),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^multipart\/mixed; boundary=batchresponse_/);
    const [part] = batchResponses(response.body);
    expect(part?.status).toBe(200);
    expect(part?.headers["content-type"]).toBe(ACCEPT);
    const body = part?.body as Record<string, unknown>;
    expect(body["@odata.count"]).toBe(3);
    expect(body["@odata.context"]).toBe(`$metadata#Travel(TravelUUID,TravelID,AgencyID,BeginDate,EndDate,TotalPrice,CurrencyCode,OverallStatus,LocalLastChangedAt)`);
    const first = (body["value"] as Array<Record<string, unknown>>)[0];
    expect(first).toEqual({
      "@odata.etag": 'W/"2026-01-10T08:00:00.123456Z"',
      TravelUUID: T1,
      TravelID: "00000001",
      AgencyID: "070001",
      BeginDate: "2026-06-01",
      EndDate: "2026-06-15",
      TotalPrice: "1520.50",
      CurrencyCode: "EUR",
      OverallStatus: "O",
      LocalLastChangedAt: "2026-01-10T08:00:00.1234560Z",
    });
  });

  it("2. filter bar: eq, and, or with parentheses", async () => {
    const r = await get(`Travel?$count=true&$filter=OverallStatus%20eq%20'O'%20and%20(AgencyID%20eq%20'070001'%20or%20AgencyID%20eq%20'070002')&$select=TravelID&$skip=0&$top=30`);
    expect(r.status).toBe(200);
    expect(r.json["@odata.count"]).toBe(1);
    expect(ids(r)).toEqual(["00000001"]);
  });

  it("3. date range with ge and le", async () => {
    const r = await get(`Travel?$filter=BeginDate ge 2026-01-01 and BeginDate le 2026-12-31&$select=TravelID`);
    expect(ids(r)).toEqual(["00000001", "00000002"]);
  });

  it("4. contains and startswith", async () => {
    expect(ids(await get(`Travel?$filter=contains(Description,'Rome')&$select=TravelID`))).toEqual(["00000001"]);
    expect(ids(await get(`Travel?$filter=startswith(Description,'Bus')&$select=TravelID`))).toEqual(["00000002"]);
    expect(ids(await get(`Travel?$filter=endswith(Description,'days')&$select=TravelID`))).toEqual(["00000003"]);
    // % and _ are literal characters, not wildcards
    expect(ids(await get(`Travel?$filter=contains(Description,'%25')&$select=TravelID`))).toEqual([]);
  });

  it("5. exclusion with not and ne", async () => {
    expect(ids(await get(`Travel?$filter=not (OverallStatus eq 'X')&$select=TravelID`))).toEqual(["00000001", "00000002"]);
    expect(ids(await get(`Travel?$filter=OverallStatus ne 'X'&$select=TravelID`))).toEqual(["00000001", "00000002"]);
  });

  it("6. sort descending, keys as tie-breaker", async () => {
    expect(ids(await get(`Travel?$orderby=BeginDate desc&$select=TravelID`))).toEqual(["00000003", "00000002", "00000001"]);
    expect(ids(await get(`Travel?$orderby=CurrencyCode,TravelID desc&$select=TravelID`))).toEqual(["00000003", "00000001", "00000002"]);
  });

  it("7. basic search on the search fields, case-insensitive", async () => {
    expect(ids(await get(`Travel?$search=paris&$select=TravelID`))).toEqual(["00000001"]);
    expect(ids(await get(`Travel?$search=00000002&$select=TravelID`))).toEqual(["00000002"]);
    expect(ids(await get(`Travel?$search=trip%20berlin&$count=true&$select=TravelID`))).toEqual(["00000002"]);
    const booking = await get(`Booking?$search=AF`);
    expect(booking.status).toBe(400);
  });

  it("8. paging with $skip and $top, the count ignoring the page", async () => {
    const r = await get(`Travel?$count=true&$orderby=TravelID&$skip=1&$top=1&$select=TravelID`);
    expect(r.json["@odata.count"]).toBe(3);
    expect(ids(r)).toEqual(["00000002"]);
  });

  it("serializes decimals as JSON numbers without IEEE754Compatible", async () => {
    const r = await get(`Travel(${T1})?$select=TotalPrice`, { accept: "application/json" });
    expect(r.text).toContain('"TotalPrice":1520.50');
    expect(r.headers["content-type"]).toBe("application/json;odata.metadata=minimal;IEEE754Compatible=false");
  });
});

describe("Object Page", () => {
  it("9. reads one entity by short and by named key, with its ETag header", async () => {
    const short = await get(`Travel(${T1})?$select=TravelID,Description`);
    expect(short.status).toBe(200);
    expect(short.json).toEqual({
      "@odata.context": "$metadata#Travel(TravelUUID,TravelID,Description,LocalLastChangedAt)/$entity",
      "@odata.etag": 'W/"2026-01-10T08:00:00.123456Z"',
      TravelUUID: T1,
      TravelID: "00000001",
      Description: "Paris and Rome",
      LocalLastChangedAt: "2026-01-10T08:00:00.1234560Z",
    });
    expect(short.headers["etag"]).toBe('W/"2026-01-10T08:00:00.123456Z"');
    const named = await get(`Travel(TravelUUID=${T2})?$select=TravelID`);
    expect(named.json["TravelID"]).toBe("00000002");
  });

  it("10. reads the bookings of a travel through the navigation, sorted and counted", async () => {
    const r = await get(`Travel(${T1})/_Booking?$count=true&$orderby=BookingID desc&$select=BookingID,BookingUUID,CurrencyCode,FlightDate,FlightPrice&$skip=0&$top=2`);
    expect(r.status).toBe(200);
    expect(r.json["@odata.count"]).toBe(3);
    expect(values(r).map((b) => b["BookingUUID"])).toEqual([B3, B2]);
    expect(values(r)[0]).toMatchObject({ FlightPrice: "0.00", FlightDate: "2026-06-08" });
    expect((await get(`Travel(${T1})/_Booking/$count`)).text).toBe("3");
    const one = await get(`Travel(${T1})/_Booking(${B1})?$select=BookingID`);
    expect(one.json["BookingID"]).toBe("0001");
  });

  it("11. expands the parent of a booking and the bookings of a travel", async () => {
    const booking = await get(`Booking(${B4})?$select=BookingID&$expand=_Travel($select=TravelID,TravelUUID)`);
    expect(booking.json["_Travel"]).toMatchObject({ TravelID: "00000002", TravelUUID: T2, "@odata.etag": 'W/"2026-01-11T09:00:00.500000Z"' });
    expect(booking.json["TravelUUID"]).toBeUndefined();
    const travels = await get(`Travel?$orderby=TravelID&$select=TravelID&$expand=_Booking($select=BookingID;$orderby=BookingID desc;$top=1;$count=true)`);
    const list = values(travels);
    expect(list.map((x) => [x["TravelID"], x["_Booking@odata.count"], (x["_Booking"] as Array<Record<string, unknown>>).map((b) => b["BookingID"])])).toEqual([
      ["00000001", 3, ["0003"]],
      ["00000002", 1, ["0001"]],
      ["00000003", 0, []],
    ]);
    const parent = await get(`Travel(${T1})/_Booking(${B1})/_Travel?$select=TravelID`);
    expect(parent.json["TravelID"]).toBe("00000001");
  });

  it("filters on a to-one navigation path", async () => {
    const r = await get(`Booking?$filter=_Travel/OverallStatus eq 'A'&$select=BookingID,BookingUUID`);
    expect(values(r).map((b) => b["BookingUUID"])).toEqual([B4]);
  });

  it("supports in, tolower, length, year and null comparisons", async () => {
    expect(ids(await get(`Travel?$filter=OverallStatus in ('A','X')&$select=TravelID`))).toEqual(["00000002", "00000003"]);
    expect(ids(await get(`Travel?$filter=tolower(Description) eq 'ski holidays'&$select=TravelID`))).toEqual(["00000003"]);
    expect(ids(await get(`Travel?$filter=length(Description) gt 20&$select=TravelID`))).toEqual(["00000002"]);
    expect(ids(await get(`Travel?$filter=year(BeginDate) eq 2027&$select=TravelID`))).toEqual(["00000003"]);
    expect(ids(await get(`Travel?$filter=EndDate ne null&$select=TravelID`))).toHaveLength(3);
    expect(ids(await get(`Travel?$filter=LocalLastChangedAt gt 2026-01-11T00:00:00Z&$select=TravelID`))).toEqual(["00000002", "00000003"]);
    expect(ids(await get(`Booking?$filter=TravelUUID eq ${T1} and FlightPrice ge 500&$orderby=BookingID&$select=BookingID`))).toEqual(["0001", "0002"]);
  });
});

describe("errors (OData V4 JSON format)", () => {
  it.each([
    [`Travel?$select=Unknown`, 400, "$select: TravelType has no property Unknown"],
    [`Travel?$filter=Unknown eq 1`, 400, "TravelType has no property Unknown"],
    [`Travel?$filter=TravelID eq`, 400, 'Invalid $filter "TravelID eq": syntax error at end'],
    [`Travel?$filter=BeginDate eq 'x'`, 400, "BeginDate: the literal 'x' does not match the type Edm.Date"],
    [`Travel?$top=-1`, 400, "$top must be a non-negative integer"],
    [`Travel?$unknown=1`, 400, "Unknown system query option $unknown"],
    [`Nothing`, 400, "Unknown entity set Nothing"],
    [`Travel(00000000-0000-0000-0000-000000000000)`, 404, "Travel(00000000-0000-0000-0000-000000000000) not found"],
    [`Travel(${T3})/_Booking(${B1})`, 404, `Booking(${B1}) not found`],
    [`Travel?$apply=groupby((AgencyID))`, 400, "$apply is not supported"],
  ])("GET %s → %i", async (url, status, message) => {
    const r = await get(url);
    expect(r.status).toBe(status);
    expect(r.json["error"]).toMatchObject({ message, "@Common.numericSeverity": 4 });
  });

  it("rejects writes until the write handler is configured", async () => {
    const response = await t.app.inject({ method: "POST", url: `${SERVICE}Travel`, headers: { "content-type": "application/json" }, payload: "{}" });
    expect(response.statusCode).toBe(501);
  });

  it("answers each request of a $batch independently", async () => {
    const boundary = "batch_x";
    const response = await t.app.inject({
      method: "POST",
      url: `${SERVICE}$batch`,
      headers: { "content-type": `multipart/mixed; boundary=${boundary}` },
      payload: batchBody(boundary, [{ url: "Travel?$select=Nope" }, { url: `Travel(${T2})?$select=TravelID` }, { url: `${SERVICE}Booking/$count` }]),
    });
    const parts = batchResponses(response.body);
    expect(parts.map((p) => p.status)).toEqual([400, 200, 200]);
    expect((parts[1]?.body as Record<string, unknown>)["TravelID"]).toBe("00000002");
    expect(parts[2]?.body).toBe(4);
  });
});

describe("bookings of the seed", () => {
  it("are all readable", async () => {
    const r = await get(`Booking?$orderby=BookingUUID&$select=BookingUUID`);
    expect(values(r).map((b) => b["BookingUUID"])).toEqual([B1, B2, B3, B4]);
  });
});
