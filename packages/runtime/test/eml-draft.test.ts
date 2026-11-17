/**
 * The draft indicator in EML (D110): `%is_draft` in `%tky` and in the creations of a draft BO. A
 * factory action whose handler creates its copy with `%is_draft = if_abap_behv=>mk-on` answers a
 * new draft (IsActiveEntity false), called on an active instance or on a draft (a draft of its
 * own, apart from the draft it was called on).
 */

import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";
import { PGliteDialect } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createDatabase, PGLITE_PARSERS, type Database } from "../src/db/database.js";
import { RapRuntime } from "../src/rap/runtime.js";
import { DRAFT_CHANGES, edit, generatedVariant, SEED, SERVICE, T1, type GeneratedFixture } from "./helpers.js";

const NS = "com.sap.gateway.srvd.zrt_ui_travel.v0001";
const HEADERS = { "content-type": "application/json", accept: "application/json", "if-match": "*" };

let fixture: GeneratedFixture;
let db: Database;
let pglite: PGlite;
let app: FastifyInstance;

beforeAll(async () => {
  const locals = DRAFT_CHANGES["zbp_rt_r_travel.clas.locals_imp.abap"];
  fixture = await generatedVariant({
    ...DRAFT_CHANGES,
    "zbp_rt_r_travel.clas.locals_imp.abap": (content) =>
      edit(locals === undefined ? content : locals(content), [["      APPEND VALUE #( %cid         = key-%cid\n", "      APPEND VALUE #( %cid         = key-%cid\n                      %is_draft    = if_abap_behv=>mk-on\n"]]),
  });
  pglite = await PGlite.create({ parsers: PGLITE_PARSERS });
  await pglite.exec("SET TIME ZONE 'UTC'");
  await pglite.exec(fixture.schema);
  await pglite.exec(SEED);
  db = createDatabase(new PGliteDialect({ pglite }));
  const rap = await RapRuntime.load(fixture.model, fixture.abapDir);
  app = await createApp({ model: fixture.model, metadata: fixture.metadata, db, rap, auth: { mode: "none", user: "ALICE" } });
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

async function call(method: "GET" | "POST", url: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.inject({ method, url: `${SERVICE}${url}`, headers: HEADERS, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, body: response.body === "" ? {} : (JSON.parse(response.body) as Record<string, unknown>) };
}

const drafts = async (): Promise<number> => Number((await pglite.query<{ n: number }>(`SELECT count(*)::int AS n FROM "rapt_draft_admin"`)).rows[0]?.n ?? 0);

describe("%is_draft in EML (D110)", () => {
  it("declares the draft indicator in the derived types of a draft BO", () => {
    expect(fixture.model.behaviors.find((b) => b.name === "ZRT_R_TRAVEL")?.draft).toBe(true);
  });

  it("answers the draft a factory action creates with %is_draft on an active instance", async () => {
    const before = await drafts();
    const copy = await call("POST", `Travel(TravelUUID=${T1},IsActiveEntity=true)/${NS}.copyTravel`, {});
    expect(copy.status, JSON.stringify(copy.body)).toBe(200);
    expect(copy.body).toMatchObject({ IsActiveEntity: false, HasActiveEntity: false, Description: "Copy of Paris and Rome" });
    expect(copy.body["TravelUUID"]).not.toBe(T1);
    expect(await drafts()).toBe(before + 1);
    // the copy is a draft of the user, not an active instance
    const active = await call("GET", `Travel(TravelUUID=${String(copy.body["TravelUUID"])},IsActiveEntity=true)`);
    expect(active.status).toBe(404);
    const draft = await call("GET", `Travel(TravelUUID=${String(copy.body["TravelUUID"])},IsActiveEntity=false)?$expand=DraftAdministrativeData`);
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    expect(draft.body["DraftAdministrativeData"]).toMatchObject({ InProcessByUser: "ALICE" });
  });

  it("runs a factory action on a draft: the copy is a draft of its own", async () => {
    const edit = await call("POST", `Travel(TravelUUID=${T1},IsActiveEntity=true)/${NS}.Edit`, { PreserveChanges: true });
    expect(edit.status, JSON.stringify(edit.body)).toBe(201);
    const before = await drafts();
    const copy = await call("POST", `Travel(TravelUUID=${T1},IsActiveEntity=false)/${NS}.copyTravel`, {});
    expect(copy.status, JSON.stringify(copy.body)).toBe(200);
    expect(copy.body).toMatchObject({ IsActiveEntity: false, Description: "Copy of Paris and Rome" });
    expect(await drafts()).toBe(before + 1);
    const uuids = await pglite.query<{ n: number }>(`SELECT count(DISTINCT "DraftUUID")::int AS n FROM "zrt_d_travel" WHERE "TravelUUID" IN ('${T1}', '${String(copy.body["TravelUUID"])}')`);
    expect(uuids.rows[0]?.n).toBe(2);
  });
});
