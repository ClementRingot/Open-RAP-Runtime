/**
 * Parameters of view entities (D107): `with parameters`, `$parameters` in the select list and the
 * WHERE, a system field filled from the session, a view passing a literal to a parameterized
 * view, and the OData access View(p=…)/Set.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generatedVariant, SERVICE, writableApp, type TestApp } from "./helpers.js";

const lf = (content: string): string => content.replace(/\r\n/g, "\n");

const BY_STATUS = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Travels of a status'
define view entity ZRT_I_TravelByStatus
  with parameters
    p_status : abap.char(1),
    @Environment.systemField: #SYSTEM_DATE
    p_today  : abap.dats
  as select from zrt_travel
{
  key travel_uuid        as TravelUUID,
      travel_id          as TravelID,
      overall_status     as OverallStatus,
      $parameters.p_today as Today
}
where overall_status = $parameters.p_status
`;

const OPEN = `@AccessControl.authorizationCheck: #NOT_REQUIRED
define view entity ZRT_I_OpenTravel
  as select from ZRT_I_TravelByStatus( p_status: 'O' )
{
  key TravelUUID,
      TravelID
}
`;

let test: TestApp;

beforeAll(async () => {
  test = await writableApp(
    generatedVariant({
      "zrt_i_travelbystatus.ddls.asddls": BY_STATUS,
      "zrt_i_opentravel.ddls.asddls": OPEN,
      "zrt_ui_travel.srvd.srvdsrv": (c) =>
        lf(c).replace("  expose ZRT_C_Booking as Booking;", "  expose ZRT_C_Booking as Booking;\n  expose ZRT_I_TravelByStatus as TravelByStatus;\n  expose ZRT_I_OpenTravel as OpenTravel;"),
    }),
  );
}, 180_000);

afterAll(async () => {
  await test?.close();
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await test.app.inject({ method: "GET", url: `${SERVICE}${path}`, headers: { accept: "application/json" } });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

describe("parameters of view entities (D107)", () => {
  it("reads View(p=…)/Set with the parameters, a system field from the session", async () => {
    const accepted = await get("TravelByStatus(p_status='A')/Set?$select=TravelID,OverallStatus,Today");
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const rows = accepted.body["value"] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r["OverallStatus"] === "A" && r["Today"] === new Date().toISOString().slice(0, 10))).toBe(true);
    const all = (await get("Travel?$select=OverallStatus")).body["value"] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(all.filter((t) => t["OverallStatus"] === "A").length);
    // the system field can be given
    expect(((await get("TravelByStatus(p_status='A',p_today=2020-01-31)/Set?$select=Today")).body["value"] as Array<Record<string, unknown>>)[0]).toMatchObject({ Today: "2020-01-31" });
    // a parameter without system field is needed
    expect((await get("TravelByStatus/Set")).status).toBe(400);
    expect((await get("TravelByStatus")).status).toBe(400);
  });

  it("reads a view passing a literal to a parameterized view", async () => {
    const open = await get("OpenTravel?$select=TravelID");
    expect(open.status, JSON.stringify(open.body)).toBe(200);
    const all = (await get("Travel?$select=OverallStatus")).body["value"] as Array<Record<string, unknown>>;
    expect(open.body["value"]).toHaveLength(all.filter((t) => t["OverallStatus"] === "O").length);
  });

  it("describes the parameters as an entity type with the navigation Set", async () => {
    const metadata = (await test.app.inject({ method: "GET", url: `${SERVICE}$metadata` })).body;
    expect(metadata).toMatch(/<EntityType Name="TravelByStatusParameters">\s*<Key>\s*<PropertyRef Name="p_status"\/>\s*<PropertyRef Name="p_today"\/>/);
    expect(metadata).toMatch(/<NavigationProperty Name="Set" Type="Collection\([^)]+\.TravelByStatusType\)" Partner="Parameters" ContainsTarget="true"\/>/);
    expect(metadata).toMatch(/<EntitySet Name="TravelByStatus" EntityType="[^"]+\.TravelByStatusParameters"/);
  });
});
