/**
 * Consumption of remote APIs in a behavior pool (D31): a REST API through the HTTP client of
 * ABAP Cloud (destination with basic authentication), an OData V4 service through the client
 * proxy and the consumption model class of an SCM2 (reads from the fixture service listening on a
 * port, writes to a mock that wants a CSRF token and ETags), an OData V2 service through the
 * client proxy and the abstract entity of an SCM.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixtureApp, generatedVariant, SERVICE, T1, T2, T3, writableApp, type TestApp } from "./helpers.js";
import { remoteVariant } from "./variants.js";

const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";
const JSON_HEADERS = { "content-type": "application/json;charset=UTF-8;IEEE754Compatible=true", accept: "application/json;odata.metadata=minimal;IEEE754Compatible=true", "if-match": "*" };

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let local: TestApp;
let remote: TestApp;
let mock: Server;
let mockBase = "";
const received: Received[] = [];
const remoteUrls: string[] = [];

// ------------------------------------------------------------------------------- the mock server

const ARCHIVE_ROOT = "/odata/v4/archive/";
const LEGACY_ROOT = "/sap/opu/odata/sap/ZLEGACY_SRV/";

const ARCHIVE_METADATA = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
  <edmx:DataServices>
    <Schema Namespace="archive" xmlns="http://docs.oasis-open.org/odata/ns/edm">
      <EntityType Name="TravelType">
        <Key><PropertyRef Name="TravelUUID"/></Key>
        <Property Name="TravelUUID" Type="Edm.Guid" Nullable="false"/>
        <Property Name="TravelID" Type="Edm.String" MaxLength="8"/>
        <Property Name="BeginDate" Type="Edm.Date"/>
        <Property Name="BookingFee" Type="Edm.Decimal" Precision="16" Scale="2"/>
        <Property Name="CurrencyCode" Type="Edm.String" MaxLength="5"/>
        <Property Name="Description" Type="Edm.String" MaxLength="256"/>
        <Property Name="LocalLastChangedAt" Type="Edm.DateTimeOffset" Precision="7"/>
      </EntityType>
      <EntityContainer Name="Container">
        <EntitySet Name="Travel" EntityType="archive.TravelType"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

const LEGACY_METADATA = `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:sap="http://www.sap.com/Protocols/SAPData">
  <edmx:DataServices m:DataServiceVersion="2.0">
    <Schema Namespace="ZLEGACY_SRV" xml:lang="en" sap:schema-version="1" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
      <EntityType Name="LegacyTravel" sap:content-version="1">
        <Key><PropertyRef Name="TravelID"/></Key>
        <Property Name="TravelID" Type="Edm.String" Nullable="false" MaxLength="8"/>
        <Property Name="Description" Type="Edm.String" MaxLength="80"/>
        <Property Name="Price" Type="Edm.Decimal" Precision="16" Scale="2"/>
        <Property Name="CurrencyCode" Type="Edm.String" MaxLength="5"/>
        <Property Name="StartDate" Type="Edm.DateTime" Precision="0"/>
        <Property Name="ChangedAt" Type="Edm.DateTimeOffset" Precision="7"/>
        <Property Name="Confirmed" Type="Edm.Boolean"/>
        <Property Name="Nights" Type="Edm.Int32"/>
      </EntityType>
      <EntityContainer Name="ZLEGACY_SRV_Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="LegacyTravelSet" EntityType="ZLEGACY_SRV.LegacyTravel"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`;

const START = Date.UTC(2026, 5, 1);
const CHANGED = Date.UTC(2026, 0, 1, 8, 0, 0, 500);

/** The archive service: the CSRF token changes after each creation, as after a session timeout. */
let token = 1;
const archive = new Map<string, Record<string, unknown> & { etag: number }>();

function reply(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { ...(body === undefined || typeof body === "string" ? {} : { "content-type": "application/json" }), ...headers });
  res.end(text);
}

function archiveRequest(req: Received, res: ServerResponse): void {
  const path = req.url.slice(ARCHIVE_ROOT.length);
  if (req.headers["authorization"] !== "Bearer archive-token" || req.headers["x-api-key"] !== "k-1") {
    return reply(res, 401, { error: { code: "401", message: "not authorized" } });
  }
  if (req.method === "HEAD" && path === "") {
    return reply(res, 200, undefined, req.headers["x-csrf-token"] === "Fetch" || req.headers["x-csrf-token"] === "fetch" ? { "x-csrf-token": `TOKEN-${token}`, "set-cookie": "archive-session=S1; Path=/; HttpOnly" } : {});
  }
  if (req.method === "GET" && path === "$metadata") {
    return reply(res, 200, ARCHIVE_METADATA, { "content-type": "application/xml" });
  }
  if (req.headers["x-csrf-token"] !== `TOKEN-${token}` || !String(req.headers["cookie"] ?? "").includes("archive-session=S1")) {
    return reply(res, 403, { error: { code: "403", message: "CSRF token validation failed" } }, { "x-csrf-token": "Required" });
  }
  const etagOf = (entity: { etag: number }): string => `W/"${entity.etag}"`;
  const show = (entity: Record<string, unknown> & { etag: number }): Record<string, unknown> => {
    const { etag, ...rest } = entity;
    return { "@odata.etag": etagOf({ etag }), ...rest };
  };
  if (req.method === "POST" && path === "Travel") {
    const body = JSON.parse(req.body) as Record<string, unknown>;
    if (body["TravelID"] === "00000003") {
      return reply(res, 409, { error: { code: "DUPLICATE", message: "Travel 00000003 is archived already" } });
    }
    const entity = { ...body, etag: 1 };
    archive.set(String(body["TravelUUID"]), entity);
    token++;
    return reply(res, 201, show(entity));
  }
  const key = /^Travel\(([0-9a-f-]{36})\)$/.exec(path)?.[1];
  const entity = key === undefined ? undefined : archive.get(key);
  if (entity === undefined || key === undefined) {
    return reply(res, 404, { error: { code: "404", message: `no resource ${path}` } });
  }
  if (req.headers["if-match"] !== etagOf(entity)) {
    return reply(res, 412, { error: { code: "412", message: "the ETag does not match" } });
  }
  if (req.method === "PATCH") {
    Object.assign(entity, JSON.parse(req.body) as Record<string, unknown>);
    entity.etag++;
    return reply(res, 200, show(entity));
  }
  if (req.method === "DELETE") {
    archive.delete(key);
    return reply(res, 204);
  }
  return reply(res, 405);
}

function legacyRequest(req: Received, res: ServerResponse): void {
  const path = req.url.slice(LEGACY_ROOT.length);
  if (path === "$metadata") {
    return reply(res, 200, LEGACY_METADATA, { "content-type": "application/xml" });
  }
  if (!path.startsWith("LegacyTravelSet?")) {
    return reply(res, 404, { error: { code: "404", message: { lang: "en", value: `no resource ${path}` } } });
  }
  const row = (id: string, description: string): Record<string, unknown> => ({
    __metadata: { id: `${LEGACY_ROOT}LegacyTravelSet('${id}')`, uri: `${LEGACY_ROOT}LegacyTravelSet('${id}')`, type: "ZLEGACY_SRV.LegacyTravel", etag: `W/"datetimeoffset'2026-01-01T08%3A00%3A00.5Z'"` },
    TravelID: id,
    Description: description,
    Price: "123.45",
    CurrencyCode: "EUR",
    StartDate: `/Date(${START})/`,
    ChangedAt: `/Date(${CHANGED}+0000)/`,
    Confirmed: true,
    Nights: 14,
  });
  return reply(res, 200, { d: { __count: "2", results: [row("00000001", "Legacy: Paris"), row("00000009", "Legacy: elsewhere")] } });
}

function ratingRequest(req: Received, res: ServerResponse): void {
  if (req.headers["authorization"] !== `Basic ${Buffer.from("rater:s3cret").toString("base64")}`) {
    return reply(res, 401, "unauthorized");
  }
  if (req.url.startsWith("/api/ratings/00000002")) {
    return reply(res, 503, "down for maintenance");
  }
  return reply(res, 200, "4", { "content-type": "text/plain", "x-source": "mock" });
}

async function startMock(): Promise<void> {
  mock = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request: Received = { method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      received.push(request);
      if (request.url.startsWith(ARCHIVE_ROOT)) {
        archiveRequest(request, res);
      } else if (request.url.startsWith(LEGACY_ROOT)) {
        legacyRequest(request, res);
      } else if (request.url.startsWith("/api/ratings/")) {
        ratingRequest(request, res);
      } else {
        reply(res, 404, { error: { code: "404", message: "not found" } });
      }
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  mockBase = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
}

// ------------------------------------------------------------------------------------- the apps

beforeAll(async () => {
  await startMock();
  // the remote OData V4 service: the fixture application (reads), on a port
  remote = await fixtureApp();
  await remote.pglite.exec("UPDATE zrt_travel SET description = 'Remote: Paris and Rome', booking_fee = 99.99 WHERE travel_id = '00000001'");
  await remote.app.listen({ port: 0, host: "127.0.0.1" });
  remote.app.server.on("request", (req: IncomingMessage) => remoteUrls.push(`${req.method} ${req.url}`));
  const remoteBase = `http://127.0.0.1:${(remote.app.server.address() as AddressInfo).port}`;

  process.env["DESTINATION_RATINGS_URL"] = mockBase;
  process.env["DESTINATION_RATINGS_USER"] = "rater";
  process.env["DESTINATION_RATINGS_PASSWORD"] = "s3cret";
  process.env["DESTINATION_ZRT_TRAVEL_REMOTE_URL"] = remoteBase;
  process.env["DESTINATION_ARCHIVE_URL"] = mockBase;
  process.env["DESTINATION_ARCHIVE_TOKEN"] = "archive-token";
  process.env["DESTINATION_ARCHIVE_HEADERS"] = JSON.stringify({ "X-Api-Key": "k-1" });
  process.env["DESTINATION_ZRT_LEGACY_URL"] = mockBase;

  local = await writableApp(generatedVariant(remoteVariant()));
}, 180_000);

afterAll(async () => {
  await local?.close();
  await remote?.close();
  await new Promise<void>((resolve) => (mock === undefined ? resolve() : mock.close(() => resolve())));
  for (const name of Object.keys(process.env).filter((n) => n.startsWith("DESTINATION_"))) {
    delete process.env[name];
  }
});

beforeEach(() => {
  received.length = 0;
  remoteUrls.length = 0;
});

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown>; messages: Array<Record<string, unknown>> }> {
  const response = await local.app.inject({ method, url: `${SERVICE}${path}`, headers: JSON_HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  const header = response.headers["sap-messages"];
  return {
    status: response.statusCode,
    body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>),
    messages: header === undefined ? [] : (JSON.parse(String(header)) as Array<Record<string, unknown>>),
  };
}

const description = async (travel: string): Promise<string> => String((await call("GET", `Travel(${travel})?$select=Description`)).body["Description"]);

// ------------------------------------------------------------------------------------ the tests

describe("a REST API through the HTTP client", () => {
  it("sends the request with the credentials of the destination", async () => {
    const response = await call("POST", `Travel(${T1})/${NS}.rateTravel`, {});
    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect(await description(T1)).toBe("Paris and Rome (4 stars, mock)");

    expect(received).toHaveLength(1);
    const [request] = received as [Received];
    expect(request).toMatchObject({ method: "POST", url: "/api/ratings/00000001?scale=5", body: '{"travel":"00000001"}' });
    expect(request.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("rater:s3cret").toString("base64")}`,
      accept: "application/json",
      "x-travel": "00000001",
      "content-type": "application/json",
    });
  });

  it("gives the status of the response to the ABAP code", async () => {
    const response = await call("POST", `Travel(${T2})/${NS}.rateTravel`, {});
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { message: "Rating service: 503 Service Unavailable" } });
    expect(await description(T2)).toBe("Business trip to Berlin");
  });

  it("raises cx_http_dest_provider_error for a destination that is not configured", async () => {
    const url = process.env["DESTINATION_RATINGS_URL"];
    delete process.env["DESTINATION_RATINGS_URL"];
    try {
      const response = await call("POST", `Travel(${T1})/${NS}.rateTravel`, {});
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: { message: "the destination RATINGS is not configured: set DESTINATION_RATINGS_URL" } });
    } finally {
      process.env["DESTINATION_RATINGS_URL"] = url;
    }
  });

  it("raises cx_web_http_client_error when the connection fails", async () => {
    // a port nothing listens on
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const url = process.env["DESTINATION_RATINGS_URL"];
    process.env["DESTINATION_RATINGS_URL"] = `http://127.0.0.1:${port}`;
    try {
      const response = await call("POST", `Travel(${T1})/${NS}.rateTravel`, {});
      expect(response.status).toBe(400);
      const message = String((response.body["error"] as Record<string, unknown>)["message"]);
      expect(message).toContain(`POST http://127.0.0.1:${port}/api/ratings/00000001?scale=5`);
      expect(message).toContain("ECONNREFUSED");
    } finally {
      process.env["DESTINATION_RATINGS_URL"] = url;
    }
  });
});

describe("an OData V4 service through the client proxy (SCM2)", () => {
  it("reads a list with $filter, $select, $orderby, $top, $count and an instance by key", async () => {
    const response = await call("POST", `Travel(${T1})/${NS}.importRemote`, {});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    // the description and the booking fee of the remote travel; the determination recalculates the total
    expect(response.body).toMatchObject({ TravelUUID: T1, Description: "Remote: Paris and Rome", BookingFee: "99.99", TotalPrice: "1600.49" });
    expect(response.messages).toEqual([
      expect.objectContaining({ message: '1 remote travel(s); 00000001 begins on 20260601, changed at 20260110080000.1234560, ETag W/"2026-01-10T08:00:00.123456Z"', numericSeverity: 2 }),
    ]);

    const filter = encodeURIComponent("TravelID eq '00000001'").replace(/'/g, "%27");
    const select = encodeURIComponent("TravelUUID,TravelID,Description,BookingFee,BeginDate,LocalLastChangedAt");
    expect(remoteUrls).toEqual([
      `GET ${SERVICE}$metadata`,
      `GET ${SERVICE}Travel?$top=10&$count=true&$filter=${filter}&$select=${select}&$orderby=${encodeURIComponent("TravelID desc")}`,
      `GET ${SERVICE}Travel(${T1})`,
    ]);
  });

  it("creates, updates with the ETag and deletes, with the CSRF token of the service", async () => {
    const response = await call("POST", `Travel(${T1})/${NS}.exportRemote`, {});
    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect(response.messages).toEqual([expect.objectContaining({ message: 'Archived: Remote: Paris and Rome (archived) (W/"2")' })]);

    const requests = received.map((r) => `${r.method} ${r.url}`);
    expect(requests).toEqual([
      `GET ${ARCHIVE_ROOT}$metadata`,
      `HEAD ${ARCHIVE_ROOT}`,
      `POST ${ARCHIVE_ROOT}Travel`,
      // the token changed: refused, fetched again, sent again
      `PATCH ${ARCHIVE_ROOT}Travel(${T1})`,
      `HEAD ${ARCHIVE_ROOT}`,
      `PATCH ${ARCHIVE_ROOT}Travel(${T1})`,
      `DELETE ${ARCHIVE_ROOT}Travel(${T1})`,
    ]);
    const post = received[2] as Received;
    expect(post.headers).toMatchObject({ "x-csrf-token": "TOKEN-1", authorization: "Bearer archive-token", "x-api-key": "k-1", "content-type": "application/json;IEEE754Compatible=true" });
    expect(post.headers["cookie"]).toContain("archive-session=S1");
    expect(JSON.parse(post.body)).toEqual({
      TravelUUID: T1,
      TravelID: "00000001",
      BeginDate: "2026-06-01",
      BookingFee: "99.99",
      CurrencyCode: "EUR",
      Description: "Remote: Paris and Rome",
      LocalLastChangedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$/),
    });
    const patch = received[5] as Received;
    expect(patch.headers).toMatchObject({ "x-csrf-token": "TOKEN-2", "if-match": 'W/"1"' });
    expect(JSON.parse(patch.body)).toEqual({ Description: "Remote: Paris and Rome (archived)" });
    expect((received[6] as Received).headers["if-match"]).toBe('W/"2"');
    expect(archive.size).toBe(0);
  });

  it("raises /iwbep/cx_cp_remote with the status and the message of the service", async () => {
    const response = await call("POST", `Travel(${T3})/${NS}.exportRemote`, {});
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { message: "Archive refused (409): POST Travel: HTTP 409 Travel 00000003 is archived already" } });
  });
});

describe("an OData V2 service through the client proxy (SCM, abstract entity)", () => {
  it("reads a list with $filter, $top and $inlinecount, the values converted", async () => {
    const response = await call("POST", `Travel(${T1})/${NS}.importLegacy`, {});
    expect(response.status, JSON.stringify(response.body)).toBe(204);
    expect(await description(T1)).toBe("Legacy: Paris");
    expect(response.messages).toEqual([
      expect.objectContaining({ message: "2 legacy travel(s): 123.45 EUR, starts 20260601, 14 nights, confirmed X, changed 20260101080000.5000000" }),
    ]);
    // fetch writes the quotes of the query as %27 (WHATWG URL)
    const filter = encodeURIComponent("(TravelID eq '00000001') and ((Nights ge 1 and Nights le 30))").replace(/'/g, "%27");
    expect(received.map((r) => `${r.method} ${r.url}`)).toEqual([`GET ${LEGACY_ROOT}$metadata`, `GET ${LEGACY_ROOT}LegacyTravelSet?$top=5&$inlinecount=allpages&$filter=${filter}`]);
    expect((received[1] as Received).headers["accept"]).toBe("application/json");
  });
});
