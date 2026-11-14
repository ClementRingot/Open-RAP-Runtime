/**
 * Draft (D54): the Travel fixture with draft, through OData: new drafts, draft children, the
 * activation (determinations, validations), Edit of an active instance and its exclusive lock,
 * Discard, the drafts of the other users.
 */

import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { PGliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDatabase, PGLITE_PARSERS, type Database } from "../src/db/database.js";
import { RapRuntime } from "../src/rap/runtime.js";
import { B2, DRAFT_CHANGES, generatedVariant, SEED, SERVICE, T1, T2, type GeneratedFixture } from "./helpers.js";

const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";
let fixture: GeneratedFixture;
let db: Database;
let alice: FastifyInstance;
let bob: FastifyInstance;

beforeAll(async () => {
  fixture = await generatedVariant(DRAFT_CHANGES);
  const pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
  await pglite.exec("SET TIME ZONE 'UTC'");
  await pglite.exec(fixture.schema);
  await pglite.exec(SEED);
  db = createDatabase(new PGliteDialect({ pglite }));
  const rap = await RapRuntime.load(fixture.model, fixture.abapDir);
  alice = await createApp({ model: fixture.model, metadata: fixture.metadata, db, rap, auth: { mode: "none", user: "ALICE" } });
  bob = await createApp({ model: fixture.model, metadata: fixture.metadata, db, rap, auth: { mode: "none", user: "BOB" } });
}, 180_000);

afterAll(async () => {
  await alice?.close();
  await bob?.close();
  await db?.destroy();
});

const HEADERS = { "content-type": "application/json", accept: "application/json", "if-match": "*" };
type Response = { status: number; body: Record<string, unknown> };

async function call(app: FastifyInstance, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<Response> {
  const response = await app.inject({ method, url: `${SERVICE}${url}`, headers: HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

const travel = (uuid: string, active: boolean): string => `Travel(TravelUUID=${uuid},IsActiveEntity=${active})`;
const values = (r: Response): Array<Record<string, unknown>> => r.body["value"] as Array<Record<string, unknown>>;

describe("draft", () => {
  it("describes the draft in the $metadata", () => {
    expect(fixture.metadata).toContain('<PropertyRef Name="IsActiveEntity"/>');
    expect(fixture.metadata).toContain('Term="Common.DraftRoot"');
    expect(fixture.metadata).toContain('<Action Name="Activate" IsBound="true"');
    expect(fixture.metadata).toContain('<NavigationProperty Name="DraftAdministrativeData"');
  });

  it("creates a draft, its children, and activates it with the determinations", async () => {
    const created = await call(alice, "POST", "Travel", { TravelID: "00000100", AgencyID: "070001", CustomerID: "000100", Description: "Draft travel", BookingFee: 10, CurrencyCode: "EUR" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ IsActiveEntity: false, HasActiveEntity: false, Description: "Draft travel" });
    const uuid = String(created.body["TravelUUID"]);
    // the draft is not active: not in the active instances
    expect(values(await call(alice, "GET", "Travel?$filter=IsActiveEntity eq true and TravelID eq '00000100'"))).toEqual([]);
    expect((await call(alice, "PATCH", travel(uuid, false), { BeginDate: "2027-04-01", EndDate: "2027-04-05" })).status).toBe(200);
    const booking = await call(alice, "POST", `${travel(uuid, false)}/_Booking`, { BookingID: "0001", CarrierID: "AF", ConnectionID: "0012", FlightDate: "2027-04-01", FlightPrice: 200, CurrencyCode: "EUR" });
    expect(booking.status, JSON.stringify(booking.body)).toBe(201);
    expect(booking.body).toMatchObject({ IsActiveEntity: false, TravelUUID: uuid });
    expect(values(await call(alice, "GET", `${travel(uuid, false)}/_Booking`))).toHaveLength(1);
    // the read-only fields are refused in a draft
    expect((await call(alice, "PATCH", travel(uuid, false), { OverallStatus: "A" })).status).toBe(400);
    const activated = await call(alice, "POST", `${travel(uuid, false)}/${NS}.Activate`, {});
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect(activated.body).toMatchObject({ TravelUUID: uuid, IsActiveEntity: true, OverallStatus: "O", TotalPrice: 210 });
    expect(values(await call(alice, "GET", `${travel(uuid, true)}/_Booking`))).toEqual([expect.objectContaining({ BookingID: "0001", IsActiveEntity: true })]);
    expect((await call(alice, "GET", travel(uuid, false))).status).toBe(404);
  });

  it("keeps the draft when a validation refuses the activation", async () => {
    const created = await call(alice, "POST", "Travel", { TravelID: "00000101", AgencyID: "070001", CustomerID: "000101", CurrencyCode: "EUR" });
    const uuid = String(created.body["TravelUUID"]);
    const refused = await call(alice, "POST", `${travel(uuid, false)}/${NS}.Activate`, {});
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("Begin date and end date are required");
    expect((await call(alice, "GET", travel(uuid, false))).status).toBe(200);
    expect((await call(alice, "POST", `${travel(uuid, false)}/${NS}.Discard`, {})).status).toBe(204);
    expect((await call(alice, "GET", travel(uuid, false))).status).toBe(404);
  });

  it("edits an active instance in a draft, locked for the others, and activates the changes", async () => {
    const edit = await call(alice, "POST", `${travel(T1, true)}/${NS}.Edit`, { PreserveChanges: false });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body).toMatchObject({ TravelUUID: T1, IsActiveEntity: false, HasActiveEntity: true, Description: "Paris and Rome" });
    const bookings = values(await call(alice, "GET", `${travel(T1, false)}/_Booking?$orderby=BookingID`));
    expect(bookings.map((b) => b["BookingID"])).toEqual(["0001", "0002", "0003"]);
    // the active instance shows that it has a draft, and is locked
    expect((await call(alice, "GET", travel(T1, true))).body).toMatchObject({ HasDraftEntity: true });
    expect((await call(alice, "PATCH", travel(T1, true), { Description: "Direct" })).status).toBe(409);
    expect((await call(bob, "POST", `${travel(T1, true)}/${NS}.Edit`, {})).status).toBe(409);
    // the drafts of the others are not read
    expect((await call(bob, "GET", travel(T1, false))).status).toBe(404);
    expect((await call(bob, "PATCH", travel(T1, false), { Description: "Bob" })).status).toBe(409);
    // changes in the draft: not active until the activation
    expect((await call(alice, "PATCH", travel(T1, false), { Description: "Paris, Rome and Venice" })).status).toBe(200);
    const third = bookings[2] as Record<string, unknown>;
    expect((await call(alice, "DELETE", `Booking(BookingUUID=${String(third["BookingUUID"])},IsActiveEntity=false)`)).status).toBe(204);
    expect((await call(alice, "GET", travel(T1, true))).body["Description"]).toBe("Paris and Rome");
    const activated = await call(alice, "POST", `${travel(T1, false)}/${NS}.Activate`, {});
    expect(activated.status, JSON.stringify(activated.body)).toBe(200);
    expect(activated.body).toMatchObject({ Description: "Paris, Rome and Venice", HasDraftEntity: false });
    expect(values(await call(alice, "GET", `${travel(T1, true)}/_Booking`))).toHaveLength(2);
    // unlocked
    expect((await call(alice, "PATCH", travel(T1, true), { Description: "Direct change" })).status).toBe(200);
  });

  it("navigates to the sibling of an instance, the draft of the user only (SiblingEntity, D81)", async () => {
    expect(fixture.metadata).toContain('<NavigationProperty Name="SiblingEntity" Type="');
    expect((await call(alice, "POST", `${travel(T1, true)}/${NS}.Edit`, {})).status).toBe(200);
    // Alice: the draft is the sibling of the active instance, and the other way round
    expect((await call(alice, "GET", `${travel(T1, true)}/SiblingEntity`)).body).toMatchObject({ TravelUUID: T1, IsActiveEntity: false });
    expect((await call(alice, "GET", `${travel(T1, false)}?$expand=SiblingEntity($select=IsActiveEntity,Description)`)).body["SiblingEntity"]).toMatchObject({ IsActiveEntity: true, Description: "Direct change" });
    // Bob does not see the draft of Alice: no sibling, the active instance is listed (locked)
    expect((await call(bob, "GET", `${travel(T1, true)}/SiblingEntity`)).status).toBe(204);
    const all = "$filter=(IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null) and TravelID eq '00000001'&$select=IsActiveEntity";
    expect(values(await call(alice, "GET", `Travel?${all}`))).toEqual([expect.objectContaining({ IsActiveEntity: false })]);
    expect(values(await call(bob, "GET", `Travel?${all}`))).toEqual([expect.objectContaining({ IsActiveEntity: true })]);
    const locked = "$filter=IsActiveEntity eq true and HasDraftEntity eq true and SiblingEntity/IsActiveEntity eq null&$select=TravelID";
    expect(values(await call(bob, "GET", `Travel?${locked}`))).toEqual([expect.objectContaining({ TravelID: "00000001" })]);
    expect(values(await call(alice, "GET", `Travel?${locked}`))).toEqual([]);
    expect((await call(alice, "POST", `${travel(T1, false)}/${NS}.Discard`, {})).status).toBe(204);
  });

  it("runs the logic of the BO on the draft: determinations, Prepare, actions (D81)", async () => {
    const created = await call(alice, "POST", "Travel", { TravelID: "00000110", AgencyID: "070001", CustomerID: "000100", BookingFee: 10, CurrencyCode: "EUR" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const uuid = String(created.body["TravelUUID"]);
    // on modify { create }: the status is set in the draft
    expect((await call(alice, "GET", travel(uuid, false))).body).toMatchObject({ OverallStatus: "O", TotalPrice: 10 });
    // a draft booking changes the total price of the draft travel
    const booking = await call(alice, "POST", `${travel(uuid, false)}/_Booking`, { BookingID: "0001", CarrierID: "AF", ConnectionID: "0012", FlightDate: "2027-04-01", FlightPrice: 200, CurrencyCode: "EUR" });
    expect(booking.status, JSON.stringify(booking.body)).toBe(201);
    expect((await call(alice, "GET", travel(uuid, false))).body).toMatchObject({ TotalPrice: 210 });
    expect((await call(alice, "PATCH", travel(uuid, false), { BookingFee: 30 })).status).toBe(200);
    expect((await call(alice, "GET", travel(uuid, false))).body).toMatchObject({ TotalPrice: 230 });
    // a booking that only exists in the draft: the handler reads the parent of a deleted booking on
    // the database (active instances), where it is not, as on SAP: the total stays
    expect((await call(alice, "DELETE", `Booking(BookingUUID=${String(booking.body["BookingUUID"])},IsActiveEntity=false)`)).status).toBe(204);
    expect((await call(alice, "GET", travel(uuid, false))).body).toMatchObject({ TotalPrice: 230 });
    // Prepare runs the validations it names: the draft stays, the messages come back
    const prepared = await alice.inject({ method: "POST", url: `${SERVICE}${travel(uuid, false)}/${NS}.Prepare`, headers: HEADERS, payload: "{}" });
    expect(prepared.statusCode).toBe(200);
    expect(JSON.parse(String(prepared.headers["sap-messages"]))).toEqual([expect.objectContaining({ message: "Begin date and end date are required", numericSeverity: 4 })]);
    // the state messages of the draft (SAP__Messages), replaced when the validation runs again
    expect(fixture.metadata).toContain('<Annotation Term="Common.Messages" Path="SAP__Messages"/>');
    const stated = (await call(alice, "GET", `${travel(uuid, false)}?$select=TravelUUID,SAP__Messages`)).body["SAP__Messages"];
    expect(stated).toEqual([expect.objectContaining({ message: "Begin date and end date are required", numericSeverity: 4, target: "BeginDate", transition: false })]);
    expect((await call(alice, "GET", `${travel(T2, true)}?$select=SAP__Messages`)).body["SAP__Messages"]).toEqual([]);
    expect((await call(alice, "PATCH", travel(uuid, false), { BeginDate: "2027-04-01", EndDate: "2027-04-05" })).status).toBe(200);
    expect((await alice.inject({ method: "POST", url: `${SERVICE}${travel(uuid, false)}/${NS}.Prepare`, headers: HEADERS, payload: "{}" })).statusCode).toBe(200);
    expect((await call(alice, "GET", `${travel(uuid, false)}?$select=SAP__Messages`)).body["SAP__Messages"]).toEqual([]);
    // an action on the draft changes the draft, not the active instances
    expect((await call(alice, "POST", `${travel(uuid, false)}/${NS}.acceptTravel`, {})).body).toMatchObject({ IsActiveEntity: false, OverallStatus: "A" });
    expect(values(await call(alice, "GET", "Travel?$filter=IsActiveEntity eq true and TravelID eq '00000110'"))).toEqual([]);
    // an edited instance: the logic changes the draft only
    expect((await call(alice, "POST", `${travel(T1, true)}/${NS}.Edit`, {})).status).toBe(200);
    const before = (await call(alice, "GET", travel(T1, true))).body["TotalPrice"];
    expect((await call(alice, "PATCH", travel(T1, false), { BookingFee: 99 })).status).toBe(200);
    expect((await call(alice, "GET", travel(T1, false))).body["TotalPrice"]).not.toBe(before);
    expect((await call(alice, "GET", travel(T1, true))).body["TotalPrice"]).toBe(before);
    // the deletion of an active booking in the draft: the total of the draft changes
    const drafted = Number((await call(alice, "GET", travel(T1, false))).body["TotalPrice"]);
    expect((await call(alice, "DELETE", `Booking(BookingUUID=${B2},IsActiveEntity=false)`)).status).toBe(204);
    expect(Number((await call(alice, "GET", travel(T1, false))).body["TotalPrice"])).toBeCloseTo(drafted - 750.25, 2);
    expect((await call(alice, "GET", travel(T1, true))).body["TotalPrice"]).toBe(before);
    expect((await call(alice, "POST", `${travel(T1, false)}/${NS}.Discard`, {})).status).toBe(204);
    expect((await call(alice, "POST", `${travel(uuid, false)}/${NS}.Discard`, {})).status).toBe(204);
  });

  it("gives the administrative data of the draft", async () => {
    const edit = await call(bob, "POST", `${travel(T1, true)}/${NS}.Edit`, {});
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    const read = await call(bob, "GET", `${travel(T1, false)}?$expand=DraftAdministrativeData`);
    expect(read.body["DraftAdministrativeData"]).toMatchObject({ CreatedByUser: "BOB", InProcessByUser: "BOB" });
    expect((await call(bob, "POST", `${travel(T1, false)}/${NS}.Discard`, {})).status).toBe(204);
    expect((await call(alice, "GET", travel(T1, true))).body).toMatchObject({ HasDraftEntity: false });
  });
});
